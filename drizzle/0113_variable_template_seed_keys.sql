-- Re-key core's shipped variable layouts on their variant, not their name.
--
-- `seedKeyFor` built `...:<variableId>:<name>`, so a shipped layout could never
-- be renamed. The seeder matches on seed key; a new name minted a new key, found
-- nothing to update, and inserted a *second* row. The original stayed behind —
-- still listed in the picker, still selected by every config that had chosen it,
-- and now frozen at whatever source it was created with while the code that was
-- supposed to define it moved on. Two rows for one layout, and the stale one is
-- the one users are pointing at.
--
-- The key is now the variant: `wrapped` (the row that adds the heading and
-- fence) or `content` (the bare value). A variable has exactly one of each, and
-- no rename changes which is which.
--
-- Row **ids are untouched**, so every `pipeline_configs` value that references
-- one of these layouts keeps resolving to the same row. This migration only
-- renames the handle the seeder finds it by.
--
-- The pairs below are generated from `SHIPPED_VARIABLE_TEMPLATES` as it stood at
-- 0.6.0. A name that was never seeded matches nothing, which is why this is safe
-- against a database seeded from any earlier point in the branch.

UPDATE pipeline_variable_templates AS t
SET seed_key = m.new_key
FROM (VALUES
	('pipeline-variable-template:core:var/instructions@1:Titled block', 'pipeline-variable-template:core:var/instructions@1:wrapped'),
	('pipeline-variable-template:core:var/instructions@1:As written', 'pipeline-variable-template:core:var/instructions@1:content'),
	('pipeline-variable-template:core:var/characters@1:Titled JSON block', 'pipeline-variable-template:core:var/characters@1:wrapped'),
	('pipeline-variable-template:core:var/characters@1:JSON', 'pipeline-variable-template:core:var/characters@1:content'),
	('pipeline-variable-template:core:var/personas@1:Titled JSON block', 'pipeline-variable-template:core:var/personas@1:wrapped'),
	('pipeline-variable-template:core:var/personas@1:JSON', 'pipeline-variable-template:core:var/personas@1:content'),
	('pipeline-variable-template:core:var/scenario@1:Titled block', 'pipeline-variable-template:core:var/scenario@1:wrapped'),
	('pipeline-variable-template:core:var/scenario@1:As written', 'pipeline-variable-template:core:var/scenario@1:content'),
	('pipeline-variable-template:core:var/example-dialogue@1:As written', 'pipeline-variable-template:core:var/example-dialogue@1:content'),
	('pipeline-variable-template:core:var/post-history-instructions@1:As written', 'pipeline-variable-template:core:var/post-history-instructions@1:content'),
	('pipeline-variable-template:core:var/character-names@1:As written', 'pipeline-variable-template:core:var/character-names@1:content'),
	('pipeline-variable-template:core:var/persona-names@1:As written', 'pipeline-variable-template:core:var/persona-names@1:content'),
	('pipeline-variable-template:core:var/world-lore@1:Titled JSON block', 'pipeline-variable-template:core:var/world-lore@1:wrapped'),
	('pipeline-variable-template:core:var/world-lore@1:JSON', 'pipeline-variable-template:core:var/world-lore@1:content'),
	('pipeline-variable-template:core:var/history@1:Titled JSON block', 'pipeline-variable-template:core:var/history@1:wrapped'),
	('pipeline-variable-template:core:var/history@1:JSON', 'pipeline-variable-template:core:var/history@1:content'),
	('pipeline-variable-template:core:var/speaker-relationships@1:Titled JSON block', 'pipeline-variable-template:core:var/speaker-relationships@1:wrapped'),
	('pipeline-variable-template:core:var/speaker-relationships@1:As written', 'pipeline-variable-template:core:var/speaker-relationships@1:content'),
	('pipeline-variable-template:core:var/current-date@1:Sentence', 'pipeline-variable-template:core:var/current-date@1:wrapped'),
	('pipeline-variable-template:core:var/current-date@1:As written', 'pipeline-variable-template:core:var/current-date@1:content')
) AS m(old_key, new_key)
WHERE t.seed_key = m.old_key
  -- Belt and braces: if a database somehow already carries the new key (booted
  -- against the new code before migrating), leave the old row alone rather than
  -- collide with the unique index on seed_key.
  AND NOT EXISTS (
    SELECT 1 FROM pipeline_variable_templates x WHERE x.seed_key = m.new_key
  );
