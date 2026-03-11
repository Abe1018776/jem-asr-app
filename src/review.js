import { updateState } from './state.js';

export function renderReviewPanel(audioId, state, container, callbacks) {
  const entry = state.audio.find(a => a.id === audioId);
  const cleaning = state.cleaning[audioId];
  const alignment = state.alignments[audioId];
  const mapping = state.mappings[audioId];
  if (!entry) return;

  container.innerHTML = '';
  const panel = document.createElement('div');
  panel.className = 'review-panel';

  // Summary bar
  const summary = document.createElement('div');
  summary.className = 'review-summary';
  const cleanRate = cleaning ? cleaning.cleanRate : '--';
  const avgConf = alignment ? Math.round(alignment.avgConfidence * 100) : '--';
  const lowCount = alignment ? alignment.lowConfidenceCount : '--';

  summary.innerHTML = `
    <span class="review-summary-item"><strong>${entry.name}</strong></span>
    <span class="review-summary-item">Clean rate: <strong>${cleanRate}%</strong></span>
    <span class="review-summary-item">Avg confidence: <strong>${avgConf}%</strong></span>
    <span class="review-summary-item">Low confidence words: <strong>${lowCount}</strong></span>
  `;
  panel.appendChild(summary);

  // Diff view
  const diffSection = document.createElement('div');
  diffSection.className = 'review-diff';

  const originalText = cleaning ? cleaning.originalText : '';
  const cleanedText = cleaning ? cleaning.cleanedText : '';
  const originalWords = originalText.split(/\s+/).filter(Boolean);
  const cleanedWords = cleanedText.split(/\s+/).filter(Boolean);
  const cleanedSet = new Set(cleanedWords);

  // Original text with removed words highlighted
  const origDiv = document.createElement('div');
  origDiv.className = 'review-diff-col';
  origDiv.dir = 'rtl';
  const origLabel = document.createElement('div');
  origLabel.className = 'review-diff-label';
  origLabel.textContent = 'Original';
  origDiv.appendChild(origLabel);

  const origContent = document.createElement('div');
  origContent.className = 'review-diff-content';
  originalWords.forEach(word => {
    const span = document.createElement('span');
    if (!cleanedSet.has(word)) {
      span.className = 'diff-removed';
    }
    span.textContent = word + ' ';
    origContent.appendChild(span);
  });
  origDiv.appendChild(origContent);

  // Cleaned text with confidence-colored word chips
  const cleanDiv = document.createElement('div');
  cleanDiv.className = 'review-diff-col';
  cleanDiv.dir = 'rtl';
  const cleanLabel = document.createElement('div');
  cleanLabel.className = 'review-diff-label';
  cleanLabel.textContent = 'Cleaned';
  cleanDiv.appendChild(cleanLabel);

  const cleanContent = document.createElement('div');
  cleanContent.className = 'review-diff-content';
  const alignmentWords = alignment ? alignment.words : [];

  cleanedWords.forEach((word, i) => {
    const span = document.createElement('span');
    const conf = alignmentWords[i] ? alignmentWords[i].confidence : 1;
    const level = conf >= 0.8 ? 'high' : conf >= 0.4 ? 'mid' : 'low';
    span.className = `word-chip confidence-${level}`;
    span.textContent = word;
    span.dataset.index = i;

    // Inline editing
    span.addEventListener('click', () => {
      span.contentEditable = 'true';
      span.focus();
    });
    span.addEventListener('blur', () => {
      span.contentEditable = 'false';
      const newWord = span.textContent.trim();
      if (newWord !== word && cleaning) {
        const words = cleaning.cleanedText.split(/\s+/).filter(Boolean);
        if (i < words.length) {
          words[i] = newWord;
          cleaning.cleanedText = words.join(' ');
          updateState('cleaning', audioId, cleaning);
        }
      }
    });
    span.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') {
        e.preventDefault();
        span.blur();
      }
    });

    cleanContent.appendChild(span);
    cleanContent.appendChild(document.createTextNode(' '));
  });
  cleanDiv.appendChild(cleanContent);

  diffSection.appendChild(origDiv);
  diffSection.appendChild(cleanDiv);
  panel.appendChild(diffSection);

  // Action buttons
  const actions = document.createElement('div');
  actions.className = 'review-actions';

  const approveBtn = document.createElement('button');
  approveBtn.className = 'btn btn-approve';
  approveBtn.textContent = 'Approve';
  approveBtn.addEventListener('click', () => {
    updateState('reviews', audioId, {
      status: 'approved',
      reviewedAt: new Date().toISOString(),
    });
    if (callbacks?.onApprove) callbacks.onApprove(audioId);
  });

  const rejectBtn = document.createElement('button');
  rejectBtn.className = 'btn btn-reject';
  rejectBtn.textContent = 'Reject';
  rejectBtn.addEventListener('click', () => {
    updateState('reviews', audioId, {
      status: 'rejected',
      reviewedAt: new Date().toISOString(),
    });
    if (callbacks?.onReject) callbacks.onReject(audioId);
  });

  const skipBtn = document.createElement('button');
  skipBtn.className = 'btn btn-skip';
  skipBtn.textContent = 'Skip';
  skipBtn.addEventListener('click', () => {
    if (callbacks?.onSkip) callbacks.onSkip(audioId);
  });

  actions.appendChild(approveBtn);
  actions.appendChild(rejectBtn);
  actions.appendChild(skipBtn);
  panel.appendChild(actions);

  container.appendChild(panel);
}

export function approveAll(audioIds, state) {
  const now = new Date().toISOString();
  for (const audioId of audioIds) {
    updateState('reviews', audioId, {
      status: 'approved',
      reviewedAt: now,
    });
  }
}

export function setupKeyboardNav(container, callbacks) {
  const handler = (e) => {
    // Only act when not editing a contenteditable element
    if (e.target.isContentEditable) return;

    switch (e.key) {
      case 'ArrowUp':
        e.preventDefault();
        if (callbacks?.onNavigate) callbacks.onNavigate('up');
        break;
      case 'ArrowDown':
        e.preventDefault();
        if (callbacks?.onNavigate) callbacks.onNavigate('down');
        break;
      case 'Enter':
        e.preventDefault();
        if (callbacks?.onApprove) callbacks.onApprove();
        break;
      case 's':
      case 'S':
        if (!e.ctrlKey && !e.metaKey) {
          e.preventDefault();
          if (callbacks?.onSkip) callbacks.onSkip();
        }
        break;
      case 'r':
      case 'R':
        if (!e.ctrlKey && !e.metaKey) {
          e.preventDefault();
          if (callbacks?.onReject) callbacks.onReject();
        }
        break;
      case 'e':
      case 'E':
        if (!e.ctrlKey && !e.metaKey) {
          e.preventDefault();
          if (callbacks?.onEdit) callbacks.onEdit();
        }
        break;
    }
  };

  container.addEventListener('keydown', handler);
  return () => container.removeEventListener('keydown', handler);
}
