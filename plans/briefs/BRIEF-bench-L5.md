# BRIEF — bench-L5: docs and vocabulary for benched seats

Design: `plans/PROPOSAL-benched-seats-2026-11-10.md`, all of it. Then read every lane report: `plans/REPORT-bench-{L1,L2,L3,L4}-2026-11-10.md` and `plans/REPORT-bench-L4b-2026-11-11.md`, plus the L4c worker's names (`benchedOnly`, the bench sentences) as recorded in the lead's notes in `REPORT-bench-L4-2026-11-10.md`. Each report's "Names for L5" or "Copy and names for L5" section is your work list. You are a lane supervisor: read `.claude/guides/multi-agent.md` first, and delegate to at most 2 `lane-worker` agents (w1 = `docs/`; w2 = `NOMENCLATURE.md` + `STYLE-GUIDE.md`). **No code changes.** Where a report and the code disagree, describe the code and flag it.

## What is true now (describe exactly this; check the code)

- **Benched:** a seat in the session but out of play. It's out of the turns and the prompt, never picked as anyone's speaking seat, and its lore is read by the narrator (background). The single rule is "a seat in play" = live and not benched. The earlier "deceased reads as background" rule is retired.
- **Participants tab:**
  - each seated row has **Bench**; one **Benched** section (Characters, Players) replaces "The fallen" and "Removed";
  - **Bring back** (button or drag);
  - ⋯ **Reassign…** and **Remove**; Remove appears only on a benched seat with no lines;
  - fallen rows show "Fell in the story" and the bring-back note;
  - everything waits for Save, except Reassign.
- **Remove:** a first remove benches; only an unused benched seat is removed.
- **Re-adding and guests:** re-adding a benched persona brings it back; removing a guest benches their player seats.
- **A guest whose only seat is benched** sees *"You're on the bench — the owner can bring you back."*; the owner sees the Participants variant.
- **Genres:** a genre opts in with `writes.seats` to bench and bring back seats through `core:outlet/set-seat-bench@1`. Back, regenerate and delete undo it, and a person's later move wins.
- **Dungeon Crawler:**
  - companions are now seen (the Planner, the opening);
  - a companion can die (benched, marked deceased, in the fallen list);
  - the story can revive one;
  - a hero's new character benches the old seat.
- **Upgrade:** existing removed seats with lines became benched; unused ones stay removed. 0.5.3 imports follow the same rule.

## Work

1. **Docs:**
   - `docs/sessions.md` (Participants, ~379-385, ~570);
   - `docs/group-sessions.md` (~92-98: "Bench a seat", with drag and Bring back);
   - `docs/characters.md` (~346);
   - `docs/session-layout.md` (~84);
   - `docs/genre-dungeon-crawler.md` (companions, the fallen as a Benched row, a hero's new character);
   - `docs/pipelines.md` (the new outlet and `writes.seats`);
   - `docs/lorebook-cast.md` (background = no seat in play; remove the deceased wording hist-F wrote).

   Then run `npm run docs:build`.
2. **SDK docs** (`/home/jody/github/serene-pub-sdk`): `INTEGRATING.md` (the outlet and `writes.seats`, and the `enabled` meaning on `SessionCastV1.sessionPersonas`); the genre-author guide where `writes` is documented (`guides/forms-and-effects.md` ~156). **Docs only, no SDK code.**
3. **NOMENCLATURE.md** (read §1, §24, §25's row shape, §23, by section):
   - **New or updated rows (🚧, 2026-11-10/11):** benched seat (charter); "a seat in play" (`seatInPlay` / `inPlay`; R1, always qualified, because "place in play" and `inPlayOrder` exist); `setSeatBench` (`setSeatEnabled` retired); `session_personas.is_active`; `SeatChange "enabled"`; `seatPlayer({isActive})`; `unseat`'s meaning; the 0152 upgrade and `benchRemovedSeatsWithLines`; `set-seat-bench@1`; `writes.seats`; `seatBenches`; `seatWriteRefusal`; `SeatBenchRecord` / `retractSeatBenchesAnchoredTo`; the stored `fallenCompanions` / `revivedCompanions` / `companionFates` / `progress.fallen[].companion`; `setCastSeatEnabled { playerSeatId }`; `hasLines` / `fellInStory`; `BenchedSeatRow`, `seatFellInStory`, `seatHasNoLines`, `benchedOnly`; the drag zone types.
   - **Background member row** (~:358): "no seat **in play** holds the member". Remove hist-G's deceased wording.
   - **§22 icon:** `Armchair` = Bench.
   - **§23 retired:** "The fallen" and "Removed" as sections; the seat on/off switch and its copy ("Toggle character enabled", "Character not enabled or disabled"…); `setSeatEnabled`; "deceased reads as background".
   - **One §25 block:** *benched seats — 2026-11-10/11 (owner rulings; PROPOSAL-benched-seats-2026-11-10, lanes bench-L1…L5)*.
4. **STYLE-GUIDE.md:** if the Participants rows pattern is described (§6.4 list rows), add the Bench / Benched-section pattern. Otherwise report "no change".

## Coordination

The variable-layouts session (`serene-pub-83`) has finished its NOMENCLATURE and STYLE-GUIDE edits. Nobody else is editing them now. Finish NOMENCLATURE in one pass.

## Files owned

`docs/*.md` (the pages above and any a grep for "The fallen", "switch", "bench" or "Removed" finds), `src/lib/generated/docs/**` (only through `npm run docs:build`), `NOMENCLATURE.md`, `STYLE-GUIDE.md`, SDK `INTEGRATING.md` and `guides/*.md` (docs only).

## Out of scope (write down, never build)

Any code; plans and reports. The departed→removed R1 rename (noticed, not done).

## Stop and ask when

A report and the code disagree; a name needs choosing; there's an R1 collision.

## Verbatim lane rules

- This is an implementation task. Answer any relayed status question in one line in your report, and still do all the work.
- Never run `git stash` in any form, including `--keep-index` or to probe prettier; it stashes every other lane's uncommitted work. Use `npx prettier --check <file>`. Never `git checkout`, `restore` or `clean` in either repo. Never run `prettier --write` on a file.
- Never commit. Never `npm test` or `npm run build` at the SDK root. Delete only `/tmp/serene-pub-vitest-*` dirs your own tests made, by name; never a glob.
- Read NOMENCLATURE.md and STYLE-GUIDE.md by section, never whole.
- Scratch files start with `bench-L5-`.

## Done means

- `npm run docs:build` succeeds.
- The docs tests pass (`docsIndex`, `docsHref`, `helpLinks`, `docsJump`, `docsPlaygroundProtocol`, `envDocsDrift`, `docsContextTemplate`; run them in a capped scope).
- The SDK `guides` / `docsLaws` / `guideSnippets` tests pass from source (`cd /home/jody/github/serene-pub-sdk/sdk-tests && npx tsx --test guides.test.ts docsLaws.test.ts guideSnippets.test.ts`, capped).
- Every listed name has a row.

## Report

`plans/REPORT-bench-L5-2026-11-11.md`. If the harness refuses the write, put the full report in your final message.
