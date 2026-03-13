import { updateState } from './state.js';

const ALIGN_ENDPOINT = 'https://align.kohnai.ai/api/align';

function getAudioUrl(audioId, state) {
  const entry = state.audio.find(a => a.id === audioId);
  if (!entry) return null;
  return entry.r2Link || entry.driveLink || null;
}

function fetchAudioAsBase64(url) {
  const fetchUrl = url.includes('audio.kohnai.ai')
    ? `/api/audio?url=${encodeURIComponent(url)}`
    : url;

  return fetch(fetchUrl)
    .then(res => {
      if (!res.ok) throw new Error(`Failed to fetch audio: ${res.status}`);
      return res.blob();
    })
    .then(blob => new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => {
        const dataUrl = reader.result;
        const base64 = dataUrl.split(',')[1];
        resolve(base64);
      };
      reader.onerror = reject;
      reader.readAsDataURL(blob);
    }));
}

export async function alignRow(audioId, state) {
  const url = getAudioUrl(audioId, state);
  if (!url) throw new Error(`No audio URL for ${audioId}`);

  const cleaningData = state.cleaning[audioId];
  if (!cleaningData || !cleaningData.cleanedText) {
    throw new Error(`No cleaned text for ${audioId}`);
  }

  const audioBase64 = await fetchAudioAsBase64(url);

  const response = await fetch(ALIGN_ENDPOINT, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      mode: 'align',
      audio_base64: audioBase64,
      audio_format: '.mp3',
      text: cleaningData.cleanedText,
      language: 'yi',
    }),
  });

  if (!response.ok) {
    const errText = await response.text().catch(() => '');
    throw new Error(`Alignment API error ${response.status}: ${errText}`);
  }

  const data = await response.json();
  const words = (data.timestamps || []).map(t => ({
    word: t.word,
    start: t.start,
    end: t.end,
    confidence: t.confidence,
  }));

  const totalConf = words.reduce((sum, w) => sum + (w.confidence || 0), 0);
  const avgConfidence = words.length > 0 ? totalConf / words.length : 0;
  const lowConfidenceCount = words.filter(w => (w.confidence || 0) < 0.4).length;

  const alignment = {
    words,
    avgConfidence,
    lowConfidenceCount,
    alignedAt: new Date().toISOString(),
  };

  updateState('alignments', audioId, alignment);
  return alignment;
}

export async function batchAlign(audioIds, state, onProgress) {
  const total = audioIds.length;
  const startTime = Date.now();

  for (let i = 0; i < total; i++) {
    const audioId = audioIds[i];
    try {
      await alignRow(audioId, state);
    } catch (err) {
      console.error(`Alignment failed for ${audioId}:`, err);
    }
    const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);
    if (onProgress) {
      onProgress(i + 1, total, elapsed);
    }
  }
}

export async function transcribeAudio(audioId, audioUrl, modelConfig) {
  const audioBase64 = await fetchAudioAsBase64(audioUrl);

  const response = await fetch(modelConfig.endpoint || ALIGN_ENDPOINT, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      mode: 'transcribe',
      audio_base64: audioBase64,
      audio_format: '.mp3',
      language: 'yi',
      ...(modelConfig.requestTemplate || {}),
    }),
  });

  if (!response.ok) {
    throw new Error(`Transcription API error: ${response.status}`);
  }

  const data = await response.json();
  return data.full_text || data.text || '';
}
