# Android app

The Android app is a complete Serene Pub that runs on your phone: the same app as on a computer, with your characters and stories saved on the phone itself.

:::tip What it's for
- Using Serene Pub on a phone with no computer involved, through an online model service.
- Keeping a pub in your pocket that doesn't depend on a computer at home being switched on.
:::

To install it, see [Install Serene Pub](./install.md#android). If you'd rather use the pub on your computer from your phone, you don't need the app: open your computer's address in the phone's browser (see [Install](./install.md#everyday-use)).

## System requirements

- **Android 8.0 or newer, on a 64-bit phone.** That's nearly every phone sold in recent years; older 32-bit-only phones can't run it.
- **Room for a bigger app than usual.** It carries a whole server inside it, so the download is larger, the first start takes longer while it unpacks, and it uses more battery while it runs.
- On the newest Android versions you may see a notice at install time about the app being built for an older version. It's expected, and doesn't affect anything.

## Feature limitations

A phone can't do everything a computer can, so a few things differ:

- **No model runs on the phone.** Serene Pub can't download and run KoboldCPP or Ollama for you here. Use an online service, or connect to a KoboldCPP, Ollama or similar program running on a computer on your network, from the Connections view like any other connection. See [Connect a model](./connect-a-model.md).
- **Embeddings need an online or networked service.** The on-device **Local embeddings (ONNX)** and **Local named entities (ONNX)** connections don't work on Android. An embeddings connection to an API (OpenAI, or Ollama, LM Studio or llama.cpp on another computer) works normally. See [Embeddings and search by meaning](./embeddings-and-rag.md#embedding-connections).
- **One person only.** User accounts can't be turned on, so there's no sign-in and no inviting others.
- **No tunnel.** The built-in tunnel for reaching your pub from elsewhere isn't available.
- **No SillyTavern import.** Bringing in a whole SillyTavern library isn't offered. Character cards still import one at a time with **Import a card** (PNG, JSON, CHARX and the other card formats). Files are picked by tapping; there's no drag and drop.
- **No component authoring.** Administrators can't write or copy session widgets on the phone. Components imported from a share file that already carries its compiled code still run. See [Component authoring](./component-authoring.md#android).
- **A few connection options may fail when used.** LM Studio connections, and the OpenAI GPT, Llama 3 and Cohere token counters, need features the phone's built-in runtime lacks. Every other connection type and token counter works.
