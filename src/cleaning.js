import { getState, updateState } from './state.js';

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

export function batchClean(audioIds, state) {
  for (const audioId of audioIds) {
    const mapping = state.mappings[audioId];
    if (!mapping) continue;

    const transcript = state.transcripts.find(t => t.id === mapping.transcriptId);
    if (!transcript) continue;

    const rawText = transcript.text || transcript.firstLine || '';
    if (!rawText) continue;

    const cleanedText = cleanText(rawText);
    const cleanRate = calculateCleanRate(rawText, cleanedText);

    updateState('cleaning', audioId, {
      originalText: rawText,
      cleanedText,
      cleanRate,
      cleanedAt: new Date().toISOString(),
    });
  }
}
