-- HAND-EDITED, and this is the whole of the edit: the DO block below was
-- added AHEAD of the generated DDL. drizzle-kit cannot express a data merge,
-- and without one this migration is unrunnable on any install that already
-- has two bindings for one character — CREATE UNIQUE INDEX validates the
-- existing rows and refuses outright. Duplicates were legal until now: the
-- index it replaces, (lorebook_id, character_id, persona_id), could never
-- fire, because exactly one of the two id columns is always NULL, NULL is
-- distinct from NULL, and it was not declared nullsNotDistinct. The app has
-- produced them: "Pull the cast from this session" (removed, ruling
-- 2026-09-12) emitted one lorebooks:createBinding per member with no
-- existence check, so pressing it twice bound everyone twice.
--
-- ⚠ No binding_merge_logs row is written for these merges, and that is
-- deliberate rather than an omission. Every row in that table is an OFFER TO
-- UNDO — narrativeGraph:undoMerge re-inserts the absorbed row from its
-- snapshot, and CastDuplicatesPanel puts a button on it. A merge performed
-- here cannot be undone: re-inserting the second binding for that character
-- is exactly what the index created below refuses. A log row would be a
-- button that always errors, so the merges are recorded in the notes here
-- instead of as reversals that are not available.
DO $$
DECLARE
	dup RECORD;
	survivor_name text;
	existing_aliases text[];
	merged_aliases text[];
BEGIN
	-- One duplicate per pass, with the groups recomputed each time, rather
	-- than one cursor over a snapshot. A row is allowed to carry BOTH a
	-- character_id and a persona_id, so it can sit in two groups at once —
	-- the oldest of one and a duplicate of the other. A snapshot would hand
	-- out a survivor id and then delete that very row on an earlier pass,
	-- leaving the next repointing to aim at nothing. Recomputing means every
	-- survivor named is a row that still exists, and each pass deletes
	-- exactly one row, so the loop always ends.
	LOOP
		WITH groups AS (
			SELECT lorebook_id, character_id AS entity_id, 'character'::text AS kind
			FROM lorebook_bindings
			WHERE character_id IS NOT NULL
			GROUP BY lorebook_id, character_id
			HAVING COUNT(*) > 1
			UNION ALL
			SELECT lorebook_id, persona_id, 'persona'::text
			FROM lorebook_bindings
			WHERE persona_id IS NOT NULL
			GROUP BY lorebook_id, persona_id
			HAVING COUNT(*) > 1
		),
		members AS (
			SELECT
				b.id,
				MIN(b.id) OVER (
					PARTITION BY g.lorebook_id, g.kind, g.entity_id
				) AS survivor_id
			FROM groups g
			JOIN lorebook_bindings b
				ON b.lorebook_id = g.lorebook_id
				AND (
					(g.kind = 'character' AND b.character_id = g.entity_id)
					OR (g.kind = 'persona' AND b.persona_id = g.entity_id)
				)
		)
		SELECT m.id AS duplicate_id, m.survivor_id
		INTO dup
		FROM members m
		WHERE m.id <> m.survivor_id
		ORDER BY m.survivor_id, m.id
		LIMIT 1;

		EXIT WHEN NOT FOUND;

		-- Character lore's privacy anchor. ON DELETE SET NULL, so without
		-- this the lore attached to the duplicate goes permanently unbound
		-- the moment the row goes.
		UPDATE lorebook_entries
		SET anchor_binding_id = dup.survivor_id
		WHERE anchor_binding_id = dup.duplicate_id;

		-- The legacy character_lore_entries table. Nothing reads it any more,
		-- but it is still a real column with the same SET NULL exposure and
		-- an install upgraded from 0.5 may still hold rows in it.
		UPDATE character_lore_entries
		SET character_binding_id = dup.survivor_id
		WHERE character_binding_id = dup.duplicate_id;

		-- Graph edges between the two rows would become edges from the
		-- survivor to itself, which is not a relationship. Removed BEFORE the
		-- repointing rather than after, so a self-loop that predates this
		-- migration is left exactly as it was found.
		DELETE FROM narrative_relationships
		WHERE (from_node_id = dup.duplicate_id AND to_node_id = dup.survivor_id)
			OR (from_node_id = dup.survivor_id AND to_node_id = dup.duplicate_id)
			OR (from_node_id = dup.duplicate_id AND to_node_id = dup.duplicate_id);

		-- Only the cast endpoints move: an entry endpoint is in the *_entry_id
		-- columns and is never a binding id, so the endpoint CHECK still holds.
		UPDATE narrative_relationships
		SET from_node_id = dup.survivor_id
		WHERE from_node_id = dup.duplicate_id;
		UPDATE narrative_relationships
		SET to_node_id = dup.survivor_id
		WHERE to_node_id = dup.duplicate_id;

		-- Scene appearances MOVE to the survivor; the cascade would take them
		-- with the row instead. scene_characters is unique on
		-- (scene_id, binding_id, role), so where the survivor already appears
		-- in that scene under that role the duplicate's row is dropped rather
		-- than repointed onto a key that is taken.
		DELETE FROM scene_characters sc
		WHERE sc.binding_id = dup.duplicate_id
			AND EXISTS (
				SELECT 1 FROM scene_characters keep
				WHERE keep.scene_id = sc.scene_id
					AND keep.binding_id = dup.survivor_id
					AND keep.role = sc.role
			);
		UPDATE scene_characters
		SET binding_id = dup.survivor_id
		WHERE binding_id = dup.duplicate_id;

		-- Alias children of the duplicate become the survivor's (parent_node_id
		-- is SET NULL on delete, which would orphan them silently).
		UPDATE lorebook_bindings
		SET parent_node_id = dup.survivor_id
		WHERE parent_node_id = dup.duplicate_id;
		-- A survivor parented to the duplicate is now parented to itself.
		UPDATE lorebook_bindings
		SET parent_node_id = NULL
		WHERE id = dup.survivor_id AND parent_node_id = dup.survivor_id;

		-- What `add` on a binding suggestion created.
		UPDATE binding_suggestions
		SET resolved_binding_id = dup.survivor_id
		WHERE resolved_binding_id = dup.duplicate_id;

		-- Identities go to absorbed_aliases, NEVER to aliases: aliases is a
		-- one-directional projection of the bound character/persona that every
		-- sync REPLACES wholesale, so a name written there vanishes the next
		-- time that entity is edited at all. Both rows name the same entity,
		-- so this is usually a no-op; it is not when one of them was renamed
		-- or absorbed something before this ran.
		SELECT s.name INTO survivor_name
		FROM lorebook_bindings s WHERE s.id = dup.survivor_id;
		SELECT ARRAY(SELECT json_array_elements_text(s.absorbed_aliases))
		INTO existing_aliases
		FROM lorebook_bindings s WHERE s.id = dup.survivor_id;
		SELECT ARRAY(
			SELECT DISTINCT u.a FROM (
				SELECT unnest(existing_aliases) AS a
				UNION
				SELECT d.name FROM lorebook_bindings d WHERE d.id = dup.duplicate_id
				UNION
				SELECT json_array_elements_text(d.aliases)
				FROM lorebook_bindings d WHERE d.id = dup.duplicate_id
				UNION
				SELECT json_array_elements_text(d.absorbed_aliases)
				FROM lorebook_bindings d WHERE d.id = dup.duplicate_id
			) u
			WHERE u.a IS NOT NULL
				AND btrim(u.a) <> ''
				AND u.a <> COALESCE(survivor_name, '')
		) INTO merged_aliases;

		IF NOT (merged_aliases <@ existing_aliases) THEN
			-- The survivor answers to a name it did not before, so its stored
			-- vector is for an identity it no longer only has. Cleared, which
			-- re-queues it.
			UPDATE lorebook_bindings
			SET absorbed_aliases = to_json(merged_aliases),
				embedding = NULL,
				embedding_model = NULL,
				vectorized_at = NULL
			WHERE id = dup.survivor_id;
		END IF;

		-- First-appearance tracking, taken only where the survivor has none.
		UPDATE lorebook_bindings s
		SET scene_id = COALESCE(s.scene_id, d.scene_id),
			history_entry_id = COALESCE(s.history_entry_id, d.history_entry_id)
		FROM lorebook_bindings d
		WHERE s.id = dup.survivor_id AND d.id = dup.duplicate_id;

		-- dismissed_duplicate_pairs rows naming this row go with it, by its own
		-- cascade: "these two are not the same person" is not a claim that
		-- survives one of the two ceasing to exist.
		--
		-- binding_merge_logs.survivor_id is SET NULL by its own FK if a log
		-- named this row as a survivor, which is that column's documented
		-- meaning: the merge stays on record and its undo is unavailable.
		DELETE FROM lorebook_bindings WHERE id = dup.duplicate_id;
	END LOOP;
END $$;
--> statement-breakpoint
DROP INDEX "lorebook_bindings_unique";--> statement-breakpoint
CREATE UNIQUE INDEX "lorebook_bindings_character_unique" ON "lorebook_bindings" USING btree ("lorebook_id","character_id") WHERE "character_id" IS NOT NULL;--> statement-breakpoint
CREATE UNIQUE INDEX "lorebook_bindings_persona_unique" ON "lorebook_bindings" USING btree ("lorebook_id","persona_id") WHERE "persona_id" IS NOT NULL;
