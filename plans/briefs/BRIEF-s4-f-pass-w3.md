# BRIEF — worker `s4-f-pass-w3` — the `seat-keys` pass: JSON stores (seat-cast S4, wave 2) — 2026-11-08

Supervisor: lane `s4-f-pass`. You are a lane-worker; you cannot spawn agents. Return your report as your final message (no report file).

*This is an implementation task. Answer any relayed status question in one line in your report, and still do all the work.*
*Never run `git stash` in any form, including `--keep-index` or to probe prettier; it stashes every other lane's uncommitted work. Use `npx prettier --check <file>`.*
*Never commit. Never `npm test` or `npm run build` at the SDK root. Delete only the `/tmp/serene-pub-vitest-*` dirs your own tests made, by name; never a glob over `/tmp/serene-pub-*`.*
*Before any `sdk:build`, check `pgrep -af "vite dev"` for a serene-pub server. If one is up, don't build; report 'blocked on your dev server'.* (You should not need `sdk:build`.)

## Background

Seat-cast S4 flips stored seat keys from **card form** to **member form** (plan §34.1). `src/lib/server/sessions/seatKeys.ts` already exists (previous worker; read it whole, ~520 lines): the `seat-keys` boot pass with the owner-column stores and `state_proposals`. Its extension points: `SEAT_KEY_STORES` (append store names; `rekeyed` is built from it), `CANDIDATE_BRANCHES: SQL[]` (fast-path `select session_id …` branches joined with `union`), `STEPS` (one `{ store, run(tx, map, tally) }` per store, in order), the internal `Tally`, and the pure helpers `rekeyOwnerRow(row, map)` and `rekeyProposalPayload(payload, map)`. Its tests are `src/lib/server/sessions/seatKeys.int.test.ts` (read the harness).

The one translator (lane f-door, `src/lib/server/state/seatRefs.ts` — read it; don't edit it):
- `memberFormOf(map, "character:<card>")` → `"seated-member:<memberId>"` (character seat) | `"player-seat:<seatId>"` (player seat) | **null** (no seat holds the card, or the seat it finds is member-less). Any string that isn't card form comes back unchanged.
- `memberFormTargetsOf(map, ref)` → every target, `seatOf`'s first first, member-less seats skipped; `[]` when none; `[ref]` when not card form.
- ⚠ The translator reads a **digits-only** string (`"12"`) as a state key and answers `seated_member:<id>`. In JSON stores, **only ever pass strings matching `/^character:\d+$/`** to it; anything else (names, `envoy:`, `user:`, `owner`, `narrator`, `player-seat:`, `seated-member:`, bare numbers) is left exactly as it is.

**Two kinds of card-form reference — the rule for this brief:**
- **A value held per seat, or a set of who may see** → **every target** (`memberFormTargetsOf`; ★K-2, ruled 2026-11-08: "a card in a character seat AND persona seat(s) → copy the shared values to each seat"). Lists are de-duplicated (first occurrence kept); map keys: a key already in member form wins, else the first translated.
- **A designation of one participant** (who spoke, who is addressed, a tie's other end, a turn) → **one target**: `memberFormOf`, or a **hinted** pick where the stored item says which seat kind it is: of `memberFormTargetsOf`, the first that starts with `player-seat:` when the hint says player seat (`seated-member:` when it says character seat), else `memberFormOf`. Write that as one small pure helper.
- null / `[]` → leave the item as it is, `tally.left++` (per item).

Write each store's rewrite as a **pure function on the parsed document** (input doc + map → `{ doc, changed, left }`), and a thin step that reads rows, calls it, and writes back **only rows that changed** (an unchanged row is never rewritten — the second run must leave every byte as it is). `tally.rekeyed[store] += <rows/documents changed>`; K-2 extra entries count in `tally.copied`.

## Goal — append these stores to `seatKeys.ts` (store names in this order; one step each, after `state_proposals`)

1. **`zone_towards`** — `zone_contents.entries` (jsonb array of held entries) of the session: each `entries[i].fields.towards` that is card form → designation (`memberFormOf`; a tie end). See `src/lib/server/rulesets/ties.ts:325-345` and `rulesets/zones.ts:200-226`. (The rows' owners were already rekeyed by the `zone_contents` step.)
2. **`annex_core`** — `sessions.annex` (jsonb) → the `core` owner document (`coreAnnexIn`, `src/lib/server/sessions/coreAnnex.ts`):
   - `turnOrder` (`TurnOrderV1`, `../serene-pub-sdk/sdk/src/turnOrder.ts:20-75`): `order[].ref` (string | null) → designation; `candidates[].ref` → designation **hinted by `candidates[].kind`** (`"persona"` → player seat, `"character"` → character seat; anything else → `memberFormOf`).
   - `turnTally` (`TurnTallyV1`, `src/lib/server/pipelines/routines/turnTally.ts:40-60`): per lane, `lastSpeaker` → designation; `turnsBy` keys → designation, two keys landing on one target **sum**; `spoke` and `persons` → designation, de-duplicated keeping the first position.
   - the Dungeon Crawler's progress document `core["dungeon-crawler-progress"].fates` (a map **keyed by participant ref** → a fate string; `../serene-pub-sdk/core-catalog/src/genres/dungeon-crawler/roundScript.ts:70-105`, `names.ts:45-70`) → keys are **values per seat → every target**. Look at `progress.heroes` too: if it is keyed by participant ref, **don't change it** — report it (it isn't on the ruled list).
   - Every other key of the annex and of `core` byte-identical. Take the annex lock first (`lockSessionAnnex(tx, sessionId)`, coreAnnex.ts:102). Write the whole `annex` column back only when changed. Don't move `annex_versions` (a key migration is not a story change).
   Make the core-document rewrite one pure function — `annex_deltas` and `rewind_taken` reuse it.
3. **`annex_audiences`** — `sessions.annex_audiences` (jsonb, owner → key → participant refs[]) — every owner, every key: refs → **every target** (who may see), de-duplicated. (`lorebooks.annex_audiences` is **left**, ★K-3.)
4. **`genre_fields`** — `sessions.genre_fields` (**json**, not jsonb): keys `speechAutoVoice:<ref>` (`src/lib/shared/sessions/speechSettings.ts:139-170`, prefix `SPEECH_AUTO_VOICE_PREFIX`) whose `<ref>` is card form → `speechAutoVoice:<target>` for **every target** (a voice per seat), value copied; a target key that already exists keeps its value. Other keys untouched, key order otherwise kept.
5. **`widget_settings`** — `widget_settings.values` (**json**) of rows with this `session_id`:
   - `chosenImages: string[]` entries `"<ref>=<image>"` (format: `chosenImagesOf` / `withChosenImage` in `../serene-pub-sdk/core-catalog/src/shared/ui/scene-portraits/portraits.ts:195-230`; the SDK accepts only `character:` or `seated-member:` on the left). For a card-form left side: when **every** target is `seated-member:<id>`, write `seated-member:<id>=<image>` (one entry per target, de-duplicated; an existing entry for that left side wins); when any target is `player-seat:` (or none), **leave the entry as it is** and `left++` (the SDK still reads a `character:<cardId>=` line through the host-filled `cardId` until S5).
   - `pickMembers: string[]`: lines exactly `character:<n>` → every target (de-duplicated); every other line (names!) untouched.
   - Genre-scoped `session_layout_presets.layout.widgetSettings` is **left** (★K-3).
6. **`message_speakers`** — `session_messages.metadata` (**json**) `speaker` when card form → designation **hinted by the row**: the row's `persona_id` equals the card → player seat; its `character_id` equals the card → character seat; else `memberFormOf`. The `messages` table has no `metadata` column — check whether `messages.extras` (or anything else on `messages`) ever carries a `speaker`; if it does, report it and treat it the same; if not, say so. Don't touch `cast_member_id` (the speaker stamp) — lane f-emit owns that.
7. **`message_blocks`** — `message_parts` rows with `type = 'core:blocks'` whose message (`message_parts.message_id → messages.id`) is in this session: `data.blocks` is a `MessageBlock[]` tree (`../serene-pub-sdk/sdk/src/messageBlocks.ts:60-230`; a `group` block nests `blocks`) — each block's `addressee` and `answered.by` when card form → designation (`memberFormOf`). `addressee` may also be `"owner"` or another non-card string — untouched.
8. **`rewind_taken`** — `session_messages.rewind_taken` (**json**, `RewoundTakenV1`, `src/lib/server/sessions/rewind.ts:85-110`; `RetractedState`, `src/lib/server/state/write.ts:948-980`) of this session's rows, where not null:
   - `state.values[]`, `state.configs[]`, `state.zones[]` (whole rows as JSON, camelCase keys `ownerKind`, `ownerId`, …) → `rekeyOwnerRow` (the first keeps its `id`; a ★K-2 copy is the row **without its `id` key**, so Forward's restore inserts it with a fresh id — check `restoreRetractedState` in `state/write.ts` ~1120-1180 inserts rows as given, and say what you found); `state.zones[].entries[].fields.towards` as in step 1; `state.proposals[].payload` → `rekeyProposalPayload`; `state.annexDeltas[].row.before/after` as in step 9;
   - `turn.tally` (a `TurnTallyV1` or null) → the turnTally rule of step 2; `turn.elsewhere.values/configs/proposals` as above.
   - Everything else in the record (imprints, own-book entries, cast versions, scenes, dates as strings) byte-identical. Write back only when changed.
9. **`annex_deltas`** — `annex_deltas.before` / `.after` (jsonb `{ document, audiences }`, `AnnexDeltaSide`, `schema.ts:3347`) of this session: `audiences` (key → refs[]) → every target, de-duplicated; `document` **only when `owner = 'core'`** → the core-document rewrite of step 2. Another owner's document is **left** (the Mundi annex is ★K-3 left; other plugins' documents are not on the ruled list).

**Fast path:** append one `CANDIDATE_BRANCHES` branch per store, each naming only the paths you rewrite, so a left store (a Mundi document) never makes a session a candidate. jsonb renders `"k": "v"` with a space and json keeps the text as written, so match with a regex that allows both, e.g. `~ '"towards":\s*"character:[0-9]'`. Suggested: zone `entries::text ~ '"towards":\s*"character:[0-9]'`; sessions `select id as session_id from sessions where (annex->'core'->'turnOrder')::text ~ '"character:[0-9]' or …turnTally… or (annex->'core'->'dungeon-crawler-progress'->'fates')::text ~ … or annex_audiences::text ~ … or genre_fields::text like '%"speechAutoVoice:character:%'`; widget_settings on `values::jsonb -> 'chosenImages'` / `'pickMembers'`; `session_messages` on `metadata::jsonb ->> 'speaker' ~ '^character:[0-9]'`, and `rewind_taken is not null and rewind_taken::text ~ '"ownerKind":\s*"session_cast"|"character:[0-9]'`; message_parts joined to messages on `type = 'core:blocks' and data::text ~ '"(addressee|by)":\s*"character:[0-9]'`; annex_deltas on `before->'audiences'`, `after->'audiences'`, and the core document paths when `owner = 'core'`. Keep it one query. A store whose left items recur (a chosen image on a player seat) keeps its session a candidate on every run — that's accepted; say which.

Update the module doc of `seatKeys.ts`: it now holds every store; list them, and the two rules (values → every target; designations → one target, hinted where the row says which seat kind).

## Tests — new `src/lib/server/sessions/seatKeys.json.int.test.ts`

Same harness as `seatKeys.int.test.ts` (copy its mocks, data dir `serene-pub-vitest-seatKeysJson-`, `releaseDataDir`, 60 s timeouts). Seed rows directly in card form. One test per claim:
- each store 1-9: card form → member form, a character seat → `seated-member:` / a player seat → `player-seat:`; every other key / entry byte-identical (compare the untouched parts);
- hints: a `persona` turn candidate and a persona line's speaker on a card held by BOTH a character seat and a player seat → the player seat; a `character` candidate / character line → the character seat;
- values vs designations on a card held by both seats: audiences, fates, auto-voice keys, `pickMembers` get both targets; speaker / addressee / towards / `lastSpeaker` get one;
- `turnsBy` sums two keys landing on one member (a merged pair: a live survivor seat and a departed seat with `merged_into`, both with member M);
- `chosenImages`: a character seat's entry → `seated-member:`; a player seat's entry left and counted in `left`;
- non-card strings untouched: names in `pickMembers`, `envoy:x`, `user:1`, `"owner"` addressee, `narrator`, an existing `player-seat:` / `seated-member:`, and a **digits-only** string (e.g. a `pickMembers` line `"12"` where 12 is a seated card id) stays `"12"`;
- a Mundi-like plugin owner's annex document and its delta document containing `"character:12"` are untouched, and that alone doesn't make the session a candidate (fast path returns no session for it);
- `rewind_taken`: values/configs/zones/proposals/annex-delta rows rekeyed; a ★K-2 copy appears without `id`; dates and every other field identical; `turn.tally` rekeyed;
- hard-deleted card in any JSON store → item left, `left` counted;
- **second run**: a dump of every touched JSON column (zone entries, annex, annex_audiences, genre_fields, widget values, metadata, part data, rewind_taken, delta before/after — compare the stored **text**, e.g. `select col::text`) identical, and the report all zeros (fixture without left items); with a left item: nothing changes and `left` repeats.
- re-run `seatKeys.int.test.ts` — it must stay green (update only its expectations of the `rekeyed` keys if the new store names appear in a `toEqual`; nothing else in that file).

Command (from `/home/jody/github/serene-pub`, capped; never pipe vitest into `head`):

```
SP=/tmp/claude-1000/-home-jody-github-serene-pub/9382c94a-1330-4480-b65e-0cfdb1f75e97/scratchpad
systemd-run --user --scope -p MemoryMax=6G -p MemorySwapMax=0 --quiet bash -c "export NODE_OPTIONS=--max-old-space-size=4096; npx vitest run src/lib/server/sessions/seatKeys.json.int.test.ts src/lib/server/sessions/seatKeys.int.test.ts --maxWorkers=2 > $SP/s4-f-pass-w3-tests.log 2>&1; echo test-exit=\$? >> $SP/s4-f-pass-w3-tests.log"
```

## Rules your work depends on (quoted)

- CLAUDE.md Hard rules: "Inside `db.transaction(async (tx) => …)` use only `tx` — the outer `db` deadlocks PGlite silently." `seatKeys.ts` must not statically import `$lib/server/db`; every function takes its handle first.
- CLAUDE.md: "0.6 is in users' hands. A change to stored data or ids ships with a forward migration or boot pass and a test that a second boot changes nothing."
- Plan §34.1 (ruled): the rekey maps a card-form key to exactly what `seatOf("character:<card>")` returns today; "**Left:** `rankings.speaker_ref`, receipts' portrayals, `session_changes.payload`, Mundi annex, genre-scoped presets and book audiences (★K-3)." ★K-4: no new unique index.
- Card ids and cast member ids share one integer range: never read a `seated-member:` / `seated_member` id as a card id.
- No migration, table, column, setting, event or exported name beyond the store names above and the pure helpers. NOMENCLATURE R1/R3: use the plan's words (card form, member form, seat, cast member, player seat); it is a **session**, never a chat; never frame a session as having no lorebook.
- Prettier: `npx prettier --check` your files; your new test file may be `--write`n whole; in `seatKeys.ts` only `--write`… it's this lane's new file, so a whole `--write` is fine too.

## Files owned

`src/lib/server/sessions/seatKeys.ts`, `src/lib/server/sessions/seatKeys.json.int.test.ts` (new); `src/lib/server/sessions/seatKeys.int.test.ts` only as said above.

## Files readable

Anything. Named above, plus `src/lib/server/sessions/annexChanges.ts` (`AnnexDeltaTaken`), `src/lib/server/db/schema.ts` (`sessions` ~2590-2670, `session_messages` ~2902-3140, `annex_deltas` ~3340-3395, `message_parts` ~3400-3430, `widget_settings` ~8055-8090).

## Out of scope

`startup/index.ts`; `state/**` (lane f-door, editing now — including `restoreRetractedState` and its door); `rewind.ts`; `messages/store.ts` and the `cast_member_id` speaker stamp (f-emit); `seats.ts` / `seatMembers.ts`; anything client; NOMENCLATURE; the Back/Forward / attic / backup gate tests (next worker).

## Stop and ask (in your report) when

A store's real shape differs from this brief (report the shape and what you did NOT do); a store not listed holds card-form seat refs that a reader will look up after the flip (report, don't rekey); a new name, setting or migration seems needed; `restoreRetractedState` would not insert an `id`-less copy.

## Done means

Both test files green; prettier clean; report: store names and fast-path branches as built, each pure helper's signature, each test with pass/fail, the `messages.extras` / `progress.heroes` / restore-insert answers, decisions made, anything noticed and not done.
