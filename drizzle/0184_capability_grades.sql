-- Capability tiers become capability GRADES.
--
-- `connections.capabilities` held a three-value enum per capability —
-- `native | emulated | none` — and that vocabulary could not express the one
-- fact the column exists to record: how many WAYS there are to support a
-- capability differs per capability. Serene Pub can format and parse tool calls
-- for a backend that never heard of them, so `tools` has a middle band. Nothing
-- fakes a picture, so `text->image` has none — and under the flat enum its very
-- best possible answer was `native`, one of three, which every badge then had to
-- render as though something better existed.
--
-- What replaces it is a number per capability, read against that capability's own
-- band table in the SDK (`bandsFor`): 0 is unsupported and the scale is open
-- upward. So the SAME word maps to DIFFERENT numbers depending on the key it was
-- stored under, which is why this cannot be a blanket string substitution:
--
--   tools / json_object / json_schema   [none, emulated, native]  native -> 2
--   everything else                     [none, native]            native -> 1
--
-- Getting that backwards in either direction is silent. A blanket `native -> 1`
-- demotes every native tool-calling and structured-output claim to EMULATED,
-- which the panel then labels "On · by Serene Pub" — a lie about who is supplying
-- it. A blanket `native -> 2` puts every transform one past the top of its own
-- scale, where `gradeOf` clamps it back and `gradeLetter` would have reported a
-- `B` for a full-strength connection.
--
-- ## Which halves of the column are migrated, and why all three are
--
-- The column is `{ resolved?, overrides?, probe? }` and the three are not equal:
--
--   - `resolved` is documented as a CACHE of the other two plus the static
--     manifest (schema.ts, `resolve.ts`), which suggests it need not be migrated
--     at all. It is the half that MUST be, and it is worth being precise about
--     why, because the reasoning runs opposite to the documentation.
--
--     A cache is only safe to leave stale if nothing reads it before it is
--     rebuilt, and this one is read on the hot path — `storedCapabilities` in
--     `pipelines/runtime/capabilityGuard.ts` — while the rebuild happens only
--     when something re-resolves the row, which may be never. In that window a
--     leftover string is not merely stale, it is UNREADABLE: `satisfies` tests
--     `typeof grade === 'number'` (a truthiness test would grant a capability on
--     the strength of the very string that proves nothing was migrated), so a
--     stale `"native"` reports as MISSING and the connection loses the
--     capability. `capabilityRows` does `grade > 0` for the same value, so the
--     panel shows every row Off. Both are the safe direction and both are wrong.
--
--   - `overrides` is a person's stated intent — authoritative, durable, and
--     recomputable from nothing.
--   - `probe.found` is what a backend answered when it was last tested. Equally
--     durable and equally not recomputable: recomputing it means re-running a
--     test against a service that may be switched off. `resolve.ts`'s own header
--     groups these two together as "DURABLE INTENT", against `resolved`.
--
--     Neither of these two actually breaks if left alone, and the honest reason
--     is worth recording: both are read back through `gradeOf`, which accepts a
--     band NAME as well as a number, so `"native"` in either half still resolves
--     to the right grade today. That tolerance exists for AUTHORING — it is what
--     lets the manifest say `tools: "native"` instead of `2` — and leaning on it
--     for STORAGE would be relying on an accident. `CapabilitySet` and
--     `CapabilityOverrides` are declared number-valued; a column full of strings
--     makes every reader's type a lie, and the first reader to do the natural
--     thing with a grade — compare it, take a floor of it — breaks silently on
--     data nothing warned it about. They are migrated to make the types true.
--
-- Values that are not one of the three names are passed through untouched: an
-- `overrides` entry may legitimately be the boolean `false` (an explicit off,
-- which outranks every probe and has no numeric spelling), and anything else is
-- data this migration has no opinion about.
--
-- ## `emulated` becomes 1 whatever the capability's arity, deliberately
--
-- On a three-band capability that is its middle, which is exactly right. On a
-- two-band one, 1 is the TOP — so this reads a stored `emulated` as "on at full
-- strength" rather than as the 0 that `gradeOf(id, 'emulated')` would give it.
--
-- That is intentional and it is the only place the two disagree. `overrides` is
-- a PERSON'S STATED INTENT, and the pre-grade behaviour of a stored `emulated`
-- was unambiguously "this capability is on"; resolving it to 0 here would
-- silently switch off something somebody switched on, which is the one outcome a
-- durable-intent column must never produce on upgrade. The band-name reading —
-- that an emulated picture is a claim nothing can fulfil — is the right answer
-- for a NEW declaration, and it is what `gradeOf` gives new writes. It is the
-- wrong answer for data that already means something.
--
-- Reachable rather than theoretical: `connections:setCapability` accepts
-- `"emulated"` on the wire (reserved for a future force-emulated control), so
-- the value can be in the column even though today's UI only ever sends
-- `"native"`.
--
-- ## A non-object half is NORMALISED, not preserved
--
-- If `resolved` somehow holds a scalar, it comes out as `{}`. Nothing writes
-- that shape, so this is corruption rather than data — and `{}` is what every
-- reader already interprets it as (`storedCapabilities` tests
-- `typeof resolved === "object"` before using it), so the row ends up saying
-- what it already meant. Worth stating because it is the one case where a value
-- is dropped rather than carried.
--
-- ## Shape rather than substitution
--
-- Written as one pass over `jsonb_each` per sub-object rather than as three
-- `replace()` calls on the serialized text. A text substitution would also
-- rewrite a `probe.at` timestamp, a preset slug or any future key that happened
-- to contain the word, and it could not tell which capability a value was stored
-- under — which is exactly the information the mapping needs.
--
-- `jsonb_set` with `create_missing = false` is what keeps an absent half absent:
-- a row with no `probe` does not gain an empty one, and a row whose `capabilities`
-- is `{}` — the column default, and what 0175 wrote for every unrecognised
-- modality — comes through untouched.

WITH "pairs" AS (
	SELECT
		c."id",
		s."path",
		e."k",
		CASE
			-- `false` in `overrides`, and anything else nobody named.
			WHEN jsonb_typeof(e."v") <> 'string' THEN e."v"
			WHEN e."v" #>> '{}' = 'none' THEN '0'::jsonb
			WHEN e."v" #>> '{}' = 'emulated' THEN '1'::jsonb
			-- The top band, which is where the arity of the capability decides.
			-- These three are exactly the keys of the SDK's `BANDS` table, which
			-- are in turn exactly the keys of `EMULATABLE_VIA` — a band for
			-- "Serene Pub supplies this itself" exists where, and only where,
			-- Serene Pub can.
			WHEN e."v" #>> '{}' = 'native' THEN
				CASE
					WHEN e."k" IN ('tools', 'json_object', 'json_schema')
						THEN '2'::jsonb
					ELSE '1'::jsonb
				END
			ELSE e."v"
		END AS "graded"
	FROM "connections" c
	CROSS JOIN (
		VALUES ('{resolved}'::text[]), ('{overrides}'::text[]), ('{probe,found}'::text[])
	) AS s("path")
	-- Guarded INSIDE the lateral, not by a WHERE. `jsonb_each` raises on a
	-- non-object, and a join's WHERE is applied after the function has already
	-- been called for the row — so a column where one of these paths is missing
	-- (every row, for two of the three) or holds a scalar has to arrive here as
	-- an empty object rather than be filtered out afterwards.
	CROSS JOIN LATERAL jsonb_each(
		CASE
			WHEN jsonb_typeof(c."capabilities"::jsonb #> s."path") = 'object'
				THEN c."capabilities"::jsonb #> s."path"
			ELSE '{}'::jsonb
		END
	) AS e("k", "v")
),
"objs" AS (
	SELECT "id", "path", jsonb_object_agg("k", "graded") AS "obj"
	FROM "pairs"
	GROUP BY "id", "path"
),
"merged" AS (
	SELECT
		c."id",
		-- COALESCE because `jsonb_set` returns NULL if ANY argument is NULL, and a
		-- row with no matching `objs` entry (an absent half, or a present but
		-- empty one) has none. With `create_missing = false` the `'{}'` is never
		-- actually written for an absent path — the call returns the input
		-- unchanged — so this is purely about not nulling the whole column.
		jsonb_set(
			jsonb_set(
				jsonb_set(
					c."capabilities"::jsonb,
					'{resolved}',
					COALESCE(rs."obj", '{}'::jsonb),
					false
				),
				'{overrides}',
				COALESCE(ov."obj", '{}'::jsonb),
				false
			),
			'{probe,found}',
			COALESCE(pf."obj", '{}'::jsonb),
			false
		) AS "next"
	FROM "connections" c
	LEFT JOIN "objs" rs ON rs."id" = c."id" AND rs."path" = '{resolved}'::text[]
	LEFT JOIN "objs" ov ON ov."id" = c."id" AND ov."path" = '{overrides}'::text[]
	LEFT JOIN "objs" pf ON pf."id" = c."id" AND pf."path" = '{probe,found}'::text[]
)
UPDATE "connections" c
SET "capabilities" = m."next"::json
FROM "merged" m
WHERE m."id" = c."id";--> statement-breakpoint

-- Neither side of a `connection_defaults` key may be empty.
--
-- 0183 split `capability` into `input` + `output` and DELETED the degenerate rows
-- rather than backfilling them, for a reason its own comment states: a row with
-- an empty side satisfies the primary key perfectly and matches nothing forever,
-- because nothing will ever ask for a capability with an empty side. An
-- unmatchable row on a lookup table is worse than an absent one — the absent one
-- reads as "not set up" and says where to set it.
--
-- That reasoning was enforced once, at migration time, and then only by the
-- TypeScript at the storage boundary. This makes the row unwritable: the
-- constraint is the system of record's own refusal, so a future writer that
-- reaches the table by any other path cannot create one.
ALTER TABLE "connection_defaults" ADD CONSTRAINT "connection_defaults_sides_check" CHECK ("input" <> '' AND "output" <> '');
