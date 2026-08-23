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
reinventing `seededRandom`. The mechanism already existed and is the _declared_ one, which
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

| module                             | stage                      | answers                                                 |
| ---------------------------------- | -------------------------- | ------------------------------------------------------- |
| `ranking/signals.ts`               | pure signals               | what does this entry score on each axis?                |
| `ranking/weights.ts`               | parameters                 | what are the knobs, and what were they before?          |
| `ranking/strategy.ts`              | arm eligibility            | which arm may surface this entry, and did it?           |
| `ranking/keywordQuery.ts`          | the keyword arm            | **what matched** — and what did not, with a reason each |
| `ranking/select.ts`                | rank + budget              | **what won**, and **what fit**, with the arithmetic     |
| `host.ts` → `vector_search`        | the vector arm's retrieval | which entries are semantically near?                    |
| `bindings.ts` → `merge-candidates` | fusion                     | what did both arms agree on?                            |

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

| step                      | where                         | why                                                                                                        |
| ------------------------- | ----------------------------- | ---------------------------------------------------------------------------------------------------------- |
| embed the query           | **Provider**                  | reaches a model, so a Query may not (16 §1) — and being on the spine puts it in the budget and the receipt |
| fetch candidates + cosine | **host**, via `vector_search` | data-heavy, and the vectors must not travel                                                                |
| strategy eligibility      | **Query binding**             | policy, not retrieval — the host does not know what `retrievalStrategy` means                              |
| MMR, caps, thresholds     | **Task**                      | ranking policy, and the thing a plugin should be able to replace                                           |

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
in the worst available way: as a _template_ bug rather than a configuration one,
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
any spec. An _unknown_ engine throws rather than falling back to Handlebars: a
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

|                |                                                                                                                                                                            |
| -------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **allocate**   | decisions → blocks with tokens, `why`, and included/excluded. Excluded blocks are **kept** — a user asking "why isn't my lore showing up" is asking about something absent |
| **render**     | one pass, core's Handlebars, blocks exposed under the names existing templates already use                                                                                 |
| ⚠ **not yet** | the template _context_ — characters, personas, scenario, example dialogue — is still built by `PromptBuilder` from a hydrated chat                                         |

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
test's "legacy" fixture reproduced the legacy steps _from my reading of them_ rather than
calling the real helpers, so it agreed with the replacement about things both had got wrong.
The test now calls `createInterpolationContext`, `interpolateObject` and
`attachCharacterLoreToCharacters` directly. **A differential test that reconstructs the thing
it differences against is only testing the reconstruction.**

Rewriting it that way surfaced five defects that would all have shipped:

1. **`{{narratorName}}` was missing entirely.** Narrator-mode configs reference it in their
   own text; without it the literal handlebars reaches the model.
2. **Six prompt texts had been collapsed into three.** `postHistoryInstructions` (the
   top-level variable) and `promptPostHistoryInstructions` (the copy placed next to the
   seed) come from _different_ config fields and render in _different_ places. Feeding one
   to both is invisible in the common case where they carry the same string.
3. **The speaker's own post-history text was looked up by display name** from the cast
   array. It is resolved from the current character upstream. The lookup picks the wrong
   card as soon as two characters share a nickname.
4. **The two visibility filters are not the same filter.** The cards include an _inactive_
   character and include a _hidden_ one if they are the speaker; the joined names exclude
   both, speaker or not. Deriving the names from the cards — the obvious cleanup — leaks a
   hidden character's name into every prompt that renders `{{characterNames}}`.
5. **The group-chat scenario rule is not a fallthrough.** A group chat with no scenario of
   its own renders _no_ scenario, rather than falling back to one member's — because one
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
_type_ as a label. This is stated as a test rather than a convention because it is a property
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
   node only, and the _context_ node is what resolves which post-history text wins between
   the config's and the speaking character's. Both need the authored text and neither derives
   it from the other; `buildWorld` now layers it onto both.

3. **Declared parameter defaults were decoration.** Nothing in the executor applied `default:`
   from a parameters schema, so a spec that did not override `budget` got `undefined` — read
   downstream as a budget of zero, which excluded every block and rendered a context with its
   lore silently missing. `resolveSlot` now starts from the type's declared defaults.

4. **Assemble rendered candidates it had no decisions for.** The spec had no ranker, so
   Assemble received candidates, allocated nothing, and rendered a prompt with the whole
   retrieval result dropped — no error anywhere. It now halts and names the missing node. The
   ranker's `decisions` output also had to be published _whole_ rather than flattened to
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
   interpolation where `{{char}}` is _that_ message's speaker, plus the seed line the model
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

**The `prompts` slot was overwriting the resolved context.** Assemble spread the slot _after_
the template context, so the config's raw authored text clobbered the same fields after the
context builder had resolved them — a prompt rendered the config's post-history text with
`{{char}}` still literal in it, where the speaking character's own reinforcement belonged.
Both sides looked correct in isolation. The fix is the spread order: slot first, resolved
context second.

**`seedName` did not exist in the pipeline.** The trailing assistant line the model continues
from is named `charName` in character mode — but in narrator mode `charName` is the _joined
cast list_, and the legacy code has a comment explaining exactly why the seed must not be:
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

Both are arguments _for_ rulings already made, not gaps in them.

**A character with two or more example dialogues.** Legacy rolls `Math.random()` mid-compile;
the pipeline uses the run-seeded RNG. The two disagree at random, so the field has no
comparable value — a corpus fixture would report a defect that is not one. The pipeline's own
determinism is pinned separately.

**Lore entries with equal `position`.** Neither path issues an `ORDER BY`, so the tie-break
falls through to whatever the database returns. The resulting lore order is arbitrary _today,
on the legacy path_, which is worth knowing on its own.

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

MMR is the one stage that compares candidates to _each other_, so it needs pairwise
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
already been thresholded against _its own_ top result, so their scores are no longer on a
shared scale. Fusing them would be the exact mistake the fusion _inside_ each window exists
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
stops at the first Provider _on the spine_, and the embed calls are Providers. With them on
the spine the preview halted at `embedCurrent` and showed a payload that was a list of query
strings — a correct application of the rule and a useless preview. Inside a gather block they
are where the rule expects retrieval to be. Worth stating because the failure looks like a
broken preview rather than a misplaced node.

### Two declarations that had drifted from their implementations

`embed-text` declared an out-port of `vector` while its binding published `vectors`;
`vector-search` declared `hits` while its binding published `lists` and `similarity`. Neither
had been noticed because nothing wired those ports until this spec did — and then the _type
system_ refused to compile the spec, which is the port declarations doing exactly their job.

### The divergence that was not one, and the two things hiding behind it

The first RAG fixture diverged: legacy rendered an extra lore entry that had zero similarity
to the query. It looked like the legacy engine admitting lore outside its retrieval result.

It was not. **The legacy RAG engine had not run at all.** `PromptBuilder`'s gate reads
`systemSettings.vectorizationEnabled` from the **global** `db` rather than from the chat it
was handed — the same defect class as `dispatch.ts` reaching for the global connection, but
where that one errored, this one _silently closes the gate_ and runs the keyword engine
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
  _closed_ and silently is worse than one that fails loudly — the behaviour it disables is the
  behaviour under test;
- silent degradation on a retrieval error is defensible in production and expensive in a
  harness, because it converts "this crashed" into "this found nothing", which is a legitimate
  answer.

### Four fixtures, all green

`rag/world-lore` (a single semantic hit), `rag/crowded` (five candidates, where the threshold
and MMR decide), `rag/no-match` (a query nothing answers — the threshold's _floor_ clause is
what fires) and `rag/priority` (an author's tier competing against a better semantic match).
The nine-stage arm renders byte-identical to `RagInfillEngine` on all four.

Both arms are now at parity: eight keyword fixtures and four semantic ones.

---

## 19. Startup, and the entry point that makes it callable

Both arms at parity means the pipeline can be _run_, not just compared. Two pieces were
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

**A failure here does not stop the app.** A registry conflict means _pipelines_ cannot run
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

| piece                                   | state                                    |
| --------------------------------------- | ---------------------------------------- |
| storage, registry, host, bindings       | built, tested                            |
| keyword arm                             | 8 parity fixtures, byte-identical        |
| semantic arm                            | 4 parity fixtures, byte-identical        |
| assembly, dispatch, message write       | built, tested                            |
| startup seeding                         | built, tested                            |
| `runTurn` entry point                   | built, tested                            |
| **the switch in `generateResponse.ts`** | **made — unconditional** (§21, then §23) |

The last row was deliberately not taken unilaterally: it went in behind a setting first (§21),
and the setting itself was retired by the changeover ruling of 2026-08-19 — no toggle, pipelines
are the only path that compiles a reply (§23).

---

## 20. Comparing against a real chat, which found what the corpus could not

`npm run pipeline:compare` compiles one of _your_ chats both ways and diffs. It sends nothing
and writes nothing — the pipeline side runs as a preview, the legacy side compiles a prompt
and drops it — so a chat can be compared while someone is in the middle of it. The app holds
the PGlite lock, so the server has to be stopped; that is a property of the database, and it
goes through `check-db-lock.js` like every other db command here.

The first run against a real chat diverged, and the cause is the best argument yet for the
tool existing:

**The post-history reminder was landing at the top of the conversation.** The shipped default
template renders it _inside_ the message loop, gated on `msgIndex === postHistory.targetIndex`.
The context builder ships a placeholder index of 0 — it must, since the final message array
does not exist when it runs — and the legacy path overwrites it via
`resolvePostHistoryContext` right before render. The pipeline never did. So the reminder
rendered against message zero: at the top of the history, rather than next to the generation
point, which is the one place it was moved to in order to be followed at all.

**Nine corpus fixtures missed it**, because the corpus template renders `postHistory.*`
outside the message loop — and a flat template _cannot express a position_. The fixtures were
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

## 21. Keeping the run, and switching the app onto the pipeline

Two things the migration had been missing, and they are the two that make "did that use the new
path" answerable at all.

**The executor returned a receipt and nothing kept it.** So the first question anyone asks after a
turn — _did that use the pipeline, and what did it decide?_ — became unanswerable the moment the
request ended. F3 says rows are the system of record; that was true of specs and types and false of
runs, which is the one a user actually looks at. `pipeline_runs` and `pipeline_run_nodes` (0097) fix
it: the receipt blob is kept verbatim so a future panel is not limited by a column list written
today, and the parts people _query_ — which node halted, how long it took, which message it produced
— are columns, so "why did this reply include that lore" is not a JSON walk over every run in a chat.

**Writing a receipt never fails a turn.** A run that generated a good reply and then failed to record
itself has still generated a good reply. Persistence errors are logged and swallowed; the alternative
gets the priority exactly backwards.

Two things went wrong writing it, both caught by the schema rather than by review:

- **`runId` collided.** The SDK defaults it to the literal `"run:test"` when a host does not pass
  one — a reasonable default for a test and a trap for a host, since every run would share an id. The
  unique index is what found it. My own `seed` default was the same mistake one level down:
  `turn:${chatId}` is constant for the life of a chat, so every turn would have picked the same
  example dialogue and the variety the seeding exists to preserve would have been quietly gone.
  Both are `uuidv4()` now, and the seed is recorded so a caller reproducing a turn passes it back.
- **The write result is discriminated, and my first read of it was not.** A Consumer publishes
  `{status: 'committed', ids}` or `{status: 'pending', proposalId}`, because under async review a
  write is a _proposal_ a reviewer may still reject. Reaching straight for an id would have linked a
  run to a row that does not exist yet — precisely the failure the shape is discriminated to prevent,
  and the reason it is deliberately not assignable to `row-ids@1`.

**The switch itself is one call site.** `generateResponse.ts`, behind `system_settings.pipelines_enabled`
(0098), runs the pipeline in preview mode and injects the compiled payload at
`adapter.withCompiledPrompt(...)` — the seam all seven adapters already funnel through. **It falls
back to the legacy builder on any failure**, which is what makes it safe to switch on before it is
safe to delete anything.

## 22. The configuration surface, and what building it found

The pipeline view (05 §0a) is the panel that eventually replaces Prompt Configs: _"a flat list of the
things SP does for you, each with a handful of options."_ Building it turned up more about the
existing code than about the UI.

**Nothing could render a form from rows.** `snapshotRegistry` projected `slots` as a list of names,
so `pipeline_type_registry.slots` held `{"params": true}`. 12 §2 has the UI generate slot forms from
declarations, and 13 §10c has core read the registry row _without executing the plugin_ — a name list
satisfies neither, and forces a fall back to the in-process descriptor map that a `transport:
'process'` plugin type does not have. The row now carries the whole declaration, which also makes a
declaration part of the type's content hash (a moved default changes what an untouched spec does) but
not its `i18n` (translating a label is not a version bump). See 13 §12a–b.

**There was nowhere to write.** Presets existed; the layers 12 §2 resolves _around_ them did not.
`pipeline_node_overrides` and `pipeline_config_selections` (0099) add them, deliberately as two tables
rather than the one discriminated table 12 §3 describes — so that "does this travel with the
document" is structural rather than a `WHERE` clause somebody has to remember on export day
(13 §12c).

**`resolveConfig` was throwing away the answer to the most common support question.** It knew which
of five layers a value won at and returned only the value. `resolveConfigSources` returns both and
`resolveConfig` is now derived from it, so the two cannot disagree about which layer wins. Writing it
surfaced a latent defect underneath: rows were grouped by joining slot and path with a space and
splitting them back, so a declared field named `opening line` resolved against the path `opening` and
matched nothing. No core path has a space; nothing stops a plugin's from having one.

**The topology rule needed teeth.** 05 §0a says no node keys and _"no structure inferable from the
DOM"_, and structural editing is opt-in per instance — so a default-view payload carrying node keys
makes that setting cosmetic. The obvious encoding of an option address is that address in a costume,
and core's node keys are ordinary words (`prompt`, `generate`, `rank`) that fall to a dictionary. An
option id is an HMAC under the instance secret; the server resolves one by rebuilding the map from
the spec it is already loading. The claim is pinned by a test that walks the serialized payload and
fails on a node key anywhere outside human prose — including in property names, which is where the
next leak will be.

**And the view told the truth about something nobody wanted to hear.** Generated honestly, the
respond spec shows a user _three_ "System" boxes, because `buildTemplateContext`, `assemble` and
`generateText` each declare their own `prompts` slot and `world.ts` papers over it by writing the same
authored text to two of them. The view is right; the spec is wrong. Fixing it means slot references,
a new canonical hash, a new published version and a parity re-run — so it is filed (13 §12 finding i)
rather than done quietly at the end of a UI change.

## 23. Every trigger onto the pipeline, and what the wiring found

The changeover ruling of 2026-08-19 — no legacy/pipeline toggle, pipelines are the only path — turned
§21's cautious switch into the unconditional one. `generateResponse.ts` now runs the pipeline for
every reply and **fails the turn loudly when it cannot compile one**; the silent fall-through to the
prompt builder is gone, because a user with a configured pipeline silently getting a reply built by
something else is the one bug in this area nobody can see. The legacy builder survives only as
dispatch scaffolding and as `pipeline:compare`'s second arm. The narrator rides the same call site
into its own namespace: `isNarratorResponseMode` selects `core:spec/narrate` rather than dressing the
respond spec in a different prompt.

**The summarize sockets run their specs and stop at the write.** `chats:summarize` and
`scenes:process` shape a `summarize-request` and run the right namespace with
`preview: {atNode: 'save'}` — every model step executes and the run halts before the
`create-lore-entry` consumer, because those handlers have never written the entry: a person reviews
the result in the modal and saves. That is the same stop-at-review rule the graph proposal encodes
structurally, reached through the preview mechanism instead of a gate. What the handlers read back is
the receipt: `synth` for the content, `naming` for the name, `cast` for the participants, and the
count of batch steps for the progress card. A new `summarize_source` host read resolves sender names
and honours the legacy selection rule (an explicit id list is taken as given, hidden or not; "all"
filters hidden) — one place, so no binding can get the convention wrong. Coarse progress comes from a
new `HostScope.onStep` observer that receives each step's label and nothing else; progress never
reaches a receipt (F34).

**The request now travels.** 1.0.0 dropped the topic at the door: the drafting and synthesis nodes
had no port for it, so a focused summary drifted general the moment it ran. The three step types grew
a `request` in-port (`summarize-request@1`, whole object rather than plucked fields), the specs wire
`$.input.request` into every drafting iteration, synthesis and cast extraction, and the bindings read
`topic` and `knownCast` off it. Published versions are immutable, so this is `1.1.0`; and because the
port set is part of a type's content hash, migration 0106 re-projects the three registry rows — on
the 0099 precedent, just as deliberately narrow, and just as much not a pattern.

**Two defects the "behaviourally unproven" caveat was pointing at, found by the first full run:**

- **`$.drafting.item` never resolved.** The scope's walk rule steps toward inner nodes, and while
  _declaring_ the first inner node the chain has no members yet — so the reference fell through to
  the port branch and compiled to an edge from the block's nonexistent `item` port. Every draft ran
  against no batch, every graph step against no scene, and the output was plausible text about
  nothing — the least debuggable failure available, which is why the SDK fix makes `block.item`
  always walkable inside its own block and the terminal value the iteration item
  (`$ref('block.$item')`). The store learned the matching lesson: an item is a legal edge source,
  block-shaped, persisted in `from_block_id` verbatim. `graph-build` republishes as `1.0.1` for the
  corrected document — same authored source, different compiled edges.
- **A map aggregates as `branch-results@1`, and the synthesis binding read it as bare drafts.** One
  entry per iteration, `{branchKey, index, result}` in declaration order (13 §1) — so every draft
  unwrapped to `""` and synthesis would have merged silence. The binding unwraps the envelope, keeps
  the bare forms for direct callers, and drops a halted iteration's entry rather than handing the
  model an empty part to dutifully summarize.

**One mechanism for selection, not two.** The panel's preset picker wrote `presetSlug` against the
author-preset tables while the runtime resolved `configId` against the named-config tables — the
panel could not select what the run would use. `layers()` now resolves through the same
`resolveSelectedConfig` the runtime calls, the picker lists `pipeline_configs` rows, and
`selectNamedConfig` delegates to `configs.selectConfig` — one read path, one write path, so what the
picker shows is what the run uses. Ids are safe where preset slugs needed to be slugs: a config hangs
off the spec, not the version, and the FK nulls a deleted selection back to the shipped default. The
prompts-ref override got the same treatment one layer down: `writeOption` stores a row id in
`pipeline_node_overrides`, and `applyPipelineLayer` now dereferences it through `resolvePromptFields`
at the override's own scope — previously only the config-value path dereferenced, so a prompt picked
in the panel reached its node as the number 7.

**Still open, deliberately:**

- **The graph builder still runs the legacy path.** The spec is published and its per-scene map now
  actually receives scenes, but `graphBuilder.ts` carries a cast ledger, dedup, fuzzy matching and
  resume checkpoints that the five step bindings do not — wiring `narrativeGraph.ts` over before
  those live somewhere is a redesign question, not a call site change.
- **`compileScenesForEntry` is synthesis-only over scene summaries**, which is what a history entry
  actually is — the messages-to-batches shape `summarize-history` shares with its siblings serves
  `chats:summarize(loreType: 'history')`, not this flow. Whether the history namespace's true form is
  the compile flow deserves a ruling before the spec moves.
- **`create-lore-entry` writes `worldLoreEntries` regardless of namespace.** Unreachable today —
  every summarize run halts before it — but the event-triggered path would write character lore into
  the world table. It needs the entry kind on its input, which is a type change to make deliberately.

## 24. The last two flows, and the graph builder page

Section 23 left the graph build and the history compile on legacy resolution. They now run on
pipeline configuration, by a deliberate half-measure with a name: **the pipeline owns the config
surface; the builder keeps the loop.**

**Why not the executor, yet.** `graphBuilder.ts` is a sequential state machine — a cast ledger that
makes "Bram" in scene 3 and "bram" in scene 9 one proposed node, pair-wise perspective calls with
retries and drop diagnostics, fuzzy matching against seeds, resume checkpoints. Map iterations are
isolated by design (13 §1), so none of that state has a home inside the current five-step spec; and
the spec's one-call-per-step shape is _behaviourally_ far from the builder's many-calls-per-scene
reality. Running the spec live today would produce worse graphs and call it progress. The redesign
that moves the ledger into a merge stage is real future work; what could not wait was the config.

**`stepConfig.ts` is the seam.** It resolves any node's connection, sampling and prompt fields
through `buildWorld` + `resolveConfigSources` — the same world, the same five-layer chain, the same
rows the pipeline panel edits. `graphSteps.ts` maps the builder's five step names onto the spec's
node keys (`building.item.prefilter` …); `narrativeGraph:build` hands the builder what resolves,
falling back to the instance default connection exactly as `dispatchStep` does. The legacy
`graph_build_configs` path is retired from the handler. The history compile
(`scenes:compile`) does the same one node down: the history namespace's `synth` node decides the
model, sampling and prompt for `compileScenesForEntry`, whose messages-to-batches sibling shape
serves `chats:summarize` — the compile itself is synthesis-only over scene summaries and stays
outside the executor until that shape gets its ruling. Both flows record a run row (`halt` at the
write, truthfully — a person decides on the review screen), so the runs list sees every build.

**The shipped default is now an invariant, not a habit.** Every pipeline in `CORE_SPECS` must have
an immutable default config whose prompts-slot declarations all carry values pointing at a real
shipped prompt — pinned by a seed test that runs `defaults.sync()` first, because that is the boot
order `db/index.ts` guarantees and pipeline prompt seeding copies its prose from the legacy rows
sync seeds. The test caught its own environment being wrong before it caught anything else, which
is the correct order of operations.

**The graph builder page.** The declaration-driven option renderer moved out of PipelinesSidebar
into `PipelineConfigOptions.svelte` — slug in, form out, no field list, listeners filtered by slug
because two panels can be mounted at once. The sidebar kept its list and navigation and lost 250
lines; the Graph tab gained a pipeline panel — overview (name, version, manage link for admins) over
the granular per-step controls, next to the Build button it configures. An edit there reaches the
next build through `stepConfig.ts`, which is the whole point: one mechanism, so what the page shows
is what the build runs.

## 25. The gate, the form language, and progress as properties of the run

The ruling of 2026-08-19 (second): summarization and graph-building UI workflows are definable by
the pipeline and its nodes as an inherent user-facing feature — progress bars inherent, review-pause
forms 100% defined by the data the node receives, one form-building schema strategy shared with
extension settings and arbitrary extension forms.

**Progress is now a property of running a pipeline.** The executor grew `onNode` — one event as
each invocation starts and one as it settles, carrying identity (`nodeKey`, `typeId`, `kind`,
`seq`, the declared floor) and never a payload, because progress is not a second receipt (F34). An
observer that throws is the observer's problem. The summarize and scene handlers dropped the
dispatch-label hack (`HostScope.onStep`, deleted) and derive their activity cards from node events
— which means a plugin's summarize pipeline gets the same card with no wiring, which is the word
"inherent" doing its work.

**The review gate went live** (01 §7). It was always in the executor — parking on a host-supplied
reviewer, keyed on the `settings.review` config option, edit indistinguishable from approval (F14),
rejection a halt and not an error. What landed is core's half: `reviewGate.ts` parks the promise,
pushes the person a card, and folds their decision back. And the panel now offers **Review**
(off / async / sync) on every gated node — synthesized from the registry row's declared _effects_
rather than authored per type, because a node the gate applies to that the panel cannot configure
would make "an author cannot forbid review" true in the executor and false on screen. Flip the
respond pipeline's save step to `sync` and every reply waits for approval; that sentence required
no code specific to replying.

**One field language, one renderer.** The SDK's `SettingsSchema` — the declaration extensions
write plugin settings in — is the language everything renders from. `inferSchema(payload)` derives
a schema from whatever a paused node received: a string is a text field, a number is a number
field, structure a form cannot decompose arrives as JSON rather than being silently dropped —
an edit surface that hides part of the payload is a gate a write can sneak past.
`valuesForForm`/`applyFormValues` round-trip the payload through the form; untouched fields keep
their originals, unparseable JSON refuses with the field named. Client-side, `SchemaForm.svelte`
renders any such schema (groups, `showIf`, every field type, secrets write-only) and
`PipelineReviewModal` — mounted globally, because a review can park from any trigger — queues the
cards, oldest first. When the plugin sidebar lands, its per-extension settings render through the
same component; that is the "one renderer, three uses" promise of 12 §6, now with two of the three
uses live.

**v1's honest edges:** parking is in-memory (a parked run does not survive a restart — the durable
parking store lands with plugin lifecycle work); `async` review approves immediately with the
request recorded (true async proposals need proposal storage on every consumer target); and the
graph proposal screen remains deliberately bespoke — a node-and-relationship editor is richer than
any generated form should pretend to be.

## 26. Steps in the sidebar, and prompts you can finally touch

The panel's grouping changed from facets to **steps**, and the change is a ratified
exception to a rule this document defended in §22. 05 §0a said the option payload
carries no topology — not the node key, not the count, not the order — and the facet
grouping was that rule's UI: settings arrived sorted by *kind* (prompts, weights,
sampling), with node identity dissolved into disambiguated labels. In practice the
user asked for the opposite ("configuration should automatically group settings by
step or node"), and they are right about the reader: a person tuning the summarize
pipeline thinks "the drafting step's prompt", not "the prompts facet's third box".
The trade was put to the user and taken deliberately: `namespaceView` now returns
`steps: [{key, label, options, advanced}]` in run order, which **reveals the step
count and order** — and still no addresses. The `key` is an ordinal (`s0`, `s1`),
the label is the *type's* name off the registry row (disambiguated by occurrence:
"Generate text 2"), and writes still go through the per-option HMAC ids. What 05
§0a was actually protecting — a payload nobody can lift node keys from — survives;
what it withheld beyond that is now on screen because hiding it made the panel
harder to read, not safer. The node-key scan in `config.int.test.ts` still passes
verbatim.

Within a step, `advanced` carries everything whose matrix slot is `params` —
weights, budgets, thresholds — rendered inside a collapsed `<details>`. The person
who came to change a prompt no longer scrolls past nine numbers to find it, and the
numbers are one click away rather than gone. Label disambiguation shrank to match:
with the type name in the heading, prefixing colliding labels with it again would
say everything twice, so collisions (possible only *within* a node now) qualify by
slot name instead.

**Prompts became touchable where they are selected.** The dropdown was honest but
inert: choosing a prompt is half the gesture, and the other half — "what does it
say, and can I change it" — lived nowhere. A `prompts-ref` option now carries the
selected row (`prompt: {id, name, fields, readOnly}`), and the panel grows Clone /
Edit / Delete beside the dropdown, exactly the affordances the legacy prompt-configs
sidebar had. Clone answers with the copy's id so the client selects it and opens the
editor in one gesture; shipped prompts are `readOnly` and offer Clone only.
`deletePrompt` refuses twice — an immutable prompt (the floor every default config
points at), and a *referenced* prompt, checked against both `pipeline_config_values`
and `pipeline_node_overrides` at slot `prompts` — because a selection pointing at a
deleted row is the "stores cleanly and does nothing" failure `prompts.ts` exists to
refuse. One reference is exempt, and the live smoke test is what found it: the
caller's **own selection at their write scope**. Delete sits next to the selected
prompt in the panel, and selecting is itself a reference — without the exemption the
button is unreachable (select to see it, refused because selected; reset to release
it, button gone). So the socket handler releases the caller's own override rows
first — deleting what you selected resets your selection to what it inherits,
exactly as Reset would — and every other reference still refuses. The same session
of live testing caught a stale-editor hazard: an inline editor opened for one prompt
surviving a selection change and offering to save against another row. Drafts now
record the prompt id they were opened for, and the editor renders only while that id
is what the option points at. The socket handlers (`pipelines:clonePrompt/updatePrompt/deletePrompt`)
gate every mutation on the prompt belonging to the slug's spec: a prompt id is a
small integer somebody can guess, and without that line one pipeline's panel could
reword another's.

**Descriptions ride the declarations.** `ParamDecl` and `SlotDecl` grew an optional
`description` (I18n), carried through `Decl` into the option payload and rendered
as help text under the control. It is display text exactly like `i18n`, so
`typeContentHash` strips it recursively — copyediting an explanation must never bump
a type version. The fallbacks hold as before: no description renders nothing, no
i18n label falls back to the humanized key, no known type falls back to a text
control — a pipeline author can annotate everything or nothing and the form renders
either way.

### §26a. The audience split, the chain revision, and descriptions that reach rows

Three follow-ups from user testing of §26, each of which turned out to be load-bearing.

**Who sees what.** The panel's audience rule changed: a **non-admin sees prompts and
nothing else**, writable at their own scope as overrides on the admin's configuration.
To them the pipeline is how the application works — weights, sampling, review gates
and connections are the instance's configuration, and offering them at user scope
invited edits that changed behaviour nobody else could see or debug. An **admin gets
live controls for everything**, and the "(admin only)" dead text on the admin's own
screen — the person who may change it reading a label saying they may not — is gone:
every non-prompt option is writable and declares `writeAt: "instance"`, which the
client echoes back as the write scope. The line is enforced twice, in `visibleTo`
(what renders) and `resolveWriteScope` (what a minted id can reach), because hiding
is not what protects an option — the ids are stable handles.

**The chain revision (SDK `SCOPE_ORDER`).** Making admin edits land at instance
scope exposed a live defect: the original chain put `preset` (the selected config)
above `instance`, so an admin's edit was stored and then shadowed forever by the
shipped default's value for the same path — the one write in the system that stored
cleanly and did nothing, found on screen when a budget changed in the panel and the
run kept the config's number. The revision: **overrides always beat the selected
config**, most specific scope first — `chat > user > instance > preset`. That flip
forced a conflation into the open: world.ts projects *system-settings defaults*
(legacy layer) at what used to be `instance`, and those genuinely belong **below**
the config. They are now the sixth scope, **`defaults`** — values a host projects
rather than values anyone decided, present in no write matrix row. The migration's
instance rows stay at `instance`: they carry only values the admin had deliberately
changed from column defaults, which are decisions, not projections. Panel and
runtime resolve in the same order by construction (the panel comments name the SDK
constant), and `worldPipelineLayer.int.test.ts` is the proof the selected config
still beats the projected defaults.

**Descriptions, authored and delivered.** The core contracts now carry
`description` text on the panel-visible parameters and slots (history limit and
weights, lorebook scanning, retrieval windows and the semantic-ranking constants,
assembly budget and post-history behaviour, generation stop sequences, connection/
sampling slots, the synthesized Review option). Display text is stripped from the
type content hash — and that promise is only kept if rows pick up rewording, so
`syncTypeRegistry` now refreshes a row's stored `slots` in place when the hash is
unchanged but the serialized declarations differ. A description authored after
1.0.0 shipped reaches installs whose rows predate it, with no version bump.

**The layout pass.** One card per step with an ordinal chip, numbered over the
*rendered* cards so a non-admin's single prompts card says 1 and not 3; Advanced as
a collapsed, left-ruled group inside the card; descriptions under their controls; a
read-only "View text" expander on shipped prompts (the one question a dropdown
cannot answer is what the prompt actually says); and typed inputs routed through
the drafts map, cleared on every fresh view, so a value the chain resolves
differently — or a write that lands under something above it — reconciles the box
instead of leaving the typed number on screen.

### §26b. The editor is the control, and what the empty boxes were

The prompt selector became a dropdown *plus a permanent editor*: one labelled box
per declared field, filled from the selected row, with Save/Cancel appearing only
once something is typed. A prompt's wording **is** the setting, so a dropdown onto
text nobody can see was half a control — and the pencil that revealed it was a
click most people never made. A shipped prompt shows the same boxes, read-only,
with Duplicate as the way in; drafts are keyed to the prompt row they were opened
against, so text typed for one prompt can never be saved onto another.

Template slots moved into **Advanced**. They were rendering as unlabelled empty
textareas beside the prompt — the panel's most confusing square inch, and the
question that prompted this pass ("not sure what the textareas are for"). A
template is the *rendering* of a step rather than a decision about it, and an
empty one is not an unset setting: it means the step renders with its built-in
wording, which the placeholder now says outright. All five panel-visible template
slots carry descriptions naming what they render — message, lorebook entry,
retrieved entry, the story string, the wire wrapper.

## §27. Context variables: presentation as a swappable entity

A context template could say *whether* characters appear and *where*. It had no say
in what they looked like, because `templateContext.ts` handed it a string that
`JSON.stringify(x, null, 2)` had already produced. "Render my characters as prose"
was a code change.

**The inversion.** `build-template-context@1` gains a `variables` slot whose
`renders` map names, per key, which registered context variable it produces —
`{ characters: 'core:var/characters@1' }`. Each key becomes one addressable
setting pointing at a row in `pipeline_variable_templates`, selected exactly the
way a prompt is. The registry (`sdk/src/variables.ts`) carries each variable's
label, description, declared `scope` and a `sample`, which is what finally gives
the long-inert `SlotDecl.variables` field a sibling that does something: the
"pass expected shapes down to the configuration" half of the ruling.

**Keyed by the variable, not the spec — and this is the whole feature.** A prompt
is namespaced to a pipeline because a chat reply's wording has no business in a
summarizer's picker. A *rendering* is the opposite: it is a statement about
characters, not about which pipeline asked for them. So the row names the variable
and selection is checked against that and nothing else. Write one prose layout
while configuring replies, select the same row from narration. A `promptInSpec`-shaped
check copied here would compile, pass review, and silently delete the reason the
table exists — which is why `variableTemplates.int.test.ts` asserts the reuse
directly, and why the module header says so above the code.

**Byte parity is the gate.** Every shipped layout reproduces the TypeScript it
replaced, indentation included: `{{{json characters 2}}}` for the 2-space blobs,
`{{{instructions}}}` for the passthroughs. The JSON shape is not a shortcut anyone
drifted into — it was A/B tested against prose before 0.1.0 and measurably improved
how reliably models hold a character — so prose is opt-in and the shipped rows are
immutable. A new `json` helper (`{{{json v n}}}`, SafeString because escaping is on
in the render path) is registered once in `contextHandlebarsHelpers.ts`, which every
renderer already routes through.

**The code default is the floor.** No layout, an empty source, a dangling id, a
disabled plugin — all fall through to the in-code expression, so a customization is
the most any of them can cost. A layout that *is* selected and throws refuses
instead, naming the variable: falling back silently there would leave the panel
showing one thing while the prompt contained another.

**What the corpus does not cover, stated rather than assumed.** The nine-fixture
byte-parity harness calls `buildWorld` with no `specId`, so `applyPipelineLayer`
never runs and every fixture exercises the *floor*. Measured, not reasoned about:
changing the shipped characters layout to indent 4 leaves the entire corpus green.
So the corpus proves the floor; `variableTemplates.parity.test.ts` proves the
shipped rows agree with it. The line is written into both files, because a gate
that looks broader than it is is worse than a narrow one.

**Two guards this pass added, both from failures rather than review.**
`registryHashes.test.ts` pins every published type's content hash: a descriptor
change without a re-projection migration made `bootstrapPipelines` catch
`TypeRegistryConflictError` and return early, so pipelines stopped with nothing on
screen but a diagnostics line — and nothing caught it. And `asWritten` now coerces
the way Handlebars does (`v == null ? "" : String(v)`) rather than
`typeof v === 'string'`; the narrow version passed every realistic input, and would
have diverged from its own shipped layout the day an upstream node emitted an array.

**Admin-only for 0.6**, on the same line §26 drew for everything but prompts: two
users whose characters render differently are two users whose reports cannot be
compared. Flipping it later is three lines.

### §27a. Assemble's three, and what upgrading exposed

`assemble@2` declares its own `variables` slot — `worldLore`, `history`,
`currentDate` — rather than folding them in with the cast. They belong here
because they come out the other side of the budget: what a layout receives is
what actually *fit*, and no earlier node knows the answer. Two `variables` slots
on one pipeline, one per producing node, which is the same shape the config layer
already handles for `prompts`.

`characterLore` is deliberately not among them. It is a top-level value on the
assembly context that **no template renders**: lore bound to a character is folded
into that character inside `characters` under an `"extra lore"` key, which
`docs/context-configs.md` states outright. A layout for it would be a setting that
changes nothing, which is worse than the vestigial array it would configure.

Their shipped layouts are **minified** — `{{{json worldLore 0}}}`, not the 2-space
form the cast blobs use — because that is what `JSON.stringify(obj)` produced.
The one behaviour change is that an empty set now resolves to `""` rather than
`undefined`, and it is byte-neutral for the reason the builders return `undefined`
in the first place: `{{#if worldLore}}` skips on both, and `{{{worldLore}}}`
renders nothing for both.

**What only an upgrade could show.** Booting the new build against a database
seeded by the old one put "— Pipeline Default —" above output that plainly had a
layout. A reference slot has no author default — the value is a row, not a literal
— so `reconcileConfigs` back-filled the newly declared addresses from
`d.authorDefault`, found `undefined`, and skipped every one. On a fresh install
nothing showed, because `ensureDefaultConfig` writes them. The fix is a shared
`refDefaults` both callers read, so "what core ships for this reference" has one
definition rather than two that drift; the same hole existed for `prompts-ref` and
had simply never been reachable, since prompts shipped with the config layer.

The general lesson is the one the parity corpus keeps teaching in different
clothes: a test that only ever runs against a fresh database cannot see the class
of bug that lives in the difference between two schemas.

### §27b. Retiring the prompt aliases

Spec 1.1.0 made assembly and the provider read the context node's prompts **by
reference**, closing 13 §12 finding i. What it did not do is retire the two field
names that defect had required: `seedPrompts.ts` and `migrateLegacy.ts` kept
writing `system` and `postHistory` alongside `systemPrompt` and
`postHistoryInstructions`, so every seeded row carried the same two texts twice.

Nothing declared those names any more, so nothing resolved them — but the panel's
prompt editor renders **one box per key in the row**, not per declared field. A
user opening a shipped prompt saw five boxes where the pipeline reads three, with
nothing to say which two were inert. That is the shape of defect this whole layer
exists to prevent: an edit that stores cleanly and does nothing.

Three parts, and the third is the one that is easy to forget. Removing the aliases
from the two writers fixes only fresh installs, because **both are insert-only by
seed key** — deliberately, so a row a user edited stays theirs. Migration `0110`
is what reaches rows already written. It is scoped to the two namespaces that ever
had the aliases: the summarize namespaces use their own field names, nothing stops
a future node from declaring a field genuinely called `system`, and an unscoped
`- 'system'` would delete authored text with no trace. Mutation-tested by widening
it to `WHERE 1 = 1`, which turns that assertion red.

The first part was aligning `parity.ts` with the document it mirrors. Its assemble
nodes still used a bare `slot.prompts()`, addressing *their own* slot — which
`world.ts` has not written since the double-write was retired, so it resolved to
`{}` and the corpus stayed green because the shipped template takes its text from
the template context. A harness that has drifted from the spec it exists to
mirror keeps passing while proving less than it claims, and that is not something
its own green suite can tell you.

### §27c. Preview and lint, read from the declarations

Moving the context template into its own table left the new editors less capable
than the archived ones they replaced: a plain textarea, no preview, no lint. That
matters more here than it did for `context_configs`, because a **layout** can be
syntactically fine and render nothing — `{{#each character}}` over a scope keyed
`characters` produces an empty string with no error anywhere, and the first sign
of it is a reply with no cast in it.

Three lists used to have to agree whenever a variable was added, with nothing
connecting them: `TemplateContext`, the linter's `KNOWN_TOP_LEVEL_FIELDS`, and
`mockTemplateContext`. They did not stay in agreement. `speakerRelationships` was
added to the type and not the linter, so the editor reported "isn't a recognized
field" **against the shipped default template**; the preview drifted more quietly,
rendering `worldLore` as an array of objects at indent 2 where the real path emits
a keyed object, minified — a shape no prompt has ever contained.

All three now read the **variable registry**. `pipelines/preview.ts` renders each
declared `sample` through the layouts in force, so the two previews compose; the
linter's vocabulary is the declared scope keys plus a short list of genuinely
structural names (the message loop, the macro scalars); and
`lintVariableTemplate` lints one layout against *its own* variable's scope rather
than the whole context vocabulary, which is what catches the singular/plural slip.
`mockTemplateContext.ts` and `previewCompiler.ts` are deleted rather than synced.

The archived editor previews against the **bare** layouts, because that is what
its rows are pinned to — previewing it through the wrapped defaults would show
every block twice-wrapped, a bug existing only in the preview.

Writing the samples turned up the same defect one level down: `characterNames`
was declared as `['Ash', 'Brannoc']` when `joinWithAnd` has already made it a
string by the time a layout sees it. Same class of lie, in the file written to
end it.

### §27d. The relationships block, finally wired

`speakerRelationships` was supplied by no spec. The legacy path always set it —
`generateResponse.ts` puts `buildGraphContext`'s summary on the adapter — so a
user with the narrative graph on **lost the block by moving to pipelines**. A
missing feature rather than a changed one, which is why it lands as spec 1.4.0.

It arrives as `core:query/graph-context@1`: a Query, because it is a read and a
Task is handed no services (F11), and its own node so it appears on the receipt —
a block in the prompt that no receipt could account for was the argument against
folding it into the context builder. Empty is normal, not a halt: an install that
never opened the graph has no relationships and the template's `{{#if}}` skips it.

The value is **already a JSON string** — `buildGraphContext` stringifies at indent
1 — so its layout is a passthrough plus the heading and fence, not a
`{{{json …}}}`. The plan for this feature guessed the latter, which would have
double-encoded the block. With the variable wired, the wrapper the 0.6 template
was still carrying as the one deliberate exception moved into its layout, and that
template is now structure throughout.

### §27e. Two transforms the pipeline path never did

Mapping `promptBuilder/` to plan the legacy deletion turned up something that
was not about deletion at all. `populateLorebookEntryBindings` is called from
**only** the two legacy infill engines, and nothing under `pipelines/` calls it —
so since the pipeline began compiling every reply, lore entries have received
neither of the two transforms it performs:

- **`@@` decorator lines reached models as literal text**, while
  `handlebarsLint.ts` tells users they are "stripped from the rendered prompt".
  The still-legacy token-count preview *did* strip them, so the number on screen
  and the prompt actually sent disagreed on any chat using one.
- **`{{char:1}}` binding placeholders arrived unsubstituted.**

Both are now applied at the host read (`lorebook_entries`), on the same argument
the file already makes for honouring `isHidden` there rather than per binding: a
new Query type cannot forget it. The legacy function is **reused, not
reimplemented** — a second definition of "what a lore entry looks like once it is
ready" is the drift this branch keeps finding, and this one would surface as a
prompt difference nobody could localise.

**Why nine fixtures missed it.** The corpus contained no `@@` decorator and no
`{{char:#}}` binding anywhere, so it never exercised either path.
`chat/decorated-lore` now carries both.

**And why the fixture failed in the opposite direction first.** With the pipeline
fixed, the *legacy* side left `{{char:1}}` in. `hydrateChat` loaded
`lorebookBindings: true` where the real legacy path
(`getPromptChatFromDb`) loads `lorebookBindings: { with: { character, persona } }`
— so every binding's `character` was null, the substitution had no name to
resolve, and both sides left the placeholder in and **agreed for the wrong
reason**. A harness that under-hydrates cannot see any behaviour depending on
what it failed to load. That is the third time on this branch the parity
apparatus has been found proving less than it appeared to.

**Still open, and downgraded on inspection.** `isCharacterLoreEntryVisible` — the
only server-side enforcement of "character lore is private self-knowledge" — has
no pipeline equivalent. It is *not* currently a content leak: no spec supplies
`characterLore` to the context node, so the entries render nowhere. They do still
consume ranking budget, which can push world lore out of a prompt. It becomes a
privacy bug the moment character lore is wired into the cards, so it should be
fixed before that happens rather than after.

### §27f. Draining promptBuilder/, steps 1–6

The analysis that mapped this directory found the real blocker is not the
directory at all — it is `BaseConnectionAdapter` constructing a `PromptBuilder`
unconditionally, plus one live socket handler. Everything short of that is
mechanical, and this is that part: six steps, each shipping and reverting on its
own, none needing a decision.

**What moved, and why there rather than into `pipelines/`.**
`InterpolationEngine` and `characterCardMacros` went to `utils/interpolation/`
as a **pair** — the engine is its macros' only importer, and separating them
would silently drop Card V3 macro support. Not into `pipelines/`, because
`sockets/chats.ts` uses the engine for first-message interpolation, a chat-CRUD
feature with no pipeline involvement; filing it under `pipelines/` would force a
non-pipeline consumer to import from there. That consumer reached it through the
**barrel**, which is why a grep for the module path missed it — worth
remembering, since the barrel is what dies.

`ragQuery`, `contextFields`, `PostHistoryContext` (→ `postHistory`),
`ContentProcessors`, `LorebookBindingUtils` (→ `characterLore`) and
`infillTestUtils` (→ `testFixtures`) went into `pipelines/`.
`characterCardDecorators` and `parseSplitChatPrompt` went to `shared/utils/` —
the latter beside `PromptBlockFormatter`, its encode counterpart, which its own
round-trip test already pairs it with. `utils.ts` split; its date helpers became
`pipelines/dateKeys.ts`.

**The direction of borrowing is the point.** Where both halves need something,
the *surviving* half owns the definition and the dying half imports it —
`PRIORITY_SCORE_BONUS`, the context types, `characterLore`. That leaves nothing
to move on the day the engines are deleted. `PRIORITY_SCORE_BONUS` was worth
consolidating on its own terms: `ranking/weights.ts` also hardcoded the same
`0.15` as a literal, so one number had two definitions and the keyword and
semantic arms could drift apart while both looked deliberate.

**Pipeline → promptBuilder production edges: 10 → 0.** The single remaining
reference is `parity.ts`, the migration harness, which dies by construction with
the thing it compares against.

**Three things worth recording.**

A re-export does **not** bind a name locally. It bit twice — once on
`PRIORITY_SCORE_BONUS`, once on the context types — and `tsc` caught it both
times, immediately.

`svelte-check` passed a bare `import "./utils"` referring to a **deleted file**.
Only vitest caught it, as a module-not-found across nine adapter suites. A
side-effect import of a module with no side effects is invisible to the type
checker and to every grep for a named symbol.

`CompiledPrompt` deliberately did **not** move. It is the adapter payload
contract, and `app.d.ts` declares two unrelated ambient globals of that name —
`BaseConnectionAdapter` already aliases around the collision. Repointing it means
touching seven adapters explicitly and never by dropping an import specifier,
since the bare name would then resolve to a global with a *different shape that
still typechecks*, which no test would catch. That belongs with the adapter work
in step 7.

Steps 7–9 remain: severing the adapter's `PromptBuilder` dependency (high churn,
six adapter test files spy on `adapter.promptBuilder.compilePrompt`), wiring the
character-lore visibility gate, and then the deletion itself — which still waits
on what happens to `chats:promptTokenCount` and the RAG diagnostics panel.

### §27g. Steps 7 and 8: the adapter's token config, and the privacy gate

**Role A, severed.** `BaseConnectionAdapter` forwarded `tokenCounter`,
`tokenLimit` and `contextThresholdPercent` straight into `PromptBuilder` and then
read them back through it — so an adapter asking "what is my context limit" went
through the legacy prompt compiler to find out. The adapter owns them now; the
builder is handed a copy for as long as it exists, which is one line that dies
with it.

Assigned at the `super({...})` boundary, deliberately. KoboldCpp, LlamaCpp and
LMStudio do **not** accept these from their callers — they construct their own
and pass them up — so `super()` is the one place every subclass agrees on.
Anywhere else and three adapters would silently hold different values than the
builder does. LMStudio passes `tokenLimit: 0` and sets it later from the API,
so the sequencing is preserved exactly rather than merely approximately.

The analysis predicted this step would touch six adapter test files. It touched
none: those spy on `adapter.promptBuilder.compilePrompt`, which is Role B and
belongs to the deletion commit. Role A came out clean.

**The privacy gate, wired.** `isCharacterLoreEntryVisible` has gated character
lore on the legacy path since it was written, and nothing under `pipelines/`
called it. Since the pipeline compiles every reply, every character's private
self-knowledge has been competing for the same ranking budget as world lore on
every turn — and would have leaked outright the moment character lore was wired
into the cast cards. It now runs at the host read, beside the decorator
stripping, on the argument the file already makes for `isHidden`: a new Query
type cannot forget what the read applies for it.

Worth being exact about the severity, because the first assessment overstated it:
this was **not** a content leak. No spec supplies `characterLore` to the context
node, so the entries rendered nowhere. It was a budget bug that was one wiring
change away from being a privacy bug — which is the argument for fixing it before
that change, not after.

`retrieval.int.test.ts` covers the three branches of the rule (own lore, someone
else's, the narrator's unbound entries) and is mutation-tested: neutralising the
filter turns two of them red. Nothing covered it on the pipeline side before.

### §27h. The debug panel, rebuilt on what the pipeline knows

`chats:promptTokenCount` was the last live consumer of the legacy prompt path —
the number on screen came from a code path that no longer generates any replies.
It now compiles through `runTurn({ preview: true, skipReceipt: true })`, the same
recipe `generateResponse` already uses, so the count reflects the compilation the
next turn will actually perform. `skipReceipt` because it fires on a debounce
while somebody types.

That turned out to be nearly free: `toCompiledPrompt` already supplied every
field the panel read **except `meta.rag`**, with `templateName` and
`truncationReason` as deliberate nulls.

**`meta.rag` was not ported, and that is the substantive decision here.** The
panel read `rag.messages.guaranteed`, `.ragOlder`, `.filledIn`,
`rag.lore.*.{pinned,rag}`, `rag.scores` and `rag.entries`. Every one of those is
a counter for the infill engine's internal *phases* — a guaranteed window, a RAG
pass over older messages, a fill pass. The pipeline has no phases. It scores
candidates, allocates a budget, and records per block why that block is in or
out. Reproducing the old display would have meant inventing values for stages
that do not run.

So `meta.retrieval` reports what exists: every candidate, whether it was kept,
what it cost, and the reasoning trail behind the decision. That answers the
question the panel was built for — *why isn't my lore showing up* — per entry,
rather than by inference from an aggregate. Block `content` is deliberately
excluded: it is already in the prompt the same object carries.

Worth noting how the old section would have failed if left alone. The panel
branches on `rag?.used === true` / `=== false`; an absent `meta.rag` matches
neither, so the whole section would have rendered **blank** — no crash, no
failing test, nothing to notice. It was replaced rather than left to disappear.

`rag` stays declared on the response type until the legacy path is deleted, and
nothing populates it any more.

### §27i. Freezing the gate before deleting what it measured against

The parity corpus is the gate on deleting the legacy path, and it produced its
0.5 side by **running `PromptBuilder`**. So the gate depended on the thing it was
guarding, and step 9 would have deleted the guard along with the guarded.

The 0.5 renders are now **frozen goldens** — one file per fixture under
`parityGoldens/`, captured while the builder still existed. That inverts the
dependency: the corpus keeps gating every future change to the pipeline long
after the legacy path is gone, because the bytes 0.5 produced are recorded rather
than recomputed.

It also closes the last way for the two sides to move together and agree for the
wrong reason. That has happened twice on this branch — a template both sides
read, and a hydration both sides lacked — and each time the corpus stayed green
while proving less than it claimed. A frozen reference cannot drift toward the
thing it is measuring.

Verified three ways before trusting it: captured twice and diffed (byte-identical
across runs, so the fixtures are deterministic), run read-only (all eleven pass),
and mutation-tested against the *floor* — changing `asIndentedJson`'s indent
diverges eleven fixtures at once.

Worth recording the mutation that did **not** fail, because it is the same
distinction §27 already draws and it is easy to re-learn the hard way: changing a
shipped layout's `source` leaves the corpus green. The harness calls `buildWorld`
with no `specId`, so no layout resolves and every fixture renders the in-code
floor. The corpus gates the floor; `variableTemplates.parity.test.ts` gates the
layouts agreeing with it.

**Consequence to accept deliberately:** once the builder is deleted,
`PARITY_CAPTURE=1` cannot run, and adding a new fixture means authoring its
golden from a `v0.5.1-beta` checkout. That is the correct cost — a golden is a
record of what 0.5 did, and rewriting one is rewriting history rather than
updating a snapshot.

### §27j. The deletion

The legacy prompt path is gone: `promptBuilder/` in full — both infill engines,
`BaseInfillEngine`, `NarrativeGraphContext`, `index.ts`, `types.ts` — plus
`compare.ts`, `scripts/compare-prompts.*`, the `pipeline:compare` script, and
`ranking/differential.int.test.ts`, whose entire reference was the engine it
compared against.

`CompiledPrompt` moved to `connectionAdapters/types.ts`, where it always
belonged: it is the adapter payload contract. Repointed by name in all seven
adapters and never by dropping a specifier — `app.d.ts` declares two unrelated
ambient globals of that name, so a dropped specifier resolves to a *different
shape that still typechecks*. `meta.rag` went with the engines; `meta.retrieval`
replaced it.

`BaseConnectionAdapter` no longer constructs anything. `compilePrompt` returns
the injected payload, handles summarizer mode, and otherwise **throws** — an
adapter reaching it without having been handed a prompt is a caller that skipped
`withCompiledPrompt`, and generating from an empty string would read as a model
fault.

**Three things this turned up that the plan did not predict.**

*The RAG corpus nearly lost its reference.* Goldens were frozen first
(§27i) — but the RAG corpus calls `legacyRender` directly rather than going
through `resolveGolden`, so the capture run never wrote its four goldens and the
deletion took the only thing that could produce them. Recovered by restoring the
engines from `HEAD`, re-adding `legacyRender` temporarily, capturing, and
deleting again. The lesson is narrow and worth keeping: freezing a reference
protects only the callers that actually go through the freeze.

*A latent import cycle.* `defaults.ts` imports `db` from `db/index.ts`, which
calls `sync()` back into it at module scope. That only ever worked because some
third module pulled `db` in first — and the legacy builder was that module. With
it gone, any entry reaching `defaults.ts` first hit `db` in its temporal dead
zone. Fixed at the cause: 0.5's frozen template moved to
`db/legacyContextTemplate.ts`, a module with no database import, so wanting the
string no longer means loading the seeder. That also retires the read-the-file-
off-disk trick two tests were using to dodge the same problem.

*An optional enrichment that can fail a turn.* `core:query/graph-context@1` is a
three-layer traversal, and its inherited 2000ms timeout tripped on every run —
then 5000ms tripped under a loaded suite. The number is now 15000, but the real
finding is in the comment: a node whose output the template would happily skip
can currently **halt the run** by being slow. Until a Query can be marked
non-fatal, its timeout is a hang-catcher rather than a latency budget. Worth
fixing properly.

Also corrected while wiring it: `buildGraphContext` read through the module-scope
`db` rather than the one the host was handed, which is precisely the coupling the
host exists to prevent (F19). It takes a connection now.

### §27k. One real reply, and the two bugs it found

Every other check stops at the preview boundary. `liveGeneration.int.test.ts`
runs the whole chain against a real Ollama — bootstrap, config layer, retrieval,
layouts, assembly, the provider call, the consumer that writes the message.
Opt-in behind `LIVE_MODEL=1`, because a suite must not depend on somebody's GPU.

It paid for itself immediately.

**The Ollama adapter sent an empty request.** `compilePrompt` reads
`!!extraJson?.useChat` (default **false**); `generate` read
`extraJson?.useChat ?? true` (default **true**). One setting, two defaults. A
connection whose `extraJson` lacks `useChat` — the column defaults to `{}` — had
a *completion* prompt built and a *chat* request sent, with `messages:
undefined`. Ollama answers that with an empty string, which surfaced as "the
model returned nothing" and reads as a model fault rather than a request built
wrong. `generate` now derives the shape from the payload it was handed, which
cannot disagree with itself.

**A seed line that collides with its own stop string.** Roleplay prompts end
`<Name>: ` and also pass `<Name>:` as a stop string, so a model whose first
emission repeats the speaker's name stops instantly and returns nothing.
Confirmed directly against Ollama: the same prompt yields text with the stop list
removed and `''` with it. Inherited, not introduced — the frozen goldens show 0.5
built the identical seed line — so the test asserts what the pipeline is
answerable for (the chain completed, the provider was reached with a real
payload) and warns rather than fails on an empty completion. Worth fixing on its
own terms; it is a live footgun for anyone whose model echoes the name.

What the run does prove, and nothing before it did: the assembled prompt reaching
a real model is 0.6's — headings and fences supplied by the layout rows, lore
retrieved through the config layer, the whole thing built without a line of the
legacy path, which no longer exists.

### §27l. The speaker never reached the provider

The empty-reply bug §27k left open was not a model quirk after all.

`StopStrings.get` already excludes the speaking character's own name — "skip the
current character to avoid premature stops" — because the prompt seeds
`<Name>: ` and stopping on `<Name>:` would end the reply before it began. On the
legacy path that worked: `generateResponse` set `adapter.currentCharacterId`.

On the pipeline path nothing carried it. `core:provider/generate-text@1` has one
in-port, `context`; the binding reads `input?.currentCharacterId`, which no spec
wires because there is nowhere to wire it. So the adapter was constructed with
`currentCharacterId: null`, the exclusion never fired, `Ash:` went into the stop
list beside the seed line that ends `Ash: `, and any model opening with the
speaker's name returned an empty string. Silent: no error, no halt, just a reply
that never came.

Fixed by carrying it on `HostScope` alongside `chatId` and `userId`, which is
what it is — a property of the run, not of a port. No descriptor change, so no
version bump and no re-projection. The payload's value still wins when a
dispatch-only caller supplies one.

Confirmed against a real model: `Ash:` is gone from the stop list and replies
come back (`" Hello."`, `" Hey."`). The live test now also asserts the stored
message does **not** start with the speaker's name — models echo the seed line,
and a stored `"Ash: Hello."` renders as `Ash: Ash: Hello.` in the chat.

Worth stating what this says about the earlier conclusion. §27k reasoned from the
frozen goldens that the seed line matched 0.5 and called the empty reply
inherited. The prompt *was* at parity; the **stop strings** were not, and the
goldens only record the prompt. A corpus that compares prompts cannot see a
divergence in what is sent alongside them.

### §27m. Optional nodes: failure a run survives

`Descriptor.optional`. A node that declares it turns an `err` — a timeout
included — into an empty `ok`, and the run continues. The case it exists for is
enrichment: the narrative graph's relationship summary is guarded by `{{#if}}`
in the template and worth nothing if it costs somebody their reply. Before this,
`graph-context`'s timeout had to sit at 15s not as a latency budget but because
exceeding it was fatal; it is back to 5s now that exceeding it degrades.

**Tolerated is not hidden.** The receipt keeps `result: 'err'` and the reason,
and adds `recoveredAsEmpty`. A failure nobody can find is worse than one that
stops the run — this branch has spent most of its length on exactly that class of
bug, and the feature would have been a machine for producing more of them.

Deliberately not `halt` or `cancelled`: a halt is a binding stopping on purpose
(a preview, a review gate) and a cancellation is the user. Neither is a failure
to absorb.

**It is part of the hashed contract**, which the first cut got wrong. `optional`
was neither carried into `RegistryEntry` nor hashed, so the flag could be flipped
on a published version and every spec pinning it would keep compiling while
quietly changing what happens on failure — the precise thing the frozen-version
rule exists to prevent. Both fixed, with migration `0112` re-projecting the one
type affected. Only that one: a descriptor leaving the flag unset hashes exactly
as before, because `JSON.stringify` drops undefined keys.

`toggleable`, `declaresRandomness` and `earlyExit` are arguably in the same
category and are still unhashed. Left alone rather than widened in passing — each
deserves its own ruling, and changing them would re-hash types this branch has no
business touching.

Six tests in `sdk-tests/optional-nodes.test.ts`, including the control (the same
failure without the flag still stops the run) and the halt case. Mutation-tested:
inverting the predicate fails four of them.

**One correction to §27k, for the record.** The live test asserted the stored
message does not begin with the speaker's name, and that assertion was wrong for
the path it tested. Models do echo the seed line, and the chat flow strips it —
`generateResponse` builds the same `startString` and removes it before writing.
The live test calls `runTurn` non-preview, so the message is written by the
pipeline's own consumer and never reaches that step. Two write paths, one of
which cleans up after the model. The assertion now claims only what this path can
show, and the difference is left visible rather than papered over.

### §27n. Covering the draft preview, and the regression it exposed

`chats:promptTokenCount` shipped on the strength of "it reuses a recipe proven
elsewhere" — inference, not coverage. `promptTokenCount.int.test.ts` is the
coverage: the handler runs, returns a prompt built by the pipeline (checked by a
heading that can only come from a layout row), counts against a real budget,
carries `meta.retrieval`, and writes nothing.

Six tests, and the sixth failed immediately — on a regression the rewrite had
introduced and nobody had noticed.

**The draft was missing from the draft preview.** The old handler hydrated
`messagesWithDraft` and handed it to the adapter, so the count included the text
being typed. The rewrite reads history from the database through the pipeline,
and the draft is deliberately not a row — so the preview counted the conversation
*without* the message it was previewing. The `text` argument reaches
`$.input.text`, which feeds lorebook trigger scanning, so keyword matching still
saw it; the rendered message list did not. Exactly the kind of half-working that
survives a review.

Fixed with `HostScope.draftMessage`, appended by the `chat_messages` read. On the
scope rather than a port because the *turn* never needs it — by then the user's
message has been written — and in the read rather than in a binding so every
Query that reads history sees the same conversation. Splitting it would leave
retrieval scoring against a message the renderer shows, or the reverse.

Mutation-tested: disabling the append fails that test alone.

### §27o. Upgrade drift: core's rows are refreshed, not preserved

The pipeline seeders were **insert-only by seed key**, which meant a shipped
layout could never be corrected once an install had booted. A fresh install got
the new source; every upgraded one kept the old row forever. Two installs, the
same settings, different prompts, and nothing anywhere to show why.

Nothing could catch it either. The seed-vs-constant check in `productionParity`
compares the database to the code — against a database seeded moments earlier *by
that code*. The only shape the bug has is a stale row, and no test had one.

`db/defaults.ts` had already settled the rule for core's other seeded rows:
match on `seedKey`, which is NULL for anything a user made, so a user's row can
never be mistaken for a seed. The pipeline seeders had diverged from it. They now
refresh core's `pipeline_variable_templates` and `pipeline_context_templates`
rows when the stored source differs from the code, and report it as `refreshed`.

Safe because these rows are `isImmutable`: their content is determined entirely
by code, so a stale copy protects nothing. A clone the user made is mutable,
carries no seed key, and is untouched — asserted directly, because overwriting
somebody's prose layout on upgrade would be far worse than the drift it fixes.

**A wrinkle left open, deliberately.** `seedKeyFor` includes the row's *name*, so
renaming a shipped layout produces a different key and lands as a new row,
orphaning the old one. The refresh cannot paper over that; changing the key
scheme now would orphan every existing row. Its own fix, another day.

Four tests, against a *stale* row rather than a fresh one, and mutation-tested:
disabling the comparison fails the refresh case alone.
