-- Re-project every type that now declares which of its settings are quick.
--
-- `SlotDecl.quick` and `ParamDecl.quick` mark the three or four settings people
-- actually reach for on a node, so a panel can lead with them instead of
-- listing a prompt beside a recursion depth as though the two were equally
-- likely to be wanted. The author knows which; a client heuristic would be
-- wrong differently on every plugin.
--
-- It lands inside `slots`, so it moves the content hash of every type that has
-- a prompts, connection or sampling slot — eighteen of them. Nothing about what
-- they *do* changed, which is exactly why this is a re-projection rather than a
-- version bump: a `@2` here would be dead weight, and every migration in the
-- 0.6.0 cycle is squashed before release anyway.
--
-- Deleting the rows lets boot sync re-project the current declarations. Leaving
-- them trips `TypeRegistryConflictError`, `bootstrapPipelines` returns early,
-- and pipelines stop with nothing on screen but a diagnostics line.
--
-- Correctness still matters even though the migration is temporary: a typo'd
-- `type_id` deletes nothing and passes vacuously on a fresh database, where the
-- registry is empty when migrations run. `reprojection.int.test.ts` regresses
-- the rows first for that reason.
DELETE FROM "pipeline_type_registry" WHERE ("type_id", "version") IN (
	('chariot.comfy:render-image', 1),
	('core:provider/embed-text', 1),
	('core:provider/extract-cast', 1),
	('core:provider/generate-text', 1),
	('core:provider/graph-node-description', 1),
	('core:provider/graph-node-resolution', 1),
	('core:provider/graph-perspective', 1),
	('core:provider/graph-pre-filter', 1),
	('core:provider/graph-state-detection', 1),
	('core:provider/mcp-tool', 1),
	('core:provider/name-entry', 1),
	('core:provider/speak', 1),
	('core:provider/summarize-batch', 1),
	('core:provider/summarize-synth', 1),
	('core:task/assemble', 2),
	('core:task/build-narrator-context', 1),
	('core:task/build-template-context', 1),
	('core:task/context-budget', 1)
);
