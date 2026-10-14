-- A session's own sampling pick lives on the one session layer: a
-- session-scope `pipeline_node_overrides` row on the `generate` step's
-- `sampling` slot, on every pipeline whose `generate` step writes text
-- (its connection slot requires `text->text`, or names no transform and a
-- text shape or none). A row the session already holds at that address is
-- the more specific pick and stays.
INSERT INTO "pipeline_node_overrides" ("spec_id", "scope_kind", "scope_id", "node_key", "slot", "path", "value", "updated_by", "updated_at")
SELECT sp."id", 'session', s."id", 'generate', 'sampling', '', to_json(s."sampling_config_id"), s."user_id", now()
FROM "sessions" s
JOIN "sampling_configs" sc ON sc."id" = s."sampling_config_id"
CROSS JOIN "pipeline_specs" sp
JOIN "pipeline_nodes" n ON n."spec_version_id" = sp."active_version_id" AND n."node_key" = 'generate'
JOIN "pipeline_definition_registry" r ON r."definition_id" = n."definition_id" AND r."version" = n."definition_version"
WHERE s."sampling_config_id" IS NOT NULL
	AND (r."slots"::jsonb -> 'sampling' ->> 'kind') = 'sampling'
	AND NOT EXISTS (
		SELECT 1
		FROM jsonb_each(r."slots"::jsonb) c("name", "decl")
		WHERE c."decl" ->> 'kind' = 'connection'
			AND COALESCE(
				(
					SELECT t."id" = 'text->text'
					FROM jsonb_array_elements_text(
						CASE WHEN jsonb_typeof(c."decl" -> 'requires') = 'array' THEN c."decl" -> 'requires' ELSE '[]'::jsonb END
					) WITH ORDINALITY t("id", "i")
					WHERE t."id" LIKE '%->%'
					ORDER BY t."i"
					LIMIT 1
				),
				COALESCE(c."decl" ->> 'shape', '') IN ('', 'core:shape/text-gen@1')
			) IS NOT TRUE
	)
ON CONFLICT ("spec_id", "scope_kind", "scope_id", "node_key", "slot", "path") DO NOTHING;
--> statement-breakpoint
ALTER TABLE "sessions" DROP CONSTRAINT "sessions_sampling_config_id_sampling_configs_id_fk";
--> statement-breakpoint
ALTER TABLE "sessions" DROP COLUMN "sampling_config_id";
