ALTER TABLE "entry_amendments" ALTER COLUMN "year" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "entry_amendments" ADD COLUMN "source_message_id" integer;--> statement-breakpoint
ALTER TABLE "entry_amendments" ADD COLUMN "base" jsonb;--> statement-breakpoint
ALTER TABLE "lore_imprints" ADD COLUMN "origin" text DEFAULT 'run' NOT NULL;--> statement-breakpoint
ALTER TABLE "lore_imprints" ADD COLUMN "batch" text;--> statement-breakpoint
ALTER TABLE "lore_imprints" ADD COLUMN "cause" jsonb;--> statement-breakpoint
ALTER TABLE "entry_amendments" ADD CONSTRAINT "entry_amendments_undated_check" CHECK (("entry_amendments"."year" IS NOT NULL OR ("entry_amendments"."base" IS NOT NULL AND "entry_amendments"."month" IS NULL)));--> statement-breakpoint
ALTER TABLE "lore_imprints" ADD CONSTRAINT "lore_imprints_origin_check" CHECK ("lore_imprints"."origin" IN ('run', 'routine', 'press', 'person', 'apply', 'book-run', 'upgrade'));