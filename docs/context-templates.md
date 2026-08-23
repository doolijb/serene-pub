# Context Templates

Where a [Sampling Config](./connections.md#sampling-configs) controls _how_ a model samples tokens, a **Context Template** controls _what_ gets sent to it — the Handlebars template that assembles the system block, character and persona data, scenario, lorebook entries, chat history, and post-history reminders into the final request.

**Context Templates are distinct from Prompt Configs.** A [Prompt Config](./prompt-configs.md) supplies the free-text _instructions_ — writing style, tone, rules — that get slotted into the template via the `{{{instructions}}}` variable below. The template is the structure itself.

**They are also distinct from variable layouts.** A template says _where_ the character cards sit; a [variable layout](#variable-layouts-where-the-headings-and-fences-come-from) says _how each one is written out_ — JSON or prose, with or without a heading. That split is new in 0.6 and is described in full below.

## Where they live

A Context Template is chosen per pipeline, in the **Pipelines** panel, on the step that assembles the prompt. That is a change from 0.5, where a single Context Config was selected instance-wide and per user.

Templates are **shared across pipelines, not owned by one**. A template is compatible with the _kind of step_ that renders it, so one written while configuring chat replies is equally selectable for the narrator — the two run the same assemble step and see the same values. The picker groups by where a template came from (this pipeline's, then the ones Serene Pub ships, then everything else that fits) so a long list stays navigable, but nothing is ever hidden from you.

A pipeline with no assembling step — the summarizers, the graph builder — has no Context Template setting at all, so their settings never fill up with templates written for chat.

## Editing and creating your own

The built-in **Default** is immutable, so customizing means duplicating it first and editing the copy. Everything already pointing at the original keeps working, which is the reason the shipped ones do not change in place.

A template is an advanced, all-or-nothing thing to edit: malformed Handlebars breaks every pipeline selecting it, so it is worth trying changes on a low-stakes chat before making one an instance default.

Deleting refuses while any pipeline or chat still selects the template. Because templates are shared, that may well be a pipeline you are not looking at — point that setting elsewhere first, then delete.

## Upgrading from 0.5: legacy Context Configs

0.5 stored these in a **Context Configs** table, selected from a Contexts sidebar of its own. That sidebar is now a tab inside **Legacy configs**, alongside the old Prompt Configs. 0.6 replaces that with the table described here, and carries your data across: whatever each scope had selected is copied into the new table and re-selected, so prompts come out the same on the first boot after upgrading.

The old rows are kept, read-only, so nothing you wrote is lost while you check the migration landed. Nothing in 0.6 renders from them, and they are removed in a later release.

One thing the migration handles for you: a template you wrote yourself still contains its own headings and fences, because nothing rewrites your work. Those installs are pinned to the **bare** variable layouts so the heading is written once rather than twice — see below.

## The default template and available variables

The built-in **Default** Context Config's template (shown here verbatim) illustrates every variable and helper Serene Pub currently interpolates:

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

{{#each chatMessages as |chatMessage msgIndex|}}
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

- **`currentDate`**, **`instructions`** (from the active Chat Prompt), **`characters`** and **`personas`** (each rendered as JSON), **`scenario`**, **`worldLore`**, **`history`**, and **`speakerRelationships`** — all optional (wrap them in `{{#if ...}}` since they may be empty). Each of these arrives already formatted by its **variable layout** — see below.
- **`relationshipsPerspectives`** (how the speaking character regards the others) and **`relationshipsKnown`** (how they are regarded in return, plus any figures the world knows of) each arrive already wrapped in their heading and fence by their variable layout, like every other block above. They were one `speakerRelationships` block before 0.6; a cloned template still using that name will parse, but nothing supplies it any more, so it renders empty. It is built fresh for whoever is speaking: their own outgoing relationships, relationships other cast members in the chat have pointed at them, and any bindings marked **legendary** (the one layer that also carries a binding's Summary). It is assembled independently of the infill engines below and is included on every generation that has a lorebook with a bound speaker.
- **`narrativeGraph`** is a legacy variable that still parses but is **currently switched off at the source** — it always renders empty, so a `{{#if narrativeGraph}}` block never outputs anything. `speakerRelationships` replaced it. If you cloned the default template before that change, your relationships block is silently empty and should be swapped for `speakerRelationships`.
- **`chatMessages`** — an array iterated with `{{#each ... as |chatMessage msgIndex|}}` (the `msgIndex` block param is what lets the post-history block below find its target position), each entry exposing `role`, `name`, and `message`.
- **`postHistory`** — see below.

Triple-brace `{{{...}}}` is used throughout to output raw text/JSON without HTML-escaping. Since 0.6 this matters more than it used to: a variable's value now carries its own heading and fence, so reading one through a double brace (`{{scenario}}`) HTML-escapes the fence itself and puts `&quot;&quot;&quot;` in your prompt. Use `{{{...}}}` for every variable in the list above.

### Variable layouts: where the headings and fences come from

Notice that the template above contains no `Assistant Characters (AI-controlled):` heading and no ` ```json ` fence — just `{{{characters}}}`. Through 0.5 those were typed into the template. Since 0.6 they live in a **variable layout**: a small, reusable template that renders one variable, chosen per pipeline in the **Pipelines** sidebar.

The split is by responsibility. The context template owns _structure_ — message blocks, placement, `{{#if}}` and `{{#each}}` — and has no opinion about how the data inside is presented. A layout owns _presentation_ — the heading, the fence, the shape of the JSON, how each property is written out.

What this buys you is that changing how characters are rendered no longer means rewriting the whole context template. Duplicate the shipped **Titled JSON block** layout for `characters`, delete the JSON, write prose instead, and every pipeline that renders characters can select it — the same row is offered in the narrator's settings as in the chat reply's, because a layout is keyed by _what it renders_ rather than by which pipeline you were configuring when you wrote it.

Two rows ship for each wrapped variable:

- **Titled JSON block** / **Titled block** / **Sentence** — the heading and fence, exactly as 0.5 wrote them. This is what a new install selects, so upgrading changes nothing about your prompts.
- **JSON** / **As written** — the value alone, with no heading.

The shipped rows are immutable; customizing means duplicating one first, the same as with the Default Context Config itself.

**If you wrote your own context template**, it still contains your own headings and fences — nothing rewrites a template you authored. Upgrading to 0.6 pins that template's pipelines to the bare **JSON** / **As written** layouts, so the wrapper keeps coming from where you put it and is not written twice. If you later strip the headings out of your template, switch those settings to the titled layouts to get them back.

A variable with nothing in it renders nothing at all, heading included — so a `{{#if worldLore}}` guard around it behaves exactly as it always has.

### The postHistory object

Rather than a single flat "post-history instructions" variable rendered once after the whole chat history, the post-history reminder is a small object, `postHistory`, accessed with `{{#with ../postHistory}}` from inside the `{{#each chatMessages}}` loop (the `../` reaches out of the each-block's own scope to the top-level `postHistory`):

- **`targetIndex`** — which message index the reminder should render at. Computed from the active Chat Prompt's **Post-History Depth** setting: depth 0 targets the last entry in `chatMessages` (the seed/prefill placeholder the model continues writing from), depth _N_ targets _N_ real messages earlier than that. A depth larger than the available history clamps to the oldest position rather than vanishing.
- **`hasContent`** — `true` if any of `instructions`, `charInstructions`, or `exampleDialogue` below are populated; lets the template gate the whole reminder block in one check rather than three.
- **`instructions`** — the active Chat Prompt's own **Post-History Instructions** text (see [Prompt Configs](./prompt-configs.md)), gated by that config's **Post-History Token Trigger**: below the trigger threshold, this is left empty so a short chat doesn't get a redundant reminder — the reminder only kicks in once the conversation is long enough that the system prompt feels distant.
- **`charInstructions`** — the current character's own **Post-History Instructions** field (see [Characters](./characters.md)), rendered whenever the character has one set, with no token-trigger gating. This is a distinct, character-authored reinforcement note, separate from the Chat Prompt's `instructions` above.
- **`exampleDialogue`** — the current character's **Example Dialogues** field. Unlike earlier versions of this template, example dialogue is rendered here (near the generation point) rather than up in the top system block — a model many turns deep into a conversation benefits more from seeing example dialogue right before it writes than from seeing it once, far above the recent history.

The template checks `(and (eq msgIndex targetIndex) hasContent)` inside the loop so the reminder block renders exactly once, at exactly the right position, only when there's actually something to say.

**A `{{/each}}` boundary matters here.** `chatMessages`' last entry is always the seed/prefill placeholder (`"Name: "`, the turn the model continues writing from) — it must stay the literal final block in the rendered output for that continuation to work. Rendering a post-history reminder _after_ `{{/each}}` instead of inside the loop (gated on the target message) would push a system block after the seed, breaking it into a standalone, non-continued turn.

## Context Infill Engines

Deciding _which_ lorebook entries and _which_ older chat messages actually make it into `worldLore`, `history`, and each character's lore (see below) — out of everything that could — is the job of one of two Context Infill Engines. Both fill the same template variables in the same shapes; they differ only in _how_ they pick what qualifies. (`speakerRelationships` is not one of their outputs — it's built separately from the speaker's own graph bindings and doesn't change with the engine in use.)

### Which engine runs

The RAG Infill Engine runs when all of the following are true: embeddings/vectorization is enabled system-wide, the embedding model is loaded and ready, and the current chat hasn't opted out via its own "Ignore for this chat" RAG toggle (see [Understanding RAG Notices](./embeddings-and-rag.md#understanding-rag-notices)). If any of those don't hold — or if the RAG engine fails for any reason — the Keyword Infill Engine runs instead, with nothing surfaced beyond a server-side warning log. In practice: turn Embeddings on and Serene Pub retrieves semantically; leave it off (or a chat opts out) and it retrieves by keyword instead — one or the other is always active, never neither.

### Keyword Infill Engine

Used whenever vectorization is off (see [Lorebooks: Two retrieval modes](./lorebooks.md#two-retrieval-modes-change-what-fields-you-see)). This isn't a plain "most recent N entries" fallback — it's a real relevance scorer that runs without needing any embeddings:

- **Keyword matching** — each entry's comma-separated **Keywords** field is checked against the last 10 messages (case-insensitive substring matching by default, or exact-case / regex if the entry's **Case Sensitive** / **Use Regex** switches are on).
- Combined with several other cheap signals: whether the entry's own name is mentioned literally in that window, whether characters/personas already in the scene co-occur with it, a TF-IDF term-frequency score across the whole chat, and how recently a matching keyword last appeared.
- The entry's **Priority** level (see [Lorebooks](./lorebooks.md)) adds a flat bonus on top of that combined score — a high-priority entry with a weak keyword match can still outscore a low-priority entry with a stronger one.
- Every candidate — world lore, character lore, and history entries, plus older chat messages — is scored this way, merged into one ranked pool, and filled greedily until either a per-content-type count cap (up to 20 world lore entries, 15 character lore entries, 10 history entries, and 50 messages) or the available token budget is reached, whichever comes first.

### RAG Infill Engine

Used whenever vectorization is enabled and ready. Selects by embedding similarity against the current conversation instead of keyword matching — the full mechanics (two-pass queries, Reciprocal Rank Fusion, Maximal Marginal Relevance re-ranking, per-content-type token budgets) are documented in [Embeddings & RAG](./embeddings-and-rag.md#how-serene-pub-ranks-retrieved-content).

### What both engines guarantee, regardless of which one runs

- The most recent 10 messages in a chat are always included, never subject to either engine's selection.
- A **Pinned** lorebook entry is always included, bypassing both keyword matching and semantic scoring entirely.
- the two relationship blocks are identical either way — it's built outside both engines — and the `postHistory` object (above) is computed identically regardless of which engine selected the surrounding content.
- Within `{{{worldLore}}}` and `{{{history}}}`, entries are ordered by relevance (highest first), not by an entry's position or date in the lorebook — which entry ends up first can change from one generation to the next as the conversation moves. **Character Lore has no top-level template variable of its own** — qualifying entries are attached directly onto their bound character's own object inside `{{{characters}}}`, under an `"extra lore"` key, rather than appearing as a separate `{{characterLore}}` variable.
- Under Keyword mode specifically, each content type has a hard count cap in addition to the token budget (see above); RAG mode uses its own per-type token budgets instead of a fixed entry count. Either way, once the model's context window is the tighter constraint, content simply stops being added for that generation — see [Sampling Configs](./connections.md#sampling-configs) for how Context Tokens sets that limit.

## Why character, persona, and lore data is JSON, not prose

`characters`, `personas`, `worldLore`, `history`, and the two relationship blocks are all fenced as ` ```json ` blocks, while `instructions` and `scenario` stay wrapped in plain `"""` prose fences, and the post-history reminder fields (`instructions`, `charInstructions`, `exampleDialogue` inside `postHistory`) use ` ```text ` fences. (The first two groups get their fences from their variable layouts, as described above; the post-history fields are still fenced in the template, since they come off the `postHistory` object rather than from a variable of their own.) That split is deliberate: the JSON-fenced fields are _facts_ (who someone is, what they know, what happened), and the prose/text-fenced fields are _directives_ (how to write, what tone to take, what's happening right now) — the template keeps those two kinds of content visibly distinct rather than blending everything into one undifferentiated paragraph.

The reasoning behind serializing the factual side as JSON specifically:

- **Explicit key boundaries reduce attribute bleed.** In a group chat with several characters, prose descriptions concatenated back-to-back are genuinely ambiguous for a model to attribute correctly — a trait mentioned near the end of one character's paragraph can get picked up as belonging to the next one. A JSON array of objects with explicit `name` keys removes that ambiguity structurally, independent of how any individual field is written.
- **It's a base-model competency, not a roleplay one.** The instinct is that RP-oriented models — fine-tuned mostly on the prose/PList-style character cards common across other popular roleplay applications — would parse JSON _worse_ than the format they were tuned on. In practice, RP fine-tuning mostly reshapes _output_ voice and pacing, not _input_ parsing; general structured-data comprehension (reinforced heavily in most base/instruct training via function-calling and tool-use data) tends to survive underneath a lighter RP fine-tune layer largely intact.
- **It keeps the retrieval paths consistent.** Both Context Infill Engines (keyword matching and RAG — see [Embeddings & RAG](./embeddings-and-rag.md)) serialize these same fields to JSON before injection, so switching retrieval modes doesn't also change the shape of what the model sees.

## Block helpers: systemBlock, assistantBlock, userBlock

Three custom block helpers structure the output by speaker role: `{{#systemBlock}}...{{/systemBlock}}` wraps system-level content, `{{#assistantBlock}}...{{/assistantBlock}}` wraps a line spoken by an AI-controlled character, and `{{#userBlock}}...{{/userBlock}}` wraps a line spoken by the player's persona. The connection adapter is responsible for turning these blocks into whatever shape the target API needs — separate chat messages with `system`/`assistant`/`user` roles for chat-mode connections, or concatenated into one flat prompt (using the connection's selected [Prompt Format](./connections.md#prompt-formats-and-token-counters)) for text-completion connections. An `{{eq role "assistant"}}` helper is used inside the `{{#each chatMessages}}` loop to branch on each message's role.
