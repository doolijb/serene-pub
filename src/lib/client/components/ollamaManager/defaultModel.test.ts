import { describe, expect, test } from "vitest"
import { ollamaChatDefaultModelName } from "./defaultModel"

/** Enough of a list row for the helper; it reads `id`, `type` and `models`. */
function endpoint(id: number, type: string, models: [number, string][]): any {
	return {
		id,
		type,
		models: models.map(([modelId, model]) => ({ id: modelId, model })),
		modelsSync: { at: null, error: null }
	}
}

describe("ollamaChatDefaultModelName", () => {
	const list = [
		endpoint(7, "ollama", [
			[3, "llama3.1:8b"],
			[4, "qwen2.5:14b"]
		]),
		endpoint(9, "openai", [[5, "gpt-4o"]])
	]

	test("names the model half of the chat pair", () => {
		expect(
			ollamaChatDefaultModelName(list, {
				"text->text": {
					connectionId: 7,
					connectionModelId: 4,
					samplingConfigId: null
				}
			})
		).toBe("qwen2.5:14b")
	})

	test("a pair on another kind of endpoint is not an Ollama model", () => {
		expect(
			ollamaChatDefaultModelName(list, {
				"text->text": {
					connectionId: 9,
					connectionModelId: 5,
					samplingConfigId: null
				}
			})
		).toBeNull()
	})

	test("a pair naming only the endpoint names no model", () => {
		// An endpoint has no model it "means": half a pair is unconfigured,
		// not "whichever model that endpoint would have used".
		expect(
			ollamaChatDefaultModelName(list, {
				"text->text": {
					connectionId: 7,
					connectionModelId: null,
					samplingConfigId: null
				}
			})
		).toBeNull()
	})

	test("a pair whose model row is gone names nothing", () => {
		expect(
			ollamaChatDefaultModelName(list, {
				"text->text": {
					connectionId: 7,
					connectionModelId: 99,
					samplingConfigId: null
				}
			})
		).toBeNull()
	})

	test("another capability's pair is not the chat one", () => {
		expect(
			ollamaChatDefaultModelName(list, {
				"text->image": {
					connectionId: 7,
					connectionModelId: 3,
					samplingConfigId: null
				}
			})
		).toBeNull()
	})

	test("no defaults and no list mean nothing is in use", () => {
		expect(ollamaChatDefaultModelName(list, {})).toBeNull()
		expect(ollamaChatDefaultModelName(list, undefined)).toBeNull()
		expect(
			ollamaChatDefaultModelName(undefined, {
				"text->text": {
					connectionId: 7,
					connectionModelId: 3,
					samplingConfigId: null
				}
			})
		).toBeNull()
	})
})
