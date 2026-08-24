-- A targeted re-projection, on the 0099 / 0106 / 0116 / 0117 precedent.
--
-- Three node types declared a `template` slot that nothing could use:
--
--   · `core:query/session-history@1`      — "how each chat message is written"
--   · `core:query/lorebook-triggers@1` — "how one triggered entry is written"
--   · `core:provider/generate-text@1`  — "how the context is wrapped for this model"
--
-- For each, all three of these were true: no binding ever read the slot, no row
-- was ever seeded for its pool, and so the configuration panel rendered a
-- picker with **nothing in it** on every pipeline using the node. A control
-- that cannot be given a value, and would not be used if it could, is worse
-- than the absence of the feature it stands for.
--
-- The slots are gone; the ideas are not. Per-message wording belongs on
-- `core:task/process-messages@1`, which formats the line. Per-entry wording
-- belongs on `core:task/render-entries@1`, which keeps its slot. Wire framing
-- is the `wire` slot's job.
--
-- The registry rows are stale snapshots of declarations that no longer exist;
-- deleting them lets boot sync re-project the current ones. Leaving them would
-- trip the frozen-version rule and `bootstrapPipelines` would return early,
-- taking pipelines down on every instance that booted the previous build.
--
-- `core:task/render-entries@1` is here for the opposite reason: it *gained*
-- something. The entry scope that `lorebook-triggers` declared on its inert slot
-- moved onto the node whose job is the rendering, and became a real schema while
-- it was there rather than the bare `['title', 'content', 'keys']` it had been.
--
-- Safe for the same reason as its predecessors and no other: none of these
-- versions has shipped.
DELETE FROM "pipeline_type_registry"
WHERE ("type_id" = 'core:query/session-history' AND "version" = 1)
   OR ("type_id" = 'core:query/lorebook-triggers' AND "version" = 1)
   OR ("type_id" = 'core:provider/generate-text' AND "version" = 1)
   OR ("type_id" = 'core:task/render-entries' AND "version" = 1);
