ALTER TABLE "sessions" DROP CONSTRAINT "sessions_connection_id_connections_id_fk";
--> statement-breakpoint
ALTER TABLE "sessions" DROP COLUMN "connection_id";