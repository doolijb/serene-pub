-- A derived entry type's projected CHECK asked `fields` for the piece's `name`,
-- which rides the row's title column and is never stored in `fields`: every
-- derived row was refused. Drop those CHECKs (derived types only: a type id with
-- a dot after `entry/`); the next boot projects them again without the name
-- (`pipelines/boot/entryProjection.ts`). A 0.5.3 install has none: nothing drops.
DO $$
DECLARE
	r record;
BEGIN
	FOR r IN
		SELECT c.conname
		FROM pg_constraint c
		WHERE c.conrelid = 'lorebook_entries'::regclass
			AND c.contype = 'c'
			AND c.conname LIKE 'entry\_fields\_\_%'
			AND pg_get_constraintdef(c.oid) ~ ':entry/[a-z0-9-]+\.[a-z0-9-]+'''
	LOOP
		EXECUTE format('ALTER TABLE "lorebook_entries" DROP CONSTRAINT IF EXISTS %I', r.conname);
	END LOOP;
END $$;
