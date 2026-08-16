export class OllamaModelSearchSource {
	static RECOMMENDED = "recommended"
	static HUGGING_FACE = "huggingface"

	static options = [
		{ value: OllamaModelSearchSource.RECOMMENDED, label: "Recommended" },
		{ value: OllamaModelSearchSource.HUGGING_FACE, label: "Hugging Face" }
	]
}
