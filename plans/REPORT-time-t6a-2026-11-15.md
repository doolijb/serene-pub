# REPORT — build lane `time-t6a` — firsthand cast members per message (2026-11-15)

Brief: `plans/briefs/BRIEF-time-t6a.md` (its Corrections rule). Saved by the lead from the supervisor's final
message. Built; **not looked at in a running app.** One migration, 0165. No SDK edit by the lane, no build.

## Inventory

Every new message row goes through `insertLegacy` / `insertLegacyMany` (`messages/store.ts` ~464/483): a person's
line and pipeline lines (`runtime/host.ts` ~8825, ~8975), the tray send (`attachments/send.ts:142`), greetings
(`sessions/greetings.ts:245`), goal lines, table lines; the next-chapter anchor (`sockets/sessions.ts:1657`) is
written before any seat exists and records `{}`; copies: the branch (`sessions/branch.ts:424`) and the import
(`sockets/import.ts:1706`). Swipe, regenerate and extend re-drive the row through the host's claim (`host.ts`
~8755). Back and Forward keep the row (`rewindOrdinal`); delete removes it. Seated: `seatInPlay`
(`sessions/seats.ts:1751`) on `session_characters` (envoys excluded) and `session_personas`. The durable key is
the cast member id: a branch's seats point at the parent's members, so copies need no remap; Reassign moves A→B;
a member merge goes through `repointSpeakerStamps`.

## Shape and cost

One nullable `integer[]` column `firsthand_cast_member_ids`: the members of every in-play character and player
seat, ascending and distinct; NULL = not recorded; `{}` = recorded, nobody there. No GIN index (lane `time-t6b`
filters a window it already reads by session). **Statements added per insert: 0** (a scalar subquery inside the
existing INSERT, two indexed scans); a re-drive adds 0 (the same subquery inside the claim's UPDATE); Reassign or
a member merge add one UPDATE each.

## Changed files

`db/schema.ts` (the column); `drizzle/0165_message_firsthand.sql` + meta (one `ADD COLUMN`); new
`src/lib/server/messages/firsthand.ts` (`withFirsthandStamp`, `firsthandRedrive`, `repointFirsthand`,
`firsthandOf`, `Firsthand`); `messages/store.ts`; `pipelines/runtime/host.ts` ~8770 (the claim patch: one
spread); `sockets/sessions.ts` (Reassign, both branches); `sessions/branch.ts` ~465; `sockets/import.ts` ~1705
(imported rows get NULL); `shared/widgets/messageV1.test.ts` (a fixture field); `NOMENCLATURE.md` (§14
**firsthand**, §25). New tests: `messages/firsthand.int`, `runtime/host.firsthand.int`,
`sessions/branch.firsthand.int`, `sockets/sessions.firsthand.int`, `db/messageFirsthand0165.int`.

## Tests

firsthand 9/9; host 2/2; branch 1/1; Reassign 2/2; migration 1/1 (a second boot changes nothing). `messages` +
`host.*` + `messageV1`: 46 files, 434 tests pass. `sessions`: 88 of 89 files (3 failures in
`genreFieldDefaults.int`, known). `sockets/sessions.*`: 108 of 109 (`sessions.forms.int`, known). `tsc` 0 errors;
`npm run check` 0 errors.

## Open ★

1. The column reaches clients: rows are posted whole, less the SDK's `MESSAGE_HOST_FIELDS`. **Lead:** the field
   is added to that list in the SDK source (`sdk/src/widgets.ts`); it takes effect at the next `sdk:build`, which
   is held behind the owner's server. Until then widgets receive it as an extra, undeclared field.
2. `host.ts` was edited (one spread in the claim patch) though not in the brief's list: accepted, correction 5
   needs it.

Assumptions: a player seat must also be unbenched to be recorded; the speaker is not forced into the set; a
Reassign whose new seat has no member leaves the old mark.

## Scope review and lead follow-up (2026-11-15)

Scope review: no objection; the migration is one `ADD COLUMN`; the stamp is a scalar subquery inside the INSERT
(no added statement), never overwrites a caller's value, gives `{}` for a session with no seats; removed and
inactive seats, envoys and memberless seats are excluded; re-drives rewrite the set; every road a row takes to a
widget goes through the SDK's `projectMessageRow`, so no app-side strip is needed once the SDK is rebuilt. Also
edited by the lane and now admitted: `sockets/import.ts` ~1705 (imported rows get NULL: needed, or imported
history would be stamped with whoever is seated at import time) and `shared/widgets/messageV1.test.ts`. The §25
line now says the column is host bookkeeping for widgets.

## Grouped verification (lead, 2026-11-15, third) — `time-t5a` + fix, `time-t10`, `time-t6a`

`tsc` 0 errors; `npm run check` 0 errors (9 old warnings). Full `vitest run` (`plans/lead-full4.log`): 2498 files,
2473 pass, 23 fail; 26,190 tests pass, 28 fail. Of the 23: 19 are the known baseline; 2 are environment
(`audiocpp/packages.v.int`, `net/hfDownload.v`); 1 is `sessionPage/remoteChronicle.dom`, which waits on the held
SDK rebuild (it asserts the reworded note); 1 is a teardown flake (`state/valueStamp.int`: `ENOTEMPTY` removing
its temp dir; the file is from 2026-11-11 and untouched). None is these lanes'. Still held behind the owner's
own server on port 4173: `npm run sdk:build` and `npm run build`.

## Builds unblocked (lead, 2026-11-15, morning)

The owner had his suspended `vite preview` on port 4173 stopped (it shut down cleanly: lock released, last
shutdown clean). Then: `npm run sdk:build` (twice; the second after naming `firsthandCastMemberIds` in
`MessageV1`'s "Withheld" paragraph and the contract test's recorded row, which the SDK's
`messageRowContract` test requires); `npm run sdk:test` 4,723 of 4,728 pass, the same four old failures;
`sessionPage/remoteChronicle.dom` and the widget and frame tests pass (30 files, 296 tests); `npm run build`
passes; `tsc` 0 errors.
