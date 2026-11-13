# BRIEF — worker `sense-b3-w5` — the overlay list's new items on the wire and on the session card

Supervisor: lane `sense-b3`. Repo: /home/jody/github/serene-pub. Use absolute paths. Your report is your final message
to the supervisor (no report file).

## Verbatim rules (binding)

- "This is an implementation task. Answer any relayed status question in one line in your report, and still do all the work."
- "Never run `git stash` in any form, including `--keep-index` or to probe prettier; it stashes every other lane's uncommitted work. Use `npx prettier --check <file>`."
- "Never commit. Never `npm test` or `npm run build` at the SDK root. Delete only the `/tmp/serene-pub-vitest-*` dirs your own tests made, by name; never a glob over `/tmp/serene-pub-*`."
- "Before any `sdk:build`, check `pgrep -af "vite dev"` for a serene-pub server. If one is up, don't build; report 'blocked on your dev server'." (You have no reason to run `sdk:build`.)
- Never `prettier --write` on a directory. Never `git checkout` / `restore` / `stash`. Never `kill -9` anything.
- Sockets: one domain context per event family is the only listener and the only place that toasts; views register
  listeners for local state and **never call `toaster`**. `socket.off(event)` always with its handler.
  `$state(new Set())` / `new Map()` are not reactive on mutation: use `SvelteSet` / `SvelteMap`. Browser code runs on
  plain-http LAN addresses and phones: no `crypto.randomUUID`, no `navigator.clipboard`. No new socket event.
- It is a **session**, never a *chat*. Every session has a lorebook. No reference to any other project or product.
- Tests only in a capped scope: `systemd-run --user --scope -p MemoryMax=10G -p MemorySwapMax=0 --quiet bash -c "npx vitest run --maxWorkers=3 <files>"`.
  Never the whole suite, never piped into `head`. A failing assert on a happy-dom element has OOM-killed the editor:
  keep DOM tests small. `npx prettier --check <file>` on what you add. Typecheck
  `NODE_OPTIONS=--max-old-space-size=10240 npx tsc --noEmit -p .`; svelte-check
  `NODE_OPTIONS=--max-old-space-size=12288 npm run check` (report only errors in your files). No dev server.
- Do what is asked, at the size asked. Findings go under **Noticed, not done**.
- STYLE-GUIDE (quoted): "**Sentence case, plain verbs.** Labels are sentence case. Buttons say what happens."
  "**Cards, not separators.**" "**One loud thing per region**… Status, filters, selection, links and names are surface
  or ink." "Help text is one sentence per card; a label is written once." Use the card's **existing layout and
  classes** (the "This session only" card in `SessionViewPanel.svelte` ~638–770); no new layout.
- Every sentence a person sees that you add is provisional 🚧: list it verbatim in your report.

## What exists (built by other workers of this lane; read `src/lib/server/lorebooks/ownBook.ts`)

`overlayItemsOf` now returns three item kinds (all additive):
```ts
interface OverlayEntryChangeItem {
  kind: "entry-change"
  amendmentId?: number      // absent on a held paragraph; every held-change item still carries it
  notesEntryId?: number     // 🚧 the own-book day that carries a held paragraph (Apply selects it through `entryIds`)
  entryId: number           // for a paragraph: the LOREBOOK's day
  typeId: string; title: string; sourceMessageId: number | null
  changes: { field: string; label: string; before: unknown; after: unknown }[]
  conflict: string | null
}
interface OverlayLinkItem {
  kind: "link"; linkId: number
  entryId: number           // the from-end entry, else the to-end entry
  typeId: string
  title: string             // "‹From› ‹wording› ‹To›"
  sourceMessageId: number | null
}
```
`applyOverlayItems` input gains `linkIds?: readonly number[] | null` (all three lists absent → everything; any given →
only those). `ApplyOverlayResult` gains `appliedLinks: number[]`, `mergedDays: number[]`, `droppedLinks: number[]`,
`heldDays: { notesEntryId: number; reason: string }[]`. `appliedBatchesOf` items gain a kind `link`:
`{ kind: "link", linkId: number, entryId: number, title: string }`; a merged day is an `entry-change` item. `tsc` today
reports two errors in `sockets/sessions.ts` (~8133, ~8266) because the shared `Item` type has no `link` kind.

## Files owned (edit only these)

- `src/lib/shared/sockets/types.ts` — `Sockets.Sessions.OverlayItems.Item`, `AppliedBatches.Item`, `ApplyOverlay.Params`
  and `.Response`: **additive** fields only (`kind` gains `"link"`; `linkId?`, `notesEntryId?`; `linkIds?`;
  `appliedLinks?`, `mergedDays?`, `droppedLinks?`, `heldDays?`), each with a one-line comment.
- `src/lib/server/sockets/sessions.ts` — `sessionsApplyOverlayHandler` (~8140–8180) passes `linkIds` (filtered as the
  other lists are) and returns the new result fields; the two type errors resolved (no cast needed once the shared type
  is right; remove any `as unknown as` cast `ownBook.ts` needed only if it is in a file you own — it is not: leave
  `ownBook.ts` alone and report whether its cast is still needed).
- `src/lib/client/components/sessionForms/SessionViewPanel.svelte` — the "This session only" card and the applied list.
- New DOM test: `src/lib/client/components/sessionForms/sessionViewPanel.ownBookItems.dom.test.svelte.ts` (copy the setup
  of `sessionViewPanel.applied.dom.test.svelte.ts`).

## What to build

1. **The card lists a link item** like any item: its `title` (the server composes "‹From› ‹wording› ‹To›") as the
   row's text, and — for the lorebook's owner (`mayApply`) — the same **Apply to the lorebook** button, which sends
   `linkIds: [item.linkId]`. `applyOverlay` gains a third optional list. The each-block key must stay unique across kinds:
   `${item.kind ?? "entry"}:${item.amendmentId ?? item.linkId ?? item.notesEntryId ?? item.entryId}`.
2. **A held paragraph** (`entry-change` with `notesEntryId`) renders as the entry change it is (title, `‹Label›: ‹before›
   → ‹after›` through the existing `shortValue`), and its Apply button sends `entryIds: [item.notesEntryId]`.
   An `entry-change` with `amendmentId` is unchanged.
3. **Apply all to the lorebook** still sends no lists (everything).
4. **The applied list**: a `link` item reads `‹title› · link` (🚧), beside the existing `‹title› · new entry`.
5. No toast anywhere; nothing else on the card changes.

## Tests

DOM (small): a link item renders its title and its Apply sends `{ sessionId, linkIds: [id] }`; a paragraph item renders
its change line and its Apply sends `{ sessionId, entryIds: [notesEntryId] }`; a held change still sends
`amendmentIds`; the applied list shows `‹title› · link`; a non-owner sees no Apply button. Run unchanged:
`sessionViewPanel.applied.dom.test.svelte.ts`, `sessionViewPanel.fold.dom.test.svelte.ts`,
`sessionViewPanelHeader.dom.test.svelte.ts`, and `src/lib/server/sockets/sessions.applyLists.int.test.ts`. A socket-level
check that `linkIds` reaches `applyOverlayItems`: add one case to a new file
`src/lib/server/sockets/sessions.applyOverlayLinks.int.test.ts` if `sessions.applyLists.int.test.ts` shows how to drive
the handler; otherwise say so.

## Stop and report when

A new socket event, a new client context, or a change to a shared type that is not additive seems needed; an existing
test would have to change; a file outside the list is needed.

## Report (your final message)

Changed files; the exact type additions; every 🚧 string; tests with pass/fail counts; `tsc` and `npm run check` for
your files; whether `ownBook.ts`'s cast is still needed; Noticed, not done.
