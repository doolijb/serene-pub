# BRIEF — fix lane `ss-2a-fix` — scope review of lane `ss-2a` (programme 2.1)

Repo `/home/jody/github/serene-pub`. Supervisor: read `.claude/guides/multi-agent.md`,
`plans/REPORT-ss-2a-2026-11-16.md` (all of it, the scope review at the end) and `plans/briefs/BRIEF-ss-2.md`
with its corrections (its rules on git, prettier, tests and transactions apply unchanged). Wait for other lanes'
tests with `until ! pgrep -f "^node .*vitest" >/dev/null; do sleep 5; done`. `NODE_OPTIONS=--max-old-space-size=10240`
for `tsc` and `npm run check`. No migration, no SDK change, no full run, no `npm run build`. Never commit.

This is an implementation task. Answer any relayed status question in one line in your report, and still do all the work.

Owner (2026-11-15): "lets focus on just cleaning up the mess". P2: two writers of one thing is a bug; the brief
asked for one resolver, no second layering.

## Fixes

1. **One rule for "would the run use this value?"** in `pipelines/registrations/values.ts` (🚧 name yours,
   recorded in NOMENCLATURE §25), holding exactly the run's skip rules (`config/world.ts` ~947, ~977, ~983:
   `null`, a prompt value that is not a number or names no prompt, a dangling template, a layout that does not
   fit). `world.ts`, the panel (`config/panel/read.ts` ~156), the fold (`boot/sessionOverrideFold.ts` 181–208)
   and the attic (`attic/finish.ts` `sessionLayerHolds`) all call it; no copy of the rule remains. If `world.ts`
   cannot call it without a behaviour change, stop and report.
2. **The panel merges a prompt the way the run does** (per field, the old row filling fields the registration's
   prompt lacks: `world.ts` ~1083–1092 vs `read.ts` 166–170), so what the panel shows is what the run reads, for
   the rows the fold deliberately leaves. Prefer one shared function over a second implementation.
3. **The fold never changes another address.** Before writing, compute the key's merged values and check they
   read back as the current values plus exactly the one address; otherwise leave the row and count it as
   unmappable. `declared` is checked per address, as the file's header says. A path-`""` row on a slot where the
   key holds values by path is left.
4. **Report accuracy:** drop the "first session row" item; in `docs/pipelines.md` (where the lane described the
   upgrade, if it did) and in the lane report's ★2, say that after the fold a value lives on the registration
   keys in force then; a key that arrives later does not inherit it.
5. **Several keys:** the panel shows the first key's values while each run reads its own key's. Inventory only:
   when can a session have two keys for one pipeline with different values, and does the card's write (every
   key, one transaction) make them equal again? Report; build nothing.

## Tests

For 1: one table-driven test of the rule, and the existing `worldPipelineLayer`, panel, fold and attic tests
unchanged and green. For 2: a session with a registration prompt lacking a field and an old row holding it: the
panel and the run's world show the same resolved prompt. For 3: a path-`""` row over by-path values is left and
counted; a second boot changes nothing. Then the lane's earlier lists (`plans/` logs of ss-2a runs 1 and 2).

## Files owned

`pipelines/registrations/values.ts`, `pipelines/config/world.ts` (only to call the shared rule),
`config/panel/read.ts`, `boot/sessionOverrideFold.ts`, `attic/finish.ts` (`sessionLayerHolds`), their tests,
`docs/pipelines.md` (one sentence), `NOMENCLATURE.md` (§25). Not `sessions/settingsForm.ts` beyond reading it.

## Report

Final message = the report (lead appends it to `plans/REPORT-ss-2a-2026-11-16.md`): per fix, what changed, the
test; the inventory for 5; **Noticed, not done**. Under about 400 words.
