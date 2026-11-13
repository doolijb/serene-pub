# Shared rules for s4-on test-triage workers (w2, w3) — 2026-11-08

Context: the seat-cast S4 flip is now ON. `src/lib/server/state/memberForm.ts` has `memberFormSwitch = { on: true }` (was `false`). With it on, a seat is stored and emitted in **member form**: a character seat's state owner is `{ kind: "seated_member", id: <castMemberId> }` (byId key `seated_member:<id>`, ref `seated-member:<id>`); **every player seat, carded or not**, is `{ kind: "player_seat", id: <seatId> }` (byId key `player_seat:<id>`, ref `player-seat:<id>`). A character seat with no cast member keeps card form (`character:<cardId>`, byId key `"<cardId>"`). The doors (`state/seatRefs.ts` `storedSeatRef`/`storedSeatOwner`) now translate a card form that comes in (`character:<cardId>`, `{session_cast,<cardId>}`) to member form; a card form they can't translate comes back unchanged. Each `state.cast.byId` entry carries host-filled `id` (the card id, 0 for a card-less player seat), `ref`, `castMemberId`, `cardId`, and `playerSeatId` on player-seat entries. Two live character seats on one member collapse to one link/entry (the lowest position) — the merge rule's pre-merge state. Card ids and member ids share one number range: never let a test pass by a number coincidence.

The failing tests you are given were written when the switch was off and assert card form. They are **stale expectations, not production bugs** — unless you find evidence otherwise (then stop on that test and report it; do not fix production code).

## How to fix each failing test (pick per test, name your choice per test in the report)

1. **The test's subject is the switch-off branch itself** (its name says "card form", "none is stored under seated_member", "the translated ref is the card's", an S2/S3 door test): pin that test to off — `memberFormSwitch.on = false` at its start, restored in `afterEach` — **and** add, in the same file, a sibling test (or second half) that runs with the switch on and asserts what the code now does (member form). The off branch still exists in code until S5, so it keeps its test.
2. **The test's subject is behaviour that must hold in both modes** (who hears a whisper, roles point at one entry, a value carries, a portrayal is recorded): make it switch-agnostic — find entries/rows by host-filled fields rather than by a key built from a card id. E.g. a helper `entryOf(state, cardId, kind?)` = the `Object.values(state.cast.byId)` entry with `id === cardId` and (`kind === "player"` ? `typeof playerSeatId === "number"` : `typeof playerSeatId !== "number"`); owner rows matched by `ref`/`castMemberId`/`kind+id` read from the seat rows the test made. Assert the member-form key/ref where the test checks a key (compute it from the seat row ids the fixture created, e.g. `seated_member:${seat.castMemberId}`, `player_seat:${personaSeat.id}`), with an off-mode fallback only if the test file also runs off.
3. A test whose fixture writes values with `{ kind: "session_cast", id: <card> }` through the real door is fine — the door translates. A test that **reads the table directly** by `ownerKind: "session_cast"` must read the member-form row instead.

Never delete an assertion; you may change its expected value to what the ruled member form says, and must say so. Save/restore pattern (never hard-reset to a literal in afterEach):
```ts
import { memberFormSwitch } from "$lib/server/state/memberForm"
const switchWas = memberFormSwitch.on
afterEach(() => { memberFormSwitch.on = switchWas })
```

## Verbatim rules

- This is an implementation task. Answer any relayed status question in one line in your report, and still do all the work.
- *Never run `git stash` in any form, including `--keep-index` or to probe prettier; it stashes every other lane's uncommitted work. Use `npx prettier --check <file>`.*
- *Never commit. Never `npm test` or `npm run build` at the SDK root. Delete only the `/tmp/serene-pub-vitest-*` dirs your own tests made, by name; never a glob over `/tmp/serene-pub-*`.*
- *Before any `sdk:build`, check `pgrep -af "vite dev"` for a serene-pub server. If one is up, don't build; report 'blocked on your dev server'.* (You need no sdk:build.)
- Never `git checkout`/`restore` anything. Edit **only** your listed test files — never production code, never another test file.
- Prettier: run `npx prettier --check` on your files, but only hand-format the lines you changed; never `--write` a whole file.
- It is a **session**, never a chat.
- An int test that opens a DB inside an `it` needs a 60 s timeout. Never pipe vitest into `head`.
- Run tests only in a capped scope, logged (replace <w> with your id, <files> with your files):
  `systemd-run --user --scope -p MemoryMax=6G -p MemorySwapMax=0 --quiet bash -c 'export NODE_OPTIONS=--max-old-space-size=4096; cd /home/jody/github/serene-pub && npx vitest run <files> --maxWorkers=2 > /tmp/claude-1000/-home-jody-github-serene-pub/9382c94a-1330-4480-b65e-0cfdb1f75e97/scratchpad/s4-on-<w>-tests.log 2>&1; echo test-exit=$? >> /tmp/claude-1000/-home-jody-github-serene-pub/9382c94a-1330-4480-b65e-0cfdb1f75e97/scratchpad/s4-on-<w>-tests.log'`
  then `grep -E "Test Files|Tests |test-exit|FAIL" <log>`.
- The full failure text of each test from the lead's full-suite run is in `/tmp/claude-1000/-home-jody-github-serene-pub/9382c94a-1330-4480-b65e-0cfdb1f75e97/scratchpad/s4-on-full.clean.log` (grep the test name with `-A30`).

## Report (final message)

Per file: each failing test, the choice (1/2/3), what you changed, before/after counts; any test you believe shows a production bug, with file:line evidence; prettier status of your changed lines.
