# Scripts at seams — one list per node, in config

**Status:** PROPOSED 2026-10-10, all open items ruled the same day (R-O1, R-O2 at the end). Unbuilt. Planning is not go.

## Rulings (owner, 2026-10-10)

1. Scripts stay **admin-only**: written only in the admin Pipelines venue, never a session override.
2. Each node's panel ends with **one ordered list of script entries**. Entries are **scoped by the node's spec**: the picker offers only scripts some seam of this node accepts.
3. Prefer what is easiest to maintain and easiest to understand over flexibility.

## The problem

Today a script can run in two differently-shaped places:

- a **port hook** — a node *type* declares `slots.<name>: { kind: 'scripts', port, phase, accepts }`; the substrate applies the chain stored at `config[nodeKey][<name>]['']` around the binding (`sdk/src/executor.ts` ~1462–1490);
- an **interior point** — a type declares `scriptPoints: [{ key, accepts }]`; the binding calls `ctx.scripts.applyText(key, …)` and the executor reads `config[nodeKey].scripts[key]` (~1800–1840).

Both require the type author to have anticipated the place. Nothing shipped in the 0.6 catalogue declares a `scripts` slot, so in practice a user can attach a script only at the two interior points (`each-draft`, `select`). Two mechanisms, two option shapes in the panel, two applier calls in the executor.

## The design

### One address, one list

```ts
config[nodeKey].scripts[''] = [
  { at: 'in:messages', script: 42 },   // before the binding, on in-port `messages`
  { at: 'out:text',    script: 17 },   // after the binding, on out-port `text`
  { at: 'each-draft',  script: 9  },   // interior point the type declares
]
```

- `at` is a **seam address**: `in:<port>` · `out:<port>` · `<pointKey>`. The prefix replaces the slot's `phase` and keeps a port and a point from colliding on a name.
- `script` is a row id in the scripts table, as today.
- The list is the whole value — one option, one write, order is one fact (the reason already recorded at `config/panel/declarations.ts:345-347`).

### Seams are derived, never declared

A port is a seam iff its shape has a row in one SDK table:

| port shape                     | script kinds offered                                   |
| ------------------------------ | ------------------------------------------------------ |
| `core:shape/text@1`            | `text/transform`, `text/stop`                          |
| `core:shape/messages@1`        | `messages/inject`, `messages/transform`                |
| `core:shape/turn-candidates@1` | `candidates/filter`, `candidates/rescore`              |
| `core:shape/assembled-context@1` | `context/transform`                                  |
| `core:shape/session-cast@1`    | `cast/transform`                                       |

Any shape without a row is not a seam (`json`, `image`, `embeddings`, streams, …). A plugin that declares a shape may register a row for it under the usual idempotent-redeclare rule. `turn/select` is reached only through the decider's `select` point (R-O1). Interior points keep their own `accepts` (R-11) — only the binding knows the moment exists, so points remain the one *declared* seam kind.

Scoping (ruling 2) falls out: the node's offered scripts = union of kinds over its seams. The picker goes **script first, seam second** — pick a script, then `at` is narrowed to the seams accepting its kind; when exactly one, it is prefilled and the column is hidden.

### Execution order

`in:` entries run before the binding, interior points during (when the binding calls them), `out:` after. List order decides ties within one seam only. The panel sorts the list by seam so an `out:` entry can never be dragged above an `in:` one and look as if it should run first.

Host-level sources that apply with an empty chain (a connection's stop guards, 18 §4b) keep working: the applier is still invoked at every text out-port whether or not the list has an entry there — unchanged from today's "an empty or absent chain still reaches the applier".

### Drift

- Node gone from the spec → the whole `scripts/''` address is culled by `reconcileConfigs`, as any node-keyed config is today.
- Port or point renamed → **that one entry** fails to resolve. The panel shows the row with a *no longer here* marker; the executor skips it and receipts a **note** — or a **halt** when the entry is a `text/stop` guard (R-O2). **Never culled silently.**

### Admin-only (ruling 1)

`panel/write.ts` refuses a `scripts` write outside the admin venue, matching prompt writes. Scripts never appear in session settings and are never a session-layer override, even though the cascade shape would allow it.

## Retirements (NOMENCLATURE)

- **`scripts` slot kind** (`kind: 'scripts'` on a slot declaration, with `port` / `phase` / `accepts`) → §23 Retired; replaced by derived seams. No catalogue type uses it, so no alias.
- **hook site** as a term → retired; **seam** replaces it (§25 ledger line: *seam* = a port or interior point a script list entry may address; *seam address* = `in:<port>` · `out:<port>` · `<pointKey>`).
- **script point** stays, redefined as "a declared seam inside a binding".

## Changes by file

### SDK (`../serene-pub-sdk`) — needs prerelease + pin bump

- `sdk/src/scripts.ts` — add `seamKindsForShape(shapeId)` and the table; export `SeamAddress` type + `parseSeamAddress`.
- `sdk/src/executor.ts` — replace `scriptHooks` + the interior `apply(point)` with one `entriesAt(nodeKey, at)` read of `config[nodeKey].scripts['']`; apply at every seam port before/after the binding; `ctx.scripts.apply(point)` filters the same list. Unresolvable `at` → skip + note. Delete the `kind === 'scripts'` slot branch.
- `sdk/src/descriptors.ts`, `registry.ts` — refuse `kind: 'scripts'` at `register()` with a sentence naming the replacement.
- `conformance/` — a conformance check that every shape in the seam table exists.
- `sdk:test` suite pins hashes/counts — expect updates.

### Core

- `config/panel/declarations.ts` — delete the `kind === "scripts"` branch and the per-point loop; emit one `scripts-chain` option per node at path `''`, placed last, carrying `seams: [{ at, accepts, label }]` (ports from the row's port shapes via the table, points from `scriptPoints`).
- `config/panel/types.ts` — `seams` on the option; `at` on each entry.
- `config/panel/write.ts` — validate each entry: script row exists, its kind ∈ accepts of `at`; refuse outside admin venue.
- `config/panel/read.ts`, `choices.ts` — read the list; choices = scripts whose kind is in the node's union.
- `config/world.ts` `reconcileConfigs` — `scripts/''` is on every node's address list; a one-shot **fold** at boot moves any stored `scripts[<pointKey>]` lists into `scripts['']` entries with `at = <pointKey>`, then drops the old keys. Config JSON only — no migration file.
- `pipelines/scripts/chains.ts`, `host.ts` — applier receives `at` in place of `slot/phase/port`; receipt note for unresolved entries.
- `runtime/bindings.ts` — no change at the two call sites; `ctx.scripts.applyText('each-draft', …)` keeps working.
- `boot/registrySync.ts`, `db/schema.ts` — `scriptPoints` column stays (points are still declared).
- Client `PipelineConfigOptions.svelte` — `scripts-chain` control: ordered list grouped by seam, script-first picker, *no longer here* row state, drag within a seam only.
- Docs: `docs/pipelines.md` (Advanced → *Scripts*: one list per step, where each runs), NOMENCLATURE §23/§25, STYLE-GUIDE only if a new row state needs a colour role (reuse the existing changed/orphaned treatment first).

## Tests

- SDK: `executor` — in/out/point entries apply in the right order; unresolved `at` skipped with a note, halts when it is a `text/stop` (R-O2); `speaker-selection` port is not a seam (R-O1); empty list still calls the applier on text out-ports; `register()` refuses `kind: 'scripts'`.
- Core: `panel/scriptsChain.int.test.ts` rewrite for the single option; `write.ts` refuses wrong kind for seam and non-admin venue; `world.ts` fold of legacy point keys; `chains.interiorAccepts.int.test.ts` still green via `at = 'each-draft'`; `registryHashes.test.ts` and `conformance/wiring.test.ts` updated for the retired slot kind.
- One grouped verification at the end: `npm run sdk:test`, `npm run sdk:build`, `npm test`, `npx tsc --noEmit -p .`.

## Ruled 2026-10-10 (owner took both recommendations)

- **R-O1** — `turn/select` has **one** seam: the decider's `select` interior point. `core:shape/speaker-selection@1` is **not** in the seam table; the port is not a seam. (Table row above struck accordingly.)
- **R-O2** — an entry whose `at` no longer resolves is receipted as a **note** when its script kind is a transform, and as a **halt** when it is `text/stop`: a stop guard that would silently stop applying halts the run instead.
