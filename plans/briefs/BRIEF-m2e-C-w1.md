# BRIEF m2e-C-w1 — provided books are disabled, never deleted (★34 client half) + `navigation.ts` shared refusal

Worker for lane **m2e-C** (client + docs) of build M2e, Serene Pub (`/home/jody/github/serene-pub`). Supervisor reads your report.
RULED by the owner on 2026-11-04; build it, do not re-open it.

This is an implementation task. Answer any relayed status question in one line in your report, and still do all the work.

## The ruling (quoted)
- ★34: _"immutable lorebook starters (from core, plugin, etc.) can only be disabled, not deleted"_, disabled = **hidden everywhere, kept intact**:
  leaves the Lorebooks list, pickers and attach menus; rows stay; the plugin page (and the admin Starter lorebooks page for core's) lists it
  with an Enable switch; Delete is removed from provided/starter books.
- ★M2e-1: _"Primers too, as rows."_ Core's primers are imported as immutable lorebook rows; _Start from a starter lorebook_ reads those rows;
  a person's start is still a **clone** (theirs, deletable).
- **Admin starter kits** (`lorebooks` rows of kind `starter_kit` made by an admin, `source: "admin"`) are NOT immutable (ruling 2026-10-21:
  clone and edit): **Delete starter lorebook stays**, touch nothing of theirs.
- **Only the server hides** a disabled book (one decider). The client never filters disabled books out itself; it draws what it is sent and must
  not keep a stale copy showing. A session already reading a disabled book keeps reading it; its session page shows the book as before.

## The contract (lane D, `plans/REPORT-m2e-D-2026-11-04.md` §1 — read §1 yourself first; it may have been updated)
- Lorebook rows (`lorebooks:list` row and `lorebooks:get`'s lorebook) gain `provided?: { disabled: boolean }` — present exactly when the book is a
  provided book (a plugin's provided book or a core/plugin primer row). A disabled book is not in `lorebooks:list` at all.
  **Hide Delete wherever `provided` is present.** The server refuses `lorebooks:delete` on one with: _"A lorebook that comes with the pub or a plugin can't be deleted; an administrator can disable it to hide it everywhere."_
- `Sockets.Plugins.ProvidedBook` gains `disabled: boolean`; `state` loses `"dismissed"` (now `"imported" | "held" | "pending" | "waiting" | "failed"`).
- Events (admin only): `plugins:disableProvidedBook` and `plugins:enableProvidedBook`, params `{ pluginId: string; slug: string }`
  (`pluginId: "core"` names core's primers; a primer's `slug` is its primer id, e.g. `core:primer/ninth-mile@1`); response
  `{ pluginId; slug; disabled: boolean; lorebookId: number | null }`; error `{ error: string }` on `<event>:error`. After it the server re-sends
  `plugins:list` (plugin books) or `starterKits:list` (core primers) to the asker, and `lorebooks:list` to the book's owner.
- `starterKits:list`: shipped kits now list as their rows — `id: "book:<lorebookId>"`, `source: "core" | "plugin"`, new
  `provided?: { pluginId: string; slug: string; disabled: boolean }` on primer rows only (admin kits have none). Params gain
  `includeDisabled?: boolean` (honoured for admins only). `starterKits:delete` refuses a primer row.
- `src/lib/shared/sessions/declaredFieldRefusal.ts` exports `declaredFieldRefusal(fields: unknown, declared: readonly string[] | null, genreId: string): string | null`.
**These types may not be in `src/lib/shared/sockets/types.ts` yet (lane D's file — you must NOT edit it).** Check with grep. Where a field or event
is missing, read it through ONE narrow local type per file with a `// ⏳ until lane D's contract lands (REPORT-m2e-D §1)` comment; where it has
landed, use the real type. If the client's typed socket map (`src/lib/client/sockets/typedSocket.ts`, a client file you may edit) needs the two
new events declared, add them there in the existing pattern, reading the shared types once they exist (or a ⏳ local shape).

## Goal — what to build
1. **Delete disappears from a provided book everywhere it is offered.** Find every place (grep `lorebooks:delete`, `onDelete`, `Delete “`, the
   Lorebooks list row `⋯` menu, `src/lib/client/lorebooks/LorebookActions.svelte`, `src/lib/client/lorebooks/BookSettings.svelte` ~296–400 danger zone,
   `src/lib/client/lorebooks/libraryRows.ts`, any detail page). When the row/book carries `provided`, no Delete is drawn and nothing replaces it on the
   book itself. Admin starter kits (`isStarterKit`, `starterKits:delete`, "Delete starter lorebook") stay exactly as they are — unless the same row is
   ALSO `provided` (a core primer row is kind `starter_kit` with `provided`): then no Delete either. Trace how `isStarterKit` is set and make sure a
   primer row does not offer "Delete starter lorebook".
2. **Plugin page** `src/lib/client/admin/sections/plugins/IdPage.svelte` (~485–505, _Lorebooks it provides_): one switch per book. This page is a
   **change form**, so STYLE-GUIDE §6.11 applies (quoted below): the switch **waits for Save** — it joins the existing save sequence (`saveInSequence`
   steps, `awaitReply` on `plugins:disableProvidedBook` / `plugins:enableProvidedBook` and their `:error`, ~330–360), counts as an unsaved edit, and
   Save re-reads `plugins:list` as today. The switch: a native `<input type="checkbox" role="switch">` (checked = enabled), named by the book
   (`aria-label="Enabled: ‹name›"` or a visible label), its purpose as `title`: _Hide this book everywhere without deleting it_ when on,
   _Show this book again_ when off; the visible word beside it _Enabled_ / _Disabled_ (never colour alone). A disabled book reads _Disabled_ in that
   list and nowhere else. Drop the `dismissed` state handling (it no longer arrives); keep `why`.
3. **Admin Starter lorebooks page** `src/lib/client/admin/sections/starter-kits/Page.svelte`: a **changelist** (no change form, no Save), so a primer
   row's switch acts when pressed (a one-shot act). Ask `starterKits:list` with `{ includeDisabled: true }`; rows with `provided` get the same switch
   (same name/title/word rules), emitting the event with `pluginId: row.provided.pluginId, slug: row.provided.slug`; the list re-reads from the
   server's re-send (heard through the page's declared interest — `starterKits:` is a gated family; follow the page's `interest.declareInterest`
   pattern for the two new events and their `:error`). No success toast (the switch shows it); a refusal follows the page's existing error pattern.
   Primer rows: no Delete (they have none today — keep it so); Clone stays. Admin kits unchanged.
4. **_Start from a starter lorebook_ picker** (`src/lib/client/components/lorebookForms/StarterKitPicker.svelte`, `NewLorebookDialog.svelte`,
   `StartSessionForm.svelte`, `src/lib/client/lorebooks/starterKitCards.ts`): reads the rows lane D sends (`id: "book:<id>"` for shipped kits now).
   Check nothing on the client assumes a shipped kit's id is `primer:<id>` or filters on it; the clone path is unchanged. Change only what the new
   ids break; say so if nothing.
5. **Stale copies.** Find every client store/component that caches `lorebooks:list` (`LorebooksWorkspace.svelte`, `EditSessionForm.svelte`,
   `StartSessionForm.svelte`, `SummarizeLoreModal.svelte`, `CharacterForm.svelte`, attach-lorebook menus) and confirm each re-reads on the server's
   re-send or on open, so a book disabled by the admin leaves them. Report file:line per reader. Do not add client-side filtering of disabled books.
   If one keeps a copy that never refreshes, make the smallest change so it listens for `lorebooks:list` (with the handler on `socket.off`).
6. **`navigation.ts`** (`src/lib/client/components/sessionPage/requests/navigation.ts` ~164): if `src/lib/shared/sessions/declaredFieldRefusal.ts`
   exists, replace the mirrored refusal sentence with one import of `declaredFieldRefusal`; check again at the end of your work. If it never lands,
   change nothing and say so.

## Files owned (only these may be edited)
`src/lib/client/lorebooks/LorebookActions.svelte`, `BookSettings.svelte`, `libraryRows.ts` and the Lorebooks list row component(s) that offer Delete,
`src/lib/client/admin/sections/plugins/IdPage.svelte`, `src/lib/client/admin/sections/starter-kits/Page.svelte`,
`src/lib/client/components/lorebookForms/*`, `src/lib/client/lorebooks/starterKitCards.ts`, `src/lib/client/sockets/typedSocket.ts`,
`src/lib/client/components/sessionPage/requests/navigation.ts`, a lorebooks:list reader only if item 5 needs it, and the tests of these files.
**Do not edit** `src/lib/client/lorebooks/LorebooksWorkspace.svelte`'s rules-list code, `LoreRail.svelte`, `scopes.ts`, `sections/**`
(another worker just changed them) — if `LorebooksWorkspace.svelte` needs a Delete change, touch only the Delete lines.
## Files readable
Everything. **Never edit** `src/lib/server/**`, `src/lib/shared/**`, `../serene-pub-sdk/**`, `NOMENCLATURE.md`, `STYLE-GUIDE.md`, `docs/**`. Queue anything needed there.
## Out of scope — never built
No setting; no "detach from sessions" on disable; no change to admin starter kits (Delete stays); no client-side hiding of disabled books; no
restyle beyond the items; no new admin page; no pause state.

## Rules you carry
- CLAUDE.md Decisions: decide implementation inside the asked scope, name each choice in your report; anything a user sees beyond what is written
  here, or a new name/setting/flag/event — propose it marked ★, don't invent it. Say each assumption. Findings go under **Noticed, not done**.
- P4 _Power controls are purposeful_: each control with one sentence of purpose. P1: every automatic action shows its cause — not relevant beyond the purpose `title`.
- Standing ruling: **Members never see or touch model plumbing**; the switches are admin only (the server refuses others).
- NOMENCLATURE §1: R1 one word, one meaning · R2 distinctive words · R3 qualify, never the bare noun · R6 mark ⏳ transitional / 🚧 provisional.
  The ruled word is **disabled** (a provided book: hidden everywhere, kept intact — NOT deleted, NOT the lore write mode _Off_, NOT an admin starter
  kit which stays deletable). It is a **session**, never a *chat*. List every new identifier in your report with what it is / is not.
- STYLE-GUIDE §6.11 (verbatim): "**Every switch, tick and approval on a change form waits for Save** (owner ruling 2026-10-02) … Where the server takes
  one setting per write, Save sends the difference as single writes in order (`client/admin/sequentialSave.ts`, each an `awaitReply` on that verb's
  answer or its `:error`), waits for every answer, and only then says _Saved_; a refusal is named in the error summary … and stays an unsaved edit." ·
  "One-shot acts with their own button (Duplicate, Unload, …, Delete) still act when pressed." · "A read-only value is shown as words, never as a disabled tick."
- STYLE-GUIDE §6.17 (the switch pattern): "a native `role="switch"` checkbox named by the agent, with visible _On_/_Off_ beside it (never colour alone)".
- STYLE-GUIDE §11: "No toast for a change the control shows". §10: "Sentence case everywhere" · "Help is one sentence." · "A hint becomes the field's
  placeholder (what to type) or its `title` (what it is for)."
- STYLE-GUIDE §9: real `button`/`a`/input with an accessible name; 44px targets on touch (`min-h-11 pointer-fine:min-h-0` pattern); focus ring
  `outline-2 outline-primary-500 outline-offset-2`. Colour by role and stop, never a hex.
- Sockets: one domain context per event family is the only listener and the only place that toasts; views register listeners for local state and never call
  `toaster` for new things (the admin pages' existing interest/toast pattern may be followed, but add no new success toast). `socket.off(event)` always with
  the handler. Scoped events carry their scope key.
- Svelte 5 runes; `$state(new Set())`/`Map` not reactive on mutation — `SvelteSet`/`SvelteMap`. No `crypto.randomUUID`, no `navigator.clipboard`.
- Skeleton v5: before using a Skeleton component, `grep -n "^# <Name>" /home/jody/github/serene-pub/AI-TEMP/skeleton-llms-svelte.txt` then `sed -n` that section only. (A native checkbox switch needs none.)
- Read line ranges (`sed -n`), never a whole large file.
- Tests: only your targeted files, `npx vitest run <files>`. **Never pipe vitest into `head`.**
- Never run `git stash` in any form, including `--keep-index` or to probe prettier; it stashes every other lane's uncommitted work. Use `npx prettier --check <file>`.
- Never commit. Never `npm test` or `npm run build` at the SDK root. Delete only the `/tmp/serene-pub-vitest-*` dirs your own tests made, by name; never a glob over `/tmp/serene-pub-*`.
- Before any `sdk:build`, check `pgrep -af "vite dev"` for a serene-pub server. If one is up, don't build; report 'blocked on your dev server'. (You should not need one.)

## Stop and ask when
CLAUDE.md §Decisions applies; a contract shape in D's report differs from the above (build to D's, note it); you would need a file outside Files owned.

## Done means
Targeted tests green: existing tests of the files you touched (find them: `ls` beside each file — e.g. `deleteCopy.test.ts`, `libraryRows.test.ts`,
`starterKitCards.test.ts`, any `*.dom.test*` for `BookSettings`, `LorebookActions`, the plugin `IdPage`, the starter-kits `Page`, `navigation.test.ts`),
plus new cases: no Delete on a provided row/book (and still Delete on an admin kit); the plugin page switch is an unsaved edit that Save sends as the
event; the starter-kits page switch emits the event with `pluginId`/`slug`. Keep new DOM tests small. `npx prettier --check` on new files (report
pre-existing failures as such). The lead runs tsc / svelte-check / the full suite.

## Report
Write `plans/briefs/REPORT-m2e-C-w1.md`: per item — what changed (file:line), choices, every new name (what it is / is not), the stale-copy table
(reader → how it refreshes), tests with pass counts, ★ proposals, **Noticed, not done**, anything queued for lane D, and which contract pieces you read
through ⏳ local types because they had not landed.
