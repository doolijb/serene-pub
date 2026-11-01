ALTER TABLE "voicebank_voices" DROP CONSTRAINT "voicebank_voices_connection_model_id_connection_models_id_fk";
--> statement-breakpoint
DROP INDEX "voicebank_voices_connection_model_idx";--> statement-breakpoint
ALTER TABLE "voicebank_voices" DROP COLUMN "connection_model_id";