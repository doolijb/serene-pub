-- Lift the SEEDED `keepAlive` of "300ms" on Ollama connections to "5m".
--
-- `OllamaAdapter.generateText()` read `extraJson?.keepAlive || "300ms"`. Three
-- tenths of a second is how long Ollama then held the weights after a turn, so
-- the next message paid a full unload-and-reload before its first token —
-- against a 14B model on the machine this was found on, ~9 GB, on every single
-- message. That fallback is `"5m"` now, which is Ollama's own default.
--
-- ── Why the fallback alone fixes nothing ───────────────────────────────────
--
-- `CONNECTION_DEFAULTS[ollama].extraJson` seeded `keepAlive: "300ms"`, and
-- `OllamaForm.extraFieldsToExtraJson` writes its two controls back
-- UNCONDITIONALLY, as `${keepAliveNumber}${keepAliveUnit}` — so every Ollama
-- connection ever saved through the form carries "300ms" in its own
-- `extra_json`. That is a per-connection OVERRIDE, and an override is precisely
-- what a changed fallback cannot reach: `||` never sees the right-hand side
-- while the left one is a non-empty string. Without this file the defect
-- survives its own fix on every row that already exists, which is every row a
-- person has.
--
-- ── Why ONLY the exact seeded string ───────────────────────────────────────
--
-- "300ms" is not a setting anybody chose. It is what the seed wrote, and what
-- the form's own `parseInt(...) || 300` + `"ms"` pair reproduces for a
-- connection that never touched the field — so a row carrying it is a row that
-- was never asked the question. Any other value came from a person moving the
-- number or the unit, and is left exactly as it is:
--
--   · "300 ms", "0.3s", "300" — not this seed's spelling. Whatever wrote them,
--     it was not the path above, so nothing here can claim to know their
--     intent.
--   · an ABSENT key — the pre-form row the new fallback already covers
--     correctly, and 0098's precedent on this same column: absence is an
--     accident of defaults, not a choice, so it is not translated.
--   · a deliberate "300ms" — somebody who wants the weights gone between
--     turns, on a machine where that is the point. It is indistinguishable
--     from the seed by inspection, and the cost of being wrong runs the other
--     way: this file gives back a reload, widening it would take back memory
--     the person may have been freeing on purpose.
--
-- ── Why `->>` here, where 0098 needed `->` ─────────────────────────────────
--
-- 0098 compared `extra_json -> 'useSession'` against a jsonb LITERAL because
-- its target was a boolean: `->>` renders both `false` and `"false"` as the
-- text `false`, and under the code of that era those two meant opposite things.
-- The hazard is two JSON types collapsing onto one text form, and this target
-- has no such twin — the only jsonb value whose text form is `300ms` is the
-- string `"300ms"`. The number 300 renders as `300`; `->>` on an absent key,
-- or on an `extra_json` that is not an object at all, is NULL, which no `=`
-- matches. The text comparison is therefore exact, and it reads as what it is.
--
-- ⚠ A `||` MERGE, never a rewrite of the column. `extra_json` is the ADAPTER's
-- bag — `stream` and `think` live in it, alongside anything else a form spread
-- there — and 0098's precedent is that a migration merges into a shared column
-- rather than replacing it. Only `keepAlive` is on the right-hand side, so only
-- `keepAlive` moves.
--
-- ⚠ `connections.extra_json` is `json`, not `jsonb` (schema.ts), so both sides
-- are cast in and the result is cast back — the same idiom as 0098.
UPDATE "connections"
SET "extra_json" = (
	"extra_json"::jsonb || '{"keepAlive": "5m"}'::jsonb
)::json
WHERE
	"type" = 'ollama'
	AND ("extra_json"::jsonb ->> 'keepAlive') = '300ms';
