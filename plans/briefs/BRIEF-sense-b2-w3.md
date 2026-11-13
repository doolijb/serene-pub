# BRIEF — lane `sense-b2`, worker w3 — the "This session only" card: Apply follows `mayApply`, what was applied, Take back, and the sentence that says it applies by itself

You are a `lane-worker` under the `sense-b2` supervisor, in `/home/jody/github/serene-pub`. You build the client
half only. The server half is being built at the same time by other workers; the wire types are already written
and are your contract.

## Verbatim rules (bind you word for word)

- "This is an implementation task. Answer any relayed status question in one line in your report, and still do all the work."
- "Never run `git stash` in any form, including `--keep-index` or to probe prettier; it stashes every other lane's uncommitted work. Use `npx prettier --check <file>`."
- "Never commit. Never `npm test` or `npm run build` at the SDK root. Delete only the `/tmp/serene-pub-vitest-*` dirs your own tests made, by name; never a glob over `/tmp/serene-pub-*`."
- "Before any `sdk:build`, check `pgrep -af "vite dev"` for a serene-pub server. If one is up, don't build; report 'blocked on your dev server'." (You need none.)
- Never `git checkout` / `restore` / `stash`. Never `kill -9`. Never `prettier --write` a directory. Do not start a dev server.
- Svelte 5 runes. `$state(new Set())` / `new Map()` are not reactive on mutation: use `SvelteSet` / `SvelteMap` (`svelte/reactivity`). Browser code runs on plain-http LAN addresses and phones: no `crypto.randomUUID`, no `navigator.clipboard`. Listen only through `declareInterest` / `requestWithInterest` (`$lib/client/sockets/interest.svelte`) and always call the release they return; never `socket.on` / `socket.off`. **Views never toast**: this card never calls `notify` / `toaster`.
- It is a **session**, never a *chat*. Every session has a lorebook: never write "no lorebook". No reference to any other project or product.
- Tests only like this, never the whole suite, never piped into `head`: `systemd-run --user --scope -p MemoryMax=10G -p MemorySwapMax=0 --quiet bash -c "npx vitest run --maxWorkers=3 <files>"`. A DOM test that fails an `assert` on a happy-dom element has OOM-killed the editor: keep assertions on strings and `querySelector` results. svelte-check: `NODE_OPTIONS=--max-old-space-size=12288 npm run check` (report only errors in your files; other sessions are editing). `npx prettier --check <file>` on each file you changed.
- Do what is asked, at the size asked. Findings go under **Noticed, not done**.

## Files owned

- `src/lib/client/components/sessionForms/SessionViewPanel.svelte`
- New test `src/lib/client/components/sessionForms/sessionViewPanel.applied.dom.test.svelte.ts`
- `src/lib/client/components/sidebars/SessionsSidebar.svelte` — **only if** the card cannot follow `mayApply` without it (it should not need a change: it passes `isOwner`, the *session's* owner, which stays the gate for the ⋯ menu's verbs). Say in the report whether you touched it.

Not yours: `src/lib/shared/sockets/types.ts`, `src/lib/client/sockets/typedSocket.ts`, `src/lib/shared/sockets/interest.ts` (the supervisor already added the two new events there), `src/lib/client/contexts/sessionOutcomes.svelte.ts`, anything server-side.

## Files readable

`SessionViewPanel.svelte` 140–180 (the overlay effect, `applyOverlay`, `shortValue`) and 540–600 (the card);
`src/lib/shared/sockets/types.ts` — `Sockets.Sessions.OverlayItems` (now with `mayApply`, `appliesItself`),
`Sockets.Sessions.AppliedBatches`, `Sockets.Sessions.TakeBackApply` (grep `namespace AppliedBatches`);
`src/lib/client/lorebooks/cast/CastDuplicatesPanel.svelte` 225–265 (the merge log's list-with-Undo pattern you
reuse: a fold toggle with `aria-expanded`, rows with a quiet text-link action); `src/lib/client/utils/timeAgo.ts`;
`src/lib/client/components/sidebars/SessionsSidebar.svelte` 480–487 (`handleViewLorebook`: how a deep link opens the
Lorebooks panel through `panelsCtx.digest.lore`); `src/lib/shared/lorebooks/loreRoute.ts` 120–160 (`LoreRoute`:
`settings: true` opens Book settings, where the **Writes from sessions to this book** picker is —
`src/lib/client/lorebooks/BookWritesCard.svelte`); `sessionViewPanel.fold.dom.test.svelte.ts` (how the panel's
DOM tests mock the socket and the interest registry). STYLE-GUIDE.md §6.1 (buttons), §6.4 (cards and rows, as far
as this card goes), §6.21 (toasts: none for a change the control shows), §9 (accessibility), §10 (writing).

## The wire (already typed)

- `sessions:overlayItems` (request `{ sessionId }`; also pushed by the server to every member after any Apply or
  take-back, pressed or automatic): `{ sessionId, items, mayApply, appliesItself }`.
- `sessions:appliedBatches` (request `{ sessionId }`; pushed the same way): `{ sessionId, batches, mayApply }`, each
  batch `{ batch, at, by, automatic, sceneId, count, items }`, newest first.
- `sessions:takeBackApply` (request `{ sessionId, batch }`): `{ sessionId, batch, refused }` — `refused` is the
  sentence when it could not be taken back, null when it was; the fresh lists arrive by the push.
- Both list events are scoped by `sessionId`: declare the bare key and drop payloads whose `sessionId` is not this
  panel's session (as the overlay effect already does).

## Build

1. **One access rule.** Every member reads both lists. The card's Apply buttons (per item and **Apply all to the
   lorebook**) and **Take back** show only when the latest payload's `mayApply` is true — never on `isOwner`. The ⋯
   menu stays as it is.
2. **The card shows** when the session reads a lorebook and either list has something:
   `lorebookId != null && (overlayItems.length > 0 || batches.length > 0)`. The existing first list is unchanged
   apart from the gate.
3. **What was applied** — a second list in the same card, below the first: a small heading, then one row per batch,
   newest first. A row says how many changes, why, and when, e.g. `2 changes · as a scene closed · 5 minutes ago`;
   a press says `by ‹name›`. It folds open (a real `button` with `aria-expanded`) to its items: a new entry as
   `‹title› · new entry`; a held change as its title and one line per change `‹Label›: ‹before› → ‹after›` (reuse
   `shortValue`). Each row has **Take back** (a quiet text link, the merge log's Undo style, when `mayApply`); a
   press disables it until the answer comes; a refusal shows its sentence in place under that row (muted 12px),
   kept until the next press on that row or until that batch leaves the list. Track open rows and refusals with
   `SvelteSet` / `SvelteMap` keyed by `batch`.
4. **Applies by itself (P1: say it, and how to switch it off).** When the latest overlay payload's `appliesItself`
   is true, one muted sentence at the top of the card; when `mayApply` is also true, a quiet text link after it to
   the picker, which opens the lorebook's Book settings: set `panelsCtx.digest.lore = { lorebookId, scope: "all",
   settings: true }` and `panelsCtx.openPanel({ key: "lorebooks", toggle: false })` (get `panelsCtx` with
   `getContext("panelsCtx")`, as SessionsSidebar does; if the panel has no such context in a test, the link is
   simply not shown).
5. Request both lists on mount and whenever `sessionId` changes (one `$effect` per list, each returning its
   releases); declare `sessions:takeBackApply` for the refusal.

## Copy — 🚧 provisional, use exactly these strings and list them in your report

- Heading of the second list: `Applied to the lorebook` (its `section`/`ul` `aria-label`: `Applied to the lorebook from this session`).
- Count: `1 change` / `‹n› changes`.
- Cause: `by ‹name›` · `as a scene closed` (`scene-close`) · `when a scene's summary was saved` (`scene-summary`) · `at Close out` (`close-out`).
- When: `timeAgo(at)` from `$lib/client/utils/timeAgo` (whatever it returns).
- Row parts joined with ` · `.
- New entry item: `‹title› · new entry` (title fallback `Untitled entry`, as the first list).
- Action: `Take back`; its `aria-label`: `Take back these ‹n› change(s)` → write `Take back this change` for 1, `Take back these ‹n› changes` otherwise.
- Fold toggle `aria-label`: `Show what was applied` / `Hide what was applied`.
- Applies by itself: `The lorebook takes this session's changes by itself as each scene closes.`
- Link to the picker: `Writes from sessions to this book`.

## Done means

New `sessionViewPanel.applied.dom.test.svelte.ts` (mock the socket and the interest registry as the fold test
does): Apply buttons show for `mayApply: true` and not for `mayApply: false` even when `isOwner` is true, and show
for `mayApply: true` with `isOwner: false`; the applied list renders a batch's count, cause and items after the
toggle; **Take back** emits `sessions:takeBackApply` with `{ sessionId, batch }` and is absent without `mayApply`;
a `refused` answer shows its sentence under its row; the applies-by-itself sentence shows only with
`appliesItself`, its link only with `mayApply` too; a payload for another session is ignored. Run it and
`sessionViewPanel.fold.dom.test.svelte.ts` and `sessionViewPanelHeader.dom.test.svelte.ts`, capped. svelte-check
shows no error in your files. Prettier check each changed file.

## Stop and ask (in your report) when

The card needs a field the wire does not carry; you would need to edit a file not listed; a string above does not
fit (say why, propose one). Do not decide those.

## Report

Your final message: changed files; decisions inside scope; every string verbatim; tests run with counts; svelte-check
result for your files; **Noticed, not done**.
