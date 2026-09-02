# Variable schemas, and layouts you can actually author

## What is wrong today

A shipped layout for `characters` is this:

```handlebars
Assistant Characters (AI-controlled):
```json
{{{json characters 2}}}
```​
```

`{{{json characters 2}}}` hands the whole array to `JSON.stringify`. The admin
gets no say over which fields appear, what they are called, or how they nest.
"Drop `exampleDialogue` from the block" and "rename `nickname` to `alias`" are
both code changes, which is the exact inversion the variable-layout feature was
supposed to end — it moved *presentation* into data and left *structure* in
TypeScript.

The registry already knows more than the editor uses. `VariableDecl.scope` is:

```ts
export type TemplateScope = Record<string, 'any' | string[]>
```

so `characters` declares `['name', 'nickname', 'description', 'personality',
'exampleDialogue', 'lore']` — field *names*, nothing else. No types, no nesting,
no per-field description. `checkTemplate` validates only `ref.root`, so
`{{ this.nickanme }}` inside an `{{#each}}` is not caught. An editor built on
this can offer a list of six words and no more.

## What this changes

1. `TemplateScope` becomes a real schema — types, nesting, descriptions.
2. Shipped layouts become **explicit** structures that name every key, so the
   default is something you can edit rather than a black box.
3. The layout editor reads the schema of the variable *that node declares* and
   offers completions, hover text and real lint.
4. `review` drops `async`.

## Decisions to ratify

| Decision | Recommendation |
|---|---|
| Custom shapes in custom nodes | **A node that produces a different shape declares a different variable id.** No new mechanism — see below. |
| Byte parity of shipped layouts | **Keep it, and prove it.** The explicit templates must render byte-identical to today's `JSON.stringify`. This is the main risk in the whole plan. |
| Schema authoring | **Structural, not JSON Schema.** A small closed vocabulary the editor can walk; JSON Schema is a spec to implement and 90% unused here. |
| `review: 'async'` | **Remove.** Nobody could name a use for it. |

## Custom shapes need no new mechanism

> Someone might assemble custom shapes with the same data in a custom pipeline
> node, i.e. combining relationships inside of characters, so the available
> variable template for a pipeline's config should reflect that explicitly.

This already falls out of the existing design, and it is worth being explicit
that it does:

- A node declares what it renders: `renders: { characters: 'core:var/characters@1' }`.
- Layout rows are keyed by **variable id**, not by spec — that is the
  cross-pipeline reuse feature.
- `choicesFor` already narrows the picker to rows matching the decl's
  `variableId`.

So a plugin node that folds relationships into characters declares
`acme:var/characters-with-relations@1`, with its own schema and its own sample.
It automatically gets its own layout pool, its own completions, and its own
lint — and core's `characters` layouts are correctly *not* offered for it,
because they would render against a shape that no longer matches.

This is the same ruling as the narrator split: **a different configurable shape
is a different type.** It needs no `renders` override and no per-slot schema
patch, both of which would let a registry row claim one shape while the running
node produced another.

The one thing to add is a publish-time check: if a node's `renders` names a
variable the registry does not have, that is an install-time refusal, not a
blank editor.

## The schema

```ts
export type VarType =
  | 'string' | 'number' | 'boolean'
  | 'object'                                  // fields
  | 'list'                                    // of
  | 'record'                                  // keyed by author-chosen strings, of

export interface VarField {
  type: VarType
  /** Shown in the editor's completion list and on hover. */
  description?: I18n
  /** `object` — the fields it carries. */
  fields?: Record<string, VarField>
  /** `list` / `record` — the shape of each entry. */
  of?: VarField
  /** Present on some rows and not others; the editor stops promising it. */
  optional?: boolean
}

export type TemplateScope = Record<string, VarField>
```

`characters` then declares:

```ts
scope: {
  characters: {
    type: 'list',
    of: {
      type: 'object',
      fields: {
        name: { type: 'string' },
        nickname: { type: 'string', optional: true },
        description: { type: 'string' },
        personality: { type: 'string', optional: true },
        'extra lore': {
          type: 'record',
          of: { type: 'string' },
          optional: true,
          description: { en: 'Lore bound to this character, keyed by entry name.' },
        },
      },
    },
  },
}
```

Note what is **not** in that list, because the sketch this replaced had both
wrong and they are the lies slice 1 actually caught — see below. There is no
`lore` field (the key is `"extra lore"`, with the space) and no
`exampleDialogue` field at all.

`worldLore` stops being `'any'` and becomes
`{ type: 'record', of: { type: 'string' } }` — which is what it has always been,
and what the old `'any'` could not say.

**Migration of the declaration form.** `'any'` stays valid and means "unchecked",
so every existing declaration keeps working and plugins are not broken by the
upgrade. `string[]` is accepted and read as an object with those field names,
untyped. Both are legacy forms that lint can nudge, not errors.

## Authoring a layout: two modes over one artifact

`{{{json characters 2}}}` is a black box, and replacing it with hand-written
Handlebars only trades one barrier for another — now you write JSON correctly by
hand, commas and all. The schema makes something better possible, and there are
two ways people actually want to author these, so there are two modes.

**Both edit the same thing.** The stored row is Handlebars source, exactly as
today. Shape mode is a *view* over that source, not a second storage format —
which is what keeps the two from drifting and means nothing new has to be
stored, migrated, or kept in step.

### Shape mode — build it

The variable's schema as a tree, where the author

- **toggles fields** on and off — the checkbox *is* "which properties are wanted";
- **renames the output key** inline, so `nickname → alias` is a text input;
- **reorders** by drag, because key order is visible in the prompt;
- **nests and lifts** — pull `lore` up to the top level, or fold a sibling
  variable in, which is the "combining relationships inside of characters" case
  as configuration rather than a custom node;
- **switches a branch to prose** — see below. A field set is not always the
  right answer, and the tree should not pretend it is.

### Text mode — write it

One rich editor, used for both free-form Handlebars and prose, because they are
the same thing at different densities: prose with property references *is*
Handlebars. What makes it worth using is that the schema is behind it.

- **Completion** on `{{` and on `.`, context-aware: inside
  `{{#each characters}}` it offers that item's fields, at the root it offers the
  declared variables.
- **Property references render as inline chips** rather than raw braces — the
  name, and its type on hover. A valid reference reads as part of the sentence;
  an unknown one does not.
- **Errors inline.** `{{ this.nickanme }}` gets an underline and
  *"did you mean `nickname`?"*, which today's root-only `checkTemplate` cannot
  produce at all.
- **Optionality is visible.** A field marked `optional` is chipped differently,
  because "sometimes empty" is the difference between a clean prompt and a
  dangling colon.

Prose is a first-class outcome, not a fallback. The JSON shape is the default
because it was A/B tested and measurably improved how reliably models hold a
character — but that finding is about *characters*, and someone writing a
narrator's world lore as sentences should get the same help writing it.

### Moving between them

- **Shape → Text** is always available: it generates the source and hands it
  over.
- **Text → Shape** works when the source is something the tree can round-trip.
  When it is not, the row stays in Text mode and says so, plainly, rather than
  offering a tree that would silently discard the edit.

That rule is what makes the escape hatch safe to use. Hand-authored work is
never at risk of being flattened by a mode switch.

### What "beautiful" has to mean here

Concretely, not decoratively:

- **The preview is always on**, beside the editor, rendered from the
  declaration's `sample`. No chat needed, updating as you type — that is what
  `sample` exists for.
- **One colour vocabulary**, shared with the ranking bar: a colour per type, so
  a `record` reads the same in the tree, the chips, and the preview.
- **The switch between modes is a real transition**, not a remount — the same
  content, re-presented. If it flickers or scrolls to the top it will feel like
  losing your place, and people will stop using Shape mode.
- **Nothing is modal.** Toggling a field updates the preview in place; there is
  no Apply.

## Shipped layouts become explicit

The default for `characters` stops being `{{{json characters 2}}}` and becomes a
template that names every key:

```handlebars
Assistant Characters (AI-controlled):
```json
[
{{#each characters}}  {
    "name": {{{jsonValue name}}},
    "description": {{{jsonValue description}}}{{#if lore}},
    "lore": {{{jsonValue lore 4}}}{{/if}}
  }{{#unless @last}},{{/unless}}
{{/each}}]
```​

Now "drop personality" is a deletion and "rename to alias" is a rename.

This needs one new helper, `jsonValue` — `JSON.stringify` of a *single* value
with correct escaping and optional indent, returning a `SafeString`. `json`
stays for whole-object rendering and for anyone who wants it.

### The risk, stated plainly

**These templates must produce bytes identical to `JSON.stringify(x, null, 2)`,
and that is fiddly.** Key order, two-space indent, where the newlines fall,
`{{#unless @last}}` commas, and the empty-array case all have to be exactly
right. The parity corpus and `variableTemplates.parity.test.ts` are what make
this tractable rather than a guess — the second one asserts the seeded row and
the code default produce the same string, so a mismatch fails at once.

If a given variable turns out not to be expressible byte-identically, the answer
is to ship *both*: the explicit template as the editable default for new
installs, and the `{{{json …}}}` one retained as the parity floor. Better two
honest rows than one template that is 99% right.

## The editor

Given a schema, the layout editor can:

- **Complete** — inside `{{#each characters}}`, offer `name`, `description`,
  `lore`; at the root, offer the declared variables. Handlebars block context is
  trackable well enough for this without a full parser: track `{{#each x}}` /
  `{{#with x}}` and pop on `{{/…}}`.
- **Describe** — the `description` on a field, on hover and in the completion
  list. This is where "what *is* `nickname`" gets answered.
- **Lint properly** — `checkTemplate` currently validates roots only. With a
  schema it can validate paths, so `{{ this.nickanme }}` is caught with a
  "did you mean `nickname`" fix.
- **Preview live** — already possible via `sample`; the schema makes the sample
  checkable against its own declaration so the two cannot drift.

Scope note: completions and path lint are the valuable half. Hover text is
cheap once the schema is there. Anything resembling a full Handlebars language
service is out of scope.

## Review: on / off

`async` means "do it and record it for review afterwards". Nobody could name a
case: a graph proposal must never auto-apply, and a review record per generated
message is noise. It is spec residue.

- SDK: `reviewDefault` and the review setting become `'off' | 'on'`; `'on'` is
  today's `sync`.
- Registry: `effects`-derived review decl offers two values, not three.
- Migration: rewrite stored `'sync'` → `'on'`, and `'async'` → `'on'`, because
  someone who asked for review should keep getting it.
- The executor's async branch goes.

This is small and independent — it can land first or last.

## Ranking: shares, not a budget

`rank-hybrid` declares exactly one setting:

```ts
const rankSlots = {
  params: { kind: 'parameters', facet: 'weights',
    schema: { budget: { type: 'integer', default: 4096,
      description: 'Token budget the ranked context is trimmed to fit.' } } },
}
```

An absolute token count is the wrong control twice over.

**It duplicates a number the system already knows.** The context window rides
along on the selected sampling config, so a hardcoded `4096` can silently
disagree with the model actually being called — larger and the prompt is
truncated by the provider, smaller and most of the window goes unused. Nothing
warns either way.

**It answers the wrong question.** Nobody wants to say "trim to 4096". They want
to say "lore matters more than old history in this chat, and never drop the last
six messages".

**The model for this already exists and has never been wired up.**
`ranking/weights.ts` carries it in full — and the docstring on `SourceKind` says
*"A slider exists per entry here."*

```ts
export type SourceKind =
  'messages' | 'worldLore' | 'characterLore' | 'history' | 'relationships'

export interface GroupWeights {
  /** Relative importance. Normalised, so only the ratios matter. */
  share: Record<SourceKind, number>
  /** Most entries a source may contribute. */
  maxEntries: Record<SourceKind, number>
  /** Tokens guaranteed to messages regardless of share. */
  minMessageTokens: number
}
```

`share` is normalised, which is exactly a percentage split, and
`DEFAULT_GROUPS` already reproduces today's behaviour — 0.5 to messages and 0.5
across lore is `MESSAGE_FILL_FRACTION` exactly. So this is wiring up a designed
model, not inventing one, and the defaults are behaviour-preserving by
construction.

### What replaces the number

- **One stacked bar, colour-coded per source**, showing what fraction of the
  context each gets. Dragging a divider moves share between neighbours; the
  total is always 100% because `share` is normalised, so there is no invalid
  state to validate or explain.
- **A toggle per source** — off is `share: 0`, which the model already expresses,
  so switching relationships off needs no new concept.
- **A floor per source** — "never drop the last six messages". `minMessageTokens`
  generalises to `minInclude` per source, which `RetrievalParams` already has
  for the keyword arm.
- **A ceiling per source** — `maxEntries`, already there.
- **The real window, shown, not typed.** The bar is a percentage *of the
  connection's context window*, read from the sampling config rather than
  re-entered. Absolute token counts become a readout beside each band, so you
  can see what 30% actually buys.

### Two things this needs from the SDK

Both follow the rule that every string comes from the schema:

1. **A parameter kind for a normalised share set** — the current `ParamDecl`
   vocabulary is integer / number / boolean / enum / string, none of which can
   say "these five values are one normalised group". Without it the client has
   to know that `share.messages` and `share.worldLore` belong to the same bar,
   which is exactly the invented knowledge the 1:1 rule forbids.
2. **Names, descriptions and colours per `SourceKind`, declared** — the bar needs
   a label and a colour per band, and neither may be written in the client. A
   plugin adding a sixth source must get a band without touching this screen.

## The shape the pipeline should have

> Input → Prompts → Query → Templates → Generate → Consume

Chat reply is eleven nodes today, and the reason it is confusing is that three
of them are the same concern cut into pieces:

| today | becomes | why |
|---|---|---|
| `input` | **Input** | unchanged |
| — | **Prompts** | the authored text, its own node, before anything renders |
| `history` + `lore` + `cast` + `relationships` + `rank` | **Query** | *"chat history and querying and weighing other context values is the same thing"* |
| `context` + `lines` + `prompt` | **Templates** | *"context templates, variable templates belong together"* |
| `generate` | **Generate** | unchanged |
| `save` | **Consume** | unchanged |

### Why the merges are right, not just fewer boxes

**Query.** Retrieving and weighing are one decision. Splitting them puts
`scanDepth` on one step and the share it competes for on another, so tuning
retrieval means editing two places that only make sense together — and the
ranking node has to be told, separately, about sources it did not fetch. One
node, one set of sources, one bar. It also makes the shares of slice 6 local to
the node that produces the candidates they weigh.

**Templates.** A context template decides placement and a variable template
decides presentation, and today they sit on different nodes because assembly
lays out lore *after* budgeting. That is an implementation fact, not a
distinction anyone configuring a prompt has. Putting them together also gives
the shape builder one home rather than two.

**Prompts.** Authored text is not a rendering step, and it currently rides on
the context builder — which is why the shared-slot `slot.prompts({ node })`
plumbing exists at all. Its own node makes the reference natural rather than a
workaround, and it reads in the order people think: *what am I telling the
model, then what do I give it, then how is it laid out.*

### What this costs

A new major version of every affected spec, new node types in contracts, new
bindings, a registry re-projection, and `reconcileConfigs` carrying values
across a node-key change — which is the part with teeth, because a value keyed
`rank/params/budget` has to find its way to `query/params/share` or be culled
with a notice rather than vanish.

It is also the change that makes the flow map worth drawing: six nodes with a
real branch structure is legible, eleven with three of them invisible is not.

### Sequencing

**After** the schema and editor work (slices 1–3b), and probably after 6. Those
change what a node *declares*; this changes which node declares it. Doing the
restructure first would mean writing the new nodes against the schema shape
twice.

## The flow is a map, not a list

The builder draws one card per node in `position` order, top to bottom. That is
wrong for every pipeline that is not a straight line, and none of the
interesting ones are: respond's four queries run concurrently, the graph builder
fans out across five providers, and summarize maps over batches.

**The data is already there.** Nothing needs inventing:

| what | where |
|---|---|
| the wiring | `pipeline_edges` — `fromNodeId`, `fromPort`, `toNodeId` |
| grouping | `pipeline_nodes.blockId`, `blockChain` |
| the kind of group | `pipeline_nodes.blockKind` — and the SDK's `BlockKind` is already exactly `'async' \| 'map' \| 'loop'` |
| what a node is | `pipeline_nodes.kind` — `input`/`query`/`task`/`provider`/`consumer` |
| optionality | `toggleable`, `enabledDefault` |

The builder does not receive any of it. `pipelines:get` sends `steps[]`,
flattened and ordered by position, because the *sidebar* must not know topology
(05 §0a). The builder may — it is the structural view — so this is a second,
richer payload for that screen rather than a change to the existing one.

What it should draw:

- **linear progression** — a straight arrow down (or right) between consecutive
  nodes;
- **`async`** — the members side by side, with the flow splitting into them and
  rejoining after: curved out, curved back;
- **`map`** — fan-out over a collection, drawn as a stack with a single arrow in
  and out, labelled with what it maps over;
- **`loop`** — a curved return arrow from the block's end to its start;
- **a disabled/toggleable node** — visibly optional rather than absent.

Selecting a node still drives the inspector; the map replaces the list, not the
split.

## The 1:1 rule

> It should be a 1 to 1 match per node vs what the pipeline represents. The only
> place a config should arbitrarily display configs differently is in the
> pipelines sidebar.

Two things in the builder currently break this and are fixed as part of this
work:

1. **Facet labels are invented in the client.** `FACET_GROUPS` maps
   `weights → "Tuning"` and `connection + sampling → "Model"`. Those names exist
   nowhere in the SDK. The facet is declared on the slot, so the *label* must
   come from the SDK too — an `i18n` on the facet — and the builder renders what
   the descriptor says, in declaration order.
2. **Merging two facets into one group.** `connection` and `sampling` are
   separate slots; the builder shows them under one invented heading. It should
   show them as declared.

A third, broader: **every string on this screen must come from the SDK.** Not
just facet labels — the node's name, its description, the name of a slot, the
kind of connection a provider wants. Where the screen needs a word the schema
does not have, the fix is to add it to the schema, not to write it in the
client. A provider that takes a text-generation connection should say so
*because its slot declares that connection type*, not because the page knows
that providers usually do.

That rule is what keeps a plugin's node from rendering as a box of blanks beside
core's, and it is the same argument that made `RegistryEntry.slots` carry the
declaration rather than a list of names.

The sidebar keeps its licence to reorganise, including its consumer-then-facet
grouping and its single tuning drawer.

## Slices

Each is independently shippable.

**0 — review on/off.** SDK, contracts, registry re-projection, data migration,
executor, panel. Small, self-contained, unblocks nothing but removes a control
that should not be on screen while we redesign around it.

**1 — the schema type. Done.** `VarField`, `TemplateScope` widened, `'any'`
and `string[]` still accepted. Core's **twelve** variables (not ten) re-declared
with real schemas. `checkTemplate` still root-only.

It caught exactly the one or two lies it was predicted to, both in
`characters`, and both of the kind that renders empty rather than failing:

- **`lore` does not exist.** `attachCharacterLoreToCharacters` writes the key
  `"extra lore"`, with a space. A layout reaching for `this.lore` rendered
  nothing, and nothing is indistinguishable from "this character has no bound
  lore" — so for the life of the registry the bug looked like data.
- **`exampleDialogue` is not a character field.** It is a top-level variable
  resolved from the *speaking* character; `compileCharacter` never puts it on a
  card. The declaration promised a per-character field that has never existed.

Both were also in the declaration's `sample`, which is why they survived: the
preview rendered them, so the editor agreed with the declaration and only a
real chat disagreed. Two further corrections fell out — every field but `name`
is optional (`compileCharacter` deletes nulls so the model never reads
`"personality": null`), and a persona's `description` is optional for the
opposite reason (personas skip that stripping, so the key is present and the
value can be null).

Three things beyond the slice as scoped, each because the verification did not
hold without them:

- `sampleValues` moved into the SDK. The single-key/multi-key convention was
  implemented in the host and needed again by the check; a convention written
  twice eventually holds in one place and not the other.
- The app's "preview supplies every name" test **passed with `sampleValues`
  returning `{}` for every declaration** — a layout renders its heading and
  fences before interpolating, so a vanished sample still comes back defined.
  It asserted `toBeDefined` on the rendered output; it now also checks the
  value going in. That is the precise failure its own comment described.
- `noEmitOnError` is on in `tsconfig.base.json`. Verified from both sides: a
  type error in `contracts/src/index.ts` now blocks the emit, and with the flag
  off the broken symbol reaches `dist` — which is how a stray `)` survived
  hours of green builds during slice 0.

**2 — path lint. Done.** `resolvePath` / `elementOf` in the SDK; the walk turned
on for both the SDK's own `checkTemplate` and the app's layout lint.

The slice as written conflated two template languages. `checkTemplate` is the
SDK's minimal engine and its loops are `{% for %}`; `{{#each}}` / `{{#with}}`
are Handlebars, in the app's `lintContextTemplate`. Both now walk paths, and
both do it through the same `resolvePath`, but they are two callers rather than
one function.

The rule that replaces the old "stop at each/with" is **stop where the schema
stops talking**: `'any'`, a legacy `string[]` past its first segment, a record's
author-chosen key and an unparseable subexpression each yield an *unchecked*
context rather than a guess. That preserves what the old code's comment was
defending — a false "unrecognized" on a legitimately-scoped name is worse than
a missed typo — while letting the checkable cases actually be checked.

Three bugs surfaced, all pre-existing:

- **Every root-level dotted path was flagged.** The lint compared the whole
  expression against a set of *root* names, so `{{postHistory.instructions}}`
  and `{{chatMessages.0.message}}` both reported "isn't a recognized field at
  this scope" against perfectly valid Handlebars.
- **Nested loops errored in the SDK.** `extractRefs` recorded every loop
  *source* as unbound, so `{% for l in c.lore %}` reported `'c' is not
  available to this template` — the thing being iterated is itself a loop
  variable and nothing said so.
- **Inline mustaches were never linted at all.** The parser only makes a
  variable card for a mustache alone on its own line; an inline one —
  `{{{name}}}: {{{message}}}`, the parser's own example — is part of the
  surrounding text. A presentation decision was silently deciding what got
  checked, and it excluded most of the body of every single-line `{{#each}}`.

Also extended: a helper's path arguments are checked, so `{{{json characterz
2}}}` is caught. Every shipped layout is of that exact form, and the old
`/\s/` bail meant not one of them was ever linted.

Guard against the false-positive direction: every shipped variable layout and
the shipped context template must lint clean, asserted as tests.

**3 — Text mode. Done, minus the chips.** `templateAssist.ts`: context-aware
completions, the type under the caret, and `suggest` — appended to lint findings
as *did you mean "nickname"?* wherever the nearest name is near enough to be
almost certainly right. `TemplateEditor.svelte` wires all three into the layout
editor **and** the context-template editor, computed locally: a completion list
that arrives after a network hop is one nobody waits for.

Context tracking deliberately does **not** reuse `parseContextTemplate`. That
runs the real Handlebars parser, which needs a complete template — and
half-typed source, the only kind an editor ever sees, does not parse. A
completion that switches off while you type is worse than none, so this scans
tags with a tolerant regex and keeps a block stack, exactly as the editor
section above predicted would be enough.

**Not delivered: inline chips.** Rendering property references as chips rather
than braces needs a contenteditable or CodeMirror surface; the field is a
`<textarea>`, and half-building an editing surface leaves it worse than the
plain field it replaced. The type and the `did you mean` are surfaced on a line
under the caret instead, which is the textarea-shaped version of hover. The
remaining "beautiful" items — one colour vocabulary shared with the ranking bar,
and the mode switch as a real transition — belong with 3b, which is when there
are two modes to switch between.

Verified in a running instance, not just in tests: `{{` offers `characters`;
inside `{{#each characters}}` it offers `name`, `nickname`, `description`,
`personality`, `extra lore` with types and an optionality marker; accepting
`extra lore` inserts `[extra lore]`, brackets and all, which is the one field
an author would otherwise get silently wrong. `{{postHistory.instructions}}`
now lints clean in the context-template editor — that was the slice-2 false
positive, confirmed gone in the app rather than only in a test.

**3b — Shape mode.** The tree over the same source: toggles, key renames,
reorder, lift/nest, per-branch prose. Generates the Handlebars; falls back to
Text mode, visibly, for any source it cannot round-trip.

**4 — explicit shipped layouts. Done.** `jsonValue`
added; `characters` and `personas` now name every key. Byte parity proved
against the code default and mutation-verified four ways — reorder the keys,
drop the nesting offset, drop the separating comma, or guard on truthiness
instead of presence, and the gate goes red.

**All five have explicit layouts**, including the three that looked like they
could not. The reasoning that said otherwise was wrong: "the keys come from the
data" is not the same as "the shape is unknown". A `record`'s structure is
*iterate entries, render key and value*, and putting that in the template is
what makes "render world lore as prose" or "change the separator" reachable at
all.

- **`worldLore` / `history`** — records, minified. The template writes the
  entries; `jsonValue` handles the key as well as the value, because a lore
  entry named `She said "no"` is one somebody can type and `"{{@key}}"` would
  have broken on it.
- **`speakerRelationships`** — the three graph sections named explicitly. This
  needed the producer to change: `buildGraphContext` stringified at indent 1
  *before* the value reached a template, so it was the one context value a
  layout could do nothing with — not prose, not a dropped section, not even a
  different indent. `buildGraphContextData` now returns the structure,
  `core:query/graph-context@1`'s out-ports became `json`, and the layout
  renders. Verified live: the same variable now renders as prose.

Two Handlebars facts this ran into, both worth knowing before writing another
JSON layout:

- **A literal `{` immediately before `{{` is a parse error** — the lexer reads
  three braces as a triple-stash. Minified JSON has no whitespace to separate
  them, so the templates write a space and remove it with Handlebars' own
  whitespace control (`{{~#each`). A real feature doing what it is for, rather
  than a helper invented to dodge the lexer.
- **`jsonValue` needed an `indent=` as well as an `offset=`.** The graph is
  stringified at one space, not two, and a layout that could not say so would be
  a byte off in every prompt that had a relationship in it.

Two traps worth naming, because both were live:

- **Presence, not truthiness.** `{{#if description}}` drops an empty-string
  description that `JSON.stringify` keeps, and drops a `null` — which personas
  really carry, since `resolveContextInput` builds them by hand and nothing
  strips a null the way `compileCharacter` does. Every optional key is guarded
  on `(ne x undefined)`.
- **The first key carries no comma.** `name` is always present, so every later
  key emits its own leading `,\n` inside its own guard. Putting the comma
  *after* each field needs to know whether anything follows, which Handlebars
  cannot answer without enumerating the combinations.

**What an explicit layout gives up, asserted rather than discovered.** It
renders the declared keys and no others, and a value that is not the declared
shape renders as that shape's empty form. Neither is reachable from core, but a
plugin node that enriched a character would previously have seen its extra field
in the prompt and now would not — so both cases are pinned in
`variableTemplates.parity.test.ts`, alongside a test that `{{{json characters
2}}}` still passes anything through for anyone who needs it.

Two existing tests were keying off *how a source was spelled* and had to stop.
`absentFor` tested `source.startsWith("{{{json ")` to decide which absence rule
applied — it now reads the rule off the code default, which is where the rule
actually lives. The seeding test restated the shipped source as a literal; it
now compares against the shipped definitions and asserts only what seeding is
responsible for.

**A bug found next door: the relationships block was never laid out at all.**
`templateContext.ts` spread `speakerRelationships` into the context raw while
every sibling went through `renderVariable` — and the shipped context template
had already been changed to write `{{{speakerRelationships}}}` *bare*, on the
understanding that the heading now lives in the layout. So on the pipeline path
the block reached the model as naked JSON, no `Your relationships:` and no
fence, while the seeded layout sat in the picker doing nothing. Nothing caught
it: the parity corpus renders the *fixture* templates, which carry their own
headings, and `variableTemplates.parity.test.ts` checked the layouts against the
code default without asking whether anybody called them.

**Migration 0116**, on the 0099/0106 precedent, because the graph node's ports
changed and a published type version is frozen. Legitimate here for the same
narrow reason as its two predecessors and no other — the version has never
shipped. It is also the **first re-projection migration anyone has tested**:
`reprojection.int.test.ts` regresses the row, proves the conflict is real, then
runs the migration. A typo'd `type_id` fails it, which on a fresh database
passes silently.

Verified in a running instance: every shipped layout renders byte-identically to
what the code produced — the cast at indent 2 with its nested record, world lore
minified, the graph at indent 1 with its section commas. Deleting the two
`personality` lines from a copy of the cast layout removes that field from the
prompt, and a hand-written prose layout turns the relationship graph into
sentences. Both with no code change and no lint error, which is the entire point
of the slice.

**5 — the 1:1 cleanup. Done.** Facet `i18n` in the SDK; declared order pinned;
the client-side vocabulary audited.

**Declared order** turned out to already hold — `declarations()` walks nodes by
stored position and each node's slots in descriptor order. Pinned rather than
assumed, because the slots reach the panel as JSON on a registry row and a
`.sort()` added anywhere in that path for tidiness would silently reorder every
settings screen. Mutation-verified at both levels: sorting the slots and sorting
a parameter schema each go red.

**The string audit** found one more thing worth changing and two worth leaving.
`Option.source` crossed the wire as `string`, so the closed scope chain lost its
type at the boundary and the panel's label map (`"your value"`, `"set by an
admin"`) had no way to notice a sixth scope — the badge would print the raw id.
The union is spelled out on the wire now and the map is keyed by it, so adding a
scope is a compile error in the panel. Those labels stay in the client on
purpose: they describe the *viewer's relationship to a value*, not domain
vocabulary a plugin owns. What did not belong was the absence of a check that
they were complete.

Left alone, deliberately: the library page's `TABS` (its own sections, with
icons a schema cannot carry) and `WRITES` (socket event names it re-subscribes
to). Neither is vocabulary anyone else extends.

*Also fixed here:* **four dead `template` slots removed** — `chat-history`,
`lorebook-triggers` and `generate-text` each declared one that no binding read
and no row was ever seeded for, so the panel rendered a picker with **nothing in
it** on every pipeline using them. A control that cannot be given a value, and
would not be used if it could, is worse than the absence of the feature it
stands for — the judgement `variableLayouts.ts` already records about a layout
for `characterLore`.

The ideas survive their slots. `lorebook-triggers` declared the *entry* scope
(`title` / `content` / `keys`) on its inert slot; that moved to
`core:task/render-entries@1`, whose whole job is rendering one entry, and became
a real `VarField` schema on the way. Per-message wording, if it is ever wanted,
belongs on `process-messages` — the node that formats a line — not on the query
that fetches rows.

Guarded going forward: `index.int.test.ts` now asserts that **every reference
control on every shipped pipeline has at least one choice**, so a slot that
compiles perfectly and offers nothing cannot come back unnoticed. Stated as a
rule rather than a list of the four, because a prompts slot or a variable layout
with nothing to point at is the same defect wearing a different label.
Mutation-verified by re-adding one.

Migration 0118 re-projects the four.

*Also done:* **facets are declared.** `FACET_GROUPS` and `SIMPLE_FACETS` were
hardcoded lists in `PipelineConfigOptions.svelte` holding the facet names, their
headings, their order, and which lead the panel. Worse than duplication: the
list was not a fallback, it was the **filter**. Options were matched *into* it,
so an option whose facet the client had never heard of matched no group and
rendered **nowhere** — a plugin's settings could exist in the database, be
writable through the socket, and be invisible on the only screen that
configures them, with nothing failing anywhere.

`sdk/src/facets.ts` declares them: id, heading, order, and whether the facet
leads. Two facets resolving to the same heading are one group, which is how
`connection` and `sampling` become "Model" without the client pairing them. The
view sends only the facets a pipeline actually uses, so no empty headings, and
an **undeclared** facet gets a humanised heading sorted after everything core
declares rather than disappearing.

The no-filtering property is stated as its own function (`facetsFor`) precisely
so it can be tested: a shipped pipeline cannot exercise it, because core
declares all of its own facets — which is exactly how the client-side version of
this bug survived. Mutation-verified on ordering, humanising, the `simple` flag,
and the drop.

`i18nText` is exported from `declarations.ts` and used by both, rather than
copied — the same duplication this layer keeps finding at the point where the
two have already disagreed.

**6 — ranking shares. Done.** `share` and `perMember` parameter kinds in the
SDK with a declared `members` set (key, label, description, colour *index* — the
declaration says which band, the client's palette says what it looks like). The
rank slots declare `share` / `maxEntries` / `minMessageTokens`, mapped onto the
`weights.ts` model that had sat unwired since it was written. `ShareBar.svelte`
renders the stacked bar.

**`budget: 4096` was in three places, not one** — `rank-hybrid`,
`rank-by-recency` and `assemble` all carried the same re-entered number. All
three are gone. The total now arrives on the `budget` in-port from
`core:task/context-budget@1`, which was declared for exactly this and had never
been bound or used by any spec.

`reserveForReply` went too, and it was the same defect one level down: an
integer defaulting to 512 sitting beside the sampling config's own
`responseTokens` that also defaults to 512. Context in, response out — the reserve *is* the
response allowance, so it is read rather than typed.

The budget node uses **`slot.samplingOf("generate")`**, not its own slot. A
budget computed against one window and a prompt sent against another is wrong in
the direction that truncates, silently; sharing the reference makes the two
impossible to point apart, which is better than a comment saying they must
agree.

**The harness caught the real bug.** Retiring the parameter took the world lore
out of 7 of 11 fixtures — not arithmetic: the parity harness builds its *own*
mirror spec, and its `rank` node had no budget port either. Its own comment
predicted that failure ("Without this the budget resolves to zero and every
block is excluded"). Both harnesses are wired like the shipped spec now, which
is what they exist to mirror. The full corpus is green, both arms, so retiring
the typed budget moved no prompt.

Migration 0117 re-projects the four changed types, and
`reprojection.int.test.ts` now covers both it and 0116 against a regressed
database — mutation-verified, since a wrong pin passes vacuously on a fresh one.

Stored `budget` values on tuned configs orphan with a notice through
`reconcileConfigs`, which is the designed outcome and needs no data migration.

Verified in a running instance: the bar shows `DEFAULT_GROUPS` exactly
(50 / 17 / 17 / 17 / 0), and moving World lore to 40% rescaled the others pro
rata — 50→36, 17→12, 17→12 — leaving the untouched bands' ratios intact and
Relationships off, persisted through the round trip.

**Not done: dragging.** The bar is read-and-type, not drag-a-divider. Percentage
inputs are the accessible, precise control and the bar is the picture; dividers
are polish on top of a working model.

**7 — the flow map.** A structural payload for the builder (nodes + edges +
blocks), and a renderer that draws async, map and loop rather than flattening
them. Independent of 1–5 and the biggest single win for making the builder read
like the pipeline it configures.

Slices 1–3 are the "nail the editor" half and are worth doing before 4: the
explicit templates are much easier to write, and much easier to trust, with
completions and path lint already working.

## Verification

- Every core `sample` validates against its own `scope` (slice 1). ✔
- `checkTemplate` catches a misspelled nested path and does *not* flag a
  correct one, including inside nested `{{#each}}` (slice 2). ✔
- Every shipped explicit layout renders byte-identical to the code default, over
  the nasty matrix the `json` helper already uses: empty list, empty record, a
  key with a space, `undefined` values, quotes, newlines, tabs, non-BMP emoji,
  `<` and `&` (slice 4). ✔ — and against each variable's own declared `sample`,
  which slice 1 already proved is the declared shape.
- The parity corpus stays green throughout — it is the backstop that says a
  prompt somebody's chat depends on did not move.
- A node whose `renders` names an unregistered variable is refused at install
  rather than rendering an empty editor.

---

# Retrieval, reshaped

Notes from the design pass on chat reply's retrieval half. Three of these
collide with rulings already in the codebase, and those collisions are the
useful part.

## Naming

| was | is | description |
|---|---|---|
| `speakerRelationships` (half) | **`relationshipsPerspectives`** | How the speaking character sees everyone else — their read on the others, in their words. |
| `speakerRelationships` (half) | **`relationshipsKnown`** | What everyone else knows or believes about the speaking character. |
| `Story history` | **History entry** | The label is *in the prompt*, so this changes output — a deliberate byte change, not a silent rename. |

The two halves already exist inside the variable as `yourRelationships` and
`howOthersRegardYou`; they are one JSON blob today, so neither can be laid out
separately or dropped. Splitting them into two variables makes each one a
first-class thing with its own layout, weight and floor.

## Where the cross-source settings live

**Floors and weights move to the ranker.** `minInclude` exists on exactly two
nodes today — chat history (6) and lorebook triggers (3) — so "keep at least N"
is unexpressible for the sources most likely to be squeezed. A floor is not a
property of fetching; it is a property of *allocating*, and allocation is the
ranker's job. Same for ranking weight.

That gives the ranker two stacked bars, and they are genuinely different
questions:

- **share** — how much of the window each source may occupy.
- **weight** — how strongly an entry from that source competes on score.

A source can be worth little space and still be worth surfacing first, which is
why one bar cannot serve both.

### The ranker does not need to move

The ask was to put the ranker *before* the gather group so it can pass settings
down. It does not have to: a slot can already be **shared by reference** —
`slot.prompts({ node: "context" })` is how three nodes read one authored prompt.
`slot.params()` is the one ref that takes no target, which looks like an
oversight rather than a decision.

Adding `ofNode` to it lets every query read the ranker's policy —
`params: slot.params({ node: "rank" })` — with no reordering, no node running
before it has data, and one place to edit. Reordering would also put a node
*named* for ranking in front of everything it ranks, which reads as wrong even
where it works.

## Lore splits into two queries

`lorebook-triggers@1` returns world and character lore through one port, so they
share a weight, a floor and a share. They are not the same thing: character lore
is bound to whoever is speaking and world lore is not, and an install that wants
lots of one and little of the other cannot say so.

Two query nodes, each with its own retrieval settings and its own band in both
bars.

## Per-entry versus per-node — and a ruling already made

The instinct is right and the codebase already agrees with it in one place and
not another:

> `strategy.ts`: "the decision lives on the **entry** rather than on the
> pipeline, so a user can read it off the thing they are editing."

`RetrievalStrategy = 'keyword' | 'rag' | 'both'`, defaulting to `rag`, **already
exists** — with keyword fallback, on the entry. The `both` case is "Averages".

So the retrieval-mode selector is half-built, and the half that exists is on the
opposite side of the boundary from where this pass would put it. The
reconciliation that keeps both arguments intact:

- **Lore entries keep deciding.** A lorebook entry is a thing a person edits and
  reads; its strategy belongs on it, exactly as ruled.
- **The node sets the default** for entries that do not override, which is what
  makes "RAG by default" configurable rather than a constant.
- **Sources with no entry to carry it** — chat history, both relationship sets —
  take the node's setting outright, because there is nothing else to put it on.

Same reasoning moves `useRegex`, `caseSensitive` and `recursionDepth` off the
node: they describe *how an entry matches*, and the entry is what a person is
looking at when they want to change that. `recursionDepth` needs adding to the
lore entry schema and its editor. The node keeps `scanDepth` — how far back the
conversation is read is a property of the conversation, not of any entry — and
gains `maxRecursionDepth` as a ceiling over whatever entries ask for.

**RAG as default has one precondition.** The respond spec says today:

> "The keyword arm only, deliberately: … the semantic arm needs a loaded
> embedding model that most do not have on first boot. A spec that halts on a
> missing model would be the first thing a new user saw."

`rag` *with keyword fallback* satisfies that and plain `rag` does not. The
fallback is not a nicety; it is what makes the default safe on a fresh install,
and the receipt already records which arm actually ran so it stays visible.

## Toggles

A source that is off should not be queried at all, rather than fetched and
discarded. `toggleable` / `enabledDefault` already exist on `pipeline_nodes`,
already reach the client, and the map already draws an `opt` badge for them —
nothing reads them. Wiring the executor to skip a disabled node is the whole
change.

`share: 0` remains the "keep it but starve it" case; the toggle is "do not ask".

## Sequencing

Splitting relationships and fixing `currentDate` both want the variable schema
(slices 1–3). Floors, weights and toggles fold into slice 6's shares — same
node, same control surface. `slot.params({ node })`, the lore query split, and
moving the match settings onto entries are independent of all of it.
