-- Re-project the two lore queries, which now declare `optional`.
--
-- `optional: true` says an empty result from this node is fine, and that is
-- exactly the precondition for letting somebody switch the source off — a chat
-- with no world lore is an ordinary chat. It is part of the content hash, so
-- declaring it moves the hash of both types.
--
-- Without this delete an upgraded install hits `TypeRegistryConflictError`,
-- `bootstrapPipelines` returns early, and **pipelines are disabled** with
-- nothing on screen to say so — the page keeps rendering the last published
-- version, which is what makes it easy to miss. Found exactly that way: every
-- test passed, because a fresh database has an empty registry when migrations
-- run, and the running instance had been quietly serving the old document.
DELETE FROM "pipeline_type_registry" WHERE ("type_id", "version") IN (
	('core:query/world-lore', 1),
	('core:query/character-lore', 1)
);
