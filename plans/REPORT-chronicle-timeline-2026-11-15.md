# REPORT — build lane `chronicle-timeline` (★T-C6) — 2026-11-15

Brief: `plans/briefs/BRIEF-chronicle-timeline.md` (its Corrections rule). Worker briefs `-w1`, `-w2`. Saved by the
lead from the supervisor's final message. Built; **not looked at in a running app.** One SDK name added, as the
owner approved. `npm run sdk:build` ran once from the app root at 01:48 on 2026-11-15 (no dev server, no vitest).

## Changed files

SDK (`../serene-pub-sdk`): `sdk/src/widgets.ts` (`HistoryEntriesV1` gains `readonly timeline?: boolean` 🚧
`@experimental`; its comment states the rule: with the timeline off, `unfiledDays` is one group, `date` null,
empty label, holding every scene of this session on its line, filed or not, in played order);
`core-catalog/src/shared/ui/chronicle/index.ts` (`chronicleView`: the timeline check comes before the
`ownerOnly` return; with it off `clock` is null whatever the setting, `now`, `nowEmpty`, `earlier`,
`earlierHead`, `earlierMore`, `unfiled`, `scenesEmpty` are empty or null, `scenes` holds every scene in
`unfiledDays`, the open scene's `since` is `''`, the guest gets its own sentence);
`core-catalog/components/shared/chronicle/ChronicleWidget.svelte` (the sentence in the clock's place; no **Now**
section; the **Scenes** section outside the `view.now` gate, its toolbar starting with **Open in lorebook**,
`scope: "scenes"`); `sdk-tests/coreChronicle.test.ts` (5 tests).
App: `src/lib/client/components/sessionPage/requests/historyEntries.ts` (every answer carries `timeline`, from
`sessions:storyClock`, absent = true; off: the clock has no present; `readChronicle` takes `answering`, and only
`answerHistoryEntries` skips `readHistory` / `readLines`; one played-order group of this session's scenes built
without `unfiledScenesByDay`; the open scene's `since` is `""`); `requests/historyEntries.test.ts` (4 new);
`remoteChronicle.dom.test.ts` (3 new: owner, guest, the switch flipped both ways); `docs/session-layout.md`,
`docs/lorebook-time.md`, `NOMENCLATURE.md` (§25 with the rulings quoted).

## Tests

`npm run sdk:test` (`plans/chronicle-timeline-sdk.log`): 4728 tests, 4723 pass, 4 fail (exactly the four known:
`deriveDontSpell` ×2, `surface`, `vocabulary`), 1 skipped; the 5 new Chronicle tests pass; no `coreCatalog`
digest moved. App: `historyEntries.test` 25, `startHistoryEntry` + `compileHistoryEntry` 21,
`remoteChronicle.dom` 13. `tsc` 0 errors. `npm run check`: 1 error in another lane's in-flight file
(`BulkEditBar.svelte:149`, lane `time-t8b-fix`).

## Names and copy

SDK: `HistoryEntriesV1.timeline` (the one approved name). Copy 🚧: *This lorebook keeps no timeline, so there are
no dates here.* · *This session's scenes are its lorebook owner's to read.* (a guest, Timeline off). App,
internal: `readChronicle`'s `answering`. No view field, widget part or export added.

## Open ★ (the lead's choices of correction 2, for the owner)

1. Hidden with the Timeline off: the clock section, **Now**, Earlier, **Compile**, *Not yet compiled*, *Undated*,
   every day label, *since ‹date›*, **Start new history entry**.
2. Kept under the plain heading **Scenes**: the scene list, **Summarize scene**, **Summarize all (N)**, **Extend
   graph (N)**, the open scene with **Close scene** and **Close and summarize**.
3. **Open in lorebook** is the first button of the Scenes toolbar and opens the lorebook's Scenes list (not yet
   checked in a running app that `scope: "scenes"` with no scene id lands there).
4. The sentence shows even when the widget's **Show the story clock** setting is off.
5. A guest sees two notes: the timeline sentence, then the guest sentence.
6. The widget reads `answer.timeline` directly for its sentence and gates; `ChronicleView.scenes` gains a second,
   documented meaning (a view field would have been a new name).

## Noticed, not done

`docs/summarization.md` ~32 still says a scene needs a History entry; the widget's `{#if !timeless}` wraps the
Now section without re-indenting it.

## Scope review and lead follow-up (2026-11-15)

Scope review: in scope, nothing blocks it. `HistoryEntriesV1.timeline` is the only new published name, tagged
`@experimental`; no golden or digest moved; with `timeline` absent or true the view is identical, guests
included; **Open in lorebook** resolves to the lorebook's Scenes list on paper (`openLore.ts:28–33` →
`loreRoute.ts:596`); the flip test is real. Lead's follow-up:
1. A summarized scene's row still shows a wall-clock time (*Written from the story up to 3 Oct, 14:20*) under a
   note that said there were no dates. The time stays (it is real time, as messages show); the note now reads
   *This lorebook keeps no timeline, so there are no story dates here.* 🚧 (widget, both tests, docs, §25). Needs
   one `sdk:build` before the grouped verification.
2. The **Timeline** row's ⚠ in `NOMENCLATURE.md` no longer lists the Chronicle among what is still drawn.
Left for the owner: the six ★ above; `ChronicleView.scenes` and `unfiledDays` carry a second, documented meaning
while the Timeline is off.

## Grouped verification (lead, 2026-11-15, second) — `time-t8a`, `time-t8b` + fix, `entry-form-layout`, `chronicle-timeline`

`tsc` 0 errors; `npm run check` 0 errors (9 old warnings). Full `vitest run` (`plans/lead-full3.log`): 2479 files,
2456 pass, 22 fail; 26,087 tests pass, 28 fail. Of the 22: 19 are the known baseline, 2 are environment
(`audiocpp/packages.v.int`, `net/hfDownload.v`), and 1 is expected until the SDK is rebuilt:
`sessionPage/remoteChronicle.dom` asserts the reworded note (*…no story dates here.*) while the built SDK still
holds the old one. **Held, blocked on the owner's own server** (a suspended `vite preview` on port 4173 holding
his real database): one `npm run sdk:build` and the closing `npm run build`. `sdk:test` passed in the Chronicle
lane before the rewording (4 known failures only).

## Builds unblocked (lead, 2026-11-15, morning)

The owner had his suspended `vite preview` on port 4173 stopped (it shut down cleanly: lock released, last
shutdown clean). Then: `npm run sdk:build` (twice; the second after naming `firsthandCastMemberIds` in
`MessageV1`'s "Withheld" paragraph and the contract test's recorded row, which the SDK's
`messageRowContract` test requires); `npm run sdk:test` 4,723 of 4,728 pass, the same four old failures;
`sessionPage/remoteChronicle.dom` and the widget and frame tests pass (30 files, 296 tests); `npm run build`
passes; `tsc` 0 errors.
