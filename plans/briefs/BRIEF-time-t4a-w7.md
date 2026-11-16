# BRIEF — worker `time-t4a-w7` — edit history under each entry version (part 2)

Repo `/home/jody/github/serene-pub`. Supervisor: lane `time-t4a`. Report: your final message (under ~600
words): changed files, tests run with results, every label and sentence added, anything you could not do.

This is an implementation task. Answer any relayed status question in one line in your report, and still do all the work.

Never run `git stash` in any form, including `--keep-index` or to probe prettier; it stashes every other lane's uncommitted work. Use `npx prettier --check <file>`.

Never commit. Never `npm test` or `npm run build` at the SDK root. Delete only the `/tmp/serene-pub-vitest-*` dirs your own tests made, by name; never a glob over `/tmp/serene-pub-*`.

Before any `sdk:build`, check `pgrep -af "vite dev"` for a serene-pub server. If one is up, don't build; report 'blocked on your dev server'.

## Context and rulings

The entry form (`src/lib/client/lorebooks/EntryWorkspace.svelte`) draws a stored, non-History entry of a
lorebook that keeps a timeline with a **version rail** (`time/VersionRail.svelte`): versions in story order,
the selected one's fields beside it (wide) or a strip of chips above the fields (narrow, a container query
`@min-[36rem]/versions:` on the rail's own root). Owner, 2026-11-13: "It would be neat to be able to toggle off
undated history edits and then navigate the dated versions like a vertical timeline, adding new versions
before or after." The chosen screen (owner 2026-11-14, "Lets go with all your recommendations"):

```
Versions                 [Edits ▣]    | This version begins  Year 7
● From the beginning                  | Name      The Hill Chapel
    A stone chapel                    | …
  + Add a version here                |
● Year 7   Burned to a ruin  ◀        |
    You fixed a typo · 2 days ago · Restore
    ‹routine› added a sentence in ‹session› · 5 days ago · Restore
  + Add a version here                |
```

Narrow: "the edits of the shown version sit in a fold under the fields (*Edits to this version · 2 ·
Show*)". The brief's rules: the entry's **edit history** rows (`lore_redlines`) whose `amendmentId` is null sit
under *From the beginning*, the others under their version (the wire's `Sockets.RedlineView.amendmentId`;
`entries:redlines` already returns every row of the entry, so grouping is client-side — **no new request
kind**); the **Edits** toggle hides them all and is remembered per browser (`localStorage`, every access in
`try/catch`, the page works without it); **Restore** works as today; the separate Edit history fold under the
form goes when the rail shows at the wide width; it stays with the Timeline off, for History, and in the narrow
layout (scoped to the shown version there). Changes listed under **Elsewhere** (other lines') carry their edit
rows too. Deleting a version removes its edit history (the database cascades).

## Build

1. `src/lib/client/lorebooks/editHistory/EditHistory.svelte` (keep its subject handling: an entry, or a
   `characterVersionId` — another page uses that; its tests must pass unchanged). Add props:
   - `amendmentIds?: readonly (number | null)[]` — when given, only rows whose `amendmentId` is in it are
     drawn (null = the entry's own edits). The count reported through `onState` and the count in the clear
     question stay the **whole** subject's (the clear clears the whole entry).
   - `variant?: "fold" | "rows"` (default `fold`) — `rows` draws the rows alone (the same `<li>` markup, Restore
     and Show/Hide included), with no fold button, no version **Clear edit history…** button and no
     `ClearEditHistoryDialog`; nothing at all when there are no rows.
   - `foldLabel?: (count: number) => string` — the fold button's words, default `editHistoryFoldLabel`.
   Each instance still asks `entries:redlines` itself as today (a few asks of one cheap read is accepted);
   do not add an event.
2. `src/lib/client/lorebooks/time/entryVersions.ts`: `editsToVersionLabel(n)` = `` `Edits to this version · ${n}` ``
   (🚧) and `versionRedlineIds(v: EntryVersion): (number | null)[]` (beginning → `[null]`, dated → its rows'
   ids). Tests in `entryVersions.test.ts`.
3. `src/lib/client/lorebooks/time/VersionRail.svelte`: a prop `edits?: Snippet<[readonly (number | null)[]]>`.
   When given: under each version's rail item (the wide rail only, not the strip) render
   `edits(versionRedlineIds(v))`, and under each Elsewhere row (in both of its places) `edits([row.id])`; a
   toggle **Edits** at the rail's head (`btn-sm`, `aria-pressed`, `preset-pressed` while on per STYLE-GUIDE
   §2.4, `title` *Show the edit history under each version*), on by default, which hides every `edits` render
   while off; remembered under the key `serene.lore.versionEdits` in `localStorage` (`"off"` / absent), read
   once on mount and written on change, both in `try/catch`.
4. `src/lib/client/lorebooks/EntryWorkspace.svelte` (the `EditHistory` mount ~3004–3010, the rail mount and its
   `fields` snippet):
   - railed: pass `edits` to the rail as a snippet rendering `<EditHistory {lorebookId} entryId={…}
     amendmentIds={ids} variant="rows" updatedAt={…} />`;
   - railed: the existing whole-entry `EditHistory` (the one bound to `clearOpen` and `onState`, which the ⋯
     menu's **Clear edit history…** needs) moves into the rail's `children`, after the fields' fieldset, inside
     a wrapper hidden at the wide width (`@min-[36rem]/versions:hidden`), with
     `amendmentIds={versionRedlineIds(shownVersion)}` and `foldLabel={editsToVersionLabel}`;
   - not railed: exactly as today.

## Files owned

`editHistory/EditHistory.svelte`, `editHistory/editHistory.dom.test.svelte.ts` (add tests),
`time/entryVersions.ts`, `time/entryVersions.test.ts`, `time/VersionRail.svelte`,
`time/versionRail.dom.test.svelte.ts`, `EntryWorkspace.svelte`, `entryWorkspace.versions.dom.test.svelte.ts`.
Do not edit `editHistory/editHistoryCopy.ts` or any cast file.

## Rules (quoted from the canon; follow them)

- `$state(new Set())` / `new Map()` is not reactive on mutation: `SvelteSet` / `SvelteMap`.
- Sockets: views register listeners for local state only, always `socket.off(event, handler)` (a bare
  `socket.off(event)` removes every listener app-wide); never call `toaster`.
- Browser code runs on plain-http LAN addresses and phones: no `crypto.randomUUID`, no `navigator.clipboard`.
- Browser storage can be missing or throw: wrap every `localStorage` access in `try/catch`; the page works
  without it.
- STYLE-GUIDE §2.4: a pressed toggle is `preset-pressed` with `aria-pressed`. §9: real buttons with names;
  `aria-expanded` on anything that opens; nothing hover-only. §10: sentence case.
- Comments state the rule, not the story. No `prettier --write` on a directory or on a file you did not
  otherwise change. `NOMENCLATURE.md` R3: *entry version* in code/comments.

## Done means

Tests: `EditHistory` with `amendmentIds` draws only those rows, its `onState` count stays the whole list's;
`variant="rows"` draws rows with Restore and no fold button or dialog, nothing when empty; `foldLabel` words the
fold; the rail draws `edits` under each version with that version's ids (`[null]` for the beginning) and under an
Elsewhere row; **Edits** toggles them off and on, is `aria-pressed`, and survives a remount through
`localStorage` (and a throwing `localStorage` does not break the rail); in the entry form a row with
`amendmentId` null sits under *From the beginning* and one with a dated row's id under that version (fake the
`entries:redlines` reply); railed, the scoped fold under the fields reads *Edits to this version · ‹n›*; not
railed (Timeline off), the fold is as today. Run (one at a time; first check `ps -eo pid,args | grep -E
"node.*vitest" | grep -v grep` and wait while one runs; never pipe vitest into `head`):

```
systemd-run --user --scope -p MemoryMax=10G -p MemorySwapMax=0 --quiet bash -c "npx vitest run --maxWorkers=3 src/lib/client/lorebooks/editHistory/editHistory.dom.test.svelte.ts src/lib/client/lorebooks/editHistory/editHistoryVersion.dom.test.svelte.ts src/lib/client/lorebooks/editHistory/clearEditHistory.dom.test.svelte.ts src/lib/client/lorebooks/time/entryVersions.test.ts src/lib/client/lorebooks/time/versionRail.dom.test.svelte.ts src/lib/client/lorebooks/entryWorkspace.versions.dom.test.svelte.ts src/lib/client/lorebooks/entryWorkspace.timeline.dom.test.svelte.ts src/lib/client/lorebooks/entryWorkspace.beginning.dom.test.svelte.ts > plans/time-t4a-w7.log 2>&1"
```

All pass; `NODE_OPTIONS=--max-old-space-size=10240 npx tsc --noEmit -p . 2>&1 | grep "error TS"` shows nothing in
your files (report the count).
