# BRIEF — worker task `tl-3b-fix` — five scope-review fixes to the start form's Keep a timeline switch

Repo `/home/jody/github/serene-pub`. Read first: `plans/REPORT-tl-3b-2026-11-16.md`, `STYLE-GUIDE.md` §6.4
Field help (~1195–1197) and the form-error pattern (`InlineError`), `NOMENCLATURE.md` §24 and the `tl-3b` §25
entry. Re-verify every file:line below before editing.

Rules: never `git stash / checkout / restore`; `npx prettier --check` only, never `--write`; never commit; no
migration; no SDK edit. Lane `tl-2c` is editing `src/lib/server/pipelines/runtime/host*.ts`, `state/`,
`characters/versions.ts`, `docs/lorebook-time.md` (other paragraphs): do not touch its files; in
`docs/lorebook-time.md` and `NOMENCLATURE.md` make one small targeted edit each, re-reading right before.
Tests only as
`systemd-run --user --scope -p MemoryMax=10G -p MemorySwapMax=0 --quiet bash -c "npx vitest run --maxWorkers=3 <paths> > plans/tl-3b-fix-<n>.log 2>&1"`,
after `until ! pgrep -f "^node .*vitest" >/dev/null; do sleep 5; done`. `NODE_OPTIONS=--max-old-space-size=10240`
for `npx tsc --noEmit -p .` and `npm run check`.

## Fixes

1. **What the form shows is what is stored.** Today, with story time on and Change never opened, the form
   sends no clock (`StartSessionForm.svelte` ~1785) and the server works out its own today in a time zone that
   can differ from the browser's fallback (`state/storyTime.ts:919` vs `displayTimeZone()` ~933–948), so the
   notes can be dated a day off from the sentence shown. While the switch is on (and in the required-genre
   case where the date line shows), **always send the date on screen** as `storyClockYear/Month/Day` (no hour,
   no minute). Compute "today" when the form is submitted too, not only once at mount: if the day rolled over
   and the person did not pick a date, the sentence and the sent date both use the new day. Server unchanged
   (a named clock is already honoured). NOMENCLATURE §8 Timeline row: "today in the account's time zone, else
   the browser's".
2. **The sentence follows the picked day.** Once a date is picked through Change, the line reads *The story
   begins on ‹date›.* (new sentence, ★ in your report; no "today"); with nothing picked it stays *The story
   begins today, ‹date›.*
3. **Field help and errors, per STYLE-GUIDE §6.4.** The switch's help (~2700) uses the project's `FieldHelp`
   with an id, and the switch is described by it (`aria-describedby`; if `SettingSwitch` has no such prop, add
   an optional pass-through prop, nothing else). The date problem hint (~2758) uses `InlineError` and the
   Year / Month / Day inputs carry `aria-invalid` while `notesDateProblem` is set.
4. **"Required" comes from the server, not a guess.** Add `timelineRequired: boolean` beside `timelineDefault`
   on the preset row the form reads (`src/lib/server/sockets/sessionAdmin.ts` ~753 and its shared type): true
   when the preset's genre declares `timeline: 'required'` or does not resolve (the same two cases in which
   `sessions.create.ts` ~732–742 forces on: use one shared helper in `lorebooks/timeline.ts` for both, exported
   beside `timelineDefaultFor`, name by §24, and have create call it). The form shows the sentence when
   `timelineRequired`, the switch otherwise (initial value `timelineDefault === true`). Record the field in
   NOMENCLATURE §25 (append to the `tl-3b` entry).
5. **Docs:** `docs/lorebook-time.md:48` "A session that starts on its own notes decides their timeline from its
   preset and genre instead" gains "…or from the start screen's **Keep a timeline** switch".

## Tests

Extend `src/lib/client/components/sessionForms/startSessionNotesTimeline.dom.test.svelte.ts` (switch on, Change
never opened → Start sends today's year / month / day; a picked day changes the sentence; `aria-describedby`,
`aria-invalid`; a preset row with `timelineRequired: true` and `timelineDefault: true` pinned shows the
sentence, not the switch) and `src/lib/server/sockets/sessions.createNotesTimeline.int.test.ts` or the preset
list's test (the row carries `timelineRequired` for the Lair / Dungeon Crawler, false for Story, Chat, Guide;
create and the list agree). Run those plus the other `startSession*` DOM files and
`lorebooks/timelineDefault.test.ts`, `sockets/sessions.timelineDefault.int.test.ts`. `tsc` 0; `npm run check` 0
errors in your files.

## Report (under 300 words)

What changed per fix with file:line; the new sentence and names (★); tests and counts with log names; anything
you could not do; **Noticed, not done**.
