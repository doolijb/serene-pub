-- Normalize whitespace first, so the lower(name) comparisons below (and the
-- unique index created at the end of this migration) treat " Fantasy" and
-- "Fantasy" as the same tag.
UPDATE "tags" SET "name" = trim("name") WHERE "name" != trim("name");
--> statement-breakpoint
-- Merge any pre-existing case-insensitive duplicate tags (per user) into the
-- lowest-id row ("keeper") before the unique index below is created, which
-- would otherwise fail to apply over duplicate (user_id, lower(name)) pairs.
-- Each association table gets the same two-step treatment: first drop any
-- loser-tag association where the same entity already has the keeper tag
-- attached (would otherwise violate that table's own (entityId, tagId)
-- unique index once repointed), then repoint the remaining loser-tag
-- associations onto the keeper.
DELETE FROM "character_tags" ct
USING "tags" t1
WHERE ct."tag_id" = t1."id"
	AND t1."id" <> (
		SELECT MIN(t2."id") FROM "tags" t2
		WHERE t2."user_id" = t1."user_id" AND lower(t2."name") = lower(t1."name")
	)
	AND EXISTS (
		SELECT 1 FROM "character_tags" ct2
		WHERE ct2."character_id" = ct."character_id"
			AND ct2."tag_id" = (
				SELECT MIN(t2."id") FROM "tags" t2
				WHERE t2."user_id" = t1."user_id" AND lower(t2."name") = lower(t1."name")
			)
	);
--> statement-breakpoint
UPDATE "character_tags" ct
SET "tag_id" = (
	SELECT MIN(t2."id") FROM "tags" t2
	WHERE t2."user_id" = t1."user_id" AND lower(t2."name") = lower(t1."name")
)
FROM "tags" t1
WHERE ct."tag_id" = t1."id"
	AND t1."id" <> (
		SELECT MIN(t2."id") FROM "tags" t2
		WHERE t2."user_id" = t1."user_id" AND lower(t2."name") = lower(t1."name")
	);
--> statement-breakpoint
DELETE FROM "persona_tags" pt
USING "tags" t1
WHERE pt."tag_id" = t1."id"
	AND t1."id" <> (
		SELECT MIN(t2."id") FROM "tags" t2
		WHERE t2."user_id" = t1."user_id" AND lower(t2."name") = lower(t1."name")
	)
	AND EXISTS (
		SELECT 1 FROM "persona_tags" pt2
		WHERE pt2."persona_id" = pt."persona_id"
			AND pt2."tag_id" = (
				SELECT MIN(t2."id") FROM "tags" t2
				WHERE t2."user_id" = t1."user_id" AND lower(t2."name") = lower(t1."name")
			)
	);
--> statement-breakpoint
UPDATE "persona_tags" pt
SET "tag_id" = (
	SELECT MIN(t2."id") FROM "tags" t2
	WHERE t2."user_id" = t1."user_id" AND lower(t2."name") = lower(t1."name")
)
FROM "tags" t1
WHERE pt."tag_id" = t1."id"
	AND t1."id" <> (
		SELECT MIN(t2."id") FROM "tags" t2
		WHERE t2."user_id" = t1."user_id" AND lower(t2."name") = lower(t1."name")
	);
--> statement-breakpoint
DELETE FROM "lorebook_tags" lt
USING "tags" t1
WHERE lt."tag_id" = t1."id"
	AND t1."id" <> (
		SELECT MIN(t2."id") FROM "tags" t2
		WHERE t2."user_id" = t1."user_id" AND lower(t2."name") = lower(t1."name")
	)
	AND EXISTS (
		SELECT 1 FROM "lorebook_tags" lt2
		WHERE lt2."lorebook_id" = lt."lorebook_id"
			AND lt2."tag_id" = (
				SELECT MIN(t2."id") FROM "tags" t2
				WHERE t2."user_id" = t1."user_id" AND lower(t2."name") = lower(t1."name")
			)
	);
--> statement-breakpoint
UPDATE "lorebook_tags" lt
SET "tag_id" = (
	SELECT MIN(t2."id") FROM "tags" t2
	WHERE t2."user_id" = t1."user_id" AND lower(t2."name") = lower(t1."name")
)
FROM "tags" t1
WHERE lt."tag_id" = t1."id"
	AND t1."id" <> (
		SELECT MIN(t2."id") FROM "tags" t2
		WHERE t2."user_id" = t1."user_id" AND lower(t2."name") = lower(t1."name")
	);
--> statement-breakpoint
DELETE FROM "chat_tags" ct
USING "tags" t1
WHERE ct."tag_id" = t1."id"
	AND t1."id" <> (
		SELECT MIN(t2."id") FROM "tags" t2
		WHERE t2."user_id" = t1."user_id" AND lower(t2."name") = lower(t1."name")
	)
	AND EXISTS (
		SELECT 1 FROM "chat_tags" ct2
		WHERE ct2."chat_id" = ct."chat_id"
			AND ct2."tag_id" = (
				SELECT MIN(t2."id") FROM "tags" t2
				WHERE t2."user_id" = t1."user_id" AND lower(t2."name") = lower(t1."name")
			)
	);
--> statement-breakpoint
UPDATE "chat_tags" ct
SET "tag_id" = (
	SELECT MIN(t2."id") FROM "tags" t2
	WHERE t2."user_id" = t1."user_id" AND lower(t2."name") = lower(t1."name")
)
FROM "tags" t1
WHERE ct."tag_id" = t1."id"
	AND t1."id" <> (
		SELECT MIN(t2."id") FROM "tags" t2
		WHERE t2."user_id" = t1."user_id" AND lower(t2."name") = lower(t1."name")
	);
--> statement-breakpoint
-- Now safe to delete the loser tag rows themselves (their associations were
-- either dropped or repointed to the keeper above).
DELETE FROM "tags" t1
WHERE t1."id" <> (
	SELECT MIN(t2."id") FROM "tags" t2
	WHERE t2."user_id" = t1."user_id" AND lower(t2."name") = lower(t1."name")
);
--> statement-breakpoint
CREATE UNIQUE INDEX "tags_user_id_name_unique" ON "tags" USING btree ("user_id",lower("name"));
