const STORAGE_KEY = 'jem-asr-state';

let state = null;

export function initState(data) {
  const saved = loadFromStorage();
  state = {
    audio: data.audio || [],
    transcripts: data.transcripts || [],
    mappings: saved.mappings || {},
    cleaning: saved.cleaning || {},
    alignments: saved.alignments || {},
    reviews: saved.reviews || {},
    benchmarks: saved.benchmarks || {},
    asrModels: saved.asrModels || [],
  };
  return state;
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
  if (state.reviews[audioId]?.status === 'approved') return 'approved';
  if (state.reviews[audioId]?.status === 'rejected') return 'rejected';
  if (state.alignments[audioId]) return 'aligned';
  if (state.cleaning[audioId]) return 'cleaned';
  if (state.mappings[audioId]) return 'mapped';
  return 'unmapped';
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
