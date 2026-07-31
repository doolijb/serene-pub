import { describe, expect, test, vi } from "vitest"

const createOpenAIMock = vi.fn()
vi.mock("@ai-sdk/openai", () => ({
	createOpenAI: (...args: any[]) => {
		createOpenAIMock(...args)
		return { chat: (model: string) => ({ model }) }
	}
}))

const { createLanguageModelFromAdapter } = await import(
	"./createLanguageModel"
)

function makeAdapter(connectionOverrides: Record<string, any> = {}): any {
	return {
		connection: {
			id: 1,
			type: "openai",
			baseUrl: "",
			model: "gpt-4o",
			extraJson: { apiKey: "sk-test" },
			...connectionOverrides
		}
	}
}

describe("createLanguageModelFromAdapter — base URL trailing-slash normalization", () => {
	test("strips a trailing slash from a plain OpenAI-compatible baseUrl", () => {
		createOpenAIMock.mockClear()
		createLanguageModelFromAdapter(
			makeAdapter({ baseUrl: "https://api.example.com/v1/" })
		)
		expect(createOpenAIMock).toHaveBeenCalledWith(
			expect.objectContaining({ baseURL: "https://api.example.com/v1" })
		)
	})

	test("passes baseURL: undefined (not empty string) when unset", () => {
		createOpenAIMock.mockClear()
		createLanguageModelFromAdapter(makeAdapter({ baseUrl: "" }))
		expect(createOpenAIMock).toHaveBeenCalledWith(
			expect.objectContaining({ baseURL: undefined })
		)
	})

	test("appends /v1 for Ollama connections, regardless of a trailing slash on the stored baseUrl", () => {
		createOpenAIMock.mockClear()
		createLanguageModelFromAdapter(
			makeAdapter({ type: "ollama", baseUrl: "http://localhost:11434/" })
		)
		expect(createOpenAIMock).toHaveBeenLastCalledWith(
			expect.objectContaining({ baseURL: "http://localhost:11434/v1" })
		)

		createLanguageModelFromAdapter(
			makeAdapter({ type: "ollama", baseUrl: "http://localhost:11434" })
		)
		expect(createOpenAIMock).toHaveBeenLastCalledWith(
			expect.objectContaining({ baseURL: "http://localhost:11434/v1" })
		)
	})

	test("does not double-append /v1 for an Ollama baseUrl that already ends with it", () => {
		createOpenAIMock.mockClear()
		createLanguageModelFromAdapter(
			makeAdapter({ type: "ollama", baseUrl: "http://localhost:11434/v1/" })
		)
		expect(createOpenAIMock).toHaveBeenLastCalledWith(
			expect.objectContaining({ baseURL: "http://localhost:11434/v1" })
		)
	})

	test("falls back to the 'ollama' placeholder API key when none is configured", () => {
		createOpenAIMock.mockClear()
		createLanguageModelFromAdapter(
			makeAdapter({ type: "ollama", extraJson: {} })
		)
		expect(createOpenAIMock).toHaveBeenCalledWith(
			expect.objectContaining({ apiKey: "ollama" })
		)
	})
})
