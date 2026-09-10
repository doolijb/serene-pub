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
- New terms follow §23. Grep first; if the word collides, either pick another or rename the
  other use in the same change.
- Mark anything impermanent per **R6** — ⏳ transitional or 🚧 provisional — so it can be
  pruned rather than accumulate.
- The change ledger at the end tracks renames that are agreed but not yet applied. An entry
  leaves the ledger when the rename lands.

---

## 1. Governing rules

**R1 — One word, one meaning.** Where a word is already load-bearing in one place, the *other*
use renames. Not both.

**R2 — Prefer distinctive words for new concepts.** Every dangerous collision in this codebase
is a generic word — *source, role, key, binding, weight, grant, world*. Every safe one is
distinctive — *gazetteer, receipt, candidate, departed*. An odd word can never be confused
with anything else. Choose the odd one.

**R3 — Qualify, never abbreviate to the bare noun.** *Entry type*, *node type* — never `type`.
*Signal weight*, *mechanism weight*, *entry weight* — never `weight`.

**R4 — Casual words must not become type names.** Internal ids stay precise and ugly
(`core:query/world-lore@1`); casual speech says *the world lore query*. `retrievalMode` and
`retrievalStrategy` were two different things one word apart, both since removed — that is the
failure this rule prevents.

**R5 — Reconcile vocabularies at boundaries; never merge them.** Two systems may legitimately
use different words for overlapping sets. Translate at the seam and keep both honest. Merging
them is how six of eight retrieval sources were silently dropped.

**R6 — Mark vocabulary that is not permanent, so the canon can be pruned rather than accrete.**
Two kinds, and they expire differently:

- ⏳ **Transitional** — real today, expires on a known event. *Parity*, *open*, *departed* die
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
- **major** — the pin. Version lives *in the id*, so every call site names it.

**Spec documents** carry a semver (`core:spec/respond` at `1.20.0`) because they are published
documents; **types** carry an integer major because they are pinned contracts.

---

## 3. The groups

| Group | Owns |
|---|---|
| **Pipeline** | spec execution — nodes, ports, the executor, receipts |
| **Catalog** | declared types and published specs |
| **Config** | values, scopes, overrides, notices |
| **Retrieval** | finding and ranking what goes in the prompt |
| **Content** | lorebooks, entries, bindings |
| **Session** | messages, channels, cast, scenes |
| **Connections** | adapters, capabilities, sampling |
| **Indexing** | the embedding and annotation lanes |
| **Extensions** | plugins, hooks, scripts |
| **Measurement** | parity, corpora, the A/B tool |
| **Knowledge** | presence, perspective, temporality *(designed, not built)* |
| **Media** | images, attachments, thumbnails |
| **Graph** | narrative nodes and relationships |

---

## 4. Pipeline

| Term | Means |
|---|---|
| **spec** | A published pipeline document. Versioned by semver. |
| **node** | One step in a spec. |
| **node kind** | `input` · `query` (reads) · `task` (transforms) · `provider` (calls a model) · `consumer` (writes) · `fan-out` (parallel). |
| **port** | A node's declared input or output. |
| **slot** | A declared parameter address a config value can fill. |
| **executor** | Runs a spec against scope data. |
| **run** | **One spec execution.** |
| **turn** | **One exchange with the user.** May contain several runs — respond, narrate, summarize. ⚠ *Not* a synonym for run. |
| **step** | One node's execution within a run. |
| **receipt** | The durable record of a run: nodes, outcomes, decisions, diagnostics. |
| **halt** | A run that stopped deliberately. **Not a failure.** |
| **preview** | A run that stops before generating; nothing is sent, nothing is saved. |
| **gather branch** | One lane of a fan-out (`gather.worldLore.read`). ⚠ Not a "lane". |
| **host service** | Something a node may call out to (a database read, a model call). |
| **scope data** | The data a run reads, derived from a session. *(was: `world`)* |

**Resolved collisions**

- ⚠ **`provider`** → the *node kind*. An AI company is a **service** or **vendor**, matching
  `ConnectionServicePicker`. Never "the provider node calls the provider."
- ⚠ **`runtime`** → the *pipeline* runtime. The plugin execution environment is a **sandbox**.
- ⚠ **`world`** → the *fiction's* world only. The executor's data object is **scope data**.
  There must not be a `buildWorld` in a product about building worlds.

---

## 5. Catalog

| Term | Means |
|---|---|
| **entry type** | A declared shape for a lorebook row. Always qualified. |
| **node type** | A declared shape for a pipeline node. Always qualified. |
| **descriptor** | What `describe*()` returns — the in-process declaration. |
| **declaration** | The authored description of a type: ports, slots, fields, roles. |
| **registry** | The persisted projection of declarations into the database. |
| **content hash** | A type's frozen fingerprint. Changing a declaration moves it. |
| **publish** | Making a spec version available. Matched on `(slug, semver)` — editing in place is a silent no-op. |
| **seed** | Boot-time insertion of shipped rows. |

**Resolved collisions**

- ⚠ **`type`** → always qualified (R3). Never bare.
- ⚠ **`projection`** → the *registry* projection and the *constraint* projection. The
  row→candidate mapper in `host.ts` is **`toCandidate`**, not `project()`.
- · **`version`** → *type version* (integer) · *spec version* (semver) · *app version*.

---

## 6. Config

| Term | Means |
|---|---|
| **config** | A named set of values for one spec. Bare `config` means this and only this. |
| **config value** | One stored value at one address. |
| **address** | A node plus parameter path. |
| **override** | A value at a narrower scope than the config. |
| **scope** | Where a value applies. The chain is **pipeline → config → chat override**, and it is deliberately narrow. |
| **cull** | Removing a declared address, hard-deleting stored values and writing a notice. |
| **reconcile** | Aligning stored values with current declarations. |
| **notice** | A record that a value was culled, carrying what it held. |

**Resolved collisions**

- ⚠ **`config`** → the pipeline one. Others are qualified: **connection settings**, **sampling
  preset**, **context template**.

---

## 7. Retrieval

| Term | Means |
|---|---|
| **mechanism** | *How* something was found: **keyword** · **semantic** · **entity** · **structural**. |
| **band** | *What kind* of content, and its budget share: `worldLore`, `characterLore`, `history`, `messages`, `relationships`. The type is `RetrievalBand` — qualified, because `Band` is taken; see §10. *(was: `SourceKind`)* |
| **source** | The **vector index's** vocabulary: `message`, `worldLore`, `historyEntry`, `narrativeNode`, … Reconciled to bands at the seam, never merged. |
| **signal** | One scored component within a mechanism. |
| **candidate** | Something that might reach the prompt, carrying signals. |
| **decision** | Selection's verdict on a candidate: included or not, with a reason. |
| **block** | **One message** in the assembled prompt — §15. What assembly places *inside* one is an **allocation**, never a block. |
| **admission** | Whether a candidate is *considered at all*. |
| **eligibility** | Whether a candidate *may* be selected — a hard gate, distinct from score. |
| **evidence** | Non-keyword grounds for admission. |
| **share** | A band's slice of the budget. |
| **floor** | A guaranteed minimum for a band. |
| **cap** | A ceiling on a band. |
| **gazetteer** | The known-name vocabulary: titles, aliases, cast names, nicknames. |
| **mention** | A span of conversation text that may name something. |
| **link** | A resolved mention → entry or character. |

**The flow, every noun distinct:** a **mechanism** produces **candidates** carrying
**signals**; ranking **scores** them; selection turns them into **decisions** within a
**band's** budget; assembly turns those into **allocations** and renders them into
**blocks**; the **receipt** records it.

**Resolved collisions**

- ⚠ **`source`** → the *index* vocabulary. The ranker's budget grouping is a **band**. This is
  the collision that silently dropped six of eight sources at ranking.
- ⚠ **`band`** → the *retrieval* concept in prose, but the **type is
  `RetrievalBand`**, because `Band` is already a public SDK export naming a
  *connection capability grade* (§10). Two live meanings of one bare word is the
  failure R1 exists to stop, so the newer use qualifies. The canon's own name for
  the SDK's is **capability grade**, so the qualifier belongs on that side and can
  be dropped here once that pass runs — §24.
- ⚠ **`weight`** → always qualified: **signal weight** · **mechanism weight** · **entry
  weight** (the per-row multiplier). A band's slice is a **share**, never a weight.
- · **`score`** → the number. The function is `score()`; there is no other kind of score.
- · **`budget`** → the token budget. A band gets a **share** of it.

**Retired:** *arm* (→ **mechanism**) · *retrieval mode* · *retrieval strategy* (both removed —
every mechanism runs and contributes additively).

---

## 8. Content

| Term | Means |
|---|---|
| **lorebook** | A collection of entries. |
| **entry** | One row of authored world content. |
| **field role** | What an entry field *does* for the engine: title, order, priority, anchor, parent, key, embed text. ⏳ The declaration key is still `roles` — it is hashed into `core:entry/*@1`, so it moves with `@2` and not with a rename. *(was: `role`)* |
| **trigger** | An authored term that fires an entry. The column stays `keys`. |
| **secondary key** | A condition key, combined by selective logic. |
| **selective logic** | `AND ANY` · `AND ALL` · `NOT ANY` · `NOT ALL`. |
| **binding** | A character ↔ lorebook association. **Content only.** |
| **alias** | An alternate name for an entity. |
| **anchor** | The reference that governs an entry's visibility. |
| **provenance** | Who wrote a row: human, summarizer, graph builder. |
| **constant** | An entry that bypasses retrieval entirely. Never a scoring boost. |
| **position** | An entry's ordinal within its lorebook and type. |

**Resolved collisions**

- ⚠ **`role`** → **field role** for entries. *Role* alone means **authorization**. Messages
  keep **role** (`system`/`user`/`assistant`) — industry standard and never in the same file.
- ⚠ **`key`** → in prose, an entry's is a **trigger**. Bare *key* means a database key.
- ⚠ **`binding`** → *content* only. The node-type→implementation map is the **implementation
  registry**. ⏳ Expensive: schema, sockets, SDK. Its own pass.
- · **`field`** → an entry's declared field. A form control is a **control**.
- · **`position`** → ours. SillyTavern's *insertion position* is deliberately not adopted.

---

## 9. Session

| Term | Means |
|---|---|
| **session** | One ongoing piece of fiction. *(formerly "chat")* |
| **message** | One authored or generated line. |
| **channel** | A separate conversation within a session — a phone thread beside a scene. Default `main`. ⚠ Never call this a *lane*; that word belongs to indexing (§11). |
| **genre** | What kind of session this is; owns its pipelines. |
| **cast** | The characters present. |
| **speaker** | Whoever is producing the current turn. |
| **persona** | The user's own presence in the fiction. |
| **scene** | A bounded stretch of a session. |
| **branch** | A copied divergence of a session. |

**Resolved collisions**

- ⚠ **`character`** → a cast member. A text position is an **offset** or **column** — never
  "character 494" in a system with a character named Vell.
- · **`message`** → a session message. Socket traffic is an **event**; an error carries
  **text**.
- · **cast**, not *participants*.

---

## 10. Connections

| Term | Means |
|---|---|
| **connection** | A configured way to reach a model. |
| **service** | The vendor: Ollama, OpenAI, KoboldCpp. *(never "provider")* |
| **adapter** | The code that speaks a service's protocol. |
| **local model** | A model **file this install owns**, on disk — one row in `local_models`. Not a connection and not a service: a connection may *point at* one by bare filename. Vendor-neutral by construction, because `.gguf` is not KoboldCPP's — llama.cpp opens the same bytes — so no row names an engine; which engines can load one is **derived** from format and modality. |
| **model format** | The **container**: `gguf` · `onnx` · `safetensors`. A property of the bytes, read off the file, so it carries no provenance. ⚠ Says nothing about what the model is *for* — the curated image models are every one of them `.gguf`. |
| **modality** | What a model is **for**: `text-gen` · `embeddings` · `image-gen` · `ner` · `tts` · … An open vocabulary whose contract is the SDK's connection *shapes*. One word across `connections.modality` and `local_models.modality` — a connection binds a local model of its own modality. ⚠ **Not detectable from a file**, which is the half `kind_source`'s trust ordering grades. |
| **capability** | What a connection can do: `text->text`, tools, streaming. |
| **capability grade** | How well it does it. The grades are `none` · `emulated` · `native`, exported by the SDK as `Band` / `BAND` / `bandOf` / `bandsFor` — ⚠ **nothing to do with a retrieval band** (§7). |
| **sampling preset** | Temperature, penalties, context window. |
| **wire mode** | Which *method* a service is called by for the same capability: **chat** (role-tagged messages) or **completion** (one text prompt). A connection capability like any other, resolved preset → test → hand-set override (ruled 2026-09-07). Never "chat format" — that collides with prompt format below. |
| **prompt format** | How blocks become wire text: Vicuna, ChatML, split-chat. ⚠ Meaningful **only in completion wire mode**; in chat mode the roles carry the structure and this must not be offered. The *value* on a connection; the row it names is a **completion template**. |
| **completion template** | One row in `completion_templates` — per-role prefix/suffix, stop strings, and a render mode. **Data, never code**: a template that can compute is a template that can be made to do something other than format. Built-ins seed immutable; a variant is a **clone**. `connections.prompt_format` is an FK to its `key`. |
| **render mode** | `flat` (one completion string) or `role_array` (role-tagged messages). An **explicit column**, because it used to be decided by `/split/i` against the format *name* — so any admin-authored name containing "split" would have silently rerouted the pipeline. ⚠ `role_array` is `split_session` only and is **not admin-authorable**; admin templates are flat, which is what keeps them outside the injection surface. |

**Resolved collisions**

- ⚠ **`wire mode` vs `prompt format`.** Both answer "what shape goes on the wire", and
  conflating them is what let a live defect hide: adapters derived wire mode from their own
  local flags while the pipeline rendered a prompt format nothing carried. **Wire mode is the
  *method*** (chat or completion, a property of the connection); **prompt format is the
  *delimiters*** inside a completion's single prompt string. Chat mode has no prompt format —
  not a default one, none. Say *wire mode* for the first and never "chat format" for either.
- ⚠ **`capability`** → *connection* capabilities. A plugin's is a **permission**. The
  manifest itself was never the obstacle it was feared to be: it has always spelled the
  field `permissions`, so the rename reached the code without touching the public
  contract. See §24 for the one sense it deliberately left alone.

---

## 11. Indexing

| Term | Means |
|---|---|
| **lane** | An independent background processing queue with its own model, TTL and lifecycle. **Indexing only** — ⚠ and not yet true in the codebase: the word still appears for session channels (§9), `llmQueue`'s own `Lane`, Argon2id's parallelism parameter (OWASP's word, leave it), and loosely for *a workstream* in comments. The first is a real collision; §24 carries it. |
| **broker** | What a lane asks for a model. A lane never loads one itself. |
| **lease** | Permission to use a model, possibly pending. *(was: `grant`)* |
| **residency** | Whether a model is loaded. |
| **promotion** | Moving specific items to the front of a lane's queue because a query needs them now. |
| **sweep** | A lane's periodic scan for new or stale work. |
| **named vector** | One of several independently-queryable vector spaces per row. |
| **freshness triple** | `sourceHash` + `extractorVersion` + `gazetteerHash`. |
| **annotation** | An extracted entity recorded against a row. |

**Resolved collisions**

- ⚠ **`grant`** → **lease** for models. *Grant* means a plugin permission. Fresh collision,
  cheap now.
- ⚠ **`lane`** → indexing only. Spec branches are **gather branches**; retrieval ways are
  **mechanisms**.
- · **`vector`** → the embedding. A **named vector** is the space.

---

## 12. Extensions

| Term | Means |
|---|---|
| **hook** | A declared point where authored code may run. |
| **script** | Authored code at a hook, **written and edited in the app by an admin or a modder**. No packaging, no install step. Core may ship one, but that does not make *script* mean first-party — origin is not the distinction. |
| **script type** | The declared shape a script must satisfy for a given hook (`core:script:candidates/filter@1`, `…/rescore@1`). A slot accepts script types, not arbitrary code. |
| **plugin** | **Packaged** code, installed with a manifest. May contribute hooks, node types and scripts. Uninstallable as a unit. |
| **sandbox** | The isolated execution environment both scripts and plugin code run in. *(was: plugin "runtime")* |
| **permission** | What sandboxed code may do. *(never "capability")* |
| **manifest** | A plugin's declaration, stored verbatim; declared limits are clamped at runtime, since author-side validation is advisory. |
| **dispatch** | The single seam through which scripts and plugin code are invoked. One interface, deliberately. |

**The distinction that matters:** a **script** is one unit of code at a hook, edited in-app; a
**plugin** is a package with an install lifecycle. Both run in the **sandbox** and reach the
engine through the same **dispatch**. *Script* versus *plugin* is about delivery and
editability — **not** about who authored it.

---

## 13. Measurement

### Permanent

| Term | Means |
|---|---|
| **corpus** | A named fixture set with one purpose. |
| **golden** | A recorded expected output. Derived by hand — there is no capture path. |
| **gate** | Fixtures that must hold; a break stops the work. |
| **discriminating fixture** | One **proven** to move when its control moves. Anything else manufactures false confidence. |

**The rule:** a green suite is evidence only if the thing under test can move it. Perturb and
confirm before banking a pass. This outlives every particular corpus.

### Transitional — expires when 0.6 ships ⏳

These describe the 0.5 → 0.6 comparison and **should be deleted, not maintained,** once the
legacy path is gone. They are recorded here so they are read correctly *now*, not canonized.

| Term | Means |
|---|---|
| **parity** | Comparison against legacy 0.5 output. A **regression alarm for the legacy path**, never a quality gate. |
| **open** | A known divergence expected to self-promote once fixed. |
| **departed** | A *deliberate* divergence from 0.5, bounded to exactly what changed. |

⚠ **Parity cannot validate anything new.** By construction it only says when we have stopped
matching the thing we are trying to beat. It is also blind to lore ranking entirely —
verified: zeroing every lore signal weight leaves all gate fixtures byte-identical. The
**measure** corpora exist because of that, and they are the ones that survive 0.6.

---

## 14. Knowledge *(designed, not built)*

| Term | Means |
|---|---|
| **clairvoyance** | 0–100%: how much an entity's own knowledge constrains retrieval. 0 = fully constrained, 100 = presence ignored. |
| **presence** | Where an entity is, or has been — an interval, not a point. |
| **visibility grade** | How widely known a fact is, independent of who witnessed it. |
| **firsthand** | Was there. |
| **known** | Aware of it, not present for it. |
| **unfamiliar** | Present, without the knowledge that usually accompanies being there. |
| **universal** | True regardless of perspective; a law of the world. |
| **timeline spine** | The indexed table linking facts and associations to points in time. |

⚠ **Two clocks, never conflated:** when a fact *became true* and when someone *learned it*.

---

## 15. Templates and assembly

### Generic — any service

A context template is **not** LLM-specific. It is the root input of a service call, and a
service may be anything the app can talk to. A ComfyUI workflow saved as a context template,
rendered and shipped to a ComfyUI API, is the same shape of thing as a prompt document shipped
to a chat model. **Do not define these terms in terms of prompts.**

| Term | Means |
|---|---|
| **context template** | **The root document for a service call.** Service-agnostic and engine-agnostic: a prompt document for a chat model, a workflow for an image API. It is the thing rendered, not the syntax it happens to be written in. |
| **template engine** | What renders a context template into a service payload. Handlebars is *a* current engine, not the definition. Swappable by design. |
| **assembly** | Turning selected content into a rendered payload. |
| **template variable** | A named slot a template renders: `worldLore`, `characters`, `history`. |
| **variable template** | A declared *renderer* for one variable (`core:var/world-lore@1`). ⚠ Not the same thing as a context template. |
| **allocation** | What selection hands to rendering: a **decision** plus its rendered text and reason, ready to be placed. *(was: "context block" — it is not a block)* |
| **artifact (of a run)** | A row a pipeline run produced — a message, file, variant or lore entry — recorded in `pipeline_run_artifacts`. Evidence of the run; it carries no FK to the thing itself. |
| **compiled payload** | The finished request handed to an adapter. |

### Chat-shaped services only

These describe the LLM path specifically. They do **not** generalise — an image workflow has no
blocks and no seed line.

| Term | Means |
|---|---|
| **block** | **One message**: `system`, `user`, or `assistant`. This is what a block *is*. |
| **prompt format** | How blocks become wire text: Vicuna, ChatML, split-chat. |
| **macro** | An author-facing substitution: `{{char}}`, `{{user}}`, `{{char:2}}`. |
| **decorator** | SillyTavern in-text markup, stripped on the way in. |
| **seed line** | The trailing empty assistant block that invites continuation. Must be last. |
| **post-history** | Instructions rendered *after* the transcript, near the generation point. |
| **compiled prompt** | The chat-shaped compiled payload: one flat string, or a role-tagged message array. |

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
  `meta.retrieval.blocks`. §24 carries them and says what holds them.
- · **`allocation`** → the **item**, as above. The ranker's token arithmetic
  (`allocateBudgets`, `scoreLedAllocation`, `groups[].allocated`) is **budget allocation**
  and deliberately keeps the word: it is a verb and an adjective over a divided resource,
  never a countable noun, so *an allocation* has one referent. Checked before the rename
  rather than after (§23.2) — and in prose, say *budget allocation* when the resource is
  meant, because that sense **is** countable in English even though the code never spells
  it as a noun.
- ⚠ **`seed`** → **three** meanings, all live: the **seed line** (chat), **seeding** (boot
  insertion of shipped rows), and the run's random **seed**. Never bare — say *seed line*,
  *seed rows*, *run seed*.
- ⚠ **`template`** → **context template** (the root document) vs **variable template** (one
  renderer) vs a prompt format's own template. Always qualified.
- · **`context`** → the assembled content. The token allowance is the **context window**; the
  node computing it is `contextBudget`.

---

## 16. Import and export

| Term | Means |
|---|---|
| **card** | A character file: PNG/APNG with embedded JSON, bare JSON, or CHARX. **Never WebP as a container** — WebP is an asset *inside* a card. |
| **book** | A lorebook file. |
| **wire name** | The name a format uses on disk: `world`, `character`, `history`. ⚠ **Never write an internal type id into a file.** |
| **extensions bag** | A foreign format's `extensions` object, stored verbatim as provenance. |
| **clamp** | Coercing a foreign value into our range rather than rejecting it — a foreign `priority: 7` must still import. |
| **repair** | A one-off correction of already-imported rows, distinct from fixing the importer. |

**The standing rule:** *import carries intent; the pipeline decides semantics.* Compatibility
lives at the boundary; the engine is free to rank differently.

⚠ **Anything SillyTavern writes unconditionally is meaningless until proven otherwise** —
`use_regex: true`, `order: 100`, `selectiveLogic: 0` are all stamped on every entry.

---

## 17. Graph

| Term | Means |
|---|---|
| **graph node** | A narrative entity in the relationship graph. ⚠ Always qualified — a **node** unqualified is a *pipeline* node. |
| **relationship** | A directed edge between graph nodes. |
| **perspective** | One participant's view of a relationship. |
| **proposal** | A suggested graph change, awaiting review. |
| **review gate** | The surface where a proposal is accepted or rejected. Nothing is auto-applied. |
| **temp id** | A placeholder for an entity a run invented (`new_3`), resolved only on apply. |

**Resolved collisions**

- ⚠ **`node`** → a **pipeline** node. The graph's are **graph nodes**, always qualified. These
  appear in the same retrieval paths, since graph content is a retrieval source.

---

## 18. Media

| Term | Means |
|---|---|
| **media** | Any stored binary: image, audio, document. |
| **asset** | A media item referenced by something else. |
| **thumbnail** | A derived, smaller rendition. |
| **provenance** | Where a media item came from — generated, uploaded, imported. ⚠ Same word as entry provenance, same meaning, deliberately. |

---

## 19. Schema and migrations

| Term | Means |
|---|---|
| **baseline** | The single generated migration that replaced the squashed chain. |
| **journal** | `drizzle/meta/_journal.json` — the ordered list of applied migrations. |
| **snapshot** | `drizzle/meta/*_snapshot.json` — what generation diffs against. **The source of truth for generation.** |
| **defaults sync** | The idempotent boot step that seeds and reconciles shipped rows. **Anything that must persist goes here, not in a migration.** |
| **data upgrade** | A content transformation keyed to a migration. Currently a shell, to be populated before release. |
| **constraint projection** | Boot-time creation of CHECK constraints and indexes from declared entry types. |

⚠ A migration numbered at or below the highest already applied is **silently skipped** — and
**tests cannot catch this**, because a fresh test database short-circuits the ordering check.

---

## 20. Verbs

Verbs collide as readily as nouns.

| Verb | Means |
|---|---|
| **retrieve** | Find candidates. Never "search" — that means the semantic mechanism specifically. |
| **admit** | Let a candidate be *considered*. |
| **score** | Assign a number. |
| **rank** | Order by score. |
| **select** | Choose within a budget, producing decisions. |
| **assemble** | Turn decisions into a prompt. |
| **render** | Turn one thing into its display or wire form. |
| **declare** | Author a type's shape in the SDK. |
| **project** | Turn declarations into database objects. ⚠ **Not** row→candidate mapping — that is **toCandidate**. |
| **reconcile** | Align stored values with current declarations. |
| **cull** | Remove a declared address and its stored values. |
| **promote** | Move queued work to the front because a query needs it. Also: move a fixture from `open` into the gate. |
| **sweep** | A lane's periodic scan for work. |
| **seed** | Insert shipped rows at boot. |
| **degrade** | Contribute zero with a receipt line. **Never** halt, throw, or exclude. |

⚠ **`promote`** carries two senses — queue priority and fixture status. Both are established
and neither is likely to be confused in context, but say which if ambiguous.

---

## 21. Abbreviations

Acceptable unexpanded in code and casual speech: **RAG**, **NER**, **BM25**, **idf**, **TTL**,
**LLM**, **FK**, **PK**, **UI**.

Expand on first use in user-facing documentation. **Never** invent new ones — `SP` for Serene
Pub is acceptable internally and must not appear in the UI.

---

## 22. Retired words, and why

Recording *why* a word died is what stops it being reinvented.

| Retired | Why |
|---|---|
| **chat** (the object) | Became **session**; "Chat" survives only as the standard genre's display name. Chat-completions vocabulary is untouched. |
| **arm** | Informal synonym for **mechanism**; never consistently in code. |
| **retrieval mode** | A user choice between keyword/RAG/both. Meaningless once mechanisms contribute additively — `rag` and `both` had become identical. |
| **retrieval strategy** (per entry) | The last exclusive routing. Contradicted the additive rule and had no UI; every row was NULL. Returns, if wanted, as per-entry **weights**. |
| **Serenity / Assistant Chat** | Deprecated feature. Remove on sight; never re-wire. |
| **infill engine** | The 0.5 keyword/RAG either-or. Replaced by independent mechanisms. |

---

## 23. Naming something new

1. Pick a **distinctive** word (R2). If it sounds slightly odd, it is probably right.
2. Grep for it first — across `src`, the SDK, and the schema.
3. If it collides, either pick another or **rename the other use in the same change**. Never
   ship a second meaning.
4. Qualify it if the bare noun could ever stand alone (R3).
5. Say what it is **not**, in the declaration, if a near-neighbour exists.
6. UI labels are prose and need not match internal names — but must not *contradict* them.

---

## 24. Change ledger

| Was | Is | Cost |
|---|---|---|
| `world` (executor) | **scope data** | moderate |
| `roles` (entry declaration key) | **`fieldRoles`** | ⏳ needs `core:entry/*@2` |
| `sourceKind` (entry declaration key) | **`band`** | ⏳ needs `core:entry/*@2` |
| `semantic.arm.*`, `names.arm.*` (node keys) | **`…mechanism…`** | ⏳ a cull, see below |
| `Band` (capability grade) | **capability band** — frees the bare word for §7 | ⏳ own pass |
| `binding` (nodes) | **implementation registry** | ⏳ own pass |
| `AllocatedContext.blocks` (the field) | **`allocations`** | ⏳ held at the SDK seam, below |
| `meta.retrieval.blocks` (compiled prompt) | **`allocations`** | ⏳ moves with the field above |
| `pipeline_blocks` (map · async · loop · route frames) | **needs a word** | 🚧 a third live sense of `block` |

**Landed:** `SourceKind` → **band** · `project()` → **toCandidate** · *arm* →
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
synonyms. **`kind`** (`text` · `image` · `unknown`) is a *loader lane* — which of
koboldcpp's two directories opens the file, which is what a GGUF header read can
actually answer. **`modality`** is the *role*, in the vocabulary above.
Collapsing them would make that header read record `text-gen` at `detected` —
the top of the automatic trust order — for a BERT `.gguf`, whose architecture is
a language model and whose modality is `embeddings`. That is manufacturing a
measurement, so instead **one function projects one onto the other**
(`modalityForKind`) and every write site goes through it, which is what stops
two columns that mean different things from coming to disagree.

⚠ **What the *allocation* pass could not reach, and why.** The type renamed; two
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
  and `AllocatedContext`, a *different shape* under the same names, which the
  app's object satisfies only by accident. That wants its own pass.
- **`meta.retrieval.blocks`** is derived from the field above and typed in the
  socket contract. Moving it alone would give one array two names on one path, so
  it moves when the field does.
- **`pipeline_blocks` is a third live sense**, and the only one with a table: a
  spec's `map` / `async` / `loop` / `route` frames. It is neither a message nor an
  allocation, it is schema and wire, and §15's ruling does not reach it. Recorded
  rather than renamed — picking its word is a design decision, not bookkeeping.

⚠ **What the *arm* pass could not reach, and why.** Three things still spell it,
and none of the three is a rename:

- **`semantic.arm.*` and `names.arm.*`** are node keys, so they are *declared
  config addresses*. Moving one is a **cull** (§6): `reconcileConfigs`
  hard-deletes the value with a notice, and stale `pipeline_node_overrides` rows
  survive it and need a hand-written `DELETE`. Worth doing — as a migration.
- **`foundBy: "arm0#3"`** is a value written into receipts. Changing it changes
  what already-stored receipts say.
- **The retrieval-explain labels** — "Both arms", "One retrieval arm found it" —
  are prose a user reads, so they are free to change but are a copy change and
  not a rename (§23.6).

⚠ **`arm64` is not an instance of *arm*.** A whole-word search for `arm` returns
CPU-architecture strings in the tunnel binary manager, where `"arm64"` and
`"arm"` are values matched against `process.arch`. Renaming them breaks platform
detection on ARM machines, and it breaks it at *download* time — the failure is a
wrong binary, not a type error. **Any mechanical `arm` pass must exclude
`tunnels/`.** Recorded because the residual count looks larger than it is: of the
hits outside tests, the architecture strings are a meaningful share and none of
them are this word.

⚠ **What the *runtime* pass could not reach.** Two things, and neither is a
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

⚠ **The one *capability* sense the permission pass left alone.** Where the word
names the **object-capability machinery** rather than a thing an admin may deny
— the *capability bridge* (QuickJS's async host-function transport), the *abort
capability*, the SDK's `sp-capability-guard` — it stays. Those are not "what
sandboxed code may do"; they are how anything reaches it at all, and a
"permission bridge" that also carries ambient host functions would be a worse
name, not a better one. Everything permission-gated — network, storage,
resources, events, and every grant derived from them — now reads *permission*.
