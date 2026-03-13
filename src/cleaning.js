import { updateState } from './state.js';

export function cleanText(rawText) {
  if (!rawText) return '';

  let text = rawText;

  // Pass 1: Strip [bracketed content] including nested
  text = text.replace(/\[[^\[\]]*(?:\[[^\[\]]*\][^\[\]]*)*\]/g, '');

  // Pass 2: Strip (parenthetical content)
  text = text.replace(/\([^()]*(?:\([^()]*\)[^()]*)*\)/g, '');

  // Pass 3: Strip Hebrew section markers, asterisks, numbered headings
  text = text.replace(/\u05E1\u05E2\u05D9\u05E3[\s\u05D0-\u05EA\u0590-\u05FF'"\u2018\u2019\u201C\u201D]{0,10}/g, '');
  text = text.replace(/\*\s*\*\s*\*/g, '');
  text = text.replace(/^\s*\*+\s*$/gm, '');
  text = text.replace(/^\s*\d+[.)]\s*/gm, '');

  // Pass 4: Strip zero-width chars, smart quotes to regular
  text = text.replace(/[\u200B-\u200F\uFEFF]/g, '');
  text = text.replace(/[\u2018\u2019]/g, "'");
  text = text.replace(/[\u201C\u201D]/g, '"');

  // Pass 5: Collapse multiple spaces/newlines, trim
  text = text.replace(/\n{3,}/g, '\n\n');
  text = text.replace(/[ \t]{2,}/g, ' ');
  text = text.trim();

  return text;
}

export function calculateCleanRate(rawText, cleanedText) {
  if (!rawText) return 100;
  const rawWords = rawText.split(/\s+/).filter(Boolean);
  const cleanedWords = cleanedText.split(/\s+/).filter(Boolean);
  if (rawWords.length === 0) return 100;
  return Math.round((cleanedWords.length / rawWords.length) * 100);
}

async function fetchTranscriptText(transcript) {
  if (transcript.text) return transcript.text;
  if (!transcript.r2TranscriptLink) return transcript.firstLine || '';
  try {
    const resp = await fetch(transcript.r2TranscriptLink);
    if (!resp.ok) return transcript.firstLine || '';
    const text = await resp.text();
    if (text && text.trim()) {
      transcript.text = text;
      return text;
    }
  } catch {
    // CORS or network error — fall back to firstLine
  }
  return transcript.firstLine || '';
}

export async function batchClean(audioIds, state, onProgress) {
  const total = audioIds.length;
  const startTime = Date.now();

  for (let i = 0; i < total; i++) {
    const audioId = audioIds[i];
    const mapping = state.mappings[audioId];
    if (!mapping) { if (onProgress) onProgress(i + 1, total); continue; }

    const transcript = state.transcripts.find(t => t.id === mapping.transcriptId);
    if (!transcript) { if (onProgress) onProgress(i + 1, total); continue; }

    const rawText = await fetchTranscriptText(transcript);
    if (!rawText) { if (onProgress) onProgress(i + 1, total); continue; }

    const cleanedText = cleanText(rawText);
    const cleanRate = calculateCleanRate(rawText, cleanedText);

    updateState('cleaning', audioId, {
      originalText: rawText,
      cleanedText,
      cleanRate,
      cleanedAt: new Date().toISOString(),
    });

    if (onProgress) {
      const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);
      onProgress(i + 1, total, elapsed);
    }
  }
}
