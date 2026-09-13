-- HAND-WRITTEN, in the 0125 style: drizzle-kit cannot express a data move, and
-- without one this migration throws away whatever embedding setup an install
-- already had. The generated half is the five DDL statements at the bottom, and
-- `drizzle/meta/0127_snapshot.json` is the generator's own snapshot of the
-- resulting schema, so the next `db:generate` diffs against this state rather
-- than re-emitting these drops.
--
-- ## What moves, and why SQL can only do part of it
--
-- Embeddings become a connection like any other (20 §14 finished): the endpoint
-- halves of the `vectorization_configs` singleton project into a `connections`
-- row with `modality = 'embeddings'`, and the `text->embedding` row in
-- `connection_defaults` — the STAR — replaces the
-- `system_settings.vectorization_enabled` switch outright. No star means no
-- embeddings, everywhere that switch used to be read.
--
-- ⚠ **The API key cannot be moved by this file, and copying it would be worse
-- than losing it.** `vectorization_configs.api_key` is AES-256-GCM ciphertext
-- under a key class of its own — `serene-pub:vectorizationApiKey:v1` — derived
-- from the app secret by an HKDF info string distinct from the connection one
-- (`serene-pub:connectionApiKey:v1`, see `utils/tokenCrypto.ts`). SQL has
-- neither the secret nor the primitives. A ciphertext written straight into
-- `extra_json.apiKey` would decrypt to nothing under the class the connection
-- path uses, and the row would LOOK perfectly configured while every embed
-- failed on authentication with nothing on screen naming the secret.
--
-- So the envelope is QUARANTINED under `extra_json.__legacyVectorizationApiKey`
-- — a key nothing in the running app reads, chosen precisely because it is not
-- `apiKey` — and the boot step `migrateEmbeddingConnection` converts it exactly
-- once, decrypting under the old class and re-encrypting under the new. A key it
-- cannot read (a backup restored beside a different `meta.json`) is DROPPED with
-- a warning rather than carried, so the connection asks for re-entry instead of
-- lying about being set up.
--
-- The boot step cannot do the whole move instead, and the ordering is why:
-- migrations run when the database is opened, boot tasks after. A boot step
-- reading `vectorization_configs` would find the table already dropped by the
-- statements below.
--
-- ## The other three decisions this file makes
--
--   · **The star is written only when embeddings were ON.** The switch is gone
--     and the star replaces it, so starring a row on an install where an admin
--     had deliberately switched embeddings off would turn them back on during an
--     upgrade. The connection is still created, so nobody's endpoint, model or
--     key is thrown away; it simply sits unstarred, which is what "off" means
--     now.
--   · **An install the old boot step already migrated is not migrated twice.**
--     That step wrote `system_settings.active_embedding_connection_id` and left
--     the key ALREADY converted, so a non-null pointer means "star the row that
--     exists" and, emphatically, do not quarantine a stale envelope over a good
--     key.
--   · **The TTL rides onto the connection.** It was the only knob on the
--     singleton that was not an endpoint half, and it is a property of the model
--     that gets unloaded rather than of the instance — so `vectorization_configs`
--     has nothing left and the table goes.
--
-- ⚠ `capabilities` is left at its `{}` default, because resolving it means
-- running `resolveConnectionCapabilities` over the adapter manifest and SQL
-- cannot. The boot step fills it in. Until it does, `capabilityGuard`'s
-- `modalityAllows` judges the row by its MODALITY, which is why that predicate
-- had to stop answering "yes" to everything that is not an image.

DO $$
DECLARE
	settings RECORD;
	vc RECORD;
	conn_id integer;
	model_id integer;
	model_name text;
	extra jsonb;
BEGIN
	SELECT * INTO settings FROM system_settings WHERE id = 1;
	-- No singleton row at all: a database that has never been booted. Nothing
	-- was ever configured, so there is nothing to move.
	IF NOT FOUND THEN
		RETURN;
	END IF;

	SELECT * INTO vc FROM vectorization_configs WHERE id = 1;

	conn_id := settings.active_embedding_connection_id;

	IF conn_id IS NULL THEN
		-- Project the singleton. The `mode` column is what decided which half
		-- of it was live, exactly as `getConfiguredEmbeddingTarget` read it.
		IF vc.mode = 'api' AND COALESCE(vc.api_base_url, '') <> '' THEN
			extra := '{}'::jsonb;
			IF vc.api_key IS NOT NULL
				AND vc.api_key_iv IS NOT NULL
				AND vc.api_key_auth_tag IS NOT NULL
			THEN
				-- ⚠ NOT `apiKey`. See the header: the name is what keeps a row
				-- the boot step has not reached from looking configured.
				extra := extra || jsonb_build_object(
					'__legacyVectorizationApiKey',
					jsonb_build_object(
						'ciphertext', vc.api_key,
						'iv', vc.api_key_iv,
						'authTag', vc.api_key_auth_tag
					)
				);
			END IF;
			IF vc.api_dimensions IS NOT NULL THEN
				extra := extra || jsonb_build_object(
					'dimensions', vc.api_dimensions
				);
			END IF;

			model_name := vc.api_model;
			INSERT INTO connections
				(name, type, modality, base_url, model, extra_json)
			VALUES (
				'Embeddings (API)',
				'openai-embeddings',
				'embeddings',
				vc.api_base_url,
				model_name,
				extra::json
			)
			RETURNING id INTO conn_id;

		ELSIF COALESCE(settings.embedding_model_name, '') <> '' THEN
			-- Local mode names a HuggingFace model id and nothing else; the
			-- weights are already in the app data directory.
			model_name := settings.embedding_model_name;
			INSERT INTO connections (name, type, modality, model, extra_json)
			VALUES (
				'Embeddings (Local)',
				'local-onnx',
				'embeddings',
				model_name,
				'{}'::json
			)
			RETURNING id INTO conn_id;
		END IF;
	ELSE
		-- Already a connection. Take its model so the star can name the pair.
		SELECT model INTO model_name FROM connections WHERE id = conn_id;
	END IF;

	-- Nothing was ever configured — a fresh install moves nothing.
	IF conn_id IS NULL THEN
		RETURN;
	END IF;

	-- The idle TTL, onto the row whose model it unloads. Written only when it
	-- differs from the default, so an untouched install carries no key at all
	-- and `resolveEmbeddingTarget` falls to the same 5 it always did.
	IF vc.embedding_model_ttl_minutes IS NOT NULL
		AND vc.embedding_model_ttl_minutes <> 5
	THEN
		UPDATE connections
		SET extra_json = (
			COALESCE(extra_json::jsonb, '{}'::jsonb)
			|| jsonb_build_object(
				'embeddingModelTtlMinutes', vc.embedding_model_ttl_minutes
			)
		)::json
		WHERE id = conn_id;
	END IF;

	-- The MODEL half of the pair (0114). A registration naming only an endpoint
	-- resolves to its default model, and without a row there is not one.
	IF COALESCE(model_name, '') <> '' THEN
		SELECT id INTO model_id
		FROM connection_models
		WHERE connection_id = conn_id AND model = model_name
		LIMIT 1;

		IF model_id IS NULL THEN
			INSERT INTO connection_models
				(connection_id, model, name, is_default)
			VALUES (
				conn_id,
				model_name,
				model_name,
				-- `connection_models_one_default` is a partial UNIQUE index, so
				-- claiming default on an endpoint that already has one would
				-- abort the whole migration.
				NOT EXISTS (
					SELECT 1 FROM connection_models
					WHERE connection_id = conn_id AND is_default
				)
			)
			RETURNING id INTO model_id;
		END IF;
	END IF;

	-- THE STAR, and only for an install where embeddings were switched on.
	IF settings.vectorization_enabled THEN
		INSERT INTO connection_defaults
			(input, output, connection_id, connection_model_id)
		VALUES ('text', 'embedding', conn_id, model_id)
		ON CONFLICT (input, output) DO UPDATE SET
			connection_id = EXCLUDED.connection_id,
			connection_model_id = EXCLUDED.connection_model_id;
	END IF;
END $$;--> statement-breakpoint
-- The switch, the model name, and the pointer. All three are the star now. The
-- foreign key is named explicitly before its column: Postgres would drop it with
-- the column anyway, and this is the statement `drizzle-kit generate` emits, so
-- the file and the generator stay comparable.
--
-- `embedding_model_dimensions` deliberately stays: it is outside this change's
-- scope, nothing reads it, and dropping a column nobody asked about is a second
-- migration's worth of risk for no behaviour.
ALTER TABLE "system_settings" DROP CONSTRAINT "system_settings_active_embedding_connection_id_connections_id_fk";--> statement-breakpoint
ALTER TABLE "system_settings" DROP COLUMN "vectorization_enabled";--> statement-breakpoint
ALTER TABLE "system_settings" DROP COLUMN "embedding_model_name";--> statement-breakpoint
ALTER TABLE "system_settings" DROP COLUMN "active_embedding_connection_id";--> statement-breakpoint
-- Nothing is left on it: the endpoint halves are the connection, the TTL is on
-- the connection, and `mode` was only ever the question "which half is live",
-- which the connection's TYPE answers.
DROP TABLE "vectorization_configs";
