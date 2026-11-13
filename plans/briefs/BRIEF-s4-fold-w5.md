# BRIEF — s4-fold worker 5 — Merge ‹book› into these notes: socket, doors, Clone with changes removed, docs — 2026-11-08

Supervisor: lane `s4-fold` (brief `plans/briefs/BRIEF-s4-fold.md`). You are a lane-worker; you cannot spawn agents. Worker 3 is building the server function at the same time in `src/lib/server/lorebooks/foldInParent.ts` — **don't touch that file**; code against this signature (it may not exist yet when you start — tsc errors from the missing module are expected until w3 lands; report them, don't stub the module):

```ts
// src/lib/server/lorebooks/foldInParent.ts (worker 3)
export async function foldInParent(
	db: Db,
	input: { sessionId: number; userId: number }
): Promise<{ lorebookId: number; foldedFrom: { id: number; name: string } }>
// refusals: throws OwnBookRefusal (lorebooks/ownBook.ts) with FOLD_REFUSALS sentences
```

## Owner rulings (quote, never reinterpret)

- ★27-10 (2026-11-05): _"… No swapping lorebooks. But [own books] can be surfaced and overlays can have their parent merged in place."_
- ★B-2 (2026-11-08): button **Merge ‹book› into these notes**; confirm _"‹book›'s entries, cast, lines and dates are copied in, your changes stay on top, and from then on the session reads only its notes. ‹book› is not changed."_
- Plan §34.3: `cloneWithChanges` is **removed in the same change that adds fold** (no gap where an overlay can't make the story its own). _"Fold then Share-as-lorebook = what Clone with changes did, in two honest steps."_
- The overlay's read-only line gains the merge sentence: `BOOK_LOCK_LINES.overlay(book)` → _"This session reads ‹book› and keeps it. Share its notes to ‹book›, or merge ‹book› into its notes to make the story its own."_
- ★bk-lock-1: retire `SHARE_REFUSALS.noBook` if nothing throws it once the clone is gone.
- Memory rule "There is ALWAYS a lorebook": never frame a session as having no lorebook; say own notes / attached book.

The sentences live once in `src/lib/shared/lorebooks/sessionNotes.ts` (the supervisor already added 🚧 `FOLD_LABEL(book)`, `FOLD_CONFIRM(book)`, `FOLD_DONE(book)`, `FOLD_REFUSALS`): server and client import them, never retype.

## Goal

1. **Socket** `sessions:foldInParent` in `src/lib/server/sockets/ownBooks.ts`, replacing `sessionsCloneWithChangesHandler` in the same shape (`refusable(...)`, owner check via `checkSessionAccess` → `FOLD_REFUSALS.notOwner`; `emitToUser("sessions:foldInParent", { sessionId, lorebookId })`; the one toast through the central `success` event with `FOLD_DONE(foldedFrom.name)`; relist lorebooks + session notes; `pushSessionToParticipants`; `broadcastSessionRow`; fallback sentence for an unworded failure e.g. _"The lorebook could not be merged into this session's notes."_; the echo of `sessionId`). Params `{ sessionId: number }`; response `{ sessionId: number; lorebookId: number }`. Update the file's header comment. `registerOwnBookHandlers` registers the new handler only.
2. **Types and gates (minimal hunks in shared files — the CloneWithChanges entries only):** `src/lib/shared/sockets/types.ts` `Sockets.Sessions.CloneWithChanges` namespace (~7620) → `FoldInParent` (Params/Response as above, one JSDoc sentence each); `src/lib/client/sockets/typedSocket.ts` `"sessions:cloneWithChanges"` + `:error` (~1940–1956) → `"sessions:foldInParent"` + `:error` (and its comment); `src/lib/shared/sockets/interest.ts` (~656–659) the event name and comment; `src/lib/shared/sockets/gatedEvents.test.ts` (~322) the expected name. Another lane owns the `Sockets.Characters` namespace and the `characters:*` entries of those files — touch nothing else there.
3. **Doors** where Clone with changes lived, same position, the owner only, only when the session reads an attached book:
   - `src/lib/client/components/sessionForms/SessionViewPanel.svelte` ~319–330: label `FOLD_LABEL(shareBookName)`, an icon from the existing set that reads as merge/combine (look at the `Icons` module; e.g. a merge or `BookDown`-like icon — pick an existing one, don't add an icon), `ask(FOLD_CONFIRM(book), FOLD_LABEL(book), () => socket.emit("sessions:foldInParent", { sessionId }))`.
   - `src/lib/client/lorebooks/LorebooksWorkspace.svelte` `shareItemsFor` ~1469–1482 (menu item only): the same with `row.attached.name`. Update the JSDoc at ~1430 ("the drop-down's two with one") if wording needs it.
   - The `ask(sentence, label, go)` dialogs take the sentence as the description and the label as the confirm button — reuse them as they are.
   - Who listens to the reply: check how the client handled `sessions:cloneWithChanges` replies/errors (Layout's central listeners, `HANDLED_ERROR_EVENTS`, any domain context). The socket rule (CLAUDE.md): _"one domain context per event family … is the only listener, and the only place that toasts; views register listeners for local state and never call `toaster`."_ Mirror whatever existed for the clone exactly; add nothing new unless the clone had it.
4. **Remove Clone with changes everywhere** in the same change: `cloneWithChanges` and its private helper `carryNotesValuesToCopy` in `src/lib/server/lorebooks/ownBook.ts` (~1104–1446; check each private helper it alone used — e.g. `dropTurnTiesOfPlaces` is also used by `applyOverlayItems`, keep what others use; remove imports left unused); `src/lib/server/lorebooks/cloneWithChanges.int.test.ts` (delete the file — its behaviour is replaced by the fold's tests); `SHARE_LABELS.cloneWithChanges`, `SHARE_CONFIRMS.cloneWithChanges` and the header comment's R-p clause in `sessionNotes.ts` (keep the quoted ruling text but note Clone with changes is replaced by Merge per ★B-2 — plain words, no history phrasing like "was"/"used to"); `SHARE_REFUSALS.noBook` if nothing else throws it after removal (grep; ★bk-lock-1). After you finish, `grep -rni "clone ?with ?changes\|cloneWithChanges" src docs` must find nothing outside `docs/release-notes/` (release notes are history — leave them).
5. **The overlay line:** `BOOK_LOCK_LINES.overlay(book)` in `sessionNotes.ts` → exactly _"This session reads ${book} and keeps it. Share its notes to ${book}, or merge ${book} into its notes to make the story its own."_ Grep tests that assert the old sentence (`EditSessionForm` DOM tests, `bookLock` tests) and update their expected text only.
6. **Docs** (your paragraphs only; plain user-facing words, the style of the surrounding text):
   - `docs/lorebooks.md` ~233–237 (Share verbs): "two verbs" stay two — **Share to ‹book›** and **Merge ‹book› into these notes** replacing the Clone bullet. Say: it asks the ruled sentence (quote `FOLD_CONFIRM` with ‹book›); everything in ‹book› — every line, its dates, calendar and clock, entries, cast, places and values — is copied into the session's notes, the session's own changes stay on top, and from then on the session reads only its notes, on the same line and at the same date it was reading; ‹book› itself is not changed (only this session's captured scenes move with it); merging ends **Forward**; a session merges once; if the session would read anything differently afterwards, nothing is merged and it says so. To build on the merged story in other sessions afterwards, **Share as a lorebook**. Keep it to one bullet of similar length to the old one.
   - `docs/sessions.md` ~480: the quoted overlay line gets the merge sentence (match `BOOK_LOCK_LINES.overlay`); add one short sentence there pointing to the merge: _"…or **Merge ‹book› into these notes** to make the story the session's own (see [Bringing a session's changes into the lorebook](./lorebooks.md#bringing-a-sessions-changes-into-the-lorebook))."_ Check the anchor exists. Nothing else in sessions.md.

## Tests (Done means)

- DOM: extend `src/lib/client/components/sessionForms/sessionViewPanelHeader.dom.test.svelte.ts` (or a new `sessionViewPanel.fold.dom.test.svelte.ts` beside it) — owner + attached book: the ⋯ menu shows **Merge ‹book› into these notes**, choosing it asks `FOLD_CONFIRM(book)`, confirming emits `sessions:foldInParent` with `{ sessionId }`; no menu item contains "Clone"; own-notes session (no attached book): no Merge item; a non-owner: no Merge item. Same three checks for the Session notes row menu in `LorebooksWorkspace` (extend `lorebooksWorkspace.noReadingVerbs.dom.test.ts` or add one beside it). Follow the existing DOM test setup in those files exactly (mocked socket, happy-dom).
- Server: `src/lib/server/sockets/ownBooks.fold.int.test.ts` (new): the handler with `foldInParent` mocked (`vi.mock("$lib/server/lorebooks/foldInParent", …)`) — owner gets the reply + one `success` emit with `FOLD_DONE(name)`; non-owner refused with `FOLD_REFUSALS.notOwner` on `sessions:foldInParent:error`; an `OwnBookRefusal` from the function reaches `:error` with its sentence. Model it on an existing socket int test (grep for one that calls a `refusable` handler directly).
- `src/lib/shared/sockets/gatedEvents.test.ts` green; any test asserting `BOOK_LOCK_LINES.overlay` green.
- tsc + `npm run check` (svelte-check): no new errors except the missing `foldInParent` module while w3 is unfinished (say so).

## Files owned

`src/lib/server/sockets/ownBooks.ts`; `src/lib/server/lorebooks/ownBook.ts` (clone removal only — another worker edited `sessionEntriesAsRead` there earlier today; leave it); `src/lib/server/lorebooks/cloneWithChanges.int.test.ts` (delete); `src/lib/shared/lorebooks/sessionNotes.ts` (clone constants, `noBook`, the overlay line, header comment); `src/lib/shared/sockets/types.ts`, `src/lib/client/sockets/typedSocket.ts`, `src/lib/shared/sockets/interest.ts`, `src/lib/shared/sockets/gatedEvents.test.ts` (the clone entry hunks only); `SessionViewPanel.svelte` and `LorebooksWorkspace.svelte` (the menu items only); `docs/lorebooks.md` and `docs/sessions.md` (the paragraphs named); the DOM and socket tests named; expected-text updates in tests asserting the old overlay line.

## Files readable

Everything. Useful: `STYLE-GUIDE.md` §copy rules (grep "copy" / "Sentence case"), the existing DOM tests named, `src/lib/server/sockets/refusable.ts`, `src/lib/client/components/Layout.svelte` (central `success` / `HANDLED_ERROR_EVENTS`).

## Out of scope

`foldInParent.ts` and every server step of the fold; `SHARE_REFUSALS.attached`'s wording (it still says "or with a copy of it" — the supervisor raises it with the owner; leave it); release notes; NOMENCLATURE (queue rows).

## Rules you must follow (quoted)

- CLAUDE.md: "`socket.off(event)` with no handler removes **every** listener app-wide; always pass the handler." · "`$state(new Set())` / `new Map()` is not reactive on mutation — use `SvelteSet` / `SvelteMap`." · "Browser code runs on plain-http LAN addresses and phones: no `crypto.randomUUID`, no `navigator.clipboard`." · Toasts only through the central path (`notify` / the `success` event), never `toaster` in a view. · "It is a **session**, never a *chat*."
- NOMENCLATURE R1: code says *fold* (`sessions:foldInParent`, `FoldInParent`), the UI says **Merge** (★B-2). R6 🚧 on new exported names; allowed new names: `sessions:foldInParent`, `Sockets.Sessions.FoldInParent`. Nothing else new.
- Comment style: plain present-tense sentences; no history comments ("previously", "used to", "was replaced by") — a ratchet test fails on them.

## Commands

- Tests, capped and logged (never pipe vitest into `head`):
  `systemd-run --user --scope -p MemoryMax=6G -p MemorySwapMax=0 --quiet bash -c 'export NODE_OPTIONS=--max-old-space-size=4096; cd /home/jody/github/serene-pub && npx vitest run <files> --maxWorkers=2 > /tmp/claude-1000/-home-jody-github-serene-pub/9382c94a-1330-4480-b65e-0cfdb1f75e97/scratchpad/s4-fold-w5-tests.log 2>&1; echo test-exit=$? >> /tmp/claude-1000/-home-jody-github-serene-pub/9382c94a-1330-4480-b65e-0cfdb1f75e97/scratchpad/s4-fold-w5-tests.log'` — DOM tests can be heavy: run them one file at a time.
- tsc then check, one after the other: `systemd-run --user --scope -p MemoryMax=12G -p MemorySwapMax=0 --quiet bash -c 'export NODE_OPTIONS=--max-old-space-size=8192; cd /home/jody/github/serene-pub && npx tsc --noEmit -p . > /tmp/claude-1000/-home-jody-github-serene-pub/9382c94a-1330-4480-b65e-0cfdb1f75e97/scratchpad/s4-fold-w5-tsc.log 2>&1; echo exit=$? >> /tmp/claude-1000/-home-jody-github-serene-pub/9382c94a-1330-4480-b65e-0cfdb1f75e97/scratchpad/s4-fold-w5-tsc.log'` and the same with `npm run check` → `s4-fold-w5-check.log`. Report errors in your files only.

## Verbatim rules

- *This is an implementation task. Answer any relayed status question in one line in your report, and still do all the work.*
- *Never run `git stash` in any form, including `--keep-index` or to probe prettier; it stashes every other lane's uncommitted work. Use `npx prettier --check <file>`.*
- *Never commit. Never `npm test` or `npm run build` at the SDK root. Delete only the `/tmp/serene-pub-vitest-*` dirs your own tests made, by name; never a glob over `/tmp/serene-pub-*`.*
- *Before any `sdk:build`, check `pgrep -af "vite dev"` for a serene-pub server. If one is up, don't build; report 'blocked on your dev server'.* (You need no `sdk:build`.)
- Prettier: run `npx prettier --check` on changed files, but only `--write` the lines you changed — never reformat a whole file you didn't otherwise edit (a whole-file `--write` re-sorts classes and reflows markup other work owns). If a file fails the check only on lines you didn't touch, leave it and say so.

## Report

Final message (no report file): changed/deleted files with hunk ranges; the icon chosen; the listener/toast path you mirrored; tests run with counts; tsc/check for your files; the final grep for clone wording (output); whether `noBook` was retired; deviations; **Noticed, not done**; NOMENCLATURE rows to queue (`sessions:foldInParent`, Merge ‹book› into these notes as the UI verb, Clone with changes and attach → §23 retired with the reason).
