export function renderKaraokePlayer(audioId, state) {
  const entry = state.audio.find(a => a.id === audioId);
  const alignment = state.alignments[audioId];
  if (!entry || !alignment || !alignment.words) return;

  const audioUrl = entry.r2Link || entry.driveLink;
  if (!audioUrl) return;

  const words = alignment.words;

  // Create modal overlay
  const overlay = document.createElement('div');
  overlay.className = 'modal-overlay karaoke-overlay';

  const modal = document.createElement('div');
  modal.className = 'modal karaoke-modal';

  // Close button
  const closeBtn = document.createElement('button');
  closeBtn.className = 'modal-close';
  closeBtn.textContent = '\u00D7';
  closeBtn.addEventListener('click', () => overlay.remove());

  // Title
  const title = document.createElement('h3');
  title.className = 'karaoke-title';
  title.textContent = entry.name || audioId;

  // Audio element
  const audio = document.createElement('audio');
  audio.controls = true;
  audio.src = audioUrl;
  audio.className = 'karaoke-audio';

  // Speed controls
  const speedBar = document.createElement('div');
  speedBar.className = 'karaoke-speed-bar';
  const speeds = [0.5, 1, 1.5, 2];
  speeds.forEach(speed => {
    const btn = document.createElement('button');
    btn.className = 'speed-btn' + (speed === 1 ? ' active' : '');
    btn.textContent = speed + 'x';
    btn.addEventListener('click', () => {
      audio.playbackRate = speed;
      speedBar.querySelectorAll('.speed-btn').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
    });
    speedBar.appendChild(btn);
  });

  // Export buttons
  const exportBar = document.createElement('div');
  exportBar.className = 'karaoke-export-bar';

  const srtBtn = document.createElement('button');
  srtBtn.className = 'btn btn-secondary';
  srtBtn.textContent = 'Export SRT';
  srtBtn.addEventListener('click', () => {
    const content = exportSRT(words);
    downloadFile(content, (entry.name || audioId).replace(/\.[^.]+$/, '') + '.srt', 'text/plain');
  });

  const vttBtn = document.createElement('button');
  vttBtn.className = 'btn btn-secondary';
  vttBtn.textContent = 'Export VTT';
  vttBtn.addEventListener('click', () => {
    const content = exportVTT(words);
    downloadFile(content, (entry.name || audioId).replace(/\.[^.]+$/, '') + '.vtt', 'text/vtt');
  });

  exportBar.appendChild(srtBtn);
  exportBar.appendChild(vttBtn);

  // Word chip grid
  const wordGrid = document.createElement('div');
  wordGrid.className = 'karaoke-word-grid';
  wordGrid.dir = 'rtl';

  const chipEls = [];
  words.forEach((w, idx) => {
    const span = document.createElement('span');
    const level = w.confidence >= 0.8 ? 'high' : w.confidence >= 0.4 ? 'mid' : 'low';
    span.className = `word-chip confidence-${level}`;
    span.textContent = w.word;
    span.dataset.start = w.start;
    span.dataset.end = w.end;
    span.dataset.confidence = w.confidence;
    span.dataset.idx = idx;
    span.addEventListener('click', () => {
      audio.currentTime = w.start;
      if (audio.paused) audio.play();
    });
    wordGrid.appendChild(span);
    chipEls.push(span);
  });

  // Timeupdate: highlight current word
  let prevActive = null;
  audio.addEventListener('timeupdate', () => {
    const t = audio.currentTime;
    let activeIdx = -1;
    for (let i = 0; i < words.length; i++) {
      if (t >= words[i].start && t < words[i].end) {
        activeIdx = i;
        break;
      }
    }
    if (prevActive !== null && prevActive !== activeIdx) {
      chipEls[prevActive]?.classList.remove('active');
    }
    if (activeIdx >= 0 && activeIdx !== prevActive) {
      chipEls[activeIdx].classList.add('active');
      chipEls[activeIdx].scrollIntoView({ block: 'nearest', behavior: 'smooth' });
    }
    prevActive = activeIdx;
  });

  // Assemble modal
  modal.appendChild(closeBtn);
  modal.appendChild(title);
  modal.appendChild(audio);
  modal.appendChild(speedBar);
  modal.appendChild(exportBar);
  modal.appendChild(wordGrid);
  overlay.appendChild(modal);

  // Escape to close
  const onKey = (e) => {
    if (e.key === 'Escape') {
      overlay.remove();
      document.removeEventListener('keydown', onKey);
    }
  };
  document.addEventListener('keydown', onKey);

  // Click backdrop to close
  overlay.addEventListener('click', (e) => {
    if (e.target === overlay) overlay.remove();
  });

  document.body.appendChild(overlay);
}

export function exportSRT(words) {
  if (!words || words.length === 0) return '';
  const segments = groupSegments(words);
  const lines = [];
  segments.forEach((seg, i) => {
    lines.push(String(i + 1));
    lines.push(`${fmtSRT(seg.start)} --> ${fmtSRT(seg.end)}`);
    lines.push(seg.text);
    lines.push('');
  });
  return lines.join('\n');
}

export function exportVTT(words) {
  if (!words || words.length === 0) return '';
  const segments = groupSegments(words);
  const lines = ['WEBVTT', ''];
  segments.forEach((seg, i) => {
    lines.push(String(i + 1));
    lines.push(`${fmtVTT(seg.start)} --> ${fmtVTT(seg.end)}`);
    lines.push(seg.text);
    lines.push('');
  });
  return lines.join('\n');
}

export function downloadFile(content, filename, mimeType) {
  const blob = new Blob([content], { type: mimeType || 'text/plain' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

function groupSegments(words) {
  const segments = [];
  let current = null;

  for (const w of words) {
    if (!current) {
      current = { start: w.start, end: w.end, wordList: [w.word] };
    } else if (w.start - current.end > 0.5) {
      current.text = current.wordList.join(' ');
      segments.push(current);
      current = { start: w.start, end: w.end, wordList: [w.word] };
    } else {
      current.end = w.end;
      current.wordList.push(w.word);
    }
  }
  if (current) {
    current.text = current.wordList.join(' ');
    segments.push(current);
  }
  return segments;
}

function fmtSRT(seconds) {
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = Math.floor(seconds % 60);
  const ms = Math.round((seconds % 1) * 1000);
  return `${p(h)}:${p(m)}:${p(s)},${String(ms).padStart(3, '0')}`;
}

function fmtVTT(seconds) {
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = Math.floor(seconds % 60);
  const ms = Math.round((seconds % 1) * 1000);
  return `${p(h)}:${p(m)}:${p(s)}.${String(ms).padStart(3, '0')}`;
}

function p(n) {
  return String(n).padStart(2, '0');
}
