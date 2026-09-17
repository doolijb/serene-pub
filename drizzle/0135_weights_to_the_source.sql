-- Custom SQL migration file, put your code below! --
--
-- HAND-WRITTEN in full: `npm run db:generate -- --custom` prepared the empty
-- file (no schema changes — this is a DATA move), and everything below is the
-- move. Weights to the source (plans/30 §U3b; 09-B B7 P5; 16 §5a; NOMENCLATURE
-- §7 §25).
--
-- `core:task/rank-hybrid@1` used to own `share`, `maxEntries` and `minEntries`
-- as five-band maps keyed `{messages, worldLore, characterLore, history,
-- relationships}`. Those are per-source intent, and per-source intent lives on
-- the retrieval definition that produces the source (R-7 P5): each of the five
-- declares its own `share` / `maxEntries` / `priority` (the conversation its
-- `minEntries` too) and publishes them as a band intent at the head of its
-- candidates. So every stored map at a ranker node is split by member and each
-- member moves to the node that owns that band now — in a configuration's rows
-- (`pipeline_config_values`) AND in a session's (`pipeline_node_overrides`).
--
-- Ranker and target nodes are found by DEFINITION on the spec's active version,
-- not by node key, so a user-authored spec keying its ranker `pick` is moved
-- the same as `respond`'s `rank`:
--   messages       → core:query/session-history     (`gather.history.read` in respond)
--   worldLore      → core:query/world-lore          (`gather.worldLore.read`)
--   characterLore  → core:query/character-lore      (`gather.characterLore.read`)
--   history        → core:query/history-entries     (`gather.historyEntries.read`)
--   relationships  → core:query/relationship-search (`gather.relationships.read`)
--
-- A spec that scans through ONE node — `core:query/lorebook-triggers`, as
-- `narrate`, `narrate-character` and `adventure-look` do — has no lane per
-- lore band, so the three lore bands go to that node instead, under its
-- NAMESPACED fields (U3b review W1): `share.worldLore` → `worldLoreShare`,
-- `maxEntries.history` → `historyMaxEntries`, and so on. One `params` slot,
-- three intents; the field name is `<band><Field>` and the address is one
-- row, which is why a nested shape was not chosen (see `bandIntentFieldsOf`
-- in the contracts). A dedicated lane, where a spec has one, wins over the
-- scan node.
--
-- Five verdicts per member, each recorded as a `pipeline_config_notices` row
-- where it changes what a person sees or gets (NOMENCLATURE §6), mirroring 0134
-- §8:
--   · MOVED — a deviation from the shipped number, re-homed on the owner; a
--     `backfilled` notice on the owner's address says old address → new
--     address and the value;
--   · SWEPT — a member holding exactly the shipped number (the panel stores
--     the whole map, so four of five members usually do). Dropped with the
--     map and NOT noticed, exactly as `reconcileConfigs` sweeps an inert row:
--     the person set nothing, and the declaration on the owner says the same
--     number — or, on a pipeline with no source for that band, the ranker's
--     fallback does. `maxEntries.relationships` at 0 is swept too (U3b review
--     W2): the shipped map held that 0 and the panel stored it back on every
--     save, and a cap of nothing behind a share of nothing changed no outcome;
--   · CULLED — a member with no owner in that spec (adventure-respond ranks
--     no relationships), a field the owner does not declare (`minEntries` on
--     a lore band — R6, lore has no floor), or `maxEntries.relationships` at 0
--     BESIDE a raised `share.relationships` — the one case the old cap did
--     change an outcome: on the ranker it kept every relationship out over
--     its ceiling, while on `relationship-search` 0 means "leave the section
--     out" — moving it would switch the source off under a different word
--     for the same absence. A `culled` notice on the ranker's address carries
--     the value;
--   · COLLIDED — the owner already holds a row at that path (a half-migrated
--     install). The owner's wins; a `culled` notice carries the loser's value;
--   · OUTRANKED — a spec with TWO ranker nodes, both holding a map with the
--     same member (U3b review W3): one owner, one address, so the earlier
--     ranker's value moves and the later one's is a `culled` notice naming
--     the winner. Without this the two moves collided on
--     `pipeline_config_values_addr_idx` and the whole migration rolled back.
--
-- Not done here, by rule: the definition and spec documents are not rewritten
-- (boot republishes the changed declarations under new hashes — the second
-- hash move after U3's — and `reconcileConfigs` back-fills the owners' new
-- fields and culls anything left at the ranker's old paths); receipts are
-- never rewritten.

-- 1 · Every member of every stored map, with its verdict, in one scratch table.
CREATE TABLE "_u3b_band_moves" AS
WITH src AS (
	-- Configuration rows.
	SELECT v."id" AS "row_id", 'config' AS "origin", v."config_id",
		NULL::integer AS "spec_id", NULL::text AS "scope_kind", NULL::integer AS "scope_id",
		s."active_version_id" AS "version_id", v."node_key" AS "rank_key", r."position" AS "rank_position",
		v."path" AS "field", v."value"::jsonb AS "map"
	FROM "pipeline_config_values" v
		JOIN "pipeline_configs" c ON c."id" = v."config_id"
		JOIN "pipeline_specs" s ON s."id" = c."spec_id"
		JOIN "pipeline_nodes" r ON r."spec_version_id" = s."active_version_id" AND r."node_key" = v."node_key"
			AND r."definition_id" IN ('core:task/rank-hybrid', 'core:task/rank-by-recency')
	WHERE v."slot" = 'params' AND v."path" IN ('share', 'maxEntries', 'minEntries')
	UNION ALL
	-- Session rows (always `session` scope; the notice attaches to the
	-- configuration the session resolves through — 0134 §8b).
	SELECT o."id", 'session', COALESCE(
			(SELECT sel."config_id" FROM "pipeline_config_selections" sel WHERE sel."spec_id" = o."spec_id" AND sel."scope_kind" = o."scope_kind" AND sel."scope_id" = o."scope_id" AND sel."config_id" IS NOT NULL ORDER BY sel."id" LIMIT 1),
			(SELECT sel."config_id" FROM "pipeline_config_selections" sel WHERE sel."spec_id" = o."spec_id" AND sel."scope_kind" = 'instance' AND sel."scope_id" = 0 AND sel."config_id" IS NOT NULL LIMIT 1),
			(SELECT d."id" FROM "pipeline_configs" d WHERE d."spec_id" = o."spec_id" AND d."seed_key" = 'pipeline-default:' || s."slug" LIMIT 1)),
		o."spec_id", o."scope_kind", o."scope_id",
		s."active_version_id", o."node_key", r."position", o."path", o."value"::jsonb
	FROM "pipeline_node_overrides" o
		JOIN "pipeline_specs" s ON s."id" = o."spec_id"
		JOIN "pipeline_nodes" r ON r."spec_version_id" = s."active_version_id" AND r."node_key" = o."node_key"
			AND r."definition_id" IN ('core:task/rank-hybrid', 'core:task/rank-by-recency')
	WHERE o."slot" = 'params' AND o."path" IN ('share', 'maxEntries', 'minEntries')
),
members AS (
	SELECT src.*, m."key" AS "band", m."value" AS "member",
		CASE m."key"
			WHEN 'messages' THEN 'core:query/session-history'
			WHEN 'worldLore' THEN 'core:query/world-lore'
			WHEN 'characterLore' THEN 'core:query/character-lore'
			WHEN 'history' THEN 'core:query/history-entries'
			WHEN 'relationships' THEN 'core:query/relationship-search'
		END AS "owner_definition",
		-- The shipped number for this member, as the owner now declares it.
		-- No `maxEntries.relationships`: the graph is uncapped by default and
		-- its stored 0 is judged by W2's rule below, not by equality.
		CASE src."field"
			WHEN 'share' THEN CASE m."key"
				WHEN 'messages' THEN '0.5'::jsonb WHEN 'worldLore' THEN '0.1667'::jsonb WHEN 'characterLore' THEN '0.1667'::jsonb
				WHEN 'history' THEN '0.1666'::jsonb WHEN 'relationships' THEN '0'::jsonb END
			WHEN 'maxEntries' THEN CASE m."key"
				WHEN 'messages' THEN '50'::jsonb WHEN 'worldLore' THEN '20'::jsonb WHEN 'characterLore' THEN '15'::jsonb
				WHEN 'history' THEN '10'::jsonb END
			WHEN 'minEntries' THEN CASE m."key" WHEN 'messages' THEN '6'::jsonb END
		END AS "shipped",
		-- Does the owner declare this field at all? `minEntries` is the
		-- conversation's alone (R6).
		(src."field" <> 'minEntries' OR m."key" = 'messages') AS "declared"
	FROM src
		CROSS JOIN LATERAL jsonb_each(CASE WHEN jsonb_typeof(src."map") = 'object' THEN src."map" ELSE '{}'::jsonb END) m
),
placed AS (
	SELECT members.*,
		COALESCE(lane."node_key", scan."node_key") AS "owner_key",
		-- The field's name at the owner: its own on a lane, namespaced by
		-- band on the one-node scan (`share` → `worldLoreShare`).
		CASE WHEN lane."node_key" IS NULL AND scan."node_key" IS NOT NULL
			THEN members."band" || upper(left(members."field", 1)) || substr(members."field", 2)
			ELSE members."field" END AS "owner_field",
		-- The relationships share stored BESIDE a relationships ceiling, as
		-- the ranker resolved it: the same row-set's `share` map, a session's
		-- falling back to its configuration's. Read for W2's one condition —
		-- a ceiling of 0 only ever changed an outcome behind a share above 0.
		COALESCE(
			(SELECT (m2."member")::text::numeric FROM members m2
				WHERE m2."origin" = members."origin" AND m2."rank_key" = members."rank_key"
					AND m2."config_id" IS NOT DISTINCT FROM members."config_id"
					AND m2."spec_id" IS NOT DISTINCT FROM members."spec_id"
					AND m2."scope_kind" IS NOT DISTINCT FROM members."scope_kind"
					AND m2."scope_id" IS NOT DISTINCT FROM members."scope_id"
					AND m2."field" = 'share' AND m2."band" = 'relationships' AND jsonb_typeof(m2."member") = 'number'
				LIMIT 1),
			(SELECT (m3."member")::text::numeric FROM members m3
				WHERE members."origin" = 'session' AND m3."origin" = 'config'
					AND m3."config_id" = members."config_id" AND m3."rank_key" = members."rank_key"
					AND m3."field" = 'share' AND m3."band" = 'relationships' AND jsonb_typeof(m3."member") = 'number'
				LIMIT 1),
			0) AS "share_beside"
	FROM members
		LEFT JOIN LATERAL (SELECT t."node_key" FROM "pipeline_nodes" t
			WHERE t."spec_version_id" = members."version_id" AND t."definition_id" = members."owner_definition"
			ORDER BY t."position" LIMIT 1) lane ON TRUE
		LEFT JOIN LATERAL (SELECT t."node_key" FROM "pipeline_nodes" t
			WHERE members."band" IN ('worldLore', 'characterLore', 'history')
				AND t."spec_version_id" = members."version_id" AND t."definition_id" = 'core:query/lorebook-triggers'
			ORDER BY t."position" LIMIT 1) scan ON TRUE
),
judged AS (
	SELECT placed.*,
		CASE
			-- The graph's ceiling first (W2), then the shipped number BEFORE
			-- the owner check: every saved `share` map carries
			-- `relationships: 0`, and on a pipeline with no graph read that is
			-- the fallback the ranker ran on anyway — nothing to tell anyone.
			WHEN "field" = 'maxEntries' AND "band" = 'relationships' AND "member" = '0'::jsonb
				THEN CASE WHEN "share_beside" > 0 THEN 'culled' ELSE 'swept' END
			WHEN "shipped" IS NOT NULL AND "member" = "shipped" THEN 'swept'
			WHEN "owner_key" IS NULL THEN 'culled'
			WHEN NOT "declared" THEN 'culled'
			WHEN "origin" = 'config' AND EXISTS (SELECT 1 FROM "pipeline_config_values" x
				WHERE x."config_id" = placed."config_id" AND x."node_key" = placed."owner_key" AND x."slot" = 'params' AND x."path" = placed."owner_field") THEN 'collided'
			WHEN "origin" = 'session' AND EXISTS (SELECT 1 FROM "pipeline_node_overrides" x
				WHERE x."spec_id" = placed."spec_id" AND x."scope_kind" = placed."scope_kind" AND x."scope_id" = placed."scope_id"
					AND x."node_key" = placed."owner_key" AND x."slot" = 'params' AND x."path" = placed."owner_field") THEN 'collided'
			ELSE 'moved'
		END AS "verdict_alone"
	FROM placed
)
-- Two rankers in one spec (W3): among the members that would MOVE to one
-- address, the earlier ranker's claim stands and every later one is
-- `outranked`. The partition includes the verdict so the claim numbers run
-- over movers alone.
SELECT judged.*,
	CASE WHEN "verdict_alone" = 'moved'
		AND row_number() OVER (PARTITION BY "origin", "config_id", "spec_id", "scope_kind", "scope_id", "owner_key", "owner_field", "verdict_alone"
			ORDER BY "rank_position", "row_id") > 1
		THEN 'outranked' ELSE "verdict_alone" END AS "verdict",
	first_value("rank_key") OVER (PARTITION BY "origin", "config_id", "spec_id", "scope_kind", "scope_id", "owner_key", "owner_field", "verdict_alone"
		ORDER BY "rank_position", "row_id") AS "claimant"
FROM judged;--> statement-breakpoint

-- 2 · Notices. Culled, collided and outranked on the RANKER's address (the
--     value has no home); moved on the OWNER's (that is where a person finds
--     it now).
INSERT INTO "pipeline_config_notices" ("config_id", "kind", "node_key", "slot", "path", "label", "previous_value", "spec_version_id")
SELECT "config_id", 'culled', "rank_key", 'params', "field",
	CASE WHEN "origin" = 'session' THEN 'session ' || "scope_id"::text || ' · ' ELSE '' END
	|| "rank_key" || '/' || "field" || '.' || "band" || ' — '
	|| CASE
		WHEN "owner_key" IS NULL THEN 'no ' || "band" || ' source in this pipeline to move it to'
		WHEN NOT "declared" THEN 'the ' || "band" || ' source declares no floor — lore competes on score (R6)'
		WHEN "field" = 'maxEntries' AND "band" = 'relationships' AND "member" = '0'::jsonb THEN 'a ceiling of 0 on the ranker kept every relationship out over its ceiling, behind a share of ' || "share_beside"::text || '; on ' || "owner_key" || ' a 0 would switch the source off, so it is not carried over — the graph now competes for its share, uncapped (set the share to 0 to leave it out; the ceiling on the source is optional)'
		WHEN "verdict" = 'outranked' THEN 'folded into ' || "owner_key" || '/' || "owner_field" || ', which ' || "claimant" || '/' || "field" || '.' || "band" || ' also moved to — the earlier step''s value wins (one owner per setting, R-7 P5)'
		ELSE 'folded into ' || "owner_key" || '/' || "owner_field" || ', which already held a value (one owner per setting, R-7 P5)'
	END
	|| ' (was ' || "member"::text || ')',
	"member"::json, "version_id"
FROM "_u3b_band_moves" WHERE "verdict" IN ('culled', 'collided', 'outranked') AND "config_id" IS NOT NULL;--> statement-breakpoint
INSERT INTO "pipeline_config_notices" ("config_id", "kind", "node_key", "slot", "path", "label", "previous_value", "spec_version_id")
SELECT "config_id", 'backfilled', "owner_key", 'params', "owner_field",
	CASE WHEN "origin" = 'session' THEN 'session ' || "scope_id"::text || ' · ' ELSE '' END
	|| "rank_key" || '/' || "field" || '.' || "band" || ' → ' || "owner_key" || '/' || "owner_field"
	|| ' — the ' || "band" || ' source now declares its own ' || "field" || ' (weights live on the source, R-7 P5; was ' || "member"::text || ')',
	"member"::json, "version_id"
FROM "_u3b_band_moves" WHERE "verdict" = 'moved' AND "config_id" IS NOT NULL;--> statement-breakpoint

-- 3 · The moves themselves. One row per (address) by construction: a second
--     ranker's claim on the same address is `outranked` above, never `moved`.
INSERT INTO "pipeline_config_values" ("config_id", "node_key", "slot", "path", "value")
SELECT "config_id", "owner_key", 'params', "owner_field", "member"::json
FROM "_u3b_band_moves" WHERE "verdict" = 'moved' AND "origin" = 'config';--> statement-breakpoint
INSERT INTO "pipeline_node_overrides" ("spec_id", "scope_kind", "scope_id", "node_key", "slot", "path", "value")
SELECT "spec_id", "scope_kind", "scope_id", "owner_key", 'params', "owner_field", "member"::json
FROM "_u3b_band_moves" WHERE "verdict" = 'moved' AND "origin" = 'session';--> statement-breakpoint

-- 4 · The maps are gone from the ranker: every member has been moved, swept
--     or noticed, and a row left here would be culled at the next boot with a
--     second notice saying less than the ones above.
DELETE FROM "pipeline_config_values" WHERE "id" IN (SELECT "row_id" FROM "_u3b_band_moves" WHERE "origin" = 'config');--> statement-breakpoint
DELETE FROM "pipeline_node_overrides" WHERE "id" IN (SELECT "row_id" FROM "_u3b_band_moves" WHERE "origin" = 'session');--> statement-breakpoint
DROP TABLE "_u3b_band_moves";
