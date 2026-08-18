# Integrating the SDK into Serene Pub Core

The ordered path from today's SP Core to a pipeline-backed one. Every step names the thing
that proves it, because "we wired it up" is not a result — a conformance requirement going
green is.

Read `08-BUILD-PLAN` for the units and their acceptance criteria; this document is the
sequence and the seams, not a second copy of the plan.

---

## 0. The decision that shapes everything else: core _uses_ the executor

Two ways to integrate, and they are not equally good.

**Core imports `@serene-pub/sdk` and runs its executor**, supplying the effectful parts —
bindings to real services, connection resolution, receipt persistence, the gate's parking
store, streaming transport, budget accounting. The laws have exactly one implementation.

The alternative — core writes its own scheduler and treats the SDK as a spec — produces
two implementations of F9, F25, F26, halt semantics, block scheduling and budget metering,
which will drift, and the drift will be discovered by a user whose run behaves differently
from the same run in the harness.

**Take the dependency.** The conformance kit exists so that a second implementation _can_
be proven equivalent later, if transport or performance ever forces one. That is a door
worth keeping open and a door not worth walking through in 0.6.

What core still owns, because none of it is pure:

| core owns                                    | why it cannot live in the SDK                         |
| -------------------------------------------- | ----------------------------------------------------- |
| bindings for every core type                 | they touch the database, the network, the file system |
| connection resolution and credential custody | F18 — material never leaves core, not even to the SDK |
| receipt persistence and retention            | rows, and a retention policy that is a system setting |
| the gate's parking store                     | a parked run outlives the process                     |
| streaming transport and sockets              | wire protocol, not pipeline semantics                 |
| real budget accounting                       | metered against actual provider usage                 |

And what core must **never** do, whatever the temptation: evaluate a plugin's authoring
JavaScript. F6 means core imports documents. `serene-pub build` runs on the author's
machine, and its output — a manifest plus documents, both plain data — is the only thing
core reads. `checkInstall` decides installability from that data alone (13 §10c).

---

## 1. Sequence

Each step is shippable. Nothing in steps 1–6 is user-visible: the pipeline path runs beside
the existing one until step 7 flips it.

### Step 1 — Schema and the document model (U1)

Tables from `02 §2`. Take `compile`, `exportDocument`, `importDocument` and the canonical
hash from the SDK rather than writing them: the identity law is the one place where a
subtly different implementation is indistinguishable from a correct one until an export
fails to import a year later.

**Proves it:** conformance **C1** — `import(export(doc))` is identity and the hash is
stable. Run it against real rows, not fixtures.

### Step 2 — Type registry and boot sync (U2)

`snapshotRegistry(allTypes(), { release })` projects descriptors into `type_registry` rows.
Sync on boot; a version whose hash changed **raises** rather than publishing or ignoring.

**Proves it:** sync idempotence, plus `checkInstall` returning clean for a document
compiled against this release and `E_SHAPE_DRIFT` for one compiled against another. The
second is the one worth having a fixture for — every id resolving while a shape has moved
is the failure a version number alone does not catch.

### Step 3 — Executor and bindings for what already exists (U3, U5)

Bind the core types to the code that already does the work:

| type                             | binds to                                            |
| -------------------------------- | --------------------------------------------------- |
| `core:query/chat-history@1`      | today's history loader                              |
| `core:query/lorebook-triggers@1` | today's World Info scan                             |
| `core:task/assemble@2`           | today's prompt builder, behind the allocation shape |
| `core:provider/generate-text@1`  | today's connection adapters                         |
| `core:consumer/create-message@1` | today's message insert                              |

Nothing is rewritten in this step. Each binding is a wrapper, and the wrapper is where the
old code keeps living.

**Proves it:** **C3** (halt is halt, not err), **C4** (seed recorded, replay identical),
**C6** (budgets meter consumption, waiting is free), **C7** (timeouts bound execution, not
waiting), **C8** (forced-sequential is identical to parallel).

### Step 4 — Parity, before anything flips

The acceptance criterion for replacing the prompt builder is **byte-identical output**,
measured on the **preview payload** rather than on a second renderer written for the
occasion (`08 §5b`). `checkParity` and `parityGate` are in the SDK.

`parityGate` fails an empty corpus on purpose: "nothing was checked" is not "nothing was
wrong", and an integration that reports green over zero fixtures is the single most
expensive mistake available here. Build the corpus from real chats — group chats, chats
with lorebooks, chats at the context limit, chats with custom prompt configs.

**Proves it:** every fixture byte-identical, over a corpus somebody looked at.

### Step 5 — Migrate user configuration (U16, `08 §5b`)

Existing prompt configs become presets. `migratedSlug(table, id)` derives the slug so the
job is **safely re-runnable** — a migration that generates fresh ids on every run cannot be
resumed after it half-finishes at 3am.

Two things must not happen: a config that lands nowhere without a report, and a config that
lands at the wrong scope. `MigrationReport` requires a reason on every non-migrated entry,
and `assertReportComplete` fails the job rather than the user's expectations.

If any legacy spec still pins `commit-message@1`, `splitCommitMessage` rewrites it —
converting where the document says what it meant, reporting `unmapped` where it does not
(13 §10b). The unmapped ones need a person; there will not be many.

### Step 6 — Review gate, receipts, events (U6, U8, U9)

The gate keys on **declared effects, not kind** (F14, ratified 13 §7a), so an effectful
Provider gates exactly like a Consumer. The substrate placement is what makes it
undetectable to plugin code — a gate a plugin can notice is a gate a plugin can route
around.

**Proves it:** **C5** (replay without calling the Provider), **C11** (an admin kill is
`cancelled` with an actor, not `err`), **C12** (an event-triggered halt before any effect
compacts; a click does not), **C14** (no receipt in the corpus contains a credential).

### Step 7 — Debug preview replaces the token estimator (U19d)

Chat debug mode already estimates the next request. Point it at `previewTarget` +
`renderPreview`: the run executes and halts at the first Provider **on the spine**, and
reports what would have been sent.

The property that makes this worth doing is that the preview _is_ the payload — same
allocation, same wire formatting, same measurement — so the estimate cannot drift from the
send.

**Proves it:** **C13** — the previewed payload is byte-identical to the sent one.

### Step 8 — Plugins (U14, U10, U21)

Install reads the manifest and documents. `checkInstall` gates it; `cannotDo(manifest)`
generates the negative list for the consent screen — generated, so it cannot flatter.
Permissions are compiled from usage at build time and **re-checked at runtime** against the
admin's grants.

### Step 9 — Retire the old tables (0.7–0.8)

Retained means frozen (`08 §5a`): the old tables keep working and stop changing. Drop them
only when parity has held across a release and nothing references them. Two clocks, and the
slower one is the user's.

---

## 2. Seams that will need work — known, not discovered

These are places where the draft is deliberately minimal. Each one is a substitution, not a
redesign, and the tests around them pin the contract rather than the implementation.

| seam                       | what the draft has                      | what core needs                                                                                                                                                      |
| -------------------------- | --------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Template engine**        | ~200 lines: `{{ a.b }}` and `{% for %}` | a real Jinja2. The registry (`src/engines.ts`) already treats the engine as a datapoint, so this is registering one, not rewriting callers                           |
| **Tokenizer**              | `roughTokens`, chars ÷ 4                | the real tokenizer per connection. `CostProfile.exact: false` already marks estimates so they degrade visibly rather than silently                                   |
| **The packager's scanner** | a dependency-free lexical scan          | a real TypeScript parser. The scan is correct for the shapes it recognises and is explicitly commented as a placeholder — swap `scanSource` and keep `compilePlugin` |
| **Map concurrency**        | forced sequential                       | real per-iteration scoping. The observable result is identical, which is exactly what C8 asserts, so this is a performance change and not a semantic one             |
| **Secrets**                | tagged plaintext                        | encryption against the app secret in `meta.json`. `forOwningHook(decrypt)` is already the seam                                                                       |
| **Sidecars**               | no transport                            | `jsonrpc-stdio@1` (U13)                                                                                                                                              |

---

## 3. What "integrated" means, as a checklist

- [ ] `@serene-pub/conformance` runs in CI against core's executor, all 15 green
- [ ] one real chat turn runs as a pipeline end to end, from a real trigger
- [ ] the parity corpus is byte-identical over fixtures drawn from real chats
- [ ] every existing user prompt config appears as a preset, or as a reported exception
- [ ] debug mode reads from the preview, and the preview matches the send
- [ ] a plugin built with `serene-pub build` installs, and one built against another
      release is refused with a message naming the drift
- [ ] the old tables still work, unchanged, and are scheduled rather than dropped

---

## 4. The pattern worth carrying over

Every implementation finding in this draft has been **at a seam between two documents**,
never inside one. Allocation versus wire formatting, the proposal id versus the row id,
template scope versus typed ports, the packager versus the manifest. Each was consistent in
both places and wrong between them.

So when integrating: the risky work is not any single unit. It is the joins — the place
where the config resolver meets the executor, where the preview meets the send, where the
migration meets the parity harness. Those are where to spend the fixtures.
