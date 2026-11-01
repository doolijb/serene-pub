DROP INDEX "voicebank_voices_one_default";--> statement-breakpoint
ALTER TABLE "voicebank_voices" DROP COLUMN "is_default";--> statement-breakpoint
ALTER TABLE "voicebank_voices" DROP COLUMN "is_narration_default";