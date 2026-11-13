# BRIEF — `sense-b1-w4` — a held change is listed, applied (folded, recorded), and can be taken back

You are a `lane-worker` for lane `sense-b1` (supervisor: the agent that launched you). Repo
`/home/jody/github/serene-pub`. Use absolute paths. Return your report as your final message (no report file).
A docs worker (`w5`) edits `docs/`, `NOMENCLATURE.md` and the SDK guide at the same time: **never edit a file
outside your list below.**

## The lane in one paragraph

Stage B's thin slice. A pipeline's change to an entry of the session's **attached lorebook** is now stored as a
**held amendment** 🚧: an `entry_amendments` row in the session's **own book** (`lorebooks.session_id = the
session`) naming the lorebook's entry, with `fields` (the change, in the wire row's words: `name`, `content`,
declared fields flat), `base` (`{ key: {v: value} | null }` — what each changed key read when the session wrote),
`source_message_id` (the turn's anchor) and a date (the session's moment at day grain) or none. **A held amendment
is exactly a row with `base IS NOT NULL`.** Only its session reads it. You build what happens next: the existing
**This session only** card lists it, **Apply to the lorebook** folds it into the lorebook with a change record, and
one server function takes an Apply back. Owner rulings that bind (2026-11-11): **"Only Apply settles." "A turn
owns what it wrote."** Stage B questions 1–2, lead's decision **(b) fold**: Apply folds a held change into the
lorebook's row and files a change record that keeps before, after, the session and the message; a branch reads
the lorebook live, so it sees what its original applies later. The change record for lorebook rows stays
`lore_imprints` (`session_imprints` is the session's; never merge them). It is a session, never a chat; every
session has a lorebook. Members never see model plumbing.

## Already built — read, do not change (unless listed under Files owned)

- Migration `drizzle/0156_nappy_paladin.sql`: the held-amendment columns, and `lore_imprints.origin` (text, NOT NULL,
  default `'run'`, CHECK run · routine · press · person · apply · book-run · upgrade), `batch` (text), `cause` (jsonb).
- `state/reading.ts`: `sessionReadingOf` sets `holderBookId` (the own book) for a session with an attached
  lorebook. `state/entriesOnReading.ts`: `entryOverlaysFor` lays the holder's held rows on top of any reading that
  carries `holderBookId`; a reading **without** it is the lorebook's own view on that line. `shared/lorebooks/
  amendments.ts`: `Amendment = LineAmendment | HeldAmendment`; `amendmentDeciding(overlays, entryId, field, reading)`.
- `pipelines/runtime/host.ts` `holdLoreEntryChange` (how a held row is written — read it, ~2019); `state/write.ts`
  takes and restores held rows with their turn; `lorebooks/ownBook.ts` `copyOwnBookToBranch` copies them to a
  branch (`src/lib/server/sessions/branch.heldAmendments.int.test.ts` shows how a test makes one).
- `lorebooks/imprints.ts`: `wrap`, `unwrap`, `sameValue`, `retractionAct`, `retractImprints`, `imprintChanges`,
  `entryFieldAddress`, `fieldLabel` (how a kept imprint names a field). `utils/lorebookEntries.ts`: `splitUpdate`,
  `mergeFields`, `toEntryRow`, `DEFAULT_VECTOR_NAME`.

## Goal

1. **Change records carry an origin** (`src/lib/server/lorebooks/imprints.ts`): export `IMPRINT_ORIGINS` (the seven
   CHECK values) and `ImprintOrigin`; the imprint writers (`imprintField`, `imprintChanges`) take an optional last
   argument `{ origin?, batch?, cause? }`, default `run` (every existing caller unchanged). **`retractImprints`
   never selects an `origin = 'apply'` record** — in either selection (by message, by run): an applied change is the
   lorebook's ("Only Apply settles"), so a swipe, a regenerate, Back or a delete of its message never takes it.
   `retractionAct` and the rest of the rule do not change.
2. **Settling keeps an Apply's records** (`src/lib/server/sessions/settle.ts` `compactThrough`): the
   `lore_imprints` compaction (`before: null, status: 'settled'`) skips `origin = 'apply'` records (challenger C2).
   Nothing else in settle changes; Apply does not move the settle line in this lane (the settle triggers are a later
   lane's) — say so in a one-line comment where Apply discards Forward.
3. **Listed** (`src/lib/server/lorebooks/ownBook.ts` `overlayItemsOf`): after today's items (each now also carrying
   `kind: "entry"`), list each held entry change of the session, oldest anchor first (null first, then id): own-book
   rows with `base IS NOT NULL` whose entry is in the session's attached lorebook. Item:
   `{ kind: "entry-change", amendmentId, entryId, typeId, title, sourceMessageId, changes: { field, label, before,
   after }[], conflict: string | null }` — `field` the wire key, `label` the field's name as a person reads it (reuse
   how `imprints.ts` labels a kept imprint's field, `name` → the entry's name label), `before` the base value,
   `after` the held value, `conflict` from item 4's check (null when clean). `title` is the entry's name as the
   session reads it.
4. **The conflict check (F6)**, one internal function used by the list and by Apply: re-read the lorebook entry as
   **the lorebook** has it on the session's line — the session's reading with `holderBookId` removed, at the held
   row's date when it has one, else at the reading's moment — and compare each changed key with `base`
   (`sameValue(read, unwrap(base))`). Any difference → conflict 🚧 `"<Label> has changed in the lorebook since
   this session changed it."`. An **undated** held change whose key is decided by one of the line's amendments
   (`amendmentDeciding`, on the lorebook's view) is also a conflict 🚧 `"A dated change in the lorebook decides
   <label> here, so this change would not show."` (folding into the row would be shadowed by it).
5. **Applied** (`applyOverlayItems(db, { sessionId, userId, entryIds?, amendmentIds? })`): who may apply is unchanged
   (the attached lorebook's owner; `APPLY_OVERLAY_REFUSALS`). Selection: both absent → every item (new entries and
   held changes); `entryIds` only → those new entries only (today's behaviour); `amendmentIds` only → those held
   changes only; both → both. One transaction, the attached lorebook's advisory lock, Forward discarded as today.
   One `batch` id per press (`randomUUID` from `node:crypto` — server code). Held changes in anchor order (null
   first, then id); each re-checked **inside the transaction after the previous folds** (item 4); a conflict stays
   held and is returned with its reason. A clean one:
   - **undated** → fold into the lorebook row: `splitUpdate(typeId, held.fields)` → update the row as the host's
     write does (columns, `mergeFields` for typed fields, `updatedAt`; delete the default vector when `title` or
     `content` changed); file one `lore_imprints` row per changed stored address (`title`, a column, or
     `entryFieldAddress(key)`), with `before` = the base value, `after` = the held value (wrapped), `origin: 'apply'`,
     `batch`, `session_id` = the session, `message_id` = the held row's anchor, `run_id` null, `lorebook_id` = the
     attached lorebook, `cause: { by: { userId }, sessionId, messageId, amendmentId, key }` (`amendmentId` the held
     row's id, `key` the wire key); then delete the held row;
   - **dated** → the held row **moves** (superseding, never overwriting — the base row is untouched): `lorebookId` →
     the attached lorebook, `branchId` → the session's line (`sessionReadingOf(…).branchId`), `base` → null,
     `sourceMessageId` → null (so it is an ordinary dated amendment now); records filed as above, with the same
     `cause` (its `amendmentId` is the moved row's id).
   Returns `{ lorebookId, applied, appliedChanges: number[], stillHeld: { amendmentId, reason }[], batch: string |
   null }` (`batch` null when nothing held was applied). Today's new-entry path is unchanged.
6. **Taken back** — one exported server function in `ownBook.ts`, `takeBackApply(db, { batch, userId })`: the
   attached lorebook's owner only (`APPLY_OVERLAY_REFUSALS.notOwner`). Load the `origin: 'apply'` records of the
   batch (none → refuse 🚧 `"Nothing to take back."`). **All or nothing**, checked first, refusing in a sentence
   (F8) when something stands on it:
   - the entry is gone → 🚧 `"<Entry> is no longer in the lorebook, so this can't be taken back."`;
   - undated: a record's field no longer holds its `after` → 🚧 `"<Entry>'s <label> has changed in the lorebook
     since it was applied, so this can't be taken back."`;
   - dated: the moved amendment (`cause.amendmentId`) is gone from the lorebook or its fields no longer hold the
     records' `after` → 🚧 `"The dated change to <Entry> was edited in the lorebook since it was applied, so this
     can't be taken back."`.
   Then, in one transaction (lock the lorebook and the own book): undated → write each field's `before` back and
   re-insert the held row **with its original id** (`cause.amendmentId`) in the session's own book: `fields` and
   `base` rebuilt from the records (`cause.key` → `after` / `before`), `sourceMessageId` = the record's
   `message_id`, undated; dated → move the amendment back (own book, `branchId` null, `base` and `sourceMessageId`
   rebuilt from the records); delete the batch's records. Throw `OwnBookRefusal` for every refusal. **No socket and
   no UI** for take-back in this lane (tests only).
7. **Sockets and types** (payload additive only): `src/lib/server/sockets/sessions.ts` `sessionsApplyOverlayHandler`
   passes `amendmentIds` (filtered to safe integers, as `entryIds`) and returns `appliedChanges`, `stillHeld`,
   `batch` beside today's fields; `sessionsOverlayItemsHandler` is unchanged (it returns what `overlayItemsOf`
   returns). `src/lib/shared/sockets/types.ts` `Sessions.OverlayItems.Item` gains the optional `kind`,
   `amendmentId`, `changes`, `conflict`; `Sessions.ApplyOverlay.Params` gains `amendmentIds?: number[] | null`;
   `Response` gains `appliedChanges?`, `stillHeld?`, `batch?`. No new event, no new socket.
8. **The card** (`src/lib/client/components/sessionForms/SessionViewPanel.svelte`, the **This session only**
   section only, existing layout): one more item kind. An `entry-change` item shows the entry's title, then one
   short line per change 🚧 `<Label>: <before> → <after>` (a value shown as short text: a string trimmed to one line,
   a list joined with commas, empty as *empty*), and, when `conflict` is set, the reason as one muted line and **no**
   Apply button for that item (the owner fixes the lorebook or leaves it held). Otherwise **Apply to the lorebook**
   sends `amendmentIds: [item.amendmentId]`. Key each row by kind and id (two changes can name one entry). **Apply
   all to the lorebook** is unchanged (it sends neither list). No toast from the view (sockets rule below).
9. **Tests** (Done means) and the one existing test this lane's write moved:
   `src/lib/server/pipelines/runtime/loreSources.int.test.ts` case (g) "match { name }: one candidate updates it…"
   now fails (`expected 'old' to be 'rebuilt'`) because a match on an attached entry is held: rewrite that case to
   the new behaviour (the session reads `rebuilt`, the lorebook row stays `old`, one held row) without weakening
   the rest of what it tests.

## Files owned

- `src/lib/server/lorebooks/imprints.ts` — `IMPRINT_ORIGINS`, the writers' optional argument, `retractImprints`'
  selection only.
- `src/lib/server/sessions/settle.ts` — the `compactThrough` exemption only.
- `src/lib/server/lorebooks/ownBook.ts` — `OverlayItem`, `overlayItemsOf`, `applyOverlayItems`, `takeBackApply`,
  their internal helpers. Not `copyOwnBookToBranch` beyond reading it.
- `src/lib/server/sockets/sessions.ts` — the two overlay handlers only.
- `src/lib/shared/sockets/types.ts` — the `OverlayItems` and `ApplyOverlay` namespaces only.
- `src/lib/client/components/sessionForms/SessionViewPanel.svelte` — the This session only card only.
- Tests: new `src/lib/server/lorebooks/heldApply.int.test.ts` (list, conflict, apply, take-back, settle, member,
  Back after apply), extend `src/lib/server/sessions/branch.heldAmendments.int.test.ts` (after the original
  applies), `src/lib/server/pipelines/runtime/loreSources.int.test.ts` case (g), and any existing test of the
  files above that the change breaks (rewritten, never weakened; list each).

## Files readable

Anything. Useful: the files above; `src/lib/server/pipelines/runtime/host.heldEntryChange.int.test.ts` (how a
test makes a held change through the real outlet — prefer the real path in your done-means tests);
`src/lib/server/sessions/settle.int.test.ts`; `src/lib/server/lorebooks/ownBook.int.test.ts` (today's Apply
tests); `STYLE-GUIDE.md` §9 Accessibility and §10 Writing; `NOMENCLATURE.md` §9 **lore imprint** row.

## Out of scope

Applying anything but held entry changes and today's new entries; links, members, values, scenes; automatic Apply
and any lorebook setting; moving the settle line on Apply; a take-back UI or socket; removing the lore write mode or
a routing function; `copyOwnBookToBranch`; docs and NOMENCLATURE (w5's); the SDK.

## Stop and ask (in your report, then stop) when

- the fold cannot keep "supersede" for a dated change (the base row would have to be written);
- a published SDK name, port or payload would change other than additively;
- a held change would be visible to another session or to the lorebook's own reading;
- you need a migration, a new setting, a new socket or event, or an exported name beyond `IMPRINT_ORIGINS`,
  `ImprintOrigin` and `takeBackApply` (name it and why);
- an existing test fails for a reason you did not cause (report it verbatim; do not fix other people's code).

## Done means

`heldApply.int.test.ts`, through the real outlet where it can:
- two sessions on one lorebook each hold a different change to the same field; each reads its own; the first
  applies cleanly (lorebook row changed, held row gone, records `origin: 'apply'` with one `batch`, `cause`,
  `before`/`after`, `message_id` = the anchor); the second is then a conflict — listed with the reason, Apply returns
  it in `stillHeld`, it stays held and the session still reads its own value;
- `takeBackApply` of the first's batch restores the lorebook value and the held row (same id, same anchor) — and the
  second then applies cleanly; the same take-back works after `settleThrough` past the anchor (records keep `before`,
  stay standing); take-back refuses with the sentence when the field was changed in the lorebook since;
- a dated held change applies as a moved amendment on the session's line: the lorebook's reading shows the old value
  before the date and the new one at and after it; the base row is untouched; take-back moves it back;
- an undated change shadowed by a dated line amendment is a conflict with the second sentence;
- Back of the anchor's message after an Apply leaves the lorebook as applied (the apply records are not taken);
- a member's session on someone else's lorebook: its held change is listed, and Apply refuses with
  *Only the lorebook's owner can apply changes to it.*;
- the list shows `changes` with labels, before and after, and `kind` on every item;
- `entryIds` only still applies new entries only (today's tests pass).
`branch.heldAmendments.int.test.ts`: after the original applies, a branch cut before the change and one cut after
both read the lorebook's value (the branch cut after still holds its copy, which is now a conflict).
The existing suites pass: `ownBook.int.test.ts`, `ownBook.test.ts`, `settle.int.test.ts`, `imprints.int.test.ts`,
`imprints.rule.test.ts`, `oneUndoRule.int.test.ts`, any test of the two overlay sockets, `loreSources.int.test.ts`.
`NODE_OPTIONS=--max-old-space-size=10240 npx tsc --noEmit -p .` clean. Do not run `npm run check` or
`svelte-check` (the lead runs it in the grouped verification); check the card's markup and types by re-reading
your change against the `Sockets.Sessions.OverlayItems.Item` type.

## Verbatim rules

- "This is an implementation task. Answer any relayed status question in one line in your report, and still do all the work."
- "Never run `git stash` in any form, including `--keep-index` or to probe prettier; it stashes every other lane's uncommitted work. Use `npx prettier --check <file>`."
- "Never commit. Never `npm test` or `npm run build` at the SDK root. Delete only the `/tmp/serene-pub-vitest-*` dirs your own tests made, by name; never a glob over `/tmp/serene-pub-*`."
- "Before any `sdk:build`, check `pgrep -af "vite dev"` for a serene-pub server. If one is up, don't build; report 'blocked on your dev server'." (You do not need `sdk:build`.)
- Never `prettier --write` on a directory. Never `git checkout` / `restore` / `stash` in either repo. Never
  `kill -9` anything. Inside `db.transaction(async (tx) => …)` use only `tx` — the outer `db` deadlocks PGlite.
- **Sockets:** one domain context per event family is the only listener and the only place that toasts; views
  register listeners for local state and **never call `toaster`**. `socket.off(event)` always passes the handler.
  `$state(new Set())` / `new Map()` is not reactive on mutation: use `SvelteSet` / `SvelteMap`. Browser code runs on
  plain-http LAN addresses and phones: no `crypto.randomUUID`, no `navigator.clipboard` (server code may use
  `node:crypto`).
- STYLE-GUIDE §10: sentence case everywhere; a button says what happens; one name per thing (a **session**, never a
  *chat*); errors say what went wrong and what to do; no filler. §9: every interactive element is a real `button`
  with an accessible name; nothing hover-only.
- It is a **session**, never a *chat*. Every session has a lorebook: never write "no lorebook".
- No migration in this task. Never add a top-level `await` to `src/lib/server/db/index.ts`.
- **No reference to any other project or product** in code, comments, tests or docs.
- Run only your targeted test files, in a capped scope:
  `systemd-run --user --scope -p MemoryMax=10G -p MemorySwapMax=0 --quiet bash -c "cd /home/jody/github/serene-pub && npx vitest run --maxWorkers=3 <files>"`.
  An int test that opens a DB inside an `it` needs a 60 s timeout. Never pipe vitest into `head`. Never run the
  whole suite. `npx prettier --check <file>` on each file you changed (the repo is not prettier-clean to start
  with: report only what your edits introduced; `--write` only on files you created). Do not start a dev server.
- Other sessions are editing this repo (a visual-novel layout lane, speech). Do not touch their files and do not
  "fix" failures that are theirs.
- Do what is asked, at the size asked. Findings along the way go under **Noticed, not done**, never fixed in passing.
- Re-read the cited lines before changing anything; line numbers have drifted.
- NOMENCLATURE R3: "held amendment", never bare "held" in a name. ⚠ "held" is already used elsewhere (a ruleset's
  *held entry*, a change *held for review*); never reuse those names. Every user-visible sentence is provisional 🚧
  copy: list each one, verbatim, in your report.

## Report (your final message)

Changed files; the shapes of `OverlayItem`, the apply result and the record `cause` as built; each refusal and
conflict sentence verbatim; tests run with pass/fail counts and what each new test proves; existing tests you
rewrote; anything that stopped you; **Noticed, not done**.
