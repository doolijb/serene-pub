# BRIEF — worker `s4-rul-a-w2` (2026-11-10) — rename overhear → hidden stats (names only, no behaviour change)

Supervisor: lane `s4-rul-a`. App repo `/home/jody/github/serene-pub`, SDK repo `/home/jody/github/serene-pub-sdk`. Use absolute paths.

## Goal

The owner vetoed the word **overhear** (quote, never reinterpret): *"Think of a more appropriate name, or better organize the secrets terms within a context"*. The answer they picked was **Hidden stats wording**:
- UI label **"Show hidden stats"**;
- help line *"Stats only ‹name› knows, on your screen only. The AI still plays ‹name›."*;
- SDK request **`show-hidden-stats`**;
- flag **`SessionStateOwnerV1.showingHiddenStats`**.

Rename every `overhear` / `overheard` / `overhearing` / *Show secrets* in the files below to the names in this table. **Names only.** Who may do what is not touched: another worker changes the behaviour after you. Comments that describe the behaviour keep their meaning (for example "read-only", "never a write gate"). Swap only the word.

| Old | New |
|---|---|
| SDK request `'overhear-seat'` (`sdk/src/widgets.ts`: the request map ~2162, the grant ~2909, the reach ~3026, the doc ~2155) | `'show-hidden-stats'` |
| SDK `SessionStateOwnerV1.overhearing?` (~946–950) | `showingHiddenStats?` (rewrite its JSDoc sentence in the new words) |
| app `Sockets.State.StateOwnerRow.overhearing?` (`src/lib/shared/sockets/types.ts` ~17238) | `showingHiddenStats?` |
| app `State.Get.Params.overhear?: string[]` (`types.ts` ~17374) | `showHiddenStats?: string[]` |
| `state/earshot.ts` `overheard(hearing, links, memberIds)` | `hearingWithHiddenStats(hearing, links, memberIds)` |
| `sockets/state.ts` `overheardMembers(socket, sessionId)` | `hiddenStatsShownMembers(socket, sessionId)` |
| per connection `socket.data.overhear` | `socket.data.hiddenStatsShown` |
| `describeState` param `overhearing`, local `overhearingOf`, the owner-row field `overhearing` | `hiddenStatsShown`, `showingHiddenStatsOf`, `showingHiddenStats` |
| `state:get` reading `params.overhear`, local `overhearing` in `stateGet` | `params.showHiddenStats`, `hiddenStatsShown` |
| client `sessionState.svelte.ts`: `const overheard = new SvelteSet`, `setOverhearing(ref, on)`, the `overhear:` key it sends on `state:get` | `hiddenStatsShown`, `setShowingHiddenStats(ref, on)`, `showHiddenStats:` |
| `requests/overhearSeat.ts` → **rename the file** `requests/showHiddenStats.ts`; `answerOverhearSeat`, `OverhearSet` | `answerShowHiddenStats`, `ShowHiddenStatsWrite` |
| `requests/overhearSeat.test.ts` → **rename** `requests/showHiddenStats.test.ts` | |
| `requests/index.ts` import and the `"overhear-seat":` answerer entry | the new names |
| `projections/sessionState.ts` ~129–131: `overhearing` passthrough and its TODO | `showingHiddenStats` (keep the TODO cast; it waits on the SDK build) |
| `widgets.css` `[data-widget-part~="stats.overhear-switch"]` (~5290, ~5329) | `stats.hidden-stats-switch` |
| core-catalog `StatsWidget.svelte`: `overhearBlock`, `setOverhear`, `overhearError`, parts `stats.overhear` · `stats.overhear-switch` · `stats.overhear-help` · `stats.overhear-error`, `owner.overhearing`, the request name, `t("Show secrets")` (label and `aria-label`), the help string | `hiddenStatsBlock`, `setShowHiddenStats`, `hiddenStatsError`, parts `stats.hidden-stats` · `stats.hidden-stats-switch` · `stats.hidden-stats-help` · `stats.hidden-stats-error`, `owner.showingHiddenStats`, `'show-hidden-stats'`, `t("Show hidden stats")`, `t("Stats only {name} knows, on your screen only. The AI still plays {name}.")` |
| server test `sockets/state.overhear.int.test.ts` → **rename** `sockets/state.hiddenStats.int.test.ts` | update names and describe titles |
| `state/earshot.overheard.test.ts` → **rename** `state/earshot.hiddenStats.test.ts` | |
| `../serene-pub-sdk/INTEGRATING.md` ~1256–1258 | the new request and flag names, same sentence shape |
| `docs/stats-and-states.md` ~232 | **Show secrets** → **Show hidden stats**. Don't change the other sentences; the next worker rewrites the behaviour lines. |

Comments everywhere: *Show secrets* → *Show hidden stats*; "overhear(s/ing) a seat" → "show(s/ing) a seat's hidden stats". Keep the 🚧 marks.

Rename files with plain `mv`. **Never `git mv`, `git checkout`, `git restore` or `git stash`**, in either repo.

After the SDK edits, regenerate the parts list and run its test:

```
cd /home/jody/github/serene-pub-sdk && npx tsx scripts/gen-widget-parts.ts
cd /home/jody/github/serene-pub-sdk/sdk-tests && npx tsx --test widgetParts.test.ts > /tmp/claude-1000/-home-jody-github-serene-pub/9382c94a-1330-4480-b65e-0cfdb1f75e97/scratchpad/s4-rul-a-w2-widgetparts.log 2>&1; echo exit=$? >> /tmp/claude-1000/-home-jody-github-serene-pub/9382c94a-1330-4480-b65e-0cfdb1f75e97/scratchpad/s4-rul-a-w2-widgetparts.log
```

That regenerates `../serene-pub-sdk/guides/widgets.md`; never hand-edit its parts line. Don't run anything else at the SDK root.

Then check that nothing still says the old word:

```
grep -rn "overhear\|Overhear\|overheard\|Show secrets\|Shows what only" /home/jody/github/serene-pub/src /home/jody/github/serene-pub/docs /home/jody/github/serene-pub-sdk/sdk/src /home/jody/github/serene-pub-sdk/core-catalog/components /home/jody/github/serene-pub-sdk/INTEGRATING.md /home/jody/github/serene-pub-sdk/guides | grep -v "src/lib/generated"
```

Expect no hits. Leave `src/lib/generated/**` alone (it is generated) and `NOMENCLATURE.md` alone (the lead's).

## Tests

Capped scope, logged:

```
cd /home/jody/github/serene-pub && systemd-run --user --scope -p MemoryMax=6G -p MemorySwapMax=0 --quiet bash -c 'export NODE_OPTIONS=--max-old-space-size=4096; npx vitest run src/lib/server/sockets/state.hiddenStats.int.test.ts src/lib/server/state/earshot.hiddenStats.test.ts src/lib/client/components/sessionPage/requests/showHiddenStats.test.ts src/lib/server/state/earshot.test.ts src/lib/server/sockets/state.earshot.int.test.ts src/lib/client/state/sessionState.test.ts --maxWorkers=2 > /tmp/claude-1000/-home-jody-github-serene-pub/9382c94a-1330-4480-b65e-0cfdb1f75e97/scratchpad/s4-rul-a-w2-tests.log 2>&1; echo test-exit=$? >> /tmp/claude-1000/-home-jody-github-serene-pub/9382c94a-1330-4480-b65e-0cfdb1f75e97/scratchpad/s4-rul-a-w2-tests.log'
```

Never pipe vitest into `head`. An int test that opens a DB inside an `it` needs a 60 s timeout.

The app's `@serene-pub/sdk` resolves to the SDK's **dist**, which is not rebuilt (the owner's dev server is up, so **no `sdk:build`**). `tsc` will therefore show the renamed request/flag as unknown in exactly the places the old names errored today:
- `requests/index.ts`: the answerer entry;
- `requests/showHiddenStats.ts`: the `WidgetRequests[...]` lookup.

That is expected. Don't work around it beyond the existing TODO cast. Run `npx tsc --noEmit -p .` under `systemd-run --user --scope -p MemoryMax=12G -p MemorySwapMax=0 --quiet bash -c 'export NODE_OPTIONS=--max-old-space-size=8192; …'`, log it to `s4-rul-a-w2-tsc.log` in the scratchpad, and list every error in your report.

## Files owned

- `src/lib/server/state/earshot.ts` (the rename only), `src/lib/server/sockets/state.ts` (the rename only)
- `src/lib/shared/sockets/types.ts`: **only the two lines named above, in the `State.*` namespaces.** Another lane owns other rows. Use exact-string edits only and **never run `prettier --write` on this file**.
- `src/lib/client/state/sessionState.svelte.ts`, `src/lib/client/styles/widgets.css` (the two selectors), `src/lib/client/components/sessionPage/projections/sessionState.ts`, `src/lib/client/components/sessionPage/requests/index.ts`, the renamed request file and its test
- the two renamed server test files
- `../serene-pub-sdk/sdk/src/widgets.ts` (the request and the flag only), `../serene-pub-sdk/core-catalog/components/shared/stats/StatsWidget.svelte`, `../serene-pub-sdk/INTEGRATING.md` (that one sentence), `../serene-pub-sdk/guides/widgets.md` (regenerated only)
- `docs/stats-and-states.md` (the label only)

## Rules you work under (quoted)

- NOMENCLATURE **R1** *"One word, one meaning."* **R3** *"Qualify, never abbreviate to the bare noun."* "Hidden" already means other things in this app: the Stats copy setting *The game's own state → Hidden*, the message badge *Hidden from the story*, the retired per-seat *Hidden* visibility, hidden plugin **carrier cards**, and plugins' "hidden state" in storage. So the new word is always qualified: **hidden stats**, `HiddenStats`, `hidden-stats`. **Never a bare `hidden`** in a new name, part or label.
- NOMENCLATURE §24: *"Grep for it first — across `src`, the SDK, and the schema."* Before you settle each new name, grep it. If one collides, stop and say so in your report; don't pick another name yourself.
- The SDK names were never published (no build since they were added), so no migration note is needed. *"INTEGRATING (`../serene-pub-sdk/INTEGRATING.md`) and the guide examples move in the same change"* (modder rule, owner 2026-11-08).
- CLAUDE.md: *"`$state(new Set())` / `new Map()` is not reactive on mutation — use `SvelteSet` / `SvelteMap`."* Keep the `SvelteSet`.
- CLAUDE.md: *"Never `git checkout` / `restore` / `stash` in `../serene-pub-sdk` — most of it is uncommitted."*
- Prettier: run `npx prettier --check` on the files you changed, but only `--write` the lines you changed. Never reformat a whole file you didn't otherwise edit, and never `--write` `types.ts`. If a file fails the check only on lines you didn't touch, leave it and say so.
- *"Do what was asked, at the size asked. Findings along the way go under **Noticed, not done**, never fixed in passing."*

## Out of scope

- Any change to who may set, configure or decide, or to which proposals are listed. That belongs to the next worker.
- NOMENCLATURE (the lead's), `src/lib/generated/**`, any other `types.ts` row.

## Stop and ask (in your report) when

A new name collides on grep, a file outside the list still says `overhear`, or a test needs a behaviour change to pass.

## Done means

Grep clean; widget-parts test passes; the vitest files above pass; tsc shows only the SDK-build-waiting errors. Report (your final message): the changed and renamed files, every new name, test results with counts and log paths, the tsc errors, Noticed-not-done.

## Verbatim rules

- *This is an implementation task. Answer any relayed status question in one line in your report, and still do all the work.*
- *Never run `git stash` in any form, including `--keep-index` or to probe prettier; it stashes every other lane's uncommitted work. Use `npx prettier --check <file>`.*
- *Never commit. Never `npm test` or `npm run build` at the SDK root. Delete only the `/tmp/serene-pub-vitest-*` dirs your own tests made, by name; never a glob over `/tmp/serene-pub-*`.*
- *Before any `sdk:build`, check `pgrep -af "vite dev"` for a serene-pub server. If one is up, don't build; report 'blocked on your dev server'.*
