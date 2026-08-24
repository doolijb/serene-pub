-- Contributed surfaces, mode fields, and the fields port (19 §1, §3–§4).
--
-- `contributes` on spec versions stores what a version offers to other
-- surfaces — the narrate spec's narrator button on the standard mode is the
-- first — like `mode` before it, so function routing and the trigger UI are
-- SELECTs. `mode_fields` on chats holds values for the mode's declared
-- fields, supplied back through the input node's published document.
--
-- `user-message` re-projects once more: it gains the `fields` out-port the
-- round trip publishes through, and ports are the original hashed contract.
ALTER TABLE "pipeline_spec_versions" ADD COLUMN "contributes" json;--> statement-breakpoint
ALTER TABLE "chats" ADD COLUMN "mode_fields" json DEFAULT '{}'::json NOT NULL;--> statement-breakpoint
DELETE FROM "pipeline_type_registry"
WHERE "type_id" = 'core:input/user-message' AND "version" = 1;
