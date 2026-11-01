ALTER TABLE "voicebank_voices" ADD COLUMN "loadout_id" integer;--> statement-breakpoint
ALTER TABLE "voicebank_voices" ADD CONSTRAINT "voicebank_voices_loadout_id_loadouts_id_fk" FOREIGN KEY ("loadout_id") REFERENCES "public"."loadouts"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "voicebank_voices_loadout_idx" ON "voicebank_voices" USING btree ("loadout_id");