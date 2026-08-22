-- The second half of the variable-layout work, and the second re-projection it
-- needs. Same precedent as 0099/0106/0107, and just as deliberately narrow.
--
-- `core:task/assemble@2` gained a `variables` slot declaring how the lore and
-- history *it* produces are laid out. Those three are declared here rather than
-- on the context builder because they come out the other side of the budget:
-- what a layout receives is what actually fit, which no earlier node knows.
--
-- The slot change moves the type's content hash, and a published version is
-- frozen — so on any database that booted a previous build `syncTypeRegistry`
-- would raise `TypeRegistryConflictError`, `bootstrapPipelines` would catch it
-- and return early, and pipelines would silently stop. Deleting the row lets
-- boot re-project the current declaration.
--
-- Safe only because nothing outside this repo has pinned this version — the 0.6
-- line is still in preview. Once 0.6.0 ships, a changed type is a new version,
-- never a rewrite of the row (13 §12b). `registryHashes.test.ts` records the new
-- hash in the same commit, which is the pairing that makes a *missing*
-- re-projection a red suite instead of a support ticket.
DELETE FROM "pipeline_type_registry"
WHERE "type_id" = 'core:task/assemble'
AND "version" = 2;
