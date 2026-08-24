import { describe, expect, test } from "vitest"
import {
	CONNECTION_DEFAULTS,
	OPENAI_CHAT_PRESETS,
	getConnectionDefaults
} from "./connectionDefaults"
import { normalizeBaseUrl } from "./normalizeBaseUrl"
import { CONNECTION_TYPE } from "../constants/ConnectionTypes"

const NEW_EXPERIMENTAL_PRESET_NAMES = [
	"Mistral AI (Experimental)",
	"xAI Grok (Experimental)",
	"DeepSeek (Experimental)",
	"Google Gemini (Experimental)",
	"Cohere (Experimental)",
	"Novita AI (Experimental)",
	"Featherless AI (Experimental)",
	"text-generation-webui (Experimental)",
	"vLLM (Experimental)",
	"SGLang (Experimental)",
	"Aphrodite Engine (Experimental)"
]

describe("OPENAI_CHAT_PRESETS", () => {
	test("every preset has a unique `value`", () => {
		const values = OPENAI_CHAT_PRESETS.map((p) => p.value)
		expect(new Set(values).size).toBe(values.length)
	})

	test("every preset has a unique, non-empty `name`", () => {
		const names = OPENAI_CHAT_PRESETS.map((p) => p.name)
		expect(new Set(names).size).toBe(names.length)
		for (const name of names) {
			expect(name.trim().length).toBeGreaterThan(0)
		}
	})

	test("every non-empty baseUrl is a well-formed, parseable URL", () => {
		for (const preset of OPENAI_CHAT_PRESETS) {
			const url = preset.connectionDefaults.baseUrl
			if (!url) continue // "Empty" preset intentionally has no baseUrl
			expect(() => new URL(url)).not.toThrow()
		}
	})

	test("every preset's baseUrl already round-trips cleanly through normalizeBaseUrl (no double-normalization surprises)", () => {
		for (const preset of OPENAI_CHAT_PRESETS) {
			const url = preset.connectionDefaults.baseUrl
			if (!url) continue
			// Every stored default keeps its trailing slash (the established
			// style for this list) — normalizeBaseUrl should only ever strip
			// that trailing slash, never touch anything else.
			expect(normalizeBaseUrl(url)).toBe(url.replace(/\/+$/, ""))
		}
	})

	test("all 11 new experimental presets are present, each with the (Experimental) suffix", () => {
		const names = OPENAI_CHAT_PRESETS.map((p) => p.name)
		for (const expected of NEW_EXPERIMENTAL_PRESET_NAMES) {
			expect(names).toContain(expected)
		}
	})

	test.each(NEW_EXPERIMENTAL_PRESET_NAMES)(
		"%s has an apiKey field and a normalizable baseUrl",
		(name) => {
			const preset = OPENAI_CHAT_PRESETS.find((p) => p.name === name)!
			expect(preset).toBeDefined()
			expect(preset.connectionDefaults.extraJson).toHaveProperty("apiKey")
			expect(preset.connectionDefaults.baseUrl).toBeTruthy()
			expect(
				() => new URL(preset.connectionDefaults.baseUrl)
			).not.toThrow()
		}
	)
})

describe("CONNECTION_DEFAULTS", () => {
	test("every built-in connection type has a matching CONNECTION_DEFAULTS entry", () => {
		for (const type of Object.values(
			CONNECTION_TYPE
		) as unknown as string[]) {
			if (typeof type !== "string") continue
			expect(CONNECTION_DEFAULTS).toHaveProperty(type)
		}
	})

	test("getConnectionDefaults() returns {} for an unknown type instead of throwing", () => {
		expect(getConnectionDefaults("not-a-real-type")).toEqual({})
	})

	test("every stored default baseUrl (when non-empty) round-trips cleanly through normalizeBaseUrl", () => {
		for (const defaults of Object.values(CONNECTION_DEFAULTS) as any[]) {
			const url = defaults.baseUrl
			if (!url) continue
			expect(normalizeBaseUrl(url)).toBe(url.replace(/\/+$/, ""))
		}
	})
})
