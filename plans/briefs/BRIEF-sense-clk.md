# BRIEF — lane `sense-clk` — each round moves the clock

**You are a lane supervisor.** Read `.claude/guides/multi-agent.md` first. Then plan §2.11 in
`plans/PLAN-sensible-engine-2026-11-11.md` (the owner's words and the shape), `docs/lorebook-time.md` ("What moves
a session's clock", "Every move leaves a line"), `docs/sessions.md` (Settings; "Where the session reads its
lorebook"), `docs/genre-story.md`, `docs/genre-lair.md`, `../serene-pub-sdk/INTEGRATING.md` (registrations, session
moments, exposed parameters; by section), NOMENCLATURE §1, §24 (rule 7: a pipeline's id) and §25, and CLAUDE.md
Principles P1, P3, P5. Also `plans/REPORT-sense-eng-2026-11-11.md` and `plans/REPORT-sense-eng2-2026-11-11.md`: since
today a clock move on a story with no clock **starts** the clock, which this lane must not trigger.

## The owner's ask (2026-11-11, verbatim)

"lets make it so every 'round' moved the clock forward 5 minutes automatically, with a simple setting in the sessions
that opt in to the clock. Simple setting in the session would suffice. Genres like guide that use real time would be
an exception."

## Goal

1. **One deterministic pipeline on `round-ended`.** No model call. It holds the parts Story's reply tick already
   uses (core-catalog `genres/story/respond.ts` about 365; `contracts/src/tasks.ts` about 4840,
   `core:task/clock-step@1`; the *Advance story clock* outlet; `shared/timePasses.ts`): a clock step whose **By**
   defaults to **5** and whose Unit is minutes, and the outlet behind the step's `moves` junction. Name it by
   NOMENCLATURE §24 rule 7 (`core:spec/<what>`, since more than one genre uses it) and record it in §25.
2. **The genre opts in.** Register it in the defaults of **Story** and **the Lair**. Not the Guide, not Chat (real
   time), not the Dungeon Crawler (it already tells how long each round took: confirm in its docs and code, and say
   what you found). A plugin genre opts in the same way, by registering it.
3. **Only a session that has a story clock.** The move happens only when the story has a present to move from: the
   session's own clock, or its lorebook's present. With neither, the pipeline does nothing and **writes no line**:
   it must never start a clock, and never leave a "not on the clock" line every round. Use an existing read of the
   clock and a junction if one exists; if the only way is a new node type, parameter or port, stop and report.
4. **One session setting.** Through the step's exposed parameter, as the reply tick's is: shown under **The story**
   below the story clock, **Each round advances the clock by ‹5› minutes**, where 0 turns it off. Unit is not
   offered. Confirm the settings form renders it from the declaration with no hand-built control (P5); if it needs
   one, report before building it.
5. **A clock move like any other.** The usual line under the message that closed the round, with a cause that says
   it was the round; taken back with that message exactly as a reply's tick is today (do not change the swipe and
   regenerate rule). On the story's lane only.
6. **Leave the per-reply tick as it is** (off by default; a published setting). Report it as open ★R1.

## Files owned

- In `../serene-pub-sdk/core-catalog/src/`: the new spec's file, `registry/genres.ts` (Story's and the Lair's
  default registrations only), the catalogue's index and seed lists the new spec must appear in, the golden pins and
  tests this moves (re-pin with a dated note, as the repo does).
- In the app: whatever projects a core registration at boot **only if** a new core spec needs an entry there; the
  clock-move cause list if "round" is a new cause value; tests for the three opt-ins; the docs named above;
  `NOMENCLATURE.md` §25 and the row for the new term (this lane owns NOMENCLATURE for this change).

## Out of scope

The per-reply tick's removal; the swipe and regenerate rule for ticks (plan ★S2); the Dungeon Crawler's own time;
default calendars; `sockets/sessions.ts` and `runtime/host.ts` unless a one-line cause value must be added there,
in which case report the exact line first; `db/schema.ts` and any migration.

## Stop and ask when

A new node type, port, event or migration would be needed; the settings form cannot render the setting from the
declaration; a published name would change. The new spec id and the setting's label are the only new names this
brief grants; every sentence a person sees is provisional 🚧 copy: list them.

## Done means

Tests that fail before and pass after: a Story session with a clock moves 5 minutes when a round ends, with a line
under the closing message; the same session with By 0 does not move; a Story session with **no** clock does not
move, starts no clock and writes no line; a Guide session and a Dungeon Crawler session have no such registration;
deleting the closing message takes the move back. `npm run sdk:build` once at the end (after the `pgrep` check).

## Report

**Return the full report as your final message** (the lead saves it as `plans/REPORT-sense-clk-2026-11-11.md`):
changed files in each repo, tests and results, every pin that moved, open ★, provisional copy, **Noticed, not done**.

## Verbatim rules

- "This is an implementation task. Answer any relayed status question in one line in your report, and still do all the work."
- "Never run `git stash` in any form, including `--keep-index` or to probe prettier; it stashes every other lane's uncommitted work. Use `npx prettier --check <file>`."
- "Never commit. Never `npm test` or `npm run build` at the SDK root. Delete only the `/tmp/serene-pub-vitest-*` dirs your own tests made, by name; never a glob over `/tmp/serene-pub-*`."
- "Before any `sdk:build`, check `pgrep -af "vite dev"` for a serene-pub server. If one is up, don't build; report 'blocked on your dev server'."
- Never `prettier --write` on a directory. Never `git checkout` / `restore` / `stash` in either repo (most of the
  SDK repo is uncommitted). Never `kill -9` a dev server. Inside `db.transaction(async (tx) => …)` use only `tx`.
  `socket.off(event)` always passes the handler. `$state(new Set())` is not reactive: use `SvelteSet`. Browser code
  runs on plain-http LAN addresses: no `crypto.randomUUID`, no `navigator.clipboard`. It is a **session**, never a
  *chat*. Every session has a lorebook (its own book, or an overlay): never write "no lorebook".
- **No reference to any other project or product** in code, comments, tests or docs in either repo.
- Run only your targeted test files, in a capped scope:
  `systemd-run --user --scope -p MemoryMax=10G -p MemorySwapMax=0 --quiet bash -c "npx vitest run --maxWorkers=3 <files>"`.
  An int test that opens a DB inside an `it` needs a 60 s timeout. Never pipe vitest into `head`.
  `npx prettier --check <file>` on each file you changed. Do not start a dev server.
- Do what is asked, at the size asked. Findings along the way go under **Noticed, not done**, never fixed in passing.
- **Re-read the cited lines before changing anything.** A review row marked "? inferred" is yours to confirm first;
  if it turns out false, report that and do not "fix" it.
