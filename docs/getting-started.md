# Getting started

New to Serene Pub, or to AI chat apps in general? Start here. These pages take you from nothing installed to your first story, one step at a time, and assume no technical knowledge at all.

_Written for Serene Pub 0.6._

## The path

Follow these in order. Each page says what you'll have at the end of it, and what you should see on screen after each step.

1. [What is Serene Pub?](./what-is-serene-pub.md): what it does, and what you need before you start.
2. [Install Serene Pub](./install.md): download it, start it, and open it in your browser.
3. [Connect a model](./connect-a-model.md): give it an AI to write with. This is the one step it can't do without.
4. [Your first session](#your-first-session), further down this page: pick a character, choose who you are, and start talking.
5. [Getting around](./getting-around.md): the rail, the sidebar, search and Help, so you can find everything else.

Already installed and connected? Skip to [Your first session](#your-first-session).

:::note Someone else runs this pub for you?
If you were given an address and an account on someone else's pub, you don't need steps 2 and 3: the person who runs it has done them. Open the address, sign in, and carry on from [Your first session](#your-first-session).
:::

**Coming from SillyTavern?** Read [Coming from SillyTavern](./coming-from-sillytavern.md) for where everything you know lives here. Install first, then see [Importing from SillyTavern](./importing-from-sillytavern.md) to bring your characters and chats across. Your SillyTavern cards also work one at a time, straight from the wizard below.

## Your first session

:::note By the end of this section
You'll have a character, a persona for yourself, and a session where the character has answered you.
:::

:::note You'll need
Serene Pub open in your browser ([Install](./install.md)). If you run the pub, you also need a model connected ([Connect a model](./connect-a-model.md)); the wizard below helps you do that if you haven't yet.
:::

The first time you open Serene Pub, a short **setup wizard** fills the home page. It shows one question per screen, with a bar across the top showing how many screens there are and which one you're on. Click a finished screen in that bar, or press **Back**, to return to it.

<!-- SHOT: the wizard's progress bar and the Get started screen -->

### 1. Get started

The first screen is headed **Welcome to Serene Pub**. Choose your **Language**: the rest of the app is shown in the language you pick. If you haven't given the app a name to call you yet, there's also **What should we call you?**: the name the characters will see when you speak as yourself. It's optional; leave it empty to go by your username, and change it later in **Settings › User**. Then press **Get started**.

Under every screen of the setup, **You can browse the entire documentation in the app at any time** opens these pages.

:::tip You should see
The next screen. If you run the pub, it's **Choose an LLM**. If someone else does, it's **What would you like to do?**: skip to step 3.
:::

Leave the language on English if you're not sure; you can change it any time in **Settings**. See [Languages](./languages.md).

### 2. Choose an LLM

Only the person who runs the pub sees this screen. An **LLM** (large language model) is the AI that writes the replies, and this is where you connect one. [Connect a model](./connect-a-model.md) walks through this screen choice by choice, so if you haven't read it yet, do that now and come back.

The short version: if a model program is already running on this computer, it's listed under **Found on this computer**: click it, pick a model and press **Use this model**. Otherwise pick one of the ways under **Or set one up** and follow along in the **Connections** view, which opens beside the wizard.

:::tip You should see
You don't need to press anything when you're done. As soon as your pub can reply, the wizard moves on to **What would you like to do?** by itself.
:::

:::warning If this didn't work
- **The wizard keeps waiting.** No model is ready to answer yet. If you added an online service, press **Choose which model replies** and pick one. If a download is still running, let it finish.
- **You closed the Connections view.** Press **Open the setup again** (or **Open Connections**) to bring it back.
- Still stuck? See the [Check that it worked](./connect-a-model.md#check-that-it-worked) section of Connect a model.
:::

### 3. What would you like to do?

Two choices. You can do both later; this is only where to start.

- **Play with characters**: the AI plays a character and you play yourself (or someone you make up). Choose this for your first story. It adds the two screens below.
- **Talk to an AI**: a calm conversation with **Serene**, Serene Pub's mascot and guide, who answers questions about the app from this documentation. Pressing it starts a session called *Welcome to Serene Pub* straight away, and Serene greets you. If it says *The Guide is switched off on this pub*, the person who runs the pub has turned it off.

### 4. Pick a character

The AI plays the character you pick here. Any characters you already have are listed: click one to select it (it gets an outline and a tick). If you have none yet, add one:

- **Browse the library**: ready-made characters shared by the community. The easiest start. The **Library** opens beside the wizard; anything you import there appears in the list here.
- **Import a card**: a **character card** is a picture (or a small file) with a character written inside it, the format SillyTavern and similar apps use. Drop a `.png`, `.json` or `.charx` file, or press **Browse**.
- **Create one**: a name, a picture and a few lines of personality, in a short guided form.

A character you import or create is selected for you. Press **Continue**.

:::tip You should see
**Who are you in the story?**
:::

### 5. Who are you in the story?

Your **persona** is you, in the story: the name and description the AI knows you by. A persona is simply a character you play.

- **Just call me "You"**: the quickest start. It makes a persona named *You* that you can fill in later. Pick this if you're not sure.
- **Create one**: your name, a picture and a few lines about you.
- **Import a card**: any character card works as a persona.

Press **Start the session**.

:::tip You should see
Your new session, with the character you picked. Usually their first message is already there. Type something in the box at the bottom and press **Enter**: after a moment, the character's name shows *thinking*, then *typing*, and their reply appears.
:::

:::warning If this didn't work
- **Nobody replies after you send.** The pub's model isn't answering. If you run the pub, open **Connections** on the rail and look at the status line at the top; [Connect a model](./connect-a-model.md#check-that-it-worked) explains each state. If someone else runs it, let them know.
- **The reply is gibberish, or never stops.** The model and its settings don't match. See [Troubleshooting](./troubleshooting.md#replies-are-garbled-or-wrong).
- More fixes for a session that misbehaves are in [Sessions](./sessions.md#troubleshooting).
:::

That's it: you're playing. Not happy with a reply? Hover it and press **Regenerate**, or use the arrows beside it to try another version. [Sessions](./sessions.md) covers everything else you can do in a session.

<!-- SHOT: a first session with the character's reply and the swipe arrows -->

## Your home screen

Once you've started a session (and, if you run the pub, a model can reply), the home page stops showing the wizard. Instead it shows what you were doing:

- A greeting, with how many sessions are waiting on your reply, an **Import a card** button and a **New session** button.
- **Pick up where you left off**: your most recent sessions, newest first. A **Your turn** label marks one waiting on you; **Continue** opens it.
- A **Characters** shelf of your characters, with **All** to open the Characters view and a **New or import** tile.
- **Playing as**: your personas.
- At the foot, links to the **Documentation** and to **Document View**, a simplified, screen-reader-friendly version of the app.

## If the wizard comes back

The home page shows the wizard again while something you need is missing:

- **If you run the pub:** no model is set to answer sessions any more, so **Choose an LLM** is back.
- **For everyone:** you haven't started a session yet. If you run the pub and it can already reply, the wizard skips straight to **What would you like to do?**.

Leaving the wizard partway through is safe. Anything you already made (a connection, a character, a persona) is kept, and the next visit picks up where you left off.

**On the Android app**, **Choose an LLM** doesn't look for programs on this device and offers only **An online service** or **A custom connection** (a model running on another computer), because a phone can't run a model itself. See [Android app](./android.md).

## Setting up for other people

If you run the pub and want friends or family to use it too, give each of them an account: see [Users and accounts](./users-and-accounts.md). To reach your pub from outside your home network, see [Hosting](./hosting.md).

## Next

[Getting around](./getting-around.md) →: the rail, the sidebar, search and Help.
