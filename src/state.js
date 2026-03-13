const STORAGE_KEY = 'jem-asr-state';

let state = null;

export function initState(data) {
  const saved = loadFromStorage();
  state = {
    audio: data.audio || [],
    transcripts: data.transcripts || [],
    transcriptVersions: saved.transcriptVersions || {},
    // Legacy keys kept for backward compat
    mappings: saved.mappings || {},
    cleaning: saved.cleaning || {},
    alignments: saved.alignments || {},
    reviews: saved.reviews || {},
    benchmarks: saved.benchmarks || {},
    asrModels: saved.asrModels || [],
  };
  // Migrate old format into transcriptVersions
  migrateToVersions();
  return state;
}

function migrateToVersions() {
  for (const [audioId, mapping] of Object.entries(state.mappings)) {
    if (!state.transcriptVersions[audioId]) {
      state.transcriptVersions[audioId] = [];
    }
    const versions = state.transcriptVersions[audioId];
    // Create manual version if none exists
    if (!versions.some(v => v.type === 'manual')) {
      versions.push({
        id: `tv_${audioId}_manual`,
        type: 'manual',
        sourceTranscriptId: mapping.transcriptId,
        text: null, // loaded on demand from R2
        confidence: mapping.confidence,
        matchReason: mapping.matchReason,
        createdAt: mapping.confirmedAt || new Date().toISOString(),
        createdBy: mapping.confirmedBy || 'imported',
      });
    }
    // Migrate cleaning data
    const cleaning = state.cleaning[audioId];
    if (cleaning && !versions.some(v => v.type === 'cleaned')) {
      versions.push({
        id: `tv_${audioId}_cleaned`,
        type: 'cleaned',
        parentVersionId: `tv_${audioId}_manual`,
        sourceTranscriptId: mapping.transcriptId,
        text: cleaning.cleanedText,
        originalText: cleaning.originalText,
        cleanRate: cleaning.cleanRate,
        createdAt: cleaning.cleanedAt || new Date().toISOString(),
        createdBy: 'system',
      });
    }
    // Migrate alignment data
    const alignment = state.alignments[audioId];
    if (alignment) {
      const target = versions.find(v => v.type === 'cleaned') || versions.find(v => v.type === 'manual');
      if (target && !target.alignment) {
        target.alignment = {
          words: alignment.words,
          avgConfidence: alignment.avgConfidence,
          lowConfidenceCount: alignment.lowConfidenceCount,
          alignedAt: alignment.alignedAt,
        };
      }
    }
    // Migrate review data
    const review = state.reviews[audioId];
    if (review) {
      const target = versions[versions.length - 1];
      if (target && !target.review) {
        target.review = {
          status: review.status,
          editedText: review.editedText,
          reviewedAt: review.reviewedAt,
        };
      }
    }
  }
}

export function getState() {
  return state;
}

export function updateState(key, audioId, value) {
  if (!state) return;
  if (!state[key]) state[key] = {};
  if (audioId === null) {
    state[key] = value;
  } else {
    state[key][audioId] = value;
  }
  saveToStorage();
}

export function getStatus(audioId) {
  if (!state) return 'unmapped';
  const versions = state.transcriptVersions[audioId];
  if (versions && versions.length > 0) {
    if (versions.some(v => v.review?.status === 'approved')) return 'approved';
    if (versions.some(v => v.review?.status === 'rejected')) return 'rejected';
    if (versions.some(v => v.alignment)) return 'aligned';
    if (versions.some(v => v.type === 'cleaned')) return 'cleaned';
    return 'mapped';
  }
  // Fallback to legacy
  if (state.reviews[audioId]?.status === 'approved') return 'approved';
  if (state.reviews[audioId]?.status === 'rejected') return 'rejected';
  if (state.alignments[audioId]) return 'aligned';
  if (state.cleaning[audioId]) return 'cleaned';
  if (state.mappings[audioId]) return 'mapped';
  return 'unmapped';
}

// ── Transcript version helpers ──────────────────────────────────────

export function getVersions(audioId) {
  if (!state || !state.transcriptVersions[audioId]) return [];
  return state.transcriptVersions[audioId];
}

export function getVersionsByType(audioId, type) {
  return getVersions(audioId).filter(v => v.type === type);
}

export function getBestVersion(audioId) {
  const versions = getVersions(audioId);
  if (versions.length === 0) return null;
  // Priority: edited > cleaned > asr > manual
  const priority = ['edited', 'cleaned', 'asr', 'manual'];
  for (const type of priority) {
    const v = versions.filter(v => v.type === type);
    if (v.length > 0) return v[v.length - 1]; // latest of that type
  }
  return versions[versions.length - 1];
}

export function addVersion(audioId, versionData) {
  if (!state) return null;
  if (!state.transcriptVersions[audioId]) {
    state.transcriptVersions[audioId] = [];
  }
  const id = `tv_${audioId}_${versionData.type}_${Date.now()}`;
  const version = { id, ...versionData, createdAt: versionData.createdAt || new Date().toISOString() };
  state.transcriptVersions[audioId].push(version);
  syncLegacyKeys(audioId);
  saveToStorage();
  return version;
}

export function updateVersion(audioId, versionId, updates) {
  if (!state) return;
  const versions = state.transcriptVersions[audioId];
  if (!versions) return;
  const v = versions.find(v => v.id === versionId);
  if (v) {
    Object.assign(v, updates);
    syncLegacyKeys(audioId);
    saveToStorage();
  }
}

function syncLegacyKeys(audioId) {
  const versions = state.transcriptVersions[audioId] || [];
  const manual = versions.find(v => v.type === 'manual');
  if (manual) {
    state.mappings[audioId] = {
      transcriptId: manual.sourceTranscriptId,
      confidence: manual.confidence,
      matchReason: manual.matchReason,
      confirmedBy: manual.createdBy,
      confirmedAt: manual.createdAt,
    };
  }
  const cleaned = versions.find(v => v.type === 'cleaned');
  if (cleaned) {
    state.cleaning[audioId] = {
      originalText: cleaned.originalText,
      cleanedText: cleaned.text,
      cleanRate: cleaned.cleanRate,
      cleanedAt: cleaned.createdAt,
    };
  }
  const withAlignment = versions.find(v => v.alignment);
  if (withAlignment) {
    state.alignments[audioId] = withAlignment.alignment;
  }
  const withReview = versions.find(v => v.review);
  if (withReview) {
    state.reviews[audioId] = withReview.review;
  }
}

export function getFilteredRows(filter) {
  if (!state) return [];
  const { audio } = state;
  const fifty = audio.filter(a => a.isSelected50hr);

  switch (filter) {
    case '50hr':
      return fifty;
    case '50hr-unmapped':
      return fifty.filter(a => getStatus(a.id) === 'unmapped');
    case '50hr-mapped':
      return fifty.filter(a => getStatus(a.id) === 'mapped');
    case '50hr-cleaned':
      return fifty.filter(a => getStatus(a.id) === 'cleaned');
    case '50hr-aligned':
      return fifty.filter(a => getStatus(a.id) === 'aligned');
    case '50hr-approved':
      return fifty.filter(a => getStatus(a.id) === 'approved');
    case 'unmapped':
      return audio.filter(a => getStatus(a.id) === 'unmapped');
    case 'mapped':
      return audio.filter(a => {
        const s = getStatus(a.id);
        return (s === 'mapped' || s === 'cleaned' || s === 'aligned') && !a.isBenchmark;
      });
    case 'cleaned':
      return audio.filter(a => getStatus(a.id) === 'cleaned');
    case 'benchmark':
      return audio.filter(a => a.isBenchmark);
    case 'needsReview':
      return audio.filter(a => getStatus(a.id) === 'aligned');
    case 'approved':
      return audio.filter(a => getStatus(a.id) === 'approved');
    case 'all':
    default:
      return audio;
  }
}

export function getFilterCounts() {
  if (!state) return {};
  const { audio } = state;
  const fifty = audio.filter(a => a.isSelected50hr);
  return {
    '50hr': fifty.length,
    '50hr-unmapped': fifty.filter(a => getStatus(a.id) === 'unmapped').length,
    '50hr-mapped': fifty.filter(a => getStatus(a.id) === 'mapped').length,
    '50hr-cleaned': fifty.filter(a => getStatus(a.id) === 'cleaned').length,
    '50hr-aligned': fifty.filter(a => getStatus(a.id) === 'aligned').length,
    '50hr-approved': fifty.filter(a => getStatus(a.id) === 'approved').length,
  };
}

export function exportState() {
  if (!state) return;
  const exportData = {
    transcriptVersions: state.transcriptVersions,
    mappings: state.mappings,
    cleaning: state.cleaning,
    alignments: state.alignments,
    reviews: state.reviews,
    benchmarks: state.benchmarks,
    asrModels: (state.asrModels || []).map(m => {
      const { apiKey, ...rest } = m;
      return rest;
    }),
  };
  const blob = new Blob([JSON.stringify(exportData, null, 2)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `jem-asr-state-${new Date().toISOString().slice(0, 10)}.json`;
  a.click();
  URL.revokeObjectURL(url);
}

export function importState(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = (e) => {
      try {
        const imported = JSON.parse(e.target.result);
        if (imported.transcriptVersions) {
          for (const [audioId, versions] of Object.entries(imported.transcriptVersions)) {
            state.transcriptVersions[audioId] = versions;
          }
        }
        if (imported.mappings) Object.assign(state.mappings, imported.mappings);
        if (imported.cleaning) Object.assign(state.cleaning, imported.cleaning);
        if (imported.alignments) Object.assign(state.alignments, imported.alignments);
        if (imported.reviews) Object.assign(state.reviews, imported.reviews);
        if (imported.benchmarks) Object.assign(state.benchmarks, imported.benchmarks);
        if (imported.asrModels) {
          const existing = state.asrModels || [];
          for (const model of imported.asrModels) {
            const match = existing.find(m => m.name === model.name);
            if (match) {
              Object.assign(match, model);
            } else {
              existing.push(model);
            }
          }
          state.asrModels = existing;
        }
        saveToStorage();
        resolve(state);
      } catch (err) {
        reject(err);
      }
    };
    reader.onerror = reject;
    reader.readAsText(file);
  });
}

function saveToStorage() {
  try {
    const persist = {
      transcriptVersions: state.transcriptVersions,
      mappings: state.mappings,
      cleaning: state.cleaning,
      alignments: state.alignments,
      reviews: state.reviews,
      benchmarks: state.benchmarks,
      asrModels: state.asrModels,
    };
    localStorage.setItem(STORAGE_KEY, JSON.stringify(persist));
  } catch (e) {
    console.warn('Failed to save state to localStorage:', e);
  }
}

function loadFromStorage() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    return raw ? JSON.parse(raw) : {};
  } catch (e) {
    console.warn('Failed to load state from localStorage:', e);
    return {};
  }
}
