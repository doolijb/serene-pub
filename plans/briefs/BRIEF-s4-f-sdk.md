# BRIEF — lane `s4-f-sdk` (wave 1; first lane of the flip unit, waves 1–3) — SDK + core-catalog side of the flip, and removing `attach-lorebook@1`

Read `plans/briefs/BRIEF-s4-common.md` first (esp. the **Modder rule**), then plan §34.1, §34.5 (the ⚠ "Waves 1–3 are one unit" line), §29 "Removal timing" (~616–620) and the 2026-11-08 rulings. SDK repo: `../serene-pub-sdk` (edit SDK code **there**; never `git checkout`/`restore`/`stash` in it — most of it is uncommitted; never `npm test`/`npm run build` at its root; use the app's `npm run sdk:test` / `npm run sdk:build`).

⚠ **Waves 1–3 are one unit.** Your SDK changes must leave the app building and its tests green while core still emits card forms (waves 1–2): everything you add is **additive and tolerant of both forms** until wave 3 flips the values. Nothing here removes a name core still emits (that's S5).

## Goal

1. **S3G's "For S4" list** (`plans/REPORT-s27-S3G-2026-11-05.md:174-218`), SDK/core-catalog half:
   - `StatsWidget.svelte` (~354) `hasFace`: a `seated_member` owner gets its face.
   - Owner matching (`stateOwnerKeyOf`, `pinnedPortraitsOf`): a `player_seat` owner matches by the seat's `ref` like `seated_member` does.
   - Crawler round script `hasDeclared`: a declaration counts when stamped with the seat's current `ref` **or** its pre-flip card form (so wave 3's flip doesn't orphan a declaration made mid-round); queue the "stamp with the new ref" emit change for f-emit (wave 3) in your report.
   - Scene Portraits stored lines: `seated-member:<id>=` read, ⏳ `character:<id>=` still read (until S5).
   - The app-side items in that list (`routes/sessions/[id]/+page.svelte` `participantOf`, `NextCharacterBlock`) belong to f-client (wave 3) — list them in your report as queued.
2. **Form hint for a member holding both seat forms** (§34.1 gap 2): SDK `senderRefOf` (`sdk/src/turnOrder.ts:183-200`) resolves a member through `refOfMember(castMemberId)` with no hint, so a persona line from a member who also holds a character seat resolves to the character seat. Give the lookup what it needs to pick the right seat (e.g. the message's player/persona flag) — design it so a plugin author never has to know this case exists. New parameter or field = a name: 🚧, JSDoc sentence, propose in report if it isn't obvious. The app caller (`speakerRotation.ts:115-140` `seatRefLookupOfCast`) is f-emit's (wave 3) — queue it.
3. **★K-1 (ruled): `cast.byId` is keyed `seated_member:<id>`** (mirrors `player_seat:<id>`). Update the SDK types' JSDoc, INTEGRATING §1c/§1d/§1f, guides and every example so a plugin reads entries by the host-filled `ref`/`castMemberId`, never by parsing the key. Core flips the values in wave 3.
4. **★B-4 (ruled): remove `core:outlet/attach-lorebook@1`** — SDK `contracts/src/outlets.ts:2181` declaration + registry hash pins + sdk-tests + guides; app side: `library/writes.ts` attach op (cases at ~45, 392, 473, 579, 637 — wave 0's lane routed it through `bookChangeRefusal`; now it goes), `pipelines/runtime/host.ts` (~2435 comment, ~2542 word, ~10484-10485 dispatch — **only these hunks**; f-emit owns host.ts in wave 3), `receipts.ts:64`, `config/panel/flows.ts:169`, `announce.ts:48`, `ledgerLines`. A stored pipeline that still names the outlet must fail **in words that say what to do instead** (e.g. "Attaching a lorebook to a running session was removed in 0.6 — a session keeps the book it started with; write into the session's book instead.") — check how the executor reports an unknown outlet today and make that path say it. **Migration note** in the SDK changelog/INTEGRATING (old → new, one example).
4b. **From wave 0's report (`plans/REPORT-s4-bk-lock-2026-11-08.md`):** when the op goes, update `src/lib/server/library/writes.bookLock.int.test.ts` (it pins the op's refusal) and the ⏳ op mention in NOMENCLATURE's **book lock** row; also `ledgerLines` mentions the op. **NOMENCLATURE.md is not yours this wave** (lane s4-cl runs beside you and queues to the lead too) — queue your rows (the outlet's §23 retirement, the form hint name, `cast.byId` key) in your report; the lead merges.
5. Golden repins (`coreCatalog`, `specHashes`, `registryHashes`) as your changes require, then `npm run sdk:test` green except known reds (K-2 derive-don't-spell in `speakMessage.ts` predates you — list it), then `npm run sdk:build` (**check `pgrep -af "vite dev"` first**; another session runs :5199 — if any serene-pub dev server is up, report "blocked on your dev server" and finish everything else).

## Files owned

SDK repo: `sdk/src/**`, `contracts/src/**`, `core-catalog/src/**`, `sdk-tests/**`, `guides/**`, `INTEGRATING.md`, the SDK registries. App: `src/lib/server/library/writes.ts`, the listed `host.ts` / `receipts.ts` / `flows.ts` / `announce.ts` hunks only, their tests.

## Out of scope

Any app emit or stored-key change (f-door/f-emit/f-pass, waves 2–3); removing `character:` / `session_cast` / `characterId` (S5); client files.

## Stop and ask when

Common brief's Decisions apply; a change can't stay tolerant of both forms; a published name must be renamed (only B-4's removal is ruled).

## Done means

- `npm run sdk:test` green (known reds listed); new tests for: `hasFace` with a `seated_member` owner, `player_seat` owner matching by ref, `hasDeclared` under both forms, `senderRefOf` choosing the persona seat for a member holding both, an outlet-removed pipeline failing with the words above.
- App: tests next to `library/writes.ts` and the host/receipts/flows hunks pass; `tsc` + `check` no new errors.
- `sdk:build` done, or reported blocked.

## Report

`plans/REPORT-s4-f-sdk-2026-11-08.md` — include the queue for f-emit and f-client, and the migration note text.
