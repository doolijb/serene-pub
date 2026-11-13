# BRIEF — bench-L5-w1: user docs and SDK docs for benched seats

Supervisor: bench-L5. Lane design (read only if a fact below is unclear): `plans/PROPOSAL-benched-seats-2026-11-10.md`. The owner has ruled it (2026-11-10/11). **Docs only. No code changes anywhere.**

## Goal

Make the user guides (`docs/*.md`) and the SDK's integration docs describe benched seats exactly as the code now behaves, retire the old seat switch / "The fallen" / "Removed" wording, rebuild the docs, and run the docs tests.

## What is true now (the supervisor checked these against the code)

**The rule.** A *benched* seat is in the session but out of play: out of the turns, out of the prompt (the characters block, the names list, likenesses, the persona block), never picked as anyone's speaking seat, and its cast member's private lore goes to the narrator, as a background member's does. "A seat in play" = live and not benched. The old rule "a member whose Status in world is deceased reads as background, even while seated" is **retired**: a deceased member whose seat is still in play is read as seated (its own seat's lore). Core never benches on its own: a person does (Bench, drag, Save), or a genre that opts in.

**Participants tab** (`src/lib/client/components/sessionForms/EditSessionForm.svelte`, `BenchedSeatRow.svelte`). Exact copy:
- The tab's top line: *Changes here wait for Save — adding, benching, bringing back and reordering. Reassigning a benched seat's lines happens at once.*
- Each **saved** seated row (characters, cast members with no card, personas, player seats without a card) has a **Bench** icon button (title *Bench*). The old on/off switch is gone from character and persona rows. **Envoys keep their switch** (it seats and unseats the envoy; an envoy is never benched). A row added but not saved shows **Ready to add** with a Remove ×, as before.
- One **Benched** section (shown once the session has any saved seat), intro *In the session, out of the turns. Their lines stay theirs.*, with two lists, **Characters** and **Players**. It replaces both "The fallen" and "Removed".
- A benched row has **Bring back** (or drag it back up to the seated list; dragging a seated row down to Benched benches it). A brought-back seat rejoins at the end of its seated list. Screen readers hear *‹name› benched — waits for Save.* / *‹name› brought back — waits for Save.*
- A benched row's **⋯** menu (*More actions for ‹name›*): **Reassign…** (rows with a card; hands its lines to someone else, and happens at once) and **Remove** (asks first; shown **only** on a benched seat that has no lines).
- A seat whose story ended (a Dungeon Crawler death, or a genre's bench) shows a skull and *Fell in the story*. Moving one back shows *They come back as they are; their story still says deceased until you change it.* and, when it has one, a link *Open ‹name› in the lorebook*.
- Everything waits for **Save**, except **Reassign…**.
- A refusal on Save toasts *Seat not benched or brought back*.

**Remove.** Removing a seat in play benches it. Only a benched seat with no lines can be removed (it leaves the session's lists). A benched seat with lines can't be removed: *‹name› has lines in this session, so they can be benched but not removed.*

**Re-adding and guests.** Adding a persona that is benched in the session brings its seat back. Removing a guest benches their player seats. A guest benches and brings back only their own seats.

**A guest whose only seat is benched** sees, where the composer was: *You're on the bench — the owner can bring you back.* The owner in the same position sees *You're on the bench — bring yourself back in Participants.* (The owner keeps the turn controls; only their composer closes.)

**Genres and pipelines.** A genre opts in with `writes.seats: true` (absent = off, unlike `writes.lore` / `writes.scenes`, which default on). Its pipelines can then **Bench or bring back a seat** (`core:outlet/set-seat-bench@1`; in: `seat` = `seated-member:<id>`, `player-seat:<id>` or `character:<id>`, and `benched` true/false; out: `main`, `seat`, `seats`). It is tied to the turn: Back, regenerating and deleting the turn put the seat back; Forward does it again; a person's later bench or bring-back wins (the undo only puts back a seat still as the pipeline left it). A seat already that way is a no-op; envoys and removed seats are refused. A genre without the opt-in is refused in words: *This session's genre ('‹name›') does not bench or bring back seats.* A person's own Bench and drag are never gated by `writes.seats`.

**What pipelines and templates see.** The session's cast read (`SessionCastV1`) still lists every live seat, benched or not; each carries `enabled` (false = benched) — on character seats and now on player seats (`sessionPersonas[].enabled`). The `characters` template variable (`{{{characters}}}`) holds a card only for seats in play, plus the speaker. A genre that declares `turnSeatChanges: true` sees a bench or bring-back as a seat **changed** (`change: 'enabled'`).

**Dungeon Crawler** (it declares `writes { lore, scenes, seats: true }`):
- Companions are now seen: the Planner's brief and the opening name the companions travelling with the party (before this, they were silently missing).
- A companion can die: when the story kills one, its seat is benched, its cast member is marked deceased, and it joins the fallen list (the Benched section shows it as *Fell in the story*). Back or a regenerate takes it back.
- The story can revive a fallen companion (a shrine, a Raise): the seat comes back, its status returns to active, and it leaves the fallen list. A companion a person drags back after a death stays on the fallen list and stays deceased until changed by hand.
- A hero's new character **benches** the old seat (it used to unseat it); the old seat shows under Benched with *Fell in the story*.

**Upgrade.** On the first start of this version, seats you had removed that have lines become benched; removed seats that never spoke stay removed. Chats imported from 0.5.3 follow the same rule.

## Files owned (edit only these)

- `docs/sessions.md` — Participants (~377-386: rewrite the tab description and the list: drop **Removed**, add **Benched**; the card-less member sentence "its switch turns it on or off" goes), Guests (~570 "bench their own characters" → their own seats), the troubleshooting line ~695 ("check the switches under **Participants**" → benched seats). Add one short line on a guest whose only seat is benched. Add the upgrade sentence once, where Participants is described.
- `docs/group-sessions.md` — ~92-98: retitle **Bench a character** → **Bench a seat** (the anchor becomes `#bench-a-seat`); describe Bench, the Benched section, drag and **Bring back**, Remove only for an unused benched seat; keep the Scene Portraits / Turn order sentence if the code still matches (check `../serene-pub-sdk/core-catalog/src/registry/widgets.ts` `showBenched`, and whether Scene Portraits leaves out benched persona seats too); ~22 "each active character" → each character in play if it reads wrong.
- `docs/characters.md` ~346, `docs/session-layout.md` ~84, `docs/coming-from-sillytavern.md` ~45: fix the link to `./group-sessions.md#bench-a-seat` and the wording.
- `docs/genre-dungeon-crawler.md` — companions (~25, ~141, ~186, ~218-222 "*(Not built yet.)*"), the fallen as a Benched row, a hero's new character (~263).
- `docs/pipelines.md` — the new write beside **Change a cast member** (~97-100 list), the `writes.seats` opt-in, ~61 "(switched on or off, …)" → benched or brought back, ~335 "characters switched off in the cast list" → benched seats.
- `docs/lorebook-cast.md` — ~22 and ~80-81: background = no seat **in play** holds the member (a benched seat's member is background); delete the deceased-reads-as-background bullet and say instead that a deceased member whose seat is still in play is read as seated.
- `docs/context-templates.md` ~182 (`characters`: "including ones switched off" is now false).
- Any other `docs/*.md` a grep for `The fallen`, `switch` (about seats), `bench`, `Removed`, `deceased` (about lore) finds that describes the old behaviour, e.g. `docs/session-actions.md` ~155, `docs/upgrading-from-0.5.md` (only if it lists what happens to 0.5.3 sessions' seats). Envoy switches (`genres.md`, `genre-lair.md`) stay as they are.
- `src/lib/generated/docs/**` — **only** through `npm run docs:build`.
- SDK, docs only: `/home/jody/github/serene-pub-sdk/INTEGRATING.md` — add a section **`## 1m. Benched seats (2026-11-10)`** after §1l, in §1l's shape (🚧 line, then bullets): the rule; `core:outlet/set-seat-bench@1` (ports, opt-in, turn-tied undo, no-op, refusals; the host half is the app's: one writer `setSeatBench`, the record `seatBenches` in the core annex); `writes.seats` (absent = off); `SessionCastV1.sessionCharacters[].enabled` and `sessionPersonas[].enabled` (false = benched; every live seat is still listed, so a reader that must skip benched seats filters on `enabled !== false`, as the Dungeon Crawler's `liveSeats` does); `characters.v1` gives benched persona seats `benched: true`; `cast-changed` / `TurnSeatChange` `change: 'enabled'`. If §5a's census lists outlets one by one (check whether `note-scene@1` is listed), add this one the same way.
- SDK `guides/forms-and-effects.md` ~156-166: add a `seats` bullet to the `writes` list (absent = off, what it allows, that a person's own bench is never gated). Check `guides/genres-presets-and-routines.md` ~230 (`turnSeatChanges`) and add only if a bench reads wrong there.

## Files readable

Everything. Verify any fact you are unsure of in the code (`src/lib/client/components/sessionForms/EditSessionForm.svelte`, `BenchedSeatRow.svelte`, `benchedSeats.ts`, `src/lib/shared/sessions/playerSeat.ts`, `src/lib/server/sessions/seats.ts`, `../serene-pub-sdk/contracts/src/outlets.ts` `setSeatBench`, `../serene-pub-sdk/sdk/src/descriptors.ts` `writes.seats`, `../serene-pub-sdk/core-catalog/src/genres/dungeon-crawler/story.ts`). **Where this brief and the code disagree, describe the code and list the disagreement in your report.**

## Rules your work depends on (quoted)

- CLAUDE.md: *"It is a **session**, never a *chat* — except in chat-completions wire vocabulary."* (0.5.3 "chats" may be called that only when naming what 0.5.3 called them.)
- CLAUDE.md: *"`docs/<area>.md` … user-facing behaviour. Read the one for the area you change; update it in the same change when behaviour moves."*
- Owner memory: there is always a lorebook — never write "a session with no lorebook"; a session has its own book (its Session notes) or the book it started with.
- STYLE-GUIDE §10 Writing: *"Sentence case everywhere"* · *"A button says what happens"* · *"One name per thing, across the whole flow"* · *"No filler"*. Bold a control's label as the UI writes it (**Bench**, **Bring back**, **Benched**, **Reassign…**, **Remove**); italics for shown sentences, as the pages already do.
- NOMENCLATURE R1 / R3: say **a seat in play** (never bare "in play": "in play order" is a scene's place in the transcript). The user word is **benched** / **Bench** / **Bring back**; never "disabled", "switched off", "inactive" or "unbenched" for a seat. A member's **Status in world** (`deceased` …) is a different thing from a benched seat.
- No other-project references in the repo; no "for later" promises.
- The docs pages keep their existing headings except the one retitle above; keep edits proportionate (a few sentences per spot, not new chapters). SDK guide code fences are compiled by `guideSnippets.test.ts`: prefer prose; any new fence must pass that test.

## Out of scope (write down, never do)

Any code or test change; NOMENCLATURE.md and STYLE-GUIDE.md (worker w2 owns them); plans and reports; the "departed → removed" rename; SDK `README`s or changelogs.

## Stop and ask (in your report) when

A fact here disagrees with the code; you would need a new user-facing name or sentence that the UI doesn't already use (describe, don't coin labels); anything outside the owned files.

## Done means

1. `cd /home/jody/github/serene-pub && npm run docs:build` succeeds.
2. Docs tests pass, in a capped scope:
   `cd /home/jody/github/serene-pub && systemd-run --user --scope -p MemoryMax=6G npx vitest run src/lib/shared/utils/docsIndex.test.ts src/lib/shared/utils/docsHref.test.ts src/lib/client/components/sidebars/helpLinks.test.ts src/lib/client/shell/docsJump.test.ts src/lib/client/components/docs/docsPlaygroundProtocol.test.ts src/lib/shared/utils/envDocsDrift.test.ts src/lib/shared/utils/docsContextTemplate.test.ts`
   (if `systemd-run` is unavailable, run the same vitest command plain). Never pipe vitest into `head`.
3. SDK guide tests pass from source, capped:
   `cd /home/jody/github/serene-pub-sdk/sdk-tests && systemd-run --user --scope -p MemoryMax=4G npx tsx --test guides.test.ts docsLaws.test.ts guideSnippets.test.ts`
4. `grep -n -i "bench-a-character\|The fallen\|Toggle character" docs/*.md` finds nothing that describes the old UI.

## Verbatim lane rules

- *"This is an implementation task. Answer any relayed status question in one line in your report, and still do all the work."*
- *"Never run `git stash` in any form, including `--keep-index` or to probe prettier; it stashes every other lane's uncommitted work. Use `npx prettier --check <file>`."* Never `git checkout`, `restore` or `clean` in either repo. Never run `prettier --write` on a file.
- *"Never commit. Never `npm test` or `npm run build` at the SDK root. Delete only the `/tmp/serene-pub-vitest-*` dirs your own tests made, by name; never a glob over `/tmp/serene-pub-*`."*
- *"Before any `sdk:build`, check `pgrep -af "vite dev"` for a serene-pub server. If one is up, don't build; report 'blocked on your dev server'."* (You need no `sdk:build`: docs only.)
- Read NOMENCLATURE.md and STYLE-GUIDE.md by section, never whole. Scratch files start with `bench-L5-`.

## Report

Return it as your final message (the supervisor writes the lane report): changed files with one line each, tests run with results, every brief-vs-code disagreement, open questions, Noticed-not-done.
