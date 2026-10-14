# Widget API developer-experience plan — 2026-10-11

**Status:** BUILT + VERIFIED 2026-10-11, uncommitted (app, SDK, twenty-questions, battleship). Units D1–D8 all ☑ (see the ledger line below). Grouped verification after `sdk:build` (owner's dev server was down): `sdk:test` 2961/2962 (the one failure is the pre-existing "saved" term in your-first-plugin.md) · `tsc` 0 · `svelte-check` 0 errors · `npm test` 16641 pass, 1 failure left that is not ours (comment-history ratchet on `connections/modelsList.ts`, flagged by other same-day work) · `test:budgets` pass · `npm run build` OK and writes `build/component-classes.json` (1883 classes) · plugins: all green but their pre-existing `example.test.ts` golden drift. Re-pinned: `coreCatalog.test.ts` announcement hash; INTEGRATING.md §5b census row for send/draft; `componentBundle` style wording; `cliClone` scope detection now recognises `scope('session:full')`. Real-app walk on an isolated instance: the three examples loaded as authored components, placed from the tray, Mood dial read and wrote Tam's Trust 0→1 behind `session:state:write`; not-granted drawn after a revoke + reload. Findings 20–24 appended to `plans/LOG-widget-dx-2026-10-11.md` (live revoke does not reach an open widget — needs a ruling). Follow-up BUILT 2026-10-11 (owner "go for it"): live revoke — `components:changed` carries reviewed `grants`, page `retargetAuthoredGrants`; verified live on an isolated instance (open dial drew *not granted* within 3 s of the review, slots back on re-grant); int + unit tests. Follow-up BUILT 2026-10-11 (owner chose A): per-widget `messages` paging — `sessions:messagesPage` (cursor, limit, channel with lane semantics), page dep `messagesPage`, answer `channelOfAsk`; int + unit tests, census row, ledger row. Follow-up BUILT 2026-10-12: the owner's second filter is the existing **channel lane** (ruled: word stays, qualified; participants are the genre's; a dedicated turn decider reads them) — `channel-lanes` request + `ChannelLaneV1`, `sessions:channelLanes`, page dep, tests, canon rows, channels guide. Verified 2026-10-12 after `sdk:build`: sdk:test green but the pre-existing "saved" item, app tsc 0, svelte-check 0, surface audit green. Still to do by the owner: SDK prerelease + pin bump; optionally a core cell-phone widget as a fourth worked example. Ledger of the build: D1 ☑ · D2 ☑ · D3 ☑ (764 `@ruling` tags) · D4 ☑ (write grants) · D5 ☑ (`warningsAt`, `knownClasses`) · D6 ☑ (`reactive(ctx)`) · D7 ☑ (11 core + 4 plugin widgets migrated; 3 examples + `guides/widget-examples.md`) · D8 ☑. Rulings taken as recommended (Q1–Q4).

Source: a read of the widget data contract (`../serene-pub-sdk/sdk/src/widgets.ts`,
`componentClient.ts`, `layout.ts`), the component client (`component-client/src/*`), core's
widget context (`core-catalog/src/shared/ui/widgetContext.ts`), the guides
(`guides/widgets.md`, `guides/vocabulary.md`) and `docs/component-authoring.md`, asked one
question: would someone outside the project find this clear and fun to build against? The
verdict was "clear in architecture, not yet fun". Nothing was built or run to reach it; D7
below is the unit that tests the verdict for real.

Every unit is a change to the SDK repo unless it says otherwise. The SDK is edited in
`../serene-pub-sdk`; after any SDK change run `npm run sdk:build` (check nothing is on :5173
first) and `npm run sdk:test`. Shipping needs an SDK prerelease and a pin bump, as the other
uncommitted SDK work already does. New or renamed names go through NOMENCLATURE §1 + §24 and
the §25 ledger in the same change. Status marks: ☐ todo · ◐ in progress · ☑ done · ✗ dropped.

## 0. The findings, and the unit that closes each

| # | Finding | Unit |
| --- | --- | --- |
| F1 | `ComponentSections` declares `session`, `messages`, `layout`, `actions` as `unknown` while `WidgetData` types every one of them. An author's first `ctx.messages[0].content` is a type error. | D1 |
| F2 | One datum has three spellings: `session:state` where asked, `session_state` where posted, `ctx.scoped.session_state` where read. Native reads `messages.v1`; a component reads `ctx.messages` flat. | D2 |
| F3 | Public JSDoc carries internal ruling ids (R75, C0b, W10, C8 …): 103 mentions in the two contract files alone. To an outsider the contract reads as coded and unfinished. | D3 |
| F4 | Of 35 request kinds, 20 are core-only, including every write. A plugin widget can show and open, but the first thing people want, "a button that does something", is mostly refused. | D4 (needs ruling) |
| F5 | Two silent failures: a utility class the app did not build does nothing; a `<style>` block is dropped. Both are documented; neither is reported in Problems. | D5 |
| F6 | The Svelte path is subscribe-and-copy: `ctx` is not reactive state, so every Svelte widget hand-writes `$effect(() => ctx.subscribe(...))` mirrors. | D6 |
| F7 | One example (`tally`, an `sp-frame` wrapper). No worked example reads scoped data, pages messages, or fires an action. | D7 |
| F8 | Project words (dossier, dowry, scope vs section, grant) reach an author with no gloss in reach of the type they are reading. | D8 |

Order: **D1 → D3 → D5 → D8 → D2 → D6 → D7 → D4.** D1/D3/D5/D8 are cheap and independent and can
run as parallel lanes. D2 and D6 touch the same file (`component-client`) and run in sequence.
D7 comes after D2/D6 so the examples are written against the final surface. D4 waits on Q2.

## D1 · Type the component context off the envelope (F1) — S

- `ComponentSections` becomes derived, never hand-listed: each base section is
  `WidgetData[S]['v1'] | undefined` (`messages?: MessageV1[]`, `layout?: LayoutV1`,
  `session?: SessionV1`, `actions?: ActionsV1`, `props`, `settings`, `annex` from the same
  table). A section added to `WidgetData` and forgotten here no longer compiles, the way
  `BASE_SECTIONS` already guards `WIDGET_BASE_SECTIONS`.
- `channels: Record<string, MessageV1[]>`.
- `onEvent(fn: (event: WidgetEvent) => void)`, not `unknown`.
- `state?: unknown` stays `unknown`: it is the widget's own.
- Where: `sdk/src/componentClient.ts`; `componentWire.ts` line ~131 builds the object and needs
  no shape change. Check `component-client/src/svelte.ts` and the `workerRuntime` compile.
- Test: `sdk-tests/componentHarness*.test.ts` already exercise the context; add one type-level
  test (`expectTypeOf(ctx.messages).toEqualTypeOf<MessageV1[] | undefined>()`).
- Risk: a core widget or fixture that relied on `unknown` and cast. `grep -rn "as unknown" core-catalog/src component-client/src` first.

## D2 · One shape an author meets (F2) — M

Two decisions, one recommended answer each.

**`.v1` or flat.** Recommend: the component context stays flat, and the rule is written down
once: *`.v1` is the wire's version clock; the component client unwraps the current version, so
a component never types `v1`.* Native core widgets keep reading `.v1` off `WidgetContext`
(41 files in `src/lib/client` do; changing them buys an outsider nothing). When a `v2` ships
for a section, the client is the one place that picks, which is what a client is for.

**Scope spelling.** Recommend: add one typed accessor, `ctx.scope('session:state')`, returning
that scope's section or `undefined`, keyed by the same string `scopes` and `granted()` take.
`ctx.scoped.session_state` stays as the raw bag and is no longer what the guide teaches. The
author then types the scope string in exactly three places (`scopes`, `granted`, `scope`) and
never meets the posted name. The name `scope` for the accessor goes through §24: it is a verb
form of a word the contract already owns, and it must be said to be *not* `scopes` (the
declaration list). Record in §25.

- Where: `componentClient.ts` (`ComponentContext.scope`), `componentWire.ts` (implementation:
  `WIDGET_SCOPED_SECTIONS[scope]` → `data.scoped[name]`), `guides/widgets.md` §"Extra data an
  admin grants" rewritten to use it, `docs/component-authoring.md` unchanged.
- Test: harness test posts `session_state`, reads `ctx.scope('session:state')`; a revoke makes
  it `undefined` while `granted()` turns `false`.

## D3 · Public JSDoc hygiene (F3) — S

- Ruling ids move out of running prose into one block tag per comment, `@ruling R75, C0b`,
  which `typedoc.json` is configured to drop (`excludeTags`). Traceability stays in the source;
  the rendered API docs and editor hovers lose the code words. Hovers in VS Code still show
  block tags, so the prose above the tag must stand on its own.
- 🚧 and ⏳ stay: NOMENCLATURE R6 requires them. Add one sentence to `sdk/README.md` and the top
  of `guides/widgets.md` glossing them (*🚧 may change shape before 1.0; ⏳ is going away, with
  the version named*), so the marker reads as a promise rather than a shrug.
- `@experimental` on 70 declarations in `widgets.ts`: leave; SDK 1.0 == 0.7.0 is where that
  sweep belongs (see the SDK 1.0 plan). Note it there, do not do it here.
- Where: `widgets.ts`, `componentClient.ts`, `layout.ts`, `widgetContext.ts`, `typedoc.json`.
  Mechanical; one pass per file, reviewed by reading the rendered API docs page for widgets.
- Test: `npm run sdk:test` (the docs compiler has hash/count pins; expect to re-pin), and a
  grep that no `\bR\d{2}\b|\bC\d\b|\bW\d{1,2}\b` remains outside an `@ruling` tag in those files.

## D4 · Writes a plugin widget may ask for (F4) — M, needs Q2

The request table marks every write `core`. The human-press gate ("a press that changes
something needs a person behind it", already enforced) is the safety property; the asker
marking is a second, coarser one. Proposal: open three writes to plugins, each behind the scope
whose data it changes, so an admin who granted the read is asked once more for the write.

| Kind | Opens under | Why this one |
| --- | --- | --- |
| `send` | `channel:<slug>` (write) | A dice tray, a vote, a card draw: the result goes into the conversation as the viewer. |
| `draft` | `channel:<slug>` (write) | Prefill the composer rather than send: the gentler form. |
| `set-attribute-value` | `session:state` (write) | A stat panel that edits. The read already exists under the same scope. |

- A write grant is a distinct permission from the read (`widget:session:state` today), reviewed
  separately in the plugin's permissions page. Its key needs §24: `widget:session:state:write`
  is the obvious spelling; grep `src/lib/server/plugins/permissions.ts` for the pattern that
  derives permission keys from scopes (line ~164) and extend it, not a parallel table.
- `WidgetRequestAskers` grows a `{ scope, write: true }` member; `widgetRequestRefusal` checks
  the write grant. `WIDGET_REQUEST_ASKERS` is typed off the request table so nothing is missed.
- Server side: the three request handlers already act as the viewer; confirm each re-checks the
  grant server-side (the asker check in the page is not a security boundary), and that `send`
  for a plugin is held to the declared channel, not whatever channel the params name.
- Not opened: `fire-turn`, `summarize`, `decide-proposal`, the composer tray kinds, the lore
  writes, `set-story-clock`. Those act on the session's structure, not on one scope's data.
- Docs: `guides/widgets.md` §"What it is handed" and `guides/plugin-permissions.md`.
- Test: `permissions.test.ts` (granted read ≠ granted write), a harness test for a refused and
  an allowed `send`, and the conformance package if it pins the request table.

## D5 · Loud failures in the editor (F5) — S

- A `<style>` block in a component file is a Problems entry with a line, not a silent drop:
  *A `<style>` block is dropped here. Style it with the app's utility classes, or give the widget
  a style.* The compiler already knows it dropped one.
- A class the app did not build is a Problems warning, best-effort: the component compiler
  checks static `class="…"` strings against the generated class list the build already
  produces (`docs/component-authoring.md` describes it). Dynamic class expressions are not
  checked and the warning says so once per file. Where that list lives at compile time needs a
  look: if it is only in the built CSS, extract a sorted `classes.json` alongside it in the
  same build step.
- Where: app side, the component compile path (grep `Problems` in `src/lib/server/components`
  or wherever `componentCompile` is hosted) and the build script that emits the class list.
- Test: `componentCompile.test.ts` gains two cases; one app test for the class-list check.

## D6 · A reactive context for Svelte widgets (F6) — M

- `@serene-pub/component-client/svelte` gains `reactive(ctx)`: a `$state`-backed mirror of the
  sections, updated from `ctx.subscribe`, so a Svelte widget writes
  `{reactive(ctx).messages.length}` with no effect boilerplate. Verbs pass through.
- Runes in a `.ts` file need the `.svelte.ts` extension; the file is TypeScript source the
  component build bundles, so confirm the component compiler accepts a `.svelte.ts` module
  from the client package (it compiles Svelte already). If not, the mirror is a plain store
  object with getters over `$state` created inside the Svelte mount wrapper instead.
- `svelteComponent(Hello)` passes `ctx` today. Recommend it pass the reactive mirror as `ctx`
  and the raw context as `raw`, so the default path is the reactive one; the guide's example
  loses its `$effect`. Breaking only for a component that compared `ctx` by identity, which
  nothing does.
- Test: `componentHarnessPage.test.ts` mounts a Svelte fixture that reads the mirror and sees
  a pushed `messages` update without a subscribe call.

## D7 · Three worked examples, built for real (F7) — M

Written after D2 and D6 land, against the final surface, each a conformance-tested fixture
under `sdk-tests/fixtures/` and a page in `guides/` (or sections of `guides/widgets.md`):

1. **Who's here**: reads `attendance` and `viewer` only (`reads: ['attendance','viewer']`),
   no scopes. Shows the cheapest possible widget and the `reads` discipline.
2. **Log search**: pages messages with `request('messages', { cursor })`, declares
   `channels`, filters client-side. Shows paging and `saveState` for the query.
3. **Mood dial**: declares `scopes: ['session:state']`, reads `ctx.scope('session:state')`,
   draws the not-granted state, and presses an action from `actions.v1` with `invoke`. If D4
   lands, it also writes with `set-attribute-value`.

This unit is also the test of the plan: the person building these keeps a short friction log
(`plans/LOG-widget-dx-2026-10-xx.md`), and anything that still hurts becomes D9+ rather than
being smoothed over in the example. `serene-pub scaffold component` gains the three as
templates if the scaffold supports variants; check `cli/src/scaffoldComponent.ts` first.

## D8 · Vocabulary within reach (F8) — S

- `guides/vocabulary.md` gains **scope**, **section**, **grant**, **dossier**, **dowry**
  (the last two under "Words you can skip for now" if they stay provisional).
- `componentClient.ts` top comment and `WidgetScopedSections` link to the vocabulary page.
- The SDK README's first screen links the vocabulary page before the API reference.

## Open rulings

- **Q1** D2: flat component context plus `ctx.scope(…)` (recommended), or components read
  `.v1` like native does. The second is more uniform and worse to type.
- **Q2** D4: open `send` / `draft` / `set-attribute-value` to plugins behind write grants, or
  keep every write core-only until 0.7. If kept, F4 stays and the plan says so in the guide
  more plainly than it does now.
- **Q3** D6: pass the reactive mirror as `ctx` by default (recommended), or keep raw as `ctx`
  and offer the mirror beside it.
- **Q4** Whether D7's friction log may open further units without coming back for a ruling.
  Recommend yes for S-sized ones, no for anything touching the request table or grants.

## Verification, once, at the end

Each unit runs its own targeted tests as it lands. After the last unit: `npm run sdk:build`
(no owner dev server on :5173), `npm run sdk:test`, `npx tsc --noEmit -p .`, `npm run check`,
`npm test`, `npm run test:budgets`, `npm run build`. Then D7's three examples are placed in a
real session on an isolated dev instance and screenshotted: one widget each, one with a scope
refused and granted. Docs touched: `guides/widgets.md`, `guides/vocabulary.md`,
`guides/plugin-permissions.md` (D4 only), `docs/component-authoring.md` (D5 wording),
NOMENCLATURE §25 for `scope` (D2) and any write-permission key (D4).
