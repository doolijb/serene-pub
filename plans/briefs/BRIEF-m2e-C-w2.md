# BRIEF m2e-C-w2 — lens listing (★50), Leave's origin (★C-1), Advanced fold check (★E-2)

Worker for lane **m2e-C** (client + docs) of build M2e, Serene Pub (`/home/jody/github/serene-pub`). Supervisor reads your report.
All three items are RULED by the owner on 2026-11-04; build them, do not re-open them.

This is an implementation task. Answer any relayed status question in one line in your report, and still do all the work.

## Goal

### Item A — ★50: a package-ruleset entry is listed under its ruleset's list even when the book does not play that ruleset
Owner ruling (2026-11-04): "★50 → list under its ruleset's lens." The finding: _"a provided book's package-ruleset entry is counted in
Everything (6) but listed in no view when the book does not play that ruleset (5 shown)."_
What the supervisor found (verify, file:line):
- The counts handler (`src/lib/server/sockets/entries.ts` ~1795–1825) counts EVERY type the book holds (the `byType` loop), so
  Everything counts the foreign-ruleset entry.
- `entries:types` (`entries.ts` ~483–505 → `src/lib/server/lorebooks/rulesLists.ts` `bookRulesListsRead`) sends only the lists of the
  rules the book is told by (`primaryRuleset`). The workspace (`src/lib/client/lorebooks/LorebooksWorkspace.svelte` `handleEntryTypes`
  ~1954) asks `entries:list` only for those lists, and `bookPoolItems` (`sections/index.ts` ~534) only builds pool rows for those doors —
  so the foreign entry has no door, no rows, no rail row.
- Writing a NEW entry of another rules' type is refused by the server (`rulesListRefusal`, `entries.ts` ~673); editing an existing one is not.
- The client cannot know another rules' list label or piece shape by itself (plugin rulesets are registered server-side), so the
  server must send them. **The server is lane D's (`src/lib/server/**`, `src/lib/shared/**`) — you must not edit it.**
Build the CLIENT half to this proposed contract (the supervisor queues the server half to lane D; it is optional on the wire, so
nothing breaks before it lands):
```ts
// Sockets.Entries.Types.Response gains (🚧 ★50):
/** Lists of OTHER rules than the book's that the book holds entries of: listed under those rules' own name, never added to here. */
otherRules?: { rulesName: string; types: BookRulesList-shaped rows (same row shape as `types`) }[]
```
Since `src/lib/shared/sockets/types.ts` is lane D's, do NOT add the field there; read it on the client through a narrow local type
(e.g. `msg as Sockets.Entries.Types.Response & { otherRules?: ... }`) in ONE place, with a `// ⏳ until lane D adds otherRules to the contract` comment.
Client behaviour:
- `handleEntryTypes` also remembers those lists (`rememberRulesLists`), asks `entries:list` for each, and builds their doors
  (`rulesListDoor`), so their rows join `bookPoolItems` (Everything then lists what it counts).
- The rail draws each other-rules group **after** the book's own rules group, headed by that rules' name, one row per list with
  something in it (reuse `rulesListFacets`/`drawsRulesList`; a pure helper in `scopes.ts` for "the groups the rail draws" is welcome).
  Check `LoreRail.svelte`'s `rulesGroup` prop: if it takes one group, widen it to an array in the smallest way.
- An other-rules list offers **no Add** (the server would refuse it). If the door has an add affordance, hide it for such a list; its
  door `body` sentence (one sentence, STYLE-GUIDE §10): _"‹Label› comes from ‹Rules name›, which this book is not told by. Its entries are listed here; add new ones in a book told by ‹Rules name›."_ (Proposed copy — mark it 🚧 in a comment.)
- Tests in `src/lib/client/lorebooks/sections.test.ts` (and `scopes.test.ts` if you add the helper there): a foreign list's rows appear
  in `bookPoolItems`; the rail groups (own first, then each other rules group); a list with nothing in it is not drawn; no Add on a foreign door.
Files: `src/lib/client/lorebooks/LorebooksWorkspace.svelte` (only `handleEntryTypes`, the rules-group derivation and the reset at ~2446 —
it is 3,000+ lines: read ranges, never the whole file), `LoreRail.svelte`, `scopes.ts`, `sections/index.ts`, `sections/kinds.ts`,
`lenses/PoolMount.svelte` if it reads `book.rulesLists` (line ~49) and must include the other lists, `bookData.svelte.ts` if needed,
the two test files.

### Item B — ★C-1: Leave goes back where you came from
Owner ruling (2026-11-04): "★C-1 Leave → back where you came from (Apps when entered from Apps, Home from Home, Sessions as the fallback)."
- Today `src/routes/apps/[pluginId]/+page.svelte` `leave()` (~line 82) calls `openAfterLeaving({ key: "sessions" })`; Esc (`onKeydown`) calls `leave()`.
- `src/lib/client/components/AppletCard.svelte` (line ~36) is an `<a href="/apps/{pluginId}">`. It is used by the Apps view
  (`src/lib/client/components/sidebars/AppsSidebar.svelte` ~38) and Home (`src/routes/+page.svelte` ~1925). Give the card a prop
  (e.g. `from: "apps" | "home"`, required, set by each caller) and an `onclick` that, for a plain left click with no modifier keys
  (no ctrl/meta/shift/alt, button 0), calls `event.preventDefault()` and `goto(href, { state: { from } })`. **Keep the href** (middle-click,
  open-in-new-tab, a11y). No visible URL parameter.
- A pure helper (new file, e.g. `src/lib/client/shell/leaveDestination.ts`, name it in your report as 🚧) decides the destination:
  `(from: unknown, appsRegistered: boolean) => "apps" | "home" | "sessions"`: `from === "apps"` and the Apps view registered → apps;
  `from === "home"` → home; anything else (a cold load: `page.state` is `{}`; Apps no longer registered) → sessions.
- The launcher reads `page.state` (`import { page } from "$app/state"`, already imported) and the Apps view's registration (find how the shell
  knows — the Apps view registers only while an applet is listed, ★N1; look in `src/lib/client/shell/` and the panels context the launcher
  already holds, `panelsCtx`). Home: find how Home is reached (`viewAddress`/`VIEW_ROUTES` in `src/lib/client/shell/viewRoutes.ts`, or `goto("/")`
  and the panels context's way to show Home) and use the existing path; do not invent a new view key.
- Tests: the helper's decision table (from ∈ {apps, home, undefined, junk} × registered ∈ {true, false}) in a new `*.test.ts`; keep
  `src/lib/client/shell/viewRoutes.test.ts` green. If you add a DOM test for the card's click, keep it small.

### Item C — ★E-2: the Advanced fold — drawing only, check first
Owner ruling: "★E-2 → yes: a setting with no group lands under an Advanced fold in every derived form." The DECISION of which field is
`advanced` is server code (lane D: `src/lib/server/sessions/settingsForm.ts` ~277 and ~667). This lane only makes sure the client DRAWS what
the deriver sends: an Advanced fold, **last** in the form's block, **closed by default**, the existing folded pattern; a form with nothing
advanced draws no fold. The supervisor found `src/lib/client/components/sessionForms/SessionSettingsForm.svelte` ~134–170 already draws
`splitAdvanced(fields)` as `<details>` (closed) last in each field list, summarised _Advanced · N settings_. Check: (1) every client surface that
draws the output of the deriver at `settingsForm.ts:277` and at `:667` (find their socket events and the components that draw them — e.g.
the session settings form, the start/create form's genre fields, `PipelineConfigOptions.svelte`, `SchemaForm.svelte`); (2) each draws
`advanced` that way. If all do, **change nothing** and say so with file:line evidence. Only if one ignores `advanced`, make it use the same
`<details>` pattern (STYLE-GUIDE §6.17 quoted below) and add a test (ungrouped/advanced field → fold; none → no fold) in that form's existing test file.

## Files owned (only these may be edited)
Item A: the files listed under Item A. Item B: `src/routes/apps/[pluginId]/+page.svelte`, `src/lib/client/components/AppletCard.svelte`,
`src/lib/client/components/sidebars/AppsSidebar.svelte` (the card's `from` prop only), `src/routes/+page.svelte` (the card's `from` prop only —
3,700+ lines: edit the one call site), the new helper + its test. Item C: only a client form file that ignores `advanced`, and its test.
## Files readable
Everything. **Never edit** `src/lib/server/**`, `src/lib/shared/**`, `../serene-pub-sdk/**`, `NOMENCLATURE.md`, `STYLE-GUIDE.md`, `docs/**`
(another worker or lane owns them). Queue anything needed there in your report.
## Out of scope — never built
No setting; no visible URL parameter; no change to the Apps view/cards' look or the loading screen; no restyle; no server change; no
change to which fields are advanced; nothing for admin starter kits.

## Rules you carry
- CLAUDE.md Decisions: decide implementation inside the asked scope and name each choice in your report; anything a user sees beyond
  what is written here, or a new name/setting/flag/event — propose it in the report marked ★, don't invent it. Say each assumption.
  Findings along the way go under **Noticed, not done**, never fixed in passing.
- NOMENCLATURE §1: R1 one word, one meaning · R2 distinctive words for new concepts · R3 qualify, never the bare noun · R4 casual words are not
  type names · R5 reconcile vocabularies at boundaries · R6 mark ⏳ transitional / 🚧 provisional. Every new identifier you introduce gets a
  `🚧` comment and is listed in your report with a one-line "what it is / what it is not" (the supervisor writes the NOMENCLATURE rows).
  "app" = Serene Pub; **applet** = the plugin-provided thing; the UI label is **Apps**. It is a **session**, never a *chat*.
- STYLE-GUIDE §10 Writing (verbatim): "Sentence case everywhere" · "Labels are nouns, hints are sentences" · "Help is one sentence." ·
  "One name per thing, across the whole flow".
- STYLE-GUIDE §9: "Every interactive element is a real `button`, `a` or input with an accessible name" · "Never an interactive inside an interactive."
- STYLE-GUIDE §6.17 (the fold): "**Advanced** is one `<details>` per block, summarised _Advanced · N settings · M changed_" ·
  "The client never hides a row the server sent."
- Colour by role and stop, never a hex; container queries, never the viewport, inside a view.
- Svelte 5 runes. `$state(new Set())`/`new Map()` is not reactive on mutation — use `SvelteSet`/`SvelteMap`. Browser code runs on plain-http
  LAN addresses: no `crypto.randomUUID`, no `navigator.clipboard`.
- Sockets: one domain context per event family is the only listener and the only place that toasts; views never call `toaster`;
  `socket.off(event)` always with the handler (no handler removes every listener app-wide).
- Read line ranges (`sed -n`), never a whole large file. `LorebooksWorkspace.svelte` and `src/routes/+page.svelte` are huge.
- Tests: run only your targeted files: `npx vitest run <files>`. **Never pipe vitest into `head`** (the SIGPIPE leaks PGlite temp dirs).
- Never run `git stash` in any form, including `--keep-index` or to probe prettier; it stashes every other lane's uncommitted work. Use `npx prettier --check <file>`.
- Never commit. Never `npm test` or `npm run build` at the SDK root. Delete only the `/tmp/serene-pub-vitest-*` dirs your own tests made, by name; never a glob over `/tmp/serene-pub-*`.
- Before any `sdk:build`, check `pgrep -af "vite dev"` for a serene-pub server. If one is up, don't build; report 'blocked on your dev server'. (You should not need an sdk:build.)

## Stop and ask when
CLAUDE.md §Decisions applies; a name is new beyond those above (propose, build 🚧); you would need to edit a file outside Files owned.

## Done means
`npx vitest run src/lib/client/lorebooks/sections.test.ts src/lib/client/lorebooks/scopes.test.ts src/lib/client/shell/viewRoutes.test.ts <your new helper test>`
(+ the lorebook DOM tests that render `LoreRail`/the workspace if you changed their props: `src/lib/client/lorebooks/loreRail.dom.test.ts`,
`src/lib/client/lorebooks/lorebooksWorkspace.counts.dom.test.ts`) all green; `npx prettier --check` on every file you touched (report pre-existing
failures as such). No tsc/svelte-check/full suite — the lead runs those.

## Report
Write `plans/briefs/REPORT-m2e-C-w2.md`: per item — what changed (file:line), choices made, every new name (what it is / is not), tests with
pass counts, ★ proposals, **Noticed, not done**, and anything queued for lane D.
