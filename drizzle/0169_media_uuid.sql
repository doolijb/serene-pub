-- Address media by an opaque, rotatable uuid instead of its row id (28).
--
-- The uuid is a cache token: it changes whenever what the row serves could
-- differ from what a browser already cached (today, a regenerated thumbnail).
-- That is what lets every media response be `immutable` for a year — a changed
-- image is a changed URL, so nothing has to revalidate. It also stops the row
-- id, and therefore the size of the instance's media table, leaking into URLs.
ALTER TABLE "media" ADD COLUMN "uuid" uuid DEFAULT (gen_random_uuid ()) NOT NULL;
--> statement-breakpoint
CREATE UNIQUE INDEX "media_uuid_unique" ON "media" ("uuid");
