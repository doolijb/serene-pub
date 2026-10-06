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
- **Embeddings need an online or networked service.** The on-device **Local embeddings (ONNX)** and **Local named entities (ONNX)** connections don't work on Android. They're still listed, greyed out, with the reason. An embeddings connection to an API (OpenAI, or Ollama, LM Studio or llama.cpp on another computer) works normally. See [Embeddings and search by meaning](./embeddings-and-rag.md#embedding-connections).
- **One person only.** User accounts can't be turned on, so there's no sign-in and no inviting others.
- **No tunnel.** The built-in tunnel for reaching your pub from elsewhere isn't available.
- **No SillyTavern import.** Bringing in a whole SillyTavern library isn't offered. Character cards still import one at a time with **Import a card** (PNG, JSON, CHARX and the other card formats). Files are picked by tapping; there's no drag and drop.
- **No component authoring.** Administrators can't write or copy session widgets on the phone. Components imported from a share file that already carries its compiled code still run. See [Component authoring](./component-authoring.md#android).

## Node.js runtime

The app carries its own copy of Node.js, the engine Serene Pub's server runs on: **Node.js 24**, the oldest version Serene Pub supports. (The desktop builds ship Node.js 26; no Android build of Node.js 26 exists yet.)

- **Dates and numbers format natively.** The engine has `Intl` built in, so no add-on is loaded for it. Text the server itself formats (rather than your phone's browser view) uses English conventions.
- **Phones with 16 KB memory pages are supported.** Android 15 and newer can use 16 KB pages; every native library in the app is built for them.

**Where it comes from.** The engine is a prebuilt Android build of Node.js from [digidem/nodejs-mobile](https://github.com/digidem/nodejs-mobile), Digital Democracy's reproducible fork of [nodejs-mobile](https://github.com/nodejs-mobile/nodejs-mobile), release [v24.20.0-0](https://github.com/digidem/nodejs-mobile/releases/tag/v24.20.0-0), the full variant (Node.js 24.20.0, built from recipe commit `7c55423d73`). It is under the Node.js licence (MIT, with the bundled libraries' own notices). The build pins one exact file and refuses any other:

- URL: `https://github.com/digidem/nodejs-mobile/releases/download/v24.20.0-0/nodejs-mobile-android-24.20.0-0.zip`
- SHA-256: `f5ffbaf4f2679fa9180b0758c637c2f8fc8828300f95129badf213a028fb37bb`

If that release ever disappears, a mirrored copy of the same file can be placed at `android/.cache/nodejs-mobile/nodejs-mobile-android-24.20.0-0.zip`; `scripts/build-android.js` checks it against the SHA-256 above and uses it without downloading.
