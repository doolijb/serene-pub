# Scripts

A **script** is a short piece of code that runs inside a pipeline, at one particular place in it, and changes what passes through: it tidies a reply, adds a reminder to the prompt, drops a piece of lore, or decides who speaks next. Scripts are written in the app, in **Admin › Scripts**, and only an administrator can write one, attach one, or see what one did.

:::tip You may never need this page
Serene Pub works without a single script. Come here when a model keeps writing something you want gone, when you want a rule the settings don't offer, or when you need to know what a script someone attached is doing.
:::

## What a script can do

Every script has a **type**, and the type decides two things: what the script is handed, and how much it is allowed to change. The second is the type's **blast radius**, shown as a badge wherever the script appears, so you can tell at a glance how much harm a broken one could do.

| Type | What it does | Blast radius |
| --- | --- | --- |
| **Transform text** | Rewrites a piece of text: strips a phrase, fixes spacing, replaces a name. | Rewrites content |
| **Stop generation** | Decides where a reply should end, such as at a leaked template token or an impersonated speaker. | Ends generations |
| **Inject messages** | Adds messages at a chosen depth: a reminder, a system note, the start of the reply. | Additive only — cannot change existing history |
| **Transform messages** | Rewrites or drops messages before they reach the model. | Can remove or rewrite history |
| **Filter candidates** | Drops retrieved lore before ranking, with a reason on each. | Excludes lore |
| **Rescore candidates** | Adjusts retrieval scores so the ranker orders lore differently. | Reorders ranking |
| **Transform context** | Edits the values a prompt template fills in, such as instructions or the scenario. | Edits instructions |
| **Transform cast** | Edits the cast a step picked out of the scene: renames someone, merges aliases, drops a wrong detection, adds someone the model missed. | Rewrites who is in the scene |
| **Select the speaker** | Decides who takes the next turn. | Decides who speaks |

Plugins can add types of their own; they show the same way.

**Inject messages** and **Transform messages** are separate on purpose. Injection can only add, so you can trust an injection script with a session's history in a way you might not trust one that rewrites it. Injected messages reach the model through the context template; see [Context templates → The injectionsByIndex map](./context-templates.md#the-injectionsbyindex-map).

**Stop generation** is different from the rest. A stop script never changes the text; it only answers "where should this end?" Every stop script at a place gets its say, and the earliest ending wins, so their order does not matter.

## Where a script can go

A script runs at a **seam** of a [pipeline](./pipelines.md) step: a place where a value passes by and a list of scripts may act on it. Not every step has seams, and each seam takes only the types that fit what passes through it: a seam on a reply's text takes **Transform text** and **Stop generation**, never **Filter candidates**.

Each seam has an address, shown in its label and wherever scripts are listed:

| Address | Where the scripts run | Label |
| --- | --- | --- |
| `in:` and a value's name | on that value as it goes **into** the step, before the step works | _Scripts · before text_ |
| `out:` and a value's name | on that value as it comes **out** of the step, after the step works | _Scripts · after text_ |
| a point's name | at a point **inside** the step, where the step hands a value over and carries on | _Scripts · at each draft_ |

So `in:text` on the step that writes a message is the text before it is saved, `out:cast` on the step that picks out the cast is the cast it found, and `select` on the turn order's step is the moment it chooses a speaker.

### Attaching scripts to a seam

Open a pipeline in **Admin › Pipelines** and open a step's **Advanced** fold. Each seam is one list, labelled with where it runs. Under the label, a muted line says what flows there, and chips name the script types the seam takes, so an empty list still tells you what could go in it. The picker offers only scripts of those types.

Add scripts, drag them into order, or remove them. A list is a setting like any other: what you save there is the genre's default, so it reaches every session of the genre that hasn't changed it, and a preset can change it for its own sessions (see [Pipelines › Where a value comes from](./pipelines.md#where-a-value-comes-from)). A script that has since been deleted stays in the list as _Missing script_ until you remove it.

### The order scripts run in

Within one step, seams run in the order the step reaches them:

1. every `in:` seam, as the values arrive;
2. the seams inside the step, as the step reaches each;
3. every `out:` seam, as the values leave.

Within one seam, scripts run top to bottom, and each script is handed what the one above it returned. **Advanced** lists a step's seams in this order too, so reading down the box is reading the step in run order. A disabled script, and every script while **Run scripts** is off in [Pub settings](./system-settings.md#scripts), is skipped.

## The script map

To see every seam in a pipeline at once, open the pipeline in **Admin › Pipelines** and choose the **Scripts** tab, beside **Configure**. The **script map** lists every seam in the order the pipeline runs them, grouped by step, with the scripts attached to each.

On a seam that can end a reply, the map also shows the [stop scripts of the connection](#a-connections-stop-scripts) that join it. Pick a row to jump to that step's list in **Configure**.

The map only reads. To change a list, use the step's **Advanced** box.

## When a seam disappears

A pipeline can change under a script list: an update renames a step's value, or a plugin drops a point. A list whose seam no longer exists is **unplaced**. Serene Pub never deletes it for you.

- In the step's **Advanced** box, the list stays, marked _no longer here_. Everything else on the page saves as usual.
- In the script map, it is listed under **Unplaced**.
- In **Admin › Scripts**, its scripts count as used, under the **Unplaced** filter.
- **Admin › Diagnostics** shows one line counting unplaced lists, so you hear about it without opening every step.

When the pipeline runs, it skips an unplaced list and records a note. The one exception is a list holding a **Stop generation** script: rather than let a guard you rely on quietly stop working, the run **halts**, saying _stop guard "name" has no place to run on step_ and the step. The reason shows where any halted reply does, including the progress card in the session.

To fix it, open the step, move the scripts to a list that still exists, and remove the old one.

## Seeing what ran

The [run inspector](./pipelines.md#inspecting-a-run), which only administrators see, has a **Scripts** block on each step that ran any. One row per script that ran:

- the script's name and the seam it ran at;
- where it came from: the pipeline's settings, the connection, or the step itself;
- what happened: _ok_, _skipped_ with the reason, or _error_;
- on a stop script, whether its ending was the one used, the place where the reply was cut;
- how long it took.

When a reply comes back short, this is where you see which stop script cut it.

## Admin › Scripts

**Admin › Scripts**, under **Pipelines** in Admin, lists every script on the pub with its **Type**, **Scope** (what it works on: text, messages, candidates and so on), **Status**, how many places use it, and **Fits**: how many seams across the installed pipelines it could go on. A script that fits nowhere is easy to spot.

### Finding a script for a place

The filters answer "what could go here?":

- **Genre**, **Pipeline**, **Step** and **Seam** narrow the list to scripts that fit. A script fits a seam when the seam takes its type, a step when it fits any of the step's seams, a pipeline when it fits any of its steps, and a genre through the pipelines its presets run. This is the same idea as the filters on **Admin › Prompts**.
- **Use** shows how scripts are used today: **In a pipeline**, **On a connection**, **Unplaced** or **Unused**.
- **Type**, **Scope**, **Status** and **Origin** (built-in or yours) work as their names say.

### A script's page

A script's page has its name, its status, what it declares it reads and rewrites, and its source in an editor. **Where used** lists every place it is attached: each pipeline, step and seam, with a link that opens the step in the pipeline's **Configure** tab, and each connection, with a link to that connection's stop scripts.

Scripts Serene Pub or a plugin ships are read-only. **Clone**, on the row and on the page, makes an editable copy of the same type for you to change and attach instead.

### Disabling, deleting, exporting

- **Disabling** a script keeps it in every list but skips it when the pipeline runs. To stop every script at once, use **Run scripts** in [Pub settings](./system-settings.md#scripts).
- **Deleting** is refused while a script is used anywhere, including on a connection or in an unplaced list; the refusal names a place it is used. Remove it from those places first. Built-in scripts can't be deleted.
- **Export** downloads the selected scripts, or **Export all** every script, as one pack. **Import** reads a pack, shows what it holds, and adds the scripts.

## A connection's stop scripts

A connection can carry its own **Stop generation** scripts, for problems that belong to one service or model rather than to a pipeline, such as a token one model keeps leaking. They are in the connection's settings under **Advanced and notes** (see [Connections → A connection's view](./connections.md#a-connections-view)) and on its page in **Admin › Models › Connections**.

They join every seam that can end a reply on that connection, alongside the stop scripts the configuration attaches there. Since the earliest ending wins, the two never need ordering against each other. The script map shows them on those seams, and the run inspector marks them as coming from the connection. They work beside the connection's [stop sequences](./connections.md#stop-sequences), which the service applies itself.
