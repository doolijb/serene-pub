-- Script hooks on five core types (18 §4a) — the re-projection.
--
-- `rank-hybrid`, `build-template-context`, `process-messages`, `create-message`
-- and `update-message` each declare a `scripts` slot now: which script types
-- the hook accepts, which port and phase the chains apply at, and the read-only
-- extras it supplies. Accepted types are contract — widening or narrowing what
-- a hook accepts changes what an untouched spec does — so the slot is hashed
-- (S3, the `optional` lesson) and these rows must re-project.
--
-- Same narrow terms as 0099/0106/0112: delete the affected rows and let the
-- next boot re-project them from the descriptors. Safe only because nothing
-- outside this repo has pinned these versions; once 0.6.0 ships, a changed
-- type is a new version, never a rewrite of the row (13 §12b).
DELETE FROM "pipeline_type_registry"
WHERE ("type_id" = 'core:task/rank-hybrid' AND "version" = 1)
	OR ("type_id" = 'core:task/build-template-context' AND "version" = 1)
	OR ("type_id" = 'core:task/process-messages' AND "version" = 1)
	OR ("type_id" = 'core:consumer/create-message' AND "version" = 1)
	OR ("type_id" = 'core:consumer/update-message' AND "version" = 1);
