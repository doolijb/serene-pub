DROP INDEX "characters_uuid_idx";--> statement-breakpoint
DROP INDEX "lorebooks_uuid_idx";--> statement-breakpoint
DROP INDEX "personas_uuid_idx";--> statement-breakpoint
CREATE UNIQUE INDEX "characters_uuid_idx" ON "characters" USING btree ("user_id","uuid");--> statement-breakpoint
CREATE UNIQUE INDEX "lorebooks_uuid_idx" ON "lorebooks" USING btree ("user_id","uuid");--> statement-breakpoint
CREATE UNIQUE INDEX "personas_uuid_idx" ON "personas" USING btree ("user_id","uuid");