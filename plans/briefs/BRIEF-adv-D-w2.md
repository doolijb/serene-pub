# BRIEF — adv-D-w2: Book settings and the lenses

Supervisor: lane adv-D (characters + lorebooks) of `plans/PLAN-advanced-controls-2026-11-10.md`. Owner gave the build go 2026-11-10 and ruled ★A–★D as the plan recommends. Lane adv-B works at the same time in `src/lib/client/components/sessionForms/` — never touch it. Lane adv-D-w1 works at the same time on `CharacterForm.svelte` and `sections/EntryAdvancedFields.svelte` — never touch those.

## Background you need (already built by lane adv-A)

- `src/lib/client/advancedControls.ts` exports `showsAdvancedControls(settings)` → `settings?.showAdvancedControls ?? false`. It is the **only** way to read the switch.
- `src/lib/client/components/AdvancedHiddenLine.svelte`: one muted line *"Some controls are hidden. Show advanced controls"*; the link emits `userSettings:updateShowAdvancedControls { enabled: true }` through `useTypedSocket()` from `$lib/client/sockets/loadSockets.client`. Optional prop `class`. It never listens and never toasts. Use it as is; do not edit it.
- The switch lives on `userSettingsCtx.settings.showAdvancedControls` (`getContext<UserSettingsCtx | undefined>("userSettingsCtx")`, type in `src/app.d.ts:398`). The shell's ctx is a `$state` proxy, so reading `ctx?.settings` inside `$derived` redraws when it flips — no reload. Neither `BookSettings.svelte` nor `LorebooksWorkspace.svelte` reads it today.

Plan rule (quoted): *"With advanced controls off, the controls that tune how a session, a book entry or a session's look works are hidden, along with two power views of a lorebook. … Hidden never means changed."* Plan item 23: *"No line in the lens track."*

## Goal

### A. `src/lib/client/lorebooks/BookSettings.svelte`
1. Read the switch from context as above into one `$derived` (`advanced`).
2. When off: `BookRulesCard` (~:290) and `StoryCalendarEditor` (~:299) are not rendered. **Keep, in both modes:** `EditLorebookForm`, `BookWritesCard` (a P1 off switch), `StoryClockEditor` (*The story's present*), *What this book holds*, *Reading into a session*, *This book*.
3. `AdvancedHiddenLine` renders **once**, as the last child of the page's outer `data-lore-book-settings` container (the foot of the page), **only** when advanced is off **and** at least one of the two would have rendered (`!readOnly && (primaryRuleset || true-for-the-calendar)` — the calendar renders whenever `!readOnly`, so in practice `!readOnly`; write the condition so it reads as "rules or calendar would have rendered"). Never in read-only mode.
4. `calendarUnsaved` simply stays false while the calendar isn't mounted; nothing else changes about the unsaved flag.

### B. Lenses — `src/lib/client/lorebooks/lenses/registry.ts`, `LensTrack.svelte`, `LorebooksWorkspace.svelte`
1. In `registry.ts` add pure functions (implementation helpers, these exact names):
   - `lensesShown(advanced: boolean): readonly LensDescriptor[]` — the registry in track order; with `advanced` false, `graph` and `lives` are left out. Keep the hidden ids in one private const in the file (not exported, no descriptor field).
   - `lensShown(lens: LoreLens, advanced: boolean): LoreLens` — `lens` when it is among `lensesShown(advanced)`, else `DEFAULT_LENS` (List, from `$lib/shared/lorebooks/loreRoute`).
   - `lensForKey(event, advanced: boolean)` — gains the second parameter and only matches shortcuts of `lensesShown(advanced)` (so Alt+Shift+4 and Alt+Shift+6 do nothing when off; the other lenses keep their own numbers). Update its existing callers/tests accordingly.
   - Add one sentence to the file's header comment: advanced controls (a per-person preference) leave Graph and Lives out of the track and their shortcuts; a route naming one draws List. Don't otherwise rewrite the comment.
2. `LensTrack.svelte`: a new **required** prop `advanced: boolean`; both the desk track and the compact popout iterate `lensesShown(advanced)` instead of `LORE_LENS_REGISTRY`. Update the doc comment's "seven … buttons" wording to fit. No hidden line here.
3. `LorebooksWorkspace.svelte` — lens filtering and fallback **only**:
   - read the switch once (`getContext<UserSettingsCtx | undefined>("userSettingsCtx")`, `showsAdvancedControls`) into `let advanced = $derived(...)`;
   - `let lens = $derived<LoreLens>(lensShown(route.lens ?? DEFAULT_LENS, advanced))` (today `:397`). This is the fallback: a route naming a hidden lens draws List. **No navigate, no route rewrite, no toast** — the route keeps its value, so there is no redirect loop, and turning the switch on draws the named lens again;
   - pass `{advanced}` to both `<LensTrack …>` mounts (~:2724 desk, ~:2756 compact);
   - `onWorkspaceKey` calls `lensForKey(event, advanced)`.
   - Change nothing else in the workspace (other entry points that open the graph, e.g. `PoolMount`'s relationships door or `ActivitySidebar`, are out of scope; they now land on List through the fallback).

## Files owned (the only files you may edit or create)

- `src/lib/client/lorebooks/BookSettings.svelte`
- `src/lib/client/lorebooks/lenses/registry.ts`, `src/lib/client/lorebooks/lenses/registry.test.ts`
- `src/lib/client/lorebooks/LensTrack.svelte`
- `src/lib/client/lorebooks/LorebooksWorkspace.svelte` (the lines above only)
- `src/lib/client/lorebooks/loreRail.dom.test.ts`: only add `advanced: true` to the two `LensTrack` mounts' props. Nothing else.
- new `src/lib/client/lorebooks/bookSettingsAdvanced.dom.test.svelte.ts`
- new `src/lib/client/lorebooks/lensTrackAdvanced.dom.test.svelte.ts` (LensTrack off/on + flip)
- new `src/lib/client/lorebooks/lorebooksWorkspace.hiddenLens.dom.test.svelte.ts` (the fallback)
- an existing test that now fails **only because** it mounts `BookSettings` / the workspace without the switch on (e.g. `providedBooks.dom.test.svelte.ts`): the minimal fix is adding `["userSettingsCtx", { settings: { showAdvancedControls: true } }]` to its context — or, if the test doesn't depend on the hidden cards, leave it. List every such file. Anything more: stop and report.

## Files readable

Anything. Useful: `providedBooks.dom.test.svelte.ts` (BookSettings mount harness), `lorebooksWorkspace.counts.dom.test.ts` (workspace mount harness — copy it for the fallback test), `loreRail.dom.test.ts` (LensTrack tests), `src/lib/shared/lorebooks/loreRoute.ts` (`DEFAULT_LENS`, `loreRoute`), `lenses/types.ts`.

## Tests to write

- `registry.test.ts`: `lensesShown(true)` is every lens in `LORE_LENSES` order; `lensesShown(false)` is that minus `graph` and `lives`, order kept; `lensShown("graph"|"lives", false)` → `"list"`, `lensShown(x, true)` → `x`, `lensShown("time", false)` → `"time"`; `lensForKey` with Alt+Shift+4 / 6 → null when off, `graph`/`lives` when on; Alt+Shift+5 → `time` either way. Existing `lensForKey` tests pass `true`.
- `lensTrackAdvanced.dom.test.svelte.ts`: off → desk track has exactly list, cards, tree, time, places (by `data-lore-lens`), compact popout rows the same; on → all seven; flip via a `$state`-backed prop or wrapper without remount.
- `bookSettingsAdvanced.dom.test.svelte.ts`: off → no Rules card, no calendar editor, `BookWritesCard` + story clock + *What this book holds* still present, the line *"Some controls are hidden."* appears **once** at the foot; on → rules card (with a `primaryRuleset`) and calendar present, no line; read-only → no line; flip via `$state({ settings: { showAdvancedControls: false } })` ctx without remount. Mock child components only if the harness already does.
- `lorebooksWorkspace.hiddenLens.dom.test.svelte.ts`: route `{ lorebookId, scope: "all", lens: "graph" }` with the switch off → List is drawn (the pool, as the counts test sees it), the track has no `graph` button and none pressed except `list`; `loreRoute` was not navigated/rewritten (route still says `graph`); same for `lives`; with the switch on the graph lens is the pressed one.

Run (never pipe into `head`):

```
cd /home/jody/github/serene-pub && systemd-run --user --scope -p MemoryMax=6G -p MemorySwapMax=0 --quiet bash -c 'NODE_OPTIONS=--max-old-space-size=4096 npx vitest run src/lib/client/lorebooks/lenses/ src/lib/client/lorebooks/loreRail.dom.test.ts src/lib/client/lorebooks/lorebooksWorkspace.counts.dom.test.ts src/lib/client/lorebooks/lorebooksWorkspace.noReadingVerbs.dom.test.ts src/lib/client/lorebooks/lorebooksWorkspace.hiddenLens.dom.test.svelte.ts src/lib/client/lorebooks/lensTrackAdvanced.dom.test.svelte.ts src/lib/client/lorebooks/bookSettingsAdvanced.dom.test.svelte.ts src/lib/client/lorebooks/providedBooks.dom.test.svelte.ts src/lib/client/lorebooks/bookRulesFit.dom.test.svelte.ts src/lib/client/lorebooks/scopes.test.ts src/lib/client/lorebooks/bookOpens.dom.test.svelte.ts; echo test-exit=$?'
```

Also grep tests for other `lensForKey(` / `LensTrack` / `BookSettings` users and run them. Do **not** run `npx tsc` or `npm run check`; the supervisor runs typecheck once.

## Rules (quoted from CLAUDE.md, the STYLE-GUIDE and the lane brief)

- "This is an implementation task. Answer any relayed status question in one line in your report, and still do all the work."
- "Never run `git stash` in any form, including `--keep-index` or to probe prettier; it stashes every other lane's uncommitted work. Use `npx prettier --check <file>`."
- "Never commit. Never `npm test` or `npm run build` at the SDK root. Delete only the `/tmp/serene-pub-vitest-*` dirs your own tests made, by name; never a glob over `/tmp/serene-pub-*`."
- "Before any `sdk:build`, check `pgrep -af "vite dev"` for a serene-pub server. If one is up, don't build; report 'blocked on your dev server'." (You need no `sdk:build`.)
- Never `git checkout`, `restore` or `clean` in either repo.
- **Prettier:** `registry.ts`, `registry.test.ts` and `LorebooksWorkspace.svelte` are prettier-clean today; keep them clean (`npx prettier --check <file>`; you may `--write` those and your new files). `BookSettings.svelte`, `LensTrack.svelte` and `loreRail.dom.test.ts` are **not** prettier-clean today: never `prettier --write` them; format only your own hunks by hand (tabs, no semicolons, double quotes).
- "Views never call `toaster`." No socket listeners added. "`$state(new Set())` / `new Map()` is not reactive on mutation; use `SvelteSet` / `SvelteMap`."
- No new user-facing copy beyond `AdvancedHiddenLine`'s; no new names beyond `lensesShown`, `lensShown` and the `advanced` prop; no new route param, setting or event. If one seems needed (e.g. the fallback needs a route change), stop and report.
- Browser code: no `crypto.randomUUID`, no `navigator.clipboard`.
- Scratch files start with `adv-D-w2-`, in `/tmp/claude-1000/-home-jody-github-serene-pub/c1ff1652-0bf9-4b2c-bd9d-ed98fac4505f/scratchpad/`.

## Stop and ask (in your report) when

CLAUDE.md §Decisions applies; a route fallback needs a new route param or name; an existing test fails for a reason other than the missing switch.

## Report

Return in your final message: changed files (one line each), tests run with pass/fail counts, prettier results per file, anything you stopped on, and **Noticed, not done**.
