-- Store full transcript text in Supabase so R2 is not load-bearing for transcript content.
ALTER TABLE public.transcripts
  ADD COLUMN IF NOT EXISTS text TEXT;
