ALTER TABLE "characters" ADD COLUMN "uuid" uuid DEFAULT (gen_random_uuid ()) NOT NULL;--> statement-breakpoint
ALTER TABLE "lorebooks" ADD COLUMN "uuid" uuid DEFAULT (gen_random_uuid ()) NOT NULL;--> statement-breakpoint
ALTER TABLE "personas" ADD COLUMN "uuid" uuid DEFAULT (gen_random_uuid ()) NOT NULL;--> statement-breakpoint
CREATE UNIQUE INDEX "characters_uuid_idx" ON "characters" USING btree ("uuid");--> statement-breakpoint
CREATE UNIQUE INDEX "lorebooks_uuid_idx" ON "lorebooks" USING btree ("uuid");--> statement-breakpoint
CREATE UNIQUE INDEX "personas_uuid_idx" ON "personas" USING btree ("uuid");