# Context Templates

Where a [Sampling Config](./connections.md#sampling-configs) controls _how_ a model samples tokens, a **Context Template** controls _what_ gets sent to it — the template that assembles the system block, character and persona data, scenario, lorebook entries, session history, and post-history reminders into the final request.

A template says which language it is written in, and Serene Pub renders two: **Handlebars**, which everything shipped is written in and which every example on this page uses, and **Liquid**, described in [its own section below](#writing-a-template-in-liquid). Neither is more supported than the other; Handlebars is simply what the defaults are written in, and nothing about adding Liquid changed them.

**Context Templates are distinct from prompts.** A step's [prompt](./pipelines.md#prompts) supplies the free-text _instructions_ — writing style, tone, rules — that get slotted into the template via the `{{{instructions}}}` variable below. The template is the structure itself.

**They are also distinct from variable layouts.** A template says _where_ the character cards sit; a [variable layout](#variable-layouts-where-the-headings-and-fences-come-from) says _how each one is written out_ — JSON or prose, with or without a heading. That split is described in full below.

## Where they live

A Context Template is chosen per pipeline, in the **Pipelines** view, on the step that assembles the prompt.

That pick is stored on the pipeline's selected **configuration** — see [Pipeline Configurations](./pipelines.md), which covers how a configuration stores what you changed and how to see or reset it.

Templates are **shared across pipelines, not owned by one**. A template is compatible with the _kind of step_ that renders it, so one written while configuring session replies is equally selectable for the narrator — the two run the same assemble step and see the same values. The picker groups by where a template came from (this pipeline's, then the ones Serene Pub ships, then everything else that fits) so a long list stays navigable, but nothing is ever hidden from you.

Administrators also see every template in one place: **Admin › Context templates** (`/admin/context-templates`), a list beside the template it opens. Each row names the step the template belongs to and how many pipelines use it, with a **Built-in** badge on the ones Serene Pub ships. **Admin › Variable templates** and **Admin › Completion templates** work the same way.

A pipeline with no assembling step — the summarizers, the graph builder — has no Context Template setting at all, so their settings never fill up with templates written for session replies.

## Editing and creating your own

The built-in **Default** is immutable, so customizing means duplicating it first and editing the copy. Everything already pointing at the original keeps working, which is the reason the shipped ones do not change in place.

A template is an advanced, all-or-nothing thing to edit. A template that does not parse is refused when you save it, but one that parses and says the wrong thing is not, so it is worth trying changes on a low-stakes session before making one an instance default. See [Templates are checked when you save them](#templates-are-checked-when-you-save-them).

Deleting refuses while any pipeline or session still selects the template. Because templates are shared, that may well be a pipeline you are not looking at — point that setting elsewhere first, then delete.

### The editor

Opened from a pipeline step, the editor knows exactly what that step supplies: its own names, the context builder's values, the bands declared upstream (such as `secretEntry`), `annex` where the step reads it, and `state`, each with its type. It helps in both languages:

- **Completion.** Type `{{` (or `{{{`) for the names in scope, each with its type and description. After a `.` it offers the fields of what you have written so far. An annex owner with a dot in its name is inserted with the brackets it needs: `annex.[showcase.twenty-questions]` in Handlebars, `annex["showcase.twenty-questions"]` in Liquid. A map whose keys are the data's own, like `state.cast`, offers a placeholder to type over (`‹member›`), then the fields of one entry. Inside `{{#each}}` it offers the element's fields, `this`, `@index`, `@first` and `@last`. Helpers come with a short signature (`pad n width`). `{{#` offers the blocks, and choosing one writes its closing tag too. In Liquid, `{% ` offers the tags (and the end tag of the block you are in), `|` offers the filters, and a `{% for item in list %}` item completes to the element's fields. Exact prefix matches come first, then looser ones, then the step's values before bands, the annex, `state` and helpers. **Ctrl+Space** reopens the list.
- **Hover.** Put the caret on a name to see its type, description and who supplies it (_from Build template context_), or, when it does not resolve, the name you probably meant.
- **Lint.** A name or field nothing supplies is underlined where you wrote it: a red wave for an error, an ember one for a warning. The list below the field says what is wrong and on which line. Where there is an obvious near miss it offers a **Use "message"** button, and **Ctrl+.** applies the same fix at the caret. These are the same checks as selecting and saving (see [Templates are checked when you save them](#templates-are-checked-when-you-save-them)), so the editor, the picker and the save never disagree.
- **Variables available here.** Beside the field (below it when the view is narrow) is the step's scope as a tree, with types, descriptions and who supplies each value. Choosing a row inserts its path at the caret: bare inside a tag, wrapped as `{{{path}}}` (Liquid `{{ path }}`) outside one, and a list as its loop. The tree works from the keyboard: arrows move, Right opens, Left closes, Enter inserts.

The **library** (`/pipelines/library`) has no step in view, so there the editor checks against the step type's own names and says so: _Checked against every step that uses it when you pick it._ A name it cannot see is a warning, not an error, because the step that picks the template may supply it.

## Upgrading from 0.5

0.5 stored its prompt templates in a table of their own, selected from a Contexts sidebar. 0.6 replaces that sidebar and table with the Context Templates described here, and carries your data across: whatever each scope had selected is copied into the new table and re-selected, so prompts come out the same on the first boot after upgrading.

The old rows are kept in the database so nothing you wrote is lost, but they are no longer shown anywhere. Nothing in 0.6 renders from them, and they are removed in a later release.

One thing the migration handles for you: a template you wrote yourself still contains its own headings and fences, because nothing rewrites your work. Those installs are pinned to the **bare** variable layouts so the heading is written once rather than twice — see below.

## The default template and available variables

The built-in **Default** Context Template (shown here verbatim) illustrates every variable and helper Serene Pub currently interpolates:

````handlebars
{{#systemBlock}}
{{#if currentDate}}
{{{currentDate}}}
{{/if}}

{{#if instructions}}
{{{instructions}}}
{{/if}}

{{#if characters}}
{{{characters}}}
{{/if}}

{{#if personas}}
{{{personas}}}
{{/if}}

{{#if scenario}}
{{{scenario}}}
{{/if}}

{{#if worldLore}}
{{{worldLore}}}
{{/if}}

{{#if history}}
{{{history}}}
{{/if}}

{{#if relationshipsPerspectives}}
{{{relationshipsPerspectives}}}
{{/if}}
{{#if relationshipsKnown}}
{{{relationshipsKnown}}}
{{/if}}

{{/systemBlock}}

{{#each sessionMessages as |sessionMessage msgIndex|}}
{{#each (lookup ../injectionsByIndex msgIndex)}}
{{#if (eq this.role "assistant")}}
{{#assistantBlock}}
{{{this.content}}}
{{/assistantBlock}}
{{else if (eq this.role "user")}}
{{#userBlock}}
{{{this.content}}}
{{/userBlock}}
{{else}}
{{#systemBlock}}
{{{this.content}}}
{{/systemBlock}}
{{/if}}
{{/each}}
{{#with ../postHistory}}
{{#if (and (eq msgIndex targetIndex) hasContent)}}
{{#systemBlock}}
{{#if instructions}}
Response reminder:
```text
{{{instructions}}}
```
{{/if}}
{{#if charInstructions}}
Character reminder:
```text
{{{charInstructions}}}
```
{{/if}}
{{#if exampleDialogue}}
Example dialogue:
```text
{{{exampleDialogue}}}
```
{{/if}}
{{/systemBlock}}
{{/if}}
{{/with}}
{{#if (eq role "assistant")}}
{{#assistantBlock}}
{{{name}}}: {{{message}}}
{{/assistantBlock}}
{{/if}}
{{#if (eq role "user")}}
{{#userBlock}}
{{{name}}}: {{{message}}}
{{/userBlock}}
{{/if}}
{{/each}}
````

Available variables:

- **`currentDate`**, **`instructions`** (the step's prompt, see [Pipelines → Prompts](./pipelines.md#prompts)), **`characters`** and **`personas`** (each rendered as JSON), **`scenario`**, **`worldLore`**, **`history`**, and the two relationship blocks, **`relationshipsPerspectives`** and **`relationshipsKnown`** — all optional (wrap them in `{{#if ...}}` since they may be empty). Each of these arrives already formatted by its **variable layout** — see below.
- **`characters`** holds a card for every character in the cast, benched ones included, trimmed to the session's **Character detail** setting (Chat and Adventure; see [Sessions → Character detail](./sessions.md#character-detail)): at **Name and description** a card other than the speaker's has no `personality`, and at **Only whoever is speaking** only the speaker's card is there. **`characterNames`** (`{{characterNames}}`, "A, B, and C") names only the enabled characters, and is empty at **Only whoever is speaking**. Whether a character is benched is not a template variable — it is the `enabled` property on the cast a pipeline reads (see [Pipelines → The cast a pipeline reads](./pipelines.md#the-cast-a-pipeline-reads)).
- **`relationshipsPerspectives`** (how the speaking character regards the others) and **`relationshipsKnown`** (how they are regarded in return, plus any figures the world knows of) each arrive already wrapped in their heading and fence by their variable layout, like every other block above. Together they are built fresh for whoever is speaking: their own outgoing relationships, relationships other cast members in the session have pointed at them, and any bindings marked **legendary** (the one layer that also carries a binding's Summary). They are assembled independently of the retrieval described below and are included on every generation that has a lorebook with a bound speaker.
- **`narrativeGraph`** and **`speakerRelationships`** are retired names, and nothing supplies either any more. A template that still uses one saves with a warning and renders nothing in that place, and choosing it for a step is refused (see [Templates are checked when you save them](#templates-are-checked-when-you-save-them)). If you cloned the default template before the relationships block was split, replace that block with the `relationshipsPerspectives` and `relationshipsKnown` pair the default template uses now.
- **`docsExcerpts`** — the Guide's documentation excerpts, found by the reply's **Docs search** step: a JSON object keyed by page and section, each value starting with `Path: /docs/…`. Only a pipeline with that step supplies it; its one layout is **JSON**, with no heading, because the Guide's own template writes the framing (and an `{{else}}` for a question nothing in the docs matched). See [Sessions → Guide](./sessions.md#guide).
- **`recalledLines`** — older lines of the conversation that **Entity search** found again because they name what the scene is naming now, oldest first. Each line is an object with `speaker`, `turn` (its position in its channel's conversation, counting from 1) and `text`, and the shipped **Lines** layout renders one per line: `Earlier (turn 12) — Mira: I hid the brass key under the chapel floor.` It is never placed for you. A template shows recalled lines only where it writes `{{{recalledLines}}}`, and only when the pipeline ranks Entity search's **messages** output. No shipped pipeline or template does either yet. If a pipeline ranks recalled lines and its template does not place them, the run's receipt says `band 'recalledLines' was ranked and included but the template does not render it`. Those lines used budget and are not in the prompt. Entity search's **Earlier messages found by name** sets how many lines it may return (0, the default, turns it off), and **Share — recalled lines** sets how much of the context window they may take.
- **`sessionMessages`** — an array iterated with `{{#each ... as |sessionMessage msgIndex|}}` (the `msgIndex` block param is what lets the post-history block below find its target position), each entry exposing `role`, `name`, and `message`.
- **`postHistory`** — see below.

Triple-brace `{{{...}}}` is used throughout to output raw text/JSON without HTML-escaping. This matters: a variable's value carries its own heading and fence, so reading one through a double brace (`{{scenario}}`) HTML-escapes the fence itself and puts `&quot;&quot;&quot;` in your prompt. Use `{{{...}}}` for every variable in the list above.

### Variable layouts: where the headings and fences come from

Notice that the template above contains no `Assistant Characters (AI-controlled):` heading and no ` ```json ` fence — just `{{{characters}}}`. They live in a **variable layout**: a small, reusable template that renders one variable, chosen per pipeline in the **Pipelines** view.

The split is by responsibility. The context template owns _structure_ — message blocks, placement, `{{#if}}` and `{{#each}}` — and has no opinion about how the data inside is presented. A layout owns _presentation_ — the heading, the fence, the shape of the JSON, how each property is written out.

What this buys you is that changing how characters are rendered no longer means rewriting the whole context template. Duplicate the shipped **Titled JSON block** layout for `characters`, delete the JSON, write prose instead, and every pipeline that renders characters can select it — the same row is offered in the narrator's settings as in the session reply's, because a layout is keyed by _what it renders_ rather than by which pipeline you were configuring when you wrote it.

Two rows ship for each wrapped variable:

- **Titled JSON block** / **Titled block** / **Sentence** — the heading and fence, exactly as 0.5 wrote them. This is what a new install selects, so upgrading changes nothing about your prompts.
- **JSON** / **As written** — the value alone, with no heading.

The shipped rows are immutable; customizing means duplicating one first, the same as with the Default Context Template itself.

**If you wrote your own context template**, it still contains your own headings and fences — nothing rewrites a template you authored. Upgrading to 0.6 pins that template's pipelines to the bare **JSON** / **As written** layouts, so the wrapper keeps coming from where you put it and is not written twice. If you later strip the headings out of your template, switch those settings to the titled layouts to get them back.

A variable with nothing in it renders nothing at all, heading included — so a `{{#if worldLore}}` guard around it behaves exactly as it always has.

**Every variable that holds an object gets a layout.** An object is a value with named fields or keys — a character card, a lore record, Twenty Questions' `secretEntry` — or a list of them. When nothing ships a layout for one, Serene Pub adds a **JSON** layout for it by itself. For a plugin's variable that happens when the plugin is installed. The layout writes the value as compact JSON, which is exactly what the prompt got before, so selecting it changes nothing. It stays in the picker as long as the plugin is installed, and it is marked withdrawn when the plugin is removed. Like the shipped layouts it is immutable: duplicate it to write your own, and your copy is never touched when the plugin is updated or the instance restarts. A plugin that ships its own layout for a variable gets no JSON row for it. Plain text, numbers, true/false values and lists of text get no layout of their own.

### The postHistory object

Rather than a single flat "post-history instructions" variable rendered once after the whole session history, the post-history reminder is a small object, `postHistory`, accessed with `{{#with ../postHistory}}` from inside the `{{#each sessionMessages}}` loop (the `../` reaches out of the each-block's own scope to the top-level `postHistory`):

- **`targetIndex`** — which message index the reminder should render at. Computed from the assembly step's **Post-history depth** setting: depth 0 targets the last entry in `sessionMessages` (the seed/prefill placeholder the model continues writing from), depth _N_ targets _N_ real messages earlier than that. A depth larger than the available history clamps to the oldest position rather than vanishing.
- **`hasContent`** — `true` when at least one of `instructions`, `charInstructions`, or `exampleDialogue` below is populated and the trigger admits the block; lets the template gate the whole reminder block in one check rather than three.
- **`instructions`** — the step's prompt's own **Post-history instructions** text (see [Pipelines → Prompts](./pipelines.md#prompts)). The assembly step's **Post-history token trigger** gates the whole block: below the threshold every part below is left empty, so a short session gets no reminder at all. The reminder only kicks in once the conversation is long enough that the system prompt feels distant.
- **`charInstructions`** — the current character's own **Post-History Instructions** field (see [Characters](./characters.md)), a character-authored reinforcement note separate from the prompt's `instructions` above. It rides in the same block and is gated by the same trigger.
- **`exampleDialogue`** — the current character's **Example Dialogues** field. Example dialogue is rendered here (near the generation point) rather than up in the top system block — a model many turns deep into a conversation benefits more from seeing example dialogue right before it writes than from seeing it once, far above the recent history.

The template checks `(and (eq msgIndex targetIndex) hasContent)` inside the loop so the reminder block renders exactly once, at exactly the right position, only when there's actually something to say.

**Which step the trigger applies to.** The depth and the trigger are settings on the step that _assembles_ a prompt, so every assembling step in a pipeline reads them. A Chat reply has one of those; a genre that plans a turn, narrates it, gives each speaking character a voice and then records what changed has four, and each one honours the same two numbers unless that step's own value is set in the Pipelines view (see [Pipelines](./pipelines.md)), which wins.

**The block is one unit.** The trigger and the depth govern the reminder, the character reminder and the example dialogue together. Below the trigger none of them is rendered; above it all three render at the same position. A card author's note is not exempt: the trigger is the reader's ceiling on reminders of any origin.

**Reading the decision back.** A suppressed reminder leaves nothing behind in the prompt, so the run inspector's Prompt tab states it outright for the step that decided: _Post-history reminder: suppressed, 278 tokens is below the 100000 trigger_, or _included at message 12_, plus _Includes the character reminder_ or _Character reminder suppressed with it_ when the card carries one. The context-building step one step earlier carries the reminder ungated and its Output tab labels it _carried, gated at assemble_, so the copy shown there is never mistaken for the verdict.

### The injectionsByIndex map

Script injections (see the Scripts page) land here: a map of **message index → injected entries**, each entry `{role, content}`. The depth a script declares resolves with the same arithmetic as `postHistory.targetIndex` — depth 0 is the seed placeholder's own iteration (right before the line the model continues from), depth _N_ is _N_ real messages earlier, clamped to the oldest position. The default template reads it inside the message loop with `{{#each (lookup ../injectionsByIndex msgIndex)}}` and wraps each entry in the role block it declared.

This is deliberate: an injection is _data the template renders_, never a row spliced into the conversation behind the template's back. Your template decides where — and whether — injections appear: keep the block where the default puts it, move it after the message instead of before, restyle it, or leave it out entirely and injections render nowhere. A template written before this feature renders exactly as it always did, because an absent block renders nothing.

**A `{{/each}}` boundary matters here.** `sessionMessages`' last entry is always the seed/prefill placeholder (`"Name: "`, the turn the model continues writing from) — it must stay the literal final block in the rendered output for that continuation to work. Rendering a post-history reminder _after_ `{{/each}}` instead of inside the loop (gated on the target message) would push a system block after the seed, breaking it into a standalone, non-continued turn.

### Stats: `state`

When a pipeline feeds the context step the **Session state** step's output, the template can read the session's stats (see [Stats and states](./stats-and-states.md#in-a-prompt)):

- `state.world.<stat>`: `{{state.world.weather}}`
- `state.cast.<member>.<stat>`, plus the member's `id`, `key` and `name`: `{{state.cast.verity.hp}}` (the pipeline's copy of the state also carries `enabled`; a template's does not)
- `state.locations.<place>.<stat>`, the same for a place: `{{state.locations.the_crypt.inventory}}`

A stat is under its short name (`hp`) and under its full one (`adventure_hp`), so two extensions that both declare `hp` stay reachable. Members and places are keyed by their slug.

Only the stats the session tracks are there, and nothing else. The id indexes, the list of stats, the roles and the state version are for pipelines and conditions, not templates. Their shapes come from the genre's stats, so the editor checks `state.cast.verity.hpp` against them. When a genre lets sessions add their own stats, the names can't be listed in advance and aren't checked. Nothing in the shipped pipelines wires `state` into a context step, so `{{#if state}}` is false there.

### The annex: `annex`

A plugin or genre keeps what it remembers between turns in the session's **annex**, and it declares every key it keeps (see [Sessions](./sessions.md)). A template can read those declared keys as `annex.<owner>.<key>`. Every declared key is included, whoever the key's own audience is: a declaration refuses secrets when a key is written, so nothing dangerous is ever stored there.

An owner's id has dots in it, so name it with Handlebars' segment literal, in square brackets:

```handlebars
{{#if annex.[showcase.twenty-questions].secret}}
You are thinking of {{annex.[showcase.twenty-questions].secret.secretEntryName}}.
{{/if}}
```

In Liquid, use a bracketed string: `{{ annex["showcase.twenty-questions"].secret.secretEntryName }}`.

What arrives:

- **Owners in scope only.** That means core and every plugin that is switched on. A switched-off plugin's keys stay stored but reach no template.
- **Declared keys only.** A key must be declared for this session's genre. A key no declaration covers, such as data an older version wrote, never arrives.
- **Only where it is wired.** The step's `annex` input must be fed by the **Session annex** step reading the template view (see [Pipelines](./pipelines.md)). No shipped pipeline wires it, and Twenty Questions still gets its secret into the prompt as the `secretEntry` band. At a step with nothing wired, `annex` is not in the template's scope at all, so a template that names it is refused when you select it, instead of quietly rendering nothing.

## How entries and older messages are chosen

Deciding _which_ lorebook entries and _which_ older session messages actually make it into `worldLore`, `history`, and each character's lore (see below) — out of everything that could — is the job of retrieval. It fills the same template variables in the same shapes however the content was found. (The relationship blocks are built separately, from the speaker's own graph bindings.)

### Mechanisms add up

Retrieval runs several **mechanisms** side by side, and each contributes **signals** to one ranked pool rather than one mechanism replacing another:

- **Keyword** — each entry's **Keywords** (one keyword per chip) are checked against recent messages (case-insensitive substring matching by default, or exact-case / regex if the entry's **Case Sensitive** / **Use Regex** switches are on), together with other cheap signals: whether the entry's own name is mentioned as a whole word, whether characters and personas already in the scene co-occur with it, a term-frequency score across the session, and how recently a matching keyword last appeared.
- **Semantic** — when embeddings are on and the embedding model is ready, entries and messages are also scored by embedding similarity against the conversation. The full mechanics are in [Embeddings & RAG](./embeddings-and-rag.md#how-serene-pub-ranks-retrieved-content). With embeddings off, or when a session opts out with its own "Ignore for this session" toggle (see [Understanding RAG Notices](./embeddings-and-rag.md#understanding-rag-notices)), this mechanism simply contributes nothing and the others still run.
- **Entity** and **structural** signals — names recognised in the conversation, and how entries relate to each other and to the cast — add to the same scores where they apply.

The entry's **Priority** (see [Lorebooks](./lorebooks.md)) adds a bonus on top of the combined score. Every candidate is then filled into its **band** (world lore, character lore, history, messages, and recalled lines where a pipeline ranks them) until the band's share of the token budget or its cap is reached.

### What is always true

- The most recent messages in a session are always included, never subject to selection.
- A **Pinned** lorebook entry is always included, bypassing scoring entirely.
- The two relationship blocks and the `postHistory` object (above) are computed the same way whatever was selected around them.
- Within `{{{worldLore}}}` and `{{{history}}}`, entries are ordered by relevance (highest first), not by an entry's position or date in the lorebook — which entry ends up first can change from one generation to the next as the conversation moves. **Character Lore has no top-level template variable of its own** — qualifying entries are attached directly onto their bound character's own object inside `{{{characters}}}`, under an `"extra lore"` key, rather than appearing as a separate `{{characterLore}}` variable.
- Once the model's context window is the tighter constraint, content simply stops being added for that generation — see [Sampling Configs](./connections.md#sampling-configs) for how Context Tokens sets that limit.

## Why character, persona, and lore data is JSON, not prose

`characters`, `personas`, `worldLore`, `history`, and the two relationship blocks are all fenced as ` ```json ` blocks, while `instructions` and `scenario` stay wrapped in plain `"""` prose fences, and the post-history reminder fields (`instructions`, `charInstructions`, `exampleDialogue` inside `postHistory`) use ` ```text ` fences. (The first two groups get their fences from their variable layouts, as described above; the post-history fields are still fenced in the template, since they come off the `postHistory` object rather than from a variable of their own.) That split is deliberate: the JSON-fenced fields are _facts_ (who someone is, what they know, what happened), and the prose/text-fenced fields are _directives_ (how to write, what tone to take, what's happening right now) — the template keeps those two kinds of content visibly distinct rather than blending everything into one undifferentiated paragraph.

The reasoning behind serializing the factual side as JSON specifically:

- **Explicit key boundaries reduce attribute bleed.** In a group session with several characters, prose descriptions concatenated back-to-back are genuinely ambiguous for a model to attribute correctly — a trait mentioned near the end of one character's paragraph can get picked up as belonging to the next one. A JSON array of objects with explicit `name` keys removes that ambiguity structurally, independent of how any individual field is written.
- **It's a base-model competency, not a roleplay one.** The instinct is that RP-oriented models — fine-tuned mostly on the prose/PList-style character cards common across other popular roleplay applications — would parse JSON _worse_ than the format they were tuned on. In practice, RP fine-tuning mostly reshapes _output_ voice and pacing, not _input_ parsing; general structured-data comprehension (reinforced heavily in most base/instruct training via function-calling and tool-use data) tends to survive underneath a lighter RP fine-tune layer largely intact.
- **It keeps retrieval consistent.** However an entry was found (by keyword, by meaning — see [Embeddings & RAG](./embeddings-and-rag.md) — or both), the same fields are serialized to JSON before injection, so turning embeddings on or off doesn't also change the shape of what the model sees.

## Writing a template in Liquid

Serene Pub renders two template languages, and a template carries the one it is written in. **Liquid** ([LiquidJS](https://liquidjs.com)) is offered alongside Handlebars for people who already know it, or who find `{% if %}`/`{% endif %}` easier to read than `{{#if}}`/`{{/if}}`. It is not a migration: everything Serene Pub ships is Handlebars, and it stays that way.

Both engines are handed the **same context object** and are held to producing the **same bytes** from equivalent sources — there is a parity test that renders the shipped templates through both and compares them character for character. So the choice is about which syntax you prefer to write, and about nothing else.

### Choosing the language

The engine is chosen when a template is **created**, and it is read-only afterwards. Switching an existing template's language is a rewrite, not a setting: storing the same text under a different engine id does not translate a word of it, and every `{{#if}}` in it would arrive at the model as literal characters. To move a template across, duplicate it and rewrite the copy — everything already pointing at the original keeps working.

A template also has to land somewhere a step will look. Templates are grouped by _(what they render for, which language)_, so a Liquid template written for the assemble step appears under that step's Liquid heading, and is offered by a step that renders Liquid.

**Where you can pick one.** A step declares which languages it renders, and the story string — the assemble step, the one this whole page is about — renders **both**. So a Liquid template is selectable anywhere that template is chosen: in a pipeline's own settings, where the picker lists Handlebars and Liquid templates together with each row's language in its subtitle, and in **Pipelines → Library**, where each language is its own heading. In those settings the `+` button splits into one per language, so "new Liquid template" is a single click; the Library's **New** button takes the language from the heading you create under. New templates default to Handlebars — the language everything shipped is written in — so nothing changes until you ask for Liquid by name. A step that renders only one language keeps a single `+` and a single heading.

### The syntax, side by side

|                        | Handlebars                                 | Liquid                                                            |
| ---------------------- | ------------------------------------------ | ----------------------------------------------------------------- |
| A variable             | `{{{scenario}}}`                           | `{{ scenario }}`                                                  |
| Conditional            | `{{#if x}}…{{else if y}}…{{else}}…{{/if}}` | `{% if x %}…{% elsif y %}…{% else %}…{% endif %}`                 |
| Negated                | `{{#unless x}}…{{/unless}}`                | `{% unless x %}…{% endunless %}`                                  |
| Loop                   | `{{#each xs}}…{{/each}}`                   | `{% for x in xs %}…{% endfor %}`                                  |
| The item               | `{{name}}` (implicit `this`)               | `{{ x.name }}` (the loop names it)                                |
| Position               | `{{#each xs as \|x i\|}}` … `{{i}}`        | `{{ forloop.index0 }}`                                            |
| Last item              | `{{#if @last}}` / `{{#unless @last}}`      | `{% if forloop.last %}` / `{% unless forloop.last %}`             |
| A record's key/value   | `{{#each rec}}{{@key}}:{{this}}{{/each}}`  | `{% for pair in rec %}{{ pair[0] }}:{{ pair[1] }}{% endfor %}`    |
| Lookup by index        | `{{lookup m i}}`                           | `m[i]`                                                            |
| Reaching out of a loop | `{{../postHistory}}`                       | `{{ postHistory }}` — a Liquid loop does not hide the outer names |
| Shifting scope         | `{{#with obj}}…{{/with}}`                  | no equivalent; write `obj.field`, or `{% assign o = obj %}`       |
| Comparison             | `(eq a b)`, `(ne a b)`                     | `a == b`, `a != b`                                                |
| Combining              | `(and a b)`, `(or a b)`                    | `a and b`, `a or b`                                               |
| Present vs. empty      | `(isSet x)`                                | `x != nil`                                                        |
| Whitespace control     | `{{~ … ~}}`                                | `{{- … -}}` and `{%- … -%}`                                       |

Helpers become **filters**, with the same names and the same arguments:

| Handlebars                                  | Liquid                                             |
| ------------------------------------------- | -------------------------------------------------- |
| `{{{json x}}}` / `{{{json x 1}}}`           | `{{ x \| json }}` / `{{ x \| json: 1 }}`           |
| `{{{jsonValue x}}}` / `{{{jsonValue x 4}}}` | `{{ x \| jsonValue }}` / `{{ x \| jsonValue: 4 }}` |
| `{{{jsonValue x indent=1 offset=1}}}`       | `{{ x \| jsonValue: indent: 1, offset: 1 }}`       |
| `{{pad n 2}}`                               | `{{ n \| pad: 2 }}`                                |

And the three block helpers become **tags**, spelled the same way:

| Handlebars                                | Liquid                                         |
| ----------------------------------------- | ---------------------------------------------- |
| `{{#systemBlock}}…{{/systemBlock}}`       | `{% systemBlock %}…{% endsystemBlock %}`       |
| `{{#userBlock}}…{{/userBlock}}`           | `{% userBlock %}…{% enduserBlock %}`           |
| `{{#assistantBlock}}…{{/assistantBlock}}` | `{% assistantBlock %}…{% endassistantBlock %}` |

`assistantBlock` takes one optional argument that Handlebars did not need: **`{% assistantBlock id: sessionMessage.id %}`**, inside the message loop. Handlebars reads the message off the block's implicit `this`; Liquid has no implicit `this`, so the message is named. It is load-bearing — the seed/prefill placeholder carries `id` `-2`, and that is what tells the block to leave its closing delimiter off so the model continues the turn rather than starting a new one.

### Three things that behave differently

**Blank lines.** Handlebars silently removes a line that contains nothing but a block tag. Liquid does not, so write `{%- if x -%}` rather than `{% if x %}` for a tag sitting on its own line. Serene Pub configures Liquid's trimming to be **line-bounded**, so `{%-`/`-%}` removes exactly what Handlebars would have — the indentation before the tag and the newline after it — and leaves your blank lines alone.

**Empty arrays.** `""`, `0`, `nil` and `false` are falsy in both languages here. An empty _array_ is not: `{{#if xs}}` is false in Handlebars and `{% if xs %}` is **true** in Liquid. Write `{% if xs.size %}` or `{% if xs != empty %}`.

**`nil` covers both.** Handlebars' `(ne x undefined)` distinguishes a missing key from one explicitly set to `null`. Liquid's `x != nil` treats them the same.

### What Liquid is not allowed to do

`{% include %}`, `{% render %}` and `{% layout %}` are **refused when the template is saved**, and the refusal names the tag and the line. A context template is a row in a table; there is no directory for it to pull from, and an engine that could open files is one an authored template could use to read the install. Put shared text in the template.

An unknown filter is refused the same way — a misspelled `{{ x | jsonvalue }}` will not silently render `x` unfiltered.

## Templates are checked when you save them

Both languages get the same two checks, and they are deliberately different in kind.

**A template that does not parse is refused, and nothing is written.** The message is the engine's own, with the line it failed on. A malformed template stored is a pipeline that fails at generation time — far from the edit that caused it, with an error nobody reading a session can act on.

**A template that references a name nothing supplies is saved, with a warning.** Writing `{{{worldLoer}}}` where the contract says `worldLore` parses perfectly and renders an empty string — a whole block of world lore quietly missing from every prompt. The warning names the value and the line, and the editor shows it as you type as well as when you save. Saving only warns because a template is shared: it is checked against every pipeline step that could use it, and each warning names the pipeline (_In 'core:spec/respond' at 'prompt': …_). A template may fit one pipeline and not another, so that alone is no reason to refuse the save.

**Selecting it where it does not fit is refused.** When you choose a template for a step, it is checked against exactly what that step supplies. That means that step's context, its declared bands such as `secretEntry`, and its prompts. A template that uses a name nothing there supplies is refused, and the selection is not stored:

> 'prompt' can't render 'Riddle layout': it uses `secretEntri`, which nothing supplies here. Did you mean `secretEntry`? Available: …

Warnings never refuse. Nor does a name at a step where something upstream supplies values without saying what they are: the name may still arrive, so you get a warning instead. A pipeline's own templates are held to the same rule when it is published: a preset's template that does not fit its step is refused, and so is a plugin's shipped template when the plugin is packaged.

**Templates you already chose are never refused afterwards.** At startup, Serene Pub checks every stored template choice against the step it is chosen for. It changes nothing. A choice that would be refused today is listed in the server log with the same sentence, and the pipeline keeps running exactly as before.

The warnings are deliberately conservative. A name is only reported when it must come from the context: fields of a loop item, loop bindings, `{% assign %}`d names, `@key`/`forloop.last` and every helper or filter core registers are excluded. Where the value's shape is declared, a misspelled field is caught too — inside a loop, inside a condition like `(and a b)`, and in either language — and the warning suggests the name you probably meant. Where the shape is not declared (a value typed "any", a map keyed by whatever the data chose, a computed `lookup`), nothing is guessed. A Handlebars helper nobody registered is reported as well: it would fail when the prompt is built.

## Block helpers: systemBlock, assistantBlock, userBlock

Three custom block helpers structure the output by speaker role: `{{#systemBlock}}...{{/systemBlock}}` wraps system-level content, `{{#assistantBlock}}...{{/assistantBlock}}` wraps a line spoken by an AI-controlled character, and `{{#userBlock}}...{{/userBlock}}` wraps a line spoken by the player's persona. The connection adapter is responsible for turning these blocks into whatever shape the target API needs — separate chat messages with `system`/`assistant`/`user` roles for chat-mode connections, or concatenated into one flat prompt (using the connection's selected [Prompt Format](./connections.md#prompt-formats-and-token-counters)) for text-completion connections. An `{{eq role "assistant"}}` helper is used inside the `{{#each sessionMessages}}` loop to branch on each message's role.
