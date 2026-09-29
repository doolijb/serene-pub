# Getting Started

The first time you open Serene Pub, a short setup wizard asks a few questions and then drops you straight into your first session. It takes a few minutes. This page walks through each screen and says what to pick if you're not sure.

Never used an AI chat app before? That's fine. Nothing here needs any technical knowledge. If you'd like the background first, read [What is Serene Pub?](./what-is-serene-pub.md), then [Install Serene Pub](./install.md) and [Connect a model](./connect-a-model.md).

## The wizard at a glance

The wizard shows one question per screen. A bar across the top shows how many screens there are and which one you're on; click a finished one to go back to it, or use **Back** at the bottom.

1. **Get started**: a welcome, and the language you'd like to use.
2. **Choose an LLM**: the AI that writes the replies. Only the person who runs the pub (the admin) sees this screen.
3. **What would you like to do?**: **Talk to an AI**, or **Play with characters**.
4. **Pick a character** and **Who are you in the story?**: only if you chose **Play with characters**.

When you finish, the wizard opens your new session. From then on, the same page is your home screen.

<!-- SHOT: the wizard's progress bar and the Choose an LLM screen -->

## 1. Get started

The welcome screen says what's about to happen and has one choice on it: your **Language**. Everything after this is shown in the language you pick. If you're the admin, it also becomes the default for everyone on your pub; anyone can change their own later in **Settings**. See [Languages](./languages.md).

Click **Get started** to carry on.

<!-- SHOT: the Get started screen with the Language picker -->

## 2. Choose an LLM

An **LLM** (large language model) is the AI that actually writes. Serene Pub doesn't include one; it connects to one. This screen asks where yours should run.

It starts by looking for model servers already running on this computer: **Ollama**, **LM Studio**, **llama.cpp** and **KoboldCPP**. Anything it finds is listed first, under **Found on this computer**, as a card with the program's name, its address and how many chat models it has; the first card with a model is marked **Recommended**. Click a card, pick a model, and click **Use this model**. That's the whole setup. If you start one of those programs while the wizard is open, **Scan again** looks once more.

Below that, under **Or set one up**, are the ways to get a model when nothing is running yet. Each lists what it costs you in a few short tags.

- **KoboldCPP, run by Serene Pub** (_Private · Free · Needs about 8 GB of memory_). Serene Pub downloads a program called KoboldCPP and a model that suits your computer, and runs them for you. When nothing was found, this is the **Recommended** choice on a reasonably strong computer.
- **Ollama, managed by Serene Pub** (_Private · Free_). For a computer with Ollama installed: Serene Pub connects to it and downloads models into it for you.
- **An online service** (_Fast · Nothing to install · Costs per message_). OpenAI, Anthropic, OpenRouter, Groq and more. You need an account with the service and an API key (a long password the service gives you).
- **A custom connection**. A server on another computer, or one on an unusual address. You type its address in Connections.

On the Android app there is no scan and nothing runs locally, so the list is headed **Where it runs** and offers only **An online service** and **A custom connection**.

Not sure which? [Connect a model](./connect-a-model.md) explains the trade in plain terms and walks through each one.

<!-- SHOT: the Choose an LLM screen with one Found on this computer card marked Recommended, and the Or set one up options below -->

What happens next depends on your choice:

- **A card under Found on this computer** shows that program's chat models. Pick one and click **Use this model**; the wizard moves on as soon as it is registered. If the program is running but has no chat model loaded, load one (for Ollama, **Get a model** opens it in Connections so you can download one there) and click **Check again**.
- **KoboldCPP, run by Serene Pub** opens the **Connections** panel on the KoboldCPP setup: pick the download that suits your computer, then a model. Downloads can take a while. The wizard waits, and moves on by itself once the model is ready. **Open the setup again** reopens the panel if you closed it.
- **Ollama, managed by Serene Pub** opens the Connections panel on Ollama: download a model there and choose it for chat. The wizard moves on by itself once it can reply.
- **An online service** opens the **New connection** window in the Connections panel. Choose your service, paste its API key and pick a model. The wizard moves on by itself once a model can reply. If you've added it and the wizard is still waiting, click **Choose which model replies**.
- **A custom connection** opens the same window, narrowed to programs you run yourself. Pick the program from the **Service** list and give its address. The wizard moves on by itself once a model can reply.

You never need to come back and press anything: as soon as your pub can reply, the wizard goes to the next screen. If you return to this step later, it simply reads **Your pub can reply** and names the connection, with a **Continue** button.

:::note Embeddings are optional
Earlier versions asked about embeddings (smarter lore search, also called RAG) during setup. The wizard no longer does: your pub works without them. Turn them on whenever you like in **Connections**. See [Embeddings & RAG](./embeddings-and-rag.md).
:::

## 3. What would you like to do?

Two big choices. You can do both later; this is just where to start.

- **Talk to an AI** starts a conversation with the **Guide**, an AI helper that knows Serene Pub and its documentation. Ask it anything, including how to do something in the app. Clicking it starts the session straight away; there are no more screens.
- **Play with characters** is for stories: the AI plays a character, and you play yourself (or someone you make up). It adds two more screens, below.

If the admin has switched the Guide off, **Talk to an AI** says so and can't be chosen.

<!-- SHOT: the What would you like to do screen with its two choices -->

## 4. Pick a character

Only if you chose **Play with characters**. The AI plays the character you pick here.

Any characters you already have are listed; click one to select it (it gets a gold outline and a tick). Or add one:

- **Create one**: a name, a picture and a personality, in a few short steps. The new character is selected for you.
- **Browse the library**: ready-made characters from the community. The **Library** opens beside the wizard; a character you import there shows up in the list here, ready to pick.
- **Import a card**: drop a character card file (`.png`, `.json` or `.charx`, as used by SillyTavern and other apps) or click **Browse**. The imported character is selected for you.

Coming from SillyTavern with a whole library? The admin sees a link to **Import your characters and personas** (not on the Android app). See [Importing from SillyTavern](./importing-from-sillytavern.md).

Click **Continue** once a character is selected. See [Characters](./characters.md) for everything a character can hold.

## 5. Who are you in the story?

Your **persona** is the character you play. The AI sees its name and description, so it knows who it's talking to. If you already have personas, your default one is selected; click another to change it. Or add one:

- **Just call me "You"**: the quickest start. It makes a simple persona named "You" that you can fill in later.
- **Create one**: your name, a picture and a few lines about you.
- **Import a card**: a persona is just a character card you play, so any card works.

Click **Start the session**. The wizard opens your new session with the character you picked, and you can write your first message. See [Personas](./personas.md) and [Sessions](./sessions.md).

<!-- SHOT: the Who are you in the story screen with a persona selected and Start the session -->

## The home screen after setup

Once every required step is complete, this same screen stops showing the wizard and answers one
question instead: what were you doing?

- A **greeting** for the time of day, with how many sessions are waiting on your reply, an
  **Import a card** button that imports a character card straight from a file, and a
  **New session** button.
- **Pick up where you left off**: up to four sessions with messages, newest first. Each card shows
  the cast's faces, the genre and when it was last active, and who said the last line and what
  they said. A **Your turn** chip marks a session waiting on you. **Continue** opens the session.
  On a phone the cards stack one to a row.
- A **Characters** shelf of portrait cards, with an **All** link that opens the Characters view,
  and a **New or import** tile. On a phone it shows two cards to a row; on a wide screen it is a
  single row of as many as fit.
- A **Playing as** row of your personas. Clicking one opens it in the Characters view.
- At the foot, quiet links to the **Documentation** and to **Document View**.

A quiet one-line notice at the top of the home reminds you the app is in beta and under active
development.

## When the wizard comes back

The home page shows the wizard instead of the home screen while something you need is missing:

- **For the admin:** the pub can't reply yet (no model is set to answer sessions), or
- **For everyone:** you haven't started a session yet.

Having a character or a persona is not required, since a Guide session needs neither. If the pub can already reply, the admin's wizard skips straight to **What would you like to do?**.

Leaving the wizard partway through is safe. Anything you created (a connection, a character, a persona) is kept, and the next visit to the home page starts where the facts say you are.

### If you're not the admin

Connecting a model is the pub's business, so people who join someone else's pub never see **Choose an LLM**: their wizard is **Get started**, then **What would you like to do?**, and the character screens if they choose them. See [Users and Accounts](./users-and-accounts.md).

### On the Android app

**Choose an LLM** has no scan on the Android app, and nothing runs on the phone itself: pick **An online service**, or **A custom connection** to point it at a server on another computer (see [2. Choose an LLM](#2-choose-an-llm)). See [Android App](./android.md).
