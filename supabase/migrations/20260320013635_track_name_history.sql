-- Add name_history column to audio_files and transcripts.
-- When a row's name changes, the old name + timestamp are appended to the array.
-- This preserves the full rename trail (like a DBA record) without losing originals.

ALTER TABLE public.audio_files
  ADD COLUMN IF NOT EXISTS name_history jsonb NOT NULL DEFAULT '[]'::jsonb;

ALTER TABLE public.transcripts
  ADD COLUMN IF NOT EXISTS name_history jsonb NOT NULL DEFAULT '[]'::jsonb;

-- Single trigger function shared by both tables
CREATE OR REPLACE FUNCTION public.track_name_history()
RETURNS trigger AS $$
BEGIN
  IF NEW.name IS DISTINCT FROM OLD.name AND OLD.name IS NOT NULL THEN
    NEW.name_history = NEW.name_history || jsonb_build_object(
      'name',       OLD.name,
      'changed_at', now()
    );
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS audio_files_name_history ON public.audio_files;
CREATE TRIGGER audio_files_name_history
  BEFORE UPDATE ON public.audio_files
  FOR EACH ROW EXECUTE FUNCTION public.track_name_history();

DROP TRIGGER IF EXISTS transcripts_name_history ON public.transcripts;
CREATE TRIGGER transcripts_name_history
  BEFORE UPDATE ON public.transcripts
  FOR EACH ROW EXECUTE FUNCTION public.track_name_history();
