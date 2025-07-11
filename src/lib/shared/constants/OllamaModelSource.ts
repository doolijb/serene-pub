export class OllamaModelSearchSource {
    static OLLAMA_DB = "ollamadb"
    static HUGGING_FACE = "huggingface"

    static options = [
        { value: OllamaModelSearchSource.HUGGING_FACE, label: "Hugging Face" },
        { value: OllamaModelSearchSource.OLLAMA_DB, label: "ollamadb.dev" },
    ]
}