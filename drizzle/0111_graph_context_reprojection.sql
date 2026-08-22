-- The third and last re-projection of the variable-layout work, on the same
-- terms as 0107 and 0108 and just as deliberately narrow.
--
-- `core:task/build-template-context@1` gained a `speakerRelationships` entry in
-- its `variables` slot, because spec 1.4.0 finally supplies that variable:
-- `core:query/graph-context@1` reads the narrative graph's relationship summary,
-- which the legacy path has always put in the prompt and the pipeline never did.
--
-- The slot change moves the type's content hash, and a published version is
-- frozen — so without this, an upgraded install would hit
-- `TypeRegistryConflictError`, `bootstrapPipelines` would return early, and
-- pipelines would stop with nothing on screen but a diagnostics line. Deleting
-- the row lets boot re-project the current declaration.
--
-- `core:query/graph-context@1` itself needs nothing here: adding a type inserts
-- a row and conflicts with nothing.
--
-- Safe only because nothing outside this repo has pinned this version. Once
-- 0.6.0 ships, a changed type is a new version, never a rewrite of the row
-- (13 §12b). `registryHashes.test.ts` records the new hash in the same commit.
DELETE FROM "pipeline_type_registry"
WHERE "type_id" = 'core:task/build-template-context'
AND "version" = 1;
