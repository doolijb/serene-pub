# One shared date field (N3) and the leap rule as rows (N2) — 2026-11-18

Rulings: programme, "third round, fifth answers". Brief: `briefs/BRIEF-nav-23.md` (parts A–D). From a read-only planning pass; corrections to `INVENTORY-tree-time-navigation-2026-11-17.md`: the Chronicle's inputs are at `ChronicleWidget.svelte` 400–421; a second copy of the leap math lives in the Dungeon Crawler's sandbox script (`core-catalog/src/genres/dungeon-crawler/storyScripts.ts` 94–98, 150–156).

## Found
- The six forms word one rule three ways ("A date needs a whole year." SDK; "A date needs a year." / "The clock needs a year." app; "Give the clock a year." Chronicle). Form 1 (the session's line and clock) never checks the calendar on the client.
- The leap math's closed form holds for any number of levels where each is a whole multiple of the one before; three is fixed by the type's named fields and three written-out terms, not by the mathematics.
- Two defects in the calendar editor today: unticking and re-ticking the leap day drops the exceptions; changing `every` to a value that does not divide a hidden `skipEvery` blocks Save with a sentence about a field nobody can see.
- The prompt's wording of the leap rule (`pipelines/entities/variableLayouts.ts` 472, 491–493; `sdk/src/variables.ts` 1001–1004) omits the exceptions, so for the real calendar the model is told "every 4 years".

## Not built, asked of the owner
- **N2C** a fourth level and beyond: additive `more?: number[]` on `StoryLeapRule` (a published shape), the three math sites as a loop, the Dungeon Crawler script's copy; no migration.
- **N2P** the prompt says the whole leap rule (changes a prompt layout's hash; the layout-drift path applies).
- **N3M** month names in the Chronicle's Move the clock: additive `months?: string[]` on `StoryClockV1`.

## Ruled 2026-11-18 (owner, seventh answers) — lane `cal-1`
- **N2C:** "Allow any number of levels" + "Something in the middle. Give a liberal limit, but a limit so it can't be used abusively." → at most eight levels: additive `more?: number[]` on `StoryLeapRule` (levels after `keepEvery`, each a whole multiple of the one before), the three math sites as a loop, validation and parse, the Dungeon Crawler script's copy; the editor's **Add an exception** goes up to eight rows. No migration.
- **N2P:** "Say the whole rule" → the prompt's wording of the leap rule (`pipelines/entities/variableLayouts.ts` ~462–493; `sdk/src/variables.ts` ~1001–1004) carries every level; the layout's hash changes (re-pin; say which prompts move).
- **N3M:** "Add the month names for widgets" → additive `months?: string[]` on `StoryClockV1`; the Chronicle's **Move the clock** shows month names and adopts the shared date behaviour (part C of `briefs/BRIEF-nav-23.md`).
- **N3S:** as built (no Save gate).
