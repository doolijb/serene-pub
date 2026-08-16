ALTER TABLE "lorebooks" ADD COLUMN "next_binding_number" integer DEFAULT 1 NOT NULL;
--> statement-breakpoint
-- Seed each lorebook's counter past the highest {{char:N}} number already
-- baked into its own bindings' tokens (old tokens are numbered from the
-- binding row's global id, so they can be arbitrarily large/sparse) — this
-- guarantees the first new binding created after this migration can never
-- collide with a number already embedded in stored lore/history content.
-- Lorebooks with no bindings yet are unaffected by the default (1).
UPDATE "lorebooks" l
SET "next_binding_number" = m.max_number + 1
FROM (
	SELECT lorebook_id, MAX((regexp_match(binding, '\{\{char:([0-9]+)\}\}'))[1]::int) AS max_number
	FROM "lorebook_bindings"
	WHERE binding ~ '\{\{char:([0-9]+)\}\}'
	GROUP BY lorebook_id
) m
WHERE m.lorebook_id = l.id;