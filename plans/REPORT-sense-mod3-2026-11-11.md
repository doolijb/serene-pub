# REPORT — lane `sense-mod3` — 2026-11-11

Written by the lead from the supervisor's final message. Three accepted fixes from the scope review of `sense-mod`.
Each has a test watched to fail on the old code and pass on the new (one exception below).

## Built

1. **The reason a model was unloaded is on the visible card.**
   `src/lib/client/components/connections/ManagedConnectionView.svelte`: one muted line under the "Loaded model" /
   **Unload** row, shown whenever the last status push carries a reason. Reads the `subStatus` the view already
   has; no new listener, event or toast. Removed from `KoboldCppPerfTab.svelte` (Details), so it shows in one place.
2. **The first-model fill cannot overwrite a choice.** `src/lib/server/koboldcpp/fillReplyOnArrival.ts`: the
   emptiness read and the write run in one `db.transaction` using only `tx`; a `connections:setDefault` arriving
   meanwhile waits for the commit and lands last. The module-level promise chain is gone (the transaction does its
   job). The endpoint lookup, row lookup and `starRefusal` run before the transaction, so they now run even when
   Reply is already filled, once per finished download. `capabilityDefaults.ts` untouched (it already takes `tx`).
3. **One spelling of the Managed address.** `KoboldCppSettingsTab.svelte`: the Managed Server URL shows the stored
   address.

Docs: `docs/connections.md`, the co-load paragraph.

## Tests

Capped, 6 files, **73/73**: `fillReplyOnArrival.int.test.ts` (two new), NEW
`connections/managedConnectionView.dom.test.svelte.ts`, NEW `koboldcppManager/koboldCppSettingsTab.ssr.test.ts`,
and three neighbours. Fail-before run for each item by swapping the old code back in. "Two fills fired at once set
exactly one model" also passed on the old code (the old chain serialised fills); it now guards the transaction.
`tsc`: no errors in the lane's files.

## Open ★

None new. Still open for the owner: `koboldcpp:setManagedPort` and the binary-install write rewrite the address
without checking the mode.

## Noticed, not done

- `commentHistory.test.ts` is red on 9 files outside this lane (the handover's known list).
- The Managed Server URL hint "Follows the port below." is briefly untrue for an imported 0.5.3 row until the next start repairs the address.
- Two empty `/tmp/serene-pub-vitest-*` dirs (`7uA1QE`, `f2gZTq`) may be this lane's; not deleted because another lane was running vitest at the same moment.
