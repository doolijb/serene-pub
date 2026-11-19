# REPORT: lane `perf-4` (2026-11-17), statements per reply, fourth pass (programme 0.5)

Cuts 1, 2 and 3 are built; cut 4 was profiled only. After every cut all eight baseline fingerprints are byte-identical to `plans/perf-3-shas-final.txt`. Second-world statements per reply: **Story 1040 → 806 (−23 %), the Lair 2279 → 1928 (−15 %)**. A push to two members (owner and guest): **338 → 220** statements.

## Cut 1: the two fields-only readers

- `sessionKeepsEveryTurn` (`sessions/settings.ts`) reads through the existing `genreFieldsFor`.
- `sessionSpeechSettings` (`pipelines/speech/sessionSpeech.ts`) runs the same reads itself (session row → `getSessionGenre` → `cascadeSessionFields`) without a catch, so its fallback to the raw `genre_fields` is kept (`genreFieldsFor` returns `{}` both on failure and on empty). Each reader costs 4–5 statements, against 98–110.
- What could invalidate it: `fields` reads only `genreId`, `presetId`, `genreFields`, the genre declaration and the preset row. A failed keep read still ends as `null` in both `verbs.ts` callers, without the `console.warn`. The speech fallback triggers only when the cascade's own reads fail (before: any failure anywhere in the whole document).
- Test: `sessions/settings.fieldsReaders.int.test.ts`, frozen literals captured from the code before the change (five genres, with and without overrides, two preset cases, a missing session, the cascade-failure fallback).

## Cuts 2 and 3: the actions push reads the offer and the rewind state once per push

- `pushNow` makes one holder per push. In `buildSessionActions` the first interested member's build starts the offer read (row + `listSessionFunctions`) and `rewindStateOf` and stores each promise; other members wait on the same read. A failed read is dropped so the next member reads again. The socket handler passes no holder.
- What could invalidate it: the holder is a local of one push; a write by another request between two members' builds is seen at the next push. Nothing mutates the shared values. Per-member rules untouched: `resolveAudiences`, `seenSetFor`, `audienceHolds`, `turnDeleteRefusedThrough`, `emitRedacted`.
- Test: `sessions/actionsPush.perPush.int.test.ts` freezes per member `canAct`, visible actions, `isNew`, `deleteRefusedThrough`, `rewind` (Story and Dungeon Crawler worlds); a two-member push costs less than two one-member pushes; a push with no interested member costs 0 statements; a write between pushes is seen.

| | Story a (1st/2nd) · c · d · e | Lair a (1st/2nd) · c · d · e |
|---|---|---|
| start | 1478/1040 · 1460 · 1350 · 1291 | 2283/2279 · 2279 · 1849 · 2292 |
| cut 1 | 1358/806 · 1342 · 1216 · 1181 | 1932/1928 · 1928 · 1498 · 1941 |
| cuts 2, 3 | = (one member watching) | = |

## Cut 4: profiled only

Both sites read through the run's own host. They miss because the memo is cleared at the start and end of every `host.call` and `host.commit` (`host.ts:851-856`): in the Lair `bindings.ts:786` misses after the two embed calls and `bindings.retrieval.ts:518` after the `placeholder` commit; in Story `:518` after `placeholder`. About 51 statements per miss: ~53 per Story reply, ~102 per Lair reply. A fix means narrowing the clear in `host.ts`.

## Tests

Baselines `plans/perf-4-c{0,1,2,3}.log`; grouped lane run `plans/perf-4-final.log` 13 files, 101/101; `tsc` 0.

## What remains

- Cut 4's clear rule in `host.ts`.
- Story's drop (−234) is about twice one speech read; probably the old own-host settings read also built the narrator name. Not isolated.

## Noticed, not done

- A preset's `keepEveryTurn` reaches Story's `fields` though Story does not declare it (the preset layer lets undeclared keys through). Existing behaviour, frozen in the test.
- Literals in `perPush.int.test.ts` include fixture message ids (5, 16): they depend on test order within the file.
- Prettier: both new test files fail `--check`.
- A failed fields read in `sessionKeepsEveryTurn` ends as `null` with no `console.warn` (`genreFieldsFor` swallows errors, `sessionGenres.ts` 450-452; `verbs.ts` 752, 779 no longer see a throw).

## Nomenclature ledger line

- **2026-11-17 (lane perf-4 — statements per reply, fourth pass).** No new words: `ActionsPerPush` · `sharedRead` (`sockets/sessions.pipelines.ts`), what an actions push reads that does not depend on the viewer, read once per push; and the `buildSessionActions` option `perPush`. Internal; no wire, label or type id.

## Scope review fix

- The per-push test now pins the cut: the second member costs less than a member alone (`two - one < other - roster`); it fails without the per-push sharing.
- The shared offer read passes `null` to `listSessionFunctions` (its `userId` is optional/nullable and ignored), so the shared value has no member input.
- `settings.fieldsReaders.int.test.ts` gained frozen cases captured from the pre-change code: a deleted preset and an unknown genre; none differed from the working tree.
