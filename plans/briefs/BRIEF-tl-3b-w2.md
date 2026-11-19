# BRIEF — worker `tl-3b-w2` (client + docs): the start form's story-time switch for a session's own new notes, and its date line

App repo `/home/jody/github/serene-pub`. Supervisor: lane `tl-3b`. Work only in the files below.

This is an implementation task. Answer any relayed status question in one line in your report, and still do all the work.

Never run `git stash` in any form, including `--keep-index` or to probe prettier; it stashes every other lane's uncommitted work. Use `npx prettier --check <file>`.

Never commit. Never `npm test` or `npm run build` at the SDK root. Delete only the `/tmp/serene-pub-vitest-*` dirs your own tests made, by name; never a glob over `/tmp/serene-pub-*`.

Before any `sdk:build`, check `pgrep -af "vite dev"` for a serene-pub server. If one is up, don't build; report 'blocked on your dev server'. (No SDK build is expected in this task at all.)

Also: never `git checkout/restore`, never `prettier --write`, no full test run, no `npm run build`. Browser code runs on plain-http LAN addresses and phones: no `crypto.randomUUID`, no `navigator.clipboard`. `$state(new Set())` / `new Map()` is not reactive on mutation (use `SvelteSet`/`SvelteMap`). Never call `toaster` from a view. `socket.off(event)` always with its handler.

## Goal

`src/lib/client/components/sessionForms/StartSessionForm.svelte` (3.6k lines: read line ranges, never the whole file). When a new session will get its **own new notes** (nothing chosen: `noLorebookChosen`, ~910–912, i.e. no lorebook and no starter kit) and the mode is `new`, the form shows a switch for story time. A sibling server worker is adding `sessions:create`'s top-level 🚧 `notesTimeline?: boolean` (already typed in `src/lib/shared/sockets/types.ts`, `Sockets.Sessions.Create.Params`; read its comment; do NOT edit types.ts). Server precedence: honoured only for own new notes; a genre that requires a timeline wins over `false`; absent = the preset's default; with the notes' timeline off a `storyClock*` is ignored.

## What to build (decided by the supervisor; labels/sentences are provisional ★ — mark each with a `<!-- 🚧 -->` comment like `NewLorebookDialog.svelte` 307–318 does)

1. **One snippet, `notesTimelineChoice()`**, defined once and rendered as the **last block inside both lorebook cards**: the "Lorebook and rules" card (`data-book-pick`, ~2957–3119; render it just before that `</section>`) and the plain "Lorebook" card (Chat / Guide, ~3227–3357; just before its `</section>`). The two cards are mutually exclusive (`bookPickShown`), so a person sees it once, whatever the layout: the **None** card, **Start blank** (advanced on), no "None"/"Start blank" row at all (advanced off in the book-pick card), or the "You have no lorebooks of your own yet" state. Shown when `flow.mode === "new" && noLorebookChosen`, **whether or not advanced controls are on**. Wrap it in `<div class="mt-4 space-y-1" data-notes-timeline>`.
2. **The switch** (genre does not require a timeline): `SettingSwitch` (same import and props as `NewLorebookDialog.svelte` 307–318), `name="start-notes-timeline"`, label ★ **Keep a timeline**, one help sentence under it ★ *Dates, history and a story clock in this session's own notes; you can change it later in Book settings.* (`text-surface-600-400 text-xs`). State `notesTimeline = $state(false)`; initial value and every reset = `flow.preset?.timelineDefault === true`; reset whenever the preset changes (an `$effect` that reads the preset id and writes inside `untrack`, like the draft reset ~832–841).
3. **Genre requires a timeline** (no switch): the form decides "required" from existing fields only, no new field: `notesTimelineRequired = flow.preset?.timelineDefault === true && (flow.preset?.defaults as { timeline?: unknown } | null | undefined)?.timeline !== true` (the resolved default is on but the preset didn't pin it: the genre's mandate, or a genre that can't be read). Then show instead of the switch the sentence ★ *‹genre name› always keeps story time, so this session's notes keep a timeline.* (use `flow.genre?.name`, fall back to "This genre"), `data-testid="start-notes-timeline-required"`.
4. **The date line** while story time is on (switch on, or required): the existing sentence *The story begins today, ‹date›.* followed by a **Change** text button exactly like the existing `startDateLine` snippet's (~2530–2575: `class="anchor ml-1"`), `data-testid="start-notes-date"`, Change has `data-notes-date-change`. Today's date: **display only**, no socket request, no new event. Compute today's year/month/day with `Intl.DateTimeFormat("en-US", { timeZone: displayTimeZone(), year: "numeric", month: "numeric", day: "numeric" }).formatToParts(new Date())` (`displayTimeZone` from `$lib/client/utils/realTime.svelte`: the account's time zone, else the browser's), wrapped in try/catch falling back to no `timeZone`. Format with the existing shared `formatDate` (`$lib/shared/lorebooks/storyDate`, already imported) and **The real calendar**: `STORY_CALENDAR_PRESETS.find((p) => p.id === "real-calendar")!.calendar` from `@serene-pub/sdk` (the client already imports it this way in `src/lib/client/lorebooks/time/StoryCalendarEditor.svelte:9`). That is formatting, not arithmetic; the server stays the authority at create (it works out today itself when no clock is sent).
5. **Change** opens three number inputs **Year / Month / Day** (no hour, no minute; no line picker: new notes have one line) — the smallest existing date control: copy the markup of the Year/Month/Day `<label>`s from `SessionLorebookReading.svelte` ~310–355 (`input rounded-base`, `type="number"`, step 1, month/day `min="1"`) into a `grid grid-cols-3 gap-2` fieldset with legend ★ *The day the story begins* (`text-surface-600-400 text-xs`), pre-filled with today's Y/M/D. Hold them in a draft `notesClock` (`StoryClock | null`, hour/minute null). Under them, one `aria-live="polite"` hint: the existing `dateProblem(clock, realCalendar)` sentence when there is one, else nothing. Number inputs bind numbers (an emptied one is null/NaN: normalise like `SessionLorebookReading`'s `num`). Resetting: the draft and Change close whenever the switch goes off, the preset changes, a lorebook/kit is chosen or the mode changes.
6. **Start stays grey** while Change is open and the picked date is missing or `dateProblem` is non-null, with the existing sentence *Choose the date the story begins on.* — extend `startDateMissing` (~882–893) or add a sibling derived OR-ed into the gate at ~1265 and the sentence at ~1273. No new sentence.
7. **`sendCreate`** (~1653–1690): when the snippet is shown and the genre doesn't require a timeline, add top-level `notesTimeline` to the request (the object passed to `requestWithInterest`, beside `fromApplet`; `payload` is `flow.payload(...)`, a `Sockets.Sessions.Create.Params`, so `payload.notesTimeline = …` type-checks). When story time is on (switch on or required) **and** Change is open with a valid date, add `storyClockYear/Month/Day` (+ `storyClockHour: null, storyClockMinute: null`) to `payload.session`, next to the existing `storyClock*` branches. **Never** send `storyClock*` while the switch is off. Do NOT touch `buildCreatePayload` or the `flow` module; the first-run wizard (`src/routes/+page.svelte`) and the document-view new-session page stay as they are (absent = default).
8. **Leave untouched:** `timelineOfferFor` and its `timelineOffer` snippet (~1008–1065, ~2494–2527: the offer under a chosen existing lorebook), `NewLorebookDialog`'s own **Keep a timeline** (that one makes a standalone lorebook before Start; then the form holds a chosen lorebook), and the `startDateLine` snippet for a chosen lorebook.

## Rules quoted (STYLE-GUIDE / CLAUDE.md)

- "A Skeleton **Switch** keeps its filled primary track when on. It shows the control's own state, not a selection among siblings."
- "Sentence case everywhere." "Labels are nouns, hints are sentences." "Help is one sentence." "No filler: a screen with nothing to say says nothing."
- "Every interactive element is a real `button`, `a` or input with an accessible name." "Targets are 44px on touch." "Nothing is hover-only."
- "It is a **session**, never a *chat*."
- Docs: user-facing behaviour moves → update `docs/<area>.md` in the same change.

## Tests

New DOM file `src/lib/client/components/sessionForms/startSessionNotesTimeline.dom.test.svelte.ts`, modelled on `startSessionStoryDate.dom.test.svelte.ts` and `startSessionTimelineOffer.dom.test.svelte.ts` (same mocks, same mount helper, same "⚠ No DOM node is ever handed to `expect`: booleans and strings" rule — a failing assert on a happy-dom element has OOM-killed VS Code). Find how those tests switch advanced controls on/off and how they pick the book-pick (Story) vs plain (Chat/Guide) card. Cases:

- Shown with nothing chosen in `new`: Story card × advanced on and off; Chat/Guide card; no lorebooks at all.
- Hidden: an existing lorebook chosen; a starter kit chosen; mode `new-world`.
- Initial value: off for a preset with `timelineDefault: false`/absent; on for a preset with `timelineDefault: true` and `defaults: { timeline: true }`; follows a preset change.
- Required: `timelineDefault: true`, no `defaults.timeline` → no switch, the required sentence, the date line.
- The date line appears/disappears with the switch; its date words match today in the real calendar (use `vi.setSystemTime` with fake timers set only for `Date`, or compute expected with the same formatter).
- Start sends `notesTimeline` true/false (read `requests` for key `sessions:create`); none when an existing lorebook is chosen; none for the required case; Change + a valid date → `storyClockYear/Month/Day` sent; switch turned off after picking a date → no `storyClock*`; an invalid date (e.g. month 13) → Start disabled with *Choose the date the story begins on.*

Also re-run `startSessionStoryDate.dom.test.svelte.ts` and `startSessionTimelineOffer.dom.test.svelte.ts` (must stay green unchanged) and any other `src/lib/client/components/sessionForms/startSession*.dom.test.svelte.ts` whose assertions could see the new block (grep for exact text/role counts).

Run tests only like this, one run at a time (other agents run vitest too):

```
until ! pgrep -f "^node .*vitest" >/dev/null; do sleep 5; done
systemd-run --user --scope -p MemoryMax=10G -p MemorySwapMax=0 --quiet bash -c "npx vitest run --maxWorkers=3 <paths> > plans/tl-3b-w2-<n>.log 2>&1"
```

Never pipe vitest into `head`. Then `NODE_OPTIONS=--max-old-space-size=10240 npm run check` (judge only your files; errors in another lane's server files are theirs) and `npx prettier --check` your files.

## Docs (same change)

Re-read each file right before editing (another lane may edit `docs/lorebook-time.md`; you don't edit that one). Small targeted edits:

- `docs/sessions.md` §"A timeline for a new session" (~46–56): the sentence "To keep story time in a Story session, switch the notes' **Timeline** on in Book settings and then set its story clock, or start the session on a lorebook that keeps one." gains the form's switch first: when you start with no lorebook (None, Start blank, or none of your own), **Keep a timeline** on the start screen, off unless the preset's default is a timeline; the Lair and Dungeon Crawler show no switch and say *‹genre› always keeps story time, so this session's notes keep a timeline.* Keep the existing offer paragraph (50–56) as it is, except: "**Create a lorebook** on this screen asks **Keep a timeline**" stays true; make clear the two are different (the dialog's switch is for the new lorebook it makes; the start screen's is for the session's own notes).
- `docs/sessions.md` §"When the story begins" (~58–69): the last paragraph's "Nothing is shown … when you start blank or from a starter lorebook." becomes: with no lorebook chosen and story time on, the screen says *The story begins today, ‹date›.* with **Change** to pick another day (Year, Month, Day) on The real calendar; nothing for a starter lorebook or with story time off; a picked date is never kept with story time off.
- `docs/genre-story.md` "**Without a timeline.**" (~66): its last sentence "To keep story time, switch the notes' **Timeline** on in Book settings, or start the session on a lorebook that keeps one" gains "switch **Keep a timeline** on when you start the session," first.

## Files owned

- `src/lib/client/components/sessionForms/StartSessionForm.svelte`
- `src/lib/client/components/sessionForms/startSessionNotesTimeline.dom.test.svelte.ts` (new)
- `docs/sessions.md`, `docs/genre-story.md`

## Files readable

Anything. Notably `SessionLorebookReading.svelte`, `NewLorebookDialog.svelte`, `src/lib/client/utils/realTime.svelte.ts`, `src/lib/shared/lorebooks/storyDate.ts`, the two DOM tests named above, the form's flow module.

## Out of scope

Server code, types.ts, NOMENCLATURE (the supervisor does it), `lorebooks:storyTime`, any new socket event, `SessionLorebookReading.svelte` (do not refactor it), `timelineOfferFor`, `NewLorebookDialog.svelte`, `buildCreatePayload`.

## Stop and ask when

You'd need to edit a file you don't own; a placement in both cards can't be done without a layout change beyond adding the block; you need a new user-facing word beyond those above; an existing test needs re-pinning.

## Done means

The new DOM file green; the two existing DOM files green unchanged; `npm run check` clean for your files.

## Report (your final message, under 400 words)

Changed files; where the snippet renders (line numbers in both cards) and its conditions; how today's date is computed; how `sendCreate` sends; tests run with log paths and counts; docs sentences added (verbatim); Noticed, not done.
