import { createClient } from '@supabase/supabase-js';

const supabase = createClient(
  import.meta.env.VITE_SUPABASE_URL,
  import.meta.env.VITE_SUPABASE_ANON_KEY,
);

// ── Audio file FK guard ──────────────────────────────────────────────
// Many tables have audio_id FK → audio_files.id, so we upsert the file
// before writing related rows.

async function ensureAudioFile(audio) {
  if (!audio) return;
  const { error } = await supabase.from('audio_files').upsert(
    {
      id: audio.id,
      name: audio.name,
      r2_link: audio.r2Link || null,
      drive_link: audio.driveLink || null,
      year: audio.year || null,
      month: audio.month || null,
      day: audio.day || null,
      type: audio.type || null,
      est_minutes: audio.estMinutes || null,
      is_selected_50hr: audio.isSelected50hr || false,
      is_benchmark: audio.isBenchmark || false,
    },
    { onConflict: 'id' },
  );
  if (error) console.warn('[DB] ensureAudioFile:', error.message);
}

// ── Per-table sync helpers ───────────────────────────────────────────

export async function syncMapping(audioId, mapping, audioEntry) {
  if (!mapping) return;
  await ensureAudioFile(audioEntry);
  const { error } = await supabase.from('mappings').upsert(
    {
      audio_id: audioId,
      transcript_id: mapping.transcriptId,
      confidence: mapping.confidence,
      match_reason: mapping.matchReason,
      confirmed_by: mapping.confirmedBy,
      confirmed_at: mapping.confirmedAt,
    },
    { onConflict: 'audio_id' },
  );
  if (error) console.warn('[DB] syncMapping:', error.message);
}

export async function deleteMapping(audioId) {
  const { error } = await supabase.from('mappings').delete().eq('audio_id', audioId);
  if (error) console.warn('[DB] deleteMapping:', error.message);
}

export async function syncCleaning(audioId, cleaningData, audioEntry) {
  if (!cleaningData) return;
  await ensureAudioFile(audioEntry);
  const { error } = await supabase.from('transcript_edits').upsert(
    {
      audio_id: audioId,
      version: 'cleaned',
      text: cleaningData.cleanedText,
      original_text: cleaningData.originalText,
      clean_rate: cleaningData.cleanRate,
      created_at: cleaningData.cleanedAt || new Date().toISOString(),
      created_by: 'system',
    },
    { onConflict: 'audio_id,version' },
  );
  if (error) console.warn('[DB] syncCleaning:', error.message);
}

export async function syncAlignment(audioId, alignmentData, audioEntry) {
  if (!alignmentData) return;
  await ensureAudioFile(audioEntry);
  const { error } = await supabase.from('alignments').upsert(
    {
      audio_id: audioId,
      words: alignmentData.words,
      avg_confidence: alignmentData.avgConfidence,
      low_confidence_count: alignmentData.lowConfidenceCount,
      aligned_at: alignmentData.alignedAt,
    },
    { onConflict: 'audio_id' },
  );
  if (error) console.warn('[DB] syncAlignment:', error.message);
}

export async function syncReview(audioId, reviewData, audioEntry) {
  if (!reviewData) return;
  await ensureAudioFile(audioEntry);
  const { error } = await supabase.from('reviews').upsert(
    {
      audio_id: audioId,
      status: reviewData.status,
      edited_text: reviewData.editedText || null,
      reviewed_at: reviewData.reviewedAt,
    },
    { onConflict: 'audio_id' },
  );
  if (error) console.warn('[DB] syncReview:', error.message);
}

// ── Dispatch helper used by state.js ────────────────────────────────
// Called fire-and-forget after every updateState() call.

export function syncStateKey(key, audioId, value, audioEntry) {
  switch (key) {
    case 'mappings':
      syncMapping(audioId, value, audioEntry).catch(console.warn);
      break;
    case 'cleaning':
      syncCleaning(audioId, value, audioEntry).catch(console.warn);
      break;
    case 'alignments':
      syncAlignment(audioId, value, audioEntry).catch(console.warn);
      break;
    case 'reviews':
      syncReview(audioId, value, audioEntry).catch(console.warn);
      break;
    default:
      break;
  }
}

// ── Bulk seed helpers ────────────────────────────────────────────────
// Called once on startup when data.json has changed, to ensure the full
// catalog and pre-matched mappings exist in Supabase.

const CHUNK = 500;

export async function bulkSyncAudioFiles(audioArray) {
  for (let i = 0; i < audioArray.length; i += CHUNK) {
    const rows = audioArray.slice(i, i + CHUNK).map(a => ({
      id: a.id,
      name: a.name,
      r2_link: a.r2Link || null,
      drive_link: a.driveLink || null,
      year: a.year || null,
      month: a.month || null,
      day: a.day || null,
      type: a.type || null,
      est_minutes: a.estMinutes || null,
      is_selected_50hr: a.isSelected50hr || false,
      is_benchmark: a.isBenchmark || false,
    }));
    const { error } = await supabase.from('audio_files').upsert(rows, { onConflict: 'id' });
    if (error) console.warn('[DB] bulkSyncAudioFiles:', error.message);
  }
}

export async function bulkSyncTranscripts(transcriptArray) {
  for (let i = 0; i < transcriptArray.length; i += CHUNK) {
    const rows = transcriptArray.slice(i, i + CHUNK).map(t => ({
      id: t.id,
      name: t.name,
      year: t.year || null,
      month: t.month || null,
      day: t.day || null,
      first_line: t.firstLine || null,
      drive_link: t.driveLink || null,
      r2_transcript_link: t.r2TranscriptLink || null,
    }));
    const { error } = await supabase.from('transcripts').upsert(rows, { onConflict: 'id' });
    if (error) console.warn('[DB] bulkSyncTranscripts:', error.message);
  }
}

// Must be called AFTER bulkSyncAudioFiles (FK constraint on audio_id).
export async function bulkSyncMappings(mappingsObj) {
  const rows = Object.entries(mappingsObj).map(([audioId, m]) => ({
    audio_id: audioId,
    transcript_id: m.transcriptId,
    confidence: m.confidence,
    match_reason: m.matchReason,
    confirmed_by: m.confirmedBy,
    confirmed_at: m.confirmedAt,
  }));
  for (let i = 0; i < rows.length; i += CHUNK) {
    // onConflict: don't overwrite user-confirmed mappings with imported ones
    const { error } = await supabase.from('mappings').upsert(
      rows.slice(i, i + CHUNK),
      { onConflict: 'audio_id', ignoreDuplicates: true },
    );
    if (error) console.warn('[DB] bulkSyncMappings:', error.message);
  }
}

// ── Bulk load from Supabase on startup ──────────────────────────────
// Returns a full state object (work + catalog) to be merged over localStorage.

export async function loadFromSupabase() {
  try {
    const [
      { data: mappingsData, error: mErr },
      { data: alignmentsData, error: aErr },
      { data: reviewsData, error: rErr },
      { data: editsData, error: eErr },
      { data: audioFilesData, error: afErr },
      { data: transcriptsData, error: tErr },
    ] = await Promise.all([
      supabase.from('mappings').select('*'),
      supabase.from('alignments').select('*'),
      supabase.from('reviews').select('*'),
      supabase.from('transcript_edits').select('*'),
      supabase.from('audio_files').select('*'),
      supabase.from('transcripts').select('*'),
    ]);

    if (mErr) console.warn('[DB] load mappings:', mErr.message);
    if (aErr) console.warn('[DB] load alignments:', aErr.message);
    if (rErr) console.warn('[DB] load reviews:', rErr.message);
    if (eErr) console.warn('[DB] load edits:', eErr.message);
    if (afErr) console.warn('[DB] load audio_files:', afErr.message);
    if (tErr) console.warn('[DB] load transcripts:', tErr.message);

    const mappings = {};
    (mappingsData || []).forEach(m => {
      mappings[m.audio_id] = {
        transcriptId: m.transcript_id,
        confidence: m.confidence,
        matchReason: m.match_reason,
        confirmedBy: m.confirmed_by,
        confirmedAt: m.confirmed_at,
      };
    });

    const alignments = {};
    (alignmentsData || []).forEach(a => {
      alignments[a.audio_id] = {
        words: a.words,
        avgConfidence: a.avg_confidence,
        lowConfidenceCount: a.low_confidence_count,
        alignedAt: a.aligned_at,
      };
    });

    const reviews = {};
    (reviewsData || []).forEach(r => {
      reviews[r.audio_id] = {
        status: r.status,
        editedText: r.edited_text,
        reviewedAt: r.reviewed_at,
      };
    });

    const cleaning = {};
    (editsData || []).filter(e => e.version === 'cleaned').forEach(e => {
      cleaning[e.audio_id] = {
        cleanedText: e.text,
        originalText: e.original_text,
        cleanRate: e.clean_rate,
        cleanedAt: e.created_at,
      };
    });

    // Catalog metadata — used to update isSelected50hr, isBenchmark, r2Link on in-memory audio
    // and to apply the zombie-mapping fix (Supabase knows the file but has no mapping = deleted).
    const audioFiles = {};
    (audioFilesData || []).forEach(a => {
      audioFiles[a.id] = {
        isSelected50hr: a.is_selected_50hr,
        isBenchmark: a.is_benchmark,
        r2Link: a.r2_link,
      };
    });

    const transcripts = {};
    (transcriptsData || []).forEach(t => {
      transcripts[t.id] = {
        firstLine: t.first_line,
        r2TranscriptLink: t.r2_transcript_link,
      };
    });

    return { mappings, alignments, reviews, cleaning, audioFiles, transcripts };
  } catch (err) {
    console.warn('[DB] loadFromSupabase failed:', err.message);
    return null;
  }
}
