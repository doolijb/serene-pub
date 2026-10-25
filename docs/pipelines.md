# Pipelines

A **pipeline** is the series of steps that produces one thing: a character's reply, a narrator's line, a summary, an image. Most pipelines gather what the model needs (the characters, the lore, the recent conversation), build a prompt, call a model, and save the result.

A pipeline says what happens, not when. Each genre lists which pipelines run, and on what: **the genre's defaults**. A **preset** is a set of changes on those defaults, and a session runs the preset it was started from. There are no separate "configurations" to pick: a pipeline's values come from one chain of layers (see [Where a value comes from](#where-a-value-comes-from)), and the pieces a step points at (prompts, context templates, variable layouts, sampling configs, loadouts) are libraries an administrator picks from.

:::tip You may never need this page
Sessions work well on the shipped presets. Come here when you want to change a prompt's wording, put a different model on one part of a turn, change what runs between turns, or find out why a reply came out the way it did.
:::

## Who can change what

What the settings show depends on your role. You only see settings your role can change somewhere.

- **Everyone** can choose, in their own session's settings, which **prompt** each step uses (among the prompts there are), the settings a pipeline offers its sessions (Story's reply tick, the sprite choice, who may take a turn), and whether each **routine** runs **Off**, on **Review** or **Full**. That is all a non-administrator sees: no model, no sampling, no switches, and no writing or editing prompts.
- **Administrators** change everything else: in **Admin › Pipelines** the model each call uses, sampling, switches, the Advanced settings, and writing, editing and deleting prompts; in **Admin › Presets** what each preset runs. What they save on a pipeline's page is the genre's defaults for it, so it reaches every session of that genre that hasn't changed it. Sampling for one session alone, and a routine's timing in one session, are also an administrator's choice.
- **Nobody picks a connection for a session.** A session's replies use the model its pipeline names, else the [loadout](./connections.md#loadouts) the step names. To change it, an administrator changes the pipeline in Admin › Pipelines (see [Sessions → Which connection a session uses](./sessions.md#which-connection-a-session-uses)).

A setting your role normally changes but which is locked right now stays visible, read-only, with the reason. A preset can lock a setting so its sessions keep the preset's value. The pipeline that created a session is the other usual case: its settings only matter while the session is being created, so afterwards its card is read-only and says _This session has been created; these settings only applied while creating it._

## What runs, and when

A pipeline runs for one of three reasons:

| Kind | It runs when | Examples |
| --- | --- | --- |
| **Event pipeline** | something it listens to happens | the reply (a message asks for an answer), creating the session, the turn order (a message lands, someone joins) |
| **Action pipeline** | a person presses its action: a composer button, a message-menu item, a slash command | Story's **Narrate**, **Look** and **Rest**; the Lair's **Nudge** |
| **Routine** | its timing says it is due: after each round, every five turns, every hour, when a scene opens | Story's **Note what changed** and **Look back over the story** |

Putting a pipeline on an event, an action or a timing is a **registration**. The genre's defaults are its list of registrations, plus the values of its settings, plus which preset is its default. A preset changes that list: it adds a registration, drops one, or changes one's values or mode. Story's **Minimal** preset is Story's defaults with the three routines dropped and the reply told not to read the scene.

**A pipeline must fit what starts it.** Each event hands the pipeline a few things: the session always, and sometimes the message, who is speaking, the scene or the story clock. A pipeline that reads something its event doesn't hand over can't be registered there, and the editor says why in one sentence, such as _Reply reads the speaker; Scene opened carries none._ Plugin authors can see what every event carries in [Events and what they carry](./sdk/events.md).

**An event can run several pipelines.** They run one after another, in the order their registrations give, each its own run. A registration can carry an **Only when…** condition, such as _the world · weather is storm_, and then runs only while it holds; without one it always runs. When every pipeline on an event a genre needs (the reply, say) is waiting on a condition that doesn't hold, nothing runs, and the run's report says so.

### One turn, start to finish

On Story's **Living** preset, with one person and one character:

1. You send a line. Saving it is a pipeline too, registered on the message being offered.
2. Your line asks for an answer, so the reply runs: whoever is due speaks.
3. The reply lands and the turn ends. Once everyone taking part has had a turn (everyone the turn order seats or has lined up, and every person who spoke), the round ends.
4. **Note what changed** (a routine, _After each round_) is due. It waits until the reply and anything the reply set off have finished, then reads the reply and notes what it made true: health, belongings, the place, the time.
5. Every fifth turn, **Look back over the story** (_Every 5 turns_) waits its turn the same way and files a summary, new lore and the cast.
6. The session's settings show exactly this: Story's settings, a card for each pipeline the preset runs that offers anything, and a **Routines** list with both routines and their modes. Nothing there is set twice.

## Routines

A **routine** is a pipeline that runs on its own between turns, when the events or times its timing names come round. Each routine in a session's settings shows its name, what it does, and **When it runs**:

- _After each turn_, _Every 5 turns_, _After each round_ (once everyone taking part has had a turn), _After each scene_;
- _When nobody has played for 30 minutes_;
- _On scene opened_, or another event;
- _When a value in the story says so_;
- in real time: _Every hour_, _Every 15 minutes_ (five minutes is the finest), or on a schedule such as _Daily at 09:00_ (in the session owner's time zone);
- in story time, on the session's [story clock](#the-story-clock): _Every 30 minutes of story time_, or on a schedule in the story's own calendar.

Every line on a lane is a **turn** of that lane, by its speaker; the story's lane also counts **rounds**. A routine on _After each turn_ or _After each round_ offers the other of the two as **When it runs** on its row (Story's **Note what changed** runs after each round unless you switch it). A routine or action whose pipeline needs a model the pub has none of (one that draws, speaks, hears or sees) is **unavailable**: it never runs, and its row says what it needs (_Unavailable: needs a model that can draw pictures._). A preset's card on the start form says what it needs and what would make it better (_Needs: a text model · Better with: an image model_), and administrators see the same on the preset and on its notices.

Whoever can open the session's settings picks each routine's mode: **Off** (it doesn't run), **Review** (it runs, and holds what it would change for you to accept) or **Full** (it runs and applies what it changes). The preset decides the starting mode, and a routine the preset leaves **Off** is still listed so you can turn it on. A routine the preset drops isn't offered.

What every routine does, whatever its timing:

- **It waits for the story.** A routine runs only once every reply, action and event in its session has finished, and people's replies and actions reach the model before any routine does, across every session on the pub.
- **Each time it is due is its own run**, in order.
- **It acts as the session's owner**, inside that session. The run inspector shows _routine Note what changed, for Ann_.
- **What a routine writes never sets off another routine.**
- **Real-time routines stop by themselves.** One that runs on the real clock pauses once nobody has played in the session for a while (three days unless set lower) or after so many runs in a row (12), and its row says why: _Paused: no one has played for 3 days_ or _Paused after 12 runs in a row_. The next line, action, form answer or settings change starts it again. Each person can set lower limits for their own sessions under **Settings › User › Background routines**, and an administrator sets the pub's under **Admin › General**.
- **After Serene Pub restarts**, a session's real-time routines wait until someone plays in it again. Nothing missed while the app was down is run.
- **A big jump of the story clock runs each story-time routine once**, however many of its intervals the jump crossed.

The session's owner can also run a routine by hand (**Run now**): **Routines** in the composer's actions lists the session's routines that aren't Off, and picking one queues it as if it were due (_Note what changed will run once the story settles._). It still waits for the story; while one of its runs is already waiting, its item reads _— already waiting_ and is greyed.

**For administrators**, each routine in a session's settings has a **Cadence** fold with its timing's own settings (such as **Every how many turns**, or **Skip when the clock jumps more than …** for a story-time routine), **Allow stacking**, and, for a real-time routine, its own two limits, which can't exceed the owner's or the pub's. **Allow stacking** is off unless a preset turns it on: while a routine already has a run waiting, another one that comes due is skipped (the inspector says _Skipped: already waiting_). Turned on, every one queues, which is what a routine that reacts to each person's change needs.

What ran, what it wrote and what it skipped is in the **While you were away** widget, which any session can add from its layout (see [Session layout](./session-layout.md#the-widgets)).

## Summaries and the lorebook

A summarizer registers three ways: on an **action** (a summary you ask for), on an **event** (a scene ending, say) and as a **routine** (on a cadence). Each registration has its own values, so one summarizer can run on a cadence with a minimum age of 20 messages and again on [Close out](./sessions.md#close-out) with none. The host refuses a run whose span is younger than its registration's minimum age. A routine's minimum is 20; an action's or an event's is 0. See [Summarization](./summarization.md#which-summarizer-runs).

Lore outlets carry **sources**: the ids of the messages a write was generated from.

- A write **with** sources is committed. It moves the session's settle line to the newest of them, and from there [Back](./sessions.md#back-and-forward) stops at that line.
- A write **without** sources is a change, taken back with its turn.
- Core's own generated writes (summaries, scene summaries, compile, the graph build) always pass sources.

A lore write that creates an entry can **match** an entry already there, by its id, its name or one of its keys, and update that one instead; two candidates are refused, naming both. It can also **bind** a new entry to a character, so that it is that character's lore.

A channel says what it carries for lore: **story**, **aside** or **never**. A genre can also declare that its history settles as it is written: every turn is kept as it is played and Back is refused. A preset cannot loosen that.

Plugin authors: see the SDK guide [Writing lore from a pipeline](./sdk/guides/writing-lore-from-a-pipeline.md).

## Presets

A **preset** belongs to one genre and is a set of changes on the genre's defaults. The genre's **default** preset is the one new sessions start from. Presets live in **Admin › Presets**, and a genre's page in **Admin › Genres** lists its own.

A preset's page shows, from the top:

- **The genre's defaults**: what every preset of the genre starts from, read-only.
- **What this preset runs**: each registration as _when → which pipeline_ (_After each round → Note what changed_, _Rest → Rest_), marked **The genre's**, **Changed here** or **Added here**. Change a routine's **Mode**, its timing's settings and **Allow stacking**, give any registration an **Only when…** condition picked from the properties the genre declares (or **Always run**), **Drop** one of the genre's (and **Restore** it), or **Remove** one you added. **Add a pipeline** asks what starts it (an event, an action or a routine and its timing) and then lists the pipelines that fit it; one that doesn't fit is shown greyed, with the reason.
- **Settings**: each of the genre's settings, with the genre's value beside it. **Set it for this preset** gives the preset its own value; **Lock** keeps sessions from changing it; **Ask at start** puts it on the start screen under **Before you start**; **Use the genre's** goes back.

The presets Serene Pub ships are read-only: only whether they are offered can change. **Clone this preset** makes an editable copy with a new title and description; a preset never builds on another, so a clone is a copy of the changes, not a link to them. A preset marked _Hidden_ isn't offered when someone starts a session; only administrators see it. An administrator changes a genre's default with **Default preset** on its page in **Admin › Genres**.

Each preset card on the start screen says what a turn costs (_2 calls per turn_), worked out from what it runs.

### Where a plugin's pipelines appear

A pipeline that is not Serene Pub's own comes from a plugin. A plugin that adds a genre ships that genre's defaults and at least one preset for it, and a plugin missing one is refused at install with a sentence saying so. A plugin can also ship a preset for another genre, Story's say, that runs its own pipelines beside Story's; such a preset names the plugins it builds on, and while one of them is missing, switched off or the wrong version, the preset is withdrawn from the start screen. Sessions already on it keep everything and say what is missing; nothing is deleted. A plugin's pipelines appear under its genre and presets, and in **Admin › Pipelines**.

## Where a value comes from

Every setting of a pipeline takes its value from the nearest layer that sets one:

1. **The session**, for what the pipeline offers its sessions (and everything, for an administrator, except the model a session never names).
2. **The preset's changes.**
3. **The genre's defaults**, which is what an administrator saves on the pipeline's page in Admin › Pipelines.
4. **The pipeline's values on this pub**: what an administrator saves on the page of a pipeline no genre runs by itself (a character's **Portrait**, its **Likeness**), and where a pipeline's pub-wide configuration from an earlier pre-release went.
5. **The pipeline's own default.**

Summaries (of the world, a character, a scene, the history) run where every pipeline does: each genre's defaults register them, so their values come from the same layers, though they still start from the summarize buttons and a scene's close.

The genre's own settings (Story's **Tone**, **Auto-advance**) follow the same order: the session, the preset, the genre's defaults, then the setting's own default. Any layer can **lock** a value, and then nothing below it changes it. The limits on real-time routines go the other way: the pub's are the most, each person's can only be lower, and one routine's lower still.

A setting fixed for the life of a session, such as which rules it plays, is settled when the session starts: the start screen asks for it when you may choose it, and otherwise it comes from the preset. Afterwards it is read-only.

On the pipeline's page in Admin, a muted line under each setting says where its value comes from (_From the genre's defaults_, _Set for this pipeline on this pub_, _The pipeline's default_), and in a session _Set for this session_, _From the preset_ or _From the genre's defaults_. A session's settings remember values per pipeline: when a preset change stops a pipeline running, its values stay, unused, and come back if it returns.

## The canvas

The pipeline's page has a **Canvas** tab that draws the pipeline as the line it runs along. On the left, a **minimap** shows every step as a dot and every clause as a square with a row per branch, so even the Lair's reply fits beside the page; click anything on it to go there. In the middle, the **line**: one card per step, showing its name and nothing else, with a clause (a gather, a for-each, a loop, a junction) as a container you open in place to see its branches side by side. Selecting a step inside a closed clause opens the way to it.

Everything about the selected step is in the **drawer** along the bottom, in tabs:

- **Node** or **Clause**: the step's type, its kind, where it sits, and for a clause its rule and each branch's condition.
- **In ports**: what the step receives and where each value comes from — another step's output, a setting, or a value written into the pipeline.
- **Out ports**: what it sends on, and which steps read it.
- **Settings**: the same editor as **Configure**. A change here goes into the same save row.
- **Last run**: that step's rows from a receipt, when **Last run** is on above.

The bar above the line colours it one of three ways. **Structure** colours by kind. **Last run** colours by a receipt — green ran, amber halted, red failed, gold a dry write, grey not reached — with a picker for the last ten runs. **Changes** marks what moved since the version before: added, changed, removed.

### Editing on the canvas

**Edit** starts a draft: your own working copy of the published version, kept on the server until you publish or discard it. A pipeline Serene Pub or a plugin ships cannot be edited in place; **Copy and edit…** asks for an owner slug of your own (`acme.lab`), a name and a label, publishes the copy as its first version and opens it. Every id you make afterwards lives under that slug, and it never changes. The copy keeps the events the original was made for but not its contributed actions, whose slash names belong to the original. A copy runs nowhere until a preset registers it: add it to one in **Admin › Presets**.

In a draft the drawer is the editor. Select a step and the actions row offers **Add after…**, which turns the drawer into the catalogue of every step this pub has (search, filter by kind; a tile shows its type id, because the type is what you are choosing), **Add clause after…**, **Move up / down**, **Rename…** and **Remove…**, which says first what would lose a source. A clause adds **Add node in branch…** and **Add branch…**, and its branches can be renamed or removed from the Clause tab. **In ports** becomes a picker per port: another step's output, a setting, or a literal. Every edit is checked by the server at once; the **Notices** tab lists what is wrong, with the fix, and the bar says _valid_ or _N notices · publish blocked_. **Changes** colours the draft against the published version.

### Composite steps and script steps

Two kinds of custom step need no plugin.

A **composite step** is a run of steps saved to the library as one. Select the first step of the run, choose **Save as step…**, pick where the run ends, give it a name and a label, and it is saved under your owner slug (`acme.lab:composite/retrieval`). The catalogue lists it under **composite**; inserting it lays its steps out under one key (`retrieval.lore`, `retrieval.rank`, …) with the wiring between them kept and the wiring to the outside listed for you to connect. It is inlined, so a published pipeline never depends on the library row; changing the saved step changes nothing already published.

A **script step** is the catalogue's **Run a script** (`core:task/run-script@1`): it passes its input through, and the scripts attached after its `main` port transform it. Those are ordinary scripts of the **Transform data** kind — the script is handed `value` and whatever it returns is the new value, any JSON — written in Admin › Scripts and attached on the step's **Advanced** fold like any seam, so which script runs is a setting like any other. They run in the same sandbox as every other script: QuickJS, no storage, no network, a time limit. The step's **Script time limit (ms)** sets that limit for each of its scripts (250 ms unless changed, up to 1000); a script that runs longer is stopped, the run's receipt says so, and the value it was handed goes on to the next.

Anything that reads storage, calls out, or writes is a plugin node, and the catalogue only offers what this pub has installed.

**Publish…** proposes the next patch version and shows, before anything is written, which stored values would lose an address that no longer exists and which would gain a default. Publishing writes the new version, makes it active, carries every stored value across (one at an address that is gone becomes a notice on Configure), checks again that everything registering the pipeline still fits it, and ends the draft. The version it replaces stays for its receipts. Settings belong to a published version, so the drawer's Settings tab waits until the draft is published.

## Agents

A pipeline can call a model more than once. Story on the Living preset replies, then reckons what the reply changed; the Dungeon Crawler plans, narrates and keeps the record: four calls a turn. Each call is an **agent**, with its own prompt, model and sampling, so you could give the planner a small fast model and the narrator a large one. You rarely need to: anything you leave alone follows the call's [loadout](./connections.md#loadouts).

The settings show one block per agent, in the order they run, then **Whole pipeline** for what serves the whole turn (which lore sources it reads, the context budget). A pipeline with a single model call shows one block with no heading. Each block has:

- its name, such as _Planner_, _Narrator_ or _Voices_, and one sentence on what it does;
- an **On/Off** switch beside the name when that call can be skipped (the reply's can't). A block that is off says _Off: this part does not run._;
- its main choices: **Loadout** first, then **Prompt**, **Model** and **Sampling** (in **Whole pipeline**, a switch for each lore source);
- one **Advanced** fold with the rest.
- on the administrator's pipeline page, a **Receives** card and a **Carries out** card for the agent, or for the step you select: what comes in (_the conversation_, _world lore, a share of the context_, _the cast_, _plan_ from the Planner), what goes on to the next step, and what it writes to the session (_writes the reply_, _sets the turn order_, _records an event_). An agent's cards leave out what passes between its own steps.

## Model and sampling

**Loadout** comes first in each agent's block. A [loadout](./connections.md#loadouts) is a named choice of model and sampling that many steps can share: Serene Pub's summaries all name _Extraction_, every reply names _Reply_. The picker shows the loadout's name and where it really resolves, such as _Extraction → Reply (unfilled)_ when Extraction has no model yet and so runs on the chat default. Each row in its list says what a run on it would do differently, in the same words a receipt uses: _JSON by instruction (no schema door)_, _tools by instruction (no native tool calls)_, _references dropped_. It never grades a loadout. **Change…** opens that loadout's sheet in the Loadouts view, where its model is chosen; changing it there changes every step that names it.

Under the picker, one line says what this step **Needs**, worked out from how it is wired (_Chat · a structured answer_, _Image generation · reference pictures_), and what it is **Best with**, as its author suggested (_Extraction sampling · fast_). The line is left out when there is nothing to say.

**Model** and **Sampling** below it are overrides for this one step. Each says where its value comes from: _set here_, _from the Extraction loadout_, or _from the default_. **Use loadout's** on a value set here clears it, so the step follows its loadout again. "The Reply loadout, but temperature 0.3 here" is one override, not a second loadout.

A session never picks a loadout; only an administrator does, on the pipeline's page.

**Model** is one choice: the list is grouped by connection, and each row is one of that connection's models, so picking a row picks both. A model that can't do what this call needs is still listed, greyed, with the reason (_Can't do image output._), and so is one that is switched off or no longer offered by its service.

**Sampling** lists your [sampling configs](./connections.md#sampling-configs), narrowed to the ones this call can use.

When nothing is chosen, the first entry in either list says what you get instead, and choosing it is the same as **Reset**:

| Where you are | The first entry reads |
| --- | --- |
| In a session, when the pipeline sets a value | _As configured — Nemo 12B · KoboldCPP_ |
| On the pipeline's page, when the pipeline ships a value | _Pipeline default — Background_ |
| Anywhere, when nothing else names one | _From the Reply loadout — Nemo 12B · KoboldCPP_ on the pipeline's page (the default [loadout](./connections.md#loadouts), from **Admin › Models › Loadouts**); _Pub default — …_ in a session |
| When not even the pub has one | _No model set_ |

**A muted line under each setting** says where its value comes from: _Set for this session_ (with **Reset**, and a dot marking the change), _From the preset_, _From the genre's defaults_, _Pipeline default_, _From the Reply loadout_ (on the pipeline's page) or _Pub default_ (in a session). A value you can't change here shows its name with _Set by an administrator_ under it. An administrator inside a session sees **Model** that way, because a session never names a model.

## Advanced settings

**Advanced** is everything in an agent, or in **Whole pipeline**, that isn't one of its main choices: the context template and how each value is laid out, tuning numbers, lore shares, review switches, scripts. Each block has its own fold, summarised as, for example, _Advanced · 19 settings · 2 changed_, so a change is never hidden. Inside, each step has its own box. Session settings show no Advanced; administrators reach it in **Admin › Pipelines**.

**Scripts.** A step's script lists are in its Advanced box, one list for each **seam**, the place in the step where scripts may run. Each list's label says where: _Scripts · before text_, _Scripts · after text_, _Scripts · at each draft_. The box lists them in the order the step runs them, and the **Scripts** tab on the pipeline's Admin page shows every seam in the pipeline in one map. See [Scripts](./scripts.md).

## Prompts

A **prompt** is the written instructions a step sends: a name plus a few text fields, such as a **System prompt** and **Post-history instructions** on a reply step, and a **Narrator name** too on a narrator step. A summary's drafting, merging and naming steps each have their own. A prompt belongs to a kind of step, not to one pipeline, so a narrator prompt you write is offered in every pipeline with a narrator step.

Story's reply starts on **Roleplay - Living Scene**, which carries the scene on from where it stands rather than answering each message as a request. Three more ship beside it: **Roleplay - Plain**, two sentences for small models and for cards that carry their own instructions; **Roleplay - Brief**, short dialogue-led turns; and **Writer**, which continues the story as an author rather than as one character. A pipeline or a session that already picked a prompt keeps it, including a prompt an earlier version shipped and this one doesn't: that prompt stays on your pub as an ordinary prompt you can edit or delete.

Which prompt a step uses is chosen on the step. In **Admin › Pipelines** an administrator can also write a new one there; shipped prompts are read-only, so clone one to make a version you can edit. Everyone else picks in their session's settings, among the prompts an administrator has not hidden; a pipeline may also offer its prompt as a setting of its own (Story's reply does: **Prompt**, in the reply's card). Nobody but an administrator edits a prompt's text. In **Admin › Prompts**, select prompts and choose **Hide selected prompts from session owners** (or **Offer…** to undo); the **Owners** column and filter show which are hidden. A hidden prompt a session already uses keeps running. **Admin › Prompts** lists every prompt with the step it serves. Filter it by **Genre**, **Pipeline** or **Step** to see exactly the prompts one of them can use: a prompt fits a pipeline when one of the pipeline's steps can pick it, and a genre through the pipelines its presets run. The **Use** filter shows which prompts a pipeline picks today. **Add prompt** starts a new one as a copy of an existing prompt for the same step.

**A name you already used.** If you named a prompt or template the same as one an update ships, yours keeps its name and the shipped one appears as _‹name› (Built-in)_. Once you rename or delete yours, it takes its plain name back.

The fields are plain text with a few names filled in before sending: `{{char}}` is the character whose turn it is, `{{characterNames}}` and `{{personaNames}}` list every character and persona in the session, and `{{narratorName}}` is the narrator prompt's own name. Where the post-history instructions go, and how long a session must be before they are added, are numbers on the assembly step (**Post-history depth** and **Post-history token trigger**), not part of the prompt. See [Context templates → The postHistory object](./context-templates.md#the-posthistory-object).

## Values store only what you changed

A setting you have never touched has nothing stored: it reads its value from the layer below every time it runs (see [Where a value comes from](#where-a-value-comes-from)). Three useful things follow.

- **You can see what you changed.** A changed setting has a dot beside it (a prompt or sampling the pipeline ships with is its default, so it has none until somebody picks another), and the **Changes** tab on the pipeline's Admin page lists every one: the agent, the step, the setting, and its old value beside its new one. An untouched pipeline shows an empty list.
- **Shipped defaults keep improving.** When an update corrects a default, every genre, preset and session that hadn't changed that setting picks up the new value. Only what you set stays where you put it.
- **Reset really resets.** **Reset** removes your stored value, so the setting follows the layer below again, including future changes to it. Setting a value back to the default by hand does the same: nothing is stored.

On the pipeline's Admin page, edits wait for the save row at the foot of the page. **Review** opens the Changes tab, **Discard** drops them, and **Save** sends them and waits for the server to accept each before it says _Saved_; a refused change is named at the top of the page and kept. What you save there is the genre's defaults for the pipeline, for every genre that runs it; a box at the top of the page says which. A pipeline nothing registers yet keeps the pub's own values for it until a preset does.

**"The default" is what the layer below would give.** Usually that is the pipeline's own value. Where the pipeline ships its own default for a step, that wins. For example, reply pipelines ship their **Post-history token trigger** at 3000 although the step's own value is 0, so a pipeline nobody touched gets 3000. Setting it to 0 there is a change: it is stored, shown in Changes, and kept.

### What always keeps a stored value

Some settings are a pick from a list rather than a number or a switch: which prompt, context template, layout, model or sampling config. The pick is stored, and it shows in Changes with only the new side filled in. **Reset** still works: the step goes back to what Serene Pub ships for it.

A step that renders a context template may accept more than one template language. The prompt-building step accepts Handlebars and Liquid, so its template picker lists both, with each row's language beside it, and its `+` button splits into one per language. See [Context templates → Choosing the language](./context-templates.md#choosing-the-language).

### Upgrading from 0.5

A 0.5 install's prompt, narrator, summarizer and graph-build configs carry their **prompt text only**, as prompts of the steps they fed. Their post-history placement and trigger, their own connection and sampling, and their other settings are not carried; **Admin › History** lists the configs that had set them, so you can set them again here. Each person's active pick in 0.5 becomes the value of the sessions they own, and a session that ran on 0.5's built-in reply prompt keeps it; a pick made for the whole pub becomes the genre's default; a config nobody had picked becomes a hidden preset of its genre, named after it, so nothing you wrote is lost. A 0.5 chat's own connection is not carried either: its replies use the pipeline's model or the pub default. See [Upgrading from 0.5](./upgrading-from-0.5.md).

The same happens to configurations made on an earlier 0.6 pre-release: one a preset used becomes that preset's changes, one a session picked becomes that session's values, one picked for the whole pub becomes the genre's default (and the pipeline's values on this pub, which matters for a pipeline no genre runs, such as a portrait), and one nobody picked becomes a hidden preset named after it. Nothing reads a configuration any more.

## Prompt blocks

**Prompt blocks** are the sections a prompt is built from: the instructions, the character cards, the personas, the scenario, world lore, history, relationships. Which are included, and in what order, is the **Prompt blocks** setting on the pipeline's prompt-building step. Like any setting it is the genre's default unless a preset or a session changes it.

Drag a row, or use its arrows, to move it. Switch a block off to leave it out but keep its place, or remove it to forget where it sat. Like any setting it shows a dot when changed, resets, and appears in Changes.

It never refuses a turn. A block the selected context template doesn't render is ignored, and the run's report says which. It leaves a context template you wrote alone until you change the order, and where your template has text between two blocks, the order isn't applied and the report says why.

## Where the weights live

Each lore source carries its own **share** of the context window: **Share — world lore** on the world-lore step, **Share — conversation** on the history step, **Share — relationships** on the relationships step, each with a **Most entries** limit and a **Priority**. Shares are relative: raising one takes room from the others, and a share of zero leaves that source out. The conversation also has **Always keep at least**, a minimum it always gets. The narrator pipelines find all their lore with one step, which carries **Share — world lore**, **Share — character lore** and **Share — history** side by side.

A priority of **always** puts every entry from that source in ahead of the rest, up to its **Most entries** limit. Only a pinned entry goes past that limit.

A source that found nothing this turn still reserves its share and hands what it didn't use to the others. A source added by a plugin takes part the same way, with its own share and limit, and the run's report lists which shares came from a step's own settings and which were the shipped defaults.

## A source's band in the context template

Each source's entries arrive in the prompt as a **band** with a name a context template uses, such as `worldLore`, `characterLore` or `history`. A plugin can add its own: Twenty Questions adds `secretEntry` (the thing the character is thinking of) and `briefing`, and its template places them with `{{{secretEntry}}}` and `{{{briefing}}}`.

- **A template renders only the bands it names.** If you pick a different context template for a plugin's pipeline, place its bands yourself. If a band's entries were chosen but the template never places them, the run's report says so.
- **How a band looks is a setting.** Each band appears in the prompt-building step's settings beside world lore and history, where you can pick its layout, such as prose instead of JSON.
- **A name means one thing in one prompt.** Two plugins may each have a band called `clue`, or a plugin may use a name core uses, as long as the two never meet in the same pipeline. A pipeline where they do is refused, with both sources named. A pipeline that feeds the prompt-building step its own data under a core name says so, and that name's layout setting then offers the plugin's layouts.
- **A template must fit the step.** Choosing a template that uses a name the step doesn't supply is refused, with the name it probably meant. A choice made earlier that no longer fits is kept and shows a notice on the pipeline's page until it is fixed. See [Context templates → Templates are checked when you save them](./context-templates.md#templates-are-checked-when-you-save-them).

## An envoy's prompts are settings

A genre can bring a speaker of its own, an **envoy**, such as the Guide's Serene (see [Envoys](./genres.md#envoys)). Its instructions are the genre's words, shown as the **System prompt** and **Post-history instructions** of the agent that speaks for it. Editing them stores a change like any other setting; clearing a field brings back the genre's words. They appear only on the pipeline that uses them, such as the Guide's reply.

## Pipelines that use tools

A step can be given **tools**: read-only lookups the model may ask for mid-turn instead of guessing. Serene Pub ships four: search the session's lorebook, read one entry in full, find where a phrase was said in the conversation, and read what has already been summarised. Plugins can add more.

The step asks the model, runs whatever tool it asked for, shows it the answer, and asks again, until it answers or reaches the step's **maximum passes**. Set that maximum with care: it is what stops a model that keeps asking from making a turn that never ends. The run's report says what ended it, how many passes there were and what each tool returned. Tools only read; nothing they do changes your data.

A worked example of a tool loop ships with the SDK for plugin authors (see [For plugin authors](#for-plugin-authors)). It isn't one of the pub's pipelines: earlier versions listed it as **Tool loop (reference)**, and it leaves the list when you update.

## When a preset's pipeline is missing

If a pipeline a preset runs stops being available or stops fitting what starts it (a plugin that shipped it was removed or updated, or an import brought the preset without it), sessions on that preset keep working: the change is set aside, and the genre's defaults answer that event instead. The preset's page says _Something this preset runs is not available on this pub._, the session's header shows a one-line notice, and the run's report names the pipeline that actually ran. The check runs at every start and whenever a plugin or a pipeline changes, so reinstalling the pipeline clears it by itself.

## Every reply is one run

Each reply is one **run** of its pipeline, from start to finish. The run makes the reply's message early (a **placeholder**, the row you watch fill in), gathers lore and history, builds the prompt, calls the model, and finishes by saving the text into that message. Regenerating, swiping or extending a message runs the pipeline that made it again, on the same message.

**A run says what it is doing.** While it works, the reply, the progress card above the composer and the session's row in the Sessions view all show a short status in your language: _Jasmine is thinking_ while lore is gathered, _Jasmine is composing_ while the prompt is built, _Jasmine is typing_ once the model is called, _Jasmine is reasoning_ while a model that reasons first is doing so, _waiting for the model_ or _loading the model_ when the model is busy or starting. Multi-step genres name their steps, such as _Planning the turn_ or _Keeping the record_.

**Only the writing streams.** One step's text streams into the message as it is written: the narrator's or the character's. A planner's or state keeper's work shows as steps on the progress card, never as text in the message.

**Stop ends the run.** The message's stop button and the progress card's both cut off the model and stop every later step. The message keeps whatever had arrived. Anything earlier steps already saved stays saved. A run that fails after making its message marks that message with the reason, so nothing is left spinning.

**Folded sections.** Some replies carry working a reader might want to see, such as the model's **Reasoning** or the Lair planner's beats, folded above the text. Folds are never sent back to the model: the next turn reads only the reply itself.

**Review is off unless you turn it on** (except **Portrait**, which shows its prompt first). An administrator can switch on **Review** for a step that saves or reaches outside, in **Admin › Pipelines**. A reviewed reply pauses at the save, after the model has answered, so the reviewer sees the text. Approving saves it; rejecting ends the run and marks the message with the reason. The **Image** action no longer asks for its prompt twice: the prompt typed in its form goes straight to the render, and on an upgraded pub it follows this new setting unless an administrator changed it.

Review on the reply's **placeholder** step instead (the empty message made before the model writes) pauses before anything is generated: the card says so, and approving it starts the reply. To read a reply's words before they are saved, review the step that saves the finished message. The review card opens in plain words: what is about to happen and what **Approve** does (_The AI wants to generate an image. Approve to make it, or change the prompt first._). **Details** under it names the pipeline and the step. When more than one is waiting it shows where you are (_1 of 3_, _2 more after this one_).

**A preview saves nothing, and never asks for review.** The token estimate under the composer runs the pipeline up to the model call and stops, so it measures exactly what the next turn will send without leaving anything behind. A step set to review that the preview passes is approved for the preview alone; nothing is written, and no card appears.

**The context window is worked out once.** The budget the prompt is sized to, the window the connection is told about, and the token figure shown beside a share all come from the same two facts: the call's sampling config and the model's own context window where the connection reports one.

**A character's reply ends by choosing its face.** After saving, every reply pipeline has a sprite step: one step is handed the reply's text and who said it and picks the closest sprite, if the speaker has any, and the next records it on the line. Both are ordinary steps you can see in the pipeline. The pick uses the active embedding connection; like the semantic search, it has no connection of its own to choose. A sprite you chose yourself with **Change sprite** is never replaced, and a step that picks nothing leaves the line's face as it was. See [Sessions → Sprites](./sessions.md#sprites).

## What changed since the last reply

Deleting, hiding, editing, swiping, branching and stopping are each recorded as a change to the session. The next reply's run receives the list of changes since the last reply (what was deleted, what an edit replaced, which alternative a swipe left behind), so a pipeline can tell the model that something it remembers was rewritten. The shipped pipelines don't put the list in the prompt yet; a pipeline of your own can, and the run's report shows the list.

Each change reaches one reply only. A reply that fails before saving leaves the list for the next one, and the token estimate reads it without using it up. At most the newest fifty changes are passed on. See [Floors, built-ins and what each action emits](./session-actions.md#floors-built-ins-and-what-each-action-emits) for which actions a genre may switch off.

## Forms, and when pipelines set each other off

A message can carry a **form**: a question with options, addressed to one participant, such as Story's **Ask**. If a person plays that participant, the form waits for their click. If the AI does, Serene Pub runs an **answer** pipeline that reads the participant's card and the conversation, picks an option, and presses it exactly as a click would. A form is answered once, and every screen greys it afterwards.

Pipelines can set each other off this way, so there are limits. A chain of pipelines answering one another may go four deep and sixteen runs wide; a pipeline that writes a message each time a message completes pauses after four in a row. When a chain reaches a limit, it pauses and the session owner sees **Keep going?**, which says how many more requests the chain is about to make (_The AI is about to make 3 more requests in a chain._); **Details** names the pipelines so far. **Continue** allows one more round of the same size; **Stop here** ends it and keeps what is done. With nobody there it simply waits, and a restart ends it.

While any run in the chain is waiting for review, the rest of the session is not held up.

## The cast a pipeline reads

A pipeline sees every member of the session's cast, including characters switched off in the cast list; each carries whether it is enabled. Turn-taking, `{{characterNames}}` and the speaker pickers skip characters that are switched off, but their cards are still sent, so a character the others talk about stays recognisable. Card detail for non-speakers follows the session's **Character detail** setting where the genre has one (see [Character detail](./group-sessions.md#character-detail)).

## Attachments in a prompt

A pipeline sends the files on its messages only if it has a **Place attachments** step, between the transcript and the prompt. The shipped replies (Chat, Guide, Story's narrator and voices, every Lair voice) have one, and so do the actions that write with a model (Chat's Narrate and Side character; Story's Look, Ask, Rest and Time passes; the Lair's Build room, Trigger trap, Reveal and drafted rooms) and the form answers. A pipeline without one sends no files; when nothing in the session places a kind, the composer says it can't be attached. The summarize pipelines name each file in their batches instead (`[image: cat.png]`), through the **Batch messages** step's attachments. The step is judged on the model of the step it writes for, so in Story the Narrator may see an image while the Planner does not. Its two settings are **Media lookback** (how many recent messages send their images, PDFs and sounds; older ones are sent as names, 10 by default) and **Text file budget** (how much of each text file goes in, 4,000 tokens by default). What a model sees is in [Sessions → What the model sees](./sessions.md#what-the-model-sees).

The shipped replies (Chat, Guide, Story's narrator and voices) also have a **Transcribe audio** step just before **Place attachments**. It hears the voice notes the reply's model can't, on the **Transcription** loadout's model, and keeps the words on the file so each recording is heard once; the receipt says what it heard and, when no model is set up to hear, that the notes went as names. When there is no audio to hear, or the reply's model hears it itself, it sends nothing. Its own settings are **Media lookback** (match the placement step's) and **Language**. Every **Generate reply** step has an **Outputs** setting (text, unless it asks for audio too — a spoken reply, on a model that **Speaks**) and a **Speech sampling** for the voice, used only then.

## The image step

The step that draws a picture (**Generate image**) sends its prompt to the model its loadout names (**Images**, unless the step names another) and saves what comes back. When that model is on ComfyUI, the loadout also names the [ComfyUI workflow](./connections.md#comfyui) it draws with, and the step's **Workflow** setting, shown only then, can name a different one. A few of its settings decide what it asks for:

- **Orientation**: **As set** keeps the width and height from the sampling config; **Portrait**, **Landscape** and **Square** turn that size the way you pick.
- **Transparent background**: **Off** keeps the background the model draws. **Transparent when possible** asks a model that can draw one for it, and otherwise marks the picture so its background is cut out afterwards. **Transparent from the model** only runs on a model that draws transparency itself.
- **Reference images**: a pipeline can hand the step pictures the result should look like, such as a character's likeness. With **Preferred** (the default), a model that can't take a reference image still draws, from the prompt alone, and the action's form says so before you start. With **Required**, the step refuses that model and names what it needs.
- **Seed**: **As set** (the default) uses the sampling config's seed, so a random seed stays random for every picture. **Same for every picture** picks one seed per run, so a set of pictures looks alike.

One step can ask for several pictures at once, such as one per sprite label. Serene Pub decides how many requests that takes from what the model can do: one request for several identical pictures when the model can return them together, one request per picture otherwise. Each picture is labelled with what it was drawn for, a picture that didn't come back is reported by name, and **Inspecting a run** shows the requests that were made and what each one could not honour.

The picture pipelines are **Generate image** (the composer's **Image** action), **Illustrate scene** (the composer's **Scene** action and the Backdrop widget's **Illustrate**: a short description written from the last messages and everyone's likeness, then a wide picture; its **Placement** step decides whether the picture is posted, set as the backdrop or both; see [Sessions → Scene](./sessions.md#scene)), **Fill sprites** (a character's **Fill empty sprites**, which runs on the card with no session; see [Characters → Fill empty sprites](./characters.md#fill-empty-sprites)) and **Portrait** (a character's **Generate portrait**, also on the card with no session; see [Characters → Generate a portrait](./characters.md#generate-a-portrait)). Portrait shows its prompt for review before drawing unless an administrator switches **Review** off on its picture step in **Admin › Pipelines**, and its two prompts, **Portrait, tags** and **Portrait, prose**, are the dialog's **Style** choice. Illustrate scene writes on the **Scene prompt** loadout and draws on **Scene**; the others draw on **Images**. How a person gets pictures working, without any of this, is in [Images](./images.md).

Some models ignore some sampling parameters. In **Sampling**, an image sampling config greys the parameters that the model set for images ignores, and leaves them out of the count of what is sent.

## The story clock

Every session has a **story clock**: its own "now". A session that reads no shared lorebook keeps its clock in its Session notes, unset until a person or a pipeline sets one. Until it is set or moved, a session that reads a lorebook follows the present of that lorebook (see [Sessions → Where the session reads its lorebook](./sessions.md#where-the-session-reads-its-lorebook)). Moving it changes what the session reads: lore dated after it, and dated changes that haven't happened yet, are left out.

The **Advance story clock** step moves it by a whole number (**By**, negative to go back) of minutes, hours, days, months or years (**Unit**). To move the clock once per reply, put the step in a pipeline that runs after each reply. It follows the lorebook's calendar, carrying minutes into hours and days into months; in a free-form lorebook only the part named moves. It moves only this session's clock, never the lorebook's or another session's. When it can't move the clock, for example when the result isn't a real date in that calendar, it stops with a sentence saying why and changes nothing.

## A pipeline's own session state: the annex

A pipeline or plugin often needs to remember something between turns that isn't a message: a score, a clock, a secret. Each session keeps these in its **annex**, a small store with one section per owner (`core`, or a plugin's name). Every value in it is declared in advance by its owner, with the shape it must have and **who may see it**:

| Seen by | Means |
| --- | --- |
| nobody (the default) | pipelines only, so a secret is never shown by accident |
| everyone | everyone in the session, and the model |
| every person | every human in the session |
| the AI | the model's prompt only |
| one person or one character | that person, or whoever plays that character, and that speaker's prompt |

Pipelines always read the whole annex. People only ever see the values meant for them, and so do the widgets on their screen. A context template can read declared values as `annex.<owner>.<key>` when the pipeline is set up to pass them (see [Context templates → The annex](./context-templates.md#the-annex-annex)). Some plugins let a widget save a value directly, such as a dice roll; those appear as actions the session owner can switch off. Writing a value that changed records an **Annex changed** event, which other pipelines can answer.

Plugin authors declare annex values as described in the SDK's [Storage](./sdk/guides/storage.md) and [Events](./sdk/guides/events.md) guides.

## Inspecting a run

Every run leaves a report, and the **run inspector** reads it. **Only administrators see run reports**, because a report records everything the run touched, including what a pipeline keeps hidden from the people in a session. Open it with **Inspect run** in a reply's **⋮** menu or on the turn line above the composer, **Inspect** on the progress card once a run finishes, or the pipeline's **Runs** tab in Admin.

It opens on one sentence: _Ran all 27 nodes_, _Stopped at generate on request while Jasmine is typing_, or _Halted at keeperWrite_ with the pipeline's reason. Beside it are the pipeline and its version (marked _superseded_ when the pipeline has changed since), the time, the token count, what started the run and what it left behind. A routine's run says so: _routine Note what changed, for Ann_, with _(Run now)_ when someone ran it by hand; a routine that was skipped or paused says why (_Skipped: already waiting_, _Paused after 12 runs in a row_). On a session turn, **Portrayed by** lists who played each participant for that turn (_Tom · AI_, _Elara · you_); see [Who portrays a participant this turn](./session-actions.md#who-portrays-a-participant-this-turn).

Each step has a time limit. A step that runs out of time is marked _timed out_, and when its pipeline lets it fail and carry on, as the lore reads do, a warning under the sentence names it with its limit: _1 step ran out of time and added nothing to this run: worldLore (2 s)._ That step's lore is missing from the reply. See [Lore is missing from a reply](./troubleshooting.md#lore-is-missing-from-a-reply).

On the left is every step in the order it ran, with how long it took and a marker on the ones that called a model. Select one to see:

- **Prompt**: what the step sent. Lore and history are a table showing each item's source, token cost, whether it made it in, and why. The messages follow as readable text. A prompt-building step also says what happened to the post-history reminder: _included at message 12_, or _suppressed, 278 tokens is below the 3000 trigger_. Under it, **Variable layouts** lists each value the template placed, the layout it rendered through (_Titled JSON block (Serene Pub's)_, or _built-in default_ when none was picked), and which variable it held, such as `core:var/world-lore@1` for core's own world lore.
- **Output**: what the step produced.
- **Wire**, on a step that called a model: the address, the exact request (with **Copy request**) and the raw response, plus every stop sequence and whether it was sent. This is where you see which sampling settings a service actually received.
- **Notes**: anything the step recorded about itself.

A step that ran scripts also has a **Scripts** block: each script, the seam it ran at, whether it came from the pipeline's settings or the connection, what it did, and, for stop scripts, which one cut the reply. See [Scripts → Seeing what ran](./scripts.md#seeing-what-ran).

## What a ranker decided is recorded

When a run chooses which lore and history go into a prompt, each candidate's verdict is kept: whether it went in, why, its score and tokens, and which keywords matched where. Nothing needs switching on. A session keeps its newest 200 of these rankings. The lorebook reads these records to show, for each entry, whether it went in on recent turns and why.

## How updates to shipped pipelines reach you

Serene Pub identifies each shipped pipeline by its content, not just its version number. When an update changes a pipeline, the new one is filed beside the old and becomes current at the next start, so updates always arrive. Nothing old is deleted: a run report still opens the exact pipeline it used, marked _superseded_ when it has since changed.

A step a pipeline uses can also become unavailable, for example when the plugin that provided it is removed. The pipeline's page then shows a _cannot run_ notice on that step, and a run that reaches it stops with a sentence rather than failing silently.

## A plugin's settings

A plugin's settings are on its own page: open the plugin from **Admin › Extensions › Plugins** and fill in its **Settings** card, which is saved with the rest of the page by **Save** in the save row at the bottom. Only the fields you change are sent. A setting the plugin marks as personal can also be changed by each person for themselves, on the **Extension settings** card in **Settings › User**. Their own value wins, then the administrator's, then the plugin's default. Nobody sees another person's values, and uninstalling the plugin removes them.

## Turning a plugin off

Switching a plugin off in **Admin › Plugins** removes everything it provides from every list and picker: its genres, pipelines, presets, actions, prompts, templates, scripts, widgets and styles. Nobody can start a new session in its genre. Nothing is deleted, and switching it back on restores it all. A session already running on something it provided keeps running, but the plugin's actions aren't offered while it is off.

## The pipeline library

**Library**, at the top of **Admin › Pipelines**, opens the pipeline library: everything the pipelines are built from, and what uses each piece. Its tabs are **Pipelines**, **Prompts**, **Context templates** and **Variable layouts**.

- **Pipelines** lists every pipeline with its version and number of steps; each opens its page in Admin.
- **Prompts**, **Context templates** and **Variable layouts** are grouped by the step or variable that uses them, not by pipeline, because a step and its prompts are shared by every pipeline that reuses it. Each can be edited, duplicated or deleted here, and each group of templates or layouts has **New** to write another. A group with nothing written yet uses its step's built-in default.

Every row says what uses it (_Used by …_) or _Not used by any pipeline_, so you know before deleting whether anything depends on it. Deleting something still in use names what holds it, and is refused until those point somewhere else.

## Recent runs

Under the list in **Admin › Pipelines**, **Recent runs** shows the newest runs across every pipeline: a green dot for a run that ended _ok_ and an amber one for any other outcome, the pipeline and its genre, the outcome when it wasn't _ok_, and when it ran. The count beside the title says how many of the recent runs ended _ok_ (_281 of 300 ok_). **Failed only** narrows the list to failures, and the **Needs you** item about failed runs opens it that way. Select a run to open its pipeline's page, whose **Runs** tab has the full report (see [Inspecting a run](#inspecting-a-run)). The list's **Last runs** column shows each pipeline's last five outcomes the same way.

## The events page

**Admin › Pipelines › Events** lists every event the pub knows and what answers it. An **event** is something that happened (a message saved, a session created) or a request to run something (an action). Filter the list by family, by who declared it (core or a plugin), by genre, or by whether a preset runs anything on it. The list is read-only: events arrive with core and plugins.

Open an event to see what causes it, which genres list it (and whether each requires it), which presets run which pipeline on it, and, for a plugin's event, which pipelines may record it. To change what runs on an event, open the preset in **Admin › Presets**.

At the foot of an event's page, the **event map** draws events, pipelines and listeners as boxes joined by **binds** (a pipeline runs on the event), **causes** (running it records the event) and **listens** (a listener hears it), with the event you opened highlighted. It opens on the event's first genre (Chat if it has none); pick another genre, a preset, or add `?session=<id>` to the address to see what one session runs. Click a box to open it: another event opens its page, a pipeline its workspace.

## For plugin authors

This page is for people setting up what is installed. If you are writing a pipeline or a plugin (shipping a genre and its defaults, a preset or a routine, declaring actions and forms, recording events, keeping state in the annex, adding a lore source or a ranker, choosing which step streams), start with the SDK guides: [Your first plugin](./sdk/guides/your-first-plugin.md), [Genres, presets and routines](./sdk/guides/genres-presets-and-routines.md), [Forms and effects](./sdk/guides/forms-and-effects.md), [Events](./sdk/guides/events.md) and [Storage](./sdk/guides/storage.md). [Events and what they carry](./sdk/events.md) lists what each event, action and routine hands a pipeline.

## Related

- [Context templates](./context-templates.md): the structure a prompt is built from, chosen on the prompt-building step.
- [Connections](./connections.md): where models run, and sampling configs.
- [Pub settings](./system-settings.md): the pub's defaults underneath all of this.
