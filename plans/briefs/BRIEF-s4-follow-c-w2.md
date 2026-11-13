# BRIEF — s4-follow-c worker 2 (2026-11-09): the seats that changed since the previous turn, a read genres opt into

Supervisor: lane `s4-follow-c`. App repo `/home/jody/github/serene-pub`; SDK repo `/home/jody/github/serene-pub-sdk`. Use absolute paths; your cwd resets between shell calls.

*This is an implementation task. Answer any relayed status question in one line in your report, and still do all the work.*

*Never run `git stash` in any form, including `--keep-index` or to probe prettier; it stashes every other lane's uncommitted work. Use `npx prettier --check <file>`.*

*Never commit. Never `npm test` or `npm run build` at the SDK root. Delete only the `/tmp/serene-pub-vitest-*` dirs your own tests made, by name; never a glob over `/tmp/serene-pub-*`.*

*Before any `sdk:build`, check `pgrep -af "vite dev"` for a serene-pub server. If one is up, don't build; report 'blocked on your dev server'.* The owner's `vite dev` runs on :5173: **do not build the SDK and do not run `sdk:test`.** Never `git checkout` / `restore` / `stash` / `clean` in the SDK repo; most of it is uncommitted.

## The owner's ruling you build (quote, never reinterpret)

Owner, 2026-11-09: **"Yes, a read genres opt into"**. Before that: "Might also want a flag somewhere that a seat was filled within the last turn, and which seats changed, in case a genre wants to run a pass over them in the background."

Principle P1 (owner 2026-11-04): "A *new* automatic behaviour is **off in core until a genre opts in**." The modder rule (owner 2026-11-08): plugins never parse ref strings (typed, host-filled fields do it); one JSDoc sentence per new field; INTEGRATING and the guide examples move in the same change; a refusal says what to do instead. "The SDK should feel like Drizzle: typed, one way."

## The design (decided by the supervisor; build exactly this)

**No new storage.** Every roster change already lands on the session's ledger, `session_changes` (module `src/lib/server/messages/sessionChanges.ts`, written by `emitSessionEvent`): the one seat writer's `announceSeatChanges` (`src/lib/server/sessions/seats.ts` ~l.1531) records `core:event/member-added@1` / `member-removed@1` with `{ ref, change }`, and the bench records `core:event/cast-changed@1` (`change: 'enabled' | 'position' | 'portrayal' | …`). Each landed line records `core:event/message-completed@1` with its `messageId`. The read is derived from those rows; it never re-diffs seats.

**The turn.** `turn-ended` is emitted by `noteLineLanded` (`src/lib/server/pipelines/routines/moments.ts` ~l.300) for a line M on lane L. "Since the previous turn" is the window of ledger ids `(after, through]`:
- `through` = the highest `session_changes.id` of this session with `event = message-completed` and `message_id = M` (M's latest landing; a regenerate lands again and widens the window, deterministically). None → the read is `[]`.
- `after` = the same for the **previous turn-taking line of lane L** (the greatest message id < M that `turnNumber` (~l.105) would count on that lane: same filters — not `system`, not a greeting, not `goalReached`, not a routine run's line, same lane rule; share one where-builder between the two, do not copy it). When that line has no `message-completed` row (lines from before the ledger), fall back to the highest ledger id of the session with `at` ≤ that message's `created_at`. No previous turn → 0.
- Rows in the window with `event` in member-added · member-removed · cast-changed, by id.

**Netting, per seat.** Resolve each row's `ref` with `seatOf(db, sessionId, ref)` (`sessions/seats.ts` ~l.1643, the existing compatibility read; it finds departed seats too, and returns null for envoys and unknown refs → skip the row). Key each seat by its member-form ref `hostSeatRefOf(seat)` (`src/lib/server/pipelines/prompt/seatCards.ts` ~l.340), so a card-form and a member-form row of one seat merge. Per seat: added counts +1, removed −1; a sum > 0 is `added`, < 0 is `removed`; 0 is `changed` only when the window also holds a cast-changed row for it whose `change` is not `'position'` (a reorder is not a change), else the seat is left out (it joined and left inside the turn). Entries in order of each seat's first row. Import `seats.ts` and `seatCards.ts` by dynamic `import()` as `announceSeatChanges` does.

**The opt-in** reuses the genre shape, like `forms.modelAnswers` (`runTurn.ts` ~l.1563–1580, read as `getSessionGenre(db, await sessionGenreOf(db, sessionId))?.shape`): 🚧 `SessionShape.seatChanges?: boolean`. Only when it is `true` does `noteLineLanded` compute the read and put 🚧 `seatChanges: TurnSeatChange[]` on the `turn-ended` payload — `[]` when nothing changed, so a pass can tell "nothing changed" from "not asked". Absent or false: the payload is exactly today's and no ledger query runs. No core genre declares it, so no core genre changes.

**A pass** is an ordinary registration the genre already can declare: `register(afterEachTurn(), pass, { allowStacking: true })` in its defaults (Allow stacking on, because a skipped firing would lose that turn's list). The routine inlet's `cause` already carries the moment's payload whole; also copy the list onto 🚧 `RoutineCause.seatChanges` in `causeOf` (`src/lib/server/pipelines/routines/evaluate.ts` ~l.96) for `turn-ended`, so a script reads it typed.

## SDK (in `/home/jody/github/serene-pub-sdk`)

1. `sdk/src/events.ts`: a new exported interface after `SessionChangePayload` (~l.1478):
   ```ts
   /**
    * 🚧 One seat that changed since the previous turn of its lane, as `turn-ended` carries it in
    * `seatChanges` when the session's genre declares `shape.seatChanges: true` (owner 2026-11-09).
    * The host builds it from the seat writer's announcements (`member-added`, `member-removed`,
    * `cast-changed`), netted per seat: a seat that joined and left inside the turn is absent.
    * ⚠ Not `CastChangePayload` (one event as it happened), and not the host's own `SeatChange`
    * (what one seat-writer call did).
    * @experimental
    */
   export interface TurnSeatChange {
   	/** The seat as a participant reference in member form (`seated-member:<id>`, `player-seat:<id>`): pass it on, never parse it. */
   	ref: string
   	/** Which kind of seat it is: a character seat or a player seat. */
   	seatKind: 'character' | 'player'
   	/** The cast member in the seat; null when the seat names none. */
   	castMemberId: number | null
   	/** `added`: the seat joined; `removed`: it left; `changed`: it stayed but was switched on or off, or who portrays it moved (a reorder is not a change). */
   	change: 'added' | 'removed' | 'changed'
   }
   ```
   and on `SessionChangePayload`, beside the other `turn-ended` fields: `/** 🚧 \`turn-ended\`, when the genre declares \`shape.seatChanges: true\`: the seats added, removed or changed since the previous turn of this lane; empty when none. */ seatChanges?: TurnSeatChange[]`.
   Do **not** change any `defineEvent` `description`/`name` string (they are pinned); JSDoc only.
2. `sdk/src/cadences.ts` `RoutineCause` (~l.1451): `/** 🚧 \`turn-ended\`, when the genre declares \`shape.seatChanges: true\`: the seats that changed since the previous turn (\`TurnSeatChange\`). */ seatChanges?: readonly TurnSeatChange[]` (import the type).
3. `sdk/src/descriptors.ts` `SessionShape` (after `castFromLorebook`, ~l.1052):
   ```ts
   /**
    * 🚧 **Seat changes on each turn** (owner 2026-11-09, "Yes, a read genres opt into"): `true`
    * puts `seatChanges` (`TurnSeatChange[]`) on `turn-ended` and on a routine's `cause` — the
    * seats added, removed or changed since the previous turn of that lane. Absent = off in core
    * (P1): the payload carries nothing. A pass over them is an ordinary registration, e.g.
    * `register(afterEachTurn(), pass, { allowStacking: true })`.
    * @experimental
    */
   seatChanges?: boolean
   ```
4. `sdk/src/genres.ts`, beside the `castFromLorebook` check (~l.1115): refuse a `shape.seatChanges` that is present and not a boolean: `` `${id}.shape.seatChanges must be true or false. Declare seatChanges: true for turn-ended to carry the seats that changed, or leave it out.` `` (★ copy, build it).
5. Tests: new `sdk-tests/genreSeatChanges.test.ts` in the style of `sdk-tests/genreCastFromLorebook.test.ts` (`node:test` + `node:assert/strict`, imports from `@serene-pub/sdk`): `true` and `false` survive `genre()` unchanged; absent stays absent; a string or object is refused with the sentence; a typed `TurnSeatChange[]` assigns to `RoutineCause['seatChanges']` and `SessionChangePayload['seatChanges']` (a compile-time check: the suite runs `tsc --noEmit` first). You cannot run it (no build); say so.
6. `INTEGRATING.md` §1i (~l.1262), the **Routines** bullet (~l.1307): one or two sentences on `shape.seatChanges`, the `turn-ended` / `cause` field, the window and netting rule in one line, and that a pass registers with `allowStacking: true`. If §5a's census lists the routine inlet or turn-ended with tests, add the new test file names there.
7. `guides/genres-presets-and-routines.md`, under **Routines and cadences** (after "### A routine that writes as a character", ~l.217): a short `### A pass over the seats that changed` with what it is (two sentences) and one example. The guide's code blocks are compiled with a `<!-- prelude: … -->` comment for their imports and declared stand-ins (see the **Allow stacking** example at ~l.239); follow that form exactly. Show the shape opt-in, the registration with `allowStacking: true`, and reading `cause.seatChanges` typed (e.g. filtering `change === 'added'`). Say plainly: a plugin never parses `ref`; it passes it on.

## App (in `/home/jody/github/serene-pub`)

1. `src/lib/server/messages/sessionChanges.ts` (the ledger owns reads of its rows): small exported reads — the highest `message-completed` id for a message, the highest id at or before a time, and the seat-event rows between two ids (payload `ref`, `change`, `event`, id order). Each with a one-line JSDoc. Never throws into its caller beyond what the existing reads do.
2. `src/lib/server/pipelines/routines/moments.ts`: the window and netting above as one exported 🚧 function (e.g. `seatChangesOfTurn(db, { sessionId, messageId, lane })`) and a 🚧 opt-in reader (e.g. `sessionReadsSeatChanges(db, sessionId)`), and in `noteLineLanded` add `seatChanges` to the `turn-ended` payload only when opted in. Update the module table's turn-ended payload cell and add a line under the table for the read. `round-ended` is unchanged.
3. `src/lib/server/pipelines/routines/evaluate.ts` `causeOf`: copy an array `p.seatChanges` onto `base.seatChanges` for `turn-ended` only.
4. `docs/pipelines.md`: find where routines / `turn-ended` are described (grep `turn-ended`, `After each turn`) and add one short paragraph for genre authors: a genre that declares `seatChanges: true` gets the seats that changed since the previous turn on each turn; off otherwise. Plain words.

Rules that apply: never call `emitSessionEvent` inside a transaction; inside `db.transaction(async (tx) => …)` use only `tx`; never a top-level `await` in `src/lib/server/db/index.ts`; `defaults.ts` imports stay leaf. The SDK's `parseParticipantRef` does not know `seated-member:` — use `seatOf` / `parseSeatRef`, never parse refs by hand.

## Files owned (edit only these)

SDK: `sdk/src/events.ts`, `sdk/src/cadences.ts`, `sdk/src/descriptors.ts`, `sdk/src/genres.ts` (only the pieces above), new `sdk-tests/genreSeatChanges.test.ts`, `INTEGRATING.md` (§1i, §5a row), `guides/genres-presets-and-routines.md`.
App: `src/lib/server/messages/sessionChanges.ts`, `src/lib/server/pipelines/routines/moments.ts`, `src/lib/server/pipelines/routines/evaluate.ts` (`causeOf` only), new `src/lib/server/pipelines/routines/seatChangesOfTurn.int.test.ts`, `src/lib/server/pipelines/routines/evaluate.test.ts` (one case), `docs/pipelines.md`.
Never touch `sessions/seats.ts`, `sockets/sessions.ts`, `runtime/host.ts`, `NOMENCLATURE.md`, any image-generation file, or another file not listed.

## Tests (Done means: all green; the SDK test written, not run)

`seatChangesOfTurn.int.test.ts` (copy the DB harness of `src/lib/server/sessions/seats.int.test.ts` or `src/lib/server/messages/sessionChanges.int.test.ts`; DB-opening `it`s need a 60 s timeout):
- Make seats with the real writer (`seatCast`, `seatPlayer`, `unseat`, `setSeatEnabled` in `sessions/seats.ts`): a carded character seat, a card-less character seat (by `castMemberId`), a persona player seat and a card-less player seat. Write the ledger the real way where you can (`announceSeatChanges` for member events; `recordSessionChange` for `message-completed` and `cast-changed` rows), with lines from `insertLegacy` (`$lib/server/messages/store`).
- Turn 1 lands; then seats are added, one removed, one benched; turn 2 lands → `seatChangesOfTurn` for turn 2 is exactly those, with the right `seatKind`, `castMemberId`, `ref` and `change`, for card and card-less, character and player seats.
- Turn 3 with nothing in between → `[]`.
- An add then a remove of the same seat inside one turn → absent; a reorder (`cast-changed` `position`) alone → absent.
- A line on another lane does not end the story lane's window.
- `noteLineLanded` with the session's genre **not** opting in → the `turn-ended` payload has no `seatChanges` key; opted in → it carries the list. Capture the payload with `vi.mock("$lib/server/pipelines/runtime/sessionEvents", …)` around `emitSessionEvent`, and fake the opt-in by mocking `getSessionGenre` (`$lib/server/pipelines/entities/sessionGenres`) partially, keeping its other exports.

`evaluate.test.ts`: `causeOf` on a `turn-ended` payload with `seatChanges` copies it; without, none.

Run only these, capped, logged into the scratchpad:

```
S=/tmp/claude-1000/-home-jody-github-serene-pub/9382c94a-1330-4480-b65e-0cfdb1f75e97/scratchpad
systemd-run --user --scope -p MemoryMax=6G -p MemorySwapMax=0 --quiet bash -c "export NODE_OPTIONS=--max-old-space-size=4096; cd /home/jody/github/serene-pub; npx vitest run src/lib/server/pipelines/routines/seatChangesOfTurn.int.test.ts src/lib/server/pipelines/routines/evaluate.test.ts src/lib/server/pipelines/routines/routines.int.test.ts src/lib/server/messages/sessionChanges.int.test.ts src/lib/server/sessions/seats.int.test.ts src/lib/server/sockets/sessions.seatEvents.int.test.ts --maxWorkers=2 > $S/s4-follow-c-w2-tests.log 2>&1; echo test-exit=\$? >> $S/s4-follow-c-w2-tests.log"
```

The app reads the SDK through its built `dist/`, so a test that needs the new SDK *types* still runs (types are erased); keep the app code free of imports of new SDK *values*. Type the app's payload field locally (or as `unknown` checked at runtime) if `TurnSeatChange` is not in the built SDK yet, and list in your report exactly which app type errors would wait on `sdk:build`. Never pipe vitest into `head`. Then `npx prettier --check` your changed files; `--write` only the lines you changed; if a file fails only on lines you didn't touch, leave it and say so. No tsc/check run: the supervisor runs those.

## Stop and ask (write it in your report and stop that item) when

- the read can't be built from the ledger as written (a row missing, a window that can't be found) — say what is missing; never add a column, table or migration;
- the opt-in can't be read from the genre shape;
- any core genre's turn-ended payload or runs would change;
- a pinned SDK hash or golden would move.

## Report

Your final message: changed files (both repos) with one line each; tests run and results; the SDK test file written and not run; the app type errors that wait on `sdk:build` (file:line); the ★ copy as built; anything you decided (name it); **Noticed, not done**.
