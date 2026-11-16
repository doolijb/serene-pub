# REPORT — build lane `run-reads-entry` — an entry a run was shown cannot be saved over (2026-11-13)

Brief: `plans/briefs/BRIEF-run-reads-entry.md` (its "Corrections from the cold review" section rules). Worker
briefs: `plans/briefs/BRIEF-run-reads-entry-w1.md`, `-w2.md`. Owner rulings (2026-11-13): "Mark the entry, or
rather mark it in the runs metadata, check the runs when going to save an entry, or also show a notice in the
form. Can probably do something similar to prevent collisions elsewhere"; "Prevent the save, keep as draft, tell
the user upfront"; "Notice on open and on save". Closes ★4 of `plans/REPORT-lore-match-2026-11-13.md`.

**Nothing was looked at in a running app.**

## The rule as built

- **Set by the lookup.** When a registered run's `core:query/entries-named@1` step shows the model entries, the run
  earmarks their ids on its handle.
- **Cleared only when the run ends** (`finish` deletes the handle). A run parked at a review gate and a stopped run
  still count until they finish.
- **Saves are refused while it stands**, with one sentence, when they change the entry's name, content or a
  declared typed field compared with the stored row: `entries:update`; `amendments:create` and `amendments:update`
  (entry subject, with fields); `lorebooks:settleImprint` *Revert* of a title, content or `fields.*` imprint. The
  refusal is the usual `{ error }` on `<event>:error`.
- **The form asks; nothing is pushed.** It asks `entries:earmark` when an existing entry opens, on **Check again**,
  and once after a refused save that was not a timeout. While the answer is a sentence a notice line sits above the
  fields and **Save**, **Save & next**, **Save as of ‹date›**, **Change the base** and the cast member's Lore tab
  Save are disabled. The typed text stays.
- No table, column, migration, setting or pushed event. No SDK file changed, no `sdk:build`, no hash moved.

## The record (all 🚧) — `src/lib/server/pipelines/runtime/runRegistry.ts`

- `RunHandle.earmarks?: Map<EarmarkKind, Set<string>>`; `EarmarkKind = "entry"` is the only kind.
- `earmark(runId, kind, keys)`: a no-op when no run is registered under the id (a preview, a dry run, a test).
- `earmarkedBy(kind, key): EarmarkHolder[]`, oldest first;
  `EarmarkHolder = { runId, userId, sessionId?, specId?, kind, startedAt }`.
- No early clear; no second adopter; the registry imports nothing from lorebooks or sockets.

## How the binding knows its run

`coreBindings(run)` closes over `run.runId` (`runSpec` passes it, `runTurn.ts` ~1133). The binding calls
`earmark(run.runId, "entry", ids)` after `entriesNamedIn` returns, when there is a run id and ids. A preview or dry
run is never registered under its id, so it earmarks nothing.

## Person paths that can replace an entry's text

| Path | Now |
| --- | --- |
| `entries:update` (EntryWorkspace, entryManager, CastWorkspace Lore tab, TimeLens, EntryFireTest, storyMoved) | Refused when name, content or a typed field changes. Marks, keys, enabled, constant, archived, anchor, position pass. |
| `amendments:create` / `amendments:update` (entry, with `fields`) | Refused when the cleaned fields carry a name, content or typed-field key. A re-date alone, `amendments:delete`, the off window and cast subjects pass. |
| `lorebooks:settleImprint` *Revert* | Refused for a title, content or `fields.*` imprint, without comparing. *Keep* passes. |
| `entries:setMarks`, `entries:updatePositions`, `entries:copyFromLibrary`, `entries:iterateNext`, imports, `amendments:place`/`unplace` | Cannot replace text; not refused. |
| `sessions:applyOverlay` → `applyOverlayItems` (`lorebooks/ownBook.ts`), the held-change Apply | **Can replace an earmarked lorebook entry's text and is not refused** (outside the lane's files; ★2). |

The refused set is what the write can replace: `changeLoreEntry` (`host.ts` ~2255) writes title, content and
declared fields. Typed fields are compared with `stableStringify` against `toEntryRow(stored)`, the declared
default standing in for an absent key.

Entry ids are unique across entry types (`lorebook_entries.id`): the bare id is the key.

## The request (🚧)

`entries:earmark` · params `{ entryId }` · reply `{ entryId, lorebookId, notice: string | null }` · error
`{ entryId?, error }`. The book's owner only, as `entries:update`. In `SCOPED_EVENTS` (`lorebookId`) and
`GATED_EVENTS`. Types `Sockets.Entries.Earmark`; `typedSocket.ts`. The session's name is left out for an asker who
cannot open it.

## Provisional copy, verbatim (🚧)

‹routine› is the routine run's shown name, else the pipeline's stored name, else `A routine` / `A pipeline`.

- Running: *‹routine› in ‹session› may update this entry when it finishes. Your changes are kept here: save again
  then.*
- Waiting, the asker is the run's user: *‹routine› in ‹session› is waiting for your review and may update this
  entry. Your changes are kept here: decide there, then save.*
- Waiting, someone else: *‹routine› in ‹session› is waiting for review and may update this entry. Your changes are
  kept here: save again once it is decided.*
- *in ‹session›* is dropped when the asker cannot open the session.
- Button **Check again**; refusals *Entry not found or access denied.*, *The entry could not be checked.*
- The notice line: muted `text-xs`, `role="status"`, `Icons.Clock`, not dismissible.

## New names (all 🚧)

Server: `EarmarkKind`, `EarmarkHolder`, `RunHandle.earmarks`, `earmark`, `earmarkedBy`; `earmarkedKeys`,
`earmarkNotice`, `entryEarmarkHandler`, internal `refuseIfEarmarked`, `changedEarmarkedKeys` (`sockets/entries.ts`);
`assertNotEarmarked` (`amendments.ts`); event `entries:earmark`. Client: `askEntryEarmark`,
`EntryEarmarkNotice.svelte` (`data-entry-earmark-notice`); local state in the two workspaces.

## Changed files

`src/lib/server/pipelines/runtime/runRegistry.ts` (+ test), `runtime/bindings.ts` (the `entries-named` binding),
`runtime/loreMatch.entriesNamed.int.test.ts`, `src/lib/server/sockets/entries.ts`, `sockets/amendments.ts`, new
`sockets/entries.earmark.int.test.ts`, `src/lib/shared/sockets/types.ts`, `src/lib/client/sockets/typedSocket.ts`,
`src/lib/shared/sockets/interest.ts` (**outside the owned list**: one `SCOPED_EVENTS` and one `GATED_EVENTS` line
for the new request, which correction 6 requires), `src/lib/client/lorebooks/EntryWorkspace.svelte`,
`CastWorkspace.svelte` (Lore tab), new `lorebooks/editor/entryEarmark.ts`, `editor/EntryEarmarkNotice.svelte`,
`lorebooks/entryEarmark.dom.test.ts`, `lorebooks/EntryEarmarkContentFixture.svelte`, `docs/lorebooks.md`,
`NOMENCLATURE.md` (§8 row **earmark**, §25 entry).

## Tests and results (supervisor)

Capped scope, 13 files, 148 tests, all pass: `runtime/runRegistry.test`, `sockets/entries.earmark.int`,
`runtime/loreMatch.entriesNamed.int`, `runtime/host.loreMatchShown.int`, `sockets/sessions.sweepShown.int`,
`sockets/sessions.chatMemoryShown.int`, `sockets/entries.singleSave.int`, `sockets/scopedReplies.lorebooks.int`,
`sockets/amendments.int`, `shared/sockets/gatedEvents.test`, `client/lorebooks/entryEarmark.dom.test`,
`cast/memberPage.dom.test`, `cast/memberTabs.dom.test`. `tsc` 0 errors. `commentHistory.test` fails on nine files
that are not this lane's. Full `npm run check` left to the lead.

## Open ★

1. A review left waiting keeps those entries unsaveable for as long as it waits.
2. The held-change Apply (`sessions:applyOverlay`) is not refused. Recommendation: refuse that one item with the
   same sentence. Trade-off: one more place that blocks while a run goes.
3. The copy reads oddly with a long pipeline name (*Look back over the story in Mira's tavern may update this
   entry…*). Options: quote the name, or *The routine ‹name›…*.
4. The notice is not dismissible, against STYLE-GUIDE §6.21 ("shows once, then collapses to an icon"), because it
   explains a disabled Save. If accepted, STYLE-GUIDE should record the exception.
5. The names *earmark* and `entries:earmark`.

## Noticed, not done

- "Waiting for review" matches a pending review by the run's user and spec id only; two runs of one spec cannot be
  told apart.
- Only the oldest holder is named.
- `settleImprint` *Revert* is refused while earmarked even when it would change nothing.
- One extra ask after each successful save (the draft is rebuilt under the same key).
- A superseded run id gets a fresh handle, so its earmarks drop until the new run earmarks again.
- `prettier --check` fails at HEAD on several touched server files and on the new int test; `--write` not run.

## Lead verification, scope review and follow-up (2026-11-13)

- Lead's wider run (capped scope): the lane's files plus `shared/sockets`, `client/lorebooks`, `server/lorebooks`:
  156 files, 1862 of 1863 tests pass. The one failure was the lane's: `entries:earmark` was missing from
  `SCOPE_PATHS` in `shared/sockets/scopedReplies.test.ts`. **Fixed** (`["lorebookId"]`).
- Scope review: inside the brief and its corrections; registry free of lorebook and socket imports; the
  `interest.ts` edit justified. Findings:
  1. **Fixed.** `entries:earmark` answered the row's owner only, but the form treats a session's people as owners
     of the session's own book, so a guest opening such an entry got a refusal that the shell toasts. The request
     now authorises with `findOwnedBook` (a session's own book answers its session's people). Test added. **Not
     done:** `entries:earmark:error` is not in `Layout.svelte`'s handled errors (outside the lane's files), so a
     true refusal (a stranger, a deleted entry) still toasts.
  2. **Carried as ★6.** Copy added without a ruling: the third sentence (*…is waiting for review… save again once
     it is decided.*) and the fallbacks *A routine* / *A pipeline*.
  3. **Recorded.** A dated change that carries a name, content or typed field is refused while the entry is
     earmarked **without comparing** to what the entry holds; `entries:update` compares. Untested as a difference.
  4. **Half fixed.** The `entries:update` check now runs last, directly before the write. **Not done:** a save that
     commits between the run's read of the rows and its earmark (milliseconds) is not caught; closing it needs the
     text compare at the write, which the brief ruled out.
  5. **Partly fixed.** Test added: a typed field the row never stored, its declared default resent, is not
     refused. **Not tested:** **Save as of ‹date›** and **Change the base** disabled under the notice; the ask after
     a refused dated change; a real preview path (the "dry run" test uses an unregistered id).
- After the fixes: `entries.earmark.int`, `amendments.int`, `entryEarmark.dom`, `entries.singleSave.int`,
  `scopedReplies.lorebooks.int`, `scopedReplies.test` pass; `npx tsc --noEmit -p .` clean. `npm run check` was 0
  errors before the follow-up edits (which touched no Svelte file).
- ★6 The added copy above. ★7 Whether `entries:earmark:error` joins the shell's handled errors.
