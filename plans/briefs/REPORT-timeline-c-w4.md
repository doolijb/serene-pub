# REPORT timeline-c-w4

Status question: none relayed.

## Changed files
- `src/lib/client/components/sessionPage/sessionPageData.svelte.ts`: held `storyTimeline` state, `setStoryTimeline`, getter `storyTimeline`, exported `coalescedRead`.
- `src/routes/sessions/[id]/+page.svelte`: the clock effect now reads through `coalescedRead`, sets calendar and timeline from one reply, and re-reads on `inbox.on("state:changed")` for this session only (release returned from the effect; no socket use). Passes `timeline={data.storyTimeline}` to the Summarize modal.
- `src/lib/client/components/modals/SummarizeLoreModal.svelte`: prop `timeline` (default true). Off: History entry block not rendered; `canGenerate` and `generateScene` no longer need a history entry; `scenes:create` sends `historyEntryId: null`. The history entries list ask is left as is (not a simple guard).
- Tests (new): `sessionPage/coalescedRead.test.ts`, `sessionPage/sessionStoryTimeline.dom.test.svelte.ts`, `sessionPage/sessionStoryTimelineHarness.test.svelte` (test-only harness for onMount context).
- Test (extended): `modals/summarizeLoreModal.writes.dom.test.ts` (timeline on: block drawn; off: block absent, Generate summary emits `scenes:create` with `historyEntryId: null`).

## Names added (all 🚧)
Prop `timeline` (SummarizeLoreModal); `setStoryTimeline`; getter `storyTimeline`; `coalescedRead`. No user-facing sentences.

## Tests
- Run 1 `plans/timeline-c-w4-1.log`: coalescedRead, summarizeLoreModal.writes.dom, crosstalk.dom: 3 files, 10 tests pass (the rune test did not match the unit include; renamed).
- Run 2 `-2.log`: crosstalk pass; rune test failed (onMount needs a component), fixed with the harness.
- Run 3 `-3.log`: sessionStoryTimeline.dom: 1 passed.
- `tsc --noEmit -p .`: 0 errors.
- Prettier: SummarizeLoreModal formatted (was clean before); the page, sessionPageData and writes test were already non-conforming at HEAD, left alone.
- No existing `sessionPageData`/`sessionPageInbox` tests found.

## Not covered
The page-level wiring (state:changed for this session reads once, for another session not at all) has no test: the page is not mountable cheaply. The coalescing function and held value are tested; the session filter is one line (`msg.sessionId === id`).

## Messages
Changed nothing. Unstamped message shows real time: SDK `core-catalog/components/shared/messages/SessionMessage.svelte` ~362-367, test `sdk-tests/conversationSceneMarks.test.ts` ~253; no stamp written with timeline off: `src/lib/server/state/timelineOff.int.test.ts`.

## Audit (read only; none edited)
| Where | Shows/offers with timeline off today | Smallest hiding change |
|---|---|---|
| `sessionPage/CollectModal.svelte` ~21-25, ~262-271 (clock step fieldset, "Time passes..." Forward/Back, note "Moves this session's story clock...") | Still drawn; server refuses at propose time (`clockProposal.ts:103`, `TIMELINE_OFF_SENTENCES.clock`) so the user sees a refusal after sending | Page passes `timeline`; CollectModal skips the `collects.clockStep` fieldset (and the action's readiness check) when false |
| `modals/ProcessSceneModal.svelte` | No clock, date or history-entry text found by grep | None |
| Chronicle `ChronicleWidget.svelte` ~313-350 (clock head date, behind chip, step, Move the clock..., Follow) | Server reading gives `present: null` when off, so the date is empty; Move/step controls still drawn if `view.clock.canMove`; set is refused with `TIMELINE_OFF_SENTENCES.clock` (`sockets/storyClock.ts:202`) | Chronicle (SDK, not ours): hide the `chronicle.clock` section when the view says timeline off; needs the value carried to the widget, which the ruling forbids as SDK API now, so the view builder must drop `clock` itself |
| `sessionPage/requests/storyClock.ts` `storyClockV1` (~67-80) | Projects `present: null` to label `""` and `own` from the stored clock; carries no `timeline` | Return no clock (null) when `reading.timeline === false`; one place hides it in the widget |
| `sessionPage/requests/historyEntries.ts` / `startHistoryEntry.ts` / `compileHistoryEntry.ts` | History entry head, start and compile still offered; scenes/entries sockets refuse (`scenes.timelineOff.int`, `entries.timelineOff.int`) | Not ours; answer the head with no history list when off |
| `+page.svelte` ~252-261 `sessionStoryClock` | Derived from the session row's stored year/month/day, passed to the Summarize modal only to bound history offered; harmless with the block hidden | None needed |
| Session header | grep found no clock or date in `Header*.svelte` or page `.svelte` files | None |

## Noticed, not done
- The timeline-off Summarize modal still asks `entries:list` for history; harmless.
- Pre-existing prettier drift in the page, sessionPageData and writes test.
