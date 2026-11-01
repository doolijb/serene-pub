ALTER TABLE "lore_imprints" DROP CONSTRAINT "lore_imprints_subject_kind_check";--> statement-breakpoint
ALTER TABLE "plugin_files" ALTER COLUMN "content" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "lorebooks" ADD COLUMN "annex" jsonb DEFAULT '{}'::jsonb NOT NULL;--> statement-breakpoint
ALTER TABLE "lorebooks" ADD COLUMN "annex_audiences" jsonb DEFAULT '{}'::jsonb NOT NULL;--> statement-breakpoint
ALTER TABLE "plugin_files" ADD COLUMN "stored_at" text DEFAULT 'db' NOT NULL;--> statement-breakpoint
ALTER TABLE "plugin_files" ADD COLUMN "disk_path" text;--> statement-breakpoint
ALTER TABLE "plugin_files" ADD COLUMN "kind" text DEFAULT 'ui' NOT NULL;--> statement-breakpoint
ALTER TABLE "lore_imprints" ADD CONSTRAINT "lore_imprints_subject_kind_check" CHECK ("lore_imprints"."subject_kind" IN ('entry', 'relationship', 'member', 'overlay', 'annex'));