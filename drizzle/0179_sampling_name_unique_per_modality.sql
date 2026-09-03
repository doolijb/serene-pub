-- Sampling config names are unique PER MODALITY.
--
-- `seed_key` was the only unique thing on this table, and it constrains the
-- seeder rather than anything a person does — so two configs called
-- "Default (Image)" have always been possible. Every picker in the app shows a
-- sampling config by name alone (the sidebar list, EditSessionForm, every
-- per-task override selector), so two rows sharing one name are genuinely
-- indistinguishable at the point of choosing, and users clone configs
-- constantly. This change set is also about to take the built-in image list from
-- one row to five, which is what makes it worth fixing now rather than later.
--
-- Scoped to the modality rather than made global because "Default" is a fair
-- name for a text preset AND for an image one — they are never offered in the
-- same list — and a global constraint would force the built-ins into names that
-- read like workarounds.
--
-- MODALITY IS PARSED FROM `shape`. No new column: `shape` already answers the
-- question, and a stored copy is a second source of truth that drifts the first
-- time a row is written without it. No CASE mapping either, for the same reason
-- — that is a real second copy. `split_part(split_part(shape,'/',2),'@',1)` is
-- the exact inverse of `shapeOfModality()` in
-- src/lib/shared/constants/ConnectionTypes.ts, which BUILDS ids from the
-- template `core:shape/<modality>@<version>`; the grammar this depends on is
-- asserted by the code that writes it. It is version tolerant (`@2` buckets with
-- `@1`) and an unknown plugin shape buckets into its own namespace, which is the
-- safe failure direction: such a row competes for names only with its own kind.
--
-- ⚠ And deliberately no contact with `CapabilityId`/`CapabilitySet`. A modality
-- is a coarse filing category — "text gen", "image gen" — and says nothing about
-- what a connection can multimodally do. This codebase has already been burned
-- making one scalar carry both meanings.
--
-- `lower` because "Default" and "default" are one name to a person. `btrim`
-- because NewNameModal's zod trims for VALIDATION only and then hands
-- `onConfirm` the untrimmed string, so " Default" reaches the table with its
-- space still attached.

-- Existing collisions, resolved BEFORE the index is created.
--
-- Without this the whole migration fails on exactly the installs that had the
-- problem — an upgrade that refuses to start, which is worse than the duplicate
-- names it was meant to fix.
--
-- WHICH ROW KEEPS THE NAME: the user's. `ORDER BY (seed_key IS NOT NULL), id`
-- puts user-created rows (seed_key NULL, so `false`) first, oldest first, and a
-- built-in yields. A user's name is theirs and a built-in is identified by its
-- `seed_key` regardless of what it is called — and the seeder re-derives its own
-- name on the very next boot anyway (defaults.ts yields to a user-held name with
-- a " (Built-in)" suffix), so renaming a seed here costs nothing while renaming
-- a user's row would be a silent edit to their data.
--
-- WHY A LOOP AND NOT ONE RANKED PASS: the suffixed name can itself collide with
-- a row that already exists — an install holding "Default", "Default" and
-- "Default (2)" is renamed into a fresh collision by a single pass, and
-- CREATE UNIQUE INDEX then fails. Each pass strictly lengthens the names it
-- rewrites, so the loop converges; the bound exists so that a case nobody
-- anticipated fails loudly with a readable message instead of hanging the boot.
--
-- ⚠ The PARTITION BY expressions below are the index's expressions character for
-- character. They must stay that way: a partition that groups rows differently
-- from the index leaves collisions the index will still reject.
DO $$
DECLARE
	renamed_count integer;
	pass integer := 0;
BEGIN
	LOOP
		WITH ranked AS (
			SELECT
				"id",
				row_number() OVER (
					PARTITION BY
						split_part(split_part("shape", '/', 2), '@', 1),
						lower(btrim("name"))
					ORDER BY ("seed_key" IS NOT NULL), "id"
				) AS rn
			FROM "sampling_configs"
		), renamed AS (
			UPDATE "sampling_configs" s
			SET "name" = s."name" || ' (' || r.rn || ')'
			FROM ranked r
			WHERE s."id" = r."id" AND r.rn > 1
			RETURNING s."id"
		)
		SELECT count(*) INTO renamed_count FROM renamed;

		EXIT WHEN renamed_count = 0;

		pass := pass + 1;
		IF pass > 50 THEN
			RAISE EXCEPTION 'sampling_configs name de-duplication did not converge after % passes', pass;
		END IF;
	END LOOP;
END $$;--> statement-breakpoint

CREATE UNIQUE INDEX "sampling_configs_modality_name_unique"
	ON "sampling_configs" (
		split_part(split_part("shape", '/', 2), '@', 1),
		lower(btrim("name"))
	);
