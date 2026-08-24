-- Injections render in-loop, so the inject hook moves (18 §4a, ruling 2026-08-23).
--
-- `messages/inject` scripts attach on the context builders now — respond's and
-- the narrator's — landing as `context.injections` and resolved to
-- `injectionsByIndex` beside `postHistory.targetIndex`, so the template's own
-- message loop renders them. The message processor keeps `messages/transform`
-- only: splicing rows into its list would be a position the template cannot
-- express and an author cannot see — the §20 defect again, one layer down.
--
-- Accepted types are hashed (S3), so the three rows re-project. Same narrow
-- terms as 0127: safe only because nothing outside this repo has pinned these
-- versions; after 0.6.0 ships, a changed type is a new version.
DELETE FROM "pipeline_type_registry"
WHERE ("type_id" = 'core:task/build-template-context' AND "version" = 1)
	OR ("type_id" = 'core:task/build-narrator-context' AND "version" = 1)
	OR ("type_id" = 'core:task/process-messages' AND "version" = 1);
