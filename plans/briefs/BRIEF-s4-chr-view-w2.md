# BRIEF — lane `s4-chr-view`, worker w2 — the `characters:page` context, typed events, and the rename to **Characters** (2026-11-08)

Supervisor: lane `s4-chr-view` (brief `plans/briefs/BRIEF-s4-chr-view.md`). Repo `/home/jody/github/serene-pub`. Use absolute paths.

## Goal

### A. Typed socket entries
In `src/lib/client/sockets/typedSocket.ts` (`SocketEventMap`), add two entries next to the other `characters:*` entries (find `"characters:duplicate"` ~line 5375 for the style):
- `"characters:page"`: `params: Sockets.Characters.Page.Params`, `response: Sockets.Characters.Page.Response`
- `"characters:page:error"`: `params: Sockets.Characters.Page.ErrorResponse`, `response: Sockets.Characters.Page.ErrorResponse`
(The namespace already exists in `src/lib/shared/sockets/types.ts` ~18114.) Touch nothing else in that file.

### B. A new domain context — the one listener for `characters:page` and `characters:page:error`
New file `src/lib/client/contexts/characterRows.svelte.ts`, modelled line for line on `src/lib/client/contexts/characterImports.svelte.ts` (read it whole, 199 lines, and its test `characterImports.dom.test.svelte.ts`). Names (decided by the supervisor; all 🚧):
- `CHARACTER_ROWS_CONTEXT = "characterRowsCtx"`, `interface CharacterRowsCtx { addPageListener(l): () => void; addPageFailedListener(l): () => void }`
- `provideCharacterRows(): CharacterRowsCtx` (sets the context; called during a shell's init), `createCharacterRows(): CharacterRowsCtx` (subscriptions + listener sets, testable)
- `onCharactersPage(listener)` / `onCharactersPageFailed(listener)` — register while the calling view is mounted (`$effect(() => ctx.add…(listener))`, exactly like `onCardImported`).
Behaviour:
- `useInterest<"characters:page">("characters:page", msg => for each listener: listener(msg))` — no toast.
- `useInterest<"characters:page:error">(…, msg => …)`: when `msg.error === CHARACTER_ROWS_STALE_CURSOR` (import from `$lib/shared/characters/characterRows`) → **no toast** (the view silently asks for the first page again); otherwise ONE toast through `notify.error({ title: msg.error || "Couldn't load the characters.", source: "socket:characters:page:error" })`. Then hand `msg` to every failed-listener in both cases.
- Header doc comment in the style of characterImports: what it is, the events, "Provided by both shells (Layout.svelte, AccessibleShell.svelte) at init", views register with the `on…` functions, the reply goes to the asking socket only and carries `requestId` (views match their own).
Test: new `src/lib/client/contexts/characterRows.dom.test.svelte.ts` in the characterImports test's style (mock `useInterest` and the toaster the same way): a page reply reaches every registered listener and toasts nothing; a stale-cursor refusal toasts nothing and reaches the failed-listeners; a generic refusal toasts exactly once (however many listeners) and reaches them; a released listener hears nothing.

### C. Provide it in both shells, and keep Layout's catch-all quiet
- `src/lib/client/components/Layout.svelte`: import and call `provideCharacterRows()` right after `provideCharacterImports()` (~line 2273); add `"characters:page:error"` to `HANDLED_ERROR_EVENTS` (~line 132) right after the three `characters:import*:error` lines, with a one-line comment in the file's style: the characters-rows context toasts a refused page itself (contexts/characterRows.svelte.ts) and stays quiet on an out-of-date cursor. These two hunks plus the rail label (D) are the ONLY edits allowed in Layout.svelte.
- `src/lib/client/accessibility/AccessibleShell.svelte`: import and call `provideCharacterRows()` right after `provideCharacterImports()` (~line 80).

### D. The rename — the view is **Characters** (owner ruling ★C-1, 2026-11-08)
Quote: "**★C-1 → "Characters"** (rail item, phone label, Jump chip, page title; reverses ruling 12's "Character cards" of 2026-11-03/04 for the view's name — "character card" stays the item's name)."
Change exactly these view-name sites:
- `Layout.svelte` ~695 `characters: { icon: Icons.UsersRound, title: "Character cards" }` → `"Characters"`.
- `AccessibleShell.svelte` ~263 the nav item label `"Character cards"` → `"Characters"`.
- `src/lib/client/shell/bottomBarLabels.ts`: "Characters" fits the bottom bar, so remove the `characters: "Cards"` entry (leave `BOTTOM_BAR_SHORT_TITLES` as an empty record and `bottomBarText` unchanged), and update the doc comment so it no longer cites "Character cards" (say a view may show a short title when its name doesn't fit at 11px). Update `bottomBarLabels.test.ts`: the characters view shows its title "Characters"; other views unchanged.
- `src/lib/client/shell/jump.svelte.ts`: `KIND_SCOPE_LABELS.character` → `"Characters"`; the `JumpScopeRegistration.label` doc example `"Character cards"` → `"Characters"`. Check `src/lib/client/shell/jump.test.ts` and `railViews.test.ts`, `viewRoutes.test.ts` for assertions on the old word and update them.
- `src/routes/characters/+page.svelte`: `<title>Character cards — Serene Pub</title>` → `<title>Characters — Serene Pub</title>`.
Do NOT change any "character card(s)" that names the ITEM (a card) — only the view's name at the sites above. Do NOT touch any other file that says "Character cards" (the supervisor queues those); list any you notice that name the VIEW in your report.

## Files owned (edit only these)

`src/lib/client/sockets/typedSocket.ts` (the two entries only) · NEW `src/lib/client/contexts/characterRows.svelte.ts` + NEW `characterRows.dom.test.svelte.ts` · `src/lib/client/components/Layout.svelte` (the three hunks above only) · `src/lib/client/accessibility/AccessibleShell.svelte` · `src/lib/client/shell/bottomBarLabels.ts` + `.test.ts` · `src/lib/client/shell/jump.svelte.ts` + `jump.test.ts` · `railViews.test.ts`/`viewRoutes.test.ts` only if they assert the old word · `src/routes/characters/+page.svelte`.

Another lane (s4-fixes) is editing `state/**`, `sockets/state.ts`, `sockets/lorebooks.ts`, `EditSessionForm.svelte` etc. right now — never touch them. Another worker (w1) is editing `src/lib/server/cast/characterRows.ts` and `src/lib/shared/characters/characterRows.ts` — read-only for you.

## Rules you must follow (quoted)

- CLAUDE.md Standing ruling: "**Sockets:** one domain context per event family (provided by both shells) is the only listener, and the only place that toasts; views register listeners for local state and never call `toaster`."
- Common brief: "Toasts go through `notify` (`src/lib/client/utils/notify.ts`), never the raw toaster."
- CLAUDE.md Hard rules: "`socket.off(event)` with no handler removes **every** listener app-wide; always pass the handler." "`$state(new Set())` / `new Map()` is not reactive on mutation — use `SvelteSet` / `SvelteMap`." (Plain `Set` for listener sets inside a context is fine — characterImports does it; they aren't reactive state.)
- "Browser code runs on plain-http LAN addresses and phones: no `crypto.randomUUID`, no `navigator.clipboard`."
- `characters:page` is in `GATED_EVENTS`, not in `SCOPED_EVENTS` (per user, no scope key): `useInterest` with the bare key, like the import events.
- NOMENCLATURE R1/R3/R6: the names above are decided; mark them 🚧 in the doc comments; invent no others (stop and ask in your report if you need one).
- STYLE-GUIDE §10 sentence case for labels.

## Tests (Done means)

Run, capped and logged:
`systemd-run --user --scope -p MemoryMax=6G -p MemorySwapMax=0 --quiet bash -c 'export NODE_OPTIONS=--max-old-space-size=4096; npx vitest run src/lib/client/contexts/characterRows.dom.test.svelte.ts src/lib/client/contexts/characterImports.dom.test.svelte.ts src/lib/client/shell/bottomBarLabels.test.ts src/lib/client/shell/jump.test.ts src/lib/client/shell/railViews.test.ts src/lib/client/shell/viewRoutes.test.ts --maxWorkers=2 > /tmp/claude-1000/-home-jody-github-serene-pub/9382c94a-1330-4480-b65e-0cfdb1f75e97/scratchpad/s4-chr-view-w2-tests.log 2>&1; echo test-exit=$? >> /tmp/claude-1000/-home-jody-github-serene-pub/9382c94a-1330-4480-b65e-0cfdb1f75e97/scratchpad/s4-chr-view-w2-tests.log'`
Also `grep -rn "Character cards" src/lib/client/shell src/lib/client/components/Layout.svelte src/lib/client/accessibility/AccessibleShell.svelte src/routes/characters` returns nothing that names the view. `npx prettier --check` your files; only `--write` lines you changed (Layout.svelte and typedSocket.ts are huge — never whole-file `--write` them). Never pipe vitest into `head`.

## Verbatim rules

- *This is an implementation task. Answer any relayed status question in one line in your report, and still do all the work.*
- *Never run `git stash` in any form, including `--keep-index` or to probe prettier; it stashes every other lane's uncommitted work. Use `npx prettier --check <file>`.*
- *Never commit. Never `npm test` or `npm run build` at the SDK root. Delete only the `/tmp/serene-pub-vitest-*` dirs your own tests made, by name; never a glob over `/tmp/serene-pub-*`.*
- *Before any `sdk:build`, check `pgrep -af "vite dev"` for a serene-pub server. If one is up, don't build; report 'blocked on your dev server'.* (You need no sdk:build.)

## Report

In your final message: changed files with the hunks named, decisions, tests with pass/fail counts, any other place you saw that names the VIEW "Character cards" (file:line), Noticed-not-done.
