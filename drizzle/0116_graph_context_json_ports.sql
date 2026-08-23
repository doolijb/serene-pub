-- A targeted re-projection, on the 0099 and 0106 precedent and just as
-- deliberately narrow.
--
-- `core:query/graph-context@1` changed its out-ports from `text` to `json`.
-- The summary used to be stringified inside `buildGraphContext` before it ever
-- reached a template, which made it the one context value a variable layout
-- could do nothing with: not prose, not a dropped section, not even a different
-- indent, because the shape was already flattened. The node emits the structure
-- now and the layout renders it, so the declared port shape had to follow.
--
-- The registry row is a stale snapshot of a declaration that no longer exists.
-- Deleting it lets boot sync re-project the current one; leaving it would trip
-- the frozen-version conflict rule and `bootstrapPipelines` would return early
-- — specs never seeded, legacy migration never run, pipelines quietly dead on
-- every instance that booted the previous build.
--
-- Safe here for the same reason it was safe twice before, and for no other:
-- this type version has never shipped. It was introduced during 0.6.0
-- development and nothing outside this repository can have pinned it.
--
-- This must not become a pattern (13 §12b): once 0.6.0 ships, a changed type is
-- a new version, never a rewrite of the row.
DELETE FROM "pipeline_type_registry"
WHERE "type_id" = 'core:query/graph-context'
AND "version" = 1;
