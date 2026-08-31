-- Drop the six pre-28 media mechanisms, now that the data upgrade anchored to
-- 0166_media has copied every resolvable reference into `media`.
--
-- A SEPARATE migration from 0166 on purpose: the upgrade runs in 0166's
-- transaction, so a failure there rolls back with all of this source data still
-- present. Dropping in the same step would make a partial upgrade
-- unrecoverable.
--
-- `characters.assets` is dropped without a migration step because it is dead —
-- nothing has ever written it (`buildCharacterCardV3` emits no `assets` field
-- and the card parser never populated the column) and nothing has ever read it.
ALTER TABLE "characters" DROP COLUMN "avatar";
--> statement-breakpoint
ALTER TABLE "characters" DROP COLUMN "assets";
--> statement-breakpoint
ALTER TABLE "personas" DROP COLUMN "avatar";
--> statement-breakpoint
-- `user_settings.background_image_path` is deliberately NOT dropped. It names a
-- background that ships with the app (`/backgrounds/defaults/*.webp`) — a
-- static asset owned by no user, with no bytes to move into `media`. Only
-- *uploaded* backgrounds migrate; the two columns are mutually exclusive.
--> statement-breakpoint
DROP TABLE "character_gallery_images";
--> statement-breakpoint
DROP TABLE "persona_gallery_images";
--> statement-breakpoint
DROP TABLE "session_assets";
