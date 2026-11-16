# BRIEF — `perf-N` worker 1 — session, settings and scoped take the identity skip on the widget wire; their owners are proven

This is an implementation task. Answer any relayed status question in one line in your report, and still do all the work.

## Goal

`src/lib/client/components/frames/widgetWire.svelte.ts` `push()` (~`:343-455`) posts most sections through
`postChangedFrom(key, ref, build)` (~`:294`): when the input is the same reference as the one behind the last delivery,
the section is skipped before any `JSON.stringify` or clone. Three sections still go through `postChanged` (a
`JSON.stringify` compare on every push): `session` (~`:350`), `settings` (~`:409-410`) and each `scoped:<section>`
(~`:453`). Move those three onto `postChangedFrom`, and prove with dom tests at the wire and at two owners
(`RemoteWidget.svelte`, `surfaces/Panel.svelte`) that a value that did not change is neither posted nor stringified,
and a value that did change is posted exactly once with the new value.

## The change (exact)

1. `session`: `postChangedFrom("session", i.session, () => ({ t: "session", session: i.session! }))`.
2. `settings`: `postChangedFrom("settings", i.settings, () => ({ t: "settings", settings: i.settings! }))`.
3. Scoped, per section, keyed by the **section value** (never by the `i.scoped` wrapper, which is a new object whenever
   any section moves): `postChangedFrom(\`scoped:${section}\`, value, () => ({ t: "scoped", section, value }))`.
   On the withdrawal branch (`value === undefined`, post `null`, `sent.delete(...)`) also `heldFrom.delete(...)` for the
   same key, so the memo never outlives what the widget holds.
4. Update the comments that say which sections keep `postChanged` (the `postChangedFrom` doc comment ~`:286-293`,
   the `heldFrom` comment, and the perf-F list in `widgetWire.perToken.dom.test.svelte.ts`). Remaining on `postChanged`:
   `grants`, `layout`, `viewer` — leave those exactly as they are.
5. **Do not touch** the `ready` handler (~`:564-577`), `attach()` (~`:821-829`), the push effect (~`:740-757`) or the
   messages branch. Another lane will later add one hunk to the `ready` handler; leave it readable and unrestructured.

Why this is safe, and what it changes — put a short comment at the change saying so: before, `push()`'s stringify read
each value deeply **inside the push effect**, so an in-place change deep inside a `$state` proxy re-ran the push. After,
the effect tracks only `void i.session` / `void i.settings` / `void i.scoped` (shallow) and `push()` reads deeply only when
the reference moved. So these three now rely on their owners **replacing** a value that changed (a new reference), never
mutating it in place. The owners below are proven to do so.

## Tests (new files unless said)

Count section serialisations precisely: `vi.spyOn(JSON, "stringify")` and count calls whose first argument has
`t === "session"`, `t === "settings"`, or `t === "scoped"` (split by `section`). Count posts by `t` (and `section`)
on the widget's port.

### A. Wire — extend `src/lib/client/components/frames/widgetWire.perToken.dom.test.svelte.ts`

- The existing "50 content frames" test asserts `calls === 50 * 3` (perf-F: 600 → 150). Give its inputs a scoped
  section too (`scoped: { session_full: DOSSIER }` with `apis` that include `session` if the fixture needs it — read
  `apisOf`/`readsOf` first) and assert: section stringifies for `session`, `settings`, `scoped` are **0** over the 50
  pushes; total calls now `50 * 1` (only `viewer` remains, a fresh object on every read — leave it). Keep the existing
  post assertions.

### B. Wire — new `src/lib/client/components/frames/widgetWire.identity.dom.test.svelte.ts` (use `WidgetWireFixture.svelte`)

For each of `session`, `settings`, `scoped:session_full`:
- same reference across 50 pushes driven by a messages change → 0 posts, 0 stringifies of that section;
- a new reference with new content → exactly 1 post carrying the new value;
- a new reference with equal content → 0 posts (the JSON fallback still holds);
- a `ready` again → that section is resent once (memo cleared), with no reference moved;
- scoped: removing the section (`scoped` without it) → one `{ t: "scoped", section, value: null }`; handing the **same
  old reference** back afterwards → posted again (the memo did not survive the withdrawal).
- Nested in-place mutation, documented direction: a value held in a `$state` proxy and mutated deep in place **is no
  longer re-posted** by the wire alone — write this as a test that pins the contract (owners must replace), with a
  comment naming the owners proven below. Then the same change made by replacing the object → exactly one post.

### C. Owner — new `src/lib/client/components/host/remoteWidget.identity.dom.test.svelte.ts`

Harness: copy the shape of `host/remoteWidget.grants.dom.test.svelte.ts` (`vi.mock` of `host/uiWorkers`, the real wire,
`port.postMessage({ t: "ready" })`). The session handed to `RemoteWidget` must be composed **the way the page composes
it** (`src/lib/client/components/sessionPage/sessionPageData.svelte.ts:99-104`): a real `createSessionStore()`
(`src/lib/client/sessions/store/sessionStore.svelte.ts`), and
`$derived(record && cast ? { ...record, ...cast, sessionMessages: rows } : undefined)` over `store.session(id)`,
`store.messagesOf(id)`, `store.castOf(id)`. Read `src/lib/client/sessions/store/sessionStore.streaming.dom.test.svelte.ts`
for how perf-F loads a session and streams frames (`applyMessageDelta` / `sessionMessage` with a generating row).
`RemoteWidget.svelte`'s `sessionV1` (`:146-189`) is the value posted as `session`.

- 50 streamed frames (content deltas, and separately 50 with `reasoning` strings) → 0 `session` posts and 0 `session`
  stringifies; the `messages` section still streams.
- One real change to a field `sessionV1` reads (e.g. the session record's `name` replaced in the store via whatever the
  store exposes for a session update; read the store API) → exactly one `session` post with the new name.
- Nested in-place case: a nested field `sessionV1` copies (`rulesetSettings[ruleset].x`, or `channels[0].<field>`)
  changed in a `$state` source that the composed session spreads → exactly one `session` post with the new value
  (`sessionV1` copies deeply, so its `$derived` reruns and hands a new reference). If the store gives no way to change it
  except replacement, change it by replacement and say so in a comment.

### D. Owner — new `src/lib/client/components/surfaces/panel.identity.dom.test.svelte.ts`

Harness: copy `surfaces/panel.dom.test.svelte.ts`'s setup (read it; it mocks `uiWorkers` and sets the scoped contexts).
`Panel.svelte` hands `session` (`:305`), `resolved.settings` (`:308`, from `resolveWidgetInstance` over
`widgetSettingValues(instance.id)` — `src/lib/client/stores/widgetSettings.svelte.ts`) and `grantedScoped` (`:311`,
`projectScopedSections` over the scoped contexts) to `RemoteWidget`.

- 50 streamed frames (the session's rows changing as in C) → 0 posts and 0 stringifies of `session`, `settings`, and
  each granted scoped section (grant at least `session:full` and `persona` — persona is built fresh by
  `personaSection`, so it shows whether a rerun happens).
- One settings change through `setWidgetSettingValues(...)` (the store's only writer) → exactly one `settings` post with
  the new value; a settings write with equal values → 0 posts.
- One scoped change: replace the context's `current` (a `$state.raw` holder or getter over one) → exactly one
  `scoped` post for that section; a context that becomes `undefined` → one withdrawal (`value: null`).
- Nested in-place case for settings: there is no in-place writer (`setWidgetSettingValues` replaces `values`;
  `patchWidgetSettings` builds `next` and calls the writer) — pin that a write through the store API reaches the widget
  once. For scoped: a context whose `current` is a `$derived` built from a `$state` proxy, with that proxy mutated deep in
  place → exactly one post (the derived reruns → new reference).

If any test shows a value that changed but kept its reference (a missed update), **stop**: do not patch around it;
report the writer (file:line) and what it mutates.

## Files owned (edit only these)

- `src/lib/client/components/frames/widgetWire.svelte.ts` — only the three `push()` call sites, the withdrawal
  `heldFrom.delete`, and the comments named above.
- `src/lib/client/components/frames/widgetWire.perToken.dom.test.svelte.ts` (extend)
- new `src/lib/client/components/frames/widgetWire.identity.dom.test.svelte.ts`
- new `src/lib/client/components/host/remoteWidget.identity.dom.test.svelte.ts`
- new `src/lib/client/components/surfaces/panel.identity.dom.test.svelte.ts`

`RemoteWidget.svelte` and `Panel.svelte` are **not** yours to edit. If a test shows one of their derived inputs rebuilt
per streamed frame (a new reference with equal content → stringify count > 0), do not fix it: report the derived, its
line, and which read moved (use `$inspect.trace` only in a throwaway copy, never in the owned files).

## Files readable

Anything under `src/`. Especially: `frames/WidgetWireFixture.svelte`, `frames/widgetWire.oneMessage.dom.test.svelte.ts`,
`host/remoteWidget.grants.dom.test.svelte.ts`, `host/ComponentMount.svelte`, `surfaces/panel.dom.test.svelte.ts`,
`$lib/shared/widgets/context.ts` (`projectScopedSections` ~`:556`, `SCOPED_SECTION_SUPPLIERS` ~`:535`),
`$lib/shared/widgets/settings.ts` (`resolveWidgetInstance` ~`:531`).

## Rules (quoted from the lane brief and CLAUDE.md)

- P1: "a skipped post is one whose value is identical; a missed real change is a bug, not a saving. Tests prove both
  directions for every section touched."
- Svelte 5: "`$effect`/`$derived` reruns on any tracked read; use `untrack` deliberately and say why in a comment;
  `$state(new Map())` is not reactive." (CLAUDE.md: "`$state(new Set())` / `new Map()` is not reactive on mutation — use
  `SvelteSet` / `SvelteMap`.")
- "NOMENCLATURE §24/§25 for any new name." You add no name: no new option, export, setting or event. If you think you
  need one, stop and report.
- "Changing what any section carries" is out of scope: the posted values must be byte-identical to before.
- Out of scope: `PluginFrame.svelte`; the messages section's rules; any throttle or timer.

## Commands

- Tests, capped: `systemd-run --user --scope -p MemoryMax=6G npx vitest run <files>` from `/home/jody/github/serene-pub`.
  Run: your new/extended files, then all of `src/lib/client/components/frames/`, `src/lib/client/components/host/`,
  `src/lib/client/components/surfaces/` (dom tests included). Report counts.
- `npx tsc --noEmit -p .` filtered to your files (`| grep -E "widgetWire|remoteWidget.identity|panel.identity"`).
- Prettier: `npx prettier --check <file>` on each new test file (must pass). `widgetWire.svelte.ts` and
  `widgetWire.perToken.dom.test.svelte.ts` — check first; if unclean at HEAD, format your own lines by hand to match the
  surrounding style and never `--write` the file.

Never run `git stash` in any form, including `--keep-index` or to probe prettier; it stashes every other lane's uncommitted work. Use `npx prettier --check <file>`.

Never commit. Never `npm test` or `npm run build` at the SDK root. Delete only the `/tmp/serene-pub-vitest-*` dirs your own tests made, by name; never a glob over `/tmp/serene-pub-*`.

Before any `sdk:build`, check `pgrep -af "vite dev"` for a serene-pub server. If one is up, don't build; report 'blocked on your dev server'. (You need no `sdk:build`.)

Never pipe vitest into `head`. Run int and dom tests in a capped scope: `systemd-run --user --scope -p MemoryMax=6G npx vitest run <files>`.

Never `git checkout`, `git restore` or `git stash` in `../serene-pub-sdk`. Never `prettier --write` a file that was unclean at HEAD.

## Stop and ask when

CLAUDE.md §Decisions applies; a test shows an owner's value mutated in place (name the writer, file:line); you would
need to edit a file not listed above.

## Done means

The five files above; the tests in A–D green; the three folders' dom tests green (name any failure that is pre-existing:
re-run it alone and say whether it fails without your change by reading the assertion, not by stashing); `tsc` clean on
your files; prettier as above.

## Report

Hand back (your final message) a report: changed files; per-section post and stringify counts before/after for test A
and for C and D (50 frames); test files with pass counts; any derived you found rebuilt per frame (file:line, the read
that moved); anything you could not prove. Nothing written to disk as a report.
