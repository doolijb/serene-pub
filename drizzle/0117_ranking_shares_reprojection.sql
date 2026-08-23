-- A targeted re-projection, on the 0099 / 0106 / 0116 precedent and just as
-- deliberately narrow.
--
-- Four types changed contract when the absolute token budget was retired:
--
--   · `core:task/rank-hybrid@1` and `core:task/rank-by-recency@1` dropped
--     `budget: integer` and gained the share / maxEntries / minMessageTokens
--     model that `ranking/weights.ts` has carried, unwired, since it was
--     written.
--   · `core:task/assemble@2` dropped the same `budget` parameter.
--   · `core:task/context-budget@1` gained a `sampling` slot and dropped
--     `reserveForReply`, which duplicated `sampling_configs.response_tokens`.
--
-- An absolute count on a node cannot know which model the prompt is about to be
-- sent to, so it was free to disagree with the window and warn nobody. The
-- total now comes from the sampling config the reply is generated against.
--
-- The registry rows are stale snapshots of declarations that no longer exist.
-- Deleting them lets boot sync re-project the current ones; leaving them would
-- trip the frozen-version conflict rule and `bootstrapPipelines` would return
-- early — specs never seeded, pipelines quietly dead on every instance that
-- booted the previous build.
--
-- Safe here for the same reason as its predecessors and no other: none of these
-- versions has shipped. Once 0.6.0 is out, a changed type is a new version.
DELETE FROM "pipeline_type_registry"
WHERE ("type_id" = 'core:task/rank-hybrid' AND "version" = 1)
   OR ("type_id" = 'core:task/rank-by-recency' AND "version" = 1)
   OR ("type_id" = 'core:task/context-budget' AND "version" = 1)
   OR ("type_id" = 'core:task/assemble' AND "version" = 2);
