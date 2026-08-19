# Decomposing the infill engines

`KeywordInfillEngine` and `RagInfillEngine` are the two hardest pieces of the migration,
and they are hard for a reason worth naming up front: **each one is retrieval, scoring,
selection, budgeting and rendering in a single pass.** The pipeline model puts those in
different node kinds, which is not a stylistic preference — it is what makes the payload
inspectable before it is sent, and what lets a user swap the ranker without swapping the
retrieval.

This document is the map from what exists to what replaces it. It is written against the
behaviour of the code, not against what the code was meant to do; where those differ, the
code wins and the difference is called out.

---

## 1. What is not there — corrected

An earlier draft of this section said scan depth was missing. That was wrong, and the
correction matters more than the original claim.

**The scan window exists and is hardcoded.** `computeKeywordSignal` only ever reads
`guaranteedWindowText`, which is the last **10** messages joined
(`MIN_GUARANTEED_MESSAGES`, `BaseInfillEngine.ts:10`). So every lorebook key in the app is
matched against a fixed ten-message window that nobody chose and nothing exposes.

Worse, **that one constant is doing two unrelated jobs**: it is the scan window _and_ the
count of messages that are never dropped from the prompt. Those are different questions —
"how far back do we look for triggers" and "how much recent conversation is guaranteed to
survive budgeting" — and they have different right answers for the same user. A chat of
400-word posts wants a short guarantee and a deep scan; a terse exchange wants the reverse.
Sharing one number means neither can be tuned without breaking the other.

Splitting them is behaviour-preserving as long as both default to 10, which is why it is
safe to do during the decomposition rather than after.

What is genuinely absent:

- probability rolls
- recursion / cascading activation
- inclusion groups
- whole-word matching — keys are **substring** matches. A key `art` fires on "hearth" and
  "started"; `elf` fires on "self" and "shelf". `useRegex` is the escape hatch, which
  requires a user to know both regex and that they need it.

**None of these are parity.** Shipping any of them as a _default_ would make the new path
produce different output from the old one, which is the one thing the migration cannot do.
Shipping them as opt-ins whose defaults reproduce today's behaviour changes nothing and
gates nothing — see §4b.

## 2. The line: retrieval vs everything else

| stage                                   | today                                 | becomes                          | why                                                      |
| --------------------------------------- | ------------------------------------- | -------------------------------- | -------------------------------------------------------- |
| fetch scenes, bindings, relationships   | inline DB selects inside the engine   | **Query**                        | a Task is handed no services (F11)                       |
| fetch candidate pool, embed             | `fetchScopedCandidates`, `batchEmbed` | **Query**                        | reaches an embedding service                             |
| tokenize, IDF, `lastRefMap`             | pure over `chat.chatMessages`         | **Task**                         | pure computation over fetched data                       |
| scoring and ranking                     | pure                                  | **Task**                         | swappable — this is the whole point of `rank-*` types    |
| RRF merge, MMR rerank                   | pure                                  | **Task**                         | same                                                     |
| per-type caps, token ceilings, trimming | pure, but calls `countTokens`         | **Task**, with counting injected | see §5                                                   |
| render the template                     | pure                                  | **Task** (Assemble)              | allocation and wire formatting are already split (16 §7) |

The pure/impure line is sharp in both engines, which is the good news: the scoring functions
(`KeywordInfillEngine:1437-1680`), the fill and trim loops, `rrfMerge`, `mmrRerank`,
`serializeGraphPairs` and all of `LorebookBindingUtils` are already pure over their
arguments. What they are _not_ is **explicitly parameterised** — they read `this.chat`,
`this.currentCharacterId`, `this.interpolationEngine` and module-level `db`. §6 lists what
has to become an argument.

---

## 3. Node map

### Keyword path

```
query  scenes          core:query/chat-scenes@1        scene membership for affinity
query  history         core:query/chat-history@1       messages, oldest-first
query  lore            core:query/lorebook-triggers@1  entries whose keys match
task   rank            core:task/rank-hybrid@1         the scoring weights, as config
task   assemble        core:task/assemble@2            caps, budget, template
```

The scoring **weights become slot config rather than constants**. Today they are literals at
`:1120`, `:1184`, `:1239`, `:1277`; as `params` on the rank node they are the thing a user
tuning "how much should lore matter" is actually reaching for, and the thing an author preset
sets differently for "Lore-heavy" than for "Fast".

### RAG path

```
query    candidates    core:query/vector-search@1      the candidate pool, embedded
provider embed         core:provider/embed-text@1      the query embeddings
task     merge         core:task/merge-candidates@1    RRF across the two query passes
task     rank          core:task/rank-semantic@1       MMR rerank, per-source caps
task     assemble      core:task/assemble@2            as above
```

Note the embedding call is a **Provider**, not part of the Query. That is F-law rather than
taste: a Query may not reach the network (16 §1), and the two-pass structure — current
messages, then recent messages — is two edges into the same merge, which is exactly what an
`async` block expresses.

---

## 4. Ruling: per-entry retrieval strategy

> _"Items that support keywords, like lore entries, can choose keyword, rag with keyword
> fallback (default strategy) or both, with some type of combined ranker."_

**`retrieval_strategy` becomes a column on the lore entry**, with three values:

| value     | meaning                                                                                            |
| --------- | -------------------------------------------------------------------------------------------------- |
| `keyword` | only the keyword scan may surface it                                                               |
| `rag`     | vector search surfaces it; **falls back to keyword when no embeddings are available**. The default |
| `both`    | both queries may surface it, and the combined ranker decides                                       |

Three consequences, each deliberate:

**The fallback is a property of the entry, not of the instance.** An entry marked `rag` on an
instance with no embedding model is still findable, because the alternative — silently
retrieving nothing — is the failure mode that reads as "the bot forgot my lore" and sends
the user to the wrong screen. The receipt records which arm ran, so the fallback is visible
rather than mysterious (16 §2).

**`both` needs a combined ranker, and combining is not averaging.** The two arms produce
scores on different scales: keyword is a weighted sum in roughly [0, 1.5], RAG is a
normalised RRF score in [0, 1] with a per-run adaptive threshold. Averaging them would let
whichever arm happens to be more generous dominate. The combined ranker is
**reciprocal-rank fusion over the two orderings**, which is scale-free — and is already the
mechanism `RagInfillEngine` uses internally to merge its own two passes (`:132-149`), so
this is one implementation, not a new one.

**Strategy is per entry, so a single query node cannot answer alone.** Both query nodes run;
each returns only the entries eligible for it. An entry set to `keyword` is simply absent
from the vector query's results. That keeps each Query type honest about what it does, and
keeps the strategy readable off the entry rather than off the shape of the spec.

---

## 4a. Ruling: every constant is a parameter, and there are three kinds

> _"In my headspace, I consider them weights. Some can be toggles, others are numeric, others
> could be level of importance — an interface where a slider dictates how to prioritize one
> group over another."_

Nothing in the scoring path stays a literal. But "weight" covers three mechanically different
things, and collapsing them is the mistake that makes a tuning UI feel broken:

### (i) Signal weights — how a score is built, within one source

The literals at `:1120`, `:1184`, `:1239`, `:1277`. Numeric, roughly 0–1, and they sum into a
single score for one candidate of one kind:

| source         | signals                                                                                         |
| -------------- | ----------------------------------------------------------------------------------------------- |
| world lore     | keyword `.35` · nameMatch `.25` · entityCooccurrence `.20` · tfidf `.10` · lastRefRecency `.10` |
| character lore | same                                                                                            |
| history        | keyword `.35` · recency `.20` · tfidf `.10` · sceneAffinity `.10` · lastRefRecency `.10`        |
| messages       | recency `.30` · sceneAffinity `.15` · tfidf `.10` · density `.10`                               |

Plus `priorityBonus = (priority - 1) × 0.15` on lore only.

These are safely comparable **within** a source and meaningless **across** sources, which is
the whole reason (iii) exists.

### (ii) Retrieval and shape parameters — numeric and boolean

`scanDepth` (10, and see §1), `guaranteedMessages` (10), `contextThresholdPercent` (0.8),
`matchMode`, per-source enable toggles. Plain values with plain meanings.

### (iii) Group importance — a share of the budget, **not** a score multiplier

This is the slider between messages, world lore, character lore, history and relationship
data, and it is the one with a wrong implementation that looks right.

**The wrong version:** multiply each source's scores by its group weight, then rank
everything in one pool. It fails because the scores are not on a common scale — a message
score and a lore score are built from different signals with different distributions. Turning
up "world lore" to 2× does not surface _more_ world lore; it surfaces world lore whose scores
happened to be numerically large, and starves whichever group is naturally more conservative.
The user turns a slider and gets a result they cannot explain, which is worse than no slider.

**The right version:** group weights allocate **share of the content budget**. Normalise the
weights, split the token budget proportionally, and let each group fill its own share by its
own ranking. Today's behaviour is exactly this with fixed numbers —
`MESSAGE_FILL_FRACTION = 0.5` is a two-group slider at 50/50, and `FILL_BUDGET`
(worldLore 20, charLore 15, history 10, messages 50) is a per-group ceiling on top.

So the model is:

```
share      = weight / Σ weights        → tokens this group may use
cap        = FILL_BUDGET[source]       → most entries it may contribute
floor      = minMessageTokens (512)    → what a group is guaranteed regardless of share
```

Three properties fall out, and each is a thing a user can predict:

- **turning a group up takes tokens from the others, and nowhere else.** No group can be
  crowded out by another group's scoring being generous.
- **turning a group to zero excludes it**, which is a toggle for free rather than a separate
  concept.
- **the receipt can state the arithmetic**: "world lore: 1,840 of 2,300 tokens allocated
  (share 0.4), 12 of 20 entries, 3 dropped for budget." The `why` trail already carries
  per-block reasons (16 §7c); this is what it says for a group.

### Spillover: a share is a priority, not a cap

Found while building the selector, and it changes the model in a way worth
recording. Per-group budgets alone have a degenerate case: a chat with no
character lore throws that group's share away, and on a small context _every_
group's share can be smaller than any single candidate, so nothing is selected
at all — where today's single pool would have included the best entry.

So allocation runs in two passes. Each group claims its share first, in score
order; then whatever no group could use is pooled and offered to the remaining
candidates across groups, again in score order. Entry caps still apply, and a
group weighted to zero stays excluded — **off means off, and spillover
redistributes unused budget rather than resurrecting a group the user switched
off**.

The property this preserves is the one that makes the slider trustworthy:
turning a group up still gives it first claim. Only the leftovers move.

### Where they live

| kind             | slot                                 | scope                |
| ---------------- | ------------------------------------ | -------------------- |
| signal weights   | `params` on the rank node            | preset / user        |
| retrieval params | `params` on the query and rank nodes | preset / user        |
| group importance | `params` on the assemble node        | preset / user / chat |

All three are `params`, so all three round-trip in an author preset — which is what makes
"Lore-heavy", "Fast" and "Balanced" a real difference rather than three names for one
behaviour (12 §3a).

---

## 4b. The governing constraint: no new defaults until parity

Every parameter above ships with the value that reproduces today's behaviour, and every
feature in §1 ships off:

```
scanDepth 10 · guaranteedMessages 10 · matchMode substring
probability 100 · group null · recursionDepth 0
```

Then the parity corpus passes **unchanged**, and each new capability is something a user turns
on deliberately.

The alternative — "no new features until parity" — sounds more disciplined and is worse. It
means two releases of shipping nothing, and it puts pressure on the gate the moment anything
good is ready. A gate that gets loosened once is not a gate.

**Recursion is explicitly deferred**, including the question of where its settings live —
pipeline-level weights, lorebook entry, or both. It is a topic of its own and it is the one
feature that most changes what lands in context.

## 5. Token counting is a fourth category

`countTokens` is called inside the fill loops, once per candidate, and it may be async and
out-of-process. It is neither pure computation nor retrieval: it is an **injected effect**
called O(candidates) times.

The pipeline model has a place for this — `CostProfile` and the injected `countTokens` on the
run — but the cost profile matters here in a way it does not elsewhere. A per-candidate
async count against a real tokenizer, on a pool of forty candidates, is forty round trips
inside a Task that is supposed to be pure and fast.

**The replacement counts once per candidate up front, not once per fill attempt**, and the
fill loop works on numbers. That is a behavioural change with a visible consequence: today a
candidate is counted in context (`tentative push, recount, pop if over`), so its cost
includes the template's own separator overhead. Counting standalone will differ by a few
tokens per entry. Parity fixtures must be built against the **rendered output**, not against
the token figures, or this shows up as a false failure. Recording it here so it is not
rediscovered as a bug.

---

## 6. What must become explicit inputs

The coupling list, which is the actual work of the refactor:

- `chat.chatMessages`, `.chatCharacters`, `.chatPersonas`, `.id`
- `chat.lorebook` and `.lorebookId`, including `lorebookBindings`
- `chat._continuationPrefill` — the placeholder message's content
- `currentCharacterId`
- `populateLorebookEntryBindings` and `isCharacterLoreEntryVisible` (pure; move as-is)
- `interpolationEngine` and the message processor built from it
- `MIN_GUARANTEED_MESSAGES`, `MESSAGE_FILL_FRACTION`, `MIN_MESSAGE_FILL_TOKENS` — constants
  today, **slot config** in the replacement
- the module-level `db` and `schema` imports — these become Query results

`populateLorebookEntryBindings` **mutates the entry in place**. In a pipeline that value may
be read by more than one downstream node, so the replacement returns a new entry. A mutating
transform inside a graph is a bug waiting for a second consumer.

---

## 7. Three determinism hazards, found while reading

All three matter because parity is checked by running the two paths and comparing, and a test that
fails one run in twenty is a test people learn to re-run.

**RAG fill-in message scores depend on raw row ids** (`RagInfillEngine:1050`, `:1067`):
`0.5 + 0.5 * (id / maxId)`. That is insertion order, not content — so the same conversation
imported into a different instance scores differently, and a chat whose messages were
created out of order scores oddly. The replacement should use **position in the ordered
history**, which is what the expression is reaching for. This is a behaviour change and needs
its own parity fixture rather than being folded in silently.

**Graph-pair priority depends on `Map` iteration order** (`RagInfillEngine:772`). Insertion
order is stable within a run and is a function of retrieval order, so it is deterministic
today by accident rather than by design. The replacement should sort explicitly. Currently
masked because the narrative-graph feature flag is off and `serializeGraphPairs` returns
`undefined`.

**The example dialogue is chosen by `Math.random()` mid-compile**
(`promptBuilder/index.ts`, `contextBuildCharacterExampleDialogues`). This one is not a
hazard to parity, it is a **blocker** on it: with a character that has two or more example
dialogues, compiling the same turn twice produces two different prompts, so "do the two
paths render the same bytes" has no answer to check. It is also the only input to a prompt
that the run's receipt cannot explain, which undercuts the receipt's whole claim.

Ruled and implemented: the pick is a **parameter**, defaulting to the legacy random roll on
the legacy path (which is therefore unchanged) and coming from `ctx.random` — the SDK's
run-seeded RNG, granted to a type that sets `declaresRandomness` — on the pipeline path, with
the chosen index reported as an output. Same uniform spread across turns, same answer twice
within a turn.

The first implementation hand-rolled an FNV hash of the run id in the binding, which was
reinventing `seededRandom`. The mechanism already existed and is the *declared* one, which
matters beyond tidiness: a type that takes randomness says so in its descriptor, so
"which nodes in this spec are non-deterministic" is answerable from the document.

None of the three is urgent. All are cheap now and expensive after the parity corpus exists,
because then every change to them looks like a regression.

---

## 8. Parity strategy

The comparison surface is `InfillResult` — specifically `renderedPrompt` /
`renderedMessages`, which is what actually reaches a model. **Not** `totalTokens`, for the
reason in §5, and not the diagnostics, which are allowed to improve.

The existing suites are the starting corpus: `KeywordInfillEngine.test.ts` (767 lines) and
`RagInfillEngine.test.ts` (737 lines) already encode the behaviours worth preserving —
reserve/pinned handling, character-lore privacy, the exact 0.30 priority delta, per-type
caps, the guaranteed-10 window, post-history, and the hard-limit safety net. Their fixtures
(`infillTestUtils.ts`) are reusable as pipeline fixtures with no change, because they build
plain data.

Add to that a corpus drawn from real chats — group chats, chats with a lorebook at the
context limit, chats with custom prompt configs — per 08 §5b. `parityGate` fails an empty
corpus on purpose.

---

## 9. Where NER lands, later

NER is planned to complement RAG **after** the pipelines have fully replaced legacy and the
SDK has proven itself. Recording the shape now, because it is a useful test of whether this
decomposition is right — and it passes that test in a specific way worth noticing.

**It needs no new node kind.** Entity extraction is either a Task (a local model, pure over
its input, seeded if it is stochastic) or a Provider (a model call over the network), and the
lookup it feeds is a Query. The five kinds absorb it:

```
provider ner        core:provider/extract-entities@1   or a Task, if local and pure
query    byEntity   core:query/lore-by-entity@1        entries matching the extracted names
task     rank       combined ranker                    a third arm
```

The pool of retrieval arms grows; the spine does not change; nothing downstream of the ranker
knows there is a third arm. That is the property the kind taxonomy was closed for.

**NER is an arm, not a fourth `retrieval_strategy` value.** Adding `ner` to the enum would
force every existing entry to be re-triaged by its author to benefit, which is a migration
users would experience as homework. Instead, entries set to `keyword` or `both` gain
entity-aware matching automatically — NER is a better way to find the same entries, not a
different category of entry. An entry set to `rag` is unaffected, which is what its author
asked for.

**Sequencing is deliberate and worth holding to.** NER before parity means the new path
produces _better_ results than the old one, and "better" is indistinguishable from "different"
when what you are trying to prove is that nothing changed. The parity gate would have to be
loosened to accommodate it, and a loosened gate is not a gate. After parity, NER is a feature
with a receipt line rather than a confound.


---

## 10. Built so far, and what each stage answers

| module | stage | answers |
|---|---|---|
| `ranking/signals.ts` | pure signals | what does this entry score on each axis? |
| `ranking/weights.ts` | parameters | what are the knobs, and what were they before? |
| `ranking/strategy.ts` | arm eligibility | which arm may surface this entry, and did it? |
| `ranking/keywordQuery.ts` | the keyword arm | **what matched** — and what did not, with a reason each |
| `ranking/select.ts` | rank + budget | **what won**, and **what fit**, with the arithmetic |
| `host.ts` → `vector_search` | the vector arm's retrieval | which entries are semantically near? |
| `bindings.ts` → `merge-candidates` | fusion | what did both arms agree on? |

Two things landed while wiring these that were not in the plan.

**Embedding availability is instance state, not data.** It decides whether a
`rag` entry falls back to keyword, so a first attempt passed it along a data
edge — which is wrong twice over: it is not a property of the conversation, and
config resolves before the run while "is the model loaded" is a fact about this
moment. It now arrives through the host's scoped read surface, delegating to
`isModelReady()` — **the same function the legacy RAG gate already uses**.
Re-deriving that rule would eventually disagree with the legacy path about
whether RAG is on, and the parity corpus could not see it: both paths would be
internally consistent and different.

**Every stage reports what it declined.** A disabled entry, an entry set to
`rag` on an instance with embeddings, and an entry whose keys simply did not
match are three different user problems with three different fixes, and today
all three present identically as absent lore. The Query returns `skipped` with a
reason per entry; the ranker returns a decision per candidate with the numbers
that produced it.


---

## 11. Where the vector arm's work actually happens

Cosine ranking runs **in the host**, not in a Task, and the reason is the same
one that keeps `embedding` off the lore projection: a vector is a few hundred
floats. Moving candidate vectors along a data edge would put them in the run's
values, in every downstream node's input, and in the receipt — for a number that
is only ever used once, immediately.

So the split inside "RAG" is finer than retrieval-versus-ranking:

| step | where | why |
|---|---|---|
| embed the query | **Provider** | reaches a model, so a Query may not (16 §1) — and being on the spine puts it in the budget and the receipt |
| fetch candidates + cosine | **host**, via `vector_search` | data-heavy, and the vectors must not travel |
| strategy eligibility | **Query binding** | policy, not retrieval — the host does not know what `retrievalStrategy` means |
| MMR, caps, thresholds | **Task** | ranking policy, and the thing a plugin should be able to replace |

The embedding call being a Provider is worth stating as a rule rather than a
placement: **retrieval that quietly embeds is a model call nobody was billed for
and nobody can see.** Today it happens inside the infill engine, which is why
the run inspector cannot show it.

`Candidate.presetScore` exists for the merge: once two arms are fused, applying
signal weights on top would reintroduce exactly the scale problem rank fusion
was chosen to avoid. A fused score overrides the weighted sum rather than
feeding it.


---

## 12. Assemble, and a correction to the SDK

**Handlebars is what core renders — and that is a default, not an assumption.**
The draft declared the assemble slot as `jinja2`, which would have failed parity
in the worst available way: as a *template* bug rather than a configuration one,
with a user editing their story string to chase it.

The deeper correction is that **the schema is engine-agnostic**.
`context_configs.engine` stores which language a template is written in, NULL
meaning core's default. Core resolves the renderer from that id at run time, so
an extension can register its own engine and supply its own assembler. Without
the column, "core renders Handlebars" is a fact buried in code and a plugin
shipping a different assembler has nowhere to say so.

The template-engine registry (12 §2a) is exactly what made this a one-line
change instead of a redesign, which is the argument for having built it.

**The renderer is a registry, and nobody can take over an engine they do not
own** — including core's. A plugin able to redefine how everyone else's
templates render could change every prompt on the instance without appearing in
any spec. An *unknown* engine throws rather than falling back to Handlebars: a
fallback mostly "works", emitting the foreign syntax intact, and sends a model a
prompt full of markup nobody meant to include.

The engine travels with the source through the scope chain, always — including
when it is core's default. A template whose source resolved at one scope and
whose engine resolved at another would render one config's text with another's
language, and that only shows up once somebody overrides one of the two.

**The Handlebars engine in the SDK refuses to render.** It is a declaration —
id, label, variable extraction, cost profile — and its `render` throws. That is
deliberate: core has a registered helper set, and a second implementation in the
SDK would differ in ways that read as template bugs. Rendering is host-supplied,
and `assemble.ts` uses `Handlebars.create()` plus
`registerContextHandlebarsHelpers` — **the same construction the legacy path
uses** — so identical behaviour is a property of construction rather than of
care.

### What Assemble does, and what it does not yet do

| | |
|---|---|
| **allocate** | decisions → blocks with tokens, `why`, and included/excluded. Excluded blocks are **kept** — a user asking "why isn't my lore showing up" is asking about something absent |
| **render** | one pass, core's Handlebars, blocks exposed under the names existing templates already use |
| ⚠ **not yet** | the template *context* — characters, personas, scenario, example dialogue — is still built by `PromptBuilder` from a hydrated chat |

That last row is the remaining parity gap and the next unit. Until it closes,
Assemble renders what it is given: enough for the debug preview, not enough to
replace the legacy path.

**A missing template halts rather than rendering an empty prompt.** A context
config that did not resolve is a configuration problem, and the difference
between a halt that says so and an empty string decides whether a user opens
settings or files a bug.

### One bug worth recording

Variable extraction with a single regex and an optional keyword backtracks on
`{{/each}}` and reports `each` as a referenced variable. It appeared in both the
SDK engine and Assemble, because the second was written from the first. A
diagnostics list with helper names in it teaches a user to distrust the whole
panel — the fix is a lookahead that skips closing tags outright.

---

## 13. The template context, and the last thing that needed a `PromptBuilder`

Everything else on the prompt path could be lifted because it took arguments. The template
context could not: `PromptBuilder.buildTemplateContext` is private and reads `this.chat`,
`this.assistantCharacters`, `this.userCharacters` and `this.interpolationEngine`, which is
why the whole builder had to exist before any part of the prompt could be produced.

It is now two pieces, and the split is the point:

- **`promptFields.resolveContextInput`** decides. Which characters appear, which get named,
  which scenario wins, which of the prompt texts each field draws from.
- **`templateContext.buildTemplateContext`** renders. It interpolates, joins, stringifies,
  and assembles the shape — and resolves nothing at all.

The reason to split rather than port the method whole is that a parity failure in one is
diagnosable and a parity failure in the pair is not. If the output differs, either an input
differed or the interpolation differed, and now those are separately testable.

### What reading the legacy code actually turned up

The first version of this replacement passed a differential test that was worthless: the
test's "legacy" fixture reproduced the legacy steps *from my reading of them* rather than
calling the real helpers, so it agreed with the replacement about things both had got wrong.
The test now calls `createInterpolationContext`, `interpolateObject` and
`attachCharacterLoreToCharacters` directly. **A differential test that reconstructs the thing
it differences against is only testing the reconstruction.**

Rewriting it that way surfaced five defects that would all have shipped:

1. **`{{narratorName}}` was missing entirely.** Narrator-mode configs reference it in their
   own text; without it the literal handlebars reaches the model.
2. **Six prompt texts had been collapsed into three.** `postHistoryInstructions` (the
   top-level variable) and `promptPostHistoryInstructions` (the copy placed next to the
   seed) come from *different* config fields and render in *different* places. Feeding one
   to both is invisible in the common case where they carry the same string.
3. **The speaker's own post-history text was looked up by display name** from the cast
   array. It is resolved from the current character upstream. The lookup picks the wrong
   card as soon as two characters share a nickname.
4. **The two visibility filters are not the same filter.** The cards include an *inactive*
   character and include a *hidden* one if they are the speaker; the joined names exclude
   both, speaker or not. Deriving the names from the cards — the obvious cleanup — leaks a
   hidden character's name into every prompt that renders `{{characterNames}}`.
5. **The group-chat scenario rule is not a fallthrough.** A group chat with no scenario of
   its own renders *no* scenario, rather than falling back to one member's — because one
   member's scenario describes a situation the rest of the cast is not in.

Four of the five are in `promptFields.ts` and each has a test named after the rule rather
than after the function, because the rule is the thing that survives a rewrite.

### One rule, one implementation

The `contextBuild*` methods are now thin delegates to `promptBuilder/contextFields.ts`, which
both paths call. This is the first legacy file this migration has edited rather than wrapped,
and the justification is narrow: these are field-selection rules with no I/O, and two copies
of "which post-history text wins in narrator mode" is precisely the divergence a parity
corpus cannot see — both paths would be internally consistent, and different.

### Still open

The prompt path is decoupled; it is not yet at parity. What remains is
`core:provider/generate-text@1` (dispatch through the existing adapters) and the corpus
itself. Rendering is no longer the gap.

---

## 14. Dispatch, and the spine end to end

The last unbound node. `core:provider/generate-text@1` now sends through the **same seven
adapters** the legacy path uses, via the `withCompiledPrompt` seam: set a payload and
`compilePrompt()` returns it instead of building one, so everything downstream is untouched
legacy code. There is no second HTTP client and no second request shape — which is what makes
parity checkable rather than asserted.

### The line the connection does not cross

`dispatch.ts` resolves the connection and **never returns it** — no URL, no key, no headers,
no model id. What comes back is the completion, whether it was aborted, and the connection
*type* as a label. This is stated as a test rather than a convention because it is a property
that can only fail silently: a leak looks exactly like a working generation. A Provider that
could read connection material is a plugin that exfiltrates an API key while its spec reads
as an innocent node, and the review gate would show nothing wrong.

### Three findings, all from running it end to end

`spine.int.test.ts` wires the whole path — event → history + lore → cast → context → assemble
→ generate → write — as one stored document, executed against real rows with only the model
faked. Building it produced three corrections that unit tests could not have:

1. **The context builder was the wrong node kind.** It read the cast itself and died on
   `ctx.read is not a function`. A Task is handed no services (F11) and the executor enforces
   it. That is the ledger catching a decomposition mistake, not an obstacle in front of one:
   the read is a read and belongs in `core:query/chat-cast@1`; what is left in the Task is
   the part anyone should be able to replace. The type is now two, and better for it.

2. **`dispatch.ts` imported the application's database.** The pipeline ran against a test
   database while dispatch read from the other one and reported the chat as deleted. A module
   that reaches for the global connection cannot be run against anything else — which
   includes every future case where "anything else" matters: a dry run, a replay, a second
   instance. The db is now handed in.

3. **The template has to come through the slot.** The first version of the spine test
   hardcoded the story string in the spec, which passes while skipping the layer that decides
   which template a given chat actually gets. It now resolves through `buildWorld` from a
   context config row — so the test exercises the resolution an install depends on.

### What the spine test does not prove

Not parity. It proves the path runs end to end and that each stage's output reaches the next
one. Whether the bytes match `PromptBuilder.compilePrompt` is the corpus's job, and the
corpus is now the only thing left between here and replacing the legacy path.

---

## 15. The parity corpus, and the six defects it found

The harness runs both prompt paths on the **same database rows** and compares the rendered
prompt byte for byte. The legacy side is `PromptBuilder.compilePrompt`; the pipeline side is
`run(..., { preview: true })`, which halts at the pre-call substrate with the real payload —
comparing against a re-render would compare a reimplementation, and a harness that passes on
a reimplementation is worse than none, because it is evidence pointing the wrong way.

**Eight fixtures, all green.** One-to-one and group chats, macros inside character cards, the
six-way post-history split, dated history entries, the two visibility filters, narrator mode,
and twelve near-identical lore entries competing for one budget. See §16 for what each found.

Getting the first one green took six fixes. **Not one of them was visible to a unit test**,
and every node reported success throughout:

1. **The pipeline was not producing a `CompiledPrompt` at all.** Assemble publishes blocks
   plus a rendered string; an adapter wants `{prompt, messages, meta}`. Nothing bridged them.
   The spine test passed because its fake adapter accepted anything — a real one would have
   found no `prompt` and no `messages` and generated from an empty string, which reads as a
   model fault. `dispatch.toCompiledPrompt` is the bridge, and it is on the dispatch side
   because the conversion needs the connection's prompt format.

2. **`{{instructions}}` rendered blank.** The `prompts` slot was layered onto the Assemble
   node only, and the *context* node is what resolves which post-history text wins between
   the config's and the speaking character's. Both need the authored text and neither derives
   it from the other; `buildWorld` now layers it onto both.

3. **Declared parameter defaults were decoration.** Nothing in the executor applied `default:`
   from a parameters schema, so a spec that did not override `budget` got `undefined` — read
   downstream as a budget of zero, which excluded every block and rendered a context with its
   lore silently missing. `resolveSlot` now starts from the type's declared defaults.

4. **Assemble rendered candidates it had no decisions for.** The spec had no ranker, so
   Assemble received candidates, allocated nothing, and rendered a prompt with the whole
   retrieval result dropped — no error anywhere. It now halts and names the missing node. The
   ranker's `decisions` output also had to be published *whole* rather than flattened to
   id/score/reason: Assemble allocates from them, and a decision without its candidate has no
   content to put in a block.

5. **The lore variables had the right names and the wrong shapes.** `worldLore` was an array
   of strings; every default story string consumes `{"<name>": "<content>"}`. A variable with
   the right name and the wrong shape still renders — the template produces something, and
   the prompt is quietly wrong. Same for `history` (keyed by formatted date, newest first)
   and `currentDate`. The date formatters were private to `KeywordInfillEngine` and are now
   shared, for the same reason `contextFields` is.

6. **Chat messages rendered as `: `.** The default template renders
   `{{{name}}}: {{{message}}}` and the pipeline produced `{id, role, content}` — so the whole
   conversation came out as empty lines. Naming a message is real work: who said it, resolved
   through removed participants to a name snapshotted at removal, plus per-message
   interpolation where `{{char}}` is *that* message's speaker, plus the seed line the model
   continues from. `core:task/process-messages@1` does it by reusing `ChatMessageProcessor`
   rather than reimplementing the resolution chain — a second version agrees on every chat
   until someone leaves one.

### A seventh, in the test itself

The first fixture's template used `{{this.content}}` for messages. Both paths rendered blank
message lines and **agreed for the wrong reason**. The real default template proves the
variable is `message`. A fixture written from an assumption about the subject can hide the
very difference the corpus exists to find; the fixture now matches the shipped template.

### The rule this corpus runs under

A divergence is a **finding, not a bug to be fixtured away**. Every time a fixture is
adjusted to make the comparison agree, the corpus loses the case it was built to hold. If the
two paths differ, either the pipeline is wrong or the legacy behaviour was worth changing on
purpose — and the second needs its own ruling, in writing, before the fixture moves.

---

## 16. What the rest of the corpus found

Each fixture after the first was added expecting it to find something. Each did.

### Three more defects

**The `prompts` slot was overwriting the resolved context.** Assemble spread the slot *after*
the template context, so the config's raw authored text clobbered the same fields after the
context builder had resolved them — a prompt rendered the config's post-history text with
`{{char}}` still literal in it, where the speaking character's own reinforcement belonged.
Both sides looked correct in isolation. The fix is the spread order: slot first, resolved
context second.

**`seedName` did not exist in the pipeline.** The trailing assistant line the model continues
from is named `charName` in character mode — but in narrator mode `charName` is the *joined
cast list*, and the legacy code has a comment explaining exactly why the seed must not be:
seeding "Alice and Cara:" teaches the model to write joint dialogue as those characters
instead of narrating. It is now its own out-port, deliberately not a field inside the template
context, because nothing renders `{{seedName}}` — it is not a template variable.

**`personaName` had the wrong fallback in both directions.** One persona when someone is
speaking, the whole joined list when nobody is; and `"user"` rather than an empty string when
a chat has no persona, so a card reading "you are talking to {{user}}" does not render "you
are talking to ."

Also: `narratorName` was missing from the `prompts` slot's field list, so a renamed narrator
("The GM") seeded as "Narrator" and read as one thing in the prompt and another in the UI.

### One defect in the harness

`runFixture` set the instance prompt config **only when a fixture asked for one**, leaving the
previous fixture's config in place for every fixture after it. Two fixtures diverged on a
system prompt they never chose. That reads exactly like a pipeline bug and is a harness bug —
worth stating because it is the failure mode a corpus is most likely to produce: shared
mutable state across fixtures, presenting as a difference in the subject.

### Two things the corpus cannot measure, by construction

Both are arguments *for* rulings already made, not gaps in them.

**A character with two or more example dialogues.** Legacy rolls `Math.random()` mid-compile;
the pipeline uses the run-seeded RNG. The two disagree at random, so the field has no
comparable value — a corpus fixture would report a defect that is not one. The pipeline's own
determinism is pinned separately.

**Lore entries with equal `position`.** Neither path issues an `ORDER BY`, so the tie-break
falls through to whatever the database returns. The resulting lore order is arbitrary *today,
on the legacy path*, which is worth knowing on its own.

### The one that was in the scoring: tf-idf measured the wrong thing

`chat/over-budget` — twelve near-identical lore entries — was the first divergence that was
not plumbing. Legacy scored them as a tie and fell back to authored position (0..11); the
pipeline scored them apart and led with the two-digit ones. Ordering is user-visible: it is
the order lore reaches the model.

The cause, once the two scorers were compared signal by signal, was that **the two tf-idf
implementations compute different quantities**:

- legacy's `tf` is the term's frequency in the **guaranteed message window** — "is the chat
  talking about this entry's subject right now";
- the pipeline's `tf` was the term's frequency **within the entry's own text** — "is this
  entry's wording distinctive", which is a property of the entry alone and says nothing about
  whether it belongs in this turn.

That is why "Ashguard fact 10" outscored "Ashguard fact 0": the token `10` appears only in the
entry, so legacy gives it `tf = 0` and it contributes nothing, while the entry-relative
version gave it weight. Both implementations were internally coherent, both had tests, and
the tests agreed with the code — which is precisely the failure a differential corpus exists
to catch and a unit test cannot.

Two smaller differences fell out of the same comparison: tf-idf scores against the
**guaranteed** window rather than the scan window (they are different depths, and the scan
window's job is deciding what can match a key at all), and legacy iterates the entry's terms
**with duplicates**, so a term written twice in an entry's keys counts twice.

### The `OPEN` list, and why it is empty

The list held `chat/over-budget` while it was being diagnosed. Its second rule — a fixture in
it that starts passing **fails the test** — is what emptied it: fixing tf-idf made the fixture
pass, the suite went red, and the fixture moved into the gate. That is the mechanism working
rather than a formality. A passing fixture in an open list is a test nobody is running.

---

## 17. The semantic arm, which was one stage of nine

The keyword arm reached parity; the RAG arm could not have, and building a fixture would only
have proved it slowly. Reading `RagInfillEngine` against the pipeline's vector Query, the two
were not close: **legacy runs nine stages between "here are candidates" and "here is what goes
in the prompt", and the pipeline ran one of them** — cosine similarity.

The missing eight, in the order they apply (the order matters and is not arbitrary):

1. **Two query embeddings, not one.** The current window (2 messages) and the recent window
   (3 before that) are embedded separately. "What is being said now" and "what was being said
   just before" are different questions, and one blended embedding answers neither.
2. **Rank fusion across them** — RRF at k=60, for the same reason the keyword/vector merge
   uses it: two similarity scores from two queries are not on one scale.
3. **Normalisation to the top result**, without which the threshold below means nothing —
   an absolute RRF score depends on how many queries ran.
4. **A recency boost for messages**, so a semantically similar line from an hour ago does not
   outrank a slightly less similar one from the last exchange.
5. **A priority boost for lore**, mirroring the keyword arm's per-tier bonus. Without it an
   author's "High" means something in one mode and nothing in the other, which is
   indistinguishable from broken.
6. **An adaptive threshold**: `max(floor, top × fraction)`. The two clauses answer different
   questions — the floor rejects a turn where nothing is relevant, the relative one rejects
   the tail of a turn where something is — and either alone fails on the other's case.
7. **MMR reranking**, without which retrieval returns five paraphrases of one fact and calls
   it five results.
8. **Per-source budget caps**, applied last so each source's cap takes its best rather than
   its first-arrived.

All eight are now `ranking/semantic.ts`, one function per stage, with 23 tests naming the
property rather than the function. **Every constant behind them is a parameter**, per the
weights ruling — nine of them, defaults asserted equal to the legacy values so making them
configurable changed nothing. One of those constants carried a `TODO: make configurable in a
future pass` in the original.

### The design question MMR forced

MMR is the one stage that compares candidates to *each other*, so it needs pairwise
similarity — and the host refuses to put embeddings on a data edge, because a vector is a few
hundred floats that would land in every downstream input and in the receipt.

Ruled: **the host returns a similarity matrix**, not the vectors. N² numbers for N candidates,
which at the tens this arm works in is smaller than two raw embeddings, and unlike an
embedding it is derived and not reversible into the source. The cost is real — a topK in the
thousands would need a different shape — and it buys the thing worth having: MMR stays a
**Task**, so diversity policy is replaceable. Running it host-side would have frozen it.

### Two defects found while building it

**The similarity matrix did not line up with the candidates.** The host built it over the
union of retrieved hits; the binding then filtered that union for retrieval-strategy
eligibility and passed both on unchanged. An off-by-one in a similarity matrix diversifies
against the wrong candidates — silently, and only when something was filtered. The binding now
projects the matrix onto the survivors, so the alignment holds by construction rather than by
convention. A test asserting the two have the same length is what caught it.

**Two type ids derived to one binding name.** Binding names are the camelCase of an id's name
segment and ignore the namespace — deliberately, so `core:task/assemble@2` reads as
`assemble` — which means `core:task/rank-semantic@1` and `chariot.recall:rank-semantic@1`
both wanted to be `rankSemantic`. Generation would have emitted the export twice and the
second would have won. `checkUnique` now reports collisions with both ids, and the plugin
example was renamed to `rank-recall`, which is a better name for it anyway.

### A composition error, caught by writing the fixture

The first version of the arm fused the current and recent windows into one ranking. It does
not: **each window runs the whole stack and the results are concatenated**, first occurrence
winning. The difference is not cosmetic — the windows are ranked against each other by
construction (what is being said now beats what was being said a moment ago), and each has
already been thresholded against *its own* top result, so their scores are no longer on a
shared scale. Fusing them would be the exact mistake the fusion *inside* each window exists
to avoid. `mergeWindows` is the correction, with the reasoning on it.

---

## 18. The RAG fixture, and four defects on the way to it

The semantic arm now runs end to end against real rows: an event arrives, the two query
windows are cut and embedded, the candidate pool is scored per query, the nine stages run per
window, the results are concatenated and selected against a budget, and the prompt assembles.
The fixture retrieves **by meaning** — its lorebook keys are deliberately unmatchable, so a
result can only have come from the semantic arm.

Four defects surfaced building it, three of them in code that already had passing tests.

**An empty query window crashed the embed call.** A chat on its first turn has no "recent"
window, so `texts: []` reaches the provider — a normal state, not an edge case. The host
turned that into `embed(undefined)` and the model wrapper threw, which surfaced as a provider
error on a perfectly healthy chat. Empty texts now means **no vectors**, and the vector query
already treats no vectors as no results.

**`slice(-0)` returns the whole array.** The window arithmetic read as though a window of zero
meant "ask nothing"; it meant "embed every message in the chat, one query each". Harmless
while the number was a constant, and these are user-facing parameters now — zero is a value
someone will type.

**Two parallel nodes raced on a dynamic import.** The host did `await import(...)` inside each
call. A retrieval block runs its chains in parallel, so two Provider nodes imported the same
module concurrently and one of them observed a module reporting no model loaded while its
sibling embedded happily — a provider error on one of two identical calls, depending on
timing. The import is memoized now: one promise, no second import to race with, and still not
loaded on an instance that never embeds.

**Retrieval has to live inside a block, and that is not a style question.** The debug preview
stops at the first Provider *on the spine*, and the embed calls are Providers. With them on
the spine the preview halted at `embedCurrent` and showed a payload that was a list of query
strings — a correct application of the rule and a useless preview. Inside a gather block they
are where the rule expects retrieval to be. Worth stating because the failure looks like a
broken preview rather than a misplaced node.

### Two declarations that had drifted from their implementations

`embed-text` declared an out-port of `vector` while its binding published `vectors`;
`vector-search` declared `hits` while its binding published `lists` and `similarity`. Neither
had been noticed because nothing wired those ports until this spec did — and then the *type
system* refused to compile the spec, which is the port declarations doing exactly their job.

### The divergence that was not one, and the two things hiding behind it

The first RAG fixture diverged: legacy rendered an extra lore entry that had zero similarity
to the query. It looked like the legacy engine admitting lore outside its retrieval result.

It was not. **The legacy RAG engine had not run at all.** `PromptBuilder`'s gate reads
`systemSettings.vectorizationEnabled` from the **global** `db` rather than from the chat it
was handed — the same defect class as `dispatch.ts` reaching for the global connection, but
where that one errored, this one *silently closes the gate* and runs the keyword engine
instead. So the fixture was comparing the pipeline's semantic arm against legacy's keyword
arm, and the extra entry was the keyword fill phase doing its job.

Pointing the mock at the test database made the first fixture green — and immediately turned
up a second thing. A fixture with more than one candidate diverged, because MMR needs
`cosineSimilarity` and the mock did not export it. The legacy engine **caught the throw,
logged a warning, and continued with no RAG results**, so the failure presented as "legacy
retrieved nothing" rather than as an error. Two properties conspired: a stage that only runs
with two or more candidates, and an engine that degrades silently.

Both are worth stating as findings in their own right:

- a gate that reads global state cannot be exercised against anything else, and one that fails
  *closed* and silently is worse than one that fails loudly — the behaviour it disables is the
  behaviour under test;
- silent degradation on a retrieval error is defensible in production and expensive in a
  harness, because it converts "this crashed" into "this found nothing", which is a legitimate
  answer.

### Four fixtures, all green

`rag/world-lore` (a single semantic hit), `rag/crowded` (five candidates, where the threshold
and MMR decide), `rag/no-match` (a query nothing answers — the threshold's *floor* clause is
what fires) and `rag/priority` (an author's tier competing against a better semantic match).
The nine-stage arm renders byte-identical to `RagInfillEngine` on all four.

Both arms are now at parity: eight keyword fixtures and four semantic ones.

---

## 19. Startup, and the entry point that makes it callable

Both arms at parity means the pipeline can be *run*, not just compared. Two pieces were
missing between "it matches" and "the app could call it".

### Bootstrap

`syncTypeRegistry` had no caller — the type registry and core's own specs were never written
to a real database. `bootstrapPipelines` now does both at startup, and the two are
deliberately different in kind:

- the **type registry** is a fact about the running code, hashed, and a conflict **refuses**
  rather than reconciling. A type whose ports changed under a document that already uses it is
  a spec that means something different than it did when someone approved it;
- a **published spec version** is content, and immutable by construction — published once per
  version, never rewritten. Re-publishing on every boot would either orphan a run's history or
  grow the table by one row per restart.

It is not in `db/defaults.ts` for exactly that reason: everything there is upserted by
`seedKey` so a user's edits survive, and a published version is the one kind of row where that
rule is wrong.

**A failure here does not stop the app.** A registry conflict means *pipelines* cannot run
safely on this build; it does not mean the chat cannot start, and taking an instance down over
a subsystem nobody has opted into would be the wrong trade. The conflict is logged and travels
in the report for a diagnostics screen. The test that matters most is the second-boot one —
boot code is the least deliberately exercised code in the app and the most likely to run on
someone's machine at 2am after an upgrade.

### `runTurn`

The entry point: load the published spec from rows, build the world and the host, run, return
the receipt. Nothing in it constructs a document — that is the difference between "the
pipeline works" and "the app could run the pipeline".

It returns the **receipt** rather than the text, because a caller needs to know whether it
ran, what it decided and what it wrote, and a turn that halted legibly is a normal outcome
rather than an exception. `generatedText` and `haltExplanation` read it for callers that want
one answer.

**It replaces nothing by itself.** `generateResponse.ts` still runs the legacy path. This
exists so that switch is a small, deliberate change at one call site rather than a rewrite of
the live generation path — and the parity corpus is what makes the switch safe to make at all.
Until the corpus was green, a function like this was a second implementation with a nicer
name.

### Where the migration stands

| piece | state |
|---|---|
| storage, registry, host, bindings | built, tested |
| keyword arm | 8 parity fixtures, byte-identical |
| semantic arm | 4 parity fixtures, byte-identical |
| assembly, dispatch, message write | built, tested |
| startup seeding | built, tested |
| `runTurn` entry point | built, tested |
| **the switch in `generateResponse.ts`** | **not made** |

The last row is deliberately not mine to take unilaterally: it is the change that makes every
user's next message go through the new path, and it wants a decision about rollout — a
setting, a per-chat opt-in, or a release — rather than a commit.

---

## 20. Comparing against a real chat, which found what the corpus could not

`npm run pipeline:compare` compiles one of *your* chats both ways and diffs. It sends nothing
and writes nothing — the pipeline side runs as a preview, the legacy side compiles a prompt
and drops it — so a chat can be compared while someone is in the middle of it. The app holds
the PGlite lock, so the server has to be stopped; that is a property of the database, and it
goes through `check-db-lock.js` like every other db command here.

The first run against a real chat diverged, and the cause is the best argument yet for the
tool existing:

**The post-history reminder was landing at the top of the conversation.** The shipped default
template renders it *inside* the message loop, gated on `msgIndex === postHistory.targetIndex`.
The context builder ships a placeholder index of 0 — it must, since the final message array
does not exist when it runs — and the legacy path overwrites it via
`resolvePostHistoryContext` right before render. The pipeline never did. So the reminder
rendered against message zero: at the top of the history, rather than next to the generation
point, which is the one place it was moved to in order to be followed at all.

**Nine corpus fixtures missed it**, because the corpus template renders `postHistory.*`
outside the message loop — and a flat template *cannot express a position*. The fixtures were
all green and all blind to it.

Two more things fell out of the same run:

- `postHistoryDepth` and `postHistoryTokenTrigger` reached the pipeline from nowhere. The
  trigger is a **suppression** — below it a short chat gets no reminder, because a
  reinforcement note two messages after the system prompt is noise — so the pipeline reminded
  on every turn. A fixture with no trigger configured behaves identically either way, which is
  why only a real chat showed it. They are numbers, so they layer onto the **params** slot,
  not `prompts`: that slot carries authored strings, and the contracts package's own types
  refused the wrong home before any test did.
- The shipped template existed **only as a string literal inside a seed array**, so nothing
  could reference it. It is now `DEFAULT_CONTEXT_TEMPLATE`, used by the seed and by a new
  `chat/shipped-template` fixture — the corpus now tests the template users actually get.

### The harness bug, for the third time

Adding that fixture turned all eight others red at character 0: it wrote
`defaultContextConfigId` and did not reset it, so every fixture after it rendered with a
template it never chose. The same shape had already caused a false divergence with prompt
configs, and a third with the RAG gate reading a different database.

Fixed generally rather than again: `runFixture` now sets **every** instance default on **every**
fixture, including back to the corpus default when the fixture did not ask for one. Shared
mutable state across fixtures is the failure mode a corpus is most likely to produce, and it
always presents as a defect in the subject.

The tell, across all three: **the divergence was larger or stranger than a real defect would
produce**. Eight fixtures failing at character 0 is not eight regressions. Worth treating an
implausibly large divergence as a harness suspicion before a subject one.