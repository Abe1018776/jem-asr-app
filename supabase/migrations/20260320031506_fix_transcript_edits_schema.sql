-- Fix transcript_edits schema:
-- version was INTEGER but the app writes 'cleaned' (text) — change to TEXT.
-- Also add missing 'text' and 'created_by' columns.

-- Drop dependent view first so we can alter the column type
DROP VIEW IF EXISTS public.latest_edits;

-- Drop the unique constraint so we can change the column type
ALTER TABLE public.transcript_edits DROP CONSTRAINT IF EXISTS transcript_edits_audio_id_version_key;

-- Change version from INTEGER to TEXT
ALTER TABLE public.transcript_edits ALTER COLUMN version TYPE TEXT USING version::TEXT;

-- Re-add the unique constraint
ALTER TABLE public.transcript_edits ADD CONSTRAINT transcript_edits_audio_id_version_key UNIQUE (audio_id, version);

-- Add missing columns
ALTER TABLE public.transcript_edits ADD COLUMN IF NOT EXISTS text TEXT;
ALTER TABLE public.transcript_edits ADD COLUMN IF NOT EXISTS created_by TEXT;

-- Recreate the latest_edits view (now version is TEXT)
CREATE VIEW public.latest_edits AS
SELECT DISTINCT ON (audio_id)
  id,
  audio_id,
  version,
  text,
  original_text,
  clean_rate,
  created_at,
  created_by
FROM public.transcript_edits
ORDER BY audio_id, created_at DESC;
