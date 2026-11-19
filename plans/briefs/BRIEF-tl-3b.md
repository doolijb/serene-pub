# BRIEF — build lane `tl-3b` — the start form's story-time choice for a session with no existing lorebook (programme 1.7)

Repos `/home/jody/github/serene-pub` (app), `/home/jody/github/serene-pub-sdk` (SDK: not expected to change).
Supervisor: read `.claude/guides/multi-agent.md`, then the programme's "Latest rulings" dated 2026-11-16
(`plans/PLAN-programme-2026-11-15.md`), D52 in `plans/DISCUSS-LATER.md`, `plans/REPORT-tl-2d-2026-11-16.md`
(incl. its "Scope review" notes), `plans/REPORT-tl-3a-2026-11-16.md`, `docs/sessions.md` ("When the story
begins", the timeline paragraphs ~48–60), `STYLE-GUIDE.md` (form controls, copy rules, read-only in words),
`NOMENCLATURE.md` §1, §24 and rows **timeline**, **Keep a timeline**.

This is an implementation task. Answer any relayed status question in one line in your report, and still do all the work.

Never `git stash`; `npx prettier --check` only, never `--write`. Never commit. No SDK build expected (if the SDK
must change, stop and report). Tests only as
`systemd-run --user --scope -p MemoryMax=10G -p MemorySwapMax=0 --quiet bash -c "npx vitest run --maxWorkers=3 <paths> > plans/tl-3b-<n>.log 2>&1"`,
one run at a time: wait first with `until ! pgrep -f "^node .*vitest" >/dev/null; do sleep 5; done` (lane
`tl-2c` is running tests too). `NODE_OPTIONS=--max-old-space-size=10240` for `tsc` and `npm run check`.
No migration. Inside `db.transaction` only `tx`. No full run, no `npm run build`.

## Owner (2026-11-16)

"User gets a choice, undated by default without an existing lorebook." "If the genre/preset supports undated,
use undated by default. With dating on, default to real calendar. For an existing lorebook, default to the most
recently active point. There shouldn't be a scenario where it defaults to 1-1-1." Standing: P3 (a setting
answers who changes it, why, what breaks without it), P1 (every automatic action shows its cause), genres
expect, never lock; members never see model plumbing (this is not plumbing: any session starter sees it).

## What exists (verify)

- Create decides the new own lorebook's timeline only from `timelineDefaultFor(genre, presetDefaults)`
  (`sockets/sessions.create.ts` ~781–788): there is no parameter for the person's choice.
- `tl-2d`: create's `today` branch sets a new dated session's clock to today's date (no time of day);
  `lorebooks:storyTime` replies `start: {branchId, date, cause}` **for an existing lorebook**; the form's date
  line and **Change** (`SessionLorebookReading`, needs a `lorebookId`) show only for a chosen existing lorebook
  (`StartSessionForm.svelte` ~843–866). `storyToday` / `storyStartOf` in `state/storyTime.ts`.
- `tl-3a`: every Story preset now defaults to no timeline; `timelineOfferFor` (`StartSessionForm.svelte`
  ~1014, copy ~2494–2525) therefore shows only for presets whose default is a timeline; **Create a lorebook ›
  Keep a timeline** (the Blank way) is a separate, existing switch, off by default.

## Build

1. **One control on the start form, when the session will get its own new lorebook (no existing lorebook, no
   starter kit) and the genre does not require a timeline:** a switch for story time, **off** unless the
   preset's `defaults.timeline` is `true`. Label and one sentence of purpose are ★ (propose; reuse the existing
   words **Keep a timeline** if the control means the same thing as the Blank way's switch, and then it must be
   the same control in the same place, not a second one: report what you found and chose). It replaces the
   advisory offer of `timelineOfferFor` for this case; remove copy that becomes dead.
2. **Genre requires a timeline** (the Lair, Dungeon Crawler): no switch; the form says in words that this
   genre keeps story time (★ sentence), and shows the date line of item 4.
3. **An existing lorebook is chosen:** no switch; unchanged from `tl-2d` (that lorebook's own switch stands and
   the form shows its date line, or nothing when it keeps no timeline). If the form does not already say in
   words that the chosen lorebook keeps no timeline, do not add it: report.
4. **The date line for a lorebook not yet made.** With story time on (items 1 and 2) the form shows *The story
   begins today, ‹date›.* (the existing sentence), the date computed for the real calendar in the session
   owner's time zone by the **server** (extend the existing read, or a small one beside it: no date arithmetic
   in the browser beyond what `tl-2d` already does; say which), and a way to pick another date before starting
   (the existing clock fields the form already sends as `storyClock*`; `SessionLorebookReading` cannot be used
   without a lorebook id: reuse its date field component if one is separable, else the smallest existing date
   control; no line picker here: a new lorebook has one line).
5. **The create parameter.** `sessions:create` takes the choice (🚧 name by §24, ★; a boolean, absent = the
   default from `timelineDefaultFor`), honoured only when the session gets its own new lorebook; ignored with a
   chosen lorebook or a kit; **a genre that requires a timeline wins over `false`** (refuse or ignore: follow
   how create treats other contradicted inputs, say which). `shared/sockets/types.ts` typed. Every other caller
   of create (next chapter, branch-off, duplicate, the import of sessions, quick start, tests' helpers): absent,
   so unchanged; list them as verified.
6. **Docs:** `docs/sessions.md` (the timeline paragraphs and "When the story begins"; `tl-3a`'s sentence "To
   keep story time in a Story session, switch the notes' Timeline on in Book settings, or start the session on
   a lorebook that keeps one." gains the form's switch), `docs/genre-story.md` "Without a timeline.",
   `NOMENCLATURE.md` (the parameter, the control; §25).

## Tests

Server: create with the choice true / false / absent × Story (each shipped preset), a preset with
`timeline: true`, a required genre (false is overridden / refused), a chosen lorebook (ignored), a kit
(ignored); with true the session starts today on the real calendar and a picked date is honoured; a second boot
changes nothing. DOM: the switch shows / hides per the four cases, its initial value follows the preset, the
date line appears with it, Start sends the parameter. `sockets/sessions.creationModes.int.test.ts` "a following
session is followed by a following one" fails since `tl-2d` (clock is today where it expects null; an attached
lorebook with no date, next chapter): **do not re-pin it**; report exactly which create branch dates it and
whether a following session should instead inherit "no date" from the session it follows (that is D52(b), the
owner's call).

## Files owned

`src/lib/client/**/StartSessionForm.svelte` and the small components it uses for this control,
`sockets/sessions.create.ts` (the parameter and its use only), `shared/sockets/types.ts`, the storyTime read if
extended (`sockets/lorebooks.ts` storyTime handler or a sibling), the tests above, the docs. Lane `tl-2c` owns
`pipelines/runtime/host*.ts`, `state/storyTime.ts` dating helpers, `characters/versions.ts`: call
`storyTime.ts`, do not edit it (if you must, the smallest additive export, and say so).

## Stop and ask when

CLAUDE.md §Decisions applies; the Blank way's **Keep a timeline** and this control cannot be one control without
a layout change beyond one row; a date for a not-yet-made lorebook cannot come from the server without a new
socket event (propose the smallest; build it only if it is a reply field on an existing event).

## Report

Final message = the report (lead saves `plans/REPORT-tl-3b-<date>.md`): the control (where, when shown, label
and sentences ★), the parameter (name ★, precedence), the date line for a new lorebook, callers verified, tests,
the creationModes finding, **Noticed, not done**. Under about 600 words.

## Cold review corrections (2026-11-16) — these rule over the text above

1. **`timelineOfferFor` stays exactly as it is.** It shows only under a **chosen existing** lorebook
   (`StartSessionForm.svelte` 1014–1025) and is the owner's 2026-11-14 "Off with offer at session creation"
   (`PLAN-entry-time-and-lines-2026-11-14.md` 260–262). Delete from item 1: "It replaces the advisory offer …
   remove copy that becomes dead".
2. **The new switch and the dialog's Keep a timeline are two controls.** `NewLorebookDialog.svelte` 307–318
   creates a standalone lorebook before Start and the form then holds it as a chosen existing lorebook (case 3,
   already covered by `tl-2d`). The new switch sets the **session's own notes** and shows whenever nothing is
   chosen (`noLorebookChosen`, `StartSessionForm.svelte` 910–912) and the mode is `new`, **whether or not
   advanced controls are on** and however that state is drawn (the **None** card for Chat / Guide ~3270,
   **Start blank** ~3060, or no lorebook row at all when the person has no lorebooks ~2997 / ~3248): place it
   once, where every one of those layouts shows it (report where). The "one control" stop condition is dropped.
   Reusing the label **Keep a timeline** is still a ★ (the charter differs: say so in NOMENCLATURE).
3. **The date line for notes not yet made is display only; no new event, no change to `lorebooks:storyTime`**
   (it is scoped on `lorebookId`). Create already works out today itself when no clock is sent
   (`sessions.create.ts` 814–832, cause `today`) and the notes' calendar is fixed (`OWN_BOOK_CALENDAR`). The
   form formats today's date in the account's time zone with the existing shared calendar formatter and that
   calendar (formatting, not arithmetic); the server stays the authority at create. If the account's time zone
   is not available to the form, use the browser's and say so in the report.
4. **A picked date is never written with story time off.** The form sends `storyClock*` for this case only
   while the switch is on; create ignores a clock when the notes' resolved timeline is false (today
   `sessionLinePatch`, `sessions.shared.ts` 1614–1624, checks the calendar and not the timeline, and create
   writes the clock before the notes exist, `sessions.create.ts` 748–761): follow item 5's precedence, test both.
5. **Callers, corrected.** The import does not call create (it calls `insertOwnBook` itself); branch returns
   early (`sessions.create.ts` 72–90); next chapter always attaches a lorebook (105–111): the parameter is
   ignored there. The two real no-lorebook callers besides the form are the first-run wizard through
   `buildCreatePayload` (`src/routes/+page.svelte` 1118–1127) and the document-view new-session page
   (`src/routes/document-view/sessions/new/+page.svelte` 111–124): both stay **absent** (the default). Add the
   parameter in `sendCreate` next to `storyClock*` (~`StartSessionForm.svelte:1680`), not in
   `buildCreatePayload`.
6. No shipped preset has `timeline: true` (`core-catalog/src/seed/presets.ts:65`): test the on-by-default branch
   with a fixture preset row, as `sockets/sessions.createStoryStart.int.test.ts` does.
