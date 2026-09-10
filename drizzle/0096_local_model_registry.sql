ALTER TABLE "koboldcpp_models" RENAME TO "local_models";--> statement-breakpoint
ALTER TABLE "local_models" DROP CONSTRAINT "koboldcpp_models_filename_unique";--> statement-breakpoint
ALTER TABLE "local_models" ADD COLUMN "format" text DEFAULT 'gguf' NOT NULL;--> statement-breakpoint
ALTER TABLE "local_models" ADD COLUMN "modality" text;--> statement-breakpoint
ALTER TABLE "local_models" ADD CONSTRAINT "local_models_filename_unique" UNIQUE("filename");--> statement-breakpoint
-- ── Backfill, hand-added below the generated DDL ────────────────────────────
--
-- Three UPDATEs, no schema. Generation cannot write these: drizzle-kit's job
-- ends at the column existing, and both new columns describe rows that are
-- already on disk. They are appended rather than hand-edited INTO the DDL above
-- and rather than split into their own file: `drizzle/meta/*_snapshot.json`
-- models schema and nothing else, so DML here cannot drift the snapshot chain —
-- which is the whole reason generated SQL is otherwise left alone.
--
-- ⚠ `format` is NOT uniformly 'gguf'. The column default backfilled every row
-- to it, and that is wrong for the `.safetensors` rows this table has always
-- been able to hold: `MODEL_EXTENSION_RE` admits both extensions, and
-- `extensionAllowedForKind` accepts a .safetensors for an image model. Writing
-- 'gguf' onto one would record a falsehood about a file we can simply look at —
-- and `format` is the detectable half of this row, the half that is supposed to
-- need no trust ordering at all. `.onnx` needs no case: nothing before this
-- migration could put one in the table.
UPDATE "local_models" SET "format" = 'safetensors'
WHERE lower("filename") LIKE '%.safetensors';--> statement-breakpoint
-- `modality` is the undetectable half, so it is projected from `kind` by
-- exactly the mapping `modalityForKind` applies at every write site — one
-- function, one direction, so the two columns cannot come to disagree.
--
-- `kind = 'unknown'` is deliberately left NULL. The classifier reaching
-- `unknown` means it looked and could not tell; 'text-gen' there would turn "we
-- do not know" into an assertion, and an unreadable file offered as a working
-- text model fails at load time with nothing on screen to say why.
UPDATE "local_models" SET "modality" = 'text-gen' WHERE "kind" = 'text';--> statement-breakpoint
UPDATE "local_models" SET "modality" = 'image-gen' WHERE "kind" = 'image';
