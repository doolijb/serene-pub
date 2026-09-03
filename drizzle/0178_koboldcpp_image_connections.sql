-- Where image models live, or NULL to use "koboldcpp_models_dir".
--
-- NULL is the upgrade contract, not a missing value. Nullable and with NO
-- default so that every row that exists right now stays NULL: reads fall back
-- to the text directory (modelsDir.ts), so an install with one flat directory
-- keeps finding every model it already has, in place. Fresh installs are seeded
-- <appdata>/models/image by defaults.ts, beside the models/llm the default has
-- always named.
--
-- Existing rows are deliberately NEVER backfilled, here or on boot. Backfilling
-- would split a working install in half — new downloads landing in models/image
-- while every model the user owns sits in models/llm, and the Settings tab
-- showing a directory they never chose.
--
-- And deliberately no file movement. A migration that relocated multi-gigabyte
-- model files would be unrecoverable if interrupted, and the read-side fallback
-- makes it unnecessary: a legacy flat install's image models stay loadable and
-- deletable exactly where they are. Writes never fall back.
ALTER TABLE "koboldcpp_settings" ADD COLUMN "koboldcpp_image_models_dir" text;--> statement-breakpoint

-- Strip the persisted "this LLM can draw pictures" residue.
--
-- This is the statement that fixes the reported bug on an install that already
-- has it: a managed TEXT connection showing up in the image-generation picker.
-- Deleting the code that wrote it does not help, because the claim is already on
-- disk in connections.capabilities.
--
-- WHICH ROWS, and why this is provably safe rather than a judgement call.
-- Only type = 'koboldcpp_managed'. syncImageCapabilityOverride (deleted in this
-- change set) is the ONLY writer of overrides['text->image'] on rows of this
-- type that has ever existed: there is no capability-toggle UI — connections.ts
-- says so in as many words, in the future tense — and connections:update strips
-- a client-supplied `capabilities` before writing. So there is no route by which
-- a user could have set this deliberately, and nothing deliberate is destroyed.
-- Plain 'koboldcpp' rows are untouched: those point at somebody else's process,
-- which this app does not load models for, so their probe is the honest owner of
-- the question and may legitimately have answered yes.
--
-- WHY 'resolved' AND NOT JUST 'overrides'. `resolved` is the CACHE that
-- capabilityRefusal (capabilityGuard.ts) and the config picker (choicesFor,
-- which reads c.capabilities?.resolved) actually read. Nothing recomputes it
-- until some unrelated write happens to call persistCapabilities, so clearing
-- only the override would leave the connection advertising image generation in
-- the picker and in Connections — forever. That is the specific way this change
-- would ship looking correct with the reported symptom still on screen.
--
-- WHY SURGICAL RATHER THAN A WIPE. Trimming one key preserves everything else
-- determined about the row. Clearing the whole object would also be safe
-- (capabilityRefusal treats an empty set as undetermined and falls back to
-- modalityAllows, which answers false for text->image on a text-gen row) but
-- would drop good data for no gain.
--
-- WHY 'probe' IS LEFT ALONE. It is a record of what a backend answered at a
-- point in time, and a KoboldCPP holding an image model genuinely did report
-- txt2img. Now that text->image is out of KOBOLDCPP_MANAGED's `supports`,
-- resolveCapabilities cannot emit it from any layer, so the record is inert.
-- Rewriting it would be a lie about a measurement.
--
-- The ::jsonb casts are required: the column is `json` and #- is a jsonb
-- operator. jsonb_exists(...) is spelled out rather than using the `?` operator
-- so no driver mistakes it for a bind placeholder.
UPDATE "connections" SET "capabilities" = (
		("capabilities"::jsonb #- ARRAY['overrides','text->image'])
		                       #- ARRAY['resolved','text->image']
	)::json
WHERE "type" = 'koboldcpp_managed'
	AND (jsonb_exists("capabilities"::jsonb -> 'overrides', 'text->image')
		OR jsonb_exists("capabilities"::jsonb -> 'resolved',  'text->image'));--> statement-breakpoint

-- Carry the user's image-model selection forward as a CONNECTION.
--
-- 0177 put the image model on the manager as an instance-level setting, on the
-- reasoning that one koboldcpp process holds one text plus one image model. That
-- reasoning conflated two questions. A connection names exactly ONE model —
-- two models mandate two connections — while WHICH of them is resident in the
-- process at any moment belongs to the model manager, and today's answer to that
-- ("one at a time") is a scheduling policy that can change without any of this
-- moving.
--
-- So the setting becomes a row of the new 'koboldcpp_managed_image' type. This
-- statement exists because a dev install may already have 0177 applied with a
-- value set, and without it the reversal would silently delete a working image
-- setup — the difference between the user getting a picture and not.
--
-- Guarded and idempotent, and no hardcoded id: the NOT EXISTS makes a re-run a
-- no-op, and identity is the filename rather than a number.
--
-- base_url is copied for display only. dispatchImage.resolveBaseUrl and the
-- managed image adapter both take the Manager's own settings as authoritative
-- for a managed row, so what lands in this column is never what gets dialled.
--
-- The literal capabilities.resolved duplicates the manifest, and that is
-- acceptable HERE and nowhere else: the new type declares exactly one native
-- capability with no preset layer and no probe layer, and closure() is identity
-- for it because IMPLIES/EMULATABLE_VIA cover only feature capabilities, never
-- transforms. There is exactly one value resolveCapabilities can produce, and
-- the first connections:update re-resolves it from the real manifest anyway.
INSERT INTO "connections"
	("name", "type", "modality", "model", "base_url", "extra_json", "capabilities", "token_counter")
SELECT
	regexp_replace(s."koboldcpp_managed_image_model", '\.(gguf|safetensors)$', '', 'i'),
	'koboldcpp_managed_image',
	'image-gen',
	s."koboldcpp_managed_image_model",
	s."koboldcpp_base_url",
	'{}'::json,
	'{"resolved":{"text->image":"native"}}'::json,
	'estimate'
FROM "koboldcpp_settings" s
WHERE s."koboldcpp_managed_image_model" IS NOT NULL
	AND NOT EXISTS (
		SELECT 1 FROM "connections" c
		WHERE c."type" = 'koboldcpp_managed_image'
			AND c."model" = s."koboldcpp_managed_image_model"
	);--> statement-breakpoint

-- Register it as the instance's text->image default, but only if nothing already
-- holds that slot. A user who deliberately pointed image generation at an A1111
-- must not have it taken away by an upgrade.
--
-- ON CONFLICT rather than a plain INSERT because `capability` is the PRIMARY KEY
-- and a 'text->image' row very probably already EXISTS: 0175 seeded one from
-- system_settings.default_image_sampling_id, which 0172 had pointed at the
-- seeded image sampling config. That row carries a sampling config and a NULL
-- connection_id, which is exactly the case worth filling in — and the WHERE
-- guard is what keeps the DO UPDATE from firing on a row that names a real
-- connection. Updating only connection_id leaves that sampling choice standing.
INSERT INTO "connection_defaults" ("capability", "connection_id")
SELECT 'text->image', c."id"
FROM "connections" c
WHERE c."type" = 'koboldcpp_managed_image'
	AND NOT EXISTS (
		SELECT 1 FROM "connection_defaults" d
		WHERE d."capability" = 'text->image' AND d."connection_id" IS NOT NULL
	)
ORDER BY c."id"
LIMIT 1
ON CONFLICT ("capability") DO UPDATE SET "connection_id" = EXCLUDED."connection_id";--> statement-breakpoint

-- The instance-level image model, superseded by the connection above.
--
-- Dropped rather than left to linger, unlike `connections.modality` in 0175: this
-- column is a Ruling-1 violation (one row naming two models), so a reader that
-- still consults it is a bug, and a column that merely still exists is one more
-- place for that bug to hide. Nothing released ever shipped it — 0177 landed on
-- this branch hours ago — and the statement above has already carried the only
-- value it could have held.
ALTER TABLE "koboldcpp_settings" DROP COLUMN "koboldcpp_managed_image_model";
