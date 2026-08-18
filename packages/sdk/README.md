# Serene Pub SDK — 0.6.0-preview draft

A working draft of the SDK described in `/docs/pipeline` (00–17). **Preview: breaking
changes are expected before 0.7.0.**

```bash
npm install
npm test          # tsc --noEmit, then 310 assertions across 109 use cases
npm run build     # emits dist/ for all four packages, in dependency order
SHOW_RECEIPT=1  npx tsx --test test/usecases.test.ts   # a rendered receipt
SHOW_PREVIEW=1  npx tsx --test test/preview.test.ts    # a rendered debug preview
SHOW_WIRE=1     npx tsx --test test/wire.test.ts       # the panel with the `why` trail
SHOW_CONFORMANCE=1 npx tsx --test test/conformance.test.ts   # the kit core runs against itself

node packages/cli/dist/bin.js check ./my-plugin    # what core would refuse, and why
```

## Four packages, because there are four clocks

The split is not cosmetic. A single package would force one version number onto four things
that move independently, and the one that hurts is `contracts`: a plugin author bumping the
SDK to get a nicer builder would silently change **which SP release's types they compile
against**. So the version of `@serene-pub/contracts` *is* the SP release.

| package | who installs it | what its version tracks |
|---|---|---|
| **`@serene-pub/sdk`** (+ `/testing`) | plugin authors | the authoring API |
| **`@serene-pub/contracts`** | plugin authors | **the SP release** — `0.6.x` compiles against SP 0.6.x |
| **`@serene-pub/conformance`** | SP Core and any alternate host | the Fixed Ledger |
| **`@serene-pub/cli`** | plugin authors, build time only | the authoring API |

Two consequences worth stating. A plugin author never downloads the host test kit, because
the kit answers a question they are not asking ("does this host obey the laws?") and its
fixtures are not examples to copy. And **nothing in `@serene-pub/cli` is importable by a
running plugin** — the packager computes a plugin's permissions from its source, so a plugin
that could import the packager would be a plugin that could argue with the manifest.

`npm test` runs the typechecker first on purpose. `test/types.assert.ts` has no runtime
assertions — it is a file of `@ts-expect-error` directives, so **the build fails if a
mistake that is supposed to be a compile error stops being one.**

## What's here

| | |
|---|---|
| `sdk/src/shapes.ts` | versioned shapes; assignability; connection **and** sampling kinds are the same ids (F17) |
| `sdk/src/descriptors.ts` | `describeQueryType` / `describeTaskType` / `describeProvider` / `describeConsumerTarget`, slots, pinned constructors |
| `sdk/src/refs.ts` | `$ref` (data edges) vs `slot.*` (config references — not edges, F35) |
| `sdk/src/scope.ts` | the typed chain scope — `$.history.messages`, and F9 at the call site |
| `sdk/src/builder.ts` | the kind-named chain: `on/input/query/task/provider/consume` + `async/map/include` |
| `sdk/src/document.ts` | compile to a canonical document, derive edges, resolve config refs at publish |
| `sdk/src/validate.ts` | the statically checkable laws — every error names what to do instead |
| `sdk/src/config.ts` | five-layer scope chain, per slot; the write matrix |
| `sdk/src/executor.ts` | a minimal runtime: discriminated results incl. `halt`, run seed, timeouts, budgets, receipts, replay |
| `sdk/src/review.ts` | the gate: three positions, keyed on **declared effects** not kind; no position forbids it |
| `sdk/src/template.ts` | a minimal renderer + static variable checking |
| `sdk/src/wire.ts` | **allocation vs. formatting** — allocated blocks, the wire registry, one measurement |
| `conformance/src/index.ts` | **the kit SP Core upgrades against**: 15 requirements, each naming what breaks |
| `sdk/src/engines.ts` | template engines as a **registry** — render, extract, check, and the cost profile |
| `sdk/src/identity.ts` | owner + slug + semver; the import rule; ownership is not transferred |
| `sdk/src/migration.ts` | the parity harness: legacy output vs the **preview payload** |
| `sdk/src/preview.ts` | debug mode: halt at the first spine Provider and report what would be sent |
| `sdk/src/events.ts` | the core-owned registry: unique slugs, **data vs action** families |
| `sdk/src/hooks.ts` | the three hook kinds and their surfaces; the F32 conformance probe |
| `sdk/src/settings.ts` | the plugin settings schema: one declaration → form, validation, manifest, types |
| `sdk/src/extension.ts` | `defineExtension` — one declaration ties hooks, settings, components and pipelines |
| `sdk/src/testing.ts` | the author's harness: goldens, binding probes, the equivalence law |
| `sdk/src/connections.ts` | what an import must wire, derived from types rather than stored rows |
| `sdk/src/registry.ts` | `type_registry` rows, and install-time validation from data alone |
| `sdk/src/dev.ts` | dev loading: memory-only overlay, and which reloads may apply mid-run |
| `contracts/src/index.ts` | sample core + plugin types across four modalities |
| `cli/src/compiler.ts` | the packager: a source scan plus the built extension, cross-checked |
| `cli/src/codegen.ts` | `/contracts` generation, and the rule that binding names are **derived** |
| `cli/src/bin.ts` | `serene-pub build / check / contracts` |

## What the draft demonstrates

**Laws are compile errors, not validator findings.** `.input()` is the only method offered
first and is never offered again. `.query()` given a Provider constructor is a type error.
There is no branch method to call. And **a node cannot reference one declared below it** —
the scope handed to each step holds only what precedes it, so F9's "no back-edges" is
unwritable rather than reported:

```ts
.query('history', $ => C.chatHistory({ scope: $.input.chatScope }))
.task ('prompt',  $ => C.assemble({ candidates: $.history.messages }))
.consume('save',  $ => C.createMessage({ text: $.generate.text }))
```

`$ref('history','messages')` still works and produces the identical value — use case 52
asserts both forms compile to the same canonical hash, because F6 means nicer authoring has
to be provably invisible to the document. **Every test in this draft is written in the scope
form**; the two places `$ref` still appears are the parity tests that exist to compare the
two forms.

**Node keys accumulate fully qualified, exactly as they land in the rows**, and the scope
type expands the dots back into a path. So a block's members, a map's members and an
included fragment's members are all in scope afterwards:

```ts
.async('gather', { mode: 'parallel' }, b => b
  .chain('semantic', c => c
    .provider('embed',   $ => C.embedText({ text: $.input.text, connection: slot.connection() }))
    .query   ('vsearch', $ => C.vectorSearch({ vector: $.gather.semantic.embed.vector }))))
.include('ctx', contextInfill)
.task('merge',  $ => C.mergeCandidates({ sources: [$.gather.semantic.vsearch.hits] }))
.task('prompt', $ => C.assemble({ candidates: $.ctx.merge.candidates }))
```

A block name alone is a **path**, not a ref — only the leaf is a node, which falls out of
the key split rather than needing a rule. `types.assert.ts` pins both directions: the
qualified paths compile, and a misspelled chain name or a fragment node that doesn't exist
is a compile error.

**Nothing switches on modality.** `generateText`, `speak`, `renderImage` and `mcpTool` are
the same object to the config model, the scope chain and the receipt — because `params` is
declared per type, not per kind.

**The receipt explains itself.** The rendered output above answers "why isn't RAG working"
(no embeddings connection, one line), "why does mirostat do nothing" (the adapter ignored
it, stated), and "what caused that other pipeline to run" (core emitted, because a write
happened).

## The 103 use cases

Each maps to a law or a documented behaviour, so a failure points at the doc it violates.

| # | Case | Reference |
|---|---|---|
| 01 | minimal chat turn runs; kind mismatch cannot compile | 04 §4a |
| 02 | exactly one Input, positionally first | 01 §2 |
| 03 | one primary write; emits unlimited; chain continues past it | F7 |
| 04 | no branch method; fan-in is legal | F25 |
| 05 | halt ends the run as `halt`, records node + reason, skips downstream | 01 §5 |
| 06 | seeded dice replay identically; no `random` without `declaresRandomness` | F11 |
| 07 | a Query is handed no network handle | 16 §1 |
| 08 | async block: parallel ≡ forced-sequential; no write-class consumer inside | F26, 01 §4 |
| 09 | map publishes with a declared max; unbounded is an error | 01 §4 |
| 10 | streaming decided at publish; `earlyExit` on a settled input warns | 01 §11, F22 |
| 11 | timeouts bound execution; admin ceiling wins; **a week of waiting doesn't trip one** | F36 |
| 12 | budgets trip on consumption; waiting consumes nothing | F13 |
| 13 | five-layer chain resolves per path; users can't write `connection` | 12 §2, F20 |
| 14 | sampling referenced + field-overridden; ignored samplers recorded | 12 §2 |
| 15 | connection **metadata** readable, **material** never leaves core | 01 §10, F18 |
| 16 | budget flows forward; `downstreamProvider()` resolves at publish | F35, 16 §5b-i |
| 17 | Assemble reads declared weights off its inputs | 16 §5a |
| 18 | auto→keyword with no embeddings; auto→vector with them; nothing skipped | 16 §2 |
| 19 | three rankers substitute freely, including a plugin's | 16 §5c |
| 20 | a fragment expands at publish to flat, namespaced rows | 16 §3a |
| 21 | `import(export(rows))` is identity; hash stable | F3 |
| 22 | only core emits; a node declaring `emits` is rejected | F8 |
| 23 | replay reproduces the run **without calling the provider** | F16 |
| 24 | TTS, image-gen and MCP use the same structure as chat | 17 §1 |
| 25 | review `off` invokes the binding directly | 01 §7 |
| 26 | `sync` parks **before** the binding; rejection halts; a week parked trips no timeout | 01 §7, F13 |
| 27 | an edited payload is **indistinguishable to the binding** | F14 |
| 28 | author may default review on; user can turn it off; no position forbids it; gate keys on effects | F14, 14 §4a |
| 29 | the receipt records action, both hashes and who | F15 |
| 30 | `async` proposes without blocking — **and hands downstream a proposal id** | 01 §7 |
| 30a | an unclassified external tool is gate-**eligible** but **ungated** | 14 §4 |
| 31 | source and assembly templates render | 16 §3b |
| 32 | unknown variable errors and lists what exists; dynamic access warns | 16 §4 |
| 33 | extraction finds loop sources and expressions | 16 §4 |
| 34 | **template scope is declared on the slot, not derived from ports** | 16 §4 correction |
| 35 | regex keys, logic operators (AND_ALL / NOT_ANY), scan depth | 13 §7i |
| 36 | bounded recursion inside the Query's interior — no pipeline construct | 13 §7i |
| 37 | constants activate without a key match | 13 §7i |
| 38 | probability rolls against the run seed — **replayable, unlike ST's** | 13 §7i |
| 39 | inclusion groups resolve in the rank Task, weighted and seeded | 16 §5c |
| 40 | insertion order is a sort key | 13 §7i |
| 41 | positional insertion at depth — **the assembly template does it** | 16 §5e |
| 42 | async blocks publish **branch-results in declaration order**; a merge was rejected | 13 §1 |
| 43 | map iterates, numbers its iterations, and fails rather than truncating past `max` | 13 §1, F26 |
| 44 | an **event-triggered** halt before any effect compacts; a click's halt does not | 13 §2 |
| 45 | an admin kill is `cancelled` with an actor — **not** `err` | 13 §3 |
| 46 | a week queued trips no timeout and consumes no budget | 13 §3, F13, F36 |
| 47 | a `secret` setting is redacted **by type**, hidden from the client, dropped from export | 13 §6 |
| 48 | event slugs are unique; **action events drop out of the cycle graph by construction** | 13 §7, §7g |
| 49 | `ui-action` carries owner *and* trigger — budget owner without a separate rule | 13 §7 |
| 50 | no hook surface carries Provider access or a trigger; scheduled work is an event | 13 §7c, F32 |
| 51 | a lorebook entry can carry `depth` — the one real parity gap, closed | 13 §7i |
| 52 | **scope sugar and `$ref` compile to the same canonical hash** | F3, F6 |
| 53 | `$.history` is the `main` port; `$.history.messages` refines it | 04 §4a-i |
| 54 | a forward reference throws, and the message lists what exists | F9 |
| 55 | `$.a.b.c` is refused — ports are flat, and the error says so | 04 §4a-i |
| 56 | inside a block a sibling is `$.embed`; from the spine it is the full path | 04 §4a-i |
| 57 | `over: $ => $.chunks.items`, and `$.$item` needs no block key | 01 §4 |
| 58 | `slot.connectionOf($.generate)` — still not a data edge | F35 |
| 59 | preview stops at the first Provider **on the spine**, not at `embed` in the block | 16 §7 |
| 60 | **the previewed payload is byte-identical to the one actually sent** | 16 §7 |
| 61 | per-source stats, a reason on every dropped block, metadata but never material | F18 |
| 62 | a payload over the available budget is flagged, not silently truncated | 16 §7 |
| 63 | a preview receipt is never compacted — the preview *is* the payload | 13 §2 |
| 64 | author presets: slugged, one default, renaming the label keeps selections | 12 §3a, §3b |
| 65 | unknown node key, undeclared slot and `connection` are all refused | 12 §3a, §4 |
| 65a | selective export; a filtered doc is a *different* doc; nothing drops silently | 12 §7a |
| 66 | a template carries **its engine**; an extension registers its own compiler | 12 §2a |
| 67 | cost profiles separate fixed from per-iteration; `exact: false` degrades safely | 16 §7 |
| 72 | migrated rows get a **derived** slug, so the job can be safely re-run | 12 §3b |
| 73 | **parity is byte-identical output, measured on the preview** | 08 §5b |
| 74 | the gate fails an empty corpus — "nothing checked" ≠ "no failures" | 08 §5b |
| 75 | no silent drops; the scope each value landed at is recorded | 12 §2, §5 |
| 76 | owner + slug + semver; newer replaces; ownership is never transferred | 12 §3b |
| 77 | one schema drives the form, validation, the manifest **and the value types** | 12 §6 |
| 78 | values are range/enum/type checked; every finding names the fix | 12 §6 |
| 79 | a schema that would leak a secret cannot be constructed | 13 §6 |
| 80 | on update, removed fields are **orphaned, not deleted** | 12 §5, §6 |
| 81 | `needs-configuration` is a distinct state from `broken` | 12 §6 |
| 82 | client sees "set/unset", export drops it, only the owning hook sees plaintext | F18 |
| 83 | a tool-calling loop on the spine: per-step receipts, not one opaque call | 01 §4a |
| 84 | dispatch is data, which is why branching is still not a construct | 01 §4a |
| 85 | blocks nest; two iterations never see each other's values | 01 §4a |
| 86 | a loop publishes `branch-results`, exactly like a map | 13 §1 |
| 87 | unbounded loop, outside-the-body predicate and inner writes are all refused | 01 §4a, F7 |
| 88 | halt still halts the run — the loop does not swallow it | 01 §5 |
| 89 | one allocation, five wire formats; dropped blocks reach none of them | 16 §7 |
| 90 | scaffolding is **declared and counted**, not discovered by the vendor | 16 §7a |
| 91 | over budget is `err` — not a silent trim, and not a retry | F9, F25 |
| 92 | `allocated-context` → `assembled-context` one way only, so core migrates node by node | 16 §7 |
| 95 | **the reference implementation passes its own conformance kit** | 03 §9 |
| 96 | `defineExtension` ties the whole plugin together; a foreign namespace is refused | 03 §2 |
| 97 | permissions are compiled from **what the code calls**; a computed declaration is an error | 13 §7c, §30 |
| 98 | manifest + documents; a subscription is a permission; conditional registration is caught | 10 §10.2 |
| 99 | **every binding name derives from its type id** — an alias table is a generator that drifts | 04 §2 |
| 100 | goldens diff the payload, not the pass/fail — "it still runs" is not the assertion | 03 §9 |
| 101 | five binding probes; each failure names what it breaks, not just what it was | 03 §9 |
| 102 | F26 as a one-liner an author can run | F26 |
| 103 | the CLI: `check` exits non-zero on what core would refuse; there is **no `install` verb** | 03 §9 |
| 104 | `createMessage` / `updateMessage`: two names, no inference; create → update in one run is unwritable | 13 §10b |
| 105 | a gate-eligible write publishes `write-result@1`, **checked at registration** — three core types did not | 13 §7j-b |
| 106 | the legacy split migration recovers the decision or reports `unmapped` — never guesses | 13 §10b, 08 §5b |
| 107 | connections an import must wire, derived from types so an unconfigured export still declares them | 13 §10a |
| 108 | install-time validation from manifest + documents alone, incl. **shape drift every id survives** | 13 §10c |
| 109 | dev loading: memory-only overlay, and a reload that waits on the run it would have broken | 13 §11 |
| ✓ | every validation error states what to do instead | 15 §1.3 |
| ✓ | `types.assert.ts` — eight mistakes that must stay compile errors, incl. block paths, map members and fragment includes | tsc |

## The 2026-08-18 rulings, as code

Eight rulings landed; the draft implements them rather than recording them. Four are worth
calling out because the ruling changed what the code does, not just what a doc says.

**Joined effects are gone, and the union is a list.** An async block or a map publishes
`core:shape/branch-results@1` — one entry per branch, in **declaration order**, each
carrying `branchKey`, `index` and the discriminated result. Not a merged object: merging
needs a field-collision policy, and use case 42 demonstrates the failure by merging two
branches that both produce `hits` and watching one disappear. `async` and `map` publish the
same shape, so F26's equivalence harness covers both without knowing which it is looking at.

**A gate-eligible write publishes a discriminated result.** This closes finding (b) below.
Under `async` review the value is a proposal a reviewer may still reject, so it is
`{status:'pending', proposalId}` rather than an id; committed is `{status:'committed', ids}`.
`write-result@1` is deliberately **not** assignable to `row-ids@1`, which means a downstream
port that wants raw ids fails at publish with a message that explains the dangling foreign
key it just prevented. There is no branch node to check `status` with (F25), so the
obligation belongs to the type rather than to the spec — that is the whole design.

**Compaction is scoped to where the multiplier actually is.** A receipt compacts when the run
halted before any effectful node **and** the trigger was an event. That is the case the
ruling was about: a hot event × every subscribed pipeline × every message, where most
subscribers halt immediately and halting is success. A run someone started by clicking
happens once per click and keeps full detail. The rendered receipt says it was compacted and
how many rows went, so an empty node list is never a mystery.

**A `secret` setting is redacted by its type.** Use case 47 puts a ciphertext through a run
and asserts it appears nowhere in the serialized receipt. That assertion is the argument for
typing the field rather than adding a free-form secrets column: core cannot redact, exclude
from export, or keep write-only a value it cannot identify.

## Three findings for the docs, and one retraction

These are places where building it disagreed with what 00–17 say. All three are cheap to
fix and none is architectural. **(b) is now ruled and implemented** — kept here because the
reasoning is the useful part.

### 1. Template variable scope cannot come from typed ports alone — 16 §4 is half wrong

16 §4 claims variable awareness "falls out of typed ports with no new mechanism." That
holds for an **assembly** template, whose scope really is its input ports.

It does **not** hold for a **source** template. Rendering one lorebook entry means
referencing `{{ entry.title }}` — and the entry's shape lives *inside* the port's payload,
not on the port. No amount of port typing recovers it.

**Fix:** the template slot declares its own `variables`. One field on the descriptor, not a
new mechanism — but the doc currently promises something that would have failed for the
first plugin author who tried it. Use case 34 pins this.

### 2. Under async review, downstream gets a *proposal* id — **RULED, implemented**

01 §7 says an async proposal "is committed data," which is consistent. But a downstream node
referencing `$ref('save','messageId')` received `proposal:save`, not a message id — and
nothing in the design said so.

**Ruled: a discriminated pending/committed shape**, not a shared id space. The rejected
option is the one worth naming, because it is the one that looks simpler: under a shared id
space a proposal id is indistinguishable from a row id right up until the reviewer rejects
it, and then a foreign key written during the run dangles — a failure that surfaces long
after the run that caused it. Use case 30 now pins both statuses and the publish-time error.

### 3. "Effectful by default" and "reviewed by default" are different claims

14 §4 says every MCP tool is effectful by default and the admin classifies it. `effects:
'external'` delivers that — the node becomes gate-**eligible**. But the review *position* is
a separate setting, and with no author default and no admin setting it resolves to `off`.

So a freshly-snapshotted MCP tool that sends mail **runs unreviewed** until someone
classifies it. **Fix:** the MCP snapshot writes `review: 'sync'` at instance scope until an
admin marks the tool read-only. One field, no new machinery. Use case 30a pins both halves.

### 4. RETRACTED — all seven World Info features mapped

An earlier version of this README reported that positional insertion at chat depth needed a
shape change on `context-candidates`. **That was wrong.** Depth is a context-template
concern, and the assembly template expresses it:

```jinja
{% for m in messages %}{% set d = loop.revindex %}
  {% for l in lore %}{% if l.depth == d %}{{ l.rendered }}{% endif %}{% endfor %}
  {{ m.rendered }}
{% endfor %}
```

`{% set %}` captures the outer loop's index before the inner loop shadows `loop`. Use case 41
tests it end to end rather than asserting it.

So **all seven mapped with no new mechanism** — and this is also the answer to why Jinja beats
a fixed position enum: it expresses ST's four positions plus anything an author invents.

Fixing the demonstration required three real corrections to the toy engine, all of which were
bugs a regex-pass renderer will always have: non-greedy matching can't handle nested blocks,
inner loops must render *inside* their parent's scope rather than innermost-first, and `set`
tags belonging to an inner scope must not be stripped by an outer pass.

**The genuine parity gap is narrower than "positional insertion is missing": SP's lorebook
entries have no `depth` field.** An entry-schema addition in the lorebook model, not pipeline
work.

## Known gaps in the draft

Unimplemented, not undecided.

- **In-process timeouts abandon rather than kill**, matching 13 §7h. The abandoned promise
  keeps running; only the result is discarded.
- **No sidecar transport, no MCP client.** `mcpTool` is a descriptor with a stub binding.
- **No real tokenizer.** `contextBudget` reads `metadata.contextLength` and subtracts.
- **The template engine is minimal** — `{{ a.b }}` and `{% for %}` only, enough to prove the
  variable-awareness contract, not to be Jinja.
- **ST parity items are declared but not implemented** — recursion, inclusion groups and
  positional insertion are `params` on the descriptors only (13 §7i).
- **A map forces sequential execution.** The observable result is identical, which is exactly
  what F26 asserts, but the draft does not actually run iterations concurrently — a single
  shared value map cannot hold two iterations at once. Real per-iteration scoping is the
  work, not the shape.
- **`secret` values are stored as tagged plaintext**, not encrypted. `forOwningHook` takes a
  `decrypt` function so the seam is in the right place; the app secret in `meta.json` is
  core's side of it (13 §5).

## Two bugs the tests caught while writing this

Both the kind that ship silently.

1. **`redact()` turned arrays into objects**, corrupting receipts while execution stayed
   correct — the run was right, the record of it was wrong. Caught by use case 17 reading an
   allocation array back out of a receipt. That is precisely the failure that would make the
   explicability claim quietly unreliable.
2. **A too-strict sink shape** made every socket emit a publish error. The fix — `json` as a
   top type — is right, but the failure was the validator working, not misbehaving.
