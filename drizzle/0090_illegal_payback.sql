ALTER TABLE "scenes" ADD COLUMN "cast_resolved_at" timestamp;--> statement-breakpoint
-- Backfill: mark the scenes whose cast is already genuinely resolved, so an
-- existing lorebook doesn't report every scene as needing extraction.
--
-- Predicate deliberately matches what findPreMergeSceneIds inspects — BOTH
-- cast columns, scanning for string entries — so "resolved" means the same
-- thing here as everywhere else:
--   * participant_characters must be non-empty (an empty array is
--     indistinguishable from "never processed" at this point in history —
--     going forward, a genuinely castless scene gets marked at write time,
--     which is exactly why this column exists)
--   * neither column may contain a string entry (those are pre-merge name
--     strings that were never resolved to binding ids)
-- Anything else stays NULL and gets resolved on the next graph build.
UPDATE "scenes"
SET "cast_resolved_at" = now()
WHERE json_array_length("participant_characters") > 0
  AND NOT EXISTS (
    SELECT 1 FROM json_array_elements("participant_characters") e
    WHERE json_typeof(e) = 'string'
  )
  AND NOT EXISTS (
    SELECT 1 FROM json_array_elements("mentioned_characters") e
    WHERE json_typeof(e) = 'string'
  );