import { getState, updateState } from './state.js';
import { calculateWER, normalizeYiddish } from './utils.js';

// ── ASR Config Modal ────────────────────────────────────────────────

export function renderAsrConfig(container, state) {
  container.innerHTML = '';
  const wrapper = document.createElement('div');
  wrapper.className = 'asr-config-panel';

  const title = document.createElement('h2');
  title.textContent = 'ASR Model Configuration';
  wrapper.appendChild(title);

  const models = state.asrModels || [];

  models.forEach((model, idx) => {
    wrapper.appendChild(buildModelForm(model, idx, container));
  });

  // Add new model button
  const addBtn = document.createElement('button');
  addBtn.className = 'bulk-btn';
  addBtn.textContent = '+ Add Model';
  addBtn.addEventListener('click', () => {
    const s = getState();
    s.asrModels = s.asrModels || [];
    s.asrModels.push({ name: '', endpoint: '', apiKey: '', requestTemplate: {} });
    updateState('asrModels', null, s.asrModels);
    renderAsrConfig(container, getState());
  });
  wrapper.appendChild(addBtn);

  container.appendChild(wrapper);
}

function buildModelForm(model, idx, rootContainer) {
  const form = document.createElement('div');
  form.className = 'asr-model-form';

  const fields = [
    { key: 'name', label: 'Model Name', type: 'text', placeholder: 'e.g. Whisper Large v3' },
    { key: 'endpoint', label: 'API Endpoint', type: 'url', placeholder: 'https://api.example.com/transcribe' },
    { key: 'apiKey', label: 'API Key', type: 'password', placeholder: 'sk-...' },
    { key: 'requestTemplate', label: 'Request Template (JSON)', type: 'textarea', placeholder: '{"model": "whisper-1", "language": "yi"}' },
  ];

  fields.forEach(f => {
    const label = document.createElement('label');
    label.className = 'asr-form-label';
    label.textContent = f.label;

    let input;
    if (f.type === 'textarea') {
      input = document.createElement('textarea');
      input.className = 'asr-form-input asr-form-textarea';
      input.rows = 3;
      input.value = typeof model[f.key] === 'object' ? JSON.stringify(model[f.key], null, 2) : (model[f.key] || '');
    } else {
      input = document.createElement('input');
      input.type = f.type;
      input.className = 'asr-form-input';
      input.value = model[f.key] || '';
    }
    input.placeholder = f.placeholder;

    input.addEventListener('change', () => {
      const s = getState();
      if (f.key === 'requestTemplate') {
        try {
          s.asrModels[idx][f.key] = JSON.parse(input.value);
        } catch {
          s.asrModels[idx][f.key] = {};
        }
      } else {
        s.asrModels[idx][f.key] = input.value;
      }
      updateState('asrModels', null, s.asrModels);
    });

    label.appendChild(input);
    form.appendChild(label);
  });

  const btnRow = document.createElement('div');
  btnRow.className = 'asr-form-buttons';

  const deleteBtn = document.createElement('button');
  deleteBtn.className = 'bulk-btn asr-delete-btn';
  deleteBtn.textContent = 'Delete Model';
  deleteBtn.addEventListener('click', () => {
    const s = getState();
    s.asrModels.splice(idx, 1);
    updateState('asrModels', null, s.asrModels);
    renderAsrConfig(rootContainer, getState());
  });

  btnRow.appendChild(deleteBtn);
  form.appendChild(btnRow);

  return form;
}

// ── Run Benchmark ───────────────────────────────────────────────────

export async function runBenchmark(benchmarkAudioIds, state, onProgress) {
  const models = state.asrModels || [];
  if (models.length === 0) {
    throw new Error('No ASR models configured. Add models in the benchmark config panel.');
  }

  const benchmarkAudios = state.audio.filter(a => benchmarkAudioIds.includes(a.id));
  const total = benchmarkAudios.length * models.length;
  let completed = 0;

  for (const audio of benchmarkAudios) {
    const mapping = state.mappings[audio.id];
    const transcript = mapping
      ? state.transcripts.find(t => t.id === mapping.transcriptId)
      : null;
    const goldTranscript = transcript?.firstLine || '';

    if (!state.benchmarks[audio.id]) {
      state.benchmarks[audio.id] = { results: [] };
    }

    const audioUrl = audio.r2Link || audio.driveLink;
    let audioBlob;
    try {
      const resp = await fetch(audioUrl);
      audioBlob = await resp.blob();
    } catch (err) {
      console.error(`Failed to fetch audio for ${audio.name}:`, err);
      completed += models.length;
      if (onProgress) onProgress(completed, total);
      continue;
    }

    for (const model of models) {
      try {
        const asrTranscript = await sendToAsrModel(audioBlob, model);
        const werResult = calculateWER(goldTranscript, asrTranscript);

        const result = {
          model: model.name,
          transcript: asrTranscript,
          wer: werResult.wer,
          cer: werResult.cer,
          substitutions: werResult.substitutions,
          insertions: werResult.insertions,
          deletions: werResult.deletions,
          total: werResult.total,
          ranAt: new Date().toISOString(),
        };

        state.benchmarks[audio.id].results.push(result);
        updateState('benchmarks', audio.id, state.benchmarks[audio.id]);
      } catch (err) {
        console.error(`Benchmark failed for ${audio.name} with ${model.name}:`, err);
      }

      completed++;
      if (onProgress) onProgress(completed, total);
    }
  }
}

async function sendToAsrModel(audioBlob, model) {
  const formData = new FormData();
  formData.append('file', audioBlob, 'audio.mp3');

  const template = model.requestTemplate || {};
  for (const [key, value] of Object.entries(template)) {
    formData.append(key, value);
  }

  const headers = {};
  if (model.apiKey) {
    headers['Authorization'] = `Bearer ${model.apiKey}`;
  }

  const resp = await fetch(model.endpoint, {
    method: 'POST',
    headers,
    body: formData,
  });

  if (!resp.ok) {
    throw new Error(`ASR API error: ${resp.status} ${resp.statusText}`);
  }

  const data = await resp.json();
  return data.text || data.transcript || data.full_text || JSON.stringify(data);
}

// ── Benchmark Comparison Table ──────────────────────────────────────

export function renderBenchmarkTable(container, state) {
  container.innerHTML = '';

  const benchmarkAudios = (state.audio || []).filter(a => a.isBenchmark);
  const benchmarks = state.benchmarks || {};

  if (benchmarkAudios.length === 0) {
    container.innerHTML = '<p class="empty-message">No benchmark audio files found.</p>';
    return;
  }

  const hasResults = benchmarkAudios.some(a => benchmarks[a.id]?.results?.length > 0);
  if (!hasResults) {
    container.innerHTML = '<p class="empty-message">No benchmark results yet. Configure ASR models and run benchmark.</p>';
    return;
  }

  // Collect unique model names from results
  const modelNames = new Set();
  for (const audio of benchmarkAudios) {
    const results = benchmarks[audio.id]?.results || [];
    results.forEach(r => modelNames.add(r.model));
  }
  const modelList = [...modelNames];

  const table = document.createElement('table');
  table.className = 'data-table benchmark-table';

  // Header row with model names
  const thead = document.createElement('thead');
  const headerRow = document.createElement('tr');
  headerRow.innerHTML = '<th>Benchmark File</th>';
  modelList.forEach(name => {
    const th = document.createElement('th');
    th.textContent = name;
    th.colSpan = 2;
    headerRow.appendChild(th);
  });
  thead.appendChild(headerRow);

  // Sub-header for WER/CER
  const subRow = document.createElement('tr');
  subRow.innerHTML = '<th></th>';
  modelList.forEach(() => {
    const werTh = document.createElement('th');
    werTh.textContent = 'WER';
    const cerTh = document.createElement('th');
    cerTh.textContent = 'CER';
    subRow.appendChild(werTh);
    subRow.appendChild(cerTh);
  });
  thead.appendChild(subRow);
  table.appendChild(thead);

  // Body
  const tbody = document.createElement('tbody');
  benchmarkAudios.forEach(audio => {
    const tr = document.createElement('tr');
    const nameTd = document.createElement('td');
    nameTd.textContent = audio.name;
    tr.appendChild(nameTd);

    const results = benchmarks[audio.id]?.results || [];
    // Latest result per model
    const latestByModel = {};
    results.forEach(r => { latestByModel[r.model] = r; });

    // Find best WER for this row
    let bestWer = Infinity;
    modelList.forEach(name => {
      const r = latestByModel[name];
      if (r && r.wer < bestWer) bestWer = r.wer;
    });

    modelList.forEach(name => {
      const r = latestByModel[name];
      const werTd = document.createElement('td');
      const cerTd = document.createElement('td');

      if (r) {
        werTd.textContent = (r.wer * 100).toFixed(1) + '%';
        cerTd.textContent = (r.cer * 100).toFixed(1) + '%';

        if (r.wer === bestWer) {
          werTd.classList.add('best-score');
        }

        // Delta arrows from previous run
        const allRuns = results.filter(x => x.model === name);
        if (allRuns.length >= 2) {
          const prev = allRuns[allRuns.length - 2];
          const delta = r.wer - prev.wer;
          if (delta !== 0) {
            const arrow = document.createElement('span');
            arrow.className = delta < 0 ? 'delta-improved' : 'delta-worse';
            arrow.textContent = delta < 0 ? ' \u2193' : ' \u2191';
            werTd.appendChild(arrow);
          }
        }

        // Click to expand word errors
        werTd.classList.add('expandable-cell');
        werTd.addEventListener('click', () => {
          const next = tr.nextElementSibling;
          if (next && next.classList.contains('word-error-row')) {
            next.remove();
            return;
          }
          const detailRow = document.createElement('tr');
          detailRow.className = 'word-error-row';
          const detailTd = document.createElement('td');
          detailTd.colSpan = 1 + modelList.length * 2;
          renderWordErrors(r, detailTd);
          detailRow.appendChild(detailTd);
          tr.parentNode.insertBefore(detailRow, tr.nextSibling);
        });
      } else {
        werTd.textContent = '--';
        cerTd.textContent = '--';
      }

      tr.appendChild(werTd);
      tr.appendChild(cerTd);
    });

    tbody.appendChild(tr);
  });
  table.appendChild(tbody);
  container.appendChild(table);
}

// ── Word Error View ─────────────────────────────────────────────────

export function renderWordErrors(result, container) {
  container.innerHTML = '';

  if (!result || !result.transcript) {
    container.textContent = 'No transcript data available.';
    return;
  }

  // Find gold transcript for this result
  const state = getState();
  const benchmarkAudios = (state.audio || []).filter(a => a.isBenchmark);
  let goldText = '';
  for (const audio of benchmarkAudios) {
    const runs = state.benchmarks[audio.id]?.results || [];
    if (runs.some(r => r === result)) {
      const mapping = state.mappings[audio.id];
      const transcript = mapping ? state.transcripts.find(t => t.id === mapping.transcriptId) : null;
      goldText = transcript?.firstLine || '';
      break;
    }
  }

  const refNorm = normalizeYiddish(goldText);
  const hypNorm = normalizeYiddish(result.transcript);
  const refWords = refNorm.split(/\s+/).filter(Boolean);
  const hypWords = hypNorm.split(/\s+/).filter(Boolean);

  // Levenshtein with backtrace for word-level display
  const n = refWords.length;
  const m = hypWords.length;
  const dp = Array.from({ length: n + 1 }, () => new Array(m + 1).fill(0));
  for (let i = 0; i <= n; i++) dp[i][0] = i;
  for (let j = 0; j <= m; j++) dp[0][j] = j;
  for (let i = 1; i <= n; i++) {
    for (let j = 1; j <= m; j++) {
      if (refWords[i - 1] === hypWords[j - 1]) {
        dp[i][j] = dp[i - 1][j - 1];
      } else {
        dp[i][j] = 1 + Math.min(dp[i - 1][j - 1], dp[i - 1][j], dp[i][j - 1]);
      }
    }
  }

  const ops = [];
  let i = n, j = m;
  while (i > 0 || j > 0) {
    if (i > 0 && j > 0 && refWords[i - 1] === hypWords[j - 1]) {
      ops.unshift({ type: 'C', ref: refWords[i - 1], hyp: hypWords[j - 1] });
      i--; j--;
    } else if (i > 0 && j > 0 && dp[i][j] === dp[i - 1][j - 1] + 1) {
      ops.unshift({ type: 'S', ref: refWords[i - 1], hyp: hypWords[j - 1] });
      i--; j--;
    } else if (i > 0 && dp[i][j] === dp[i - 1][j] + 1) {
      ops.unshift({ type: 'D', ref: refWords[i - 1], hyp: null });
      i--;
    } else {
      ops.unshift({ type: 'I', ref: null, hyp: hypWords[j - 1] });
      j--;
    }
  }

  const wrapper = document.createElement('div');
  wrapper.className = 'word-errors-view';
  wrapper.dir = 'rtl';

  const legend = document.createElement('div');
  legend.className = 'word-error-legend';
  legend.innerHTML = '<span class="word-correct">Correct</span> <span class="word-sub">Substitution</span> <span class="word-ins">Insertion</span> <span class="word-del">Deletion</span>';
  wrapper.appendChild(legend);

  const wordGrid = document.createElement('div');
  wordGrid.className = 'word-error-grid';

  ops.forEach(op => {
    const chip = document.createElement('span');
    chip.className = 'word-error-chip';

    switch (op.type) {
      case 'C':
        chip.classList.add('word-correct');
        chip.textContent = op.ref;
        break;
      case 'S':
        chip.classList.add('word-sub');
        chip.textContent = op.hyp;
        chip.title = `Expected: ${op.ref}`;
        break;
      case 'I':
        chip.classList.add('word-ins');
        chip.textContent = op.hyp;
        chip.title = 'Inserted (extra word)';
        break;
      case 'D':
        chip.classList.add('word-del');
        chip.textContent = op.ref;
        chip.title = 'Deleted (missing word)';
        break;
    }

    wordGrid.appendChild(chip);
  });

  wrapper.appendChild(wordGrid);
  container.appendChild(wrapper);
}
