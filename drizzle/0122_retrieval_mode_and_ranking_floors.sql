-- Re-project the retrieval and ranking types.
--
-- Five declarations moved, and every one of them changes a content hash:
--
--   * `core:input/user-message` gained `chatId` and `characterId` out-ports.
--     Both were already in the payload, bundled inside `chatScope`, so a node
--     that needed only the speaker had to accept the whole scope and reach
--     into it — and `currentCharacterId` travelled on `HostScope` rather than
--     through the graph, the one piece of a run the receipt could not see.
--   * `core:query/world-lore` and `core:query/character-lore` gained
--     `retrievalMode` — the default an entry that has not chosen its own
--     retrieval is treated as. Without it, an install with no embedding model
--     had to open every lorebook entry it owned to say "keyword", one at a
--     time, because `rag` was the shipped default and nothing could change it
--     in bulk.
--   * `core:query/vector-search` gained the same field, because both arms
--     consult it. If only the keyword node carried the mode, an undecided
--     entry would be keyword-ineligible and vector-eligible at once — the two
--     arms disagreeing about the same entry.
--   * `core:query/chat-history` lost `weight` and `minInclude`. Both were
--     answers to "how does history fare against everything else", which a node
--     that fetches rows cannot see enough to answer: the weight sat beside
--     `rank`'s `share` free to disagree with it, and the floor was the only one
--     of five sources that had one.
--   * `core:task/rank-hybrid` and `core:task/rank-by-recency` traded
--     `minMessageTokens` for a per-source `minEntries` stack, which is where
--     those two now live.
--
-- Values already written at the dropped addresses are culled by
-- `reconcileConfigs`, which records what each one was rather than dropping it
-- silently.
--
-- Without this delete an upgraded install hits `TypeRegistryConflictError`,
-- `bootstrapPipelines` returns early, and pipelines are disabled with nothing
-- on screen to say so.
DELETE FROM "pipeline_type_registry" WHERE ("type_id", "version") IN (
	('core:input/user-message', 1),
	('core:query/world-lore', 1),
	('core:query/character-lore', 1),
	('core:query/vector-search', 1),
	('core:query/chat-history', 1),
	('core:task/rank-hybrid', 1),
	('core:task/rank-by-recency', 1)
);
