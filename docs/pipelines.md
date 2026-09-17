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

**One setting for the three lore lanes.** Before 0.6 the reply pipeline offered the seven lore-retrieval knobs — how many messages are scanned, _Find without keywords_, _Title counts extra_ and the rest — three times over, once for world lore, once for character lore and once for history. They are one control now, on the world-lore step, and it governs all three sources. If you had tuned a knob on the character-lore or history lane, the upgrade moves your value onto the shared control and leaves a notice on the configuration saying so — where it came from, where it went, and what it was — because a number you set for one lane now applies to three. If you had tuned the _same_ knob on two lanes to different numbers, the world-lore lane's value is kept and the other is recorded as removed, with the value it held, so nothing you chose disappears unannounced. A session's own overrides on those lanes move the same way. The same applies to the one _enabled_ switch the two embedding steps now share.

## When a preset's pipeline is missing

A session preset binds each of its genre's events to a pipeline (**Admin → Session presets**, _Event bindings_). If one of those pipelines stops being available — an upgrade republished it against a different event, a plugin that shipped it was removed, an import brought the preset without its pipelines — the sessions using it do **not** stop: each turn runs the genre's default pipeline for that event, and every surface says so rather than substituting quietly. The preset is flagged in the presets list and on its own page with the bound slug and a **Rebind** button, the session shows a banner, and the run's report names the substitution. Saving a binding that does not resolve is still refused outright — the fallback exists for the instance changing underneath a preset, not for typing one in.

Notices clear themselves: the check runs at every start, so republishing or reinstalling the pipeline removes the flag with no action of yours.

## Prompt blocks are a preset's config

**Prompt blocks** are the sections a prompt is built from: the instructions, the character cards, the personas, the scenario, the world lore, the history, the relationships. Which of them are in the prompt, and in what order, is a setting on the pipeline's assembly step — **Prompt blocks**, in the Pipelines panel — and it belongs to the configuration, not to a session.

That is what makes it a preset's. A session preset names a configuration for each pipeline it binds, so a configuration with the cast moved above the instructions reaches every session started from that preset with nothing to switch on and nothing to copy. Sessions do not carry their own block order; changing one changes the configuration, which is an administrator's.

The list is reordered by dragging a row or with the arrows beside it, and a block is taken out of the prompt either by switching it off — which keeps its place — or by removing it, which forgets where it sat. It behaves like every other setting in the panel: a changed dot beside it, a Reset that goes back to inheriting, and a place in the Changes tab. Putting the order back by hand stores nothing, because the shipped order is what the setting inherits.

Two things it deliberately does **not** do. It never refuses a turn: a block named here that the selected context template does not render is ignored, and the run's report says which. And it leaves a context template alone until you change something — the shipped order is the shipped template's own order, so a template you wrote keeps the order you put its sections in until you say otherwise. Where a template has text sitting between two of its blocks, the order is not applied at all and the report says why, rather than moving a heading away from the section it heads.

## Specs and node definitions are content-addressed

A pipeline and each of its **node definitions** — the declared shapes its steps are built from — are named by a **slug** — `core:spec/respond@1.20.0` for the reply pipeline, `core:query/vector-search@1` for one of its steps. A slug is a **name for whatever that pipeline or definition currently is**, not a name for one fixed version of it.

What a slug points at is a **content hash**: a short string computed from the pipeline's own document, or from the node definition's own declaration. Change the definition and the hash changes with it. Two installs running the same build compute the same hash for the same pipeline, which is what makes an imported pipeline verifiable rather than trusted.

Serene Pub keeps every definition a slug has ever pointed at, filed under its hash, and remembers which one is **current**. Starting up compares the definitions in the build against the ones already stored: anything unseen is filed, and the slug's current pointer moves to it. Nothing stored is ever rewritten or removed.

That is why an update to a shipped pipeline reaches you. Before 0.6 a pipeline was identified by its version number alone, so a corrected pipeline published under an unchanged version simply did not arrive: an install that had already started once kept running the old definition, silently, and each correction had to ship a repair step of its own to dislodge it.

**A run's report names the document it used.** Open a run in the Runs panel and the header shows the slug, the version, and the first part of the hash. If the pipeline has been edited since — by an update, or by an extension being installed — the hash is marked _superseded_. The report is still an accurate account of that run; the mark is there because it is no longer a description of what the same button does today. One mark reads differently: _renamed_ with a date. The 0.6 release renamed the words every pipeline is written in — the five step kinds are **inlet · query · task · oracle · outlet**, the four grouping rules are **gather · each · loop · junction** — and every stored pipeline was rewritten to the new words and republished once. A report from before that day names the old document by its old hash; it still opens, and _renamed_ says the pipeline behind it is the same pipeline, not an edited one.

## Every reply is one run

A reply pipeline runs end to end, whatever its shape. It creates its own reply row as its second step — the **placeholder**, straight after the trigger's input — then retrieves, assembles, calls the model, and finishes with a **save** step that fills the row it made. The message you watch appear is that row: nothing outside the pipeline inserts it, and the run's report names it as the thing the run left behind. A regenerate, a swipe or a continue hands the pipeline the message it is re-driving, and the same placeholder step takes that row over instead of inserting a new one — a narration's or a side character's line goes back to the narrator pipeline that made it, and that pipeline's placeholder takes the row over the same way. Only a message that is already waiting on a run can be taken over: a settled message, yours or a character's, is never a placeholder for anything.

**Review, when you turn it on, lands on the save.** Nothing about a reply is reviewed by default. If an administrator switches review on for the reply's message writes in the pipeline panel, the run parks at the **save** step — after the placeholder exists and the model has answered — and a reviewer sees the reply's text, never an empty row. Approving lets the save fill the message; rejecting ends the run and the placeholder is settled with the reason, so it does not stay spinning.

**A step's switches are declared, like everything else in the panel.** Three controls come from what a step _is_ rather than from anything its author wrote: **Use this source** on a step that may be skipped (a retrieval source, an optional parse), **Review** on a step that writes or reaches outside, and **Run** — together or one after another — on a group of steps that gather in parallel. They live under _Settings_ (Review under its own heading), reset like any setting, and their shipped positions are the step's own declaration: most writes ship with review off; a step that attaches a generated image to a message ships with it on. A step with nothing to switch offers none of them.

**Streaming** is the run's, not any step's. Whichever step actually produces the prose streams into the reply as it is written; a planning step's answer or a state-keeper's are stages on the progress card above the composer, never text in the message. A pipeline with one generating step and a pipeline with five take the same road — the count decides only how many stages the card shows.

**A run says what it is doing.** Any step can set a **status** from inside its work — a short line in your language, with the speaker's name filled in: _Jasmine is thinking_ while the retrieval steps read, _Jasmine is composing_ while the prompt is assembled, _Jasmine is typing_ from the moment the model is called, _waiting for the model_ or _loading the model_ when the call is queued behind another or a managed backend is starting up (only if that wait actually lasts). A status stands until the next step sets another or the run ends; a step that says nothing leaves the last word up. It shows in three places at once — on the reply's own row beside the ember dot, on the progress card in place of the stage name, and on the session's row in the sidebar while the run is in flight — so a session you are not looking at can still say _Jasmine is typing_. A status is not a setting: nothing in the pipeline panel declares one, and a run's report does not list them step by step. The one thing the report keeps is the **last** status of a run that stopped, failed or halted — what it was doing when it ended — which the run inspector reads into its opening sentence: _Stopped at generate on request while Jasmine is typing._ A summary or a graph build says its own statuses the same way (_summarising part 2 of 5_, _merging the drafts_, _building the graph: perspective_) on the progress surface it already had; the token estimate under the composer says nothing, since nobody is watching it type.

**Stop** is a guarantee the run makes, not a step. The message's own stop button and the progress card's both end the run wherever it is: the model call is cut off, no later step runs, and the row the placeholder made is left holding whatever had arrived — out of the generating state, with no error. A reply that the model finishes a moment after you stopped is dropped, not written over the partial you kept. A stopped run records who stopped it and where on its receipt, and anything its earlier steps already wrote stays written. A run that fails after making its row fails that row with the reason, so a placeholder never stays spinning. A message's stop button stops the runs filling the messages it releases — another participant's image render or summary in the same session keeps going; the progress card's X is how that one is stopped.

**A preview writes nothing.** The token estimate under the composer runs the same pipeline up to the model call and stops there — including the placeholder step, which in a preview commits nothing and hands a marked stand-in id down the line. The estimate is the real compilation the next turn performs, and it leaves no row behind. The run's report says which steps ran dry.

**The window is computed once.** The context budget a step sizes the prompt to, the window the connection is sent with, and the token figure the pipeline panel shows beside a share all come from one calculation over the same two facts: the sampling config the generating step is pointed at, and the model's own context window where the connection's model states one. A per-step connection or sampling choice, or the session's own sampling choice, reaches all three as one answer.

## What changed since the last reply

The message actions that alter history — delete, hide, edit, swipe, branch, and a stop — are **built-ins**: Serene Pub performs each as its own one-step pipeline run (`core:spec/builtin-delete` and its siblings, a request step straight into the write step), so the write is receipted, may be put behind a review gate like any other write, and always records an event saying what changed and what was lost. A regenerate, a continue and a swipe's fresh alternative are the reply pipeline's own **save** step, whose `message-updated` event then carries the verb that re-drove the row. Which actions a genre may switch off, and which it may not, is on the [sessions page](./sessions.md#floors-built-ins-and-what-each-action-emits).

Every such event is written to the session's changes, and the next reply's input step publishes them on a `sessionChanges` port — a list, oldest first, each entry naming the event, the message, when, and what went: the deleted line's content, role and speaker; the text an edit replaced, and the reply a regenerate discarded; the alternative a swipe left behind and the index it selected; whether a hide hid or showed; how much of a stopped reply had arrived; the session and message a branch forked from (on the branched session — the source's history did not move). A pipeline reads it as `$.input.sessionChanges` — a context step of your own can tell the model that the line it remembers was rewritten — and the run's report shows the list on the input step. The reply pipelines Serene Pub ships do not yet render it into the prompt. (The port was `changes` until 2026-09-16; that word is the state ledger's, for a list of value changes, and a session change is about a message.)

Each change reaches exactly one run: the reply that receives the list marks it as read — once the reply has landed, so a reply that fails at the model or is stopped before it wrote leaves the list for the next one — and the next reply starts from an empty one; a fresh reply's own save records nothing, since history growing is not history moving. The token estimate under the composer sees the list without marking it, so previewing never eats what the turn should see. The list is capped at the newest fifty changes: when more waited, the newest fifty arrive and the list ends with a `session-changes-truncated` entry saying how many older ones were dropped, and those are marked read without being delivered. Once a change has been read, the content it carried — the deleted line, the replaced text — is let go of; the event and the ids stay, and the run that made the write keeps what it published on its receipt. See [what a delete leaves behind](./sessions.md#floors-built-ins-and-what-each-action-emits) on the sessions page.

## Where the weights live

Each retrieval step carries its own **share** of the context window — **Share — world lore** on the world-lore step, **Share — conversation** on the history step, **Share — relationships** on the ranked relationships step — beside its own **Most entries** ceiling and its **Priority**. The shares are relative: the ranker normalises whatever it is handed, so raising one takes room from the others and setting one to zero leaves that source out. The conversation alone keeps a minimum, **Always keep at least**, on its own step. A pipeline that finds all its lore through one step — the narrator pipelines do — carries the same controls for each of the three kinds of lore on that one step, under the same labels: **Share — world lore**, **Share — character lore**, **Share — history**, each with its ceiling and priority. The ranking step declares only what is about the whole pool — how the ways of finding an entry weigh against each other, how the shares divide the window, and whether the best entries lead — and nothing about any one source.

A priority of **always** keeps every entry of that source the window can hold, ahead of the scored fill — up to the source's **Most entries** ceiling, which applies whatever the share and whatever the priority. Only a pinned entry steps over the ceiling, because a pin is a promise about one entry and a priority is a promise about a source.

That arrangement is what lets a source added by an extension take part without anyone editing the ranker: its step declares its own share and ceiling, publishes them ahead of what it found, and the ranker allocates it a band on the same terms as world lore. A source that found nothing this turn still reserves its share (and hands what it did not spend to the others), which is why the number lives on the source rather than travelling with the entries. The run's report lists which bands reached the ranker from a step's own declaration and which ran on the shipped defaults, so a share that is not taking effect has one line that says why.

Upgrading from a build where the ranking step carried a **Context split**: every value you had set there was moved to the step that owns it — the world-lore step, the history step, or on a narrator pipeline the one lore step, under the band's own label — and the pipeline panel's notices say which value went where. A member holding the shipped number was simply dropped, since the owning step declares the same number; so was a relationships ceiling of 0 sitting behind a relationships share of 0, the pair every saved split carried. A relationships ceiling of 0 behind a share you had raised is the one value that is not carried over: on the ranking step it kept every relationship out, and on the relationships step 0 would switch the source off under a different word, so the notice says the graph now competes for its share and the share is the switch. The same rule reaches past that one upgrade: a session that raises the relationships share over a configuration whose ceiling is still the shipped 0 now lets relationships compete uncapped, because the share is the switch and the ceiling is only a cap once something has actually set it.

## An envoy's prompts are configuration

A genre may bring a speaker of its own — an **envoy** (see [Sessions → Envoys](./sessions.md#envoys)); the Guide genre's mascot is the first. The envoy's instructions are declared by the genre as defaults and read by the pipeline the way any authored text is: the context builder's prompts slot points at the envoy (`slot.prompts({ envoy: 'mascot' })`), and the assembly step reads the same text through the context builder, so one text serves the whole reply. There is no prompt row behind it and nothing to swap; the panel shows it as its own step, named **Envoy · Guide**, with a **System prompt** and a **Post-history instructions** field. The genre's words are the field's default; editing the field stores a deviation like any other setting, the run resolves it through the same chain (a session's override, then the selected configuration, then the genre's declaration), and clearing the field is the genre's words again.

The step appears only on a pipeline that reads the envoy — the Guide's reply, not its create pipeline — because a control nothing reads is the kind this panel refuses to show. An envoy an installed action brings gets the same treatment on the action's own pipeline, under the action's namespace.

## Pipelines that use tools

A step can be given **tools** — named, read-only lookups the model may ask for
by name mid-turn instead of guessing. Serene Pub ships four: search the
session's lorebook, read one entry in full, find where a phrase was said in the
conversation, and read what has already been summarised. An extension can
contribute more, and an install's enabled extensions are offered alongside the
built-in ones without anybody rewriting a pipeline.

A pipeline that uses them repeats a small **loop clause**: ask the model, run whatever
tool it asked for, put the answer in front of it, ask again — until it answers
instead of asking, or until the step's **maximum passes** is reached. That
maximum is not optional and it is yours to set: it is the only thing standing
between a model that keeps asking and a turn that never ends. The run's report
says which of the two ended it, how many passes there were, and what each tool
returned, so "why did this take eight calls" is answerable afterwards.

Nothing a tool does can change anything. They read; the pipeline's single write
happens once, after the loop, exactly as it does on every other pipeline.

**Tool loop (reference)** in the pipelines list is a worked example, deliberately
offered on no session type — it is there to be read and copied, not run from a
composer.

## Inspecting a run

Every run leaves a report, and the **run inspector** is how you read one. It opens from three places: the **Inspect run** action in an assistant message's ⋮ menu, the **Inspect** button on the progress card once a run finishes, and a row in the **Runs** list of the pipelines section in `/admin`.

It opens on a single sentence saying what happened, so the first glance answers the question: _Ran all 27 nodes_, or _Stopped at generate on request_, or _Halted at keeperWrite_ with the reason the pipeline gave.

A Chat reply ran all of its nodes: the placeholder that made the message, the retrieval and assembly stages, the generate stage that called the model — with its prompt and completion token counts, the finish reason the service reported, and the reply text under **Output** — and the save stage that filled the message in. A reply you stopped reads _Stopped at generate on request while Jasmine is typing_ — the last status the run had set, in your language, is part of the sentence on any run that did not finish; one the service failed reads _Failed at generate while Jasmine is typing_ with a redacted reason, the full text staying on the message's administrator detail and the Wire tab. A receipt reads as a preview only when the run really was one and left nothing behind. Beside the sentence are the pipeline it used, the document hash and whether that is still the current one, the time, the token count, what triggered it, and what the run left behind. Receipts from before this release, when the connection adapter sent the prompt from outside the pipeline, still open and still say so in their own words.

A **Portrayed by** line follows on a session turn: each participant the run concerned and who portrayed them — _Tom · AI_, _Elara · you_, another member by name; a participant nobody portrays shows its reference and _nobody_. It is decided once, when the run starts, and pinned on the receipt like the configuration, so a guest who joins while a reply is being written changes the next turn's line and never this one's. A preview that stops before the model is called carries no line. The rules that decide it are in [Sessions](./sessions.md#who-portrays-a-participant-this-turn).

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
- For developers: a pipeline step's settings are **declared by its node definition**, and the code behind that step is typed from the same declaration — so a setting that does nothing, or code reading a setting nobody declared, is a build error rather than a control that quietly has no effect. See [Handler input types come from the contract](https://github.com/doolijb/serene-pub/blob/main/INTEGRATING.md#handler-input-types-come-from-the-contract).
