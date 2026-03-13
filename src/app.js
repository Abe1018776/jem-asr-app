import { initState, getState, getStatus, getFilteredRows, exportState, importState } from './state.js';
import { renderTable, updateTable, getSelectedRows } from './table.js';
import { renderSuggestedMatches, linkMatch, unlinkMatch, renderSearchModal } from './mapping.js';
import { batchClean } from './cleaning.js';
import { batchAlign } from './alignment.js';
import { renderReviewPanel, approveAll } from './review.js';
import { renderKaraokePlayer } from './karaoke.js';
import { renderAsrConfig, runBenchmark, renderBenchmarkTable } from './benchmark.js';
import { exportCSV } from './utils.js';

const R2_BASE = 'https://audio.kohnai.ai';

// ── App init ────────────────────────────────────────────────────────

document.addEventListener('DOMContentLoaded', async () => {
  const resp = await fetch('/data.json');
  if (!resp.ok) {
    const container = document.getElementById('table-container');
    if (container) {
      container.innerHTML = '<div class="error-banner" style="padding:2rem;text-align:center;color:#f87171;">Failed to load data. Please refresh.</div>';
    }
    return;
  }
  const raw = await resp.json();

  // Transform the mapping-site data.json format into our app format
  // Add unique IDs, merge selected/matched/unmatched into unified arrays
  const selectedNames = new Set((raw.selected || []).map(s => s.audioName));

  // Build unified audio array with IDs
  const audioMap = new Map();
  (raw.allAudio || []).forEach((a, i) => {
    const id = 'a_' + i;
    audioMap.set(a.name, id);
    a.id = id;
    a.driveLink = a.link;
    a.isSelected50hr = selectedNames.has(a.name);
    a.isBenchmark = false; // Will flag benchmark files below
  });

  // Build unified transcript array with IDs and firstLine from matched/selected data
  const firstLines = {};
  (raw.matched || []).forEach(m => {
    if (m.firstLine && m.transcriptName) firstLines[m.transcriptName] = m.firstLine;
  });
  (raw.selected || []).forEach(s => {
    if (s.firstLine && s.transcriptName) firstLines[s.transcriptName] = s.firstLine;
  });

  const transcriptMap = new Map();
  (raw.allTranscripts || []).forEach((t, i) => {
    const id = 't_' + i;
    transcriptMap.set(t.name, id);
    t.id = id;
    t.driveLink = t.link;
    const txtName = t.name.replace(/\.(doc|docx|pdf|rtf|txt)$/i, '.txt');
    t.r2TranscriptLink = `${R2_BASE}/transcripts-txt/${encodeURIComponent(txtName)}`;
    if (!t.firstLine && firstLines[t.name]) t.firstLine = firstLines[t.name];
  });

  // Build pre-existing mappings from matched pairs
  const mappings = {};
  (raw.matched || []).forEach(m => {
    const audioId = audioMap.get(m.audioName);
    const transcriptId = transcriptMap.get(m.transcriptName);
    if (audioId && transcriptId) {
      mappings[audioId] = {
        transcriptId,
        confidence: 0.9,
        matchReason: 'pre-matched',
        confirmedBy: 'imported',
        confirmedAt: raw.generated || new Date().toISOString(),
      };
    }
  });
  // Also map selected pairs (they may not all be in matched)
  (raw.selected || []).forEach(s => {
    const audioId = audioMap.get(s.audioName);
    const transcriptId = transcriptMap.get(s.transcriptName);
    if (audioId && transcriptId && !mappings[audioId]) {
      mappings[audioId] = {
        transcriptId,
        confidence: 0.95,
        matchReason: '50hr-selected',
        confirmedBy: 'imported',
        confirmedAt: raw.generated || new Date().toISOString(),
      };
    }
  });

  // Flag the 5 gold standard benchmark files
  const benchmarkNames = [
    '0015--5711-Tamuz 12 Sicha 1.mp3',       // 5711 Tamuz 12 Sicha
    '0142--5715-Tamuz 13d Sicha 3.mp3',       // 5715 Tamuz 13 Sicha
    '2781--5741-Nissan 11e Mamar.mp3',        // 5741 Nissan 11 Maamar
    '0003--5711-Shvat 10c Mamar.mp3',         // 5711 10 Shevat Maamar (least clear)
    '2925--5742-Kislev 19 Sicha 1.mp3',       // 5742 19 Kislev Sicha (later years)
  ];
  const benchmarkSet = new Set(benchmarkNames);
  (raw.allAudio || []).forEach(a => {
    if (benchmarkSet.has(a.name)) {
      a.isBenchmark = true;
      a.isSelected50hr = false; // Benchmark NEVER in training set
      a.r2Link = `${R2_BASE}/benchmark/${encodeURIComponent(a.name)}`;
    } else if (selectedNames.has(a.name)) {
      a.r2Link = `${R2_BASE}/training/${encodeURIComponent(a.name)}`;
    }
  });

  const data = {
    audio: raw.allAudio || [],
    transcripts: raw.allTranscripts || [],
    preMappings: mappings, // Pass pre-existing mappings to merge
  };
  const state = initState(data);

  // Merge pre-existing mappings (only if no saved mappings exist for those IDs)
  if (data.preMappings) {
    for (const [audioId, mapping] of Object.entries(data.preMappings)) {
      if (!state.mappings[audioId]) {
        state.mappings[audioId] = mapping;
      }
    }
  }

  const tableContainer = document.getElementById('table-container');
  const modalOverlay = document.getElementById('modal-overlay');
  const modalContent = document.getElementById('modal-content');
  const modalClose = document.getElementById('modal-close');

  // ── Modal helpers ───────────────────────────────────────────────

  function openModal() {
    modalOverlay.hidden = false;
  }

  function closeModal() {
    modalOverlay.hidden = true;
    modalContent.innerHTML = '';
  }

  modalClose.addEventListener('click', closeModal);
  modalOverlay.addEventListener('click', (e) => {
    if (e.target === modalOverlay) closeModal();
  });

  // ── Row expand handler ──────────────────────────────────────────

  let expandedRow = null;

  function onRowExpand(audioId) {
    const state = getState();
    const audio = state.audio.find(a => a.id === audioId);
    if (!audio) return;

    // Remove any existing expanded panel (and its wrapper <tr> if present)
    const existingRow = document.querySelector('.expanded-panel-row');
    const existing = existingRow || document.querySelector('.expanded-panel');
    if (existing) {
      if (expandedRow === audioId) {
        existing.remove();
        expandedRow = null;
        return;
      }
      existing.remove();
    }
    expandedRow = audioId;

    const status = getStatus(audioId);
    const panel = document.createElement('div');
    panel.className = 'expanded-panel';

    // ── Always show audio player + transcript ──
    const playerSection = document.createElement('div');
    playerSection.className = 'player-section';

    // Audio player
    const audioUrl = audio.r2Link || audio.driveLink;
    if (audioUrl) {
      const playerEl = document.createElement('audio');
      playerEl.controls = true;
      playerEl.preload = 'none';
      playerEl.src = audioUrl;
      playerEl.className = 'audio-player';
      playerSection.appendChild(playerEl);
    } else {
      const noAudio = document.createElement('div');
      noAudio.className = 'no-audio';
      noAudio.textContent = 'No audio URL available';
      playerSection.appendChild(noAudio);
    }

    // Transcript display
    const mapping = state.mappings[audioId];
    if (mapping) {
      const transcript = state.transcripts.find(t => t.id === mapping.transcriptId);
      if (transcript) {
        const transcriptDiv = document.createElement('div');
        transcriptDiv.className = 'transcript-section';

        const tHeader = document.createElement('div');
        tHeader.className = 'transcript-header';
        tHeader.innerHTML = `<strong>Transcript:</strong> ${transcript.name}`;
        if (transcript.driveLink) {
          const viewLink = document.createElement('a');
          viewLink.href = transcript.driveLink;
          viewLink.target = '_blank';
          viewLink.className = 'transcript-link';
          viewLink.textContent = ' Open in Drive ↗';
          tHeader.appendChild(viewLink);
        }
        transcriptDiv.appendChild(tHeader);

        // Show first line / cleaned text
        const textContent = state.cleaning[audioId]?.cleanedText
          || transcript.firstLine
          || '';
        if (textContent) {
          const textDiv = document.createElement('div');
          textDiv.className = 'transcript-text';
          textDiv.dir = 'rtl';
          textDiv.textContent = textContent;
          transcriptDiv.appendChild(textDiv);
        }
        playerSection.appendChild(transcriptDiv);
      }
    }

    panel.appendChild(playerSection);

    // ── Status-specific content below player ──
    if (audio.isBenchmark) {
      // Benchmark row: show benchmark results + config
      const configBtn = document.createElement('button');
      configBtn.className = 'bulk-btn';
      configBtn.textContent = 'Configure ASR Models';
      configBtn.addEventListener('click', () => {
        modalContent.innerHTML = '';
        renderAsrConfig(modalContent, getState());
        openModal();
      });
      panel.appendChild(configBtn);

      const runBtn = document.createElement('button');
      runBtn.className = 'bulk-btn';
      runBtn.textContent = 'Run Benchmark';
      runBtn.addEventListener('click', async () => {
        const benchmarkIds = state.audio.filter(a => a.isBenchmark).map(a => a.id);
        const progress = document.createElement('div');
        progress.className = 'progress-bar';
        progress.textContent = 'Starting benchmark...';
        panel.appendChild(progress);
        try {
          await runBenchmark(benchmarkIds, getState(), (done, total) => {
            progress.textContent = `Benchmarking ${done} / ${total}...`;
          });
          progress.textContent = 'Benchmark complete.';
        } catch (err) {
          progress.textContent = 'Error: ' + err.message;
        }
        renderBenchmarkTable(resultsDiv, getState());
      });
      panel.appendChild(runBtn);

      const resultsDiv = document.createElement('div');
      resultsDiv.className = 'benchmark-results';
      renderBenchmarkTable(resultsDiv, getState());
      panel.appendChild(resultsDiv);

      // CRITICAL: No approve button for benchmark rows
    } else if (status === 'unmapped') {
      // Show mapping suggestions
      const suggestionsDiv = document.createElement('div');
      suggestionsDiv.className = 'suggestions-container';
      renderSuggestedMatches(audioId, suggestionsDiv, state, (aId, tId) => {
        linkMatch(aId, tId, 0.8, 'user selected');
        updateTable();
        onRowExpand(aId); // Re-render expanded panel
      });

      const searchBtn = document.createElement('button');
      searchBtn.className = 'bulk-btn';
      searchBtn.textContent = 'Search Transcripts';
      searchBtn.addEventListener('click', () => {
        renderSearchModal(document.body, getState(), (transcriptId) => {
          linkMatch(audioId, transcriptId, 1.0, 'manual search');
          updateTable();
        });
      });

      panel.appendChild(suggestionsDiv);
      panel.appendChild(searchBtn);
    } else if (status === 'aligned' || status === 'approved') {
      // Show review panel
      renderReviewPanel(audioId, state, panel, {
        onApprove: () => {
          updateTable();
          expandedRow = null;
        },
        onReject: () => {
          updateTable();
          expandedRow = null;
        },
        onSkip: () => {
          expandedRow = null;
          const existingRow = document.querySelector('.expanded-panel-row');
          if (existingRow) { existingRow.remove(); return; }
          const existing = document.querySelector('.expanded-panel');
          if (existing) existing.remove();
        },
      });

      // Karaoke button for aligned rows
      if (state.alignments[audioId]) {
        const karaokeBtn = document.createElement('button');
        karaokeBtn.className = 'bulk-btn';
        karaokeBtn.textContent = 'Karaoke Player';
        karaokeBtn.addEventListener('click', () => {
          renderKaraokePlayer(audioId, getState());
        });
        panel.appendChild(karaokeBtn);
      }
    } else {
      // mapped or cleaned: show basic info + karaoke if aligned
      const info = document.createElement('div');
      info.className = 'expanded-info';
      info.textContent = `Status: ${status}`;
      panel.appendChild(info);

      if (state.alignments[audioId]) {
        const karaokeBtn = document.createElement('button');
        karaokeBtn.className = 'bulk-btn';
        karaokeBtn.textContent = 'Karaoke Player';
        karaokeBtn.addEventListener('click', () => {
          renderKaraokePlayer(audioId, getState());
        });
        panel.appendChild(karaokeBtn);
      }
    }

    // ── Mapping controls (available on ALL non-benchmark rows) ──
    if (!audio.isBenchmark) {
      const mappingBar = document.createElement('div');
      mappingBar.className = 'mapping-bar';
      mappingBar.style.cssText = 'display:flex;gap:8px;align-items:center;padding:12px 0;border-top:1px solid var(--border);margin-top:12px;flex-wrap:wrap;';

      const currentMapping = state.mappings[audioId];
      if (currentMapping) {
        const transcript = state.transcripts.find(t => t.id === currentMapping.transcriptId);
        const label = document.createElement('span');
        label.className = 'text-secondary';
        label.style.fontSize = '0.85rem';
        label.textContent = `Linked to: ${transcript ? transcript.name : currentMapping.transcriptId}`;
        mappingBar.appendChild(label);

        const unlinkBtn = document.createElement('button');
        unlinkBtn.className = 'action-btn action-btn-danger';
        unlinkBtn.textContent = 'Unlink';
        unlinkBtn.addEventListener('click', (e) => {
          e.stopPropagation();
          unlinkMatch(audioId);
          // Also clear downstream data
          if (state.cleaning[audioId]) delete state.cleaning[audioId];
          if (state.alignments[audioId]) delete state.alignments[audioId];
          if (state.reviews[audioId]) delete state.reviews[audioId];
          updateTable();
          onRowExpand(audioId);
        });
        mappingBar.appendChild(unlinkBtn);
      }

      const changeBtn = document.createElement('button');
      changeBtn.className = 'action-btn action-btn-primary';
      changeBtn.textContent = currentMapping ? 'Change Transcript' : 'Link Transcript';
      changeBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        renderSearchModal(document.body, getState(), (transcriptId) => {
          linkMatch(audioId, transcriptId, 1.0, 'manual search');
          // Clear downstream data when re-mapping
          if (state.cleaning[audioId]) delete state.cleaning[audioId];
          if (state.alignments[audioId]) delete state.alignments[audioId];
          if (state.reviews[audioId]) delete state.reviews[audioId];
          updateTable();
          onRowExpand(audioId);
        });
      });
      mappingBar.appendChild(changeBtn);

      panel.appendChild(mappingBar);
    }

    // Insert panel after the clicked row, wrapped in a <tr><td> for valid HTML
    const targetRow = tableContainer.querySelector(`tr[data-audio-id="${audioId}"]`);
    if (targetRow) {
      const wrapperTr = document.createElement('tr');
      wrapperTr.className = 'expanded-panel-row';
      const wrapperTd = document.createElement('td');
      const colCount = targetRow.children.length;
      wrapperTd.colSpan = colCount;
      wrapperTd.style.padding = '0';
      wrapperTd.appendChild(panel);
      wrapperTr.appendChild(wrapperTd);
      targetRow.after(wrapperTr);
    } else {
      tableContainer.appendChild(panel);
    }
  }

  // ── Render table ────────────────────────────────────────────────

  renderTable(tableContainer, {
    onRowExpand,
    onRowSelect: (ids) => {
      // Selection count is handled by table.js
    },
  });

  // ── Bulk actions ────────────────────────────────────────────────

  document.getElementById('btn-clean-selected').addEventListener('click', async () => {
    const selected = getSelectedRows();
    if (selected.length === 0) return;

    const bar = document.getElementById('bulk-selection-count');
    const originalText = bar.textContent;

    await batchClean(selected, getState(), (done, total, elapsed) => {
      bar.textContent = `Cleaning ${done} / ${total}${elapsed ? ` (${elapsed}s)` : ''}...`;
    });

    bar.textContent = originalText;
    updateTable();
  });

  document.getElementById('btn-align-selected').addEventListener('click', async () => {
    const selected = getSelectedRows();
    if (selected.length === 0) return;

    const bar = document.getElementById('bulk-selection-count');
    const originalText = bar.textContent;

    await batchAlign(selected, getState(), (done, total, elapsed) => {
      bar.textContent = `Aligning ${done} / ${total} (${elapsed}s)...`;
    });

    bar.textContent = originalText;
    updateTable();
  });

  document.getElementById('btn-approve-selected').addEventListener('click', () => {
    const selected = getSelectedRows();
    if (selected.length === 0) return;
    // Filter out benchmark rows — they cannot be approved
    const state = getState();
    const nonBenchmark = selected.filter(id => {
      const audio = state.audio.find(a => a.id === id);
      return audio && !audio.isBenchmark;
    });
    if (nonBenchmark.length === 0) return;
    approveAll(nonBenchmark, state);
    updateTable();
  });

  // ── Export / Import ─────────────────────────────────────────────

  document.getElementById('btn-export-state').addEventListener('click', () => {
    exportState();
  });

  const importFileInput = document.getElementById('import-file-input');
  document.getElementById('btn-import-state').addEventListener('click', () => {
    importFileInput.click();
  });
  importFileInput.addEventListener('change', async (e) => {
    const file = e.target.files[0];
    if (!file) return;
    try {
      await importState(file);
      updateTable();
    } catch (err) {
      console.error('Import failed:', err);
    }
    importFileInput.value = '';
  });

  document.getElementById('btn-export-csv').addEventListener('click', () => {
    const state = getState();
    const approved = state.audio.filter(a => {
      return getStatus(a.id) === 'approved' && !a.isBenchmark;
    });
    if (approved.length === 0) return;

    const columns = [
      { label: 'Audio ID', key: 'id' },
      { label: 'Audio Name', key: 'name' },
      { label: 'Year', key: 'year' },
      { label: 'Type', key: 'type' },
      { label: 'Audio URL', value: (row) => row.r2Link || row.driveLink || '' },
      { label: 'Transcript', value: (row) => {
        const m = state.mappings[row.id];
        const t = m ? state.transcripts.find(x => x.id === m.transcriptId) : null;
        return t ? t.name : '';
      }},
      { label: 'Cleaned Text', value: (row) => state.cleaning[row.id]?.cleanedText || '' },
      { label: 'Avg Confidence', value: (row) => {
        const a = state.alignments[row.id];
        return a ? Math.round(a.avgConfidence * 100) + '%' : '';
      }},
    ];
    exportCSV(approved, columns);
  });

  // ── Keyboard shortcuts ──────────────────────────────────────────

  document.addEventListener('keydown', (e) => {
    // Don't intercept when typing in inputs
    const tag = e.target.tagName;
    if (tag === 'INPUT' || tag === 'TEXTAREA' || e.target.isContentEditable) {
      if (e.key === 'Escape') {
        e.target.blur();
        closeModal();
      }
      return;
    }

    if (e.key === '/') {
      e.preventDefault();
      document.getElementById('search-input')?.focus();
    } else if (e.key === 'Escape') {
      closeModal();
      const panelRow = document.querySelector('.expanded-panel-row');
      if (panelRow) {
        panelRow.remove();
        expandedRow = null;
      } else {
        const panel = document.querySelector('.expanded-panel');
        if (panel) {
          panel.remove();
          expandedRow = null;
        }
      }
    } else if (e.key === 'a' && (e.ctrlKey || e.metaKey)) {
      e.preventDefault();
      // Select all visible rows — trigger select-all checkbox
      const selectAll = tableContainer.querySelector('.select-all-cb');
      if (selectAll && !selectAll.checked) {
        selectAll.checked = true;
        selectAll.dispatchEvent(new Event('change'));
      }
    } else if (e.key === 'e' && (e.ctrlKey || e.metaKey) && !e.shiftKey) {
      e.preventDefault();
      exportState();
    } else if (e.key === 'E' && (e.ctrlKey || e.metaKey) && e.shiftKey) {
      e.preventDefault();
      document.getElementById('btn-export-csv')?.click();
    }
  });
});
