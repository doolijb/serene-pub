-- The narrative graph becomes two nodes and two variables.
--
-- One node emitted all three sections of the graph through one port, under one
-- "Your relationships:" heading: what the speaker thinks of everyone, what
-- everyone thinks of the speaker, and the figures the world knows of. The first
-- two are opposite claims, and a model handed them under one heading reads them
-- as one list. Being one variable, they also shared a layout, a priority and an
-- on/off switch, so "include how others see me but not my own view" could not
-- be said.
--
-- Four things follow from that.
--
-- 1. `core:query/graph-context@1` no longer exists. Removing a published type
--    normally orphans every stored spec that pinned it, which is why
--    `registryHashes.test.ts` guards against it — allowed here only because 0.6
--    has not shipped, so every document pinning it is a preview document and
--    the respond spec republishes at 1.9.0 on the next boot.
DELETE FROM "pipeline_type_registry" WHERE "type_id" = 'core:query/graph-context';
--> statement-breakpoint
-- 2. `core:task/build-template-context` declares two `renders` entries where it
--    declared one, which moves its content hash. Without the delete an upgraded
--    install hits `TypeRegistryConflictError`, `bootstrapPipelines` returns
--    early, and pipelines are disabled with nothing on screen to say so.
DELETE FROM "pipeline_type_registry" WHERE ("type_id", "version") IN (
	('core:task/build-template-context', 1)
);
--> statement-breakpoint
-- 3. The shipped layouts for the retired variable. Core's own rows only —
--    `seed_key IS NOT NULL` — because a row a user wrote is theirs even when
--    the variable it rendered is gone, and deleting it would take their text
--    with it. Config values still pointing at one are culled by
--    `reconcileConfigs`, which records what each held rather than dropping it
--    silently.
DELETE FROM "pipeline_variable_templates"
WHERE "variable_id" = 'core:var/speaker-relationships@1'
  AND "seed_key" IS NOT NULL;
--> statement-breakpoint
-- 4. Context templates that render the retired variable.
--
-- Only the exact block is rewritten, and only where it appears verbatim. A
-- template somebody restructured is left alone: guessing at an edit inside
-- authored text is how a migration silently corrupts the one thing in this
-- table that cannot be regenerated. Core's own row is not matched here at all —
-- it self-heals from `SHIPPED_CONTEXT_TEMPLATE` on the next boot.
--
-- A user whose template does not match keeps a block that renders nothing. That
-- is visible (the relationships stop appearing) and fixable (re-add the two
-- variables), where a bad rewrite would not be either.
UPDATE "pipeline_context_templates"
SET "source" = REPLACE(
		"source",
		'{{#if speakerRelationships}}' || chr(10) ||
		'{{{speakerRelationships}}}' || chr(10) ||
		'{{/if}}',
		'{{#if relationshipsPerspectives}}' || chr(10) ||
		'{{{relationshipsPerspectives}}}' || chr(10) ||
		'{{/if}}' || chr(10) || chr(10) ||
		'{{#if relationshipsKnown}}' || chr(10) ||
		'{{{relationshipsKnown}}}' || chr(10) ||
		'{{/if}}'
	),
	"updated_at" = now()
WHERE "seed_key" IS NULL
  AND "source" LIKE '%{{{speakerRelationships}}}%';
