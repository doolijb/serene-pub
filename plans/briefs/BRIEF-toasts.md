# BRIEF — lane `toasts` (2026-11-08): every raw toast goes through `notify`

**Owner ask (2026-11-08):** "convert every single toast that's bypassing the central system."
Supervisor: read `.claude/guides/multi-agent.md` first. You own this lane; hand the typing to at most **2 `lane-worker`s** (split below), check their work, write the report.

## Goal

Every client call to `toaster.error / .success / .info / .warning / .create` outside the two toast modules
becomes a `notify.<level>(…)` call from `$lib/client/utils/notify` (≈467 calls in ≈128 files today:
`grep -rln "toaster\." src --include=*.svelte --include=*.ts`). When done, the only importers of
`$lib/client/utils/toaster` are `notify.ts`, `Layout.svelte`'s `<Toast.Group {toaster}>` mount (if that is
where the group is mounted — check), and tests.

## The canon you apply (STYLE-GUIDE.md §6.21, ruled 2026-10-24 — quote it to workers)

> A toast is raised through `src/lib/client/utils/notify.ts`, never the raw toaster: errors and warnings
> leave after 8s, success and info after 4s; a `source` key replaces the previous toast from the same source
> instead of stacking; a change the control already shows (a switch flipping, a mode or a theme changing) is
> `silent` and raises nothing; and a failure found by a background poll (`fromPoll`: an Ollama's version
> check or running-models list, a model sync nobody forced, another tab's broadcast) never toasts.

Read `src/lib/client/utils/notify.ts` (whole file, ~90 lines) and `toaster.ts` first.

## Rules for each call

1. **Default: a straight swap, same words, same level.** `toaster.error({ title, description })` →
   `notify.error({ title, description })`. Keep any `duration`. Change no title or description text.
2. **`source`:** add one when the call sits in a handler that can fire repeatedly for one thing — a socket
   `:error` / refusal / result listener, or a retried action. Name the speaker, not the sentence
   (`"socket:lorebooks:update:error"`, `"connections:sync"`). This only stops identical repeats stacking.
3. **`silent` and `fromPoll`: never guess.** Apply one only when the code shows it plainly:
   `fromPoll` when the triggering emit is from an interval/poll/reconnect re-ask/other-tab broadcast
   (cite the emit's file:line); `silent` only for a success/info whose control already shows the new state.
   **Never `silent` or `fromPoll` on an error or warning raised by a user's press.** Every one you apply
   goes in the report's table (file:line, flag, one-line evidence). If unsure, plain swap and list it under ★.
4. **Options `notify` lacks** (`id`, `type: "loading"`, `action`, `closable`, `meta`, promise toasts,
   `toaster.dismiss/update`): a caller-supplied `id` maps to `source` when it is a dedupe key. Anything else
   **stop and ask** — do not widen `notify`'s API without the lead (that's a new name; CLAUDE.md Decisions).
5. **Indirect callers** (a toaster method passed as a callback, e.g. `(t) => toaster.error(t)` in
   `routes/+page.svelte:972`; helpers that build a toast object then call `toaster.x(obj)`): convert at the
   call; the helper's object shape must fit `NotifyOptions` (`title` required).
6. **Tests** that mock `$lib/client/utils/toaster` keep working (notify calls the same four methods). A test
   that asserts exact arguments may now see `id: "notify:<source>"` — update the assertion, never the product.
   Tests that mock `notify` instead are fine too. Fix only tests your change broke.
7. Don't touch the SDK repo. Don't move toasts between files. Don't reword copy. Don't touch server code.

## Files owned

- Worker 1: `src/lib/client/components/**` (≈72 files).
- Worker 2: `src/lib/client/admin/**`, `src/lib/client/lorebooks/**`, `src/lib/client/contexts/**`,
  `src/lib/client/utils/**` (except `notify.ts`, `toaster.ts` — read-only), `src/routes/**` (≈56 files).
- Supervisor: the tests next to any of those files that break; `STYLE-GUIDE.md` §6.21 only if a sentence
  there becomes untrue (likely none; the ⏳ about the Activity dot stays).

## Files readable

Everything. `STYLE-GUIDE.md` §6.21 (≈line 2140), `notify.ts`, `toaster.ts`, `notify.test.ts`.

## Out of scope (write down, never build)

- Moving toasts out of views into the domain socket contexts (CLAUDE.md sockets ruling: "views … never call
  `toaster`"). List the view files that toast from a socket listener under **Noticed, not done** with a count.
- Routing poll failures to the Activity dot (⏳ in §6.21).
- Any new `notify` option, level or export.

## Stop and ask when

CLAUDE.md §Decisions applies; a call needs an option `notify` lacks (rule 4); a `silent`/`fromPoll` call is
not plain from the code; anything would change copy.

## Done means

- `grep -rn "toaster\.\(error\|success\|info\|warning\|create\|dismiss\|update\|promise\)" src --include=*.svelte --include=*.ts`
  lists only `notify.ts`, `toaster.ts`, the Toast.Group mount and test files.
- `npx tsc --noEmit -p .` and `npm run check` add **no new errors** (baseline both before you start; record
  the counts). Run them inside a capped scope, one after the other:
  `systemd-run --user --scope -p MemoryMax=12G -p MemorySwapMax=0 --quiet bash -c 'export NODE_OPTIONS=--max-old-space-size=8192; npx tsc --noEmit -p . > toasts-tsc.log 2>&1; echo tsc-exit=$? >> toasts-tsc.log'` (same shape for `npm run check`).
- The test files that mock or import `toaster` or `notify` pass:
  `grep -rlE "utils/(toaster|notify)" src --include=*.test.ts --include=*.test.svelte.ts`, run with
  `npx vitest run <files> --maxWorkers=2` in a 6G capped scope, logged to a file, `echo test-exit=$?` appended.
  Never pipe vitest into `head`.
- `npx prettier --check` on every changed file.

## Report

`plans/REPORT-toasts-2026-11-08.md` (if the harness refuses the write, put the full report in your final
message; the lead saves it). Sections: counts before/after; changed files by worker; the `silent`/`fromPoll`
table; `source` keys added (count + naming pattern); tests run with results; tsc/check baseline vs after;
open ★; **Noticed, not done**.

## Verbatim rules

- *This is an implementation task. Answer any relayed status question in one line in your report, and still do all the work.*
- *Never run `git stash` in any form, including `--keep-index` or to probe prettier; it stashes every other lane's uncommitted work. Use `npx prettier --check <file>`.*
- *Never commit. Never `npm test` or `npm run build` at the SDK root. Delete only the `/tmp/serene-pub-vitest-*` dirs your own tests made, by name; never a glob over `/tmp/serene-pub-*`.*
- *Before any `sdk:build`, check `pgrep -af "vite dev"` for a serene-pub server. If one is up, don't build; report 'blocked on your dev server'.* (This lane should need no `sdk:build`.)
