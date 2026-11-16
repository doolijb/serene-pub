# REPORT — timeline-b worker 2

Status question: none relayed.

## Changed files (under src/lib/client/)
- lorebooks/bookData.svelte.ts: `BookData.timelineEnabled`, `bookTimeline()`, and `staticBookData` support (default true).
- lorebooks/LorebooksWorkspace.svelte: the `setBookData` provider gives `book?.timelineEnabled ?? true`. `BookSettings` gets `overlaysLorebook={book.overlayOf != null}`.
- lorebooks/BookSettings.svelte: mounts `TimelineCard` above the clock editor. The clock and calendar editors are drawn only with the switch on. The header comment is updated. When the timeline is off, `calendarUnsaved` is reset so the tab is not left flagged unsaved.
- lorebooks/time/TimelineCard.svelte (new).
- components/lorebookForms/NewLorebookDialog.svelte: `asksTimeline` prop, a `keepTimeline` switch, and `timelineEnabled` in the confirm details.
- lorebooks/LorebookActions.svelte: passes `asksTimeline`, and puts `timelineEnabled` on `lorebooks:create` when present. `makeBookFromKit` sends none.
- New tests: lorebooks/time/timelineCard.dom.test.svelte.ts, lorebooks/bookTimeline.test.svelte.ts with its probe component lorebooks/bookTimelineProbe.svelte, components/lorebookForms/newLorebookTimeline.dom.test.svelte.ts.
- components/Layout.svelte: not changed (see the error-event decision).

## Tests
- Run 1 (logs/timeline-b-w2-1.log): the new tests plus bookSettingsAdvanced, bookRulesFit, newLorebookKits, providedBooks, clearEditHistory and refusalsSaidOnce. Two new-test failures, both mine: a duplicate import and a whitespace assertion.
- Run 2 (plans/timeline-b-w2-2.log): the two fixed files, 14/14 pass. The other six suites passed in run 1.
- I did not re-run everything together after the fix.
- tsc (plans/timeline-b-w2-tsc.log): empty, so clean. I read the counts with an `any` cast, so worker 1's `timelineCounts` type is not needed to compile.
- `prettier --check` flags my edited files, but the repo's existing files in the set are also unformatted, so I did not reformat.

## Copy added (all marked 🚧 in comments)
- TimelineCard:
  - "Timeline" (title)
  - "Dates, versions over time, history and a story clock. Turn it off for a world where nothing needs a date." (help sentence)
  - "On: / Off: these notes follow their lorebook's timeline." (notes over a lorebook)
  - The prompt: "This lorebook has ‹n› dated version(s) and ‹m› history entr(y/ies). With the timeline off they are hidden, not deleted, and sessions read the lorebook as it stands now."
  - Buttons "Cancel" and "Switch off here".
  - The switch's sr-only label "Timeline".
- Two fallback error strings, "The timeline could not be changed." and the aria-label "Switch the timeline off". Neither is in the brief; they mirror BookRulesCard's pattern. Trim them if you want zero extra copy.
- NewLorebookDialog: "Keep a timeline" (visible switch label) and "Dates, history and a story clock. You can turn it on later in Book settings."

## Assumptions
- The dialog switch is the Skeleton `SettingSwitch` with a visible label.
- The card takes `timelineEnabled` from `bookTimeline()` in BookSettings. That is the BookData value, and it is true when mounted outside the workspace.
- If the counts read fails, the card saves off at once (the same as "no counts").

## B list-payload check
The server copies the lorebook's switch to the notes that overlay it:
- `lorebooks:update` (lorebooks.ts ~1083): `update ... where overlayOf = row.id`.
- `ownBook.ts` ~236: a new notes row is created with `timelineOfBook(tx, overlayOf)`.

The list row for notes over a lorebook therefore equals their lorebook's. The one gap is notes created before this was added: I did not check their stored value, so a boot pass would be worth confirming. I did not run a query.

## Error-event decision
I added nothing to `HANDLED_WHEN_ASKED_ERROR_EVENTS`, so `lorebooks:update:error` is still toasted beside the card's own line. `EditLorebookForm` sends a `requestId` with `lorebooks:update` but has no `lorebooks:update:error` handler. It relies on Layout's toast, so the brief's condition fails.

## Noticed, not done
- `EditLorebookForm` and the Layout toast cover each other for a refused save. If it later says its refusal in place, `lorebooks:update:error` can join the set.
- `StoryClockEditor` and `StoryCalendarEditor` unmount when the switch is off. The calendar's mid-edit draft is lost, whereas the advanced toggle only hides it.
