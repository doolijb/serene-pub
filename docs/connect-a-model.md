# Connect a model

Give your pub an AI to write with: either one running on your own computer, or one you reach through an online service.

_Written for Serene Pub 0.6. This is step 3 of Start here._

:::note By the end of this page
Your pub is connected to a model, and sessions can reply. This is the only step Serene Pub can't do without, so it's worth ten minutes.
:::

:::note Someone else set this up for you?
If you were invited to someone else's pub, the person who runs it has already connected a model and you can skip this page. Carry on with the rest of [Start here](./getting-started.md).
:::

## What a model is

A **model** (often called an **LLM**, a _large language model_) is the AI that actually writes. You give it the story so far, and it writes what comes next. Models come in different sizes: bigger ones write better and follow a scene more closely, but need more computer to run.

Serene Pub doesn't come with a model built in. It reaches one through a **connection**: a saved note of _which_ model to use and _where_ it runs. You'll usually have one connection, and you can add more later.

:::tip Connection vs. model
Think of the connection as the phone line and the model as the person who answers. One connection can offer several models, and you choose which one answers your sessions.
:::

## Choose where your model runs

There are two kinds, and neither is wrong. Here's the honest trade:

|                   | **On this computer** (local)                                                                                                                                                                                | **An online service** (hosted)                                                                  |
| ----------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------- |
| **Cost**          | Free.                                                                                                                                                                                                       | Usually a small charge per message, paid to the service. Some services offer a few free models. |
| **Privacy**       | Nothing you write leaves your computer.                                                                                                                                                                     | Everything in the story is sent to the service each time the AI replies.                        |
| **Your computer** | Needs a reasonably strong one: a graphics card with about **8 GB of memory** runs good small-to-medium models. Less memory, or no graphics card, still works but replies are slower and the models smaller. | Any computer, even an old laptop or a phone.                                                    |
| **Quality**       | Good, and very good on a powerful machine.                                                                                                                                                                  | The largest, most capable models are only available this way.                                   |
| **Rules**         | Your model, your rules.                                                                                                                                                                                     | Each service has its own content rules, and some refuse certain kinds of story.                 |
| **Setting up**    | A few clicks and a download of several GB.                                                                                                                                                                  | Make an account, add credit, copy a key.                                                        |

**Not sure?** If your computer is a gaming PC or a recent Mac with 16 GB of memory or more, try **local** first: it's free, and you can always add a service later. On a laptop without a graphics card, or on the Android app, go **hosted**.

## If you chose local: KoboldCPP (recommended)

Serene Pub can download, start and look after a program called **KoboldCPP**, which runs models on your computer. You never have to open it yourself.

1. In the setup wizard's **Choose an LLM** step, under **Or set one up**, choose **KoboldCPP, run by Serene Pub**. The **Connections** view opens beside the wizard on **Set up chat**.
2. **Pick a build.** Serene Pub lists versions of KoboldCPP for different kinds of computer, each with a short description saying which hardware it suits (for example, NVIDIA graphics cards, other graphics cards, or no graphics card). Pick the one that matches yours. It downloads and starts on its own.
3. **Pick a model.** A list of recommended models appears. Serene Pub asks **How much memory does this machine have?** Answer with your graphics card's memory (or your Mac's memory), or **Not sure**. Rows that fit turn gold, and the first one that fits gets a gold **Get** button.
4. Click **Get**. A small window lists the model's files; each says whether it **Fits**, is **Tight**, or is **Too big** for your memory. Choose one that fits and click **Download**. Models are several GB, so this can take a while.
5. When the download finishes, the model becomes the one your sessions use, and **Set up chat** shows **Done**.

<!-- SHOT: the model finder with a memory tier set and one gold Get button -->

:::note We'll come back to this
You'll see settings such as **GPU Layers**, sampling and prompt formats along the way. Leave them all as they are; the defaults are chosen to work. [Connections](./connections.md) explains them when you want to tune things.
:::

### Already running Ollama, LM Studio, llama.cpp or KoboldCPP?

The wizard looks for them. Anything it finds running on this computer is listed first, under **Found on this computer**, as a card naming the program, its address and how many chat models it has; the first one with a model is marked **Recommended**. Click the card, pick a model, and click **Use this model**. That's the whole setup: nothing to install and no address to type.

If the card says the program is running but has no chat model loaded, load one in that program (for Ollama, **Get a model** opens it in Connections so you can pull one there), then **Check again**. Started the program after the wizard opened? **Scan again**.

If you'd rather Serene Pub download models into Ollama for you, choose **Ollama, managed by Serene Pub** under **Or set one up** instead.

## If you chose hosted: OpenRouter (recommended)

**OpenRouter** is one account and one key that reaches hundreds of models from many companies, including a few free ones. It's the easiest way to try several models and see which you like.

1. Go to [openrouter.ai](https://openrouter.ai), make an account, and add some credit (a few dollars goes a long way).
2. In OpenRouter's settings, create an **API key** and copy it. An API key is a long password that lets Serene Pub use your account. Keep it private.
3. In the setup wizard's **Choose an LLM** step, choose **An online service**. In the **New connection** window that opens, type **OpenRouter** into the **Service** search, pick it, and click **Create**.
4. Paste your key into the **API Key** field and click **Test**.
5. Choose a model from the list and save.

:::tip What does it cost?
Services charge by the amount of text sent and written, measured in **tokens** (roughly three-quarters of a word each). Every reply sends the story so far, so replies cost a little more as a session grows. With a mid-range model, a long evening's session typically costs somewhere between a few cents and a dollar. Each service shows prices per model and a running total in your account.
:::

**Prefer a particular company?** OpenAI and Anthropic (Claude) work the same way: pick them in the **Service** search, and paste a key from their own website. See [Where the API keys come from](./connections.md#where-the-api-keys-come-from). Many other services are listed too; see [the full list](./connections.md#openai-compatible-services).

### A model on another computer

On the Android app, or if a stronger computer in your home already runs KoboldCPP, Ollama or LM Studio, choose **A custom connection** in the wizard and pick that program from the **Service** list. Instead of a key, you give it that computer's address, such as `http://192.168.1.42:5001`. (The wizard only scans the computer Serene Pub itself runs on, so a program on another machine never shows up under **Found on this computer**.)

## Check that it worked

:::tip You should see
The wizard moves on by itself to **What would you like to do?** (If you come back to the model step later, it reads **Your pub can reply**, naming your connection.) In the **Connections** view (open it from the rail, the strip down the left edge of the window) the status line at the top reads **Sessions can reply**, with the model and connection that answer.
:::

<!-- SHOT: the Connections view's status strip reading "Sessions can reply" -->

That's it: your pub can write. The wizard now asks what you'd like to do first: **Talk to an AI** (a conversation with Serene, Serene Pub's guide) or **Play with characters** (pick a character, and a persona for yourself). Either is a fine place to start.

:::warning If this didn't work
- **The connection says _Needs a key_.** It's waiting for you, not broken: open it and paste the API key.
- **The connection says _Not reachable_.** Serene Pub can't find the program or service. For a local program, check it's running; for another computer, check the address and that both are on the same network; for a service, check your internet connection.
- **KoboldCPP says _Crashed_, or the model never finishes loading.** The model is probably too big for your memory. Get a smaller one: set your memory in the model list and choose one marked **Fits**.
- **Replies are very slow.** On a computer without a graphics card, local models are slow; try a smaller model, or an online service.
- **Replies are garbled, or the AI writes your lines too.** Leave it for now and finish Start here; if it persists, see [Troubleshooting](./troubleshooting.md#replies-are-garbled-or-wrong).
- **The service refuses to write your scene.** That's its content rules, not Serene Pub. Try another model, or a local one.
:::

## Changing it later

The wizard is only a shortcut. Everything it set up lives in the **Connections** view on the rail, which administrators can open at any time to add a second connection, swap which model answers your sessions, or remove one. The same connections are listed under **Admin › Models › Connections**, for managing them in bulk. You can also set up extras there later, such as image generation or long-term memory for your stories.

## Going further

- [Connections](./connections.md): every service, every setting, and how defaults work.
- [Embeddings and search by meaning](./embeddings-and-rag.md): helping characters remember more of a long story.
- [Troubleshooting](./troubleshooting.md): when something stops working.

## Next

With a model connected, start [your first session](./getting-started.md#your-first-session).
