-- A targeted re-projection, on the 0099 precedent and just as deliberately
-- narrow: these three provider types gained a `request` in-port (the topic and
-- known-cast pass-through) before any release shipped them, so the registry
-- rows are stale snapshots of code that no longer exists. Deleting them lets
-- boot sync re-project the current declarations; leaving them would trip the
-- frozen-version conflict rule on a type nothing outside this repo has pinned.
--
-- This must not become a pattern (13 §12b): once 0.6.0 ships, a changed type
-- is a new version, never a rewrite of the row.
DELETE FROM "pipeline_type_registry"
WHERE "type_id" IN (
	'core:provider/summarize-batch',
	'core:provider/summarize-synth',
	'core:provider/extract-cast'
)
AND "version" = 1;
