ALTER TABLE "characters" ADD COLUMN "aliases" json DEFAULT '[]'::json NOT NULL;--> statement-breakpoint
ALTER TABLE "personas" ADD COLUMN "aliases" json DEFAULT '[]'::json NOT NULL;