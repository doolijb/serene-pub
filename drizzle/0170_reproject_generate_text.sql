-- A targeted re-projection, on the 0099/0106 precedent and just as deliberately
-- narrow: `core:provider/generate-text` gained a multimodal contract before any
-- release shipped it, so the registry row is a stale snapshot of code that no
-- longer exists.
--
-- What changed: an `attachments` in-port (media travelling with the request —
-- until now every image port in the graph pointed outward, so an image could be
-- produced and stored but never sent), a `parts` out-port carrying an ordered
-- list of typed output parts, and a declared `media` capability naming which
-- kinds the type accepts and emits. `main` is now a part stream, which is
-- assignable to the text stream it replaced, so every spec pinning this type
-- keeps connecting and degrades by concatenating the prose.
--
-- Deleting the row lets boot sync re-project the current declaration. Safe here
-- only because nothing outside this repo pins the version.
--
-- This must not become a pattern (13 §12b): once 0.6.0 ships, a changed type is
-- a new version, never a rewrite of the row.
DELETE FROM "pipeline_type_registry"
WHERE "type_id" = 'core:provider/generate-text'
AND "version" = 1;
