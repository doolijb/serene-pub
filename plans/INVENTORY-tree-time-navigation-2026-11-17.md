# INVENTORY — a tree / time navigator and a leap-rule builder (D52b, programme 2.5 / D7, D52d; read-only, 2026-11-17)

Prefixes: `c:` `src/lib/client/`, `s:` `src/lib/server/`, `sh:` `src/lib/shared/`, `sdk:` `../serene-pub-sdk/`.
Re-verify every file:line.

**Short answer:** nine surfaces show or pick a line or a date, none draws the tree: every line list is flat, with
"forked at / left from ‹date›" captions. Six hand-built Year / Month / Day forms do one job. Everything a
navigator draws can be read today from two owner-only socket reads (`lorebooks:lines`, `lorebooks:storyTime`) plus
the calendar. The one missing read is each line's dated points (its span) outside the lorebook workspace. The
app has a WAI-ARIA tree to copy (`ScopeTree`) and a two-layout timeline (`VersionRail`), but no tree drawing.
The leap rule is a fixed three-level chain in the SDK. The editor shows only its first level.

## 1. What shows or picks a line, a moment or a date today

| Surface (file) | Shows | Lets a person pick | Data | Mounted |
|---|---|---|---|---|
| `SessionLorebookReading` (`c:components/sessionForms/SessionLorebookReading.svelte`) | Line, story clock, the followed present | Line (`Select`, flat, "‹name› — forked at ‹date›", 115–124, 282); Follow / own clock (290, 173–186); Y/M/D/h/m inputs; step ± by unit (220–237) | `BookTime.listen` → `lorebooks:storyTime` + `lorebooks:lines` (`c:lorebooks/time/bookTime.svelte.ts` 117–148) | Edit session (`EditSessionForm.svelte` 2922–2944, read-only for guests / advanced off); start form under **Change** (`StartSessionForm.svelte` 2679–2683) and **Branch off at a point** (~2836) |
| Start form's date line + **Change** | *The story begins on ‹date›, where ‹book› last was.* / *…today…* | Opens the control above | `BookStoryTime.start` (`sh:sockets/types.ts` 8541–8545) | `StartSessionForm.svelte` 2659–2675 |
| Start form's own-notes date (tl-3b) | *The story begins today…* | Y/M/D, copied from the control above (report tl-3b:25) | `Intl` + `formatDate` on `real-calendar` | `StartSessionForm.svelte` 2715–2770 |
| Start choices (`SURFACED_STARTS`) | *Continue the latest line* / *Branch off at a point* | Which of the two | none | `StartSessionForm.svelte` 213–224 |
| Moment bar (`c:lorebooks/time/MomentBar.svelte`) | Moment in words, ticks per dated row, present | Scrub (`role="slider"`, 330–336); **Go to date…** Y/M/D (443–466); Make this the present | Workspace pool → `momentAxisRows` (`c:lorebooks/timelineStrip.ts` 69–80) | `LorebooksWorkspace.svelte` 2939 |
| Line chip (`time/BranchChip.svelte`) | Lines, flat, each with "left ‹parent› at ‹date›" (99–104, 236) | Switch, Fork, Rename, Delete, Compare | `branches` prop (`amendments:list`) | MomentBar; workspace 2919 |
| `MoveDownTheTreeDialog` | The line's ancestors, nearest first | One ancestor (radio, 230) | shared rule `moveDownTheTree` | entry, bulk bar, *Could exist here* |
| Story clock editor (`time/StoryClockEditor.svelte`) | A line's present | Y/M/D/h/m (134–189) | props from Book settings | `BookSettings.svelte` 438 |
| `VersionDateDialog` / `VersionRail` | An entry's versions on a vertical rail | A version's date (157–186); add before / after | caller | Entry and cast workspaces |
| Time lens, Lives lens (`TimeLens.svelte`, `LivesLens.svelte`) | One line: lanes for story, people, world (`<ul>`, 722–813); lives against the axis | Entries, not moments | workspace pool | `lenses/TimeMount`, `LivesMount` |
| Reading line (*Read by ‹session›*, **Read what it reads**) | A session's line and clock | Jump to them | workspace | `LorebooksWorkspace.svelte` 2702–2730 |
| Chronicle widget (`sdk:core-catalog/components/shared/chronicle/ChronicleWidget.svelte`) | Session's clock, Now, days, scenes | Next day / month / year, **Move the clock…** (inputs 398–405), **Follow the line's present** (390) | widget request `history-entries` (`c:components/sessionPage/requests/historyEntries.ts`), `set-story-clock` (202) | session layouts |

**Duplicates in function:** (a) six Y/M/D(/h/m) forms: SessionLorebookReading, own-notes date, Go to date,
StoryClockEditor, VersionDateDialog, Chronicle. (b) Three flat line lists: the `Select`, BranchChip, the
ancestor radio list. (c) Follow-or-own clock: SessionLorebookReading and Chronicle. (d) Set a line's present:
StoryClockEditor and Make this the present.

## 2. The data a navigator would draw

- **Lines:** `lorebook_branches` (`s:db/schema.ts` 9320–9390): `forkedFromBranchId` (NULL = left main), fork
  Y/M/D (all NULL = forked at now: follows its parent, no cut), own story clock. Main is implicit, never a row
  (9307–9312).
- **Tree read:** `lorebooks:lines` → `{ lorebookId, lines: { id|null, name, forkedFromBranchId, forkYear/Month/Day }[] }`,
  main first, then by id, unpaged (`s:sockets/lorebookStoryTime.ts` 135–170; types 8560–8577). Re-sent on fork,
  rename, delete (`s:sockets/amendments.ts` 2211, 2254, 2429). Client builds the tree (`lineOf`,
  `sh:lorebooks/lineReading.ts` 274).
- **Presents and start:** `lorebooks:storyTime` → `calendar`, per-line `clocks`, `presents` (clock, else newest
  history entry), `start` `{ branchId, date, cause }` (types 8518–8546). Server: `linePresentOf`
  (`s:state/reading.ts` 408–427), `storyStartOf` with causes undated / present / latest / today / asks
  (`s:state/storyTime.ts` 960–1000). Both reads are for owner, share recipient or admin
  (`lorebookStoryTime.ts` 121, 180). Guests get neither (`SessionLorebookReading` 40–45).
- **New lines:** `ensureSessionLine` forks at the session's moment on its **first write**, named after the
  session (`s:lorebooks/sessionLine.ts` 115–170). Manual forks go through `amendments:fork` (2156).
- **Size:** no cap (no limit found). One line per branched session that wrote, plus each manual fork. A line row
  doesn't say which session made it: that is only `sessions.lorebook_branch_id`. Real counts not measured.
- **Dated points per line:** one history entry per date (ruled 2026-11-10), plus dated amendments and cast
  versions. Only the workspace pool holds them (`momentAxisRows` dedupes by date). The session side reads
  history through `entries:list` + `lorebooks:lines`, owner only (`historyEntries.ts` 1–30). **No read returns
  a line's first dated point or its span**, which "extend backward" (D7) needs.
- **"Any time in between":** `dateProblem`, `nextStoryDate`, `formatDate`, `compareDates`, `advanceStoryTime`
  and `readStoryCalendar` are client-safe (`sh:lorebooks/storyDate.ts` 61–235). `storyDayIndex` is used there
  for weekdays (304); spacing uses `dateValue` (138). The SDK's component entry exports only the `StoryTime`
  types (`sdk:sdk/src/component.ts` 90), so a widget can't run calendar arithmetic.
- Moving a session's clock back past what it wrote asks a confirm (`ClockMoveBackNotice`, types 4702–4706).

## 3. Drawings to build on, and the rules

| Existing | What | Reuse |
|---|---|---|
| `c:components/templates/ScopeTree.svelte` (288) | WAI-ARIA `tree`: roving tabindex, arrows, Home/End (131–205, `aria-level`, `aria-expanded`) | Keyboard model for a tree list |
| `time/VersionRail.svelte` (684) | Vertical rail when wide, chips when narrow, from its own `@container/versions` (STYLE-GUIDE §6.19); add-between buttons | Layout pattern; "extend before / after" |
| `timelineStrip.ts`, MomentBar | Ticks spaced by date, `role="slider"` | Date scrubber per line |
| `c:components/graph/GraphVisualization.svelte` (1281) | Force-directed SVG (relationships) | Zoom / pan only |
| Pipeline map / event map | `@xyflow/svelte` + `elkjs` (dynamically imported, ~700 KB; `workspace/flow/layout.ts` 16, 240) | A lane drawing could reuse them; heavy for a picker |

`package.json` has no other graph or layout library (`@xyflow/svelte` ^1.6.5 and `elkjs` ^0.12.0 are
devDependencies, bundled). Skeleton 5 in use: `Dialog` + `Portal` (MoveDownTheTree, VersionDate), `Popover`
(BranchChip, RosterPopover). The app's `Select` is a Skeleton **Combobox**, not a Listbox
(`c:components/inputs/Select.svelte` 33–46). STYLE-GUIDE §6.6: a dialog that picks one value lists its
choices as `role="radio"` rows with **Use** / **In use**. A dialog that reads before picking splits in two by
`@container`.

## 4. The leap rule today

- **Shape:** `StoryLeapRule { every; month; skipEvery?; keepEvery? }`, each a whole multiple of the one before
  (`sdk:sdk/src/storyTime.ts` 279–287). It always adds one day to one month.
- **Read:** `isLeapYear` (452–457); the closed-form count `leapDaysThrough` (460–464) feeds `storyDayIndex`
  (522–526); the average year (600–603). All of these work only because each level divides the next.
- **Validated:** `storyCalendarProblems` (362–374); copied by `parseStoryCalendar` (437–442).
- **Edited:** `StoryCalendarEditor.svelte` has one checkbox, **Every ‹n› years, in ‹month›** (384–424, toggle
  229–230). It has **no field** for `skipEvery` / `keepEvery`. They survive a save untouched (report tl-2d:21).
  The summary says only *one more every N years* (290–291).
- **Printed:** the prompt layout says only `Leap day: every N years, in month M` (`s:pipelines/entities/variableLayouts.ts`
  462, 472, 491–493; parity fixture `liquidParity.fixtures.ts` 357). The SDK variable declares `leap` without the
  exceptions (`sdk:sdk/src/variables.ts` 1001–1004).
- **Builder UIs that exist:** `ConditionPicker` (one `when` condition from typed properties; an `all` / `any`
  is shown and can't be edited, `c:admin/sections/session-presets/ConditionPicker.svelte` 4–14).
  `EntryConditionField` (one curated condition). `RulesetFunctionRow` + `RulesetInlinePick`: a sentence whose
  holes are inline picks (`c:admin/sections/rulesets/`). Canvas `addClause` builds pipeline structure, not
  conditions. No chained-operator builder exists.

## 5. Constraints

- Phone width over plain http: no `crypto.randomUUID` (the app uses `uuid`, e.g. `TimelineCard`), no
  `navigator.clipboard`. Targets 44px on touch, nothing hover-only, focus visible, selection announced
  (`aria-current` / `aria-expanded`), no interactive inside an interactive, roving tabindex (STYLE-GUIDE §9).
  Container queries on the component's own box, never the viewport (§5.3).
- **Where it lives:** in the app, the Chronicle widget can't use it. Widgets compile in a sandbox that loads
  only their own files and allow-listed packages ("component kit never imports rulesets"), and the component
  entry has no calendar functions. In the SDK, an app import of a linked package's Svelte file brings a second
  Svelte's types into svelte-check ("linked package = second Svelte"). A pure-TS model (layout, spans, date
  steps) can be shared. A view in each place is the safe split.
- Words (NOMENCLATURE §1, R1, R3): bare **branch** is a *session's* copy (row at 484). The lorebook's is a
  **line** / **lorebook branch** (404, 390). The axis is the **timeline**, never the line (404). The owner's
  "branch/date picker" needs a qualified name (§24).

## 6. Options (none chosen)

| | Reuses | Size (rough) | Phone | A11y | Replaces |
|---|---|---|---|---|---|
| **(a) Tree list:** indented lines (main → forks under their parent at the fork date), each opening to its dated points and a date scrubber; *present*, *a date*, *earlier than the first* rows | ScopeTree keys, VersionRail container, timelineStrip, `storyDate` | 500–800 Svelte + ~300 TS model | Natural: one column | `tree` / `treeitem`; scrubber `slider` with `aria-valuetext` | Line `Select`, BranchChip's list, the ancestor radio list, the six Y/M/D forms (one date field inside) |
| **(b) Lanes:** horizontal SVG, a lane per line, fork joints, ticks, drag a cursor | TimeLens lane idea; optional `elkjs` | 900–1,400 | Scrolls sideways; small targets | Needs a `grid` or a hidden list twin | Same, plus the moment bar's track |
| **(c) Both:** one model, two views (lanes when the box is wide, the list when narrow) | All the above | ~1,500+ | List | Tree in both, lanes drawn over | Same |

**Leap-rule builder:**
- **(a) A chain of rows**, *every N years* · *except every N* · *unless every N* …, with add and remove. Today's
  shape holds exactly three. Deeper chains keep the closed form if each level still divides the next, but the
  SDK fields would change (e.g. an ordered list). That renames 🚧 published fields: the owner's call.
- **(b) A general builder** (and / or / not, `year mod N = k`, cycles such as 3, 6, 8 in 19, several leap
  months). This breaks `leapDaysThrough` and the average year, so they would need cycle enumeration, plus new
  validation, new prompt words and a new variable declaration.

## 7. Open questions for the owner

1. **One component for both A and B?** ★ Yes. The Line picker's modal (2.5) is its first host, then the start
   form's **Change**. Both pick the same thing.
2. **Tree list, lanes, or both?** ★ (a) first: it works on phones and with a screen reader. Lanes later, from the
   same model, if wanted.
3. **App or SDK?** ★ The view in the app, the model as plain TS. The Chronicle keeps its own small form until
   widgets get calendar helpers.
4. **New read for line spans** (first / last dated point, the sessions on each line): ★ add one owner-only read
   rather than load the whole pool on a session screen.
5. **Name** (R3: not bare *branch*): ★ propose under §24 with the brief.
6. **What does "logic builder" mean?** ★ (a): a chain of *every / except / unless* rows over today's three
   fields, plus the sentence in the editor and the prompt (D52d's words). Go to (b) only if a real calendar
   needs it.
7. **Does the date field replace the six Y/M/D forms?** ★ Yes, in the same lane where each host is touched;
   otherwise list them under *Noticed*.
