-- Add edited_text to reviews (stores user's corrected transcript text)
ALTER TABLE public.reviews ADD COLUMN IF NOT EXISTS edited_text TEXT;

-- View: audio_pipeline_status
-- Shows each audio file with its classification and pipeline stage.
CREATE OR REPLACE VIEW public.audio_pipeline_status AS
SELECT
  af.id,
  af.name,
  af.year,
  af.month,
  af.day,
  af.type,
  af.est_minutes,
  af.is_selected_50hr,
  af.is_benchmark,
  af.r2_link,
  CASE
    WHEN r.status = 'approved'   THEN 'approved'
    WHEN r.status = 'rejected'   THEN 'rejected'
    WHEN al.audio_id IS NOT NULL THEN 'aligned'
    WHEN te.audio_id IS NOT NULL THEN 'cleaned'
    WHEN m.audio_id  IS NOT NULL THEN 'mapped'
    ELSE 'unmapped'
  END AS pipeline_status,
  m.transcript_id,
  t.name          AS transcript_name,
  m.confidence    AS mapping_confidence,
  m.confirmed_by,
  m.created_at    AS mapped_at,
  r.status        AS review_status,
  r.reviewed_at
FROM public.audio_files af
LEFT JOIN public.mappings         m  ON m.audio_id  = af.id
LEFT JOIN public.transcripts      t  ON t.id         = m.transcript_id
LEFT JOIN public.alignments       al ON al.audio_id  = af.id
LEFT JOIN public.transcript_edits te ON te.audio_id  = af.id AND te.version = 'cleaned'
LEFT JOIN public.reviews           r  ON r.audio_id  = af.id;
