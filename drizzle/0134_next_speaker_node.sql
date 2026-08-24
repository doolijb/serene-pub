-- Turn-taking becomes a node (19 §5, U-C4).
--
-- Three published types gain a `currentCharacterId` in-port so the speaker
-- can arrive from the next-speaker node instead of only from the run scope:
-- `generate-text` (the §27l stop-string exclusion follows the node's output),
-- and the two context builders (the prompt's voice follows the same recorded
-- decision). Ports are the original hashed contract, so each re-projects on
-- the 0127–0133 precedent — legitimate only while no third party pins these
-- versions. The four `core:task/turn-*` strategy types are new rows and need
-- no migration.
DELETE FROM "pipeline_type_registry"
WHERE ("type_id" = 'core:provider/generate-text' AND "version" = 1)
   OR ("type_id" = 'core:task/build-template-context' AND "version" = 1)
   OR ("type_id" = 'core:task/build-narrator-context' AND "version" = 1);
