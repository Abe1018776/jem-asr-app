import { initState, getState, getStatus, getVersions, getBestVersion, addVersion, updateVersion, updateState, exportState, importState } from './state.js';
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
    const txtName = t.name.replace(/\.(doc|docx|pdf|rtf|txt)$/i, '.txt');
    t.r2TranscriptLink = `/api/transcript?name=${encodeURIComponent(txtName)}`;
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

    // Trim Controls
    renderTrimControls(audioId, playerEl, playerSection.content);
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
  const versions = getVersions(audioId);
  const mapping = state.mappings[audioId];

  if (mapping || versions.length > 0) {
    const manual = versions.find(v => v.type === 'manual');
    const transcript = manual
      ? state.transcripts.find(t => t.id === manual.sourceTranscriptId)
      : (mapping ? state.transcripts.find(t => t.id === mapping.transcriptId) : null);

    // Header: linked transcript name
    const label = document.createElement('div');
    label.style.cssText = 'margin-bottom:8px;';
    const strong = document.createElement('strong');
    strong.textContent = 'Linked to: ';
    label.appendChild(strong);
    label.appendChild(document.createTextNode(transcript ? transcript.name : (mapping?.transcriptId || 'unknown')));
    container.appendChild(label);

    // Version tabs
    if (versions.length > 0) {
      const tabBar = document.createElement('div');
      tabBar.className = 'version-tab-bar';
      const contentArea = document.createElement('div');

      let activeVersionId = getBestVersion(audioId)?.id || versions[0].id;

      function renderVersionContent(versionId) {
        contentArea.innerHTML = '';
        const version = versions.find(v => v.id === versionId);
        if (!version) return;

        // Update tab active states
        tabBar.querySelectorAll('.version-tab').forEach(tab => {
          tab.classList.toggle('active', tab.dataset.versionId === versionId);
        });

        // Editable textarea
        const textarea = document.createElement('textarea');
        textarea.className = 'transcript-editor';
        textarea.dir = 'rtl';
        textarea.rows = 12;
        textarea.placeholder = 'Loading transcript text...';

        // Load text into textarea
        if (version.text) {
          textarea.value = version.text;
        } else if (transcript?.text) {
          textarea.value = transcript.text;
          version.text = transcript.text;
        } else if (transcript?.firstLine) {
          textarea.value = transcript.firstLine;
          // Auto-load full text
          if (transcript.r2TranscriptLink) {
            fetch(transcript.r2TranscriptLink).then(r => r.ok ? r.text() : null).then(text => {
              if (text) {
                transcript.text = text;
                if (!version.text) {
                  version.text = text;
                  textarea.value = text;
                }
              }
            }).catch(() => {});
          }
        }

        // Save on change (debounced)
        let saveTimer = null;
        const saveStatus = document.createElement('span');
        saveStatus.className = 'save-status text-secondary';
        textarea.addEventListener('input', () => {
          saveStatus.textContent = 'Unsaved...';
          clearTimeout(saveTimer);
          saveTimer = setTimeout(() => {
            updateVersion(audioId, version.id, { text: textarea.value });
            saveStatus.textContent = 'Saved';
            setTimeout(() => { saveStatus.textContent = ''; }, 2000);
          }, 800);
        });

        contentArea.appendChild(textarea);

        // Info bar below textarea
        const infoBar = document.createElement('div');
        infoBar.style.cssText = 'display:flex;align-items:center;gap:12px;margin-top:6px;flex-wrap:wrap;';
        const typeLabel = document.createElement('span');
        typeLabel.className = `version-type-badge version-type-${version.type}`;
        typeLabel.textContent = version.type;
        infoBar.appendChild(typeLabel);
        if (version.cleanRate) {
          const cr = document.createElement('span');
          cr.className = 'text-secondary';
          cr.textContent = `Clean rate: ${version.cleanRate}%`;
          infoBar.appendChild(cr);
        }
        if (version.alignment) {
          const al = document.createElement('span');
          al.className = 'text-secondary';
          al.textContent = `Avg confidence: ${formatConfidence(version.alignment.avgConfidence)}`;
          infoBar.appendChild(al);
        }
        infoBar.appendChild(saveStatus);

        // "Save as new edited version" button
        const saveAsBtn = document.createElement('button');
        saveAsBtn.className = 'action-btn';
        saveAsBtn.textContent = 'Save as Edited Version';
        saveAsBtn.addEventListener('click', () => {
          const newText = textarea.value;
          if (newText === version.text && version.type === 'edited') return;
          addVersion(audioId, {
            type: 'edited',
            parentVersionId: version.id,
            sourceTranscriptId: version.sourceTranscriptId || manual?.sourceTranscriptId,
            text: newText,
            createdBy: 'user',
          });
          const s = getState();
          const audio = s.audio.find(a => a.id === audioId);
          renderDetailPage(audioId, audio, s, pageContainer);
        });
        infoBar.appendChild(saveAsBtn);

        contentArea.appendChild(infoBar);
      }

      // Build tabs
      for (const v of versions) {
        const tab = document.createElement('button');
        tab.className = 'version-tab';
        tab.dataset.versionId = v.id;
        tab.textContent = v.type.charAt(0).toUpperCase() + v.type.slice(1);
        if (v.id === activeVersionId) tab.classList.add('active');
        tab.addEventListener('click', () => {
          activeVersionId = v.id;
          renderVersionContent(v.id);
        });
        tabBar.appendChild(tab);
      }

      container.appendChild(tabBar);
      container.appendChild(contentArea);
      renderVersionContent(activeVersionId);
    } else if (transcript) {
      // No versions yet, just show text
      const textarea = document.createElement('textarea');
      textarea.className = 'transcript-editor';
      textarea.dir = 'rtl';
      textarea.rows = 12;
      textarea.value = transcript.text || transcript.firstLine || '';
      if (transcript.r2TranscriptLink && !transcript.text) {
        fetch(transcript.r2TranscriptLink).then(r => r.ok ? r.text() : null).then(text => {
          if (text) { transcript.text = text; textarea.value = text; }
        }).catch(() => {});
      }
      container.appendChild(textarea);
    }

    // Action buttons
    const btnBar = document.createElement('div');
    btnBar.style.cssText = 'display:flex;gap:8px;margin-top:12px;';

    const changeBtn = document.createElement('button');
    changeBtn.className = 'action-btn action-btn-primary';
    changeBtn.textContent = 'Change Transcript';
    changeBtn.addEventListener('click', () => {
      renderSearchModal(document.body, getState(), (transcriptId) => {
        linkMatch(audioId, transcriptId, 1.0, 'manual search');
        const s = getState();
        // Reset versions for this audio
        s.transcriptVersions[audioId] = [];
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
      s.transcriptVersions[audioId] = [];
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

    // Row-by-row diff viewer
    renderCleaningDiffViewer(audioId, cleaning, container, pageContainer);
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

function formatTime(seconds) {
  if (seconds == null || isNaN(seconds)) return '0:00';
  const s = Math.round(seconds);
  const m = Math.floor(s / 60);
  const sec = s % 60;
  return m + ':' + String(sec).padStart(2, '0');
}

function renderTrimControls(audioId, playerEl, container) {
  const state = getState();
  const saved = state.trims?.[audioId] || {};
  let trimStart = saved.start || 0;
  let trimEnd = saved.end || 0;
  let duration = 0;
  let trimEndTimerId = null;

  const wrap = document.createElement('div');
  wrap.className = 'trim-controls';

  const slider = document.createElement('div');
  slider.className = 'trim-slider';

  const track = document.createElement('div');
  track.className = 'trim-track';

  const range = document.createElement('div');
  range.className = 'trim-range';

  const handleStart = document.createElement('div');
  handleStart.className = 'trim-handle trim-handle-start';
  handleStart.title = 'Drag to set start trim';

  const handleEnd = document.createElement('div');
  handleEnd.className = 'trim-handle trim-handle-end';
  handleEnd.title = 'Drag to set end trim';

  track.appendChild(range);
  track.appendChild(handleStart);
  track.appendChild(handleEnd);
  slider.appendChild(track);
  wrap.appendChild(slider);

  const timeDisplay = document.createElement('div');
  timeDisplay.className = 'trim-time-display';
  wrap.appendChild(timeDisplay);

  const btnRow = document.createElement('div');
  btnRow.className = 'trim-btn-row';

  const setStartBtn = document.createElement('button');
  setStartBtn.className = 'action-btn';
  setStartBtn.textContent = 'Set Start';

  const setEndBtn = document.createElement('button');
  setEndBtn.className = 'action-btn';
  setEndBtn.textContent = 'Set End';

  const resetBtn = document.createElement('button');
  resetBtn.className = 'action-btn action-btn-danger';
  resetBtn.textContent = 'Reset';

  btnRow.appendChild(setStartBtn);
  btnRow.appendChild(setEndBtn);
  btnRow.appendChild(resetBtn);
  wrap.appendChild(btnRow);
  container.appendChild(wrap);

  function getEffectiveEnd() {
    return trimEnd > 0 ? trimEnd : duration;
  }

  function updateDisplay() {
    const effEnd = getEffectiveEnd();
    const trimDuration = Math.max(0, effEnd - trimStart);
    timeDisplay.textContent = 'Start: ' + formatTime(trimStart) +
      '  |  End: ' + formatTime(effEnd) +
      '  |  Duration: ' + formatTime(trimDuration) +
      (duration > 0 ? '  (of ' + formatTime(duration) + ')' : '');
  }

  function updateSlider() {
    if (duration <= 0) return;
    const startPct = (trimStart / duration) * 100;
    const endPct = ((trimEnd > 0 ? trimEnd : duration) / duration) * 100;
    range.style.left = startPct + '%';
    range.style.width = (endPct - startPct) + '%';
    handleStart.style.left = startPct + '%';
    handleEnd.style.left = endPct + '%';
  }

  function saveTrim() {
    updateState('trims', audioId, { start: trimStart, end: trimEnd });
    updateDisplay();
    updateSlider();
  }

  playerEl.addEventListener('loadedmetadata', () => {
    duration = playerEl.duration;
    if (trimStart > duration) trimStart = 0;
    if (trimEnd > duration) trimEnd = 0;
    updateDisplay();
    updateSlider();
  });

  if (playerEl.duration && isFinite(playerEl.duration)) {
    duration = playerEl.duration;
    if (trimStart > duration) trimStart = 0;
    if (trimEnd > duration) trimEnd = 0;
    updateDisplay();
    updateSlider();
  }

  playerEl.addEventListener('play', () => {
    if (trimStart > 0 && playerEl.currentTime < trimStart) {
      playerEl.currentTime = trimStart;
    }
    startTrimEndCheck();
  });

  playerEl.addEventListener('pause', () => stopTrimEndCheck());
  playerEl.addEventListener('ended', () => stopTrimEndCheck());

  function startTrimEndCheck() {
    stopTrimEndCheck();
    const effEnd = getEffectiveEnd();
    if (effEnd <= 0 || effEnd >= duration) return;
    trimEndTimerId = setInterval(() => {
      if (playerEl.currentTime >= effEnd) {
        playerEl.pause();
        playerEl.currentTime = effEnd;
        stopTrimEndCheck();
      }
    }, 100);
  }

  function stopTrimEndCheck() {
    if (trimEndTimerId) {
      clearInterval(trimEndTimerId);
      trimEndTimerId = null;
    }
  }

  setStartBtn.addEventListener('click', () => {
    trimStart = Math.max(0, playerEl.currentTime);
    if (trimEnd > 0 && trimStart >= trimEnd) trimStart = Math.max(0, trimEnd - 1);
    saveTrim();
  });

  setEndBtn.addEventListener('click', () => {
    trimEnd = Math.min(duration || Infinity, playerEl.currentTime);
    if (trimEnd <= trimStart) trimEnd = trimStart + 1;
    if (trimEnd >= duration) trimEnd = 0;
    saveTrim();
  });

  resetBtn.addEventListener('click', () => {
    trimStart = 0;
    trimEnd = 0;
    saveTrim();
  });

  function makeDraggable(handle, onDrag) {
    let dragging = false;

    function getPos(e) {
      const rect = track.getBoundingClientRect();
      const clientX = e.touches ? e.touches[0].clientX : e.clientX;
      let pct = (clientX - rect.left) / rect.width;
      pct = Math.max(0, Math.min(1, pct));
      return pct * duration;
    }

    function onStart(e) {
      e.preventDefault();
      dragging = true;
      document.addEventListener('mousemove', onMove);
      document.addEventListener('mouseup', onEnd);
      document.addEventListener('touchmove', onMove);
      document.addEventListener('touchend', onEnd);
    }

    function onMove(e) {
      if (!dragging || duration <= 0) return;
      onDrag(getPos(e));
      updateDisplay();
      updateSlider();
    }

    function onEnd() {
      if (!dragging) return;
      dragging = false;
      document.removeEventListener('mousemove', onMove);
      document.removeEventListener('mouseup', onEnd);
      document.removeEventListener('touchmove', onMove);
      document.removeEventListener('touchend', onEnd);
      saveTrim();
    }

    handle.addEventListener('mousedown', onStart);
    handle.addEventListener('touchstart', onStart);
  }

  makeDraggable(handleStart, (pos) => {
    trimStart = Math.max(0, pos);
    const effEnd = trimEnd > 0 ? trimEnd : duration;
    if (trimStart >= effEnd - 1) trimStart = effEnd - 1;
  });

  makeDraggable(handleEnd, (pos) => {
    trimEnd = Math.min(duration, pos);
    if (trimEnd <= trimStart + 1) trimEnd = trimStart + 1;
    if (trimEnd >= duration) trimEnd = 0;
  });

  track.addEventListener('click', (e) => {
    if (duration <= 0) return;
    const rect = track.getBoundingClientRect();
    const pct = (e.clientX - rect.left) / rect.width;
    const time = Math.max(0, Math.min(duration, pct * duration));
    playerEl.currentTime = time;
  });

  updateDisplay();
  updateSlider();
}

function renderCleaningDiffViewer(audioId, cleaning, container, pageContainer) {
  const origLines = (cleaning.originalText || '').split('\n');
  const cleanLines = (cleaning.cleanedText || '').split('\n');
  const maxLen = Math.max(origLines.length, cleanLines.length);

  const rows = [];
  for (let i = 0; i < maxLen; i++) {
    const orig = origLines[i] || '';
    const clean = cleanLines[i] || '';
    const changed = orig !== clean;
    rows.push({ lineNum: i + 1, orig, clean, changed, accepted: true, editedClean: clean });
  }

  const changedCount = rows.filter(r => r.changed).length;
  if (changedCount === 0) return;

  const viewer = document.createElement('div');
  viewer.className = 'diff-viewer';

  // Action bar
  const actions = document.createElement('div');
  actions.className = 'diff-actions';

  const countLabel = document.createElement('span');
  countLabel.className = 'text-secondary';
  countLabel.textContent = changedCount + ' line' + (changedCount !== 1 ? 's' : '') + ' changed';
  actions.appendChild(countLabel);

  const acceptAllBtn = document.createElement('button');
  acceptAllBtn.className = 'action-btn';
  acceptAllBtn.textContent = 'Accept All';
  acceptAllBtn.addEventListener('click', () => {
    rows.forEach(r => { if (r.changed) r.accepted = true; });
    viewer.querySelectorAll('.diff-row-checkbox').forEach(cb => { cb.checked = true; });
  });
  actions.appendChild(acceptAllBtn);

  const rejectAllBtn = document.createElement('button');
  rejectAllBtn.className = 'action-btn action-btn-danger';
  rejectAllBtn.textContent = 'Reject All';
  rejectAllBtn.addEventListener('click', () => {
    rows.forEach(r => { if (r.changed) r.accepted = false; });
    viewer.querySelectorAll('.diff-row-checkbox').forEach(cb => { cb.checked = false; });
  });
  actions.appendChild(rejectAllBtn);

  viewer.appendChild(actions);

  // Rows container
  const rowsContainer = document.createElement('div');
  rowsContainer.className = 'diff-rows-container';

  rows.forEach((row, idx) => {
    const rowEl = document.createElement('div');
    rowEl.className = 'diff-row' + (row.changed ? ' diff-row-changed' : '');

    const lineNum = document.createElement('span');
    lineNum.className = 'diff-row-linenum';
    lineNum.textContent = row.lineNum;
    rowEl.appendChild(lineNum);

    if (row.changed) {
      const cb = document.createElement('input');
      cb.type = 'checkbox';
      cb.className = 'diff-row-checkbox';
      cb.checked = row.accepted;
      cb.addEventListener('change', () => { row.accepted = cb.checked; });
      rowEl.appendChild(cb);

      const origSpan = document.createElement('span');
      origSpan.className = 'diff-original';
      origSpan.dir = 'rtl';
      origSpan.textContent = row.orig || '(empty)';
      rowEl.appendChild(origSpan);

      const arrow = document.createElement('span');
      arrow.className = 'diff-arrow';
      arrow.textContent = '\u2192';
      rowEl.appendChild(arrow);

      if (row.clean) {
        const cleanSpan = document.createElement('span');
        cleanSpan.className = 'diff-cleaned';
        cleanSpan.dir = 'rtl';
        cleanSpan.contentEditable = 'true';
        cleanSpan.textContent = row.clean;
        cleanSpan.addEventListener('blur', () => {
          row.editedClean = cleanSpan.textContent;
        });
        rowEl.appendChild(cleanSpan);
      } else {
        const removed = document.createElement('span');
        removed.className = 'diff-line-removed-label';
        removed.textContent = '(removed)';
        rowEl.appendChild(removed);
      }
    } else {
      const spacer = document.createElement('span');
      spacer.className = 'diff-row-checkbox-spacer';
      rowEl.appendChild(spacer);

      const unchanged = document.createElement('span');
      unchanged.className = 'diff-unchanged';
      unchanged.dir = 'rtl';
      unchanged.textContent = row.orig;
      rowEl.appendChild(unchanged);
    }

    rowsContainer.appendChild(rowEl);
  });

  viewer.appendChild(rowsContainer);

  // Apply bar
  const applyBar = document.createElement('div');
  applyBar.className = 'diff-apply-bar';

  const applyBtn = document.createElement('button');
  applyBtn.className = 'btn btn-secondary';
  applyBtn.textContent = 'Apply Changes';
  applyBtn.addEventListener('click', () => {
    const finalLines = rows.map(r => {
      if (!r.changed) return r.orig;
      return r.accepted ? r.editedClean : r.orig;
    });
    const finalText = finalLines.join('\n');
    addVersion(audioId, {
      type: 'edited',
      text: finalText,
      createdBy: 'user-diff-review',
    });
    const s = getState();
    const audio = s.audio.find(a => a.id === audioId);
    renderDetailPage(audioId, audio, s, pageContainer);
  });
  applyBar.appendChild(applyBtn);
  viewer.appendChild(applyBar);

  container.appendChild(viewer);
}
