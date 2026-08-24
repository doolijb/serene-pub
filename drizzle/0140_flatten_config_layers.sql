-- The layers, simplified (ruled 2026-08-24).
--
-- The chain was author → config → instance → user → chat: a named config,
-- then two more override layers stacked on top of it before the chat's. Both
-- middle layers answered the same question the config already answers — "what
-- does this instance run" — from a second and third place, which is exactly
-- the disagreement the 0139 fold removed one level up. From here there are
-- three layers and no more: the **pipeline** (author defaults), the selected
-- **config** (the instance's tuning, edited as a thing with a name), and the
-- **chat's overrides** (the one place a value may differ from the config,
-- because a chat is a work and not a preference).
--
-- Per-user tuning goes entirely: no user-scope value overrides, selections,
-- function bindings or node rebinds. A person's levers are the chat's —
-- choose a preset for the chat, override inside the chat.
--
-- Nothing an admin tuned is lost. Instance-scope override rows were the
-- admin's site-wide edits, so they fold *into* the instance's selected config
-- before the layer is removed — and when that config is the immutable shipped
-- default, a mutable copy is made first ("customizing is duplicating", the
-- named-config rule), values carried, and the instance selection moved to it.
-- User-scope rows are deleted rather than folded: they were personal tuning,
-- and the ruling is that the product no longer has that layer.
DO $$
DECLARE
	rec RECORD;
	src integer;
	target integer;
	base text;
	candidate text;
	n integer;
BEGIN
	FOR rec IN
		SELECT DISTINCT spec_id
		FROM pipeline_node_overrides
		WHERE scope_kind = 'instance'
	LOOP
		-- The instance's effective config: its selection, else the shipped
		-- default — the same resolution resolveSelectedConfig performs.
		SELECT config_id INTO src
		FROM pipeline_config_selections
		WHERE spec_id = rec.spec_id
			AND scope_kind = 'instance'
			AND config_id IS NOT NULL
		LIMIT 1;
		IF src IS NULL THEN
			SELECT id INTO src
			FROM pipeline_configs
			WHERE spec_id = rec.spec_id AND is_immutable = true
			LIMIT 1;
		END IF;
		IF src IS NULL THEN
			-- No config exists to fold into; under the new model these rows
			-- would decide nothing anyway.
			CONTINUE;
		END IF;

		target := src;
		IF (SELECT is_immutable FROM pipeline_configs WHERE id = src) THEN
			SELECT name INTO base FROM pipeline_configs WHERE id = src;
			candidate := base || ' (customized)';
			n := 2;
			WHILE EXISTS (
				SELECT 1 FROM pipeline_configs
				WHERE spec_id = rec.spec_id AND name = candidate
			) LOOP
				candidate := base || ' (customized ' || n || ')';
				n := n + 1;
			END LOOP;
			INSERT INTO pipeline_configs (spec_id, name, is_immutable, is_default)
			VALUES (rec.spec_id, candidate, false, false)
			RETURNING id INTO STRICT target;
			INSERT INTO pipeline_config_values
				(config_id, node_key, slot, path, value, engine)
			SELECT target, node_key, slot, path, value, engine
			FROM pipeline_config_values
			WHERE config_id = src;
		END IF;

		-- The admin's edits become the config's values.
		INSERT INTO pipeline_config_values (config_id, node_key, slot, path, value)
		SELECT target, node_key, slot, COALESCE(path, ''), value
		FROM pipeline_node_overrides
		WHERE spec_id = rec.spec_id AND scope_kind = 'instance'
		ON CONFLICT (config_id, node_key, slot, path)
			DO UPDATE SET value = EXCLUDED.value;

		INSERT INTO pipeline_config_selections (spec_id, scope_kind, scope_id, config_id)
		VALUES (rec.spec_id, 'instance', 0, target)
		ON CONFLICT (spec_id, scope_kind, scope_id)
			DO UPDATE SET config_id = EXCLUDED.config_id;
	END LOOP;
END $$;
--> statement-breakpoint
DELETE FROM "pipeline_node_overrides" WHERE "scope_kind" IN ('instance', 'user');--> statement-breakpoint
DELETE FROM "pipeline_config_selections" WHERE "scope_kind" = 'user';--> statement-breakpoint
DELETE FROM "pipeline_function_bindings" WHERE "scope_kind" = 'user';--> statement-breakpoint
DELETE FROM "pipeline_node_rebinds" WHERE "scope_kind" = 'user';--> statement-breakpoint
ALTER TABLE "pipeline_node_overrides" DROP CONSTRAINT IF EXISTS "pipeline_node_overrides_scope_check";--> statement-breakpoint
ALTER TABLE "pipeline_node_overrides" ADD CONSTRAINT "pipeline_node_overrides_scope_check" CHECK ("scope_kind" = 'chat');--> statement-breakpoint
ALTER TABLE "pipeline_config_selections" DROP CONSTRAINT IF EXISTS "pipeline_config_selections_scope_check";--> statement-breakpoint
ALTER TABLE "pipeline_config_selections" ADD CONSTRAINT "pipeline_config_selections_scope_check" CHECK ("scope_kind" IN ('instance', 'chat'));--> statement-breakpoint
ALTER TABLE "pipeline_function_bindings" DROP CONSTRAINT IF EXISTS "pipeline_function_bindings_scope_check";--> statement-breakpoint
ALTER TABLE "pipeline_function_bindings" ADD CONSTRAINT "pipeline_function_bindings_scope_check" CHECK ("scope_kind" IN ('instance', 'chat'));--> statement-breakpoint
ALTER TABLE "pipeline_node_rebinds" DROP CONSTRAINT IF EXISTS "pipeline_node_rebinds_scope_check";--> statement-breakpoint
ALTER TABLE "pipeline_node_rebinds" ADD CONSTRAINT "pipeline_node_rebinds_scope_check" CHECK ("scope_kind" IN ('instance', 'chat'));
