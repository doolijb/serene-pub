-- 0128: the per-connection default is eliminated — connections have no
-- default model, and every selection names an explicit pair.
--
-- Bridge first, drop second. `connection_defaults` rows naming only an
-- endpoint are translated to the row that endpoint currently means (its
-- `is_default` model), so an upgrade preserves what runs rather than
-- unconfiguring every capability at once. Registrations with no default to
-- translate stay endpoint-only and resolve as incomplete, with a sentence
-- naming the fix, rather than guessing.
UPDATE "connection_defaults" AS d
SET "connection_model_id" = (
	SELECT m."id" FROM "connection_models" AS m
	WHERE m."connection_id" = d."connection_id" AND m."is_default"
	LIMIT 1
)
WHERE d."connection_id" IS NOT NULL AND d."connection_model_id" IS NULL;--> statement-breakpoint
DROP INDEX "connection_models_one_default";--> statement-breakpoint
ALTER TABLE "connection_models" DROP COLUMN "is_default";--> statement-breakpoint
ALTER TABLE "connections" DROP COLUMN "model";
