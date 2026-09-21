ALTER TABLE "session_layout_presets" ADD COLUMN "origin" text DEFAULT 'user' NOT NULL;--> statement-breakpoint
ALTER TABLE "session_layout_presets" ADD COLUMN "plugin_id" text;--> statement-breakpoint
ALTER TABLE "session_layout_presets" ADD COLUMN "withdrawn_at" timestamp;--> statement-breakpoint
ALTER TABLE "session_layout_presets" ADD COLUMN "slug" text DEFAULT '' NOT NULL;--> statement-breakpoint
ALTER TABLE "session_layout_presets" ADD COLUMN "description" text;--> statement-breakpoint
ALTER TABLE "session_layout_presets" ADD COLUMN "visibility" text DEFAULT 'private' NOT NULL;--> statement-breakpoint
ALTER TABLE "session_layout_presets" ADD COLUMN "document" json;--> statement-breakpoint
ALTER TABLE "session_layout_presets" ADD COLUMN "widget_settings" json;--> statement-breakpoint
ALTER TABLE "session_layout_presets" ADD COLUMN "widget_styles" json;--> statement-breakpoint
ALTER TABLE "session_layout_presets" ADD COLUMN "seeded_by_version" text;--> statement-breakpoint
ALTER TABLE "session_panel_layouts" ADD COLUMN "document" json;--> statement-breakpoint
-- ─── data step ──────────────────────────────────────────────────────────────
-- ⚠ ORDER IS LOAD-BEARING. Every pre-existing row reaches this point holding
-- the new columns' DEFAULTS (`origin = 'user'`, `slug = ''`, `visibility =
-- 'private'`), and both the CHECK constraints and the partial unique indexes
-- below would refuse the table in that state: a seeded row is not `user`, and
-- two user rows in one genre would collide on the empty slug. So the three
-- derivations run here — after the columns exist, before anything is enforced.
--
-- `origin` is derived from `seed_key`, and so are `slug` and `visibility`,
-- rather than from the `origin` this same statement is writing: Postgres reads
-- the row as it was when the statement began, so a SET that referenced
-- `"origin"` would read `'user'` for every row including the seeded ones.

-- (a) The row the shape says cannot exist: authored AND seed-keyed. Nothing in
-- the app writes one (`saveUserLayoutPreset` writes NULL), and the reconciler
-- already refuses to touch it — which means such a row silently OCCUPIES its
-- genre's seed key and stops that genre's default from ever being seeded. The
-- author is the fact to keep (somebody saved it); the key is the fact to drop.
UPDATE "session_layout_presets"
SET "seed_key" = NULL
WHERE "seed_key" IS NOT NULL AND "author_user_id" IS NOT NULL;--> statement-breakpoint

-- (b) …and the mirror of it: no key and no author. Unreachable for editing and
-- listed to everybody as a built-in, which is what it stays — a synthesized,
-- non-canonical key makes it a `core` row the triple CHECK accepts. The boot
-- reconciler prunes stale-keyed rows of the genres it syncs, so one of these
-- goes the way a row left by an older key scheme already goes today.
UPDATE "session_layout_presets"
SET "seed_key" = 'layout:' || "genre_id" || ':legacy-' || "id"
WHERE "seed_key" IS NULL AND "author_user_id" IS NULL;--> statement-breakpoint

-- (c) The derivation itself.
--
-- `slug` is the stable key within an owner, so it must be unique per
-- (genre, origin, plugin) and per (author, genre) — which is exactly what the
-- two partial unique indexes below enforce. Hence the middle branch: only the
-- CANONICAL seed key (`layout:<genreId>:default`, `layoutPresetSeedKey`) earns
-- the reserved slug `default`; a row left behind by an older key scheme — the
-- case the reconciler's prune is written for — takes `legacy-<id>` instead, so
-- two seeded rows in one genre cannot collide. A person's row takes its name,
-- kebabed, with the id appended: the id is what makes it unique per author and
-- genre without having to look at anybody else's names.
UPDATE "session_layout_presets"
SET
	"origin" = CASE WHEN "seed_key" IS NOT NULL THEN 'core' ELSE 'user' END,
	"slug" = CASE
		WHEN "seed_key" = 'layout:' || "genre_id" || ':default' THEN 'default'
		WHEN "seed_key" IS NOT NULL THEN 'legacy-' || "id"
		ELSE lower(regexp_replace("name", '[^a-zA-Z0-9]+', '-', 'g')) || '-' || "id"
	END,
	"visibility" = CASE WHEN "seed_key" IS NOT NULL THEN 'shared' ELSE 'private' END;--> statement-breakpoint
CREATE INDEX "session_layout_presets_plugin_idx" ON "session_layout_presets" USING btree ("plugin_id");--> statement-breakpoint
CREATE UNIQUE INDEX "session_layout_presets_shipped_slug_idx" ON "session_layout_presets" USING btree ("genre_id","origin",coalesce("plugin_id", ''),"slug") WHERE "session_layout_presets"."origin" <> 'user';--> statement-breakpoint
CREATE UNIQUE INDEX "session_layout_presets_author_slug_idx" ON "session_layout_presets" USING btree ("author_user_id","genre_id","slug") WHERE "session_layout_presets"."origin" = 'user';--> statement-breakpoint
ALTER TABLE "session_layout_presets" ADD CONSTRAINT "session_layout_presets_origin_check" CHECK ("session_layout_presets"."origin" IN ('core', 'plugin', 'user'));--> statement-breakpoint
ALTER TABLE "session_layout_presets" ADD CONSTRAINT "session_layout_presets_visibility_check" CHECK ("session_layout_presets"."visibility" IN ('shared', 'private'));--> statement-breakpoint
ALTER TABLE "session_layout_presets" ADD CONSTRAINT "session_layout_presets_origin_triple_check" CHECK (("session_layout_presets"."origin" = 'core' AND "session_layout_presets"."seed_key" IS NOT NULL AND "session_layout_presets"."plugin_id" IS NULL AND "session_layout_presets"."author_user_id" IS NULL)
				OR ("session_layout_presets"."origin" = 'plugin' AND "session_layout_presets"."seed_key" IS NOT NULL AND "session_layout_presets"."plugin_id" IS NOT NULL AND "session_layout_presets"."author_user_id" IS NULL)
				OR ("session_layout_presets"."origin" = 'user' AND "session_layout_presets"."seed_key" IS NULL AND "session_layout_presets"."plugin_id" IS NULL AND "session_layout_presets"."author_user_id" IS NOT NULL));