# BRIEF — lane `perf-M` — iframe plugin frames take the one-row post

**Supervisor:** read `.claude/guides/multi-agent.md` first, then `.claude/guides/review.md` §2. Plan:
`plans/PLAN-performance-2026-11-13.md` Part 1, Part 3 rulings table (★P14, 2026-11-13: "allow both: the member exists
and is @experimental; a `WidgetWireOptions` flag so the peer declares it understands it"), §4.2c row perf-M. Build on
`plans/REPORT-perf-H-2026-11-13.md` (what `peerTakesOneMessage` does, the first-frame rule, and the "Noticed" line
about the CLI harness). Read `../serene-pub-sdk/INTEGRATING.md` by section where it describes frames, and the frame
protocol doc comment in `sdk/src/surfaces.ts` (~`:1-60`, `:197-260`, `:360-460`).

## ★M-1 RULED YES (owner, 2026-11-14) — the hold below is lifted; the mechanics it describes stand

(Was:) HOLD — ★M-1 is unruled (challenger [C11], 2026-11-14)

★P14 as ruled (plan Part 3, 2026-11-13) says "`PluginFrame` keeps full lists (iframes have no receiver)", and the code
built under it says the same (`widgetWire.svelte.ts:186-188`, `sdk/src/surfaces.ts:224-229`). Extending the one-row
post to frames, and the field on `ready` that carries the declaration, is therefore a **new ruling + a new name**. The
lead asks the owner; this lane does not start until the plan's §4.2c records the answer. If ruled yes: the declaration
is read in `widgetWire.svelte.ts`'s `ready` handler (`:564-577`, where `push()` runs synchronously), reset on every
`ready` and in `attach()` (`:821-829`), and `PluginFrame.svelte` is **unchanged** (it sees only `wire.ready`). This lane
then runs **after perf-N reports** and owns that hunk.

**[C12] correction to step 3:** `cli/src/testing.ts` is `mountComponent` — it *posts* sections to a component in a
Node Worker (`pushSection`, `:846-876`); the receiver is the SDK's `componentWire.ts`, which already handles `message`.
So step 3 is: **the harness posts `{ t: 'message' }` for a streamed update, as `ComponentMount` does** (perf-H's
"Noticed" line). The frame preview harness is `ui-preview/src/lib/framePort.ts` — not owned; note it under Noticed.

## Goal

A plugin frame (an iframe on the host's MessageChannel) today receives `{ t: 'messages', messages }` — the whole
window — on every streamed frame, because an iframe has no SDK-run receiver and the host cannot know what the plugin's
own code handles. Make it opt in: **a frame declares on its `ready` that it takes the one-row post**, and from then
on the host posts `{ t: 'message', message }` for a streamed update exactly as it does for a `ComponentMount`
(same rule: one changed, generating row; ids/order/channels unchanged; else the full list). A frame that says
nothing keeps full lists forever.

## What to build

1. **SDK protocol (`sdk/src/surfaces.ts`):** the `ready` member of `FrameHostMessage` gains one optional field
   naming the host messages the frame takes beyond the baseline — one entry today, `'message'`. Name the field per
   NOMENCLATURE §24 (grep first; `takes` is the candidate the plan used; a declaration *of understanding*, not a
   grant, not a read — say what it is not in the doc comment). Mark it `@experimental` like the member it enables.
   Document in the protocol comment: when the host posts `message`, that the first frame of a run is a full list,
   and that a frame may ignore it only by not declaring it. **★M-1:** the field is a new name, ruled ★M-1 (2026-11-14); record it 🚧 in §25
   with both rulings (★P14, ★M-1).
2. **Host (`PluginFrame.svelte`):** on `ready` (`:564`), read the declaration and set the wire's
   `peerTakesOneMessage` for this frame. The wire option is a construction-time boolean today — see whether
   `createWidgetWire` can take it as a getter or whether `ready` arrives before the first push (it does: pushes
   wait for `ready`); choose the smallest change and, if `widgetWire.svelte.ts` must change, queue the exact
   hunk in the report (perf-N owns that file this round) unless perf-N has already reported.
3. **CLI harness (`../serene-pub-sdk/cli/src/testing.ts:854`):** handle `message` the way `componentWire.ts`
   does (replace by id in the held list; unknown id ignored), and let a harness test declare it on `ready`, so a
   plugin author's test can exercise exactly what core sends.
4. **Docs:** the SDK guide page that documents the frame protocol gets the one paragraph (how to declare, what then
   arrives); `docs/plugins*.md` only if it describes frame messages.

## Rules you quote into every worker brief

- P1: the settled row and every add/remove/reorder still arrive as the full list; a frame that declares nothing sees
  byte-identical traffic to today (test it).
- P5: a declaration from the plugin, never a host setting. P3: no setting.
- The frame boundary is a security boundary: nothing new crosses but the row the frame already received in lists.
- NOMENCLATURE §1, §12 (extensions), §24, §25 append. "It is a session, never a chat."
- SDK edits in `../serene-pub-sdk`; never `git checkout/restore/stash` there. `sdk:build` only at the end,
  after `pgrep -af "vite dev"` is empty and after messaging the lead ("main") and waiting for the go.
- Removing or renaming a published SDK name is the owner's call — this lane only adds.

## Files owned

`src/lib/client/components/frames/widgetWire.svelte.ts` (the `ready` handler and `attach()` reset only — after perf-N reports), `src/lib/client/components/frames/PluginFrame.svelte` (expected unchanged; + dom tests), SDK
`../serene-pub-sdk/sdk/src/surfaces.ts`, `../serene-pub-sdk/cli/src/testing.ts` (+ its tests),
`../serene-pub-sdk/sdk-tests/` (frame protocol tests: extend or add one file), the SDK guide page for frames
(`../serene-pub-sdk/guides/` or `docs/` — find it), `docs/plugins*.md` (one paragraph at most),
`NOMENCLATURE.md` §25 (append only).

## Out of scope

Changing `componentWire.ts` or `ComponentMount`; batching, compression, deltas of text (the row crosses whole);
any host-side default that turns the option on without the declaration; touching `widgetWire.svelte.ts` (queue it).

## Stop and ask when

CLAUDE.md §Decisions applies; the `ready` member cannot carry a field without breaking an existing consumer (name
it); the option cannot be set after construction without a `widgetWire.svelte.ts` change and perf-N has not reported.

## Done means

- dom test: a frame whose `ready` declares it receives one `message` per streamed frame and the full list on
  settle/add/remove; a frame whose `ready` does not declare it receives exactly what it does today (snapshot the
  sequence for 5 frames + settle in both cases).
- SDK tests: the harness replaces by id on `message`, ignores unknown ids, and a harness run with the declaration
  sees `message` posts; existing frame protocol tests green; `tsc --noEmit` in `sdk-tests` clean.
- Existing green: `frames/*` dom tests, `spFrame*`, `widgetWire*`; `npx tsc --noEmit -p .` clean on touched
  files; `prettier --check` on each.

## Report

`plans/REPORT-perf-M-2026-11-13.md` (dated 2026-11-14 inside): changed files, the exact `ready` shape, the two
snapshot sequences, tests with counts, ★M-1, **Noticed, not done**.

Every worker brief carries verbatim:
- "This is an implementation task. Answer any relayed status question in one line in your report, and still do all the work."
- "Never run `git stash` in any form, including `--keep-index` or to probe prettier; it stashes every other lane's uncommitted work. Use `npx prettier --check <file>`."
- "Never commit. Never `npm test` or `npm run build` at the SDK root. Delete only the `/tmp/serene-pub-vitest-*` dirs your own tests made, by name; never a glob over `/tmp/serene-pub-*`."
- "Before any `sdk:build`, check `pgrep -af "vite dev"` for a serene-pub server. If one is up, don't build; report 'blocked on your dev server'."
- "Never pipe vitest into `head`. Run int and dom tests in a capped scope: `systemd-run --user --scope -p MemoryMax=6G npx vitest run <files>`."
- "Never `git checkout`, `git restore` or `git stash` in `../serene-pub-sdk`. Never `prettier --write` a file that was unclean at HEAD."
