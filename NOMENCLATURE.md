# Serene Pub — canonical nomenclature

The authoritative vocabulary for Serene Pub's systems: what each term means, which word wins
where two collided, and how to name new things so this does not decay.

**This is a living document and it is tracked deliberately.** Design plans and development
notes are kept out of this repository; nomenclature is the exception, because it is a contract
rather than a plan — contributors, modders and documentation all have to agree on what a word
means, and that agreement has to version alongside the code it describes.

Cite it from documentation and from code comments. **Where the code contradicts it, the code
is wrong** — say so in the comment rather than quietly inventing a third word.

## Maintaining it

- A change that renames a concept updates this file **in the same change**, not afterwards.
- New terms follow §24. Grep first; if the word collides, either pick another or rename the
  other use in the same change.
- A term drawn on a new screen uses its icon from §22; a new icon association is recorded
  there in the same change, and a term that has none goes under _needs an icon_ rather than
  borrowing a neighbour's.
- Mark anything impermanent per **R6** — ⏳ transitional or 🚧 provisional — so it can be
  pruned rather than accumulate.
- The change ledger (§25) tracks renames that are agreed but not yet applied. An entry
  leaves the ledger when the rename lands.

---

## 1. Governing rules

**R1 — One word, one meaning.** Where a word is already load-bearing in one place, the _other_
use renames. Not both.

**R2 — Prefer distinctive words for new concepts.** Every dangerous collision in this codebase
is a generic word — _source, role, key, binding, weight, grant, world_. Every safe one is
distinctive — _gazetteer, receipt, candidate, departed_. An odd word can never be confused
with anything else. Choose the odd one.

**R3 — Qualify, never abbreviate to the bare noun.** _Entry type_, _node definition_, _node kind_ — never bare `type`.
_Signal weight_, _mechanism weight_, _entry weight_ — never `weight`.

**R4 — Casual words must not become type names.** Internal ids stay precise and ugly
(`core:query/world-lore@1`); casual speech says _the world lore query_. `retrievalMode` and
`retrievalStrategy` were two different things one word apart, both since removed — that is the
failure this rule prevents.

**R5 — Reconcile vocabularies at boundaries; never merge them.** Two systems may legitimately
use different words for overlapping sets. Translate at the seam and keep both honest. Merging
them is how six of eight retrieval sources were silently dropped.

**R6 — Mark vocabulary that is not permanent, so the canon can be pruned rather than accrete.**
Two kinds, and they expire differently:

- ⏳ **Transitional** — real today, expires on a known event. _Parity_, _open_, _departed_ die
  when 0.6 ships and the legacy path goes. Delete them then; do not maintain them.
- 🚧 **Provisional** — designed but not built, so the words may still move on contact with
  implementation. The **Knowledge** vocabulary is provisional today.

A canon that never loses words stops describing the system and starts describing its history.
Anything unmarked is permanent and should be treated as expensive to change.

---

## 2. Identifier grammar

```
<namespace>:<kind>/<name>@<major>       core:query/world-lore@1
```

- **namespace** — `core` for first-party; a plugin's own otherwise.
- **kind** — `spec`, `query`, `task`, `provider`, `consumer`, `entry`, `shape`, `policy`,
  `vec`, `var`, `genre`, `script`, `extract`.
- **name** — kebab-case, singular.
- **major** — the pin. Version lives _in the id_, so every call site names it.

**Spec documents** carry a semver (`core:spec/respond` at `1.20.0`) because they are published
documents; **types** carry an integer major because they are pinned contracts.

---

## 3. The groups

| Group           | Owns                                                       |
| --------------- | ---------------------------------------------------------- |
| **Pipeline**    | spec execution — nodes, ports, the executor, receipts      |
| **Catalog**     | declared types and published specs                         |
| **Config**      | values, scopes, overrides, notices                         |
| **Retrieval**   | finding and ranking what goes in the prompt                |
| **Content**     | lorebooks, entries, bindings                               |
| **Session**     | messages, channels, cast, scenes                           |
| **Connections** | adapters, capabilities, sampling                           |
| **Indexing**    | the embedding and annotation lanes                         |
| **Extensions**  | plugins, hooks, scripts                                    |
| **Measurement** | parity, corpora, the A/B tool                              |
| **Knowledge**   | presence, perspective, temporality _(designed, not built)_ |
| **Media**       | images, attachments, thumbnails                            |
| **Graph**       | narrative nodes and relationships                          |
| **Shell**       | the rail, sidebar views, full page, Jump — §26             |

---

## 4. Pipeline

| Term                         | Means                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                   |
| ---------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **spec**                     | A published pipeline document. Versioned by semver.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                     |
| **node**                     | One step in a spec.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                     |
| **node kind**                | The closed effect classes, **ruled 2026-09-14**: **inlet** (run entry) · **query** (reads) · **task** (pure transform) · **oracle** (calls out to an external nondeterministic source — a model, TTS, image gen, embeddings, a human) · **outlet** (the only effect-capable kind: writes, attaches, emits — the run leaves into the world here). A sixth, **entry**, is the lorebook entry-type family riding the same registry and is not a pipeline kind. ⚠ Not a "type" — see **node definition** (§5). **Landed in code 2026-09-16** (plans/30 §U3, migration 0134): `Kind` in `descriptors.ts`, `pipeline_nodes.kind`, the builder verbs `.inlet() .query() .task() .oracle() .outlet()`, `TaskCtx`/`OracleCtx`/`OutletCtx`, and every definition id (`core:inlet/…`, `core:oracle/…`, `core:outlet/…` — the kind is part of the id grammar, 01 §3a). Every stored document was rewritten and republished once. _fan-out_ was never a kind — parallelism is the **gather** clause. |
| **port**                     | A node's declared input or output.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                      |
| **slot**                     | A declared parameter address a config value can fill. ⚠ Unqualified, _slot_ is always this one. The stats vocabulary's is an **attribute slot** and is always said in full (§9). Its SDK registry says the qualified word in every exported name (`defineAttributeSlot`, `getAttributeSlot`, `attributeSlots()`), so nothing in an import list collides with the pipeline `slot()` address helper. The **slot kinds** are a closed set: `connection · sampling · prompts · template · parameters · wire · variables · scripts · settings`. A `params` slot's fields are **shared** or **own** (2026-09-16, R-7 P2 refined): a field the definition marks `shared: true` resolves at the owner a `slot.params({ node })` reference names and renders once, on the owner; an unmarked field is the node's own through the same reference — resolved at its own address, rendered on its own step. |
| **settings slot**            | **Ruled 2026-09-15 (R-9), built 2026-09-16.** The one slot kind **the substrate declares** and no author may (the name is reserved; `register` refuses it): `enabled` on every `optional` definition, `review` on every definition whose `effects` gate (default = its `reviewDefault`), and `mode` on every **gather** clause. Projected onto the registry row by `snapshotRegistry` (`settingsSlotFor`) and declared for a clause by `clauseSettingsSlotFor` — a clause has no row, so the SDK is its declaration's home. **Not hashed** (`authoredSlots`): it is derived from `optional`/`effects`, which are. Addresses unchanged: `<nodeKey>.settings.enabled` / `.review`, `<clauseId>.settings.mode`. ⚠ Not a *substrate key* — that was the word for these while nothing declared them (plans/29 §7 R-9); retired. |
| **script point**             | **Interior point** (18 §4e): a named moment inside a binding's work where a user chain may run (`ctx.scripts.applyText(key, text)`), declared on the definition as `scriptPoints: [{ key, accepts, label, description? }]`. Since R-11 (built 2026-09-16) a point **declares what it accepts** — script kind ids, hashed like a port hook's `accepts` — and the executor hands that list to the applier; the bare-string spelling (`'each-draft'`) is ⏳ one release and reads as a text-transform point (`scriptPointsOf`). ⚠ Not a **hook site** — a hook site is a `scripts` slot's (port, phase) the substrate applies at; a point is the binding's to invoke. |
| **executor**                 | Runs a spec against scope data.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                         |
| **run**                      | **One spec execution.**                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                 |
| **turn**                     | **One exchange with the user.** May contain several runs — respond, narrate, summarize. ⚠ _Not_ a synonym for run.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                     |
| **step**                     | One node's execution within a run.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                      |
| **receipt**                  | The durable record of a run: nodes, outcomes, decisions, diagnostics.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                   |
| **halt**                     | A run that stopped deliberately. **Not a failure.**                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                     |
| **preview**                  | A run that stops before generating; nothing is sent, nothing is saved. Since 2026-09-15 a preview is a **dry run** — see below — so the outlets before the halt run and commit nothing.                                                                                                                                                                                                                                                                                                                                                                                                              |
| **dry run**                  | **Ruled 2026-09-15 (09-B B4, R-21 (1)).** A run whose outlets perform no writes: `ctx.commit` returns a **synthetic id** (`dry:<nodeKey>`) and reaches no host, the receipt's node row says `dry`, and the event the write would have caused is recorded flagged `dry` rather than emitted. `RunOptions.dry`; every preview is one. ⚠ Not a **preview** — a preview also halts; a dry run may go to the end.                                                                                                                                                                                       |
| **placeholder**              | **Ruled 2026-09-15 (R-17).** The reply row a pipeline creates for itself at an outlet straight after the inlet (`create-message` with `generating: true`; node key `placeholder`), empty and generating, filled by the spec's last outlet (`update-message`, key `save`). The create → update pair on that one row is **one primary row** — 01 §7's "one primary write" restated. The trigger inserts nothing. ⚠ In prose _placeholder_ is this row; the `{{char:N}}` cast placeholder is a **tag** (§8).                                                                                                  |
| **live row**                 | **Ruled 2026-09-15 (R-21 (2)).** The row the most recent live-row outlet committed in a run — the placeholder, on a reply — as the executor tells the host on every oracle call (`RunFacts.liveRow`). Where core routes an oracle's stream (the oracle stays blind to messages), and what Stop finalises. Declared per outlet (`Descriptor.liveRow`); `seed-greetings` writes N rows and is nobody's live row.                                                                                                                                                                                              |
| **one road**                 | **Ruled 2026-09-15 (09-B B4).** Every reply runs end to end — inlet → placeholder → … → oracle → save — through `utils/runReply.ts`. ⚠ **Retired:** the _adapter road_ / _preview-halt road_ (`generateResponse`: halt at the payload, the connection adapter sends and streams into the trigger's row) and the _second road_ (`runReplyToCompletion` with `fillMessageId`). Never reintroduce a trigger-side message insert.                                                                                                                                                                                 |
| **run kind**                 | **2026-09-16 (U1 review, W3).** What a registered run is FOR, as the message's own Stop reads it: **reply** (a turn filling a message row — `runReply`), **action** (a contributed function a person triggered — `sessions:triggerFunction`: a render, a summary), **maintenance** (nothing a person watches from the composer; reserved, nothing registers one yet). `RunHandle.kind` (`RunKind`). Stop is **row-scoped**: `cancelSession` stops a run whose live row is among the released rows, or a reply that has no row yet — never a session-mate's render. ⚠ Not a **node kind**, not a **stop kind**. |
| **gather branch**            | One member chain of a **gather** clause (`gather.worldLore.read`). ⚠ Not a "lane".                                                                                                                                                                                                                                                                                                       |
| **host service**             | Something a node may call out to (a database read, a model call).                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                       |
| **handler**                  | The function a node definition is bound to. Reads an `input` and returns a result; owns no I/O of its own. ⚠ Never "the binding" — see §8.                                                                                                                                                                                                                                                                                                                                                                                                                                                                   |
| **structural compatibility** | A handler may be bound to **any node definition that supplies everything it reads**. Nothing is said about the other direction: a definition may supply names the handler ignores. That asymmetry is what lets one handler serve several definitions — it is written against the **intersection** of what they supply. Checked by the compiler for core (`InputOf<C>`, `SharedInput<[A, B]>`) and as data everywhere the compiler cannot reach (`structuralCompat`) — a plugin binding another plugin's handler, the admin-side orchestrator. ⚠ Not "type compatibility": nothing is compared by name or by nominal identity. |
| **scope data**               | The data a run reads, derived from a session. _(was: `world`)_                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                          |
| **clause**                   | **Ruled 2026-09-15** (_was_ **block**, the container sense). A container of nodes with a repetition or branching rule of its own: **gather** (several chains collected — _was_ `async`; `mode: sequential\|parallel` is a setting, and by the equivalence law it is unobservable), **each** (once per item — _was_ `map`), **loop** (until a predicate says stop), **junction** (the branches whose predicates fired, any subset, optional default — _was_ `route`). Not a node — a clause publishes under its own id and its members are addressed through it, and **nodes and clauses share one address space**: a clause id may not equal a node key (the builder refuses it). **Landed in code 2026-09-16** with the kinds: `pipeline_clauses` (was `pipeline_blocks`), `ClauseKind`, `.gather() .each() .loop() .junction()`, `BuiltClause`, `clauseId`/`clauseKind`/`clauseChain`, a junction's `branches` (was `routes`). |
| **tool**                     | A **named, read-only function a model may ask for by name.** Canonically an extension's sandboxed hook; core ships four. A tool is not a node: it is dispatched by `core:provider/run-tool@1`, which is. ⚠ Never a synonym for a node, a hook or a script — a hook is _how_ a tool is usually implemented, not what the word means.                                                                                                                                                                                                                                                                    |
| **advertisement**            | What the model is told about its tools, in one of two forms: the **prompt door** (written into the context, for models that never heard of tools) or the **native door** (handed to the API's own tool field). One `advertise-tools` node publishes both.                                                                                                                                                                                                                                                                                                                                               |
| **tool loop**                | A `loop` clause whose predicate is "the model asked for a tool" — generate, read the answer back, run the tool, prompt again with the result. **The bounded agentic turn.** Its ceiling is mandatory. The reference spec keys it `tools` (landed 2026-09-16; was `agent` — _agent_ is the Adventure roles' word, §9), and the query that lists what the install offers is keyed `available` so `$.tools` names one thing. |
| **iteration**                | One pass of an `each` or `loop` clause's body. Numbered from 0, and the number is on every step's receipt row (`iteration`) — which is what makes "the third pass timed out" answerable.                                          |
| **carry**                    | What one iteration of a loop can read of the ones before it: the clause's own accumulating output (`$.tools.values`), and nothing else. An iteration never sees another's intermediate node values.                                 |
| **ceiling**                  | A repeating block's declared `max`. Hitting it is recorded (`stopped: 'ceiling'`) rather than inferred, because a truncated loop otherwise looks exactly like a finished one.                                                                                                                                                                                                                                                                                                                                                                                                                           |

**Resolved collisions**

- ⚠ **`provider`** → an AI company only: a **service** or **vendor**, matching `ConnectionServicePicker`. The node kind is **oracle** in prose and in code (2026-09-16). The old sentence "the provider node calls the provider" is the collision the rename removed; never write it.
- ⚠ **`runtime`** → the _pipeline_ runtime. The plugin execution environment is a **sandbox**.
- ⚠ **`world`** → the _fiction's_ world only. The executor's data object is **scope data**.
  There must not be a `buildWorld` in a product about building worlds.

---

## 5. Catalog

| Term                | Means                                                                                                                                                                                                                                                                                                                                                                  |
| ------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **entry type**      | A declared shape for a lorebook row. Always qualified.                                                                                                                                                                                                                                                                                                                 |
| **node definition** | A named, slugged, content-hashed declaration composed within a node kind — `core:query/vector-search@1`. **Always qualified.** The same relation an *attribute definition* (`hp`) has to its attribute type (§9). ⚠ **Ruled 2026-09-14:** _was_ **node type**, retired (§23) because _type_ collided with **kind** and with TypeScript's word. **Landed in code 2026-09-16:** `pipeline_definition_registry` / `pipeline_definition_declarations`, `definition_id` / `definitionId` / `definitionVersion`, `describe*Definition`, `getDefinition` / `allDefinitions`, manifest `nodeDefinitions`. `describeEntryType` and `lorebook_entries.type_id` keep _type_ — the entry-type word is not yet ruled. |
| **descriptor**      | What `describe*()` returns — the in-process declaration.                                                                                                                                                                                                                                                                                                               |
| **declaration**     | The authored description of a node definition or entry type: ports, slots, fields, roles.                                                                                                                                                                                                                                                                                                       |
| **registry**        | The persisted projection of declarations into the database.                                                                                                                                                                                                                                                                                                            |
| **slug**            | The **name of an indirection**: `core:query/vector-search@1`, `core:spec/respond@1.20.0`. It names whatever that type or spec currently is, never one fixed declaration. ⚠ Not a synonym for "id" in this section — an id may address a row, a slug addresses a pointer.                                                                                              |
| **content hash**    | A declaration's fingerprint — a digest of the declaration, or of the spec document. Changing either moves it. It is the **key** rows are stored under, and what a receipt pins.                                                                                                                                                                                        |
| **current pointer** | Which content hash a slug resolves to **now**. For a node definition it is the `pipeline_type_registry` row's `content_hash`; for a spec it is `pipeline_specs.active_version_id`. Moving it is what publishing does.                                                                                                                                                        |
| **publish**         | Filing a declaration or document under its content hash if it is unseen, then moving the slug's current pointer to it. Never rewrites and never deletes: a superseded hash stays resolvable for the receipts that pinned it. ⚠ _Was:_ matched on `(slug, semver)`, where an in-place edit was a silent no-op — that is what content addressing (2026-09-10) replaced. |
| **superseded**      | A declaration or document a slug has moved off. Still stored, still resolvable, no longer current. A spec version reads `status = 'retired'`.                                                                                                                                                                                                                          |
| **seed**            | Boot-time insertion of shipped rows.                                                                                                                                                                                                                                                                                                                                   |

**Resolved collisions**

- ⚠ **`type`** → always qualified (R3). Never bare — and **never for a node definition** (ruled 2026-09-14): _script type_ → **script kind** (2026-09-15); _entry type_ and _attribute type_ keep the word until ruled; the pipeline vocabulary says **node kind** for the five, **node definition** for the 94, **script kind** for a script's contract.
- ⚠ **`projection`** → the _registry_ projection and the _constraint_ projection. The
  row→candidate mapper in `host.ts` is **`toCandidate`**, not `project()`.
- · **`version`** → _definition version_ (integer; `definitionVersion` in code since 2026-09-16) · _spec version_ (semver) · _app version_.
- ⚠ **`slug` vs `hash`** → a slug is the question, a hash is the answer. "Which spec ran"
  is a slug; "which document ran" is a hash. A receipt records both, because a slug alone
  stops being an answer the moment the pipeline is edited.

---

## 6. Config

| Term             | Means                                                                                                                                                                                                                                                                                                                                   |
| ---------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **config**       | A named set of values for one spec. Bare `config` means this and only this.                                                                                                                                                                                                                                                             |
| **config value** | One stored value at one address.                                                                                                                                                                                                                                                                                                        |
| **deviation**    | A config value that **departs from the declared default** — which is the only kind there is. A config stores deviations, never a copy of what it would inherit, so a row's existence is what says somebody set it (ruled 2026-09-10). ⚠ Not an "override": that word is the _scope_ below a config, and this one is about the _value_. |
| **address**      | A node plus parameter path.                                                                                                                                                                                                                                                                                                             |
| **override**     | A value at a narrower scope than the config.                                                                                                                                                                                                                                                                                            |
| **scope**        | Where a value applies. The chain is **pipeline → config → chat override**, and it is deliberately narrow.                                                                                                                                                                                                                               |
| **cull**         | Removing a declared address, hard-deleting stored values and writing a notice.                                                                                                                                                                                                                                                          |
| **reconcile**    | Aligning stored values with current declarations.                                                                                                                                                                                                                                                                                       |
| **notice**       | A record that a value was culled, carrying what it held.                                                                                                                                                                                                                                                                                |

**Resolved collisions**

- ⚠ **`config`** → the pipeline one. Others are qualified: **connection settings**, **sampling
  preset**, **context template**.

---

## 7. Retrieval

| Term                 | Means                                                                                                                                                                                                                |
| -------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **mechanism**        | _How_ something was found: **keyword** · **semantic** · **entity** · **structural**.                                                                                                                                 |
| **band**             | _What kind_ of content, and its budget share: `worldLore`, `characterLore`, `history`, `messages`, `relationships`. The type is `RetrievalBand` — qualified, because `Band` is taken; see §10. _(was: `SourceKind`)_ |
| **source**           | The **vector index's** vocabulary: `message`, `worldLore`, `historyEntry`, `narrativeNode`, … Reconciled to bands at the seam, never merged.                                                                         |
| **signal**           | One scored component within a mechanism.                                                                                                                                                                             |
| **candidate**        | Something that might reach the prompt, carrying signals.                                                                                                                                                             |
| **decision**         | Selection's verdict on a candidate: included or not, with a reason.                                                                                                                                                  |
| **retrieval marker** | The mark a list row carries for the newest run's **decision** about it: ● fired, ○ considered, nothing when no mechanism reported on it. A reading of a decision, never a fourth outcome.                            |
| **block**            | **One message** in the assembled prompt — §15. What assembly places _inside_ one is an **allocation**, never a block.                                                                                                |
| **admission**        | Whether a candidate is _considered at all_.                                                                                                                                                                          |
| **eligibility**      | Whether a candidate _may_ be selected — a hard gate, distinct from score.                                                                                                                                            |
| **evidence**         | Non-keyword grounds for admission.                                                                                                                                                                                   |
| **share**            | A band's slice of the budget. **Declared on the source** since 2026-09-16 (R-7 P5): each retrieval definition's own `params.share`, a relative number the ranker normalises (`shareNormalisation`). Never the `share` control type any more — that divided one value over members, and there is no one value. |
| **minimum**          | A guaranteed least count for a band — `minEntries`, the label _Always keep at least_. The conversation's alone (R6); declared on `session-history`. _(was: **floor**, ruled 2026-09-16 — that word is the action model's, §9; the identifiers `minEntries` and `reserved_minimum` already said it.)_ |
| **threshold**        | A score cutoff below which a candidate is not considered — `thresholdMin` / `adaptiveThreshold`'s `max(threshold, topScore × fraction)` clause (`semantic.ts`). _(was: **floor**, ruled 2026-09-16 — a third sense distinct from both the action model's word and the retrieval **minimum**; never *floor* or *minimum*.)_ |
| **cap**              | A ceiling on a band — `maxEntries`, declared on the source; absent means none (`relationship-search`, whose own ceiling is the band's).                                                                             |
| **band intent**      | **Built 2026-09-16 (R-7 P5).** What one source says about its own place in the window — `{ band, intent: { share, maxEntries, minEntries, priority } }` — published as ONE element at the head of its candidates list and read off by the ranker (`BandIntent` in the SDK). ⚠ An element, not a wrapper: the list stays a flat array so every consumer and both `candidates/*` script kinds keep their contract, and an empty source still has a share. ⚠ Not "metadata" in code — the ruling's word for it in prose (16 §5a); the type is the intent. |
| **band priority**    | A band intent's `priority`: `low · normal · high · always`. `normal` is no ordering at all; `high`/`low` sort the band's entries ahead of or behind the others when the ranker sweeps leftover room; `always` takes every entry the window can hold ahead of the scored fill (`reserved_priority`) — **up to the band's `maxEntries`** (U3b review S1): a priority is a promise about the band, a pin about one entry, and only the pin steps over the cap. ⚠ Not the per-entry **priority** an author sets on a lorebook entry (a score bonus), which keeps the bare word in that vocabulary. |
| **band-namespaced field** | A band intent's field on a definition that produces MORE THAN ONE band through one port and so declares several intents in one `params` slot: `<band><Field>` — `worldLoreShare`, `historyMaxEntries`, `characterLorePriority` (`bandIntentFieldsOf` in the contracts). `lorebook-triggers@1` alone today; a lane declares the bare `share` / `maxEntries` / `priority` because it speaks for one band. Same labels, same defaults, one table (`LORE_BANDS`). |
| **gazetteer**        | The known-name vocabulary: titles, aliases, cast names, nicknames.                                                                                                                                                   |
| **mention**          | A span of conversation text that may name something.                                                                                                                                                                 |
| **link**             | A resolved mention → entry or character.                                                                                                                                                                             |

**The flow, every noun distinct:** a **mechanism** produces **candidates** carrying
**signals**; ranking **scores** them; selection turns them into **decisions** within a
**band's** budget; assembly turns those into **allocations** and renders them into
**blocks**; the **receipt** records it.

**Resolved collisions**

- ⚠ **`source`** → the _index_ vocabulary. The ranker's budget grouping is a **band**. This is
  the collision that silently dropped six of eight sources at ranking.
- ⚠ **`band`** → the _retrieval_ concept in prose, but the **type is
  `RetrievalBand`**, because `Band` is already a public SDK export naming a
  _connection capability grade_ (§10). Two live meanings of one bare word is the
  failure R1 exists to stop, so the newer use qualifies. The canon's own name for
  the SDK's is **capability grade**, so the qualifier belongs on that side and can
  be dropped here once that pass runs — §25.
- ⚠ **`weight`** → always qualified: **signal weight** · **mechanism weight** · **entry
  weight** (the per-row multiplier). A band's slice is a **share**, never a weight.
- · **`score`** → the number. The function is `score()`; there is no other kind of score.
- · **`budget`** → the token budget. A band gets a **share** of it.

**Retired:** _arm_ (→ **mechanism**) · _retrieval mode_ · _retrieval strategy_ (both removed —
every mechanism runs and contributes additively).

---

## 8. Content

| Term                | Means                                                                                                                                                                                                                                                                                                                                                                             |
| ------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **lorebook**        | A collection of entries.                                                                                                                                                                                                                                                                                                                                                          |
| **entry**           | One row of authored world content.                                                                                                                                                                                                                                                                                                                                                |
| **field role**      | What an entry field _does_ for the engine: title, order, priority, anchor, parent, key, embed text. ⏳ The declaration key is still `roles` — it is hashed into `core:entry/*@1`, so it moves with `@2` and not with a rename. _(was: `role`)_                                                                                                                                    |
| **trigger**         | An authored term that fires an entry. The column stays `keys`.                                                                                                                                                                                                                                                                                                                    |
| **secondary key**   | A condition key, combined by selective logic.                                                                                                                                                                                                                                                                                                                                     |
| **selective logic** | `AND ANY` · `AND ALL` · `NOT ANY` · `NOT ALL`.                                                                                                                                                                                                                                                                                                                                    |
| **binding**         | The link from a cast member to a character or persona card. **Content only.** ⏳ Ruled 2026-09-10: a `lorebook_bindings` row is a **cast member** (name, aliases, state, summary, graph node); _binding_ narrows to the card link; the `{{char:N}}` placeholder is a **tag**. UI label **Cast**.                                                                                  |
| **cast member**     | Someone who exists in a lorebook's world, carded or not. The row behind the Cast section. _(was: binding)_                                                                                                                                                                                                                                                                        |
| **moment bar**      | The story axis along the bottom of the lorebook workspace: a tick per dated entry and a chip at the moment being read (now, or any date). A reader. Setting the moment hides what has not happened yet and dims cast not yet in the story; it never edits a row. The **Time** lens is the axis drawn large, with lanes. ⏳ Dated amendments and branches are designed, not built. |
| **alias**           | An alternate name for an entity.                                                                                                                                                                                                                                                                                                                                                  |
| **anchor**          | The reference that governs an entry's visibility.                                                                                                                                                                                                                                                                                                                                 |
| **provenance**      | Who wrote a row: human, summarizer, graph builder.                                                                                                                                                                                                                                                                                                                                |
| **constant**        | An entry that bypasses retrieval entirely. Never a scoring boost.                                                                                                                                                                                                                                                                                                                 |
| **position**        | An entry's ordinal within its lorebook and type.                                                                                                                                                                                                                                                                                                                                  |

**Resolved collisions**

- ⚠ **`role`** → **field role** for entries. _Role_ alone means **authorization**. Messages
  keep **role** (`system`/`user`/`assistant`) — industry standard and never in the same file.
- ⚠ **`key`** → in prose, an entry's is a **trigger**. Bare _key_ means a database key.
- ⚠ **`binding`** → _content_ only. The node-type→implementation map is the **implementation
  registry**. ⏳ Expensive: schema, sockets, SDK. Its own pass.
- · **`field`** → an entry's declared field. A form control is a **control**.
- · **`position`** → ours. SillyTavern's _insertion position_ is deliberately not adopted.

---

## 9. Session

| Term               | Means                                                                                                                                                                                                                                                                                                                |
| ------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **session**        | One ongoing piece of fiction. _(formerly "chat")_                                                                                                                                                                                                                                                                    |
| **message**        | One authored or generated line.                                                                                                                                                                                                                                                                                      |
| **channel**        | A separate conversation within a session — a phone thread beside a scene. Default `main`. ⚠ Never call this a _lane_; that word belongs to indexing (§11).                                                                                                                                                          |
| **genre**          | What kind of session this is; owns its pipelines.                                                                                                                                                                                                                                                                    |
| **cast**           | The characters present.                                                                                                                                                                                                                                                                                              |
| **speaker**        | Whoever is producing the current turn. On an inlet and a turn strategy, the `speaker` **port** is a **participant reference** — `character:<id>` or `envoy:<slug>` — never a bare id (R-18 (3), built 2026-09-16); the side character's whole fact rides `sideCharacter`. Who _portrays_ the speaker is the resolver's answer (**portrayal**), the AI's unless a member's presence is seated. |
| **portrayal**      | **Ruled 2026-09-16.** Who portrays a participant this turn — the resolver's answer to a **participant reference**: `person` (a member, by user id) · `ai` · `none`. Resolved **once at run start** for every run in a session that reaches the model (never for a pre-call preview), pinned on the receipt as `portrayals` (`Portrayal` / `Portrayals`, `resolvePortrayals` + `turnRefs` in `runtime/portrayals.ts`, `RunOptions.portrayals`, `HostScope.portrayals`, the inspector's **Portrayed by** line). ⚠ Not a _voice_ — that word is the adventure stage below and a connection's TTS voices — and not a _cast_ row: a portrayal is decided, a cast row is joined. |
| **persona**        | The user's own presence in the fiction — **a character the user voices**, never its own row. Ruled 2026-09-15: the `personas` table and the `personas:*` socket family are gone (§23); a **persona** is a **character** with `is_persona` set (one the user plays: set the first time it joins a session as theirs, on persona-catalog or SillyTavern persona import, by the setup wizard, or by hand; never cleared automatically) and `is_default_persona` names the one a new session starts with (at most one per user). The word keeps every _role_ use: `session_personas` (the characters users voice in a session), `messages.persona_id` (the character the user voiced this line as — the column is kept and now references `characters`), `{{persona}}`, `{{personaNames}}`, the persona switcher, the persona picker. UI label **Persona**, badge `UserRound`. ⚠ Not a separate kind of participant: a session's user-voiced cast are `session_personas` rows, and the same character may be AI-voiced in another session. |
| **envoy**          | **Ruled 2026-09-15, built 2026-09-16 (plans/30 U5g).** A speaker a **genre** brings with it — declared on the genre as an array (`GenreDecl.envoys[]`: `key`, `name`, `image`, `description`, `prompts`, `default`, `speaks`; SDK `EnvoyDecl`) and existing nowhere in the library. A cast member — a `session_characters` row with `envoy_slug` and no `character_id` (migration 0138) — with `origin: genre`; addressed as `envoy:<slug>` wherever a character would be `character:<id>` (audiences, the inlet's speaker port, `metadata.speaker` on its message row). **`speaks`** (R-21 (6)): `in-turn` (a turn-taking candidate; a genre's default) or `on-action` (speaks only through its action; the only value an action's envoy may carry). Its data (`prompts`, `description`, `image`) is **configuration**: genre-declared defaults read by pipeline nodes through `slot.prompts({ envoy })` — the config address `envoy:<key>`, the SDK's `envoyPromptsSlotFor` declaring the slot — and tuned in the Pipelines panel as deviations under a step named **Envoy · <name>** (no second schema). Declared in one of two places: on a **genre**, or on a **contributed action** (§12, `ActionDecl.envoy`) — an action's envoy is the speaker its results post as (`envoy:<plugin>.<key>` for every action's, core's included, so the dot says `origin: action`) and speaks only through that action. Nothing adds an envoy to another genre and no user authors one (`declaredEnvoys` is the host's one reader; `seatEnvoy` refuses an undeclared slug). A genre with one envoy and `characters: { max: 0 }` is the pure user/assistant session type — **Guide** (`core:genre/guide`, envoy `mascot`, preset `guide-default`), the structural successor to the retired Assistant Chat (§23), whose code is never reused. ⏳ The mascot's name ("Guide") and art (an inline placeholder glyph) are the project owner's to set; `EnvoyDecl.image` is a URL-or-`data:` string until a package can ship an asset. ⚠ Not a _character_ (a library row) and not a _persona_ (the user's own). |
| **scene**          | A bounded stretch of a session.                                                                                                                                                                                                                                                                                      |
| **branch**         | A copied divergence of a session.                                                                                                                                                                                                                                                                                    |
| **attribute slot** | A declared, typed value about one owner that changes — health, mood, weather. Declared once (core owns the five types; genres, plugins and admins compose the definitions), attached where it is true by default, valued where play happens. ⚠ Always said in full: bare _slot_ is the pipeline word (§4).          |
| **derived slot**   | An attribute slot computed on every read from other facts and a clock, and therefore **never stored** — age, from a birthdate and the story date. Absent rather than zero when its inputs are missing. Derived-vs-stored is a property of the declaration, not a habit.                                              |
| **possession**     | An **edge** saying a cast member (or the world) is carrying a lorebook entry, with a quantity. ⚠ Not an attribute: an item is an entry, so it keeps its prose, keys and retrieval, and an inventory is edges pointing at entries.                                                                                   |
| **proposal**       | A change to state the **model** asked for, held until a person accepts or rejects it. The user's own edit and a genre script's write apply immediately; only the writer with no authority passes the gate. ⚠ Distinct from a **graph proposal** (§17), which is the same discipline applied to the narrative graph. |
| **action**         | **Ruled 2026-09-15** (plans/29 R-15); venue · audience · quick · slash name **built 2026-09-16 (U5c)** as `ActionDecl` on `contributes.actions[]` and `CORE_ACTIONS` for core's verbs (SDK `actions.ts`); enabled-when reserved (`enabledWhen`, U5e). Anything a person or an AI-voiced participant invokes: a composer button, a message-menu item, a slash command, a widget control. Declares a **venue**, an **audience**, `quick`, an **enabled-when** predicate and, for composer actions, a **slash name**. Its `key` is its identity within the spec (the *new* mark, `invoke`); its `function` is what routing resolves — several actions, and several specs, may share one. ⚠ Not a _pipeline_ (an action starts one) and not an _event_ (core-owned occurrences). A **built-in** is a state-altering action core implements and always emits with what changed (delete, ghost, swipe, hide, edit, branch, stop); a **floor** is a built-in no genre may remove (stop, branch, edit). Content-producing actions (continue, regenerate, narrate) are declared by the genre and its pipelines. |
| **built-in**       | **Ruled 2026-09-15, built 2026-09-16 (plans/30 U5b).** A state-altering write core implements and always emits with what changed and what was lost: **delete** · **hide** (a ghost) · **edit** · **swipe** · **branch**, each a core outlet (`core:outlet/delete-message@1` …) run as its own one-node spec (`core:spec/builtin-delete` …, inlet `core:inlet/built-in-request@1`) through `runBuiltIn` (`runtime/builtins.ts`) with run kind `action` — receipted, gate-eligible, its event on the receipt and in the session's **changes**. **Stop** is a built-in with no outlet: the run-level guarantee (R-17) emits `message-stopped` from the finalisation, and the row says `generation_outcome = stopped`. A genre may switch an **opt-in built-in** (delete · hide · swipe) off through `messageVerbs`, never re-implement one. Content-producing actions (regenerate · continue · a swipe's fresh alternative) are **built-in write + declared content**: the genre's pipeline makes the text and the reply's own `update-message` records `message-updated` with the **verb**. ⚠ Not a _floor_ (the subset no genre may remove) and not a _venue_ (where it appears — U5c). |
| **floor**          | **Ruled 2026-09-15 (R-15, R-20).** A built-in no genre may remove: **stop** · **branch** · **edit**. Unrepresentable in `SessionShape.messageVerbs`; a declaration naming one `false` is refused at registration (`assertMessageVerbFloors`, `MESSAGE_VERB_FLOORS`) and the app's `MessageVerbPolicy` has no key for one. A promise about the _genre_, not about who may act: branch is owner-only in every genre, and the item rule applies to a floor as to any verb. **The action model's word alone** since 2026-09-16 — the retrieval sense (`minEntries`) is a **minimum** (§7). |
| **session change** | **Built 2026-09-16 (plans/30 U5b).** One built-in's event as the next reply reads it: `{ event, sessionId, messageId, at, lost? · previous? · hidden? · swipeIndex? · verb? · textLength? · fromSessionId? · fromMessageId? }` — `SessionChangePayload`, shape `core:shape/session-change@1`, table `session_changes`, module `messages/sessionChanges.ts` (`recordSessionChange` · `pendingSessionChanges` · `markSessionChangesConsumed` · `peekSessionChanges`). Published on the turn inlets' **`sessionChanges`** port (`user-message@1`, `side-character-turn@1`; was `changes` until 2026-09-16 — that word is the state ledger's on `resolve-state-changes@1` / `set-state@1`, R1), oldest first, newest fifty and a **`session-changes-truncated`** marker past that, **consumed** by the reply run that receives it (`consumed_by_run_id`, stamped after the run and only when it produced a reply) and only peeked by a preview. Once consumed, `lost.content` / `previous.content` are nulled on the row — the content exists for one reader (U5b review W4). ⚠ Always said in full: bare _change_ is the state ledger's word (`StateChange` · `PossessionChange`, §9 **proposal**), and a session change is about a **message**, never a value. |
| **venue**          | **Ruled 2026-09-15, built 2026-09-16 (plans/30 U5c).** Where an action appears, per **channel**: `message` (the ⋮ menu and the row's quick icons) · `composer` (the chips and the More menu) · `extra` (the turn controls) · `widget` · `session-settings` · `pipelines` · `admin` · `review`. `VENUE_KINDS` in the SDK's `actions.ts` — a closed set core owns; a plugin picks from it, and an unknown kind is refused at construction. Declared as `venue: { kind, channel? }` (one or a list) on `contributes.actions[]`; a venue naming a channel appears there alone. Every venue is a **primary set** (`quick`) plus an **overflow** that always lists every enabled action (`listSessionActions` → `sessions:actions`), and composer actions are always reachable by `/` — so a newly installed action is never silently hidden. ⚠ Placement is presentation (a CSS pack may reposition); availability is data. _Was:_ trigger `kind`, taxonomy `zone`, the `advanced` bucket, `group: 'behaviour'`, `side` — all retired; `contributes.triggers[]` is ⏳ the deprecated alias of `contributes.actions[]`, one release. |
| **audience**       | **Ruled 2026-09-15, built 2026-09-16 (plans/30 U5c).** Who may _see_ and who may _act_ on an action or a form, as **participant references**: `owner` · `admin` · `participant` · `user:<id>` · `character:<id>` · `envoy:<slug>` · `item` (the per-message ownership rule) · `run-owner`. `Audience { see, act }` on the declaration; a contributed action defaults to `see: participant / act: owner` (`DEFAULT_ACTION_AUDIENCE`), a core verb to `item` (`ITEM_AUDIENCE`). Evaluated for a viewer with the portrayal resolver's rules (`resolveAudiences` · `audienceHolds`): a reference the viewer _is_ admits them; `item` is **item-gated** — decided per message, on the client by `canControlMessage` and on the server at the verb; `sessions:triggerFunction` reads `act` before it runs, owner-only where nothing declares. Resolved **once at run start** for a run (**portrayal**, below) and pinned on the receipt. ⚠ Not _availability_ (that is the genre's `messageVerbs` and the preset's included set) and not a config **scope** (§6). _Was:_ `scopes.ts`'s admin-or-prompts rule, `FieldDecl.scope`, `WidgetDecl.scopes`, "permission tier". |
| **primary set**    | **Built 2026-09-16 (U5c).** The actions a venue shows up front — those declaring `quick: true`: the composer's chips, a message row's hover icons (regenerate · edit, and the Stop pill). Never the whole venue: the **overflow** holds the rest. ⚠ Not _availability_ and not _audience_: prominence only. Code: `VenueActions.primary`. |
| **overflow**       | **Built 2026-09-16 (U5c).** The list every venue keeps of _every_ enabled action, quick or not — the composer's **More** menu, a message's ⋮ menu — so nothing is reachable only by hovering and nothing is hidden by prominence (F38). A **new** action (one the viewer has not met — `seen_actions`, keyed `<spec slug>#<key>`, cleared by `sessions:actionsSeen` when the list that shows it opens) lands here with its mark. Code: `VenueActions.overflow`, `SessionAction.isNew`. ⚠ Not the composer's _More_ panels menu (Lore, Pinned images), which is a different control with the same word on it. |
| **slash name**     | **Ruled 2026-09-15, built 2026-09-16 (U5c).** The stable ASCII id a composer action is called by from the `/` **palette** (`SessionComposer`, logic in `slashPalette.ts`): core's are bare (`/narrate`, `/continue`, `/retry`), a plugin's are `/<plugin>.<action>` with the plugin id being the spec's namespace (`slashFindings`, `BARE_SLASH`, `NAMESPACED_SLASH`) — a collision across owners is impossible by grammar, and one slash name meaning two functions in one genre is refused in a document, a package (`announce.build()`) and an install (`publishVersion`) alike (`slashCollisions`). Declared as `slash`, else derived from the key (`slashNameOf`). Never localised (R-20): the palette shows the label beside it. ⚠ Not a _label_ and not a _function key_ (several actions may fire one function). |
| **enabled-when**   | **Ruled 2026-09-15.** A declared predicate over published values that says whether an action is offered _now_ — the **junction** clause's predicate shape (§4), never code. The genre supplies defaults; a session event may override for that event. The panel renders _why_ a control is grey. |
| **form**           | **Ruled 2026-09-15.** An action still awaiting its answer, addressed to an audience, carried in a message or the composer. An addressee portrayed by the AI this turn is answered by the genre's built-in pipeline on the `form-addressed` core event through an **oracle** with the `json` capability — receipted, reviewable, never magical. **The effects line:** a form whose answer has effects outside the fiction (cards, lorebooks, settings, permissions) has audience `owner` only, is never oracle-answerable and never lives in a `message` venue. A form is **stale** once the channel head has moved past the turn it was issued at. ⚠ Not a _review_ — the review gate is the owner's and no pipeline ever sees a confirmation, only the request and the result. |
| **status**         | **Ruled 2026-09-15, built 2026-09-16 (plans/30 U5h).** Ephemeral, localised progress text a node sets from inside its execution — `ctx.status({ i18n, vars })` on every kind's ctx (SDK `status.ts`: `StatusText`, `renderStatusText`, `fillStatusVars`): _{speaker} is thinking_ from a query, _{speaker} is composing_ from `assemble`, _{speaker} is typing_ from the oracle before its call, _summarising part {n} of {total}_ from a draft (`ctx.iteration`), _building the graph: {step}_. Persists until the next status or run end; the executor hands each **change** to the host (`RunOptions.onStatus`), and the host's **status relay** (`runtime/runStatus.ts`) fills `{speaker}` — the one host-filled variable, `HOST_FILLED_STATUS_VARS` — from the run's speaker (a character's name, an envoy's, else the narrator's), writes it onto the live row's `generation_status` (migration 0139; the `sessionMessage` frame's `generationStatus`), keeps it on the run handle for `sessions:list` (`runStatus`), announces each change as **`sessions:runStatus`**, and feeds the caller's own frame (`pipelines:progress.status`, `sessions:summarize:progress.status`). The LLM queue's waits are statuses in the same voice — _waiting for the model_, _loading the model_ — shown only once they have lasted (`QUEUE_STATUS_DELAY_MS`). The client resolves the locale (`statusText()` in `client/i18n/state.svelte.ts`). Never a parameter; never on the receipt except the **last** one (`Receipt.lastStatus`) at halt/err/cancelled — never on `ok`, never on a preview's halt — which the inspector's sentence reads. _Replaced_ the `generationStage` enum (⏳ column kept unread for one release). ⚠ Not HTTP's `statusText`, not a run's **outcome**, not the queue's `LLMQueueStatus`, and not `lane status` (§10). |
| **surface**        | A named, versioned UI extension point a plugin renders into (`core:surface/chat-message@1`) — 01 §1's sense and **only** that sense (ruled 2026-09-15). ⚠ _Never_ "event surface" (say _the genre's events_), "trigger surface" (_enabled triggers_), "hook surface" (_hook ctx_), or "a surface" for any screen. |
| **widget**         | A session-view component in one of the three layout **zones** (plan 25), with its own per-participant settings row. Its data envelope carries the action venues as `actions.v1` and the `invoke(key, args)` verb (U5c; `shared/widgets/context.ts`, frame port `{ t: 'actions' }` / `{ t: 'invoke' }`). ⚠ Not a _panel_ — the SDK's `PanelDecl` is ⏳ misnamed; _panel_ in prose is the Pipelines panel (§26). |
| **composer skin**  | **Ruled 2026-09-16.** One of the three built-in forms of the message field on the **messages** widget — *classic* (the card), *minimal* (a one-line pill), *writer* (a tall editor in the prose face) — chosen by the widget SETTING `composer`. ⚠ Not a **widget style**: a style is CSS a person can clone and edit; a skin is structural and shipped. Code: `composerSkin` prop, `data-composer-skin`. |
| **zone**           | One of the three layout zones of the session view — Left · Middle · Right (plan 25). **Only** that (ruled 2026-09-15): the catalogue `taxonomy.zone` is retired — the inlet's genre lock says where a pipeline runs and `role` says what it is. |
| **trigger**        | Anything that starts a run: an action a person fired, a core event, a schedule. Reserved word (01 §1) — never a synonym for a hook, a binding or an action. `contributes.triggers[]` is ⏳ the **deprecated alias** of `contributes.actions[]` (U5c, 2026-09-16), folded at construction for one release; `sessions:triggers` likewise the deprecated projection of `sessions:actions`. Its `kind: event\|schedule` values are retired (a person-less start is a core event). |
| **session preset** | The bundle a person picks to start a session: a genre, an event → pipeline (+ config) binding per genre event, included actions, creation defaults. Admin-owned. ⚠ A genre **event** it binds is an _event_, never "a slot" (the create slot, an open slot). |

**The Adventure genre's four agents.** Words for the _roles_ in one multi-agent turn, not for
node kinds or for pipelines: each is a stage of `core:spec/adventure-respond`, and each has its
own context node definition so it has its own editable prompt.

| Term             | Means                                                                                                                                                                                                                                               |
| ---------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **planner**      | The stage that decides what happens next and **who speaks**, and writes no prose. Also the value of the genre's `nextSpeaker`: turn-taking is this stage's output, never round-robin.                                                               |
| **narrator**     | The stage that writes the scene from the plan. Narrates the world and its consequences; never speaks for the cast. ⚠ Distinct from the standard chat's **Narrator Response**, which is a manually-triggered message rather than a stage of a turn. |
| **voice**        | One cast member's turn inside a reply: one generate per speaker the planner named, each knowing only what that character knows. Not a _speaker_: the speaker is whoever is producing a turn, and an adventure turn has several.                     |
| **state-keeper** | The stage that reads the finished reply and reports what it made true, as attribute and possession changes. It reports; it does not decide: its output is a **proposal** unless the session's `trustNarrator` field says otherwise.                 |

⚠ The four split two ways, and the split is what decides how each is put on the wire. The
planner and the state-keeper are asked a **question**: no speaker, no line to continue, and
the answer's shape carried by whichever **structured door** (§10) the connection opens. The
narrator and the voices take a **turn**: each prompt ends on its own speaker's line, the
narrator's being the Narrator. A question's transcript is **prose only** — a JSON block an
earlier reply left behind is cut on the way into the prompt and never in the stored message,
or the next planner reads its own shape back and the state-keeper answers in the planner's.

**Resolved collisions**

- ⚠ **`character`** → a cast member. A text position is an **offset** or **column** — never
  "character 494" in a system with a character named Vell.
- · **`message`** → a session message. Socket traffic is an **event**; an error carries
  **text**.
- · **cast**, not _participants_.
- ⚠ **entry / edge / attribute slot** are three different things and conflating them is the
  classic modelling trap. A named topic with prose is an **entry**; "this relates to that" is an
  **edge** (a relationship or a possession); "this owner's number changed" is an **attribute
  slot**. See docs/stats-and-states.md.

**Socket interest** — transport vocabulary, used app-wide, recorded here because §9 is where
_event_ is defined. Built 2026-09-14 (phases 1–3 of `~/.claude/plans/socket-interest.md`).

- · **interest** — a client's declared wish to receive one kind of event. Not a _lease_ (a
  model permission, §10), not a _subscription_, not a _watch_.
- · **interest key** — `event` or `event#scope` (`sessions:streamChunk#42`). Never the bare
  `key`. `interestKey()` in `shared/sockets/interest.ts`.
- · **interest registry** — the ONE client module holding every subscriber, counted per key,
  one raw socket listener per event name: `client/sockets/interest.svelte.ts`
  (`declareInterest`, `requestWithInterest`, `useInterest`). Contexts `interest` and
  `adminInterest` wrap it; the second exists only inside `/admin`.
- · **interest set** — the server's per-socket copy of the keys (`socket.interest`), cleared
  on disconnect, never on silence.
- · **interest sync** — the `interest:sync` message: the client's full key list, replacing the
  set. Sent before a request it wants answered, on every key change, every 30 s, and on
  every connect. Self-healing, not a keepalive.
- · **interest gate** — the check in `emitToUser` and `broadcastHelpers`: a **gated event**
  (in `GATED_EVENTS`, empty until a family's last consumer has moved to the registry) is
  emitted per interested socket, or not at all — and a **thunk** passed as its payload runs
  only then, so the cascade's query is never paid for a reply nobody wants.
- · **interest scope** — the `#scope` half of a key, and the only way a push is narrowed to one
  entity. `SCOPED_EVENTS` in the shared module is the ONE table saying where each scoped
  event's scope lives in its payload (`scopeOfPayload`); both sides read it, because a client
  guessing a scope the server does not extract is a silent drop. A bare key means every scope.
  `sessions:get` scopes on `payload.session.id`, not a top-level `sessionId` — the table says so.
- ⚠ **restricted interest** — a key under `RESTRICTED_INTEREST_PREFIXES`, whose whole family
  is admin-only. Refused by the registry for a non-admin and dropped by the server from a
  non-admin's sync. Defence in depth: the handlers' own admin checks remain the boundary. A
  family with one non-admin reader (`activity:`, `connections:`, `systemSettings:`) must
  never be listed, or non-admins go dark on it.
- · **held restricted interest** — a restricted key declared while the user is still
  UNKNOWN (before `users:current` lands, or after a logout). Held, not _refused_: the
  subscriber is kept but the key is in no sync, so an unidentified session names no
  restricted key on the wire. `setInterestUser` empties the hold — an admin declares them for
  real, a non-admin drops them as refused. "Unknown" is not "non-admin" (2026-09-15).

---

## 10. Connections

| Term                       | Means                                                                                                                                                                                                                                                                                                                                                                                                                      |
| -------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **connection**             | A configured way to reach a model. Since 0114 the row is an **endpoint** and the models it reaches are rows of their own — see the three entries below.                                                                                                                                                                                                                                                                    |
| **endpoint**               | **What a `connections` row IS** since 0114: where the compute is — base URL, key, wire protocol, the capabilities the _protocol_ can express. The table keeps its name and its ids (every foreign key points at it), so _connection_ and _endpoint_ name the same row; say **endpoint** when the point is that it is not a model.                                                                                          |
| **connection model**       | One row in `connection_models`: a model reachable **through** an endpoint. Holds the identifier the adapter sends, a display name, and _overrides_ of the endpoint's prompt format, token counter, capabilities and context window. ⚠ Never a **local model** (above) — that is a file on disk this install owns; this is a name an endpoint answers to, which for a managed connection happens to be that file's.        |
| **(endpoint, model) pair** | What every selection in the app actually is: a capability default or a pipeline's provider slot — the only two tiers; a session names no connection (ruled 2026-09-15, §23). **Both halves are required.** A registration naming only the endpoint is *incomplete* and resolves as *unconfigured*, with a sentence naming the fix — never as some model the endpoint is presumed to mean (ruled 2026-09-15; §23 _default model_). ⚠ The two halves never travel apart: a model belongs to one endpoint, so changing the endpoint _clears_ the model rather than carrying it across. |
| **capability default**     | The instance-wide pair registered for one capability (`text->text`, `text->image`, `text->embedding`, …): one row of `connection_defaults`, keyed `(input, output)`, carrying `connection_id` + `connection_model_id` (+ a sampling config). Set from **Admin → Defaults**, a model view's **Set as default…**, or a manager's **Use for chat** / **Use for image generation** — every one of them the same registration. What a run uses when nothing overrides it. |
| **service**                | The vendor: Ollama, OpenAI, KoboldCpp. _(never "provider")_                                                                                                                                                                                                                                                                                                                                                                |
| **adapter**                | The code that speaks a service's protocol.                                                                                                                                                                                                                                                                                                                                                                                 |
| **local model**            | A model **file this install owns**, on disk — one row in `local_models`. Not a connection and not a service: a connection may _point at_ one by bare filename. Vendor-neutral by construction, because `.gguf` is not KoboldCPP's — llama.cpp opens the same bytes — so no row names an engine; which engines can load one is **derived** from format and modality.                                                        |
| **model format**           | The **container**: `gguf` · `onnx` · `safetensors`. A property of the bytes, read off the file, so it carries no provenance. ⚠ Says nothing about what the model is _for_ — the curated image models are every one of them `.gguf`.                                                                                                                                                                                       |
| **modality**               | What a model is **for**: `text-gen` · `embeddings` · `image-gen` · `ner` · `tts` · … An open vocabulary whose contract is the SDK's connection _shapes_. One word across `connections.modality` and `local_models.modality` — a connection binds a local model of its own modality. ⚠ **Not detectable from a file**, which is the half `kind_source`'s trust ordering grades. Icons are the output kind's — §22.         |
| **capability**             | What a connection can do: `text->text`, tools, streaming.                                                                                                                                                                                                                                                                                                                                                                  |
| **capability grade**       | How well it does it. The grades are `none` · `emulated` · `native`, exported by the SDK as `Band` / `BAND` / `bandOf` / `bandsFor` — ⚠ **nothing to do with a retrieval band** (§7).                                                                                                                                                                                                                                      |
| **sampling preset**        | Temperature, penalties, context window.                                                                                                                                                                                                                                                                                                                                                                                    |
| **structured door**        | Which of three ways a step asks for a JSON answer, chosen from the connection's own capabilities and recorded on the receipt: **schema** (the shape travels, natively or compiled to a grammar), **object** (JSON, shape unsaid), **instruction** (a sentence in the prompt, which every backend can be asked). A property of the REQUEST, never of the prompt somebody wrote.                                             |
| **wire mode**              | Which _method_ a service is called by for the same capability: **chat** (role-tagged messages) or **completion** (one text prompt). A connection capability like any other, resolved preset → test → hand-set override (ruled 2026-09-07). Never "chat format" — that collides with prompt format below.                                                                                                                   |
| **prompt format**          | How blocks become wire text: Vicuna, ChatML, split-chat. ⚠ Meaningful **only in completion wire mode**; in chat mode the roles carry the structure and this must not be offered. The _value_ on a connection; the row it names is a **completion template**.                                                                                                                                                              |
| **completion template**    | One row in `completion_templates` — per-role prefix/suffix, stop strings, and a render mode. **Data, never code**: a template that can compute is a template that can be made to do something other than format. Built-ins seed immutable; a variant is a **clone**. `connections.prompt_format` is an FK to its `key`.                                                                                                    |
| **render mode**            | `flat` (one completion string) or `role_array` (role-tagged messages). An **explicit column**, because it used to be decided by `/split/i` against the format _name_ — so any admin-authored name containing "split" would have silently rerouted the pipeline. ⚠ `role_array` is `split_session` only and is **not admin-authorable**; admin templates are flat, which is what keeps them outside the injection surface. |
| **recommended list**      | The fetched catalogue of local ONNX models — `embeddings.yaml` / `ner.yaml` from `SerenePub/serene-pub-onnx-list`, cached a day under the data dir, with the built-in copy as fallback. Its fields are the model's facts: `tier` (fast · balanced · best), `size` (MB), `dimensions` / `labels`, `max_input_tokens`, `pooling` (mean · cls · last_token), `prefixes`, `tags` (`long-input`, `multilingual`, …), `released`, `license`. Never "catalogue" for the fetched thing — that word is the built-in fallback's. Entries with `last_token` pooling are excluded until the loader can pool that way. |
| **local model state**     | What a local ONNX connection model's FILES are doing on this machine: `not_downloaded` · `downloading` · `on_disk` · `error`. A fact about the disk, re-checked on every sync, never durable state — and independent of being the default. Rides on `ModelRow.local`. ⚠ Never a **local model** (§10 above): that is the registry row; this is the row's disk state. |
| **active** (local modality) | The capability default for `text->embedding` or `text->entities`, called _active_ in the UI because there is exactly one per modality app-wide. Not a flag, not a column — the same `connection_defaults` row every other default is. **Make active** = _Set as default…_ for that one transform. |
| **Defaults mode**         | The Connections index with the _Defaults_ filter pill on: a ledger of every transform grouped by output kind as Admin → Defaults groups them, set ones naming their pair, unset ones dashed. Shows; never edits. |
| **defaults pill row**     | The at-a-glance strip above the Connections index: one status pill per transform that has a default, plus one dashed "K not set" pill. The caption's M counts every SDK transform. |
| **lane status**           | `vectorization:status` / `ner:status`: whether the lane's model is loaded, when it was last used, its idle timeout, and the queue's pending count. The header line and the model view read it; the row's `local.loaded` is only a copy. |

**Resolved collisions**

- ⚠ **`wire mode` vs `prompt format`.** Both answer "what shape goes on the wire", and
  conflating them is what let a live defect hide: adapters derived wire mode from their own
  local flags while the pipeline rendered a prompt format nothing carried. **Wire mode is the
  _method_** (chat or completion, a property of the connection); **prompt format is the
  _delimiters_** inside a completion's single prompt string. Chat mode has no prompt format —
  not a default one, none. Say _wire mode_ for the first and never "chat format" for either.
- ⚠ **`model`** now has two senses in one sentence and they are not interchangeable. A
  **connection model** is a row: a name an endpoint answers to, with its own settings. A
  **local model** (§10, above) is a file on disk this install owns. A managed KoboldCPP
  connection has both, naming the same GGUF, and they are still different things — deleting
  the file forgets the row, deleting the row leaves the file. Say **connection model** or
  **local model** whenever both are in scope; bare _model_ is only safe when it clearly means
  "the thing on the other end".
- ⚠ **`capability`** → _connection_ capabilities. A plugin's is a **permission**. The
  manifest itself was never the obstacle it was feared to be: it has always spelled the
  field `permissions`, so the rename reached the code without touching the public
  contract. See §25 for the one sense it deliberately left alone.

---

## 11. Indexing

| Term                 | Means                                                                                                                                                                                                                                                                                                                                                                       |
| -------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **lane**             | An independent background processing queue with its own model, TTL and lifecycle. **Indexing only** — ⚠ and not yet true in the codebase: the word still appears for session channels (§9), `llmQueue`'s own `Lane`, Argon2id's parallelism parameter (OWASP's word, leave it), and loosely for _a workstream_ in comments. The first is a real collision; §25 carries it. |
| **broker**           | What a lane asks for a model. A lane never loads one itself.                                                                                                                                                                                                                                                                                                                |
| **lease**            | Permission to use a model, possibly pending. _(was: `grant`)_                                                                                                                                                                                                                                                                                                               |
| **residency**        | Whether a model is loaded.                                                                                                                                                                                                                                                                                                                                                  |
| **promotion**        | Moving specific items to the front of a lane's queue because a query needs them now.                                                                                                                                                                                                                                                                                        |
| **sweep**            | A lane's periodic scan for new or stale work.                                                                                                                                                                                                                                                                                                                               |
| **named vector**     | One of several independently-queryable vector spaces per row.                                                                                                                                                                                                                                                                                                               |
| **freshness triple** | `sourceHash` + `extractorVersion` + `gazetteerHash`.                                                                                                                                                                                                                                                                                                                        |
| **annotation**       | An extracted entity recorded against a row.                                                                                                                                                                                                                                                                                                                                 |

**Resolved collisions**

- ⚠ **`grant`** → **lease** for models. _Grant_ means a plugin permission. Fresh collision,
  cheap now.
- ⚠ **`lane`** → indexing only. Spec branches are **gather branches**; retrieval ways are
  **mechanisms**.
- · **`vector`** → the embedding. A **named vector** is the space.

---

## 12. Extensions

| Term            | Means                                                                                                                                                                                                                   |
| --------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **hook**        | A declared point where authored code may run.                                                                                                                                                                           |
| **script**      | Authored code at a hook, **written and edited in the app by an admin or a modder**. No packaging, no install step. Core may ship one, but that does not make _script_ mean first-party — origin is not the distinction. |
| **script kind** | **Ruled 2026-09-15** (_was_ **script type**). The declared contract a script is checked against for a given hook (`core:script:candidates/filter@1`, `…/rescore@1`) — the kind-relation, so it takes the kind word, as **node kind** does. A slot accepts script kinds, not arbitrary code. **Landed in code 2026-09-16:** `defineScriptKind`, `ScriptKindDecl`, `allScriptKinds`, manifest `hookKinds`; a receipt's script record says `scriptKind`. ⏳ `pipeline_scripts.type_id` and the `Scripts.*.typeId` wire fields keep the old word — the ruling named the declaration, not the column. Open by the same logic: _entry type_, _attribute type_. |
| **plugin**      | **Packaged** code, installed with a manifest. May contribute hooks, node definitions and scripts. Uninstallable as a unit.                                                                                                    |
| **sandbox**     | The isolated execution environment both scripts and plugin code run in. _(was: plugin "runtime")_                                                                                                                       |
| **permission**  | What sandboxed code may do. _(never "capability")_                                                                                                                                                                      |
| **manifest**    | A plugin's declaration, stored verbatim; declared limits are clamped at runtime, since author-side validation is advisory.                                                                                              |
| **dispatch**    | The single seam through which scripts and plugin code are invoked. One interface, deliberately.                                                                                                                         |

**The distinction that matters:** a **script** is one unit of code at a hook, edited in-app; a
**plugin** is a package with an install lifecycle. Both run in the **sandbox** and reach the
engine through the same **dispatch**. _Script_ versus _plugin_ is about delivery and
editability — **not** about who authored it.

---

## 13. Measurement

### Permanent

| Term                       | Means                                                                                       |
| -------------------------- | ------------------------------------------------------------------------------------------- |
| **corpus**                 | A named fixture set with one purpose.                                                       |
| **golden**                 | A recorded expected output. Derived by hand — there is no capture path.                     |
| **gate**                   | Fixtures that must hold; a break stops the work.                                            |
| **discriminating fixture** | One **proven** to move when its control moves. Anything else manufactures false confidence. |

**The rule:** a green suite is evidence only if the thing under test can move it. Perturb and
confirm before banking a pass. This outlives every particular corpus.

### Transitional — expires when 0.6 ships ⏳

These describe the 0.5 → 0.6 comparison and **should be deleted, not maintained,** once the
legacy path is gone. They are recorded here so they are read correctly _now_, not canonized.

| Term         | Means                                                                                                   |
| ------------ | ------------------------------------------------------------------------------------------------------- |
| **parity**   | Comparison against legacy 0.5 output. A **regression alarm for the legacy path**, never a quality gate. |
| **open**     | A known divergence expected to self-promote once fixed.                                                 |
| **departed** | A _deliberate_ divergence from 0.5, bounded to exactly what changed.                                    |

⚠ **Parity cannot validate anything new.** By construction it only says when we have stopped
matching the thing we are trying to beat. It is also blind to lore ranking entirely —
verified: zeroing every lore signal weight leaves all gate fixtures byte-identical. The
**measure** corpora exist because of that, and they are the ones that survive 0.6.

---

## 14. Knowledge _(designed, not built)_

| Term                 | Means                                                                                                           |
| -------------------- | --------------------------------------------------------------------------------------------------------------- |
| **clairvoyance**     | 0–100%: how much an entity's own knowledge constrains retrieval. 0 = fully constrained, 100 = presence ignored. |
| **presence**         | Where an entity is, or has been — an interval, not a point.                                                     |
| **visibility grade** | How widely known a fact is, independent of who witnessed it.                                                    |
| **firsthand**        | Was there.                                                                                                      |
| **known**            | Aware of it, not present for it.                                                                                |
| **unfamiliar**       | Present, without the knowledge that usually accompanies being there.                                            |
| **universal**        | True regardless of perspective; a law of the world.                                                             |
| **timeline spine**   | The indexed table linking facts and associations to points in time.                                             |

⚠ **Two clocks, never conflated:** when a fact _became true_ and when someone _learned it_.

---

## 15. Templates and assembly

### Generic — any service

A context template is **not** LLM-specific. It is the root input of a service call, and a
service may be anything the app can talk to. A ComfyUI workflow saved as a context template,
rendered and shipped to a ComfyUI API, is the same shape of thing as a prompt document shipped
to a chat model. **Do not define these terms in terms of prompts.**

| Term                    | Means                                                                                                                                                                                                                                                                                                                                                                                                             |
| ----------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **context template**    | **The root document for a service call.** Service-agnostic and engine-agnostic: a prompt document for a chat model, a workflow for an image API. It is the thing rendered, not the syntax it happens to be written in.                                                                                                                                                                                            |
| **template engine**     | What renders a context template into a service payload, named by a versioned id the template row carries as data. Core ships **Handlebars** (`core:template/handlebars@1`, the column default and what every seeded row is written in) and **Liquid** (`core:template/liquid@1`); an extension may register more. Neither core engine is _the_ definition, and neither may be taken over or released by a plugin. |
| **assembly**            | Turning selected content into a rendered payload.                                                                                                                                                                                                                                                                                                                                                                 |
| **template variable**   | A named slot a template renders: `worldLore`, `characters`, `history`.                                                                                                                                                                                                                                                                                                                                            |
| **variable template**   | A declared _renderer_ for one variable (`core:var/world-lore@1`). ⚠ Not the same thing as a context template.                                                                                                                                                                                                                                                                                                    |
| **allocation**          | What selection hands to rendering: a **decision** plus its rendered text and reason, ready to be placed. _(was: "context block" — it is not a block)_                                                                                                                                                                                                                                                             |
| **artifact (of a run)** | A row a pipeline run produced — a message, file, variant or lore entry — recorded in `pipeline_run_artifacts`. Evidence of the run; it carries no FK to the thing itself.                                                                                                                                                                                                                                         |
| **compiled payload**    | The finished request handed to an adapter.                                                                                                                                                                                                                                                                                                                                                                        |

### Chat-shaped services only

These describe the LLM path specifically. They do **not** generalise — an image workflow has no
blocks and no seed line.

| Term                | Means                                                                                                                                                                                                                                                                                                                                                     |
| ------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **block**           | **One message**: `system`, `user`, or `assistant`. This is what a block _is_.                                                                                                                                                                                                                                                                             |
| **prompt format**   | How blocks become wire text: Vicuna, ChatML, split-chat.                                                                                                                                                                                                                                                                                                  |
| **macro**           | An author-facing substitution: `{{char}}`, `{{user}}`, `{{char:2}}`.                                                                                                                                                                                                                                                                                      |
| **decorator**       | SillyTavern in-text markup, stripped on the way in.                                                                                                                                                                                                                                                                                                       |
| **seed line**       | The trailing empty assistant block that invites continuation. Must be last.                                                                                                                                                                                                                                                                               |
| **post-history**    | Instructions rendered _after_ the transcript, near the generation point.                                                                                                                                                                                                                                                                                  |
| **prompt block**    | One **section** of the prompt, named by the template variable that renders it — `characters`, `worldLore`, `history`. Always qualified: the bare word is a message.                                                                                                                                                                                       |
| **`blocks` param**  | The ordered pack of prompt blocks — which sections are in the prompt and in what order — declared on `core:task/assemble`. SillyTavern calls this a preset's _prompt list_; it is a **param inside the preset's pipeline configuration** (ruled 2026-09-10), never a session setting and never a table. _(say: `blocks` param, not "prompt-module pack")_ |
| **compiled prompt** | The chat-shaped compiled payload: one flat string, or a role-tagged message array.                                                                                                                                                                                                                                                                        |

**The chain, in order.** A **context template** is the root document. A **template engine**
renders it, placing **allocations** and producing a **compiled payload** — for a chat service,
a sequence of **blocks**, which the **prompt format** turns into wire text. An **adapter**
ships it to the **service**. Each step names a different thing, and none of them is "the
template".

**Resolved collisions**

- ⚠ **`block`** → **a message**, in the chat sense. The codebase used the word for two
  things at **different granularities**, which is why it read as confused:
    - `ContextBlock` (`assemble.ts`) — **one retrieved item** with its verdict: source, id,
      content, tokens, `included`, `why`. → **`Allocation`**, landed. Assemble's out-port
      `blocks` landed with it, as **`allocations`**.
    - `systemBlock` / `userBlock` / `assistantBlock` — **one message**, formatted by
      `PromptBlockFormatter`. → keeps **block**.

    **A dozen allocations are rendered into the variables inside one block.** One is an item,
    the other is a container; they are not two kinds of the same thing. The old "context block"
    name also asserted a message shape that only chat-shaped services have.

    ⏳ **Two spellings of the old word survive the type rename**, both because they are
    seam vocabulary rather than ours: `AllocatedContext.blocks` and the compiled prompt's
    `meta.retrieval.blocks`. §25 carries them and says what holds them.

- ⚠ **A fourth sense: the `blocks` param.** One **section within** a prompt, named
  by the template variable that renders it. Recorded rather than renamed, because
  the word is the ruling's (2026-09-10) and the ledger below already carries
  `pipeline_blocks` as the third. In prose say **prompt block**; the bare word
  still means a message. What keeps the two apart in code is that they never meet:
  a prompt block is a **template variable name** in a config value, and a block is
  a **role** on a compiled message.
- · **`allocation`** → the **item**, as above. The ranker's token arithmetic
  (`allocateBudgets`, `scoreLedAllocation`, `groups[].allocated`) is **budget allocation**
  and deliberately keeps the word: it is a verb and an adjective over a divided resource,
  never a countable noun, so _an allocation_ has one referent. Checked before the rename
  rather than after (§24.2) — and in prose, say _budget allocation_ when the resource is
  meant, because that sense **is** countable in English even though the code never spells
  it as a noun.
- ⚠ **`seed`** → **three** meanings, all live: the **seed line** (chat), **seeding** (boot
  insertion of shipped rows), and the run's random **seed**. Never bare — say _seed line_,
  _seed rows_, _run seed_.
- ⚠ **`template`** → **context template** (the root document) vs **variable template** (one
  renderer) vs a prompt format's own template. Always qualified.
- · **`context`** → the assembled content. The token allowance is the **context window**; the
  node computing it is `contextBudget`.

---

## 16. Import and export

| Term               | Means                                                                                                                                 |
| ------------------ | ------------------------------------------------------------------------------------------------------------------------------------- |
| **card**           | A character file: PNG/APNG with embedded JSON, bare JSON, or CHARX. **Never WebP as a container** — WebP is an asset _inside_ a card. |
| **book**           | A lorebook file.                                                                                                                      |
| **wire name**      | The name a format uses on disk: `world`, `character`, `history`. ⚠ **Never write an internal type id into a file.**                  |
| **extensions bag** | A foreign format's `extensions` object, stored verbatim as provenance.                                                                |
| **clamp**          | Coercing a foreign value into our range rather than rejecting it — a foreign `priority: 7` must still import.                         |
| **repair**         | A one-off correction of already-imported rows, distinct from fixing the importer.                                                     |

**The standing rule:** _import carries intent; the pipeline decides semantics._ Compatibility
lives at the boundary; the engine is free to rank differently.

⚠ **Anything SillyTavern writes unconditionally is meaningless until proven otherwise** —
`use_regex: true`, `order: 100`, `selectiveLogic: 0` are all stamped on every entry.

---

## 17. Graph

| Term             | Means                                                                                                            |
| ---------------- | ---------------------------------------------------------------------------------------------------------------- |
| **graph node**   | A narrative entity in the relationship graph. ⚠ Always qualified — a **node** unqualified is a _pipeline_ node. |
| **relationship** | A directed edge between graph nodes.                                                                             |
| **perspective**  | One participant's view of a relationship.                                                                        |
| **proposal**     | A suggested graph change, awaiting review.                                                                       |
| **review gate**  | The surface where a proposal is accepted or rejected. Nothing is auto-applied.                                   |
| **temp id**      | A placeholder for an entity a run invented (`new_3`), resolved only on apply.                                    |

**Resolved collisions**

- ⚠ **`node`** → a **pipeline** node. The graph's are **graph nodes**, always qualified. These
  appear in the same retrieval paths, since graph content is a retrieval source.

---

## 18. Media

| Term           | Means                                                                                                                       |
| -------------- | --------------------------------------------------------------------------------------------------------------------------- |
| **media**      | Any stored binary: image, audio, document.                                                                                  |
| **asset**      | A media item referenced by something else.                                                                                  |
| **thumbnail**  | A derived, smaller rendition.                                                                                               |
| **provenance** | Where a media item came from — generated, uploaded, imported. ⚠ Same word as entry provenance, same meaning, deliberately. |

---

## 19. Schema and migrations

| Term                      | Means                                                                                                                          |
| ------------------------- | ------------------------------------------------------------------------------------------------------------------------------ |
| **baseline**              | The single generated migration that replaced the squashed chain.                                                               |
| **journal**               | `drizzle/meta/_journal.json` — the ordered list of applied migrations.                                                         |
| **snapshot**              | `drizzle/meta/*_snapshot.json` — what generation diffs against. **The source of truth for generation.**                        |
| **defaults sync**         | The idempotent boot step that seeds and reconciles shipped rows. **Anything that must persist goes here, not in a migration.** |
| **data upgrade**          | A content transformation keyed to a migration. Currently a shell, to be populated before release.                              |
| **constraint projection** | Boot-time creation of CHECK constraints and indexes from declared entry types.                                                 |

⚠ A migration numbered at or below the highest already applied is **silently skipped** — and
**tests cannot catch this**, because a fresh test database short-circuits the ordering check.

---

## 20. Verbs

Verbs collide as readily as nouns.

| Verb          | Means                                                                                                   |
| ------------- | ------------------------------------------------------------------------------------------------------- |
| **retrieve**  | Find candidates. Never "search" — that means the semantic mechanism specifically.                       |
| **admit**     | Let a candidate be _considered_.                                                                        |
| **score**     | Assign a number.                                                                                        |
| **rank**      | Order by score.                                                                                         |
| **select**    | Choose within a budget, producing decisions.                                                            |
| **assemble**  | Turn decisions into a prompt.                                                                           |
| **render**    | Turn one thing into its display or wire form.                                                           |
| **declare**   | Author a type's shape in the SDK.                                                                       |
| **project**   | Turn declarations into database objects. ⚠ **Not** row→candidate mapping — that is **toCandidate**.    |
| **reconcile** | Align stored values with current declarations.                                                          |
| **cull**      | Remove a declared address and its stored values.                                                        |
| **promote**   | Move queued work to the front because a query needs it. Also: move a fixture from `open` into the gate. |
| **sweep**     | A lane's periodic scan for work.                                                                        |
| **seed**      | Insert shipped rows at boot.                                                                            |
| **degrade**   | Contribute zero with a receipt line. **Never** halt, throw, or exclude.                                 |

⚠ **`promote`** carries two senses — queue priority and fixture status. Both are established
and neither is likely to be confused in context, but say which if ambiguous.

---

## 21. Abbreviations

Acceptable unexpanded in code and casual speech: **RAG**, **NER**, **BM25**, **idf**, **TTL**,
**LLM**, **FK**, **PK**, **UI**.

Expand on first use in user-facing documentation. **Never** invent new ones — `SP` for Serene
Pub is acceptable internally and must not appear in the UI.

---

## 22. Icons

An icon is a term's pictogram, and it is vocabulary. A person who meets `BookMarked` in the
nav, on a session's "View lorebook" button and beside a summarization target learns the word
once; a person who meets three different books learns nothing. So icons obey the rules the
words do, and the associations below are canon in the same sense — **where a screen draws a
term with a different icon, the screen is wrong.**

The library is `@lucide/svelte`, imported as `import * as Icons from "@lucide/svelte"` and
drawn as `<Icons.BookMarked />`. An icon is named by its **export name** — `BookMarked`,
`MessageSquareText` — in prose, in code and in declared data alike. The two non-lucide marks
are vendor logos (the Ollama and KoboldCPP managers), and a vendor's own mark is the one
place a logo is the right icon.

**I1 — One icon, one term (R1 for pictograms).** A collision is dangerous exactly when the two
terms can share a screen. `Network` meaning _embeddings_ in the connections list and _graph_
in the lorebook lens row was the collision; `Globe` meaning _world lore_ on a door and
_website_ on an About link is not, and is tolerated.

**I2 — The declared source wins.** Where an icon is declared as data — the navigations, the
connection sections, the lorebook doors and lenses, a widget manifest — that declaration is
the canon, and an inline `<Icons.X>` that disagrees is the one that changes. It is R1's
"load-bearing use stays": a nav entry is seen on every screen, a stray empty-state icon on one.

**I3 — Kind icons are borrowed, never redrawn.** A modality, a sampling shape and a defaults
group each show the icon of the **output kind** they produce; none has an icon of its own.
That is what lets the Embeddings section, the "vectors are current" mark on an entry and the
Embeddings defaults group read as one thing — and it is why _add icons for the modalities_
was a two-line change and not a design exercise.

**I4 — Two spellings on the wire, one in the app.** Declared data names an icon as a string.
App-side tables and widget manifests use the export name verbatim (`'HeartPulse'`); the SDK's
trigger and action declarations use kebab-case (`"book-open-text"`, `"user-round"`) and
`actionIcon()` (`client/components/sessionMessages/actionIcon.ts`, the one resolver since U5c) PascalCases it at the seam, falling back to `Play`. R5 — translate, never
merge — but the kebab spelling is the older of the two and is not to spread: a new
declaration writes the export name.

### Kinds and modalities

The output kinds are the SDK's `IO_KINDS`. Each has one icon; everything below borrows it.

| Output kind | Icon           | Borrowed by                                                                                                                   |
| ----------- | -------------- | ----------------------------------------------------------------------------------------------------------------------------- |
| `text`      | `Type`         | **text-gen** · the `text` sampling shape · the Text defaults group · the static text card in a context template               |
| `image`     | `Image`        | **image-gen** · the `image` sampling shape · the Images defaults group · one image asset (the media _collection_ is `Images`) |
| `audio`     | `AudioLines`   | **tts** 🚧 · the Speech and audio defaults group                                                                              |
| `video`     | `Clapperboard` | the Video defaults group                                                                                                      |
| `document`  | `FileText`     | the Documents defaults group · a document asset · export-as-JSON                                                              |
| `embedding` | `Zap`          | **embeddings** · the "vectors are current" mark on an entry (stale is `RefreshCw`) · the Embeddings defaults group            |
| `entities`  | `ScanText`     | **ner** · the NER lane panel · the Named entities defaults group                                                              |

| Modality       | Icon         |                                                                                                                |
| -------------- | ------------ | -------------------------------------------------------------------------------------------------------------- |
| **text-gen**   | `Type`       |                                                                                                                |
| **image-gen**  | `Image`      |                                                                                                                |
| **embeddings** | `Zap`        | ⚠ Was `Network` — the one modality that had drawn its own, and it drew the graph's. Landed with this section. |
| **ner**        | `ScanText`   |                                                                                                                |
| **tts** 🚧     | `AudioLines` | Named in §10, no section yet. Takes audio's icon when it lands; nothing to decide then.                        |

One exception to I3, stated now so it is not invented twice: when two modalities share an
output kind, the second takes an **input** icon. A transcription modality (`audio->text`)
would be `Mic`, never `Type`, because `Type` already means text generation wherever it
appears. 🚧 — no such modality exists.

⚠ **Three tables agree by discipline, not by construction.** `connectionSections.ts` (per
section), `SamplingSidebar`'s `CATEGORIES` (per shape) and `admin/defaults`' `GROUP_ICONS`
(per kind) each spell the kind icons again, which is how one of them came to say `Network`
and another came to lack `entities`. One `KIND_ICONS` map the three read is the shape I3
wants; until it exists, a change to one is a change to three.

### Nouns

_Declared at_ names where I2 finds the canon. Where it is blank the icon has no declaration
and holds by usage alone.

**Session**

| Term                                                                      | Icon                                             | Declared at                                                                                                                                 |
| ------------------------------------------------------------------------- | ------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------- |
| **session**                                                               | `MessageSquare`                                  | main nav (`Layout.svelte`), list items, tags. ⚠ The admin nav says `MessagesSquare` — §25.                                                 |
| **messages** (the widget, the stream)                                     | `MessagesSquare`                                 | the messages widget in `SessionLayout`; the primary-panel fallback in `Panel.svelte`. One square is a session; several are what is in it.   |
| **persona**                                                               | `UserRound`                                      | the persona badge after a character's name, the **Personas** filter pick, the persona picker; the `Avatar` fallback. ⚠ Not a rail item since 2026-09-15 — the Characters view holds both. |
| **character**                                                             | `UsersRound`                                     | main nav; the `Avatar` fallback.                                                                                                            |
| **narrator**                                                              | `CloudSun`                                       | — . Load-bearing since 0.5: the message avatar, the trigger modal, the prompt card, the session tab. ⚠ See _collisions_.                   |
| **scene**                                                                 | `Film`                                           | the Scenes door (`lorebooks/sections/index.ts`); everywhere else follows.                                                                   |
| **genre**                                                                 | `Shapes`                                         | admin nav.                                                                                                                                  |
| **session preset**                                                        | `Ticket`                                         | admin nav; a pipeline's "Used by" tab is the same concept.                                                                                  |
| **branch** (session, lore, or `route` block)                              | `GitBranch`                                      | — . One word, one fork; all three senses are the same picture on purpose.                                                                   |
| **thinking** (message part)                                               | `BrainCircuit`                                   | `MessagePartsView`.                                                                                                                         |
| **tool** call / result                                                    | `Wrench`                                         | `MessagePartsView`.                                                                                                                         |
| **attachment**                                                            | `Paperclip`                                      | `MessagePartsView`.                                                                                                                         |
| widget: **Stats** · **Inventory** · **World State** · **Scene Portraits** | `HeartPulse` · `Backpack` · `CloudSun` · `Users` | the SDK `core-catalog` widget manifests and `sessions/[id]`. ⚠ The last two borrow the narrator's and the accounts' — see _needs an icon_. |

**Content**

| Term                                                         | Icon                                                               | Declared at                                                                                   |
| ------------------------------------------------------------ | ------------------------------------------------------------------ | --------------------------------------------------------------------------------------------- |
| **lorebook**                                                 | `BookMarked`                                                       | main nav. ⚠ Never `Book` or `BookOpen` — §25.                                                |
| the **doors** — world · character · history · scenes · all   | `Globe` · `User` · `Calendar` · `Film` · `LayoutList`              | `lorebooks/sections/index.ts`.                                                                |
| the **lenses** — list · cards · tree · graph · time · places | `List` · `LayoutGrid` · `ListTree` · `Network` · `History` · `Map` | `LensRow.svelte`.                                                                             |
| **entry marks** — off · archived · pinned · regex            | `Ghost` · `Archive` · `Pin` · `Regex`                              | `EntryMarks.svelte`.                                                                          |
| **graph**                                                    | `Network`                                                          | the graph lens. "See in graph", "Extend graph" follow. ⚠ Not `GitGraph`, not `Share2` — §25. |
| **place**                                                    | `Map`                                                              | the places lens.                                                                              |
| **moment** / the timeline                                    | `History`                                                          | the time lens; `MomentBar`.                                                                   |
| **cast member** link · unlink · **absorb**                   | `Link` · `Unlink` · `GitMerge`                                     | — . `Link2` appears on two linker modals and is the same verb.                                |
| **macro** / **template variable**                            | `Braces`                                                           | admin nav (Variable templates); the variable card; the "Macro" field hint.                    |
| **visible in prompts** (a field marker)                      | `ScanEye`                                                          | — . 23 sites, one meaning.                                                                    |
| **documentation**                                            | `BookOpen`                                                         | — . Docs cards, the About link, the manager help buttons. ⚠ Not a lorebook.                  |

**Pipeline and catalog**

| Term                                                                   | Icon                                          | Declared at                                                                                  |
| ---------------------------------------------------------------------- | --------------------------------------------- | -------------------------------------------------------------------------------------------- |
| **pipeline** / **spec**                                                | `Workflow`                                    | main nav; admin nav; the library.                                                            |
| **run**s                                                               | `History`                                     | the pipeline Runs tab. Borrowed from the timeline; tolerated — the two never share a screen. |
| **receipt**                                                            | `Receipt`                                     | `RunInspectorModal`, `RunProgressCard`, "Inspect run".                                       |
| a model call (**step**)                                                | `Cpu`                                         | `RunInspector`.                                                                              |
| **changes** · **versions**                                             | `Diff` · `GitCommitHorizontal`                | the pipeline detail tabs.                                                                    |
| **clause** rules — loop · each · junction · gather                                                          | `Repeat` · `Layers` · `GitBranch` · `GitFork` | `flow/BlockNode.svelte` (`CLAUSE_LABEL`/`CLAUSE_ACCENT` in `flow/context.ts`). ⚠ `PipelineMapLegacy` draws each as `Repeat` — ⏳ dies with legacy. |
| **review gate**                                                        | `ShieldQuestion`                              | `PipelineReviewModal`.                                                                       |
| structural change                                                      | `Construction`                                | the pipeline detail page.                                                                    |
| immutable / shipped                                                    | `Lock`                                        | — . 16 sites, one meaning.                                                                   |
| a **trigger** with no declared icon                                    | `Play`                                        | the `triggerIcon()` fallback.                                                                |
| **prompt**                                                             | `MessageSquareText`                           | admin nav; the library; the prompt cards.                                                    |
| **context template** · **completion template** · **variable template** | `LayoutTemplate` · `Brackets` · `Braces`      | admin nav; the library.                                                                      |
| **script** · **plugin**                                                | `SquareCode` · `Puzzle`                       | admin nav.                                                                                   |
| **configuration** (a pipeline config)                                  | `SlidersVertical`                             | admin nav. ⚠ Vertical. Horizontal is sampling.                                              |
| context block **roles** — system · user · assistant                    | `ScrollText` · `User` · `Bot`                 | `ContextCardNode`, `ContextSidebar`.                                                         |

**Connections**

| Term                          | Icon                | Declared at                                                                                               |
| ----------------------------- | ------------------- | --------------------------------------------------------------------------------------------------------- |
| **connection** / **endpoint** | `Cable`             | main nav; admin nav; the section-icon fallback.                                                           |
| **connection model**s         | `Boxes`             | `ConnectionModels`; also the defaults-group fallback for a kind nobody named.                             |
| **sampling**                  | `SlidersHorizontal` | main nav; admin nav. ⚠ Also every "settings/tune this" affordance — tolerated, it is the settings glyph. |
| **default**s (capability)     | `Target`            | admin nav.                                                                                                |
| **server**s                   | `Server`            | admin nav.                                                                                                |
| **service** (vendor)          | its own logo        | `OllamaIcon.svelte`; `/koboldcpp/koboldcpp-icon.svg`.                                                     |
| **local model**s (installed)  | `Package`           | the Ollama and KoboldCPP tabs.                                                                            |

**Shell, admin, media**

| Term                       | Icon              | Declared at                                                            |
| -------------------------- | ----------------- | ---------------------------------------------------------------------- |
| **administration**         | `ShieldCheck`     | the admin header; the home card; 2FA and allowed-hosts controls.       |
| **settings**               | `Settings`        | main nav; admin nav.                                                   |
| **tag**s                   | `Tag`             | main nav.                                                              |
| **activity**               | `Bell`            | main nav.                                                              |
| **user**s (accounts)       | `Users`           | main nav; admin nav. One account row is `User`.                        |
| **library**                | `Library`         | the character library (its Characters and Personas catalogs) and the pipeline library.  |
| **folder**                 | `Folder` · `FolderOpen` | a character folder's header, collapsed · expanded (§26); the Move-to-folder menu item. |
| **layout editor**          | `LayoutDashboard` | `SessionLayout`.                                                       |
| **widget style** / themes  | `Palette`         | `SessionLayout`; the Themes settings tab.                              |
| **data** (backups)         | `Database`        | the Data settings tab.                                                 |
| **media** (the collection) | `Images`          | the Media settings tab; gallery tabs. One asset is `Image` (the kind). |
| add an image               | `ImagePlus`       | `BackgroundPicker`; `EntityGalleryTab`.                                |
| **storage**                | `HardDrive`       | `MediaManagerTab`; model sizes.                                        |

### Verbs

As canonical as the nouns, and more often broken.

| Verb                         | Icon              |                                                                                                                                                  |
| ---------------------------- | ----------------- | ------------------------------------------------------------------------------------------------------------------------------------------------ |
| **import**                   | `Upload`          |                                                                                                                                                  |
| **export**                   | `Download`        |                                                                                                                                                  |
| **duplicate** / clone        | `Copy`            |                                                                                                                                                  |
| **preview** / view           | `Eye`             |                                                                                                                                                  |
| **edit**                     | `Pencil`          | ⚠ Not `Edit` (one site) — §25.                                                                                                                  |
| **delete**                   | `Trash2`          |                                                                                                                                                  |
| **close** / dismiss          | `X`               | ⚠ Never for _stop_ — §25.                                                                                                                       |
| **search**                   | `Search`          |                                                                                                                                                  |
| **run** / start              | `Play`            |                                                                                                                                                  |
| **stop** / cancel a run      | `Square`          | The one square, as a media player's.                                                                                                             |
| **regenerate**               | `RefreshCw`       |                                                                                                                                                  |
| **reset** / discard          | `RotateCcw`       | ⚠ Not `RefreshCcw`, which is one arrowhead away from _regenerate_ and was being read as it — §25.                                               |
| **set as default**           | `Star`            | In a text list the same fact is the `★ ` prefix on the default's name. ⚠ Not `Crown` — §25. `Star` is also _favourite_ in a gallery; tolerated. |
| **link** · **unlink**        | `Link` · `Unlink` |                                                                                                                                                  |
| **merge** / absorb           | `GitMerge`        |                                                                                                                                                  |
| **pin**                      | `Pin`             |                                                                                                                                                  |
| **generate** (ask the model) | `Sparkles`        | The "AI does something" verb — Process, Generate, Suggest. ⚠ Not for a noun; the "Personality" field wearing it is a stray.                     |

### Resolved collisions

- ⚠ **`Network`** → the **graph**. It was declared twice — the graph lens and the Embeddings
  section — and I3 settles it: embeddings is a kind and borrows `Zap`. The pipeline detail's
  "Map" step view also draws `Network`, and a spec map is not the narrative graph — see
  _needs an icon_.
- ⚠ **`MessageSquare` vs `MessagesSquare`** → one **session** vs the **message stream**. The
  admin nav's Sessions entry lists sessions and takes `MessageSquare` (§25); the messages
  widget keeps the plural.
- ⚠ **`CloudSun`** → the **narrator**, load-bearing since 0.5 across six sites. The World State
  widget took it second, and it fits that widget uncomfortably well — it is a weather glyph —
  but R1 does not weigh fit: the newcomer moves. Recorded under _needs an icon_, not ruled.
- ⚠ **`BookOpen`** → **documentation**. A lorebook is `BookMarked` by I2; `Book` inside the
  workspace and `BookOpen` on a lorebook menu are the ones that change (§25).
- ⚠ **`Users`** → **accounts**, by both navs. Characters are `UsersRound` (I2); cast and Scene
  Portraits borrow `Users` today and are under _needs an icon_.
- ⚠ **`User`** → **one person where the count is one**: an account row, the `user` chat role,
  the character-lore door. Tolerated, because none of the three shares a screen with another.
  ⚠ Not a persona and not a character — both have their own, and the six persona sites and
  eight character sites drawing `User`, `UserCog`, `UserCircle` are strays (§25).
- ⚠ **`Type`** → **text**, the kind. The KoboldCPP model-kind toggle draws its Text segment as
  `MessageSquareText`, which is a prompt (§25).
- ⚠ **`Drama`** appears twice and neither is canon: the narrator-visibility mark on a
  character-lore row, and the "Scenario" field. Neither term has an icon in this table; the
  first should be the narrator's `CloudSun`, the second is a stray.

### Needs an icon

The pictogram equivalent of the ledger's **needs a word**: a term drawing a borrowed icon it
has no right to, where picking the replacement is a design decision and not bookkeeping.

| Term                                 | Holds                     | Because                                                                                     |
| ------------------------------------ | ------------------------- | ------------------------------------------------------------------------------------------- |
| **World State** widget               | the narrator's `CloudSun` | SDK-declared (`core-catalog/src/ui/sessions/widgets.ts`); changing it is a manifest change. |
| **cast** · **Scene Portraits**       | the accounts' `Users`     | Both mean "the people in this session" and the accounts icon does not.                      |
| pipeline **step map** view           | the graph's `Network`     | A spec's node map is not the narrative graph.                                               |
| **spec** (as distinct from pipeline) | `Settings2` ("Open spec") | A settings gear says _configure_, not _the document_.                                       |
| **hook**                             | nothing                   | No screen draws one.                                                                        |
| **context window** / **budget**      | `ChartPie` on one screen  | Not declared anywhere.                                                                      |

---

## 23. Retired words, and why

Recording _why_ a word died is what stops it being reinvented.

| Retired                            | Why                                                                                                                                                                                                                                                                                                                     |
| ---------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **chat** (the object)              | Became **session**; "Chat" survives only as the standard genre's display name. Chat-completions vocabulary is untouched.                                                                                                                                                                                                |
| **arm**                            | Informal synonym for **mechanism**; never consistently in code. ⚠ The ruling of 2026-09-10 (Q1) says "relationships become a retrieval **arm**" — read it as **mechanism**. The type it produced is `core:query/relationship-search@1`, named for what it retrieves like every sibling, and _arm_ stays out of the id. |
| **retrieval mode**                 | A user choice between keyword/RAG/both. Meaningless once mechanisms contribute additively — `rag` and `both` had become identical.                                                                                                                                                                                      |
| **retrieval strategy** (per entry) | The last exclusive routing. Contradicted the additive rule and had no UI; every row was NULL. Returns, if wanted, as per-entry **weights**.                                                                                                                                                                             |
| **Serenity / Assistant Chat**      | Deprecated feature. Remove on sight; never re-wire.                                                                                                                                                                                                                                                                     |
| **infill engine**                  | The 0.5 keyword/RAG either-or. Replaced by independent mechanisms.                                                                                                                                                                                                                                                      |
| **node type**                      | Collided twice: with **node kind** (people read _type_ as the five classes) and with TypeScript's _type_ (the thing `InputOf<C>` produces). The 94 declarations are **node definitions** (ruled 2026-09-14; code landed 2026-09-16).                                                                                                              |
| **input** · **provider** · **consumer** (kind names) | Ruled 2026-09-14 → **inlet** · **oracle** · **outlet**. _input_ carried four meanings in one file (the kind, the handler argument, the `.input()` lock, user input); _consumer_ said the opposite of what the kind does (it produces effects); _provider_ collided with the vendor sense §4 had only tolerated. _effector_ was considered and declined. Code landed in one change 2026-09-16 (plans/30 §U3, migration 0134). |
| **fan-out** (as a kind)            | Was listed in §4 by mistake; nothing in code. Parallelism is the **gather** clause (01 §4). |
| **query** (a search string)        | The kind owns the word. The strings a semantic mechanism embeds are **probes** (ruled 2026-09-14; ⏳ `semantic.arm.queries`, `query-windows`, `ragQuery.ts`). |
| **block** (the container) · **async** · **map** · **route** | Ruled 2026-09-15 → **clause** · **gather** · **each** · **junction**. _block_ had three live senses; _async_ named the admin `mode`, not the construct (the equivalence law makes it unobservable) and the specs already keyed it `gather`; _map_ collided with location maps and JS `Map`; _route_ collided with SvelteKit routes and contradicted 01 §4 ("no branching"). _frame_ and _turnout_ were considered and declined. Code landed 2026-09-16 (`pipeline_clauses`, `ClauseKind`, the builder verbs). |
| **script type**                    | Ruled 2026-09-15 → **script kind**: it plays the kind-role (a contract scripts are checked against), and _type_ is retired from the pipeline vocabulary wherever it meant a kind. |
| _(none)_                           | **envoy** added 2026-09-15 (§9) — considered and declined: _regular_ (grep-hostile adjective), _fixture_ (test fixtures), _figure_ ("figure out", `<figure>`). |
| **default model** (per endpoint) | Retired 2026-09-15. An endpoint has NO model it "means": the `connections.model` column is dropped, and a **capability default** is a full (endpoint, model) pair. The phrase now only ever means "the model half of a capability default" — say **capability default** or **default pair**; never say an endpoint _has_ a default model. |
| **session connection override** (`sessions.connection_id`) | Retired 2026-09-15 (ruled by Jody: "overrides are always by model, not connection"). An endpoint alone no longer identifies what runs, and the column had no model half to store. Dropped by migration 0130; the resolver walks two tiers, capability default → pipeline configuration pair. A session keeps its sampling / prompt / narrator-prompt picks — those are not connections. |
| **personas** (the table) · `personas:*` | Merged into `characters` 2026-09-15 (migrations 0132–0133): every persona column was already a character column, the two socket families were byte-for-byte mirrors, and two libraries meant two of every form, list, modal and importer. A persona is now a character flagged `is_persona` (§9). `persona_tags` folded into `character_tags`; `lorebook_bindings`/`files`/`*_annotations` `persona_id` folded into `character_id`; `session_personas.persona_id` and `messages.persona_id` keep their names and reference `characters`. |
| **Easy Persona Creation** (`users.enable_easy_persona_creation`) | Dropped with the table; **Easy Character Creation** governs the one creator. |
| **stage** (the reading column) | Declined 2026-09-16 as the name for the session's centred message column (the design canvas called it "the stage"). §9 already uses **stage** for one step of a multi-agent turn (planner · narrator · voice · state-keeper), so the column is the **column** — `.sp-column`, `--sp-measure` — and the default message style is titled **Stage** only as a display name, never as a code identifier. |
| **composer** (the widget) | Merged into **messages** 2026-09-16: the log and the field you write into are one thing to arrange, so the middle zone has ONE required widget and it keeps the id `messages`. The word keeps every other use — the **composer venue** (§9), composer actions, the composer on screen. How the field is drawn is a SETTING on that widget (`composer`: `classic` · `minimal` · `writer`), never a style row: a style is CSS over one widget's markup. `CORE_WIDGETS` drops the decl and `ADVENTURE_LAYOUT` the placement; a saved blob may still name the id and every reader drops it (`RETIRED_WIDGET_IDS`). |

---

## 24. Naming something new

1. Pick a **distinctive** word (R2). If it sounds slightly odd, it is probably right.
2. Grep for it first — across `src`, the SDK, and the schema.
3. If it collides, either pick another or **rename the other use in the same change**. Never
   ship a second meaning.
4. Qualify it if the bare noun could ever stand alone (R3).
5. Say what it is **not**, in the declaration, if a near-neighbour exists.
6. UI labels are prose and need not match internal names — but must not _contradict_ them.

---

## 25. Change ledger

| Was                                                                                                                                            | Is                                                                                                                                                                                                            | Cost                                                                                                                                                                        |
| ---------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `world` (executor)                                                                                                                             | **scope data**                                                                                                                                                                                                | moderate                                                                                                                                                                    |
| `roles` (entry declaration key)                                                                                                                | **`fieldRoles`**                                                                                                                                                                                              | ⏳ needs `core:entry/*@2`                                                                                                                                                   |
| `sourceKind` (entry declaration key)                                                                                                           | **`band`**                                                                                                                                                                                                    | ⏳ needs `core:entry/*@2`                                                                                                                                                   |
| `semantic.arm.*`, `names.arm.*` (node keys)                                                                                                    | **`…mechanism…`**                                                                                                                                                                                             | ⏳ a cull, see below                                                                                                                                                        |
| `Band` (capability grade)                                                                                                                      | **capability band** — frees the bare word for §7                                                                                                                                                              | ⏳ own pass                                                                                                                                                                 |
| `binding` (nodes)                                                                                                                              | **implementation registry**                                                                                                                                                                                   | ⏳ own pass                                                                                                                                                                 |
| `lorebook_bindings` (table), `binding_merge_logs`, `anchorBindingId`, `nextBindingNumber`, `lorebooks:binding*` + `bindingSuggestions:*` verbs | **cast member** — `lorebook_cast` / `cast_merge_logs` / `anchorCastId` / `lorebooks:cast*` / `castSuggestions:*`; the `binding` column (the placeholder) keeps its name; the export JSON key stays `bindings` | ⏳ own pass after the lorebooks workspace rewrite (ruled 2026-09-10)                                                                                                        |
| `AllocatedContext.blocks` (the field)                                                                                                          | **`allocations`**                                                                                                                                                                                             | ⏳ held at the SDK seam, below                                                                                                                                              |
| `meta.retrieval.blocks` (compiled prompt)                                                                                                      | **`allocations`**                                                                                                                                                                                             | ⏳ moves with the field above                                                                                                                                               |
| `pipeline_blocks` (map · async · loop · route frames)                                                                                          | **`pipeline_clauses`** — a **clause** (ruled 2026-09-15, landed 2026-09-16)                                                                                                                                  | migration 0134 renamed the table and rewrote every row's `kind`                                                                                                              |
| `blocks` (the assemble param)                                                                                                                  | **kept — see §15**                                                                                                                                                                                            | 🚧 a fourth live sense of `block`; the ruling named it                                                                                                                      |
| `MessagesSquare` (admin nav Sessions)                                                                                                          | **`MessageSquare`** — one session, §22                                                                                                                                                                        | One string in `admin/+layout.svelte` and the matching header on `admin/sessions`.                                                                                           |
| `generateResponse` / `runReplyToCompletion` (two reply roads), `HostScope.fillMessageId`, the trigger-side `insertLegacy` in `sessions:triggerGenerateMessage` / `triggerNarratorResponse`, the four receipt patches (`recordGenerateStops`, `recordGenerateWire`, `recordGenerateCacheUsage`, `recordReplyOutcome`) | **one road** — `utils/runReply.ts`; the **placeholder** outlet owns the row; **live row** (`RunFacts.liveRow`, `runtime/liveRow.ts`); **dry run** (`RunOptions.dry`); `onRunEnd` on `RunOptions`; `Descriptor.liveRow`; `HostScope.io` + `HostScope.live` (ruled 2026-09-15, 09-B B4, built 2026-09-15) | Built. Republished `create-message@1`, `update-message@1`, `user-message@1`, `generate-text@1`, `context-budget@1` and eight specs under new hashes; `write-result@1` assignable to `row-ids@1`; F7 restated as one primary row. |
| the context window computed four ways (`contextBudgetFrom` in bindings, `tokenLimit: 4096` in dispatch, `dispatchStep`'s own spelling, the panel's `× 0.95`)                                                                                  | **one computation** — `runtime/contextWindow.ts` (`contextWindowFrom`, `replyReserveFrom`, `contextBudgetFrom`), honouring `connection_models.context_window`; dispatch consumes the run's resolved connection/sampling and re-walks no tier (R-8, built 2026-09-15) | Built. `resolveTaskConfig` no longer on the reply road; the legacy prompt-config **sampling** tier is projected into the scope data at `defaults` scope. ⏳ Its **connection** column is NOT projected (U1 review 2026-09-16, C2): it was dead under a capability default and reviving it refused every reply on installs with a stale pick — the picker's fate awaits a ruling (plans/29 R-8). |
| `Book` (lorebook workspace), `BookOpen` (lorebook menus, "Includes a lorebook")                                                                | **`BookMarked`** — §22                                                                                                                                                                                        | Inline icon swaps, ~9 sites; no data.                                                                                                                                       |
| `UserCog` · `UserCircle` · `User` (personas), `Users` · `User` (characters)                                                                    | **`UserRound`** · **`UsersRound`** — §22; `UserCog` stays on the account-settings tab only                                                                                                                    | Inline icon swaps, ~14 sites; no data. ⚠ Leave the character-lore _door_ (`User`) and the `user` chat role alone — those are canon.                                        |
| `GitGraph` (scene "graphed" badge, Build Graph), `Share2` (graph-build prompt card)                                                            | **`Network`** — §22                                                                                                                                                                                           | Inline icon swaps, 6 sites; no data.                                                                                                                                        |
| `generationStage` (`session_messages.generation_stage`, the `queued · loading · generating` enum; `persistGenerationStage`, `LiveRow.stage`) | **status** — `generationStatus` (`generation_status` jsonb, migration 0139, a `StatusText`), `persistGenerationStatus`, `LiveRow.status`; the queue's waits become `QUEUE_STATUS` (ruled 2026-09-15 R-19, built 2026-09-16 U5h) | Built. Nothing writes the enum; the client reads it as a fallback for one release, then the column goes. |
| _(new)_ `ctx.status` · `ctx.iteration` · `RunOptions.onStatus` · `Receipt.lastStatus` · `StatusText` · `LastStatus` · `HOST_FILLED_STATUS_VARS` · `renderStatusText` · `fillStatusVars` · `sameStatus` · `statusVarsMentioned` · `isStatusText` (SDK `status.ts`); `runtime/runStatus.ts` (`createStatusRelay`, `StatusRelay`, `speakerDisplayName`, `QUEUE_STATUS`, `QUEUE_STATUS_DELAY_MS`, `RunStatusFrame`); `runRegistry.setStatus` / `statusesBySession` / `RunHandle.status`; `HostScope.status`; `SpecRunRequest.onStatus`; `sessions:runStatus` (gated, scoped); `Sessions.List.runStatus`; `RunProgress.status`; `Summarize.Progress.status`; client `statusText()`, `lastStatusOf()` | **status** vocabulary (§9), one sense throughout | New names, U5h. `ctx.iteration` is the one addition beyond the ruling: a draft cannot count itself without it. |
| `Crown` (set as default) · `Edit` (edit) · `X` (stop a run) · `RefreshCcw` (reset)                                                             | **`Star`** · **`Pencil`** · **`Square`** · **`RotateCcw`** — §22 verbs                                                                                                                                        | Inline icon swaps: 1 + 1 + 1 + 9 sites; no data.                                                                                                                            |
| `MessageSquareText` (KoboldCPP model-kind toggle, Text segment)                                                                                | **`Type`** — the text kind, §22                                                                                                                                                                               | One line in `KoboldCppModelKindToggle.svelte`.                                                                                                                              |
| `"user-round"` (SDK `narrate-character` "Side character" trigger icon)                                                                         | **`"users-round"`** — a character, not a persona; a `core-catalog` change                                                                                                                                     | A `core-catalog` manifest string in the sibling SDK repo; the trigger is re-projected on next seed, so an already-seeded install needs the catalog re-projection to see it. |
| `"book-open-text"` (SDK `narrate` trigger icon)                                                                                                | **`"cloud-sun"`** — the narrator's; a `core-catalog` change                                                                                                                                                   | Same as the row above.                                                                                                                                                      |
| `contributes.triggers[]` (`{ genre, function, venue: string, i18n, icon }`), `TriggerVenue`, `GenreTrigger` / `listGenreTriggers`, `sessions:triggers`, hand-written verb buttons in `MessageControls` / `SessionMessage` / the composer's extra tab | **`contributes.actions[]`** (`ActionDecl { key, function, genre, venue: Venue \| Venue[], audience, quick, slash, label, icon, description, enabledWhen }`), `Venue` / `VENUE_KINDS`, **`CORE_ACTIONS`** (SDK `actions.ts`); `GenreAction` / `listGenreActions`; **`listSessionActions`** → **`sessions:actions`** (`{ venues: { [kind]: { primary, overflow } } }`) + **`sessions:actionsSeen`**; **`seen_actions`** table (0137); the client renders every venue from the one list (`messageVerbState.ts`, `slashPalette.ts`, `actionIcon.ts`); widget envelope `actions.v1` + `invoke` (ruled 2026-09-15 R-15, built 2026-09-16 U5c) | Built. Seven core spec hashes moved (the contribution's shape, not the run's). `triggers` / `GenreTrigger` / `listGenreTriggers` / `sessions:triggers` stay one release as deprecated aliases. |
| a session binding chosen from every candidate (R-6, U4)                                                                                       | **narrowed** — at session scope, only a spec whose action is **enabled** for the session (`listSessionFunctions`' resolution); the candidate rule still stands underneath; instance scope unchanged (U5c)      | One check in `sessions:bindFunction`; a refusal sentence names the preset and the Actions switch.                                                                          |
| `Drama` (narrator visibility mark)                                                                                                             | **`CloudSun`** — §22                                                                                                                                                                                          | One line in `CharacterLoreRow.svelte`.                                                                                                                                      |
| the documentation's own search box (`DocsSearchBar`, `DocsSearchCtx`, `DocResultsGrid` on `/docs` and in Help) | **`doc`, a client jump kind** — a heading is a **jump hit** that opens Help at that section, or stays on `/docs` when the reader is already there; `doc:` narrows, the chip reads *Documentation* while Help or `/docs` is open (ruled 2026-09-16) | Three components deleted; `digest.help = {slug, anchor}`; `CLIENT_JUMP_KINDS` beside `JUMP_KINDS`; the website keeps its own box because it has no Jump. |
| runtime `marked` over eager-globbed `docs/*.md` in the client entry chunk (`docsIndex.ts`); docs links pointing at GitHub markdown | **docs compiler** → **docs-dist**, consumed lazily per page; `docsHref(slug, anchor)` with a drift test against the manifest; **Help** rail item — §27 (ruled 2026-09-16, phase 1 in flight) | Build-time only: `@serene-pub/docs` in the SDK repo, `scripts/build-docs.js`, a Vite plugin; no runtime dependency added. |
| one docs-dist carrying every source, the API reference included (3.06 MB of pages against a 3 MB budget) | **docs profile** — `app` (guides + catalog, what ships) and `site` (plus the TypeDoc `api`, into `docs-site/`, `npm run docs:site`) — §27 (ruled 2026-09-16) | Built. App profile back to 0.67 MB; serenepub.com's `docs:sync` now reads `docs-site/` and its prerender is fail-loud again, with one allowlist for `/document-view/` and `/recovery`. |
| _(none)_ (socket listeners were per-component `socket.on`)                                                                                    | **interest**, **interest key / registry / set / sync / gate**, **gated event**, **restricted interest** (2026-09-14), **held restricted interest** (2026-09-15)                                                                                           | DONE 2026-09-15 — phase 2 migrated every family (8 slices); phase 4 removed `on`/`off`/`once`/`onAny` from `TypedSocket` (the registry is the one listener path; `Layout.svelte`'s `error`/`success`/`onAny` toasts sit on the raw socket, which is not interest) |
| **node type** (the 94 declarations in `contracts/src/index.ts`)                                                                                  | **node definition** — _kind_ is unchanged (ruled 2026-09-14, plans/29 §1) | prose landed same day (§4, §5, §23, plans/29, 29a); code landed 2026-09-16 (see the U3 rows below) |
| **input** · **provider** · **consumer** (node kinds); **fan-out** (never real); **query** (search string) | **inlet** · **oracle** · **outlet**; struck; **probe** (ruled 2026-09-14, plans/29 R-13) | prose landed same day (§4, §23, plans/29); code + documents landed in ONE change 2026-09-16 (see the U3 rows below) |
| the three **substrate keys** `settings.enabled` · `settings.review` · `settings.mode` (executor-read, declared by nothing; three controls synthesised in `config/panel/declarations.ts`) | the **settings slot** — `'settings'` in `SlotKind`; `settingsSlotFor` / `clauseSettingsSlotFor` / `authoredSlots` / `SETTINGS_SLOT` / `ENABLED_FIELD` / `reviewField` in `sdk/src/settingsSlot.ts`; `FieldDecl.facet` (a field's own lens, so `review` keeps its heading); the `settings` facet declared (R-9, built 2026-09-16, plans/30 U4) | No migration: the addresses are unchanged, so every stored row stays valid and `reconcileConfigs` culls nothing. No pin moved: the projected slot is left out of the content hash. Registry rows refresh their `slots` once at boot (`updated`). The panel's default for `review` is now the definition's `reviewDefault` (was a literal `off` — wrong for `attach-image`). |
| `scriptPoints: [{ key, i18n, description }]` with `accepts` hardcoded to `text/transform` in `executor.ts` and `declarations.ts` | `scriptPoints: [{ key, accepts, label, description? }]` (`ScriptPointDecl`); `scriptPointsOf` the one reader; a bare string ⏳ `ScriptPointShorthand` (R-11, built 2026-09-16, plans/30 U4) | `core:oracle/summarize-batch@1` moved once (`accepts` is hashed; its label is now stripped, as the comment always claimed). The registry column is unchanged (`script_points` JSON). |
| **block** (container) · **async** · **map** · **route** (clause rules); **script type**; tool-loop key `agent` | **clause** · **gather** · **each** · **junction**; **script kind**; `tools` (ruled 2026-09-15, plans/29 R-1, R-14) | prose landed same day (§4, §12, §23); code landed 2026-09-16 in the same change as the kinds (see the U3 rows below) |
| _(none)_ — genre-declared speakers had no word; the deprecated Assistant Chat hard-coded one | **envoy** (ruled 2026-09-15, plans/29 R-18; built 2026-09-16, plans/30 U5g) | Built. SDK `GenreDecl.envoys[]` / `ActionDecl.envoy` / `EnvoyDecl` / `EnvoySpeaks` / `envoyIdentity` / `envoySlugOf` / `slot.prompts({ envoy })` (`SlotRef.ofEnvoy`, `envoyConfigKey`) / `envoyPromptsSlotFor`; `PresetDefaults.envoys`; app `entities/envoys.ts` (`declaredEnvoys` · `seatedEnvoys` · `seatEnvoy` · `unseatEnvoy` · `seatDefaultEnvoys`), `session_characters.envoy_slug` (0138), `sessions:view.envoys`, `sessions:setEnvoySeat`, `nextEnvoyTurn`; `core:genre/guide` + `core:spec/create-guide` + `core:spec/guide-respond` + `core:query/docs-search@1` + preset `guide-default`. |
| `envoyOriginOf(slug)` (origin re-derived from a dot in the slug; declared, never called) | struck — the origin is a fact of the declaration (`DeclaredEnvoy.origin`), never re-derived (U5g review 2026-09-16, S5). Same review: **`ENVOY_IMAGE`** (an envoy's `image` is `http(s)://` or `data:image/…`, refused otherwise, S6); **`noSpeakerRefusal`** (`entities/envoys.ts`: the sentence for a session whose genre admits no characters and has no live in-turn seat, S7); **`invalidateDeclaredEnvoys`** (the per-genre declaration cache's one invalidation, called from `publishVersion`, S4); `assertEnvoysSound` / `assertActionEnvoyKeysFree` (`boot/store.ts`: the host's half of the envoy checks, W4 / S5) | Built. A message verb on an envoy's line is the session owner's; a user line with no persona is its author's (`canActOnMessage`, C1). |
| `metadata.speaker` on a message row (the side-character **fact** `{ name, characterId, known }`) | **`metadata.sideCharacter`** — the fact; **`metadata.speaker`** is the **participant reference** (`character:<id>` \| `envoy:<slug>`), as on the inlet (R1; U5g, 2026-09-16) | Migration 0138 moves the object; `create-message@1` gains a `speaker` in-port and writes the reference; `runReply`'s verb road reads both keys. |
| a `prompts`/`template`/`variables` reference slot recognised by **slot name** in `world.ts` | recognised by **address** (`nodeKey`, `slot`) — U5g | An envoy's `prompts` slot is plain text at `envoy:<key>`; keyed by name it would have been dereferenced as a prompt row. No stored row changes. |
| _(none)_ — `cancelSession(sessionId, by)` stopped every run in a session, whatever it was for | **run kind** (`RunHandle.kind`: **reply** · **action** · **maintenance**) and a **row-scoped Stop** (`cancelSession(sessionId, by, released)`; `setLiveRow`) (U1 review 2026-09-16, W3) | Built. Two registrants (`runReply`, `sessions:triggerFunction`); `kind` is required on `runRegistry.start`. |
| _(none)_ — §9 had no rows for the session-UI vocabulary; trigger `kind`, taxonomy `zone`, `advanced`/`behaviour`, `scopes.ts`, `FieldDecl.scope`, "permission tier", width "tier", genre event "slot", `sideSlot`, "event/trigger/hook surface" | **action** · **venue** · **audience** · **enabled-when** · **form** · **status** · **surface** (one sense) · **widget** · **zone** (layout only) · **trigger** · **session preset**; width tier → **breakpoint**; `sideSlot` → **mount** (ruled 2026-09-15, plans/29 R-15/R-16/R-19) | prose landed (§9); ⏳ code in 30 §U5 (action model) and §U3 (culls) |
| **default model** (per endpoint), `connections.model` (column), `Set Default` (manager buttons) | **capability default** = a required (endpoint, model) pair in `connection_defaults.connection_model_id` (ruled 2026-09-15); managers say **Use for chat** / **Use for image generation** | column already dropped; managers and document-view pages re-read the pair 2026-09-15; §10 + §23 updated same day |
| `ollamaPullProgress` (raw, un-namespaced push)                                                                                                | **`ollama:pullProgress`** — inside its family, so the `ollama:` restricted interest prefix covers it                                                                                                              | one emit site file + two consumers, 2026-09-15 |
| **input** · **provider** · **consumer** (`Kind` values, `pipeline_nodes.kind`, `core:input/…` · `core:provider/…` · `core:consumer/…` ids, `.input()` · `.provider()` · `.consume()`, `ProviderCtx` · `ConsumerCtx`, `describeInput` · `describeProvider` · `describeConsumerTarget`) | **inlet** · **oracle** · **outlet** — `core:inlet/…` · `core:oracle/…` · `core:outlet/…`, `.inlet()` · `.oracle()` · `.outlet()`, `OracleCtx` · `OutletCtx`, `describeInletDefinition` · `describeOracleDefinition` · `describeOutletDefinition` (**U3, 2026-09-16**; plans/30) | one migration (0134) rewrites every node row, registry row and pool key; the registry keeps `renamed_from`/`renamed_at`; 32 definition hashes and all 17 spec hashes moved once; receipts are never rewritten (`renamed_from` resolves their ids, the inspector reads *renamed*, not *changed*) |
| **block** (container) · `pipeline_blocks` · `BuiltBlock` · `blockId` · `blockKind` · `blockChain` · `.async()` · `.map()` · `.route()` · `RoutePredicate` · `routes` · `BLOCK_MODE_DECL` | **clause** · `pipeline_clauses` · `BuiltClause` · `ClauseKind` · `clauseId` · `clauseKind` · `clauseChain` · `.gather()` · `.each()` · `.junction()` · `JunctionPredicate` · `branches` · `CLAUSE_MODE_DECL`; the document says `clauses` (U3) | same migration; a **gather** clause's `settings.mode` is declared by `clauseSettingsSlotFor` since U4 (was synthesised by the panel); `PipelineMap`/`PipelineMapLegacy`/`flow/*` label the four rules |
| **node type** in code: `pipeline_type_registry` · `pipeline_type_registry.type_id` · `pipeline_type_declarations` · `type_id`/`typeId`/`typeVersion` on nodes, receipts, rebinds, the registry snapshot · `node_type_id` (prompt and template pools) · `describeQueryType`/`describeTaskType` · `getType`/`allTypes` · `syncTypeRegistry`/`readTypeRegistry`/`typeContentHash` · manifest `nodeTypes` | **node definition**: `pipeline_definition_registry` · `definition_id` · `pipeline_definition_declarations` · `definitionId`/`definitionVersion` · `node_definition_id` · `describeQueryDefinition`/`describeTaskDefinition` · `getDefinition`/`allDefinitions` · `syncDefinitionRegistry`/`readDefinitionRegistry`/`definitionContentHash` · manifest `nodeDefinitions` (read beside `nodeTypes` for one release) (U3) | `lorebook_entries.type_id`/`type_version` KEEP the word — *entry type* is unruled; so does `pipeline_scripts.type_id` (script kind id, unnamed by the ruling) |
| **script type** in code: `defineScriptType` · `definePluginScriptType` · `ScriptTypeDecl` · `ScriptTypeId` · `isScriptTypeId`/`parseScriptTypeId` · `getScriptType`/`allScriptTypes` · manifest `hookTypes` · `ScriptApplicationRecord.typeId` | **script kind**: `defineScriptKind` · `definePluginScriptKind` · `ScriptKindDecl` · `ScriptKindId` · `isScriptKindId`/`parseScriptKindId` · `getScriptKind`/`allScriptKinds` · manifest `hookKinds` (read beside `hookTypes` for one release) · `scriptKind` on the receipt's script record (U3) | receipts written before 2026-09-16 carry `typeId` on script records and are read as written |
| 01's three hook kinds in code: `PipelineHookDecl`/`pipelineHook()`/`pipelineHooksOf` · `LifecycleHookDecl`/`lifecycleHook()`/`LifecycleHook`/`LifecycleHookSurface` · `EventHookDecl`/`eventHook()`/`EventHook`/`EventHookInput`/`EventHookSurface`; `__decl` values `pipeline-hook` · `lifecycle-hook` · `event-hook` | **handler** (`HandlerDecl`/`handler()`/`handlersOf`) · **lifecycle callback** (`LifecycleCallbackDecl`/`lifecycleCallback()`/`LifecycleCallback`/`LifecycleCallbackSurface`) · **event listener** (`EventListenerDecl`/`eventListener()`/`EventListener`/`EventListenerInput`/`EventListenerSurface`); `__decl` values `handler` · `lifecycle-callback` · `event-listener` (R-1, U3) | plugin surface: the old spellings stay one release as `@deprecated` aliases (`sdk/src/deprecated.ts`) and the CLI packager counts both |
| `SCOPE_ORDER` six: `session · user · instance · preset · defaults · author`; `WRITE_MATRIX` columns `user`/`instance` | **`session · preset · defaults · author`** — `preset` IS the selected config, the one place an admin's edit lands (R-10, ruled 2026-09-15; B8; landed U3) | no rows existed at `user`/`instance` (`pipeline_node_overrides` is CHECKed to `session`; the migration test asserts zero); `scopes.ts`/`read.ts` consult the matrix at `preset` for config writes |
| two event registries — SDK `CORE_EVENTS` (4) + `sessionEvents` bare names (`session-created` …) + the app's `seed.ts` copy; `.on()` / `spec.subscribes` / `pipeline_event_subscriptions` | **one registry** — `CORE_EVENTS` holds the genre's session events and every data event an outlet causes, by id (`core:event/message-respond@1` …); `sessionEvents.*` are those ids; the inlet lock is the only subscription; `pipeline_event_registry` is its projection (R-4, B5, landed U3) | migration 0134 drops `pipeline_event_subscriptions`, rekeys `input_event`, `genre.events` and `session_presets.bindings` by id; `core:input/message-created@1` culled (no spec, no emitter); ⏳ `ui-action` kept beside `session-action` while ruling 49's payload has no other home. **Consequence for plugins** (U3 review W6/W7, 2026-09-16): the CLI emits `event:<inlet lock>` as a permission for every pipeline with an `input.event`, not only for the retired `.on()`; `announce.build()` refuses a preset binding keyed by bare name (`isEventId`); `syncPluginPresets` normalises a bare key from a previous-SDK manifest to `core:event/<name>@1` for ONE release and logs once. Each core event now carries a `name` locale map — the admin's preset page shows it and puts the id in the tooltip |
| trigger `kind: button \| menu \| event \| schedule` · `pick` · taxonomy `zone` | trigger **`venue: composer \| message`** — the action model's minimal shape (R-15, B9); `pick` and `zone` culled (U3) | migration 0134 rewrites `contributes.triggers[]` and `taxonomy` on every version row; the session page splits on `venue` |
| three own-node `params` slots on the lore lanes (21 addresses for 7 knobs); two on the embed nodes | **one owner per setting per spec** (R-7 P2, B7): `gather.worldLore.read` owns the seven, `semantic.arm.embed` owns `enabled`; the others `slot.params({ node })`; `validate()` warns (`12 §2 P2`) when two owners declare a field under one label unless `distinct: true` + `distinctLabel` (U3) | migration 0134 rewrites the loser nodes' config/`resolved_refs` and **folds** their config rows onto the owner (owner wins; a loser at an owned path becomes a `culled` **notice** carrying its value); the panel shows the 7 knobs once |
| tool-loop clause `agent`, query node `tools` | clause **`tools`**, query node **`available`** — nodes and clauses share one address space and the builder now refuses a clash (U3) | migration 0134 rewrites the keys, references and config addresses of `core:spec/tool-loop` |
| `composer` (a second primary widget beside `messages`), `COMPOSER_STYLE_PRESETS`, `COMPOSER_LAYOUTS` / `DEFAULT_COMPOSER_STYLE`, `styles.composer`, `data-composer-layout` | **one `messages` widget** carrying both halves, with `composer` · `composerPosition` · `order` · `showMessages` · `showComposer` and a `behaviour` group of `show*` toggles as its declared **settings**; **retired widget id** (`RETIRED_WIDGET_IDS` in `client/sessionLayout/widgetGrid`, dropped by every reader of a saved blob); `syncWidgetStyles(decls, version, { pruneUndeclared })` takes the orphaned `composer:*` system rows | Built 2026-09-16. A public contract: `CORE_WIDGETS` + `ADVENTURE_LAYOUT` in `@serene-pub/core-catalog`. No data migration — the widget id, the style pins (`layoutSettings.widgetStyles`) and the `widget_settings` rows all keep the `messages` key. ⏳ The session page passes `messagesChildren` + `composerChildren` until the merged component lands. |
| **Clean** (title of the `messages:default` style row) | **Stage** — the default message style is the typeset column: Literata prose in two tones, gold cast names, the persona's turn in the composer's 950 card. Slug `default` and the legacy id `clean` are unchanged; only the display title moved. | done 2026-09-16 |
| `.session-actions` row · `Extra Controls` tab · `Compose`/`Preview`/`Switch Persona`/`Lore`/`Pinned Images`/`Statistics` tabs (composer chrome) | **Actions** disclosure (genre actions as filled chips, the three turn controls as outlined chips) · footer **persona chip** · **Preview** toggle · **More** menu (Lore, Pinned images, Statistics panes) · **Send**. `Trigger Character` → **Pick who speaks**; `Continue Conversation` → **Continue the conversation**; `Regenerate Last Message` → **Regenerate the last reply**. | done 2026-09-16 |
| `Stop Generation` · `Regenerate Response` · `Continue Response` · `Edit Message` · `Branch Session` · `Select for Summarization` · `View Prompt Details` · `Hide/Unhide Message` · `Delete Message` (message menu) | **Stop generating** · **Regenerate** · **Continue** · **Edit** · **Branch from here** · **Select for summary** · **Prompt details** · **Hide** / **Unhide** · **Delete** — sentence case, a verb, no object the row already names. | done 2026-09-16 |
| **session connection override** (`sessions.connection_id`, resolver tier `sessionOverride`, `WHERE_SET` "this session's settings") | _(retired)_ — overrides are always by model: a pipeline configuration's pair, else the capability default (ruled 2026-09-15) | migration 0130 drops the column; resolver, `world.ts` layer, session handlers, form plumbing and docs updated same day |
| _(none)_ (there was no cross-entity search) | **jump** — the shell's one search across everything the requester can already see, with **jump kind** (the singular nouns it can reach — seven on the wire since the persona merge, plus the client-side `doc`) and **jump hit** (one row it can land on), 2026-09-15. ⚠ NOT `search`: every entity already owns `*:searchLibrary`, which browses a REMOTE card catalogue, and a second wire meaning of the word is the R1 collision. A jump never widens visibility — each kind reuses its own list handler's where-clause | `sockets/jump.ts`, `shared/sockets/jump.ts`, `client/shell/openJumpHit.ts`; the overlay follows |
| `hamlindigo` (the default theme key and "Hamlindigo (Default)" label)                                                                                     | **`lamplight`** — the house theme, branched from hamlindigo (2026-09-15); hamlindigo stays as a plain option. Colour roles, not hex: primary = act on it, warning = model working, success = healthy, tertiary = system |
| **New Session** / **Edit Session** (the one form's two headers), **Create** / **Update** (its buttons), **Session Mode** (label), **Mode Settings** (session fields) | **Start a session** / **Start** on the new start screen (`StartSessionForm`, steps **Genre** · **Preset** · **Who is in it** · **Name**); the edit screen wears the session's own name with **Save**; **Genre** and **Genre settings** follow §9 | built 2026-09-15: creation left `EditSessionForm`, which is edit-only; the shared derivations and the one `sessions:create` payload live in `sessionForms/createSession.svelte.ts` (`StartSessionFlow`, `buildCreatePayload`), read by the start screen and by the home wizard; `digest.createSession` is the deep link to the start screen |
| four defaults tiles (Connections index)                                                                                                        | **defaults pill row** + **Defaults mode** — 2026-09-15, the tiles covered 4 of 10 transforms |
| `session-history@1` in-port `budget`; the `text` in-port on `lorebook-triggers@1`, `world-lore@1`, `character-lore@1`, `history-entries@1`; `assemble@2` `params.truncation` (`oldest-first | lowest-weight`); `rank-semantic@1` `params.currentWindow` / `recentWindow`; the `prompts` slot on `generate-text@1`, `generate-with-tools@1`, `generate-json@1` (and every spec's `prompts: slot.prompts({ node })` share on a generating step); `extract-cast@1` in-port `messages`; the sixteen `Unsupplied<…>` fallback reads in `bindings.ts` | _(culled — declared, read by nothing; R-12, 2026-09-16, plans/30 U2)_. Handlers now **declare what they read** (`reads<C>()` in the SDK, typed against the definition) and `boot/declaredReads.ts` fails on a declared name no handler reads; its **allow-list** (3 entries, each with a reason) is the one ledger `paramsSlotWiring.test.ts` derives from. `batch-messages@1` `params.minBatchMessages` is **read** now (a minimum under a cut). `truncation` is not coming back on assemble: what fits is the ranker's `select`, per band. | Registry republishes 11 definitions and 8 spec documents under new hashes (pins recorded with "(was …)"); no migration; stored rows at the culled addresses become cull notices through `reconcileConfigs` (`declaredReadsCull.int.test.ts`). |
| `share` · `maxEntries` · `minEntries` as five-band maps on `core:task/rank-hybrid@1` (and `rank-by-recency@1`'s `rankSlots`); `session-history@1`'s `priority` declared and unread; the `share` control ("Context split") and the "Most entries per source" / "Always keep at least" per-member controls on the ranking step | **weights live on the source** (R-7 P5, ruled 2026-09-15, **built 2026-09-16** — plans/30 U3b): each of the five retrieval definitions declares its own `share` (a plain relative number), `maxEntries` and `priority` — labelled with its band, "Share — world lore" — and `session-history@1` alone `minEntries` (R6); published as a **band intent** (§7) at the head of its candidates, `session-history@1` on a `band` out-port because `main` carries rows; `rank-hybrid@1` keeps `mechanismWeights`, the `signal*` matrix, `scoreLedAllocation` and gains **`shareNormalisation`** (`relative`, the shipped arithmetic, or `fixed`); `rank-by-recency@1` loses its `params` slot; `GroupWeights` gains `priority`, `GroupUsage.cap` is optional (no ceiling is a state), a new selection reason **`reserved_priority`** | migration **0135** splits every stored map by member and moves each deviation to the owning node (by definition, on the spec's active version; config rows and session overrides) with a `backfilled` notice, sweeps a member at the shipped number silently — with no owner in that spec too, and `maxEntries.relationships = 0` behind a share of 0 (the pair every saved map carried) — and culls with a notice a member at a deviated number with no owner, a lore floor, `maxEntries.relationships = 0` behind a RAISED share (the one case the old cap changed an outcome; inert on the ranker, "off" on the query), or a second ranker's claim on an address the first already moved to (**outranked**, U3b review W3); nine definition hashes and five spec hashes moved once ("(was …)" in the pins); `DEFAULT_GROUPS` stays as the ranker's fallback for an undeclared core band, pinned ≡ the declarations by `signalWiring.int.test.ts`. **`lorebook-triggers@1` declares too** (U3b review W1, 2026-09-16): one node producing three bands declares three intents in ONE `params` slot under **band-namespaced fields** — `worldLoreShare` · `worldLoreMaxEntries` · `worldLorePriority`, `characterLore…`, `history…` (`bandIntentFieldsOf`, from the one `LORE_BANDS` table the lanes read) — and publishes three; 0135 maps a lore member on `narrate` / `narrate-character` / `adventure-look`'s ranker to that node under `<band><Field>`. Flat keys rather than a nested `object` per band because a config value is addressed by one `path` and the panel renders one control per field; the label is the band's own, so a person sees "Share — world lore" on the scan node as on the lane |
| _(none)_ | **band-namespaced field** — `<band><Field>` (`worldLoreShare`) on a definition that declares more than one band's intent in one `params` slot (`lorebook-triggers@1` alone today), 2026-09-16 (§7) | R3: the band is the qualifier, so no bare `share` exists on that node to be mistaken for a lane's; the migration's `owner_field` is this spelling |
| `distinct: true` + `distinctLabel` on a node's config (the P2 escape, U3) | **`FieldDecl.shared`** (R-7 P2 refined 2026-09-16, U3b; §4 **slot**): the DEFINITION marks the `params` fields several nodes of one spec hold in common; the executor resolves a marked field at the owner and an unmarked one at the node, through one `slot.params({ node })`; the panel renders shared once and own per node; `validate()`'s `12 §2 P2` warning fires when two own-node owners both declare a `shared` field, and when a reference names an owner whose definition marks nothing shared (the reference resolves nothing) | the lore lanes' seven scan knobs and `embed-text@1`'s `enabled` are marked; `distinct` is culled (nothing shipped used it); zero shipped specs trip the diagnostic (`sdk-tests/rename.test.ts`) |
| `defaults only` / `In use` filter                                                                                                              | **Defaults** (Defaults mode) — 2026-09-15 |
| built-in ONNX catalogue (`embedding/models.ts`, `ner/models.ts`) as the source                                                                | **recommended list** (fetched) with the built-in as fallback — 2026-09-15 |
| `vectorization:modelDownloadProgress` (per-load progress)                                                                                      | **`connections:modelDownloadProgress`** carrying **local model state** — 2026-09-15; the old event still fires for the queue panel |
| `personas` (table), `SelectPersona`, `personas:*` (16 events), `Sockets.Personas`, `PersonasSidebar` + 8 persona components, `document-view/personas/*`, `library/personas` | **`characters` + `is_persona` / `is_default_persona`** — 2026-09-15, §9 · §23. `personas:setDefault` → `characters:setDefaultPersona`; the persona catalog rides `characters:searchLibrary` / `importFromLibrary` as `catalog: "personas"`; the library route gains a Characters · Personas switch. | Migrations 0132 (additive) + 0133 (data move, hand-inserted ahead of the drops as 0109/0128 did); ~40 server files, ~60 client files, the jump `persona` kind, the rail item. Kept on purpose: `session_personas`, `messages.persona_id`, `session_messages.persona_id` (role columns, re-pointed) and `resolvePersonaName` (name-only, prompt parity). |
| _(none)_ | **folder** · `character_folders` · `characters.folder_id` · `characterFolders:list/create/update/delete` · `characters:setFolder` — 2026-09-15, §26 | Grep found one prior use: the message-model comment ("a message is a _folder_"), reworded to _envelope_ in the same change. Flat by ruling; nesting and folders for other libraries are not designed. |
| _(none)_ — audiences were roles, an inlet's speaker was a bare `characterId`, and "who voices X" was re-derived at every venue | **participant reference** (`ParticipantRef`: `owner` · `admin` · `participant` · `user:<id>` · `character:<id>` · `envoy:<slug>` · `item` · `run-owner`; `parseParticipantRef` / `formatParticipantRef` / `isParticipantRef`, `core:shape/participant-ref@1` = `S.participantRef`, `Audience { see, act }`) · the **`speaker` port** on `core:inlet/user-message@1`, `core:inlet/side-character-turn@1` and the four `core:task/turn-*@1` (in and out) carries one · **portrayal** as the resolver's answer (`Portrayal = person \| ai \| none`, `Portrayals`, `resolvePortrayals` + `turnRefs` in `runtime/portrayals.ts`, `receipt.portrayals`, `RunOptions.portrayals`, `HostScope.portrayals`, the inspector's **Portrayed by** line) — U5a, built 2026-09-16 (plans/29 R-15, R-18 (3), R-21 (4)) | The inlets' bare `characterId` is ⏳ `@deprecated` one release. Ids are opaque strings in the SDK (`actorUserId` already is); the app reads integers at its seam. |
| `Voice` / `Voices` / `resolveVoices` / `runtime/voices.ts` / `receipt.voices` / `RunOptions.voices` / `HostScope.voices` / `VoiceLine` / the inspector's **Voices** line (U5a's first spelling of the resolver's answer) | **`Portrayal`** / **`Portrayals`** / **`resolvePortrayals`** / **`runtime/portrayals.ts`** / **`receipt.portrayals`** / **`RunOptions.portrayals`** / **`HostScope.portrayals`** / **`PortrayalLine`** / **Portrayed by** — ruled 2026-09-16, §9 | R1: _voice_ already meant the adventure stage (`.each('voices')`, `voices.item.say`) and TTS (`'connection.voices'`), and the resolver's answer is a third thing. No migration: a `pipeline_runs.receipt` blob stored under `voices` is read as `portrayals ?? voices` (⏳ `portrayalLinesOf`, drop once no stored receipt predates 0.6.0). |
| `speaker` (the JSON fact port `{ name, characterId, known, character }` on `core:inlet/side-character-turn@1`, in on `core:outlet/create-message@1` and `core:task/build-side-character-context@1`; `SpecRunRequest.speaker` / `TurnRequest.speaker`) | **`sideCharacter`** (the same port on all three, the same request field) — 2026-09-16, U5a | Forced by R1: the ruling made `speaker` the participant reference, and one inlet cannot carry two meanings on one key (nor can `runTurn`'s one input object). The stored `metadata.speaker` on message rows, `SideCharacterFact`, `resolveSideCharacter`'s `speaker`, the reply road's `turn.speaker`/`route.speaker` and the scripts extras `speakerName`/`speakerCharacterId`/`speakerIsKnown` are **unchanged** — a wider rename awaits a ruling. Three definitions and three specs moved hash. |
| `SessionShape.messageVerbs { retry, continue, edit, stepBack }` (delete/hide "floors" by omission); the message writes as imperative `updateLegacyWhere` / `deleteLegacy` / a 100-line transaction inside `sockets/sessions.ts`; Stop implicit (a released row with no mark) | **built-in** · **floor** · **opt-in built-in** · **session change** (§9); `messageVerbs { retry, continue, stepBack, delete, hide, swipe }` with `MESSAGE_VERB_FLOORS` refused at registration; `core:inlet/built-in-request@1`, `core:outlet/{delete,hide,edit,swipe}-message@1` + `branch-session@1`, `core:spec/builtin-{delete,hide,edit,swipe,branch}`, `runtime/builtins.ts` (`runBuiltIn`), `sessions/branch.ts`; `CORE_EVENTS` `message-{deleted,hidden,edited,swiped,stopped}@1` + `session-branched@1` with `EventDef.payload`; `message-updated`'s payload **`verb`**; `session_messages.generation_outcome`; the turn inlets' **`changes`** port (R-15, ruled 2026-09-15, built 2026-09-16, plans/30 U5b) | Migration **0136** (`session_changes`, `generation_outcome`); `user-message@1` and `side-character-turn@1` moved (additive port); five new spec pins, six new definition pins; no existing spec moved. ⚠ The brief spelled the `message-updated` field `cause`; `cause` already names the causing NODE on `receipt.emitted[]`, so R1 made it `verb` (the vocabulary `messageVerbs` already owns). |
| the turn inlets' **`changes`** port (`user-message@1`, `side-character-turn@1`) | **`sessionChanges`** — 2026-09-16, U5b review S4, §9 | R1: `changes` is the state ledger's port on `resolve-state-changes@1` / `set-state@1` (a list of value changes). Two definition pins moved ("(was …)" in `registryHashes.test.ts`); no spec wires the port, so no document moved. |
| _(none)_ — a review form was inferred from the whole payload, `target` an editable integer | **`Descriptor.review.fields`** — the reviewable-fields allow-list (R-15, U5b review C1); `reviewSchemaFor` / `undeclaredReviewFields` in the SDK; **`BUILTIN_SPEC_IDS`** / **`BUILTIN_OUTLET_IDS`** in the SDK (was the catalog's alone; W8); `messages/permissions.ts` (`canActOnMessage`, was `checkMessageEditPermission` in `sockets/sessions.ts`); `core:event/session-changes-truncated@1` (S1); `HostScope.previous` / `SpecRunRequest.previous` (W3) | Not hashed: no pin moved for the declaration. `validate()` finding `R-15` refuses a built-in outlet outside `core:spec/builtin-*`. |
| **floor** (retrieval: `minEntries`, "a guaranteed minimum for a band") | **minimum** — ruled 2026-09-16; *floor* is the action model's word alone (§7, §9) | Swept 2026-09-16, complete: prose, labels, docs and test identifiers only — the contracts' descriptions (display text, unhashed), `weights.ts` / `select.ts` / `bindings.ts` comments, `select.test.ts` identifiers (`noFloors` → `noMinimums`, `flooredMessages` → `minimumMessages`, etc.) and the `reserved_minimum` receipt sentence ("kept to meet the minimum of …"), the internal `bandIntentFrom` flag (`{ minimum }`, was `{ floor }`). `minEntries` stays: it already says minimum, and renaming it would move nine definition pins for a word. |
| **floor** (`semantic.ts` `adaptiveThreshold`'s score cutoff, `weights.ts` `thresholdMin`/`relativeThreshold` docblock) | **threshold** — ruled 2026-09-16; a third sense distinct from both the action model's *floor* and the retrieval *minimum* (§7) | Prose only: `semantic.ts:160` and `weights.ts:540` comments. No identifier renamed — `thresholdMin`/`adaptiveThreshold` already said threshold. |
| `pipeline_event_registry.payload_shape` NULL for every row; `RunArtifact.kind` four, `action` three | `EventDef.payload` → `payload_shape: { shape }`; `kind` gains **`session`** (the branch's row), `action` gains **`deleted` · `hidden` · `edited` · `swiped`** — a reader after "the run that WROTE this reply" (`messageExplain`, the ⋮ menu's inspector) filters through `wroteContent` (2026-09-16, U5b) | `pipelines:artifactRuns` rows carry `actions`; additive. |
| the fire keyed on the **function** (`sessions:triggerFunction` unioned every action's audience; `session_functions.function_key` held the bare function; chips keyed `specSlug + function`) | **action identity** `<spec slug>#<key>` — `TriggerFunction.Params.action`, `SetFunction.Params.action`, `session_functions.function_key` (column name kept), `sessions:actionsSeen` keys, `invoke(id)`; `shared/actions/identity.ts` (U5c review W1, ruled+built 2026-09-16) | Built. A fire naming no action is legacy: owner floor + the companion spec. ⏳ One release: a bare-function `session_functions` row still answers until its next write; `WidgetHost` drops the identity on its `onAction` hop (layouts lane). `ActionDecl.genre` is required (W5); core's verbs hold their slash names in every genre (S1). |
| a preset's `included_actions` keyed on the bare **function** (`presetActionsFor` matched `t.function`; `actions.include` in `preset()` took spec ids; block buttons carried only `fn`; a deduped palette row fired the first declaration; `TriggerFunction.Params.channel` accepted and unread) | **identities everywhere the action is chosen** (U5c second pass, ruled+built 2026-09-16): `session_presets.included_actions` / `pipeline_configs.included_actions` hold `<spec slug>#<key>` (`presetIncludes`, `normalizeIncludedActions`, migration 0137's data step); `preset().actions.include` takes identities or a built spec; a block's **`action`** (`BlockActionRef`, `stampBlockActions`) is the writing spec's declaration, carried by the client and held to at the fire; a palette row for a name two declarations share is **`shared`** (`dedupePaletteActions`) and fires legacy so the binding selects; `TriggerFunction.Params.channel` deleted; `AudienceVerdict.canAct` excludes `item` and a mixed audience admits either half; a frame's invoke of a state-changing core verb needs a **recent activation** (`frameActivation.ts`); a grey ⋮ entry carries its reason (`VERB_REASONS`); a spec id is versionless once built (`SpecBuilder` strips `@N`) | Built. ⏳ One release: a bare function key left in a stored included set names the genre's **sole declarer** of that function (any origin; see the third-pass row). No outlet writes a block tree yet — `stampBlockActions` waits for the first one (the app's `HostScope.specId`, `runtime/host.ts`; the SDK declares no such type); a legacy block is the owner floor. `actionsForFunction` deleted (no reader). |
| a bare included key promoted to the **companion** only (0137 `ORDER BY s.id LIMIT 1` inside the genre's namespace; `presetIncludes` and `normalizeIncludedActions` narrowed by `origin`); a frame's activation vouched for by the parent's `navigator.userActivation.isActive` | **sole declarer** — `soleDeclarer(offered, fn)`: exactly ONE action of ANY origin declaring the function for the genre (U5c third pass W4+W2, ruled+built 2026-09-16), shared by reader, both writers and 0137 (`HAVING count(*) = 1`; `coalesce(json_agg, '[]')` so a curated empty set stays `[]`, C1); **`promoteIncludedActions`** — the lenient writer for boot (`syncPluginPresets`, reporting **`bareIncludedKeys`**) and a copy (`sessionPresets:create` `fromPresetId`), keeping what it cannot promote bare; **`noticeBareIncludedKeys`** / `BareIncludedNotice` — `seedSessionPresets` logs once per preset the bare keys the ⏳ fallback still serves; a frame's gate is the **frame-focus window** alone (entry within 5 s, reset on leaving; `FrameActivation.userActivationActive` deleted) and **`CONFIRMED_FRAME_VERBS`** / `FRAME_CONFIRM_QUESTIONS` put `retry` to the person first | Built. The gate is a mitigation; `canActOnMessage` is the authority and a frame acts with its viewer's permissions (docs/session-layout.md). |

**Landed:** `Network` (Embeddings section icon) → **`Zap`**, and the defaults groups gained the `entities` kind with **`ScanText`** (§22, 2026-09-14) · `connections.model` (the column) → **legacy mirror of the default
model**, with the model itself moving to `connection_models` and every selection
becoming an **(endpoint, model) pair** (0114) · `SourceKind` → **band** · `project()` → **toCandidate** · _arm_ →
**mechanism** · `role` (entries) → **field role**, in prose · `grant` (models) →
**lease** · `lane` (specs, retrieval) → **gather branch** / **mechanism** ·
`runtime` (plugins) → **sandbox** · `capability` (plugins) → **permission** ·
`ContextBlock` → **`Allocation`**, with assemble's `blocks` out-port → **`allocations`** ·
`koboldcpp_models` (table) → **`local_models`**, with `koboldCppModels` →
**`localModels`** and `Select`/`InsertKoboldCppModel` → **`…LocalModel`**.

⚠ **The vendor name was the only vendor-specific thing about that table.** It
already had what a registry needs — `filename` unique, provenance, a download
`status`, and a trust ordering on what it claims — and embedding and NER models
need exactly that. One concept, one table, one scan protocol. It gained `format`
and `modality`; it deliberately did **not** gain an `engine`, because a `.gguf`
is not KoboldCPP's and a stored engine would go stale the day a backend is added
(`enginesFor` derives it instead).

⚠ **`kind` was kept, not collapsed into `modality`**, and the two are not
synonyms. **`kind`** (`text` · `image` · `unknown`) is a _loader lane_ — which of
koboldcpp's two directories opens the file, which is what a GGUF header read can
actually answer. **`modality`** is the _role_, in the vocabulary above.
Collapsing them would make that header read record `text-gen` at `detected` —
the top of the automatic trust order — for a BERT `.gguf`, whose architecture is
a language model and whose modality is `embeddings`. That is manufacturing a
measurement, so instead **one function projects one onto the other**
(`modalityForKind`) and every write site goes through it, which is what stops
two columns that mean different things from coming to disagree.

⚠ **What the _allocation_ pass could not reach, and why.** The type renamed; two
fields did not, and neither is a rename this pass was free to make:

- **`AllocatedContext.blocks` is the SDK's word at a seam, not ours.** The object
  rides the `context` port into the SDK executor, and `isAllocatedContext` — an
  **exported** predicate, so a third-party node may call it — recognises an
  allocated context by `Array.isArray(v.blocks)` and nothing else. Renaming the
  field leaves `receipt.preview.blocks` and `preview.totals` silently empty on
  every run (verified against a real preview turn: populated before, `[]` after)
  and breaks the predicate for every plugin. R5 applies — translate at the seam,
  never merge — and the seam's word is the SDK's. ⚠ The deeper problem underneath
  it is not a rename either: `sdk/src/wire.ts` exports **its own** `ContextBlock`
  and `AllocatedContext`, a _different shape_ under the same names, which the
  app's object satisfies only by accident. That wants its own pass.
- **`meta.retrieval.blocks`** is derived from the field above and typed in the
  socket contract. Moving it alone would give one array two names on one path, so
  it moves when the field does.
- **`pipeline_blocks` was a third live sense**, and the only one with a table: a
  spec's `each` / `gather` / `loop` / `junction` containers. **Ruled 2026-09-15: it is a
  _clause_** (§4). The table, `BuiltClause.kind` and the builder verbs say `clause` /
  `gather` / `each` / `junction` since 2026-09-16 (plans/29 R-14, 30 §U3).

⚠ **What the _arm_ pass could not reach, and why.** Three things still spell it,
and none of the three is a rename:

- **`semantic.arm.*` and `names.arm.*`** are node keys, so they are _declared
  config addresses_. Moving one is a **cull** (§6): `reconcileConfigs`
  hard-deletes the value with a notice, and stale `pipeline_node_overrides` rows
  survive it and need a hand-written `DELETE`. Worth doing — as a migration.
- **`foundBy: "arm0#3"`** is a value written into receipts. Changing it changes
  what already-stored receipts say.
- **The retrieval-explain labels** — "Both arms", "One retrieval arm found it" —
  are prose a user reads, so they are free to change but are a copy change and
  not a rename (§24.6).

⚠ **`arm64` is not an instance of _arm_.** A whole-word search for `arm` returns
CPU-architecture strings in the tunnel binary manager, where `"arm64"` and
`"arm"` are values matched against `process.arch`. Renaming them breaks platform
detection on ARM machines, and it breaks it at _download_ time — the failure is a
wrong binary, not a type error. **Any mechanical `arm` pass must exclude
`tunnels/`.** Recorded because the residual count looks larger than it is: of the
hits outside tests, the architecture strings are a meaningful share and none of
them are this word.

⚠ **What the _runtime_ pass could not reach.** Two things, and neither is a
rename this pass was free to make:

- **`plugins/RuntimeManager.ts` still exists**, as a re-export of
  `SandboxManager` carrying a tombstone. Two files under
  `pipelines/runtime/` — `pluginBindings.ts` and `pluginBindings.int.test.ts` —
  still import the old name from the old path and belong to another lane's tree.
  The shim is one line and its removal is one line on each side of that seam.
- **QuickJS's own `runtime` is not ours.** `qjs.newRuntime()`, `JS_FreeRuntime`
  and the per-call VM object keep the library's word. R5: translate at the seam,
  never merge — a `sandbox.dispose()` that is really a WASM VM teardown would be
  the merge this rule exists to stop.

⚠ **The one _capability_ sense the permission pass left alone.** Where the word
names the **object-capability machinery** rather than a thing an admin may deny
— the _capability bridge_ (QuickJS's async host-function transport), the _abort
capability_, the SDK's `sp-capability-guard` — it stays. Those are not "what
sandboxed code may do"; they are how anything reaches it at all, and a
"permission bridge" that also carries ambient host functions would be a worse
name, not a better one. Everything permission-gated — network, storage,
resources, events, and every grant derived from them — now reads _permission_.

---

## 26. Shell

The app-wide frame around every page (ruled 2026-09-15, built the same day). Vocabulary is
user-facing: these words appear in labels, docs and code alike.

| Term             | Means                                                                                                                                                        |
| ---------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| **rail**         | The one navigation strip on the left edge. Its entries are **rail items**. ⚠ Not a _nav bar_, not a _sidebar_.                                              |
| **sidebar**      | The single 400px column beside the rail that shows one **sidebar view** at a time. There is one; "left/right sidebar" is retired.                          |
| **sidebar view** | What a rail item opens: Characters, Sampling, Admin… Code: `view`, `activeView`, `openViews`. ⚠ Never _panel_ — a panel is a session widget (§9, docs).     |
| **detail**       | The read-only screen for one item inside a sidebar view, shown beside the list at desk width: "open the character's detail". Code keeps the legacy file names `*ViewPanel.svelte`; prose never says _panel_ here. |
| **tab**          | An opened sidebar view kept mounted while another shows; marked by a dot on its rail item. Not a UI tab strip.                                               |
| **full page**    | A sidebar view grown to fill the main area (`fullPageView`); reached by the expand button or a double-click on the rail item. Replaces _fullscreen panel_.   |
| **Jump**         | The one search: the **Jump pill** (top-right entry point), the **Jump overlay** (input + results), the **scope chip** (what it searches), **jump scope** (`view` / `route` / `manual`), and **jump kind** / **jump hit** (§25 ledger row). A **wire jump kind** is served by `jump:search`; a **client jump kind** (`doc`, ruled 2026-09-16) is produced by the client from data it already holds and never crosses the wire. One vocabulary, two producers. |
| **wide rail**    | The rail with its **navigation titles** shown: 208px, the wordmark, a label per item, group names **Play** and **Tune**. Toggled by the user; `panelsCtx.railWide`, `localStorage serene-pub:railWide`. |
| **bottom bar**   | The rail's form under the `lg` breakpoint: Home, Sessions, Characters, Lorebooks, More.                                                                     |
| **More sheet**   | The sheet the bottom bar's More item opens, listing the remaining rail items.                                                                                |
| **folder**       | A user-made group of characters in the Characters sidebar view (ruled 2026-09-15): flat, no nesting, a character sits in one folder or none, a folder holds only characters. `character_folders` + `characters.folder_id`. ⚠ Not a **tag** (a tag is a many-to-many label); not the message model's container metaphor, whose schema comment now says _envelope_. |


---

## 27. Documentation

The docs suite (ruled 2026-09-16, `~/.claude/plans/DESIGN-docs-suite.md`). One compiler, two
**profiles**, two hosts: pages are **rendered** at build time and both the app and
serenepub.com serve the rendered output. User-facing words appear in labels and the guides;
the rest is code.

| Term                  | Means                                                                                                                                                                                                                                       |
| --------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **docs compiler**     | `@serene-pub/docs`, a workspace in the SDK repo beside `cli`. Markdown in the **docs dialect** in, **docs-dist** out. Content-agnostic; knows nothing about the app. ⚠ Not a generator — a generator *emits* markdown, the compiler *renders* it. |
| **docs dialect**      | Markdown plus the compiler's fences: highlighted code, `playground`, `:::note` / `:::tip` / `:::warning` admonitions, captioned figures with `{w=N}`.                                                                                       |
| **docs-dist**         | The compiler's output: `manifest.json`, `search.json`, `pages/<slug>.html`, converted assets. One per **docs profile**.                                       |
| **docs profile**      | Which sources one compile reads and where it writes them — `scripts/build-docs.js`, `buildDocs({ profile })`. Two: **app** (`app` + `sdk`, into `src/lib/generated/docs` + `static/docs/assets`, held to the page budget, the only one the Vite plugin builds) and **site** (`app` + `sdk` + `api`, into the gitignored `docs-site/`, `npm run docs:site`, copied whole by serenepub.com). ⚠ Not a **source** — a profile *selects* sources. Qualify it: bare `profile` is already an image-generation profile schema and an evidence profile (§13). |
| **guide**             | A hand-written page about the app (`docs/*.md`). The **source** `app`.                                                                                                                                                                      |
| **reference page**    | A page rendered from declarations — never hand-written. Two **sources**: `sdk` (the catalog, from a package's announcement, then the **laws**, from `@serene-pub/conformance`'s requirements) and `api` (the TypeDoc API reference, emitted by the SDK's own build into its gitignored `docs/generated/api`, slugged under `sdk/api`). Both carry the same banner and repo line. `api` is read by the **site** profile only — 2.4 MB of rendered HTML the app will not carry — and an unbuilt SDK checkout drops it with a warning rather than failing the compile. |
| **executed example**  | An SDK example (`sdk-tests/examples/<slug>.example.ts`) whose source is shown verbatim, run at SDK build against the fixture host, and whose output is kept as a **golden** (§13). Built 2026-09-16; the app never runs one, it reads what the SDK build proved. |
| **banner**            | The per-source notice the compiler prepends to every page of a source — today the SDK's "plugin modding is only available in 0.7 previews". Emitted by the build, never written by hand, so no page can forget it.                        |
| **playground**        | The interactive SDK code runner embedded in a page (`@serene-pub/playground`, classic scripts, an opaque-origin `allow-scripts` frame). It *runs in* a **sandbox** (§12); it is not one, and is never called one. Built 2026-09-16.       |
| **Help**              | The rail item (`BookOpen`, §22) that opens the documentation as a sidebar view; `/docs` is its full page and Document View's `/document-view/docs` its mirror. It has no search box of its own: the documentation is searched from **Jump** (§26), where a heading is a `doc` hit. |
