# Android App

Serene Pub is also available as a native Android app. It's not a thin client — the same server that normally runs on your desktop or in Docker is bundled into the app and runs locally on your device, so everything works offline aside from whatever AI connection you configure. There's nothing separate to host; install the APK and it's a self-contained instance.

## System Requirements

- **Requires Android 8.0+ on a 64-bit ARM device.** This covers the overwhelming majority of phones sold in the last several years, but rules out older 32-bit-only devices.
- **You may see a device-compatibility notice at install time on the newest Android versions.** This is expected and doesn't block installation or affect functionality.

## Feature Limitations

A few things work differently on Android compared to desktop or Docker, due to constraints of running a full server inside a mobile app:

- **No Ollama Manager or KoboldCPP Manager.** These built-in tools that download and run local model binaries for you aren't available on Android — there's no supported way to run those binaries on-device. You can still connect to an Ollama or KoboldCPP instance running elsewhere on your network (or anywhere reachable), the same as any other provider — just configure it manually from the Connections panel. See [Connections](./connections.md).
- **Embeddings/RAG: External API only.** On-device embeddings aren't available on Android, so the "Local Model" option is hidden in the Embeddings setup screen — but the External API option works exactly as it does everywhere else. Point it at OpenAI, or a self-hosted Ollama/LM Studio/llama.cpp server elsewhere on your network, and RAG works normally. See [Embeddings & RAG](./embeddings-and-rag.md).
- **No SillyTavern import.** Importing characters, personas, and chats from an existing SillyTavern installation isn't offered on Android. Character cards can still be added individually via file upload (.png/.json).
- **Larger install, slower first launch, more battery use.** The app bundles a full embedded server runtime, so the download is bigger than a typical app, the very first launch takes longer while it unpacks, and keeping that server running in the background uses more battery than a normal lightweight app.
- **A few connection types may not work if actually used.** LM Studio connections, along with a handful of token counters (the OpenAI GPT-family, Llama 3, and Cohere counters), depend on text-processing functionality that isn't available in Android's bundled runtime. Other connection types and token counters are unaffected.
