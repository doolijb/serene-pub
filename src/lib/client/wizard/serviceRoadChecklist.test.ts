import { describe, expect, test } from "vitest"
import {
	chatModelCount,
	serviceRoadChecklist,
	textGenConnections,
	type RoadConnection,
	type RoadModel
} from "./serviceRoadChecklist"

const chatModel = (over: Partial<RoadModel> = {}): RoadModel => ({
	enabled: true,
	missingSince: null,
	satisfiableCapabilities: ["text->text"],
	...over
})

/** A fresh OpenRouter row: created, no key yet, nothing listed. */
const openRouter = (over: Partial<RoadConnection> = {}): RoadConnection => ({
	id: 7,
	name: "OpenRouter",
	type: "openai",
	preset: "openrouter",
	baseUrl: "https://openrouter.ai/api/v1",
	modality: "text-gen",
	hasCredential: false,
	models: [],
	modelsSync: { at: null, error: null },
	...over
})

const listed = (n: number) => Array.from({ length: n }, () => chatModel())

function summary(c: ReturnType<typeof serviceRoadChecklist>) {
	return c.lines.map((l) => [l.id, l.done, l.action?.kind ?? null])
}

describe("serviceRoadChecklist", () => {
	test("nothing yet: Connection added is next, and offers Add a connection", () => {
		const c = serviceRoadChecklist({
			connections: [],
			chatConnectionId: null
		})
		expect(c.next).toBe("connection")
		expect(c.subjectId).toBeNull()
		expect(summary(c)).toEqual([
			["connection", false, "add"],
			["key", false, null],
			["model", false, null]
		])
		expect(c.lines[0].action?.label).toBe("Add a connection")
	})

	test("created without a key: Key saved is next and opens that connection", () => {
		const c = serviceRoadChecklist({
			connections: [openRouter()],
			chatConnectionId: null
		})
		expect(c.next).toBe("key")
		expect(c.lines[0]).toMatchObject({ done: true, detail: "OpenRouter" })
		expect(c.lines[1].action).toEqual({
			kind: "open",
			connectionId: 7,
			label: "Open OpenRouter"
		})
		expect(c.lines[1].detail).toBe("Paste your API key, then press Save.")
		expect(c.lines[2].action).toBeNull()
	})

	test("key saved and models listed: Choose which model replies is the action", () => {
		const c = serviceRoadChecklist({
			connections: [
				openRouter({
					hasCredential: true,
					models: listed(503),
					modelsSync: { at: "2026-10-06T10:00:00Z", error: null }
				})
			],
			chatConnectionId: null
		})
		expect(c.next).toBe("model")
		expect(summary(c)).toEqual([
			["connection", true, null],
			["key", true, null],
			["model", false, "choose"]
		])
		expect(c.lines[2].action?.label).toBe("Choose which model replies")
		expect(c.lines[2].detail).toBe("OpenRouter lists 503 models")
	})

	test("key saved but nothing listed yet: the model line opens the connection", () => {
		const c = serviceRoadChecklist({
			connections: [openRouter({ hasCredential: true })],
			chatConnectionId: null
		})
		expect(c.next).toBe("model")
		expect(c.lines[2].action?.kind).toBe("open")
		expect(c.lines[2].detail).toBe(
			"Waiting for OpenRouter to list its models"
		)
	})

	test("a listing that failed says so on the model line", () => {
		const c = serviceRoadChecklist({
			connections: [
				openRouter({
					hasCredential: true,
					modelsSync: { at: "2026-10-06T10:00:00Z", error: "401" }
				})
			],
			chatConnectionId: null
		})
		expect(c.lines[2].detail).toBe("OpenRouter couldn't list its models")
		expect(c.lines[2].action?.kind).toBe("open")
	})

	test("a key-less type ticks Key saved at once", () => {
		const c = serviceRoadChecklist({
			connections: [
				openRouter({
					name: "Ollama",
					type: "ollama",
					preset: null,
					baseUrl: "http://localhost:11434",
					hasCredential: false
				})
			],
			chatConnectionId: null
		})
		expect(c.lines[1]).toMatchObject({
			done: true,
			detail: "No key needed"
		})
		expect(c.next).toBe("model")
	})

	test("a chosen model checks the last line and leaves nothing next", () => {
		const c = serviceRoadChecklist({
			connections: [
				openRouter({ hasCredential: true, models: listed(2) })
			],
			chatConnectionId: 7
		})
		expect(c.next).toBeNull()
		expect(c.lines.every((l) => l.done)).toBe(true)
		expect(c.lines.every((l) => l.action === null)).toBe(true)
		expect(c.lines[2].detail).toBe("OpenRouter")
	})

	test("switched-off, missing and non-chat models are not choosable", () => {
		const c = serviceRoadChecklist({
			connections: [
				openRouter({
					hasCredential: true,
					modelsSync: { at: "2026-10-06T10:00:00Z", error: null },
					models: [
						chatModel({ enabled: false }),
						chatModel({ missingSince: "2026-10-01T00:00:00Z" }),
						chatModel({
							satisfiableCapabilities: ["text->embedding"]
						})
					]
				})
			],
			chatConnectionId: null
		})
		expect(c.lines[2].action?.kind).toBe("open")
		expect(c.lines[2].detail).toBe("OpenRouter lists no chat models")
	})

	test("the connection made on this road is the subject, not an older one", () => {
		const older = openRouter({
			id: 3,
			name: "Groq",
			preset: "groq",
			hasCredential: true,
			models: listed(4)
		})
		const fresh = openRouter({ id: 9, name: "OpenRouter" })
		const c = serviceRoadChecklist({
			connections: [older, fresh],
			chatConnectionId: null,
			focusId: 9
		})
		expect(c.subjectId).toBe(9)
		expect(c.next).toBe("key")
		expect(c.lines[0].detail).toBe("OpenRouter")
	})

	test("without a focus, the row furthest along is the subject", () => {
		const keyless = openRouter({ id: 12, name: "Fresh" })
		const ready = openRouter({
			id: 4,
			name: "Groq",
			preset: "groq",
			hasCredential: true,
			models: listed(1)
		})
		const c = serviceRoadChecklist({
			connections: [keyless, ready],
			chatConnectionId: null
		})
		expect(c.subjectId).toBe(4)
		expect(c.lines[2].detail).toBe("Groq lists 1 model")
	})

	test("an embeddings connection is never the subject", () => {
		const c = serviceRoadChecklist({
			connections: [
				openRouter({ id: 2, name: "MiniLM", modality: "embeddings" })
			],
			chatConnectionId: null
		})
		expect(c.next).toBe("connection")
	})
})

describe("textGenConnections / chatModelCount", () => {
	test("keeps text generation, and rows that do not say", () => {
		expect(
			textGenConnections([
				{ modality: "text-gen" },
				{ modality: "embeddings" },
				{}
			])
		).toHaveLength(2)
	})

	test("counts only models the server says can chat", () => {
		expect(
			chatModelCount(
				openRouter({
					models: [
						chatModel(),
						chatModel({ satisfiableCapabilities: null })
					]
				})
			)
		).toBe(1)
	})
})
