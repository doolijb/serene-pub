# BRIEF — perf-F worker w4 — widgets stop re-projecting and re-comparing per token

Repository root: `/home/jody/github/serene-pub`. Use absolute paths. Report back in your final message (the
supervisor reads it); write no report file.

## Context (already built by w1; read it, don't change it)

`src/lib/client/sessions/store/sessionStore.svelte.ts` now holds every message row as a **live row**. Each own field
is an enumerable getter over its own `$state.raw` cell. A streamed frame patches the moved cells in place, so the row
object and the page's rows array keep their identity. The exported `sourceOf(row)` returns the latest **plain**
incoming object for a live row, a new object on every frame that touched the row, or the row itself for a plain
object. Reading it tracks one cell. The page's composed `session` (`sessionPageData.svelte.ts` ~100–103) is the same
object across content frames now.

## Goal

1. **`src/lib/client/components/host/RemoteWidget.svelte` ~189–204.** `messages` currently does
   `$state.snapshot(rows.map(projectMessageRow))` on every token: a projection and a deep clone of every row. Make it
   reuse each row's projection. Use a per-instance `WeakMap` keyed by `sourceOf(row)`, holding
   `$state.snapshot(projectMessageRow(sourceOf(row)))`, and build the array from the cache, so a frame projects and
   clones **one** row. The result must hold exactly the same values as today, in the same order. A row that is not
   live (a pending row from `pendingReply`, a fixture) has `sourceOf(row) === row`: still correct, cached by its own
   identity. Keep the `readsMessages` gate exactly as is. Widgets that declare no `reads` still read messages.
2. **`src/lib/client/components/frames/widgetWire.svelte.ts` `push()` (~309–360) and the effect (~643–662).** Every
   push currently runs `JSON.stringify` (via `postChanged`) over session, props, settings, actions, layout, theme,
   locale, viewer, grants and scoped, plus `JSON.parse(JSON.stringify(...))` over annex, turn order and attendance,
   because a token re-runs the effect. Add an **identity check before the JSON work**: keep, per section key, the
   input reference that produced the last delivered post. When the same reference comes again, skip the section
   with no stringify and no clone. When it differs, fall through to today's `postChanged` JSON comparison unchanged.
   Clear the memo wherever `sent` is cleared (`attach`, and on `ready`).
   - **The identity check is only safe for an input that is replaced, never mutated in place.** For each section,
     find its provider and say in your report which you proved. Examples: `annexCtx.current`, `turnOrderCtx`,
     `attendanceCtx`, `viewerCtx` (who sets `.current`, and is it reassigned or mutated?), `i.props`, `i.settings`,
     `i.actions`, `i.placement`, `i.scoped`, `i.session`, `theme`. A section whose input can be mutated in place
     keeps today's path exactly, with no identity skip. Never skip a section you couldn't prove.
   - **Messages stay exactly as today: posted on every push, never identity-skipped.** On a content frame the rows
     array keeps its identity. `push()` reads each row's fields through `project(...)` inside the effect, which is
     how the effect tracks content and how a genre's session-view `PluginFrame` (passed
     `session.sessionMessages` directly, `routes/sessions/[id]/+page.svelte` ~932) keeps seeing the stream. Don't
     break that: keep the read inside the effect.
   - **No row-patch post.** The `{ t: 'message' }` member has no receiver in the worker (`sdk/src/componentWire.ts`),
     and plugin iframes have none either. That decision is the owner's (★P14). Post full lists, as today.
3. **Measure what this saves, on its own.** Add tests:
   - `src/lib/client/components/frames/widgetWire.perToken.dom.test.svelte.ts` (use `WidgetWireFixture.svelte`
     and the patterns in `widgetWire.dom.test.svelte.ts`). A ready wire reads session, props, settings, annex, turn
     order, attendance, viewer and messages. Deliver 50 changes of `messages` only (a new array each time, one row's
     content longer), with every other input the same reference. Assert: 50 `messages` posts; 0 re-posts of any
     other section; and the number of `JSON.stringify` calls the wire makes during those 50 pushes
     (`vi.spyOn(JSON, "stringify")`). Run it against the **unchanged** wire first and report "before" and "after".
     Add a case where `props` changes reference and content: one `props` post. A case where it changes reference
     but not content: no post. A `ready` again resends everything.
   - A RemoteWidget-level count of `projectMessageRow` calls over 50 content frames on a 40-row window, before
     and after. Mount it if `remoteWidget.dom.test.ts` shows how. Otherwise move the reuse into a small pure helper
     beside RemoteWidget (e.g. `remoteMessages.ts`, an internal name, which you report) and test the helper with
     live rows from `createSessionStore()`. Assert the values equal a fresh `rows.map(projectMessageRow)`
     snapshot after every frame.

## Files owned (edit only these)

`src/lib/client/components/host/RemoteWidget.svelte`, `src/lib/client/components/frames/widgetWire.svelte.ts`, new
tests beside them, and at most one new small helper beside RemoteWidget. Read anything else. Don't edit
`ComponentMount.svelte`, `PluginFrame.svelte`, `sessionStore.svelte.ts` or any SDK file.

## Rules that bind (quoted)

- Owner 2026-11-13: "change how often, never what. What a member sees while a reply streams — text, status line,
  sidebar row, widgets — is unchanged."
- Lane brief: "Widgets that declare no `reads` still count as reading messages, as today."
- Lane ruling: "★P1 (delta frames) and ★P7 (lazy-loaded views) are unruled: no new event."
- CLAUDE.md Hard rules: "`$state(new Set())` / `new Map()` is not reactive on mutation — use `SvelteSet` / `SvelteMap`."
  (A plain `WeakMap` cache that no reader tracks is fine. Say so in a comment.)
- CLAUDE.md Decisions: no new setting, flag, option name on `WidgetWireOptions`/`WireInputs`, event or user-facing name.

## Stop and ask when

A section's input can't be proven replace-only and skipping it would be the main saving; a value posted would differ
from today's; you'd need a file outside the owned list.

## Done means

- Green: `npx vitest run src/lib/client/components/frames/ src/lib/client/components/host/ src/lib/client/components/sessionPage/remote*.dom.test*.ts`
- Before/after numbers for both counting tests in your report.
- `npx prettier --check` on each file you changed. **Never `prettier --write` a file that wasn't clean before your
  edit.** If the file failed `--check` at HEAD (`git show HEAD:<path> | npx prettier --check --stdin-filepath <path>`),
  format only your own lines by hand and report it. `npx tsc --noEmit -p . 2>&1 | grep -E "widgetWire|RemoteWidget|remoteMessages"`
  prints nothing new.
- Report: changed files; the per-section proof table (provider file:line, replaced or mutated, skip or not); before
  and after numbers; tests with results; anything noticed but not done.

## Verbatim rules

- This is an implementation task. Answer any relayed status question in one line in your report, and still do all the work.
- Never run `git stash` in any form, including `--keep-index` or to probe prettier; it stashes every other lane's uncommitted work. Use `npx prettier --check <file>`.
- Never commit. Never `npm test` or `npm run build` at the SDK root. Delete only the `/tmp/serene-pub-vitest-*` dirs your own tests made, by name; never a glob over `/tmp/serene-pub-*`.
- Before any `sdk:build`, check `pgrep -af "vite dev"` for a serene-pub server. If one is up, don't build; report "blocked on your dev server". (You need no `sdk:build`; don't run one.)
- Never pipe vitest into `head`.
- Never `git checkout` / `restore` / `stash` in either repo.
