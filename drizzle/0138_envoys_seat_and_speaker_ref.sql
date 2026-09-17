ALTER TABLE "session_characters" ADD COLUMN "envoy_slug" text;--> statement-breakpoint
CREATE UNIQUE INDEX "session_characters_envoy_idx" ON "session_characters" USING btree ("session_id","envoy_slug");--> statement-breakpoint
ALTER TABLE "session_characters" ADD CONSTRAINT "session_characters_one_seat_check" CHECK (NOT ("session_characters"."character_id" IS NOT NULL AND "session_characters"."envoy_slug" IS NOT NULL));--> statement-breakpoint
-- `metadata.speaker` on a message row is the participant reference now
-- (`character:<id>` | `envoy:<slug>`), as it is on the inlet (R-18 (3), R1 —
-- one word, one meaning). The side-character FACT `{ name, characterId,
-- known }` that lived under that key since the narrator split moves to
-- `metadata.sideCharacter`, the name its inlet port took on 2026-09-16.
-- Only an object moves: a string under `speaker` is already a reference.
-- Re-running is a no-op — a moved row has no object at `speaker` any more.
--
-- A moved row gets its reference in the same step where one can be written
-- (U5g review, W5): a fact with an integer `characterId` (a number, or the
-- digits as text — `->>` reads either) names a character, so `speaker`
-- becomes `character:<id>`. A fact with none — a side
-- character somebody typed a name for and never linked to a library row —
-- has no participant to reference, and the row is left with no `speaker`:
-- there is nothing true to write, and a reference to nobody would be read
-- as one (`parseParticipantRef` would refuse it, and the row would carry
-- noise). The fact itself, under `sideCharacter`, keeps the typed name.
UPDATE "session_messages"
SET "metadata" = (
	(
		("metadata"::jsonb - 'speaker')
		|| jsonb_build_object('sideCharacter', "metadata"::jsonb -> 'speaker')
		|| CASE
			WHEN ("metadata"::jsonb -> 'speaker' ->> 'characterId') ~ '^[0-9]+$'
			THEN jsonb_build_object('speaker', 'character:' || ("metadata"::jsonb -> 'speaker' ->> 'characterId'))
			ELSE '{}'::jsonb
		END
	)::json
)
WHERE json_typeof("metadata" -> 'speaker') = 'object';
