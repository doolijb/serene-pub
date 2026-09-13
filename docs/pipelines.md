# Pipeline Configurations

A **pipeline** is the sequence of steps that produces one thing — a character's reply, a narrator's line, a summary, an image. A **configuration** is a named set of values for one pipeline: which prompt each step uses, which connection it sends to, how many messages the transcript window holds, what share of the budget lore gets. You pick and edit them in the **Pipelines** panel, and every pipeline arrives with one Serene Pub ships.

Configurations are an **administrator's**. Everyone else _selects_ among the ones on offer — per session, from the session's own sidebar — which is why the panel has no create/rename/delete buttons for a non-admin.

## Deviations, not values

**A configuration stores only what you changed.** A setting you have never touched has nothing stored for it at all: it reads its value from the pipeline itself, every time it runs.

That is the whole rule, and three useful things fall out of it.

**You can see what you changed.** Because a stored value only exists where somebody set one, a stored value _is_ a change. Settings you have tuned carry a small marker beside them in the panel, and the **Changes** tab lists all of them for the configuration you have selected — the step, the setting, and what it was before next to what it is now. A configuration you have not touched shows an empty list, which is the honest answer rather than a page of settings all agreeing with the defaults.

**Defaults you have not overridden keep improving.** When an update corrects a shipped default — a budget that was too small, a transcript window that was never the number it claimed — every configuration that had not changed that setting picks up the new value on the next start. Only the settings you deliberately set stay where you put them. Before 0.6 this was not true: every configuration held a private copy of every default, so a corrected number reached nobody and each correction needed its own repair step.

**Resetting is genuinely resetting.** The **Reset** button beside a setting removes what you stored rather than writing today's default into it — so that setting goes back to following the pipeline, including the next time the pipeline's own answer changes. **Reset all**, in the Changes tab, does the same for every setting in the configuration at once. Setting a value _back_ to the default by hand has the same effect as pressing Reset: nothing is stored, because there is nothing to say.

### What always keeps a stored value

Some settings are a **choice of row** rather than a number or a switch: which prompt a step uses, which context template, which layout, which connection, which sampling settings. Those have no "declared default" to fall back to — the value is a thing you picked from a list — so a configuration always stores the pick, and it appears in the Changes tab with only the current side filled in. Reset still works: the step falls back to the prompt or template Serene Pub ships for it.

A step declares which template languages it renders, and it may declare more than one — the story string renders both Handlebars and Liquid. Where it does, the template picker lists every accepted language together and names each row's language beside it, and the `+` beside the picker splits into one button per language. New templates are written in the step's first declared language, which for everything Serene Pub ships is Handlebars. See [Context Templates](./context-templates.md#choosing-the-language).

### Upgrading from before 0.6

The first start after upgrading tidies each configuration: any stored value that merely repeated a default is dropped, and the settings you actually changed are left exactly as they are. Nothing you tuned is lost, and nothing changes what it does — a dropped value and the default it repeated are the same number. What changes is afterwards: those settings now follow the pipeline instead of a copy of it.

## When a preset's pipeline is missing

A session preset binds each of its genre's events to a pipeline (**Admin → Session presets**, _Event bindings_). If one of those pipelines stops being available — an upgrade republished it against a different event, a plugin that shipped it was removed, an import brought the preset without its pipelines — the sessions using it do **not** stop: each turn runs the genre's default pipeline for that event, and every surface says so rather than substituting quietly. The preset is flagged in the presets list and on its own page with the bound slug and a **Rebind** button, the session shows a banner, and the run's report names the substitution. Saving a binding that does not resolve is still refused outright — the fallback exists for the instance changing underneath a preset, not for typing one in.

Notices clear themselves: the check runs at every start, so republishing or reinstalling the pipeline removes the flag with no action of yours.

## Prompt blocks are a preset's config

**Prompt blocks** are the sections a prompt is built from: the instructions, the character cards, the personas, the scenario, the world lore, the history, the relationships. Which of them are in the prompt, and in what order, is a setting on the pipeline's assembly step — **Prompt blocks**, in the Pipelines panel — and it belongs to the configuration, not to a session.

That is what makes it a preset's. A session preset names a configuration for each pipeline it binds, so a configuration with the cast moved above the instructions reaches every session started from that preset with nothing to switch on and nothing to copy. Sessions do not carry their own block order; changing one changes the configuration, which is an administrator's.

The list is reordered by dragging a row or with the arrows beside it, and a block is taken out of the prompt either by switching it off — which keeps its place — or by removing it, which forgets where it sat. It behaves like every other setting in the panel: a changed dot beside it, a Reset that goes back to inheriting, and a place in the Changes tab. Putting the order back by hand stores nothing, because the shipped order is what the setting inherits.

Two things it deliberately does **not** do. It never refuses a turn: a block named here that the selected context template does not render is ignored, and the run's report says which. And it leaves a context template alone until you change something — the shipped order is the shipped template's own order, so a template you wrote keeps the order you put its sections in until you say otherwise. Where a template has text sitting between two of its blocks, the order is not applied at all and the report says why, rather than moving a heading away from the section it heads.

## Specs and types are content-addressed

A pipeline and each of its step types are named by a **slug** — `core:spec/respond@1.20.0` for the reply pipeline, `core:query/vector-search@1` for one of its steps. A slug is a **name for whatever that pipeline or step currently is**, not a name for one fixed version of it.

What a slug points at is a **content hash**: a short string computed from the pipeline's own definition, or from the step type's own declaration. Change the definition and the hash changes with it. Two installs running the same build compute the same hash for the same pipeline, which is what makes an imported pipeline verifiable rather than trusted.

Serene Pub keeps every definition a slug has ever pointed at, filed under its hash, and remembers which one is **current**. Starting up compares the definitions in the build against the ones already stored: anything unseen is filed, and the slug's current pointer moves to it. Nothing stored is ever rewritten or removed.

That is why an update to a shipped pipeline reaches you. Before 0.6 a pipeline was identified by its version number alone, so a corrected pipeline published under an unchanged version simply did not arrive: an install that had already started once kept running the old definition, silently, and each correction had to ship a repair step of its own to dislodge it.

**A run's report names the definition it used.** Open a run in the Runs panel and the header shows the slug, the version, and the first part of the hash. If the pipeline has been edited since — by an update, or by an extension being installed — the hash is marked _superseded_. The report is still an accurate account of that run; the mark is there because it is no longer a description of what the same button does today.

## One generating step, or several

A reply pipeline with **one generating step** is sent by the connection itself: the pipeline builds the prompt, hands it over, and the answer streams straight into the message. That is every chat turn, and it is the cheapest shape there is.

A reply pipeline with **several** cannot work that way, because only the first step's prompt would ever be sent. Those run end to end instead: every step in order, the pipeline's own save step writing the reply into the message you are already looking at. While it runs, a card above the composer names the stage and the count of stages finished, and carries a stop button that ends the run wherever it is. Whichever step actually produces the prose streams into the reply as it is written; the rest are stages on the card, because a planning step's answer is not something to read.

The choice is made from the pipeline, by counting its generating steps, and never from the session type. A pipeline of your own with two generating steps runs end to end on a chat session; a genre whose reply pipeline has one keeps the streamed, single-call shape. A stopped run records where it stopped on its receipt, and anything its earlier steps already wrote stays written.

## Pipelines that use tools

A step can be given **tools** — named, read-only lookups the model may ask for
by name mid-turn instead of guessing. Serene Pub ships four: search the
session's lorebook, read one entry in full, find where a phrase was said in the
conversation, and read what has already been summarised. An extension can
contribute more, and an install's enabled extensions are offered alongside the
built-in ones without anybody rewriting a pipeline.

A pipeline that uses them repeats a small block: ask the model, run whatever
tool it asked for, put the answer in front of it, ask again — until it answers
instead of asking, or until the step's **maximum passes** is reached. That
maximum is not optional and it is yours to set: it is the only thing standing
between a model that keeps asking and a turn that never ends. The run's report
says which of the two ended it, how many passes there were, and what each tool
returned, so "why did this take eight calls" is answerable afterwards.

Nothing a tool does can change anything. They read; the pipeline's single write
happens once, after the block, exactly as it does on every other pipeline.

**Tool loop (reference)** in the pipelines list is a worked example, deliberately
offered on no session type — it is there to be read and copied, not run from a
composer.

## Inspecting a run

Every run leaves a report, and the **run inspector** is how you read one. It opens from three places: the **Inspect run** action in an assistant message's ⋮ menu, the **Inspect** button on the progress card once a run finishes, and a row in the **Runs** list of the pipelines section in `/admin`.

It opens on a single sentence saying what happened, so the first glance answers the question: _Ran all 14 nodes_, or _Ran all 25 nodes; the reply adapter sent generate's prompt and wrote the message_, or _Halted at keeperWrite_ with the reason the pipeline gave.

A Chat reply is the second sentence. Its pipeline has one generating stage and no stage after it: the pipeline stops at the payload, the connection adapter sends it and streams the reply into the message, and the message is what the run left behind. The receipt is written before the send and patched afterwards, so once the reply is in, the generate stage reads _ok_ with the reason _sent by the reply adapter_, its prompt and completion token counts, the finish reason the service reported, and the reply text under **Output**. A reply you stopped reads _Stopped at generate on request_; one the service failed reads _Failed at generate_ with a redacted reason, the full text staying on the message's administrator detail and the Wire tab. Only an older receipt, or a run that really did stop at the payload and leave nothing behind, still reads as a preview. Beside it are the pipeline it used, the document hash and whether that is still the current one, the time, the token count, what triggered it, and what the run left behind.

Under that are two levels and no third. On the left, every stage in the order it ran, each with its node key, its type, how long it took, and a marker on the stages that called a model. Select one and the pane beside it shows that stage alone:

- **Prompt** shows the payload, and says whether the stage sent it, rendered it, or was handed it and then stopped. Allocated blocks are a table with their source, name, token cost, whether they made it in, and the line each stage left explaining why. The rendered messages follow, as readable text with their roles. A stage that assembles a prompt also says what it did with the post-history reminder: _included at message 12_, or _suppressed, 278 tokens is below the 100000 trigger_. A suppressed reminder leaves nothing in the payload, so without that line there is no way to tell it apart from a configuration that has no reminder at all. See [Context Templates](./context-templates.md) for the two numbers behind it.
- **Output** shows what the stage published. Long text is shown as text; everything else is JSON behind a disclosure, with a copy button.
- **Wire** appears on a stage that reached a model server. It lists every stop sequence with its kind, and whether it went on the wire or was held back. On a chat wire the roles carry the structure, so format and speaker stops are held back and the reply stops on the model's own tokens instead. The structured-output mode is named here too.
- **Notes** shows whatever the stage recorded about itself.

**What the adapter actually sent.** Above the stop lists, the Wire tab shows the exchange itself: the URL and method the connection's adapter posted to, the request body it built (pretty-printed, with a **Copy request** button), and the raw response as it arrived, before anything was parsed out of it. A streamed reply says how many frames it came in; a long one is kept to the first 64 KB and says so. A stage that made more than one call lists each. That is what the receipt has instead of a proxy: the assembled prompt is one rendering earlier, and the prompt format, role mapping, sampler names, `stop` list and structured-output field a given service wants are only visible here. When it is present, the **Prompt** tab shows those turns as the adapter sent them and labels them so.

Connections belong to the administrator, so a stage that called a model shows only that it did. The model name, the connection, the request it built and the whole exchange above are administrator-only. A request cannot be described without naming where it went, so for everyone else the exchange is removed at the server and the tab shows the stop lists alone, without the wire mode that decided them. The inspector shows what the server sent rather than reconstructing anything that was withheld.

## Related

- [Context Templates](./context-templates.md) — the structure a step's prompt is rendered into, chosen per pipeline in this panel.
- [Prompt Configs](./prompt-configs.md) — the written instructions a step sends.
- [Connections](./connections.md) — which model server a step talks to.
- [System Settings](./system-settings.md) — instance-wide defaults that sit underneath all of this.
- For developers: a pipeline step's settings are **declared by its node type**, and the code behind that step is typed from the same declaration — so a setting that does nothing, or code reading a setting nobody declared, is a build error rather than a control that quietly has no effect. See [Handler input types come from the contract](https://github.com/doolijb/serene-pub/blob/main/INTEGRATING.md#handler-input-types-come-from-the-contract).
