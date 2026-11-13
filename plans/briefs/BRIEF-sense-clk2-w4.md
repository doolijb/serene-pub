# BRIEF — `sense-clk2-w4` — Docs and ledgers: one clock owner per core genre, the round worth, the reply tick gone

You are a `lane-worker` for lane `sense-clk2`. App repo: `/home/jody/github/serene-pub`. SDK:
`/home/jody/github/serene-pub-sdk`. Use absolute paths. Docs only: no code, no tests. Another session is editing
these repos (visual-novel layout): touch only the lines this change needs, with the Edit tool.

## The owner's rulings (2026-11-11, verbatim)

- "In core genres we should have one default owner that moves the clock."
- "Story should be round. Lair and dungeon I think need more management so maybe the routine? Maybe they can share
  the same session setting, sdk provides an API to grab the setting, if opted in and pipelines can act on it/choose
  to respect the interval unless you have a different suggestion"
- On Story's per-reply tick (*Each reply advances the clock by…*): "Remove it. The setting mentioned allows pipelines
  to handle time arbitrarily"

## What is built (read the code to confirm before you write; docs say what the code does)

- **Minutes each round moves the clock** — a genre setting (field key `roundWorth`, the **round worth** 🚧;
  `ROUND_WORTH_FIELD`, `ROUND_WORTH_KEY` in SDK `core-catalog/src/shared/roundTick.ts`): integer, 0–1440, default 5,
  0 turns it off, the session's owner changes it. Description: "When a round ends, the story clock moves on this
  many minutes. 0 turns it off. A story whose clock is not set is left alone." It appears in **Edit session ›
  Settings** in the genre's settings block: Story's under the **Turns** group, the Lair's under **Lair** (this
  placement is queued for the lead, Q-1, and lands with this change: write the docs as if it has). Like every genre
  setting, a preset may set or lock it (see `docs/pipelines.md` ~140 for the cascade wording).
- **`core:query/round-worth@1`** (contracts `roundWorth`): any pipeline, core's or a plugin's, reads the session's
  round worth — `minutes` and a ready `step` for `core:task/clock-step@1` — and may act on it or not. 0 when the
  genre has not opted in or the session set 0. The SDK guide `guides/time.md` already has a section on it (worker
  `w1`): leave it unless it is wrong.
- **Story**: the round tick (pipeline name *Each round moves the clock*, `core:spec/round-tick`) moves the clock by
  the round worth when a round ends, on every Story preset. Nothing of it shows on a card any more (no **By**): the
  setting is the genre setting above. Same rules as before: only a story whose clock is set (its own, or the one set
  on its lorebook's line); no clock → nothing, no line; the move shows under the line that ended the round; delete
  takes it back, swipe or regenerate keeps it. *Note what changed*'s **Move the clock** switch now ships **off** on
  every Story preset; switched on, the routine's judgment moves the clock as well as the round's minutes (both
  happen; set the round's minutes to 0 for only the routine's). Story **Minimal**'s description is now "Just the
  story: one model call a turn. The clock moves on a few minutes each round; nothing else changes unless you change
  it."
- **The reply tick is removed**: *Each reply advances the clock by…* no longer exists anywhere. Stored values of it are
  dropped quietly when the pub starts (a boot pass).
- **The Lair**: the round tick is no longer the Lair's. **Keep the books** owns the clock: each round it runs, the
  clock moves on by the round worth, at once (even though the routine itself is on **Review**: a fixed step, not
  the model's guess), with the same line, delete and swipe rules as above. Its **Move the clock** switch is still
  off by default (the Lair gets no model-judged time unless the GM switches it on); when the GM switches it on and
  the routine judges how long the round took, that is the round's move instead (Full applies it; Review holds it for
  the GM). If **Keep the books** is Off, nothing moves the clock by itself: that is the case under **Words only**,
  where it ships Off (an open question for the owner: write what is built, plainly, with no promise).
- **The Dungeon Crawler**: unchanged. Each round moves the clock by the minutes the Planner says the round took (a
  new crawl starts at 08:00). It has no **Minutes each round moves the clock** setting.
- The Guide and Chat keep real time and have none of this.

## Tasks (docs; each change in the same voice as the surrounding text)

1. `docs/lorebook-time.md` — "What moves a session's clock" (~106–112): remove the reply-tick bullet; rewrite the
   round bullet for Story (round tick), the Lair (Keep the books), the Dungeon Crawler, Guide/Chat, and name the
   setting and where it is; update the *Note what changed* bullet (Move the clock off by default). Then make lines
   ~114, ~116, ~118, ~123 and ~131 true: no "reply's tick" anywhere; "a round's move" covers both owners.
2. `docs/genre-story.md` — ~59 (*Each round moves the clock*) and anything else naming **By**, the reply tick or a
   default-on **Move the clock** (the routines table ~44, presets table ~18 for Minimal if it says nothing changes,
   ~83 where Story's settings are listed: add the new setting).
3. `docs/genre-lair.md` — ~160 (*Each round moves the clock*): now Keep the books' job; ~150–158 if they need a
   sentence; say what Words only does.
4. `docs/genre-dungeon-crawler.md` — near ~235: one sentence that the round's minutes are the Planner's and the
   crawl has no *Minutes each round moves the clock* setting.
5. `docs/sessions.md` — ~402 (the card list names *Each round moves the clock* and **By**): remove that; ~400 (the
   genre's settings block) mention the new setting among the examples if it reads naturally.
6. `docs/pipelines.md` — ~15 ("Story's reply tick" among the settings a pipeline offers): replace with a true
   example. Check ~363 still reads true.
7. SDK `guides/storage.md` ~43, ~44, ~76 ("the reply's clock tick"): make true (the round's tick). Grep the other SDK
   guides and `INTEGRATING.md` for "reply tick", "Each reply advances", "By" next to the round tick, and fix.
8. `NOMENCLATURE.md`:
   - §4 row **round tick** (~206): it reads the round worth (`core:query/round-worth@1`) instead of an exposed **By**;
     nothing exposed; registered by **Story only**; the Lair's clock is **Keep the books**' (`ownsTheClock`); the
     reply tick is removed (2026-11-11), not merely "not this".
   - A new row **round worth** 🚧 in the section where genre settings / session settings are chartered (§9 Session —
     find the rows for genre fields such as **Auto-advance**, and sit beside them), with the P6 charter: **Purpose**
     (how many story minutes a round is worth; 0 off), **Why** (owner 2026-11-11: one default owner moves the clock;
     one session setting; "sdk provides an API to grab the setting"), **Owns** (the one value: `sessions.genre_fields.
     roundWorth` through the genre-field cascade; field `ROUND_WORTH_FIELD` under `ROUND_WORTH_KEY`; label *Minutes
     each round moves the clock*; written only by the session settings form), **the read** (`core:query/round-worth@1`,
     ports), **Does not own** (the clock: the host's; whether a clock is set; who moves it: the genre's owner — Story's
     round tick, the Lair's keeper; the Dungeon Crawler's Planner minutes), ⚠ not the Planner's *round's minutes*, not
     `clock-step@1`'s **By**.
   - The `duties` row (~204) or the Lair keeper's mention, only if it now says something false about the clock.
   - §25: a new subsection at the end of the ledger, after the last `###` entry (~3666–3679), titled `### round worth,
     one clock owner per genre, the reply tick removed — 2026-11-11 (owner rulings clk-3 and R1; PLAN-sensible-engine
     §5.8, lane sense-clk2)`, in the ledger's table form (Was | Is | Why/where), rows: (new) round worth + its read;
     the reply tick → removed (published names going: `core:spec/story-respond`'s steps `tick` and `clock` with
     `clock.moves.advance`, the setting *Each reply advances the clock by*; boot pass `boot/replyTickDrop.ts`); the
     round tick: reads the round worth, nothing exposed, Story only; the Lair keeper owns the Lair's clock
     (`ReckonTerms.ownsTheClock`, the reckon script's `clockUnnamed`, branch `reckon.on.time.round.*`, cause `'tick'`);
     Story's *Note what changed* ships *Move the clock* off. Files list as the other entries do.

## Files owned

`docs/lorebook-time.md`, `docs/genre-story.md`, `docs/genre-lair.md`, `docs/genre-dungeon-crawler.md`,
`docs/sessions.md`, `docs/pipelines.md`, `NOMENCLATURE.md` (the rows named above and the new §25 subsection), SDK
`guides/storage.md` and the guide/INTEGRATING lines task 7 finds.

## Out of scope

Code, tests, any other doc, any rename, any promise about Words only, STYLE-GUIDE.

## Stop and ask when

The code says something different from this brief (report it; write what the code does); a doc would need a new
word beyond *round worth* / *Minutes each round moves the clock*.

## Done means

Every task done; `npx prettier --check` on each changed `.md` only if the repo already passes it there (otherwise
leave formatting alone and say so); a report with each file and a one-line summary of each change, every new
sentence a person reads listed as provisional copy, and **Noticed, not done**. Return it as your final message.

## Verbatim rules

- "This is an implementation task. Answer any relayed status question in one line in your report, and still do all the work."
- "Never run `git stash` in any form, including `--keep-index` or to probe prettier; it stashes every other lane's uncommitted work. Use `npx prettier --check <file>`."
- "Never commit. Never `npm test` or `npm run build` at the SDK root. Delete only the `/tmp/serene-pub-vitest-*` dirs your own tests made, by name; never a glob over `/tmp/serene-pub-*`."
- "Before any `sdk:build`, check `pgrep -af "vite dev"` for a serene-pub server. If one is up, don't build; report 'blocked on your dev server'."
- Never `prettier --write` on a directory. Never `git checkout` / `restore` / `stash` in either repo. It is a
  **session**, never a *chat* (except chat-completions wire words). Every session has a lorebook: never write "no
  lorebook". Docs say what is built, never what is planned.
- **No reference to any other project or product** in docs.
- NOMENCLATURE: R1 one word one meaning; R3 qualify (`round worth`, never bare `worth`); R6 mark new vocabulary 🚧;
  §24: say what it is **not** where a near-neighbour exists.
- Do what is asked, at the size asked. Findings along the way go under **Noticed, not done**, never fixed in passing.
- **Re-read the cited lines before changing anything.** Line numbers are approximate.
