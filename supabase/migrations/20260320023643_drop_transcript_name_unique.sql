-- Drop the unique constraint on transcripts.name that blocks bulk upserts
-- when data.json contains duplicate transcript names (13 known duplicates).
-- IDs are the real primary keys; names are display-only and can repeat.
ALTER TABLE public.transcripts DROP CONSTRAINT IF EXISTS transcripts_name_key;
