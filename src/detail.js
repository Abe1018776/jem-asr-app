import { initState, getState, getStatus, exportState, importState } from './state.js';
import { renderSuggestedMatches, linkMatch, unlinkMatch, renderSearchModal } from './mapping.js';
import { batchClean } from './cleaning.js';
import { alignRow } from './alignment.js';
import { renderReviewPanel } from './review.js';
import { renderKaraokePlayer } from './karaoke.js';
import { formatConfidence } from './utils.js';

const R2_BASE = 'https://audio.kohnai.ai';

document.addEventListener('DOMContentLoaded', async () => {
  const params = new URLSearchParams(window.location.search);
  const audioId = params.get('id');
  const page = document.getElementById('detail-page');

  if (!audioId) {
    page.innerHTML = '<div class="empty-state"><div class="empty-state-title">No audio ID specified</div></div>';
    return;
  }

  // Back button
  document.getElementById('btn-back').addEventListener('click', () => {
    window.close();
    // If window.close() is blocked (not opened by script), go to index
    window.location.href = '/';
  });

  // Load data (same as app.js)
  const resp = await fetch('/data.json');
  if (!resp.ok) {
    page.innerHTML = '<div class="empty-state"><div class="empty-state-title">Failed to load data</div></div>';
    return;
  }
  const raw = await resp.json();

  const selectedNames = new Set((raw.selected || []).map(s => s.audioName));
  const audioMap = new Map();
  (raw.allAudio || []).forEach((a, i) => {
    const id = 'a_' + i;
    audioMap.set(a.name, id);
    a.id = id;
    a.driveLink = a.link;
    a.isSelected50hr = selectedNames.has(a.name);
    a.isBenchmark = false;
  });

  const firstLines = {};
  (raw.matched || []).forEach(m => { if (m.firstLine && m.transcriptName) firstLines[m.transcriptName] = m.firstLine; });
  (raw.selected || []).forEach(s => { if (s.firstLine && s.transcriptName) firstLines[s.transcriptName] = s.firstLine; });

  const transcriptMap = new Map();
  (raw.allTranscripts || []).forEach((t, i) => {
    const id = 't_' + i;
    transcriptMap.set(t.name, id);
    t.id = id;
    t.driveLink = t.link;
    t.r2TranscriptLink = `${R2_BASE}/transcripts/${encodeURIComponent(t.name)}`;
    if (!t.firstLine && firstLines[t.name]) t.firstLine = firstLines[t.name];
  });

  const mappings = {};
  (raw.matched || []).forEach(m => {
    const aId = audioMap.get(m.audioName);
    const tId = transcriptMap.get(m.transcriptName);
    if (aId && tId) {
      mappings[aId] = { transcriptId: tId, confidence: 0.9, matchReason: 'pre-matched', confirmedBy: 'imported', confirmedAt: raw.generated || new Date().toISOString() };
    }
  });
  (raw.selected || []).forEach(s => {
    const aId = audioMap.get(s.audioName);
    const tId = transcriptMap.get(s.transcriptName);
    if (aId && tId && !mappings[aId]) {
      mappings[aId] = { transcriptId: tId, confidence: 0.95, matchReason: '50hr-selected', confirmedBy: 'imported', confirmedAt: raw.generated || new Date().toISOString() };
    }
  });

  const benchmarkNames = [
    '0015--5711-Tamuz 12 Sicha 1.mp3',
    '0142--5715-Tamuz 13d Sicha 3.mp3',
    '2781--5741-Nissan 11e Mamar.mp3',
    '0003--5711-Shvat 10c Mamar.mp3',
    '2925--5742-Kislev 19 Sicha 1.mp3',
  ];
  const benchmarkSet = new Set(benchmarkNames);
  (raw.allAudio || []).forEach(a => {
    if (benchmarkSet.has(a.name)) {
      a.isBenchmark = true;
      a.isSelected50hr = false;
      a.r2Link = `${R2_BASE}/benchmark/${encodeURIComponent(a.name)}`;
    } else if (selectedNames.has(a.name)) {
      a.r2Link = `${R2_BASE}/training/${encodeURIComponent(a.name)}`;
    }
  });

  const data = { audio: raw.allAudio || [], transcripts: raw.allTranscripts || [], preMappings: mappings };
  const state = initState(data);
  if (data.preMappings) {
    for (const [aId, mapping] of Object.entries(data.preMappings)) {
      if (!state.mappings[aId]) state.mappings[aId] = mapping;
    }
  }

  // Find the audio entry
  const audio = state.audio.find(a => a.id === audioId);
  if (!audio) {
    page.innerHTML = '<div class="empty-state"><div class="empty-state-title">Audio not found</div></div>';
    return;
  }

  renderDetailPage(audioId, audio, state, page);
});

function renderDetailPage(audioId, audio, state, container) {
  container.innerHTML = '';
  const status = getStatus(audioId);

  // Title bar
  const titleBar = document.createElement('div');
  titleBar.className = 'detail-title-bar';
  const title = document.createElement('h2');
  title.textContent = audio.name;
  titleBar.appendChild(title);
  const badge = document.createElement('span');
  badge.className = `status-badge status-${status}`;
  badge.textContent = status;
  titleBar.appendChild(badge);
  container.appendChild(titleBar);

  // Meta row
  const meta = document.createElement('div');
  meta.className = 'detail-meta';
  const metaItems = [
    audio.year && `Year: ${audio.year}`,
    audio.type && `Type: ${audio.type}`,
    audio.estMinutes != null && `Duration: ~${audio.estMinutes} min`,
    audio.isSelected50hr && '50-Hour Set',
    audio.isBenchmark && 'Benchmark',
  ].filter(Boolean);
  meta.textContent = metaItems.join('  |  ');
  container.appendChild(meta);

  // === Section: Audio Player ===
  const playerSection = createSection('Audio Player');
  const audioUrl = audio.r2Link || audio.driveLink;
  if (audioUrl) {
    const playerEl = document.createElement('audio');
    playerEl.controls = true;
    playerEl.preload = 'none';
    playerEl.src = audioUrl;
    playerEl.className = 'audio-player';
    playerSection.content.appendChild(playerEl);
  } else {
    const noAudio = document.createElement('div');
    noAudio.className = 'no-audio';
    noAudio.textContent = 'No audio URL available';
    playerSection.content.appendChild(noAudio);
  }
  container.appendChild(playerSection.el);

  // === Section: Mapping ===
  if (!audio.isBenchmark) {
    const mappingSection = createSection('Transcript Mapping');
    renderMappingSection(audioId, state, mappingSection.content, container);
    container.appendChild(mappingSection.el);
  }

  // === Section: Cleaning ===
  if (state.mappings[audioId] && !audio.isBenchmark) {
    const cleanSection = createSection('Cleaning');
    renderCleanSection(audioId, state, cleanSection.content, container);
    container.appendChild(cleanSection.el);
  }

  // === Section: Alignment ===
  if (state.cleaning[audioId] && !audio.isBenchmark) {
    const alignSection = createSection('Alignment');
    renderAlignSection(audioId, state, alignSection.content, container);
    container.appendChild(alignSection.el);
  }

  // === Section: Review & Diff ===
  if (state.cleaning[audioId] && !audio.isBenchmark) {
    const reviewSection = createSection('Review & Diff');
    renderReviewPanel(audioId, state, reviewSection.content, {
      onApprove: () => renderDetailPage(audioId, audio, getState(), container),
      onReject: () => renderDetailPage(audioId, audio, getState(), container),
      onSkip: () => {},
    });
    container.appendChild(reviewSection.el);
  }

  // === Section: Karaoke ===
  if (state.alignments[audioId]) {
    const karaokeSection = createSection('Karaoke Player');
    const karaokeBtn = document.createElement('button');
    karaokeBtn.className = 'btn btn-secondary';
    karaokeBtn.textContent = 'Open Karaoke Player';
    karaokeBtn.addEventListener('click', () => {
      renderKaraokePlayer(audioId, getState());
    });
    karaokeSection.content.appendChild(karaokeBtn);
    container.appendChild(karaokeSection.el);
  }
}

function createSection(title) {
  const el = document.createElement('section');
  el.className = 'detail-section';
  const header = document.createElement('h3');
  header.className = 'detail-section-title';
  header.textContent = title;
  el.appendChild(header);
  const content = document.createElement('div');
  content.className = 'detail-section-content';
  el.appendChild(content);
  return { el, content };
}

function renderMappingSection(audioId, state, container, pageContainer) {
  container.innerHTML = '';
  const mapping = state.mappings[audioId];

  if (mapping) {
    const transcript = state.transcripts.find(t => t.id === mapping.transcriptId);
    const info = document.createElement('div');
    info.className = 'detail-mapping-info';
    info.innerHTML = '';

    const label = document.createElement('div');
    label.style.cssText = 'margin-bottom:8px;';
    const strong = document.createElement('strong');
    strong.textContent = 'Linked to: ';
    label.appendChild(strong);
    label.appendChild(document.createTextNode(transcript ? transcript.name : mapping.transcriptId));
    if (mapping.confidence) {
      const conf = document.createElement('span');
      conf.className = 'text-secondary';
      conf.textContent = ` (${formatConfidence(mapping.confidence)} confidence)`;
      label.appendChild(conf);
    }
    info.appendChild(label);

    // Show transcript preview
    if (transcript) {
      const previewText = transcript.text || transcript.firstLine || '';
      if (previewText) {
        const preview = document.createElement('div');
        preview.className = 'detail-transcript-preview';
        preview.dir = 'rtl';
        preview.textContent = previewText;
        info.appendChild(preview);
      }

      // If transcript has r2TranscriptLink, offer to load full text
      if (transcript.r2TranscriptLink && !transcript.text) {
        const loadBtn = document.createElement('button');
        loadBtn.className = 'action-btn';
        loadBtn.textContent = 'Load Full Transcript';
        loadBtn.addEventListener('click', async () => {
          loadBtn.textContent = 'Loading...';
          loadBtn.disabled = true;
          try {
            const resp = await fetch(transcript.r2TranscriptLink);
            if (resp.ok) {
              transcript.text = await resp.text();
              renderMappingSection(audioId, getState(), container, pageContainer);
            } else {
              loadBtn.textContent = 'Failed to load';
            }
          } catch {
            loadBtn.textContent = 'Failed to load';
          }
        });
        info.appendChild(loadBtn);
      }
    }

    container.appendChild(info);

    // Buttons
    const btnBar = document.createElement('div');
    btnBar.style.cssText = 'display:flex;gap:8px;margin-top:12px;';

    const changeBtn = document.createElement('button');
    changeBtn.className = 'action-btn action-btn-primary';
    changeBtn.textContent = 'Change Transcript';
    changeBtn.addEventListener('click', () => {
      renderSearchModal(document.body, getState(), (transcriptId) => {
        linkMatch(audioId, transcriptId, 1.0, 'manual search');
        const s = getState();
        if (s.cleaning[audioId]) delete s.cleaning[audioId];
        if (s.alignments[audioId]) delete s.alignments[audioId];
        if (s.reviews[audioId]) delete s.reviews[audioId];
        const audio = s.audio.find(a => a.id === audioId);
        renderDetailPage(audioId, audio, s, pageContainer);
      });
    });
    btnBar.appendChild(changeBtn);

    const unlinkBtn = document.createElement('button');
    unlinkBtn.className = 'action-btn action-btn-danger';
    unlinkBtn.textContent = 'Unlink';
    unlinkBtn.addEventListener('click', () => {
      unlinkMatch(audioId);
      const s = getState();
      if (s.cleaning[audioId]) delete s.cleaning[audioId];
      if (s.alignments[audioId]) delete s.alignments[audioId];
      if (s.reviews[audioId]) delete s.reviews[audioId];
      const audio = s.audio.find(a => a.id === audioId);
      renderDetailPage(audioId, audio, s, pageContainer);
    });
    btnBar.appendChild(unlinkBtn);

    container.appendChild(btnBar);
  } else {
    // Unmapped: show suggestions + search
    const suggestionsDiv = document.createElement('div');
    suggestionsDiv.className = 'suggestions-container';
    renderSuggestedMatches(audioId, suggestionsDiv, state, (aId, tId) => {
      linkMatch(aId, tId, 0.8, 'user selected');
      const s = getState();
      const audio = s.audio.find(a => a.id === audioId);
      renderDetailPage(audioId, audio, s, pageContainer);
    });
    container.appendChild(suggestionsDiv);

    const searchBtn = document.createElement('button');
    searchBtn.className = 'btn btn-secondary';
    searchBtn.textContent = 'Search Transcripts';
    searchBtn.style.marginTop = '12px';
    searchBtn.addEventListener('click', () => {
      renderSearchModal(document.body, getState(), (transcriptId) => {
        linkMatch(audioId, transcriptId, 1.0, 'manual search');
        const s = getState();
        const audio = s.audio.find(a => a.id === audioId);
        renderDetailPage(audioId, audio, s, pageContainer);
      });
    });
    container.appendChild(searchBtn);
  }
}

function renderCleanSection(audioId, state, container, pageContainer) {
  const cleaning = state.cleaning[audioId];

  if (cleaning) {
    const info = document.createElement('div');
    info.className = 'text-secondary';
    info.style.marginBottom = '8px';
    info.textContent = `Clean rate: ${cleaning.cleanRate}% | Cleaned at: ${new Date(cleaning.cleanedAt).toLocaleString()}`;
    container.appendChild(info);

    const reCleanBtn = document.createElement('button');
    reCleanBtn.className = 'action-btn';
    reCleanBtn.textContent = 'Re-Clean';
    reCleanBtn.addEventListener('click', async () => {
      reCleanBtn.textContent = 'Cleaning...';
      reCleanBtn.disabled = true;
      await batchClean([audioId], getState(), () => {});
      const s = getState();
      const audio = s.audio.find(a => a.id === audioId);
      renderDetailPage(audioId, audio, s, pageContainer);
    });
    container.appendChild(reCleanBtn);
  } else {
    const cleanBtn = document.createElement('button');
    cleanBtn.className = 'btn btn-secondary';
    cleanBtn.textContent = 'Run Cleaning';
    cleanBtn.addEventListener('click', async () => {
      cleanBtn.textContent = 'Cleaning...';
      cleanBtn.disabled = true;
      await batchClean([audioId], getState(), () => {});
      const s = getState();
      const audio = s.audio.find(a => a.id === audioId);
      renderDetailPage(audioId, audio, s, pageContainer);
    });
    container.appendChild(cleanBtn);
  }
}

function renderAlignSection(audioId, state, container, pageContainer) {
  const alignment = state.alignments[audioId];

  if (alignment) {
    const info = document.createElement('div');
    info.className = 'text-secondary';
    info.style.marginBottom = '8px';
    info.textContent = `Avg confidence: ${formatConfidence(alignment.avgConfidence)} | Low confidence words: ${alignment.lowConfidenceCount} | Aligned at: ${new Date(alignment.alignedAt).toLocaleString()}`;
    container.appendChild(info);

    const reAlignBtn = document.createElement('button');
    reAlignBtn.className = 'action-btn';
    reAlignBtn.textContent = 'Re-Align';
    reAlignBtn.addEventListener('click', async () => {
      reAlignBtn.textContent = 'Aligning (may take ~2.5 min for cold start)...';
      reAlignBtn.disabled = true;
      try {
        await alignRow(audioId, getState());
      } catch (err) {
        reAlignBtn.textContent = 'Error: ' + err.message;
        return;
      }
      const s = getState();
      const audio = s.audio.find(a => a.id === audioId);
      renderDetailPage(audioId, audio, s, pageContainer);
    });
    container.appendChild(reAlignBtn);
  } else {
    const alignBtn = document.createElement('button');
    alignBtn.className = 'btn btn-secondary';
    alignBtn.textContent = 'Run Alignment';
    alignBtn.addEventListener('click', async () => {
      alignBtn.textContent = 'Aligning (may take ~2.5 min for cold start)...';
      alignBtn.disabled = true;
      try {
        await alignRow(audioId, getState());
      } catch (err) {
        alignBtn.textContent = 'Error: ' + err.message;
        return;
      }
      const s = getState();
      const audio = s.audio.find(a => a.id === audioId);
      renderDetailPage(audioId, audio, s, pageContainer);
    });
    container.appendChild(alignBtn);
  }
}
