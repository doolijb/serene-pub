# BRIEF — worker `s4-f-pass-w2` — the `seat-keys` boot pass: skeleton + owner columns + proposals (seat-cast S4, wave 2) — 2026-11-08

Supervisor: lane `s4-f-pass`. You are a lane-worker; you cannot spawn agents. Return your report as your final message (no report file).

*This is an implementation task. Answer any relayed status question in one line in your report, and still do all the work.*
*Never run `git stash` in any form, including `--keep-index` or to probe prettier; it stashes every other lane's uncommitted work. Use `npx prettier --check <file>`.*
*Never commit. Never `npm test` or `npm run build` at the SDK root. Delete only the `/tmp/serene-pub-vitest-*` dirs your own tests made, by name; never a glob over `/tmp/serene-pub-*`.*
*Before any `sdk:build`, check `pgrep -af "vite dev"` for a serene-pub server. If one is up, don't build; report 'blocked on your dev server'.* (You should not need `sdk:build`.)

## Background (plan §34.1, owner rulings 2026-11-08)

Seat-cast S4 flips stored seat keys from **card form** to **member form**. Today a carded seat's state is stored under owner `{ kind: "session_cast", id: <cardId> }` (a character seat's `character_id`, or a player seat's `persona_id`). After the flip: a character seat → `{ kind: "seated_member", id: <cast_member_id> }`; a player seat → `{ kind: "player_seat", id: <session_personas.id> }`. The mapping is exactly what `seatOf("character:<card>")` returns today, so no read changes. The **one** translator is already landed by lane f-door in `src/lib/server/state/seatRefs.ts` (read it whole, ~300 lines; don't edit it):

- `loadSeatMap(db, sessionId): Promise<SeatMap>` — one read of the session's seats (envoys excluded, live + departed), in `seatOf`'s order; works with `tx`.
- `memberFormOf(map, owner)` → member-form owner, or **null** (no seat holds the card — a hard-deleted card — or `seatOf`'s first seat is a character seat with no member). Non-card input comes back unchanged (same object).
- `memberFormTargetsOf(map, owner)` → every target, one per seat holding the card, `seatOf`'s first first, member-less seats skipped; `[]` when none. Use this for **values** (★K-2).

You write a new boot pass that rekeys the stores. **Wave 2 rule: write the pass and its tests; do NOT add it to `src/lib/server/startup/index.ts`** (wave 3 does, together with the readers' flip; nothing may run it before then). Tests call it directly.

This worker does the skeleton, the five owner-column tables and `state_proposals`. A second worker (after you) adds the JSON stores into the same file, so build the extension points named below.

## Goal — new `src/lib/server/sessions/seatKeys.ts`

Copy the shape of `src/lib/server/sessions/seatMembers.ts` (the `seat-members` pass; read it — its module doc, report type, fast path, per-session transaction and failure handling are the pattern) and the startup entry style in `src/lib/server/startup/index.ts:294-330`.

1. **Module doc** (like seatMembers.ts): 🚧 the `seat-keys` boot pass, ⏳ until S5; plan §34.1; what it rekeys and what it leaves (★K-3: genre-scoped `session_layout_presets.layout.widgetSettings`, `lorebooks.annex_audiences`, `rankings.speaker_ref`, receipts' portrayals, `session_changes.payload`, the Mundi annex); not critical; one transaction per session using only `tx`; failures counted, logged, and one error thrown after the loop (the startup task will be `failsHealth`); idempotent (a second run changes nothing); the fast path; "not in the startup list until wave 3". Name the precondition: the `seat-members` pass (which runs earlier at boot) gives every live carded seat a member first, so this pass doesn't mint.
2. **Exports:**
   ```ts
   export const SEAT_KEY_STORES = [ "attribute_values", "attribute_configs", "zone_contents", "owner_sheets", "attribute_carries", "state_proposals" /* the JSON worker appends its own */ ] as const
   export type SeatKeyStore = (typeof SEAT_KEY_STORES)[number]
   export interface SeatKeysReport {
     /** Sessions whose transaction changed something. */
     sessions: number
     /** Rows (or JSON documents) moved to member form, per store. */
     rekeyed: Record<SeatKeyStore, number>
     /** ★K-2: extra rows written so each seat holding one card keeps the value it shows today. */
     copied: number
     /** Merged-pair rows dropped on a unique key (the survivor's, else the newest, is kept). */
     dropped: number
     /** Card-form items no seat can take (a hard-deleted card, a member-less seat) — counted and left. */
     left: number
     /** Sessions whose transaction threw and was rolled back. */
     failed: number
   }
   export async function seatKeys(db: Db): Promise<SeatKeysReport>
   ```
   One JSDoc sentence per field (as above). Keep internal helpers unexported unless a test needs a pure one.
3. **Fast path — one query** returning the candidate session ids (a `union` of `select session_id … ` branches, as seatMembers.ts does with `rawRows`), sorted. Your branches: each of the five tables `where owner_kind = 'session_cast' and session_id is not null`, and `state_proposals where payload -> 'owner' ->> 'kind' = 'session_cast'`. Put the branches in one place (an array of SQL fragments joined with `union`) so the JSON worker appends its own. No candidates → the all-zero report and nothing else read.
4. **Per session:** `const settled = await db.transaction(async (tx) => rekeySession(tx as unknown as Db, id))` where `rekeySession` loads `loadSeatMap(tx, id)` once and runs one step per store in a fixed order, each step adding to a per-session tally that merges into the report only after commit; `sessions++` only when the tally changed something. Catch per session: `failed++`, `console.error("[seat-keys] session <id> was left as it was:", err)`, go on. After the loop, `failed > 0` → throw one `Error` naming the count. Make the steps a list the JSON worker can append to.
5. **Owner-column stores** — `attribute_values`, `attribute_configs`, `zone_contents`, `owner_sheets`, `attribute_carries`; rows `where session_id = <id> and owner_kind = 'session_cast'`, grouped by `owner_id` (the card):
   - `targets = memberFormTargetsOf(map, { kind: "session_cast", id: cardId })`.
   - `[]` → `left += <rows>`, rows untouched.
   - Otherwise the rows move to `targets[0]` (`owner_kind`, `owner_id` updated), and **★K-2 (ruled 2026-11-08): "a card in a character seat AND persona seat(s) → copy the shared values to each seat"** — for each further target, insert a copy of every such row (all columns but `id`, same `created_at`, anchors, provenance) under that target; `copied += <rows inserted>`. Do the copy **before** the update (or select first). Prefer set-based SQL for `attribute_values`, `attribute_configs`, `zone_contents` (one `insert … select` per extra target and one `update … where session_id = ? and owner_kind = 'session_cast' and owner_id = ?` per card); these tables can hold thousands of rows per session.
   - **Unique keys** — `owner_sheets_owner_sheet_uq` (owner_kind, owner_id, session_id, sheet_id) and `attribute_carries_owner_slot_uq` (session_id, owner_kind, owner_id, slot_id). A merged pair (two cards whose seats now name one cast member: the live survivor seat and a departed seat with `merged_into`) lands two rows on one key. Rule (plan §34.1, ruled): **"survivor's row wins, else newest."** Plan these two tables in memory per session: the would-be final rows, plus any row of the session already on a target key (member form or `player_seat`), grouped by unique key. In a group of more than one: keep the row that came from the **survivor seat's card** — the card of the first seat in the map (live first, `seatOf`'s order) whose `castMemberId` is that member; else the newest (`created_at` desc, then `id` desc). Delete the others (`dropped += n`). Never let the insert/update hit the unique index.
   - `rekeyed[store] += <rows moved>` (copies count in `copied`, not here).
6. **`state_proposals`** — rows `where session_id = <id> and payload -> 'owner' ->> 'kind' = 'session_cast'`: `payload.owner` → `memberFormOf(map, payload.owner)` (a proposal **names** one owner, so the first target only — not a copy); null → `left++`, row untouched; else write the payload back with only `owner` replaced (every other key kept as it is). Check the payload shapes in `schema.ts` (`state_proposals.payload` doc ~line 10455) and `src/lib/server/state/write.ts` (search `payload.owner`, `ownerLabel`): `{ owner, slotId, value }`, list op `{ owner, slotId, op, items }`, `clock` (no owner), `library` (no seat owner — leave). Write the payload rekey as a **pure** function on one payload object (`rekeyProposalPayload(payload, map) → { payload, changed, left }`) — the JSON worker reuses it on proposals held inside `session_messages.rewind_taken`. Likewise write the owner-row rekey as a pure function on one row object (`{ ownerKind, ownerId, … }` → list of target rows) for reuse on rows held in `rewind_taken`.

## Tests — new `src/lib/server/sessions/seatKeys.int.test.ts`

Harness: copy `src/lib/server/sessions/seatMembers.int.test.ts` lines 1-80 (the `vi.mock("$lib/server/db")` with `createTestDb`, `mkdtemp(path.join(os.tmpdir(), "serene-pub-vitest-seatKeys-"))`, `releaseDataDir` in `afterAll`, `vi.setConfig({ testTimeout: 60_000, hookTimeout: 60_000 })`) and its fixture helpers (user, book, card, member, session, seats). Seed seats with members directly (insert `session_characters` / `session_personas` rows with `cast_member_id` set) and state rows directly in card form. Claims, one test each:
- nothing to do: zeros, nothing written (dump before = after);
- each of the five tables: a character seat's `session_cast:<card>` rows → `seated_member:<member>`; a player seat's (persona card) → `player_seat:<seatId>`;
- ★K-2: a card held by a character seat AND a persona seat → rows on `seated_member:<member>` and copies on `player_seat:<seatId>`, every column but `id`/owner equal; `copied` counted;
- merged pair on `owner_sheets` and on `attribute_carries`: the survivor's row kept, the other dropped; and when only the departed card has a row plus an existing member-form row, the newest kept; `dropped` counted; no unique-index error;
- **ids overlapping in one range** (pattern `seatMembers.int.test.ts:198`: move both id sequences with `setval` so card id N equals another person's member id N): the row lands on the right member, never the decoy;
- hard-deleted card (no seat holds it) → counted in `left`, row unchanged; member-less departed seat → counted and left;
- a proposal's `payload.owner` rekeyed, other payload keys byte-identical; a `clock` proposal untouched;
- **second run**: a dump of every touched table identical to after the first run, and the report all zeros (fixture with no left cases); a fixture with a left case: second run changes nothing and counts the same `left` again (say so in a comment — the left rows stay card form until S5);
- **one session's failure rolls back that session alone**: `vi.mock("$lib/server/state/seatRefs", …)` wrapping the real module so `memberFormOf` throws when `map.sessionId === failing.sessionId` (proposals run after the column stores, so that session's column rewrites must be rolled back); the other session committed; `failed: 1`; the pass throws after the loop (assert with `rejects`) — or, if you prefer, return the report and throw; match seatMembers.ts.

Command (from `/home/jody/github/serene-pub`, capped; never pipe vitest into `head`):

```
SP=/tmp/claude-1000/-home-jody-github-serene-pub/9382c94a-1330-4480-b65e-0cfdb1f75e97/scratchpad
systemd-run --user --scope -p MemoryMax=6G -p MemorySwapMax=0 --quiet bash -c "export NODE_OPTIONS=--max-old-space-size=4096; npx vitest run src/lib/server/sessions/seatKeys.int.test.ts src/lib/server/state/seatRefs.test.ts --maxWorkers=2 > $SP/s4-f-pass-w2-tests.log 2>&1; echo test-exit=\$? >> $SP/s4-f-pass-w2-tests.log"
```

## Rules your work depends on (quoted)

- CLAUDE.md Hard rules: "Inside `db.transaction(async (tx) => …)` use only `tx` — the outer `db` deadlocks PGlite silently; `db/transactionGuard.ts` throws in dev/test." "Never add a top-level `await` to `src/lib/server/db/index.ts`." `seatKeys.ts` must **not statically import `$lib/server/db`** — take the handle as the first argument (as seatMembers.ts and seatRefs.ts do).
- CLAUDE.md Standing ruling: "0.6 is in users' hands. A change to stored data or ids ships with a forward migration or boot pass and a test that a second boot changes nothing."
- Plan §34.1 (ruled): "a card-form key maps to exactly what `seatOf("character:<card>")` returns today … character seat → `seated_member:<cast_member_id>`; player seat → `player_seat:<seatId>`." "merged pair collides only on `owner_sheets_owner_sheet_uq` / `attribute_carries_owner_slot_uq` (survivor wins, else newest); hard-deleted card / member-less departed seat → counted and left." ★K-4 (ruled): **no** unique (session, member) index now — don't add one.
- No migration, no new table or column, no setting. If you think one is needed, stop and say so.
- Card ids and cast member ids share one integer range: never read a `seated_member` id as a card id (a wrong-person read is silent).
- NOMENCLATURE R1/R3: use the plan's names (`seat-keys`, card form, member form, seat, cast member, player seat); don't coin others. It is a **session**, never a chat. Never frame a session as having no lorebook.
- Prettier: run `npx prettier --check` on your two new files; they're new, so `--write` them whole is fine.

## Files owned

`src/lib/server/sessions/seatKeys.ts` (new), `src/lib/server/sessions/seatKeys.int.test.ts` (new).

## Files readable

Anything. Start with: `src/lib/server/sessions/seatMembers.ts`, `src/lib/server/sessions/seatMembers.int.test.ts`, `src/lib/server/state/seatRefs.ts`, `src/lib/server/state/seatRefs.test.ts`, `src/lib/server/db/schema.ts` lines 10140-10470 and 10540-10600 and 10900-11045 (the owner tables), `src/lib/server/db/rawRows.ts`, `src/lib/server/utils/testDb.ts`.

## Out of scope

`startup/index.ts`; the JSON stores (zone `entries[].fields.towards`, `sessions.annex`, `annex_audiences`, `genre_fields`, `widget_settings`, message speaker/blocks, `rewind_taken`, `annex_deltas` — the next worker); `seats.ts` / `seatMembers.ts` (another worker is editing them right now); anything under `state/**` (lane f-door is editing it right now); NOMENCLATURE.

## Stop and ask (in your report) when

A new name beyond the ones above, a setting, a migration or an index seems needed; the translator's answer seems wrong for a case (don't work around it — report the input and output); a store's rows don't carry `session_id` as assumed.

## Done means

`seatKeys.int.test.ts` green (every claim above), `seatRefs.test.ts` still green, prettier clean on both files, `npx tsc --noEmit -p .` not needed (I run it). Report: the file's exported surface, the step list and fast-path branch list as built (so the next worker can extend), each test with pass/fail, decisions you made, anything noticed and not done.
