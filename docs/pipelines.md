# Pipeline Configurations

A **pipeline** is the sequence of steps that produces one thing — a character's reply, a narrator's line, a summary, an image. A **configuration** is a named set of values for one pipeline: which prompt each step uses, which connection it sends to, how many messages the transcript window holds, what share of the budget lore gets. You pick and edit them in the **Pipelines** view, and every pipeline arrives with one Serene Pub ships.

Configurations are an **administrator's**. Everyone else _selects_ among the ones on offer — per session, from the session's own sidebar — which is why the view has no create/rename/delete buttons for a non-admin.

## Finding a preset's configuration

The **Pipelines** view opens on the **genres**: Chat, Adventure, Lair and the rest, plus any from enabled plugins. Each card shows its preset count and its default preset. Pick a genre to see its **session presets**. The default is marked _Default_, a preset that shipped with Serene Pub or a plugin is marked _Built-in_, and inside a session the one it started on is marked _This session_. Pick a preset to see the pipelines it runs: each event it binds (a reply, the session's creation, answering a form), then, under **Actions**, each action its sessions offer. That includes the actions a preset gets by default: a preset that names no actions of its own (every built-in one) includes every action its genre ships with, such as Chat's _Narrate_ or Lair's _Nudge_ and _Trap_ (another plugin's actions stay out until a preset names them), and they are listed here just as sessions on it show them. Each pipeline opens to the same options as before: prompts, model, sampling, templates. A preset with only one pipeline opens it straight away. If the preset names a different configuration from the one the options show, a line above them says which is which.

**Back**, at the top left, goes up one level. Close the view and reopen it, and it opens where you left it. At desk width the genres stay on the left and the level you opened shows on the right.

**All pipelines**, below the genres, is the flat list of every pipeline on the instance, whichever preset uses it. It is how you reach a pipeline no preset binds. Administrators also get **Manage pipeline** on each pipeline and **Edit preset bindings** on each preset, which opens the preset's page in Admin, where its bindings are changed.

## Deviations, not values

**A configuration stores only what you changed.** A setting you have never touched has nothing stored for it at all: it reads its value from the pipeline itself, every time it runs.

That is the whole rule, and three useful things fall out of it.

**You can see what you changed.** Because a stored value only exists where somebody set one, a stored value _is_ a change. Settings you have tuned carry a small marker beside them in the view, and the **Changes** tab lists all of them for the configuration you have selected — the step, the setting, and what it was before next to what it is now. A configuration you have not touched shows an empty list, which is the honest answer rather than a page of settings all agreeing with the defaults.

**Defaults you have not overridden keep improving.** When an update corrects a shipped default — a budget that was too small, a transcript window that was never the number it claimed — every configuration that had not changed that setting picks up the new value on the next start. Only the settings you deliberately set stay where you put them. Before 0.6 this was not true: every configuration held a private copy of every default, so a corrected number reached nobody and each correction needed its own repair step.

**Resetting is genuinely resetting.** The **Reset** button beside a setting removes what you stored rather than writing today's default into it — so that setting goes back to following the pipeline, including the next time the pipeline's own answer changes. **Reset all**, in the Changes tab, does the same for every setting in the configuration at once. Setting a value _back_ to the default by hand has the same effect as pressing Reset: nothing is stored, because there is nothing to say.

### What always keeps a stored value

Some settings are a **choice of row** rather than a number or a switch: which prompt a step uses, which context template, which layout, which connection, which sampling settings. Those have no "declared default" to fall back to — the value is a thing you picked from a list — so a configuration always stores the pick, and it appears in the Changes tab with only the current side filled in. Reset still works: the step falls back to the prompt or template Serene Pub ships for it.

A step declares which template languages it renders, and it may declare more than one — the story string renders both Handlebars and Liquid. Where it does, the template picker lists every accepted language together and names each row's language beside it, and the `+` beside the picker splits into one button per language. New templates are written in the step's first declared language, which for everything Serene Pub ships is Handlebars. See [Context Templates](./context-templates.md#choosing-the-language).

### Upgrading from before 0.6

The first start after upgrading tidies each configuration: any stored value that merely repeated a default is dropped, and the settings you actually changed are left exactly as they are. Nothing you tuned is lost, and nothing changes what it does — a dropped value and the default it repeated are the same number. What changes is afterwards: those settings now follow the pipeline instead of a copy of it.

**One setting for the three lore lanes.** Before 0.6 the reply pipeline offered the seven lore-retrieval knobs — how many messages are scanned, _Find without keywords_, _Title counts extra_ and the rest — three times over, once for world lore, once for character lore and once for history. They are one control now, on the world-lore step, and it governs all three sources. If you had tuned a knob on the character-lore or history lane, the upgrade moves your value onto the shared control and leaves a notice on the configuration saying so — where it came from, where it went, and what it was — because a number you set for one lane now applies to three. If you had tuned the _same_ knob on two lanes to different numbers, the world-lore lane's value is kept and the other is recorded as removed, with the value it held, so nothing you chose disappears unannounced. A session's own overrides on those lanes move the same way. The same applies to the one _enabled_ switch the two embedding steps now share.

## When a preset's pipeline is missing

A session preset binds each of its genre's events to a pipeline (**Admin → Presets**, _Event bindings_). If one of those pipelines stops being available — an upgrade republished it against a different event, a plugin that shipped it was removed, an import brought the preset without its pipelines — the sessions using it do **not** stop: each turn runs the genre's default pipeline for that event, and every surface says so rather than substituting quietly. The preset is flagged in the presets list ("1 binding unavailable" on its row, which a sort puts first) and on its own page with the bound slug and a **Rebind** button, the session shows a banner, and the run's report names the substitution. Saving a binding that does not resolve is still refused outright — the fallback exists for the instance changing underneath a preset, not for typing one in.

Notices clear themselves: the check runs at every start, so republishing or reinstalling the pipeline removes the flag with no action of yours.

## Prompt blocks are a preset's config

**Prompt blocks** are the sections a prompt is built from: the instructions, the character cards, the personas, the scenario, the world lore, the history, the relationships. Which of them are in the prompt, and in what order, is a setting on the pipeline's assembly step — **Prompt blocks**, in the Pipelines view — and it belongs to the configuration, not to a session.

That is what makes it a preset's. A session preset names a configuration for each pipeline it binds, so a configuration with the cast moved above the instructions reaches every session started from that preset with nothing to switch on and nothing to copy. Sessions do not carry their own block order; changing one changes the configuration, which is an administrator's.

The list is reordered by dragging a row or with the arrows beside it, and a block is taken out of the prompt either by switching it off — which keeps its place — or by removing it, which forgets where it sat. It behaves like every other setting in the view: a changed dot beside it, a Reset that goes back to inheriting, and a place in the Changes tab. Putting the order back by hand stores nothing, because the shipped order is what the setting inherits.

Two things it deliberately does **not** do. It never refuses a turn: a block named here that the selected context template does not render is ignored, and the run's report says which. And it leaves a context template alone until you change something — the shipped order is the shipped template's own order, so a template you wrote keeps the order you put its sections in until you say otherwise. Where a template has text sitting between two of its blocks, the order is not applied at all and the report says why, rather than moving a heading away from the section it heads.

## Specs and node definitions are content-addressed

A pipeline and each of its **node definitions** — the declared shapes its steps are built from — are named by a **slug** — `core:spec/respond@1.20.0` for the reply pipeline, `core:query/vector-search@1` for one of its steps. A slug is a **name for whatever that pipeline or definition currently is**, not a name for one fixed version of it.

What a slug points at is a **content hash**: a short string computed from the pipeline's own document, or from the node definition's own declaration. Change the definition and the hash changes with it. Two installs running the same build compute the same hash for the same pipeline, which is what makes an imported pipeline verifiable rather than trusted.

For a node definition the hash covers its **contract** — what a pipeline naming it runs against: its ports and shapes, its settings and their schema, what it may write, which fields a reviewer may edit, whether it may fail empty. It does not cover its **policy** — what is offered or shown: whether it is provisional, where its review gate starts, how long a step may take, what it is called. Policy is kept on the registry row beside the hash and refreshed in place, so changing it reaches every install without the slug moving.

Serene Pub keeps every definition a slug has ever pointed at, filed under its hash, and remembers which one is **current**. Starting up compares the definitions in the build against the ones already stored: anything unseen is filed, and the slug's current pointer moves to it. Nothing stored is ever rewritten or removed.

That is why an update to a shipped pipeline reaches you. Before 0.6 a pipeline was identified by its version number alone, so a corrected pipeline published under an unchanged version simply did not arrive: an install that had already started once kept running the old definition, silently, and each correction had to ship a repair step of its own to dislodge it.

**A definition has a status.** Every node definition the registry holds is one of four things. **Live** is the ordinary case: bound to code that runs it, offered wherever definitions are offered. **Provisional** is declared but not yet runnable — a definition kept because a plan owns it (text-to-speech and the two MCP steps today). It appears nowhere a pipeline is built from, a pipeline that places one does not publish, and a stored pipeline that already places one halts at that step with a sentence saying so. **Removed** is a definition this build does not publish any more: starting up marks the row rather than deleting it, because a pipeline you kept may still name it — that pipeline's configurations get a notice reading _cannot run_ against the step, and the step halts legibly until the pipeline is edited. A removed definition that a later build publishes again simply comes back live. **Deprecated** is the one status a person sets, and an update never touches it.

**A run's report names the document it used.** Open a run in the Runs panel and the header shows the slug, the version, and the first part of the hash. If the pipeline has been edited since — by an update, or by an extension being installed — the hash is marked _superseded_. The report is still an accurate account of that run; the mark is there because it is no longer a description of what the same button does today. One mark reads differently: _renamed_ with a date. The 0.6 release renamed the words every pipeline is written in — the five step kinds are **inlet · query · task · oracle · outlet**, the four grouping rules are **gather · each · loop · junction** — and every stored pipeline was rewritten to the new words and republished once. A report from before that day names the old document by its old hash; it still opens, and _renamed_ says the pipeline behind it is the same pipeline, not an edited one.

## Every reply is one run

A reply pipeline runs end to end, whatever its shape. It creates its own reply row as its second step — the **placeholder**, straight after the event's input — then retrieves, assembles, calls the model, and finishes with a **save** step that fills the row it made. The message you watch appear is that row: nothing outside the pipeline inserts it, and the run's report names it as the thing the run left behind. A regenerate, a swipe or an extend hands the pipeline the message it is re-driving, and the same placeholder step takes that row over instead of inserting a new one — a narration's or a side character's line goes back to the narrator pipeline that made it, and that pipeline's placeholder takes the row over the same way. Only a message that is already waiting on a run can be taken over: a settled message, yours or a character's, is never a placeholder for anything.

**Review, when you turn it on, lands on the save.** Nothing about a reply is reviewed by default. If an administrator switches review on for the reply's message writes in the Pipelines view, the run parks at the **save** step — after the placeholder exists and the model has answered — and a reviewer sees the reply's text, never an empty row. Approving lets the save fill the message; rejecting ends the run and the placeholder is settled with the reason, so it does not stay spinning.

**A step's switches are declared, like everything else in the view.** Three controls come from what a step _is_ rather than from anything its author wrote: **Use this source** on a step that may be skipped (a retrieval source, an optional parse), **Review** on a step that writes or reaches outside, and **Run** — together or one after another — on a group of steps that gather in parallel. They live under _Settings_ (Review under its own heading), reset like any setting, and their shipped positions are the step's own declaration: most writes ship with review off; a step that attaches a generated image to a message ships with it on. A step with nothing to switch offers none of them.

**Streaming** is the run's, not any step's. The pipeline **declares** which step's prose streams into the reply as it is written (`expose: { stream: true }` on the step) — never one that answers in JSON, never one inside a repeat, and at most one on any single path through the pipeline. Two steps may both declare it only when they sit in branches of one junction that can never both run, so whichever branch runs streams: the Writing Room streams its manuscript or its talk, the Lair its scene or, on a pick, the picked character's line. A pipeline that declares none streams nothing, and the reply appears when it is written. A planning step's answer or a state-keeper's are steps on the progress card above the composer, never text in the message, wherever in the pipeline the narrating step sits — inside a branch too, as the Lair's does. A pipeline with one generating step and a pipeline with five take the same road — the count decides only how many steps the card shows.

**A run says what it is doing.** Any step can set a **status** from inside its work — a short line in your language, with the speaker's name filled in: _Jasmine is thinking_ while the retrieval steps read, _Jasmine is composing_ while the prompt is assembled, _Jasmine is typing_ from the moment the model is called, _waiting for the model_ or _loading the model_ when the call is queued behind another or a managed backend is starting up (only if that wait actually lasts). A status stands until the next step sets another or the run ends; a step that says nothing leaves the last word up. It shows in three places at once — on the reply's own row beside the ember dot, on the progress card in place of the step name, and on the session's row in the sidebar while the run is in flight — so a session you are not looking at can still say _Jasmine is typing_. A pipeline can also give a step its own status (`expose: { status }`) — _Planning the turn_, _Narrating the scene_, _Keeping the record_ — which shows for as long as that step runs, in place of whatever the step would have said; the shipped multi-step genres do this for every model step, so the card never shows a step's internal name. A status is not a setting: nothing in the Pipelines view changes one, and a run's report does not list them step by step. The one thing the report keeps is the **last** status of a run that stopped, failed or halted — what it was doing when it ended — which the run inspector reads into its opening sentence: _Stopped at generate on request while Jasmine is typing._ A summary or a graph build says its own statuses the same way (_summarising part 2 of 5_, _merging the drafts_, _building the graph: perspective_) on the progress surface it already had; the token estimate under the composer says nothing, since nobody is watching it type.

**Folded sections.** A reply's body is its prose; the working a reader might want to open sits above it, collapsed. The message steps (`create-message`, `update-message`) take a `thinking` input, shown as a **Thinking** fold, and a `sections` input: up to six folded sections, each with a kind, a label, and either text or a list of lines. The **list section** step (`list-section`) turns part of a JSON answer into one: it reads the keys it is given (for the Lair, the planner's `beats` and `speakers`) and writes each entry as a line, never as raw JSON. Swiping keeps each version's own folds and regenerating replaces them. Folds are never sent back to the model: the story the next turn reads is the body alone.

**Is a place already described.** The **undescribed name** step (`undescribed-name`) takes a name a model proposed, such as the room the Lair's planner says the party walk into, and checks it without a model. First it checks the lorebook entries it is handed, location entries first, then any entry type. An entry describes the name when its name, or one of its keys, is the same name. Next it checks recent prose: among the newest **Messages read** (default 40) on the **Channels read** (default `main`), the newest message written by a person, an envoy or a reply with no speaker. That message must hold a paragraph that names the place and has at least **Words to describe** (default 12) other words. A character's line never counts, however long. Names are compared ignoring case, punctuation, a possessive *'s* and one leading *the*, *a* or *an*, and only whole names match: *the vault* is not *the sunken vault*. The step answers `undescribed` (the name, or empty), `describedBy` (`entry` or `prose`), `entryId` and `passage` (the describing paragraph). All three numbers are settings on the step.

**Stop** is a guarantee the run makes, not a step. The message's own stop button and the progress card's both end the run wherever it is: the model call is cut off, no later step runs, and the row the placeholder made is left holding whatever had arrived — out of the generating state, with no error. A reply that the model finishes a moment after you stopped is dropped, not written over the partial you kept. A stopped run records who stopped it and where on its receipt, and anything its earlier steps already wrote stays written. A run that fails after making its row fails that row with the reason, so a placeholder never stays spinning. A message's stop button stops the runs filling the messages it releases — another participant's image render or summary in the same session keeps going; the progress card's X is how that one is stopped.

**A preview writes nothing.** The token estimate under the composer runs the same pipeline up to the model call and stops there — including the placeholder step, which in a preview commits nothing and hands a marked stand-in id down the line. The estimate is the real compilation the next turn performs, and it leaves no row behind. The run's report says which steps ran dry.

**The window is computed once.** The context budget a step sizes the prompt to, the window the connection is sent with, and the token figure the Pipelines view shows beside a share all come from one calculation over the same two facts: the sampling config the generating step is pointed at, and the model's own context window where the connection's model states one. A per-step connection or sampling choice, or the session's own sampling choice, reaches all three as one answer.

**A character's reply ends by choosing its face.** The reply pipelines that voice a character — the Chat reply, the tool loop, a side character's turn, the guide and the writing room — finish with a short **sprite tail** after their save step, so choosing a face never delays the reply. `sprites-for` reads which sprite set the speaker is in (the session's own choice, else the lorebook cast member's, else the card's default) and embeds the line and the set's sprite labels on the local embedding lane. A junction stops quietly when there is nothing to choose — a narrator's line, a card with no sprites. The **sprite picker** (`pick-sprite-similarity`) chooses, and `show-sprite` records it on the line's active swipe and emits `sprite-shown`. The picker is a declared session setting, so its switch and thresholds appear in session settings, and a plugin can offer another picker as a pure task that publishes the same `sprite-pick` shape. A person's **Change sprite** from the message menu runs the one-step action spec `show-sprite`, and the automatic picker never overwrites what a person chose. See [Sessions](./sessions.md#sprites).

## What changed since the last reply

The message actions that alter history — delete, hide, edit, swipe, branch, and a stop — are **built-ins**: Serene Pub performs each as its own one-step pipeline run (`core:spec/builtin-delete` and its siblings, a request step straight into the write step), so the write is receipted, may be put behind a review gate like any other write, and always records an event saying what changed and what was lost. A regenerate, an extend and a swipe's fresh alternative are the reply pipeline's own **save** step, whose `message-updated` event then carries the verb that re-drove the row. Which actions a genre may switch off, and which it may not, is on the [sessions page](./sessions.md#floors-built-ins-and-what-each-action-emits).

Every such event is written to the session's changes, and the next reply's input step publishes them on a `sessionChanges` port — a list, oldest first, each entry naming the event, the message, when, and what went: the deleted line's content, role and speaker; the text an edit replaced, and the reply a regenerate discarded; the alternative a swipe left behind and the index it selected; whether a hide hid or showed; how much of a stopped reply had arrived; the session and message a branch forked from (on the branched session — the source's history did not move). A pipeline reads it as `$.input.sessionChanges` — a context step of your own can tell the model that the line it remembers was rewritten — and the run's report shows the list on the input step. The reply pipelines Serene Pub ships do not yet render it into the prompt.

Each change reaches exactly one run: the reply that receives the list marks it as read — once the reply has landed, so a reply that fails at the model or is stopped before it wrote leaves the list for the next one — and the next reply starts from an empty one; a fresh reply's own save records nothing, since history growing is not history moving. The token estimate under the composer sees the list without marking it, so previewing never eats what the turn should see. The list is capped at the newest fifty changes: when more waited, the newest fifty arrive and the list ends with a `session-changes-truncated` entry saying how many older ones were dropped, and those are marked read without being delivered. Once a change has been read, the content it carried — the deleted line, the replaced text — is let go of; the event and the ids stay, and the run that made the write keeps what it published on its receipt. See [what a delete leaves behind](./sessions.md#floors-built-ins-and-what-each-action-emits) on the sessions page.

## Questions a pipeline puts to the cast

A message write — the placeholder step, or the save — takes a **blocks** port beside its text: a
list of message blocks (text, tables, meters, and the two interactive kinds, **choices** and
**form**). A `choices` block with an **addressee** and a **question** is a **form**: an action
still awaiting its answer, addressed to one participant. The write validates the list, refuses a
block naming a key this pipeline declares no action for (nothing would ever be held to an
audience for it) or an action marked `world` (see the line, below), stamps every option with the
identity of the action it fires and the block with an id, and stores the list as one part of the
message. A block may name another pipeline's action on purpose — the Adventure genre's **Ask**
points its options at **Answer** — and is then held to that installed declaration instead.

Who portrays the addressee was pinned at the start of the run like everything else. A person: the
block waits for their click, and a press on it — the block's id, the chosen option — is held to
the addressee alone, whatever the action's own audience says. The AI: the run records
`form-addressed` once its own receipt is saved, and the genre's binding for that event runs the
**answer pipeline** as a child of the asking run. The shipped one (`core:spec/answer-form-chat`,
`-adventure`, `-guide` — one graph, published once per genre because a preset binds a pipeline
locked to its genre) reads the addressee's card and the conversation, lays the question and the
options in as the last user turn, asks the model for one JSON object against the form's schema —
an enum of the option keys, or the form's field schema — and its **answer-form** step commits the
answer **exactly as a click would**: it checks the answer against the form, asks the cycle caps,
and hands the press to the same server road a click takes — as the addressee, with the answer
run's own reading of who portrays whom, so a member joining as the addressee while the model was
answering does not flip it. The action itself runs **after the answer run's receipt is saved**, as
its child, outside any step's timeout: the answer step's receipt names the action it fired and the
child run's id, and the child's own row says how the action went. A step that could not make the
fire — the model's answer named no option, the question was answered meanwhile, a cap refused —
ends the answer run on a **halt** with the sentence, never an error. `form-answered` lands in the
session's changes for the next reply's input step (`answeredBy: 'oracle'`; a click says `click`),
and the block is marked **answered**: a question is answered once, a second press is refused naming
who answered, and every client greys the block. Every run in the tree carries its parent, its root
and its depth, and the run inspector shows them. Review may be turned on for the answer step like
any other write, and the reviewer edits the answer alone; review on the *action's* own write parks
the child at its gate and nothing else — the answer run has already ended. **A parked run
releases the press.** The moment any run in the tree parks — the pressed action's own write, or
the write of an action an answer fired — the press is acknowledged as *parked* and the session's
generation lock is released, so other presses in the session go on working while the owner decides;
before, one review held the lock and the ack across the whole tree, and the AI-answer path could
reach that with nobody having clicked. The parked run keeps its handle: it can still be stopped,
its review card is the same card, and approving it lands the line exactly as before — the person
who pressed then receives the run's outcome as a push (the terminal frame on the progress card,
and the same *success* / *error* / *cancelled* answer the press would have carried). A fire that
never ran still leaves a row under the id the answer's receipt named: a cap refusal (receipted
after the answer's own row, so the tree reads in dispatch order), a fire stopped before it
started (`cancelled`, with who stopped it), or a fire that threw (a halt on the error's sentence).
The `answer-form` step may be placed only in a pipeline on the `form-addressed` input —
validation refuses it anywhere else, and so does the write.

The person who pressed sees the tree being made: the answer run's name — *Answer a form (chat)*
— and its statuses ride the progress card of the run they started, and the press is acknowledged
once the whole tree has finished, or as soon as any run in it has parked at a gate.

Two caps hold the tree (01 §8): no run stands more than **four** dispatches deep, and no asking
run fathers more than **sixteen**. What happens past one depends on the door.

A pipeline answering a run's own write belongs to the same tree without counting against either
cap: the turn order recomputed after a reply, or a pipeline bound to *Message completed*. It has a
third cap instead. No more than **four** writes in a row may each answer the event the last one
caused, so a pipeline that writes a message every time a message completes stops after the fourth
and waits for the session owner like any other. Anything in between that does count, such as a form
answer, starts that count again.

- **A pipeline answering an event** — the answer pipeline for a form, a pipeline bound to
  `annex-changed`, one bound to an event a package recorded — **waits for the session owner**. A
  *Keep going?* dialog names the pipelines so far (*Ask → Answer a form → Ask → … → Answer a
  form*), and nothing more runs until they answer. **Continue** lets the tree run one more window
  of each cap (four more deep, sixteen more runs) and asks again if it reaches that; **Stop here**
  ends it, and the waiting pipeline's row in the inspector reads *cancelled*, naming who stopped it
  and the cap. With nobody there it waits, and waiting costs nothing. A tree has one pause at a time: if
  several of its pipelines reach the cap before the owner answers, they wait on the same dialog
  (*3 runs wait for you*), and one answer covers them all. Continue runs exactly the pipeline the
  dialog named — if the session's binding changed meanwhile, nothing runs and the row says why.
  The dialog reaches every tab the owner has open, and an answer in one retires it in the others;
  a session deleted meanwhile drops its pause. A wait does not survive a restart: the tree simply
  ends there.
- **The action an answer fires** is refused **and receipted**: a halted run row naming the cap,
  its lineage filled.

Either way, pipelines that set each other off stop on a sentence rather than looping. Turns that
auto-advance start their own trees, so a long round never trips a cap part-way through.

**Events a plugin records.** A plugin can declare events of its own, such as Twenty Questions'
*Guess made*, and record them from its pipelines with the **record-event** step. Everything in the
session hears one: pipelines bound to it, other plugins, and the session's widgets. So an event
never carries anything secret; a plugin keeps secrets in state. The plugin says which of its
pipelines may record each event, per genre. A pipeline outside that scope is refused when it is
saved and again when it runs, and so is one recording an event that no installed plugin declares.

**The line.** An action declares which side of it the result falls: `fiction` (the default —
messages, state proposals, narration, a branch) or `world` — cards, lorebook data, settings,
permissions, connections. A `world` action may appear only in the composer, session settings,
admin or review venues, its acting audience is the owner's (or an administrator's), no block may
name it, and the answer pipeline refuses to answer it. Each rule is refused where the author is —
at construction, in `validate()`, in a package's announcement — and again at the instance's publish
and at the write. Serene Pub's own message verbs, including branch (a copy of a session is still
the fiction), are `fiction`; writing lorebook entries and filing graph proposals are `world`.

**What an action collects.** An action can declare what it asks for before it runs: `collects: { text, recipients }`. `text` is `{ need: 'required' | 'optional', label, placeholder?, ifEmpty? }`, and an `optional` one must say in `ifEmpty` what an empty submit does (*The room decides.*). `recipients` is `{ label, min?, max? }`: a pick of the session's enabled cast members. Every press of a collecting action, from any venue, opens the **collect modal**, and never reads the composer. What was collected reaches the run as its input `text` (trimmed) and `recipients` (`character:<id>` references, checked by the server: enabled members of the cast, none twice, within `min`, default 1, and `max`). A `required` action that arrives with no text is refused with a sentence. An action that declares nothing gets no text and no recipients, whatever the press sent.

**Turn controls.** The composer's **Continue** (`advance`, which fires whoever is next), **Pick who speaks** (`pick`) and the pickers' narrator row (`narrate`) are turn controls, and a genre declares which it offers under `turnControls`. Undeclared, Continue and Pick are offered where the genre has characters to speak and the narrator row where the genre has a narrator. A control can also be offered only while a condition holds, `presentWhen`, over the session's published values, for example `{ on: 'session.fields.<field>', equals: '<value>', reason }`; no built-in genre declares one today. A control whose condition is false is not drawn at all, and the server refuses a press of it; one that is present but busy is greyed. Continue, the turn control, is not the message verb **Extend**, which carries one reply on and is switched off separately (`messageVerbs.extend`).

**Review fields.** Every step that writes or reaches outside declares which of its inputs a
reviewer may edit at the gate — `review: { fields }` — and Serene Pub's own all do: the text of a
message write, the prompt and the negative of an image render, the name and content of a lore
entry, the answer of a form; nothing on a step whose payload is a compiled prompt or an
identity (approve or refuse). The text-generating steps (`generate-text`, `generate-json`,
`generate-with-tools`) declare no editable field on purpose: their pre-call gate is approve or
reject, and the compiled prompt is inspected in the debug preview, not retyped at the gate. A
definition that declares none still gates — the form is inferred from the whole payload, every
field editable, which is what a plugin's step gets until it declares — but registering it records
the omission, and validation warns on every pipeline that places it.

**What the instance checks at publish.** Every document an instance stores — the shipped catalog,
an import, a hand-written one — is run through the SDK's `validate()` when it is saved, and any
finding of error severity refuses the save with the finding's own sentence: one input step first,
one reply row per run (a pipeline may write as often as it likes beside it, but never a second
message on the reply's own channel while the reply is still being written — once the step that finishes it has run, further messages may follow on that channel, as the Lair's cast lines do — and never the reply row inside a repeat), at most one streaming step on any path (above), no branching, every wired port's shape accepted by the port it feeds, a built-in
write only in its own pipeline, `answer-form` only under `form-addressed`, and the action model's
rules above. A warning is let through and reported.

## The cast a pipeline reads

`core:query/session-cast@1` (and the settings document's `cast`, which every session inlet
publishes) lists **every seat in the session, benched characters included**. Each character and
persona row carries `enabled`: `false` for a character switched off in the cast list, `true`
otherwise — a persona has no switch and is always `true`. The session state's cast
(`core:query/session-state@1`, `state.cast.<member>`) carries the same `enabled` beside each
member's `id`, `key` and `name`.

Nothing filters for you, so a pipeline or widget that should ignore benched characters checks
`enabled` itself. The core readers that must not see them already do: the turn pool and the
round-robin rotation seat only enabled characters, `state.who.active` lists only enabled ones,
the cast-choices step offers only enabled seats, and the prompt's `{{characterNames}}` names only
enabled characters. A benched character's card is still sent — that has always been so, and it is
what keeps a character the others are talking about recognisable.

The same read carries `characterDetail` — the session's **Character detail** setting (see
[Sessions](./sessions.md#character-detail)) — on genres that declare it, and
`build-template-context` trims every non-speaker's card by it. It is absent for a genre that
declares no such setting, which reads as `full`.

## Where the weights live

Each retrieval step carries its own **share** of the context window — **Share — world lore** on the world-lore step, **Share — conversation** on the history step, **Share — relationships** on the ranked relationships step — beside its own **Most entries** ceiling and its **Priority**. The shares are relative: the ranker normalises whatever it is handed, so raising one takes room from the others and setting one to zero leaves that source out. The conversation alone keeps a minimum, **Always keep at least**, on its own step. A pipeline that finds all its lore through one step — the narrator pipelines do — carries the same controls for each of the three kinds of lore on that one step, under the same labels: **Share — world lore**, **Share — character lore**, **Share — history**, each with its ceiling and priority. The ranking step declares only what is about the whole pool — how the ways of finding an entry weigh against each other, how the shares divide the window, and whether the best entries lead — and nothing about any one source.

A priority of **always** keeps every entry of that source the window can hold, ahead of the scored fill — up to the source's **Most entries** ceiling, which applies whatever the share and whatever the priority. Only a pinned entry steps over the ceiling, because a pin is a promise about one entry and a priority is a promise about a source.

That arrangement is what lets a source added by an extension take part without anyone editing the ranker: its step declares its own share and ceiling, publishes them ahead of what it found, and the ranker allocates it a band on the same terms as world lore. A source that found nothing this turn still reserves its share (and hands what it did not spend to the others), which is why the number lives on the source rather than travelling with the entries. The run's report lists which bands reached the ranker from a step's own declaration and which ran on the shipped defaults, so a share that is not taking effect has one line that says why.

Upgrading from a build where the ranking step carried a **Context split**: every value you had set there was moved to the step that owns it — the world-lore step, the history step, or on a narrator pipeline the one lore step, under the band's own label — and the Pipelines view's notices say which value went where. A member holding the shipped number was simply dropped, since the owning step declares the same number; so was a relationships ceiling of 0 sitting behind a relationships share of 0, the pair every saved split carried. A relationships ceiling of 0 behind a share you had raised is the one value that is not carried over: on the ranking step it kept every relationship out, and on the relationships step 0 would switch the source off under a different word, so the notice says the graph now competes for its share and the share is the switch. The same rule reaches past that one upgrade: a session that raises the relationships share over a configuration whose ceiling is still the shipped 0 now lets relationships compete uncapped, because the share is the switch and the ceiling is only a cap once something has actually set it.

## A source's band in the context template

A step that adds a source of its own names the **band** its entries ride in, and it can **declare** that band too: the band's name and the variable that lays it out. A declared band is a name a context template can use, like `worldLore`. Twenty Questions declares `secretEntry` for the entry the character is thinking of and `briefing` for what the character is told each turn. Its own context template places them as `{{{secretEntry}}}` and `{{{briefing}}}` (Liquid: `{{ secretEntry }}`).

- **Nothing places a band for you.** A template renders the bands it names and no others. If a band's entries were ranked and included but the template never names it, the run's report says so and names the fix. Genres that bring bands ship templates that place them. If you pick a different context template for such a pipeline, place the bands yourself.
- **How it looks is a setting.** Each declared band that reaches the assembly step appears in that step's variables settings beside world lore and history. You can pick a layout there, for example prose instead of JSON. With no layout, the band renders as its entries keyed by name, in compact JSON: `{"The Clocktower":"A brass clocktower…"}`. A band with nothing included this turn is empty, so `{{#if secretEntry}}` guards its section.
- **One name, one meaning.** Band names are identifiers: letters, digits and `_`. A band may not take a name Serene Pub already renders (`characters`, `budget`, …), and two steps may not declare the same band name with different layouts. Each case is refused with a sentence naming both sides: when the plugin loads, when the pipeline is opened, or when a run meets it.
- **Core's lore is declared the same way.** The lore steps declare `worldLore`, `characterLore` and `history`. `characterLore` still reaches a template as a plain list with no layout, as it always has.
- **A template has to fit the step it is chosen for.** Choosing a context template for a step checks it against what that step supplies: the step's context, its declared bands and its prompts. A template naming something nothing supplies there is refused, with the name it probably meant and what is available. Publishing a pipeline whose preset ships such a template is refused too. Choices already stored are never refused or changed: startup lists any that no longer fit in the server log and leaves a notice on each configuration that selects one, under the configuration picker, with the same sentence a new choice would get. The notice goes by itself the next time Serene Pub starts after the template is fixed or another one is picked. See [Context Templates](./context-templates.md#templates-are-checked-when-you-save-them).

## An envoy's prompts are configuration

A genre may bring a speaker of its own — an **envoy** (see [Sessions → Envoys](./sessions.md#envoys)); the Guide genre's mascot is the first. The envoy's instructions are declared by the genre as defaults and read by the pipeline the way any authored text is: the context builder's prompts slot points at the envoy (`slot.prompts({ envoy: 'mascot' })`), and the assembly step reads the same text through the context builder, so one text serves the whole reply. There is no prompt row behind it and nothing to swap; the view shows it as its own step, named **Envoy · Guide**, with a **System prompt** and a **Post-history instructions** field. The genre's words are the field's default; editing the field stores a deviation like any other setting, the run resolves it through the same chain (a session's override, then the selected configuration, then the genre's declaration), and clearing the field is the genre's words again.

The step appears only on a pipeline that reads the envoy — the Guide's reply, not its create pipeline — because a control nothing reads is the kind this view refuses to show. An envoy an installed action brings gets the same treatment on the action's own pipeline, under the action's namespace.

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

Nothing a tool does can change anything. They read; what the run changes, it
changes through the pipeline's own write steps, exactly as every other pipeline does.

**Tool loop (reference)** in the pipelines list is a worked example, deliberately
offered on no session type — it is there to be read and copied, not run from a
composer.

## A pipeline's own session state: the annex

A pipeline often needs to remember something between turns that is not a message — a game clock, a score, whose secret is revealed. Each session has an **annex** for that: a small JSON document per owner, where the owner is the pipeline's namespace (`core`, `acme.rp`). A pipeline reads its own entry with the **Session annex** query and writes it with the **Set session annex** outlet, which merges into what is there by default. Writing another owner's entry needs the node's **Write another owner** setting.

**Every key is declared once.** An owner lists every key it keeps in the annex — its **annex fields** — in one declaration: the shape the value must have, who may see it, and (optionally) who may set it by hand. A plugin declares them on its extension (`annexFields`); core's are part of the core catalog. **Set session annex** may write only declared keys: a pipeline that names another key is refused when it is saved (when the keys are written out in the pipeline) and always when it runs, and a value that does not fit its declared shape stops the run. A pipeline written by hand in the library has no declaration of its own yet, so it cannot write the annex.

Writing the annex causes the **Annex changed** event (`core:event/annex-changed@1`), naming the owner — but only when the value actually changed, so a pipeline that rewrites the same value cannot set itself off. A pipeline that answers the event by writing a *different* value each time will set itself off again; at the run caps it waits for the session owner (see above), but design the value to settle. A genre that wants its own state to decide turns lists that event on its turn-order pipeline.

**Who may see a value.** Every value in the annex has an **audience**, set by its key's declaration (its `see`, a list of participant references) — never by the pipeline that writes it:

| `see` | Who sees it, besides pipelines |
|---|---|
| left out | nobody: pipelines only (the default, so a secret never leaks by being forgotten) |
| `participant` | everyone in the session, and the model's context |
| `person` | every human in the session |
| `ai` | the model's context only |
| `owner`, `user:<id>` | that person |
| `character:<id>`, `envoy:<slug>` | whoever plays that character or envoy, and that speaker's prompt |

Pipelines always read the whole annex. People never do: each person's screen and widgets get their own view, only the values whose audience includes them — and every widget on that screen, whichever plugin it comes from, sees that same view. The annex is for session state: never put credentials or personal data in it. A plugin's private data belongs in its own storage. For a prompt, read the annex with the query's **view** set to `ai`, and wire the speaker: that returns only what the model may carry for that speaker. A pipeline that feeds the whole annex into a prompt — the query without the AI view, or the session settings document that carries the annex — gets a warning when it is saved.

**The template view.** With **view** set to `template`, the query returns what a context template may read: every *declared* key of every owner in scope — core and each plugin that is switched on, for this session's genre — as `{ owner: { key: value } }`. Keys no declaration covers are left out, and so is a switched-off plugin's document. The **Owner** and **Read another owner** settings do not apply. Wire it into the **Assemble** step's `annex` input, and the step's template can read `annex.<owner>.<key>` (see [Context Templates](./context-templates.md#the-annex-annex)). That is the only place it may go. Saving is refused if the `annex` input is fed by anything else (another step, or the query with another view), or if a template-view read feeds anything but an `annex` input. No shipped pipeline wires it. A key has one audience, its declaration's: **Set session annex** takes no audience of its own.

**Values stored before declarations.** A key already in a session's annex that no declaration covers stays exactly where it is and every pipeline still reads it, but nobody's screen or prompt sees it any more (even if it was stored for someone), no pipeline can write it again, and writing the owner's document with **Merge** off leaves it in place.

Two conventions, not enforced:

- **Keep narrative out of the annex.** Story facts belong in messages and lore, where retrieval and the reader can see them; the annex is bookkeeping.
- **Version your entry.** Declare a `v` key, keep a number in it, and migrate your own data when you read an older one; core never touches it.

A package can also declare events of its own and record them (see *Events a plugin records* above); an event is heard by everything in the session, so it never carries a secret — the annex does, with an audience.

**Values a widget saves: annex fields** *(experimental)*. A plugin whose widget only needs to save a value — a dice roll, a note, a toggle — does not need a pipeline for each one. It gives the field a list of who may set it. Only those fields appear as actions; a field without that list is written by pipelines only, and pressing it is refused. Each such field appears as one action in the widget's list, named `<plugin>:annex#<key>`, and pressing it runs core's **Set annex field** pipeline, which writes the value the same way **Set session annex** does — the same audience rule, the same **Annex changed** event, the same per-person views. A press is refused, with a sentence, for a key the plugin did not declare, a value that does not fit the shape, someone outside the field's setters, or any field while plugins are turned off. A field can be limited to one genre's sessions. The session owner can switch a field off under the session's actions like any other.

## The story clock

A session reading a lorebook has a **story clock** — its own now. Until it is set or advanced, a session follows the present of the lorebook line it reads, and the first advance starts from that present (see [Sessions](./sessions.md#where-the-session-reads-its-lorebook)). Moving the clock also moves what the session reads: lore dated after it, and the lorebook's dated changes that have not happened by then, are not read in. The **Advance story clock** outlet (`core:outlet/advance-story-clock@1`) moves it: set **By** (a whole number; negative goes back) and **Unit** (minutes, hours, days, months or years). Wire a number into its `by` input or a unit into its `unit` input to compute them instead; a wired value wins over the setting. To advance the clock once per reply — a minute, say — put the step in a pipeline bound to the reply's event, which runs after the reply is saved.

It steps by the lorebook's calendar: minutes carry into hours and into the next day, days through the ends of months and the leap day, months into years. In a **free-form** lorebook there are no month lengths, so only the part named moves: a day past the end of a month stays in that month (day 34), and nothing ever rolls into a month or a year. A time of day past midnight still moves the day. A clock with no time of day starts at midnight when stepped by hours or minutes.

It moves this session's clock only, never the lorebook's present or another session's. The step **stops the run with a sentence**, and writes nothing, when the session has no lorebook, when there is no present to start from, when **By** is zero or not a whole number, when the clock has no part for the unit (days on a clock that stands at a year), and when the result does not land in the lorebook's calendar (31 Bloom plus a month, in a calendar where the next month has 28 days). It never rounds a date into place. Its `clock` output is the clock as it now stands, and `label` spells it through the lorebook's calendar.

## Inspecting a run

Every run leaves a report, and the **run inspector** is how you read one. **Only administrators see run reports**: a report records everything a run touched, every step's inputs and outputs, including anything a pipeline keeps hidden from the people in a session. A person still sees what a run tells them about their own turn, such as the sentence on a progress card when a reply stops. For an administrator the inspector opens from three places: the **Inspect run** action in an assistant message's ⋮ menu, the **Inspect** button on the progress card once a run finishes, and a row in the **Runs** list of the pipelines section in `/admin`.

It opens on a single sentence saying what happened, so the first glance answers the question: _Ran all 27 nodes_, or _Stopped at generate on request_, or _Halted at keeperWrite_ with the reason the pipeline gave.

A Chat reply ran all of its nodes: the placeholder that made the message, the retrieval and assembly steps, the generate step that called the model — with its prompt and completion token counts, the finish reason the service reported, and the reply text under **Output** — and the save step that filled the message in. A reply you stopped reads _Stopped at generate on request while Jasmine is typing_ — the last status the run had set, in your language, is part of the sentence on any run that did not finish; one the service failed reads _Failed at generate while Jasmine is typing_ with a redacted reason, the full text staying on the message's administrator detail and the Wire tab. A receipt reads as a preview only when the run really was one and left nothing behind. Beside the sentence are the pipeline it used, the document hash and whether that is still the current one, the time, the token count, what triggered it, and what the run left behind. Receipts from before this release, when the connection adapter sent the prompt from outside the pipeline, still open and still say so in their own words.

A **Portrayed by** line follows on a session turn: each participant the run concerned and who portrayed them — _Tom · AI_, _Elara · you_, another member by name; a participant nobody portrays shows its reference and _nobody_. It is decided once, when the run starts, and pinned on the receipt like the configuration, so a guest who joins while a reply is being written changes the next turn's line and never this one's. A preview that stops before the model is called carries no line. The rules that decide it are in [Sessions](./sessions.md#who-portrays-a-participant-this-turn).

Under that are two levels and no third. On the left, every step in the order it ran, each with its node key, its type, how long it took, and a marker on the steps that called a model. Select one and the pane beside it shows that step alone:

- **Prompt** shows the payload, and says whether the step sent it, rendered it, or was handed it and then stopped. Allocated blocks are a table with their source, name, token cost, whether they made it in, and the line each step left explaining why. The rendered messages follow, as readable text with their roles. A step that assembles a prompt also says what it did with the post-history reminder: _included at message 12_, or _suppressed, 278 tokens is below the 100000 trigger_. A suppressed reminder leaves nothing in the payload, so without that line there is no way to tell it apart from a configuration that has no reminder at all. See [Context Templates](./context-templates.md) for the two numbers behind it.
- **Output** shows what the step published. Long text is shown as text; everything else is JSON behind a disclosure, with a copy button.
- **Wire** appears on a step that reached a model server. It lists every stop sequence with its kind, and whether it went on the wire or was held back. On a chat wire the roles carry the structure, so format and speaker stops are held back and the reply stops on the model's own tokens instead. The structured-output mode is named here too.
- **Notes** shows whatever the step recorded about itself.

**What the adapter actually sent.** Above the stop lists, the Wire tab shows the exchange itself: the URL and method the connection's adapter posted to, the request body it built (pretty-printed, with a **Copy request** button), and the raw response as it arrived, before anything was parsed out of it. A streamed reply says how many frames it came in; a long one is kept to the first 64 KB and says so. A step that made more than one call lists each. That is what the receipt has instead of a proxy: the assembled prompt is one rendering earlier, and the prompt format, role mapping, sampler names, `stop` list and structured-output field a given service wants are only visible here. When it is present, the **Prompt** tab shows those turns as the adapter sent them and labels them so.

Connections belong to the administrator, so a step that called a model shows only that it did. The model name, the connection, the request it built and the whole exchange above are administrator-only. A request cannot be described without naming where it went, so for everyone else the exchange is removed at the server and the tab shows the stop lists alone, without the wire mode that decided them. The inspector shows what the server sent rather than reconstructing anything that was withheld.

## What a ranker decided is recorded

Every step that publishes decisions (core's ranker, or one a plugin ships) has them recorded when its run is saved: one record per candidate it judged, with whether it went in, a short reason, the score, the rank among those included, the tokens and, for lore, the keys that matched and the message each matched in. Nothing needs switching on. A preview run, such as the lorebook's fire test, records nothing. A session keeps its newest 200 rankings; the per-entry counts they add up to are kept after the records themselves are pruned.

A plugin's ranker records its own decisions the same way: publish them on a port of the decisions shape, naming each candidate's subject as `<your slug>:<kind>` and a reason code. A short explanation and a small detail object are optional. At most 2,000 decisions are kept per ranking, and 2 KB of detail each; anything past that is counted and noted on the ranking.

## A plugin's settings

A plugin declares its settings, and an administrator fills them in under **Admin → Plugins**
(**Settings** on the plugin's row). A setting the plugin marks as each person's own (`scope:
'user'` in its declaration) can also be changed by anyone for themselves, on the **Extension
settings** card of **Settings → User**. When the plugin's code runs for someone, it reads their
own value first, then the value the administrator set for everyone, then the plugin's default.
Code that runs for no one in particular, such as a plugin's startup, reads the administrator's
value. Only an administrator can change a setting that is not marked as each person's own, and
nobody can see or change another person's values. Uninstalling the plugin, or deleting an
account, removes the values stored for it.

## Turning a plugin off

Switching a plugin off in **Admin → Plugins** removes everything it provides from every screen but that one: its genres from the session picker and the Genres list, and its pipelines, presets, actions, prompts, templates, scripts, swaps, widgets and widget styles from their lists and pickers. Nobody can start a new session in its genre.

Nothing is deleted. Its settings and your choices about it, such as which of its swaps are switched off, are kept, and turning the plugin back on restores all of it. A session already running on something the plugin provided keeps running. Its actions are no longer offered, though, because the plugin's code is not loaded while it is off.

## The events page

**Admin → Events** (`/admin/pipelines/events`, also linked from the pipelines page) shows every event this instance knows and what answers it. It is for administrators only.

The top half is the list of events: core's first, then any an installed plugin declares, marked **package**. Choose one to see:
- its family: **data** is something written, **action** is a request to run something;
- whether it touches a user's account or assets;
- the shape of what a listener receives;
- which writes cause it;
- the genres that list it, and whether each one requires it;
- how many presets bind it;
- for a plugin's event, who declared it and, per genre, which pipelines may record it.

The bottom half is the **event map**. It shows what is installed, not what is running. Each box is an event, a pipeline or a listener, and three kinds of line join them:
- **binds**: a pipeline's inlet answers the event;
- **causes**: running the pipeline or listener records the event;
- **listens**: a listener hears the event.

An event nothing causes is marked **root**, since it starts a chain. The map opens on Chat. Pick another genre, or clear the genre to draw every published pipeline at once. Pick a preset, or open the page with `?session=<id>`, and the map keeps only the pipeline that preset or session runs for each event; an Action can be answered by many pipelines, so it keeps them all. Events with no line in the chosen scope are left off the map and stay in the list above.

Click an event to select it in the list, a pipeline to open its page, or a plugin's listener to open the plugins page. The selected event's card lists the same neighbours as links, under **On the event map**, so everything the map opens can also be reached from the keyboard.

## Prompts

A **prompt** is the written instructions a step sends: a name plus a few named text fields — a **System prompt** and **Post-history instructions** on a reply step, a **Narrator name** as well on the narrator's; a summary's drafting, merging and naming steps each take their own. A prompt belongs to a **step**, not to a pipeline: it is offered in every pipeline that reuses that step, so a narrator prompt you write is there for every pipeline with a narrator step.

Which prompt a step uses is a setting of the configuration, picked in the **Pipelines** view on the step itself, where you can also write a new one for that step. The prompts Serene Pub ships are read-only; clone one to make a variant you can edit. **Admin → Prompts** (`/admin/prompts`) lists every prompt, grouped by the step it serves. Where a step's call goes — its connection and sampling settings — is a separate setting on the same configuration, not part of the prompt.

The fields are plain text with a few names filled in before sending: `{{char}}` is the character whose turn it is, `{{characterNames}}` and `{{personaNames}}` are every character and every persona in the session joined into one readable list, and `{{narratorName}}` is the narrator prompt's own name. Where the post-history reminder goes, and how long a session must be before it is added at all, are numbers on the assembly step (**Post-history depth** and **Post-history token trigger**), not prompt text — see [Context Templates](./context-templates.md#the-posthistory-object).

## Related

- [Context Templates](./context-templates.md) — the structure a step's prompt is rendered into, chosen per pipeline in this panel.
- [Connections](./connections.md) — which model server a step talks to.
- [Instance Settings](./system-settings.md) — instance-wide defaults that sit underneath all of this.
- For developers: a pipeline step's settings are **declared by its node definition**, and the code behind that step is typed from the same declaration — so a setting that does nothing, or code reading a setting nobody declared, is a build error rather than a control that quietly has no effect. See [Handler input types come from the contract](https://github.com/doolijb/serene-pub/blob/main/INTEGRATING.md#handler-input-types-come-from-the-contract).
