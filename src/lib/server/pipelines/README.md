# `pipelines/`

Everything that turns *a chat and its configuration* into *a prompt sent to a model*.

This replaced the 0.5 prompt builder in 0.6. If you are looking for
`utils/promptBuilder/`, it is gone — [what it did and where each piece
went](../../../../docs-dev/DECOMPOSITION.md).

## The one-paragraph version

A **pipeline** is a list of **nodes** (build context → assemble a prompt → call
a model). A **spec** declares that list. Each node type is described by a
**descriptor** in the SDK, which names the node's **slots** — the things a user
can configure about it: which connection, which sampling preset, which prompts,
which template. A **binding** is core's implementation of one node type. The
**executor** (in the SDK) walks the spec, resolves each node's configuration,
and calls its binding.

Configuration resolves through six scopes, most specific first:

    chat → user → instance → preset → defaults → author

## Where do I find…

| I want to… | Start at |
|---|---|
| follow one chat turn end to end | [`runtime/runTurn.ts`](runtime/runTurn.ts) |
| see what pipelines ship | [`specs/index.ts`](specs/index.ts) |
| change what a prompt says | [`entities/prompts.ts`](entities/prompts.ts), or the seeded text in [`boot/seedPrompts.ts`](boot/seedPrompts.ts) |
| change how the context is laid out | [`entities/contextTemplateDefaults.ts`](entities/contextTemplateDefaults.ts) |
| change how one variable renders (the JSON, the fences, the titles) | [`entities/variableLayouts.ts`](entities/variableLayouts.ts) |
| understand what the Pipelines sidebar shows | [`config/panel/`](config/panel/) |
| know why a setting resolved the way it did | [`config/world.ts`](config/world.ts) — the six-scope projection |
| find where lore is chosen | [`ranking/`](ranking/) — `select.ts` for the decision, `weights.ts` for every constant |
| know what actually ran | [`runtime/receipts.ts`](runtime/receipts.ts) |
| add a node type | a descriptor in the SDK, then a binding in [`runtime/bindings.ts`](runtime/bindings.ts) |

## The groups

Roughly in the order a request travels through them.

### `boot/` — what exists at startup
Seeds core's rows (prompts, context templates, variable layouts) and syncs the
type registry. Insert-only by `seedKey`, except that core's immutable rows are
refreshed on upgrade. `store.ts` is the row ↔ document mapping.

### `specs/` — the pipelines core ships
`respond` (answer a message), `narrate`, `summarize` (four of them),
`graphBuild`. A spec is a declaration: nodes, wiring, and defaults. No logic.

### `config/` — what a user chose
The six-scope resolution and everything the admin UI reads.
`world.ts` projects Serene Pub's existing settings into the pipeline config
model; `named.ts` is saved configs; `library.ts` is the workspace's one-shot
read.

[`config/panel/`](config/panel/) is the sidebar's own layer, split by job —
`types` (vocabulary), `ids` (opaque handles), `declarations` (what can be
configured), `choices` (what a reference may name), `scopes` (who may write),
`read`, `write`. Import from the directory, not from the files behind it.

### `entities/` — the swappable, authored things
Prompts, context templates, variable layouts. Each follows the same pattern:
**the config stores a reference, the row holds the content**, so one authored
thing can be selected from several pipelines. Variable layouts are keyed by
*what they render*, not by which pipeline renders it — that reuse is the point.

### `prompt/` — building the text
`templateContext.ts` gathers the data, `assemble.ts` renders it against the
context template, `promptFields.ts`/`contextFields.ts` decide which text lands
in which field. `preview.ts` does the same with no chat, for the editor.

### `ranking/` — choosing what fits
Which lore, which history, which messages survive the token budget. Two arms
(keyword and semantic) over shared scoring. Every tunable constant is in
`weights.ts` with the line it came from.

### `runtime/` — running it
`runTurn.ts` is the entry point. `host.ts` is the I/O a binding may not do
itself. `bindings.ts` implements the node types. `dispatch.ts` sends a prompt
built elsewhere. `reviewGate.ts` parks a run awaiting human approval —
**graph builds always stop here and are never auto-applied.**

### `migrate/` — bringing 0.5 across
One-shot, idempotent. Legacy tables are read-only, not dropped.

### `parity/` — proof it matches 0.5
`goldens/` holds prompts captured from a v0.5.1-beta checkout **before** the old
builder was deleted. They are a *record of what 0.5 did*, not a snapshot to
regenerate — if one fails, the pipeline changed, and a golden may only be
re-captured from a 0.5 checkout.

### `testing/` — shared fixtures
Not a suite. No `*.test.ts` suffix, so vitest ignores it.

## Conventions

- Tests sit beside their subject: `foo.ts` → `foo.test.ts`. `*.int.test.ts`
  needs a real PGlite database.
- Imports within `pipelines/` are absolute:
  `$lib/server/pipelines/<group>/<name>`.
- The SDK's source of truth is the sibling repo `../serene-pub-sdk`, linked by
  `file:`. Do not edit installed copies under `node_modules`.
- A descriptor change alters its content hash and needs a **re-projection
  migration**, or `bootstrapPipelines` will refuse to start the pipelines.
  `boot/registryHashes.test.ts` is what tells you.
