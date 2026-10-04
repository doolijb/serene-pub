import { describe, expect, test } from "vitest"
import { CONNECTION_TYPE } from "$lib/shared/constants/ConnectionTypes"
import { uniqueName } from "$lib/shared/connections/connectionName"
import { sameHost } from "$lib/shared/connections/hostKey"
import {
	conflictsOf,
	endpointSignature,
	groupLegacyConnections,
	groupNote,
	nameGroups,
	presetForAddress,
	type LegacyEndpointRow
} from "./connectionGroups"

/** Test keys are plaintext: equal strings are equal keys. */
const plain = (k: unknown) => (k ? `key:${String(k)}` : "")

let nextId = 1
function row(over: Partial<LegacyEndpointRow> & Pick<LegacyEndpointRow, "type">): LegacyEndpointRow {
	const id = over.id ?? nextId++
	return {
		id,
		name: `Row ${id}`,
		baseUrl: null,
		model: `model-${id}`,
		extraJson: {},
		tokenCounter: "estimate",
		promptFormat: null,
		wantsCompletion: false,
		...over
	}
}

const grouped = (rows: LegacyEndpointRow[], taken: string[] = []) => {
	const groups = groupLegacyConnections(rows, plain)
	nameGroups(groups, taken)
	return groups
}

describe("the endpoint signature", () => {
	test("forgives what hostKey forgives, and nothing more — /v1 is part of the address", () => {
		const a = row({ type: CONNECTION_TYPE.OPENAI, baseUrl: "http://127.0.0.1:47991/v1" })
		const b = row({ type: CONNECTION_TYPE.OPENAI, baseUrl: "HTTP://127.0.0.1:47991/v1/" })
		const c = row({ type: CONNECTION_TYPE.OPENAI, baseUrl: "http://127.0.0.1:47991" })
		expect(endpointSignature(a, plain)).toBe(endpointSignature(b, plain))
		expect(endpointSignature(a, plain)).not.toBe(endpointSignature(c, plain))
		// The same rule the Ollama view's duplicate notice reads.
		expect(sameHost(a.baseUrl, b.baseUrl)).toBe(true)
		expect(sameHost(a.baseUrl, c.baseUrl)).toBe(false)
	})

	test("a keyed service with another key is another endpoint; a keyless one ignores keys", () => {
		const url = "https://openrouter.ai/api/v1/"
		const a = row({ type: CONNECTION_TYPE.OPENAI, baseUrl: url, extraJson: { apiKey: "one" } })
		const b = row({ type: CONNECTION_TYPE.OPENAI, baseUrl: url, extraJson: { apiKey: "two" } })
		expect(endpointSignature(a, plain)).not.toBe(endpointSignature(b, plain))
		const o1 = row({ type: CONNECTION_TYPE.OLLAMA, baseUrl: "http://localhost:11434", extraJson: { apiKey: "x" } })
		const o2 = row({ type: CONNECTION_TYPE.OLLAMA, baseUrl: "http://localhost:11434/" })
		expect(endpointSignature(o1, plain)).toBe(endpointSignature(o2, plain))
	})

	test("the managed KoboldCPP is one endpoint whatever address its rows held", () => {
		const a = row({ type: CONNECTION_TYPE.KOBOLDCPP_MANAGED, baseUrl: "http://127.0.0.1:5001" })
		const b = row({ type: CONNECTION_TYPE.KOBOLDCPP_MANAGED, baseUrl: "http://127.0.0.1:5005" })
		expect(endpointSignature(a, plain)).toBe(endpointSignature(b, plain))
	})

	test("a type 0.5.3 never had is carried alone", () => {
		const a = row({ type: "something-else", baseUrl: "http://h" })
		const b = row({ type: "something-else", baseUrl: "http://h" })
		expect(endpointSignature(a, plain)).not.toBe(endpointSignature(b, plain))
	})
})

describe("presets by address", () => {
	test("a cloud preset by host name, however the path was typed", () => {
		expect(presetForAddress(CONNECTION_TYPE.OPENAI, "https://openrouter.ai/api/v1")).toMatchObject({
			label: "OpenRouter",
			slug: "openrouter"
		})
		expect(presetForAddress(CONNECTION_TYPE.OPENAI, "https://API.openai.com/v1")?.label).toBe(
			"OpenAI (Official)"
		)
	})

	test("a local preset only at its own address, labelled as the picker labels it", () => {
		expect(presetForAddress(CONNECTION_TYPE.OPENAI, "http://localhost:11434/v1")?.label).toBe(
			"Ollama (via OpenAI-Compatible API)"
		)
		expect(presetForAddress(CONNECTION_TYPE.OPENAI, "http://localhost:11434/api")).toBeUndefined()
		expect(presetForAddress(CONNECTION_TYPE.OPENAI, "http://192.168.1.4:8000/v1")).toBeUndefined()
	})

	test("only the OpenAI-compatible type has presets", () => {
		expect(presetForAddress(CONNECTION_TYPE.OLLAMA, "http://localhost:11434/v1/")).toBeUndefined()
	})
})

describe("grouping and naming (the owner's 41-connection pub)", () => {
	// Twenty Ollama rows at one host, each named after its model or "Test",
	// KoboldCPP rows at two ports and the managed one, LM Studio and llama.cpp
	// rows nobody is listening at.
	const ollamaUrls = ["http://localhost:11434", "http://localhost:11434/", "HTTP://LOCALHOST:11434/"]
	const rows: LegacyEndpointRow[] = [
		...Array.from({ length: 20 }, (_, i) =>
			row({
				id: 100 + i,
				type: CONNECTION_TYPE.OLLAMA,
				name: i % 5 === 0 ? "Test" : `model-${i % 15}:Q4_K_M`,
				baseUrl: ollamaUrls[i % 3],
				// Two rows name the same model: 0 and 15.
				model: `hf.co/x/model-${i % 15}:Q4_K_M`
			})
		),
		row({ id: 200, type: CONNECTION_TYPE.KOBOLDCPP, name: "Test", baseUrl: "http://localhost:5001" }),
		row({ id: 201, type: CONNECTION_TYPE.KOBOLDCPP, name: "inactive", baseUrl: "http://localhost:5001/" }),
		row({ id: 202, type: CONNECTION_TYPE.KOBOLDCPP, name: "Skyfall", baseUrl: "http://localhost:5002" }),
		row({ id: 203, type: CONNECTION_TYPE.KOBOLDCPP_MANAGED, name: "Managed A", baseUrl: "http://127.0.0.1:5001" }),
		row({ id: 204, type: CONNECTION_TYPE.KOBOLDCPP_MANAGED, name: "Managed B", baseUrl: "http://127.0.0.1:5001" }),
		row({ id: 300, type: CONNECTION_TYPE.LM_STUDIO, name: "Test", baseUrl: "ws://localhost:1234" }),
		row({ id: 301, type: CONNECTION_TYPE.LM_STUDIO, name: "Testt", baseUrl: "ws://localhost:1234" }),
		row({ id: 302, type: CONNECTION_TYPE.LM_STUDIO, name: "0.3.1 Test", baseUrl: "http://127.0.0.1:1234" }),
		row({ id: 400, type: CONNECTION_TYPE.LLAMACPP, name: "LLama test", baseUrl: "http://127.0.0.1:8080" })
	]
	const groups = grouped(rows)
	const byName = new Map(groups.map((g) => [g.name, g]))

	test("every Ollama row is one Ollama connection, its models distinct", () => {
		const ollama = groups.filter((g) => g.type === CONNECTION_TYPE.OLLAMA)
		expect(ollama).toHaveLength(1)
		expect(ollama[0].name).toBe("Ollama")
		expect(ollama[0].members).toHaveLength(20)
		expect(ollama[0].models).toHaveLength(15)
		expect(ollama[0].lead.id).toBe(100)
	})

	test("KoboldCPP by address, numbered; the managed one takes a fresh managed endpoint's name", () => {
		expect(byName.get("KoboldCPP")?.members.map((m) => m.id)).toEqual([200, 201])
		expect(byName.get("KoboldCPP 2")?.members.map((m) => m.id)).toEqual([202])
		expect(byName.get("KoboldCPP on this machine")?.members.map((m) => m.id)).toEqual([203, 204])
	})

	test("LM Studio and llama.cpp take their type's name; localhost and 127.0.0.1 stay apart", () => {
		expect(byName.get("LM Studio")?.members.map((m) => m.id)).toEqual([300, 301])
		expect(byName.get("LM Studio 2")?.members.map((m) => m.id)).toEqual([302])
		expect(byName.get("Llama.cpp")?.members.map((m) => m.id)).toEqual([400])
	})

	test("seven connections in all, from twenty-nine", () => {
		expect(rows).toHaveLength(29)
		expect(groups.map((g) => g.name)).toEqual([
			"Ollama",
			"KoboldCPP",
			"KoboldCPP 2",
			"KoboldCPP on this machine",
			"LM Studio",
			"LM Studio 2",
			"Llama.cpp"
		])
	})

	test("names already taken in the pub are numbered past", () => {
		const again = grouped(rows.slice(0, 3), ["ollama"])
		expect(again[0].name).toBe("Ollama 2")
	})
})

describe("names for keyed services", () => {
	test("a preset's name, numbered for a second key; the note says why it is its own", () => {
		const url = "https://openrouter.ai/api/v1/"
		const groups = grouped([
			row({ id: 1, type: CONNECTION_TYPE.OPENAI, name: "OR big", baseUrl: url, extraJson: { apiKey: "a" } }),
			row({ id: 2, type: CONNECTION_TYPE.OPENAI, name: "OR small", baseUrl: url, extraJson: { apiKey: "a" } }),
			row({ id: 3, type: CONNECTION_TYPE.OPENAI, name: "OR work", baseUrl: url, extraJson: { apiKey: "b" } }),
			row({ id: 4, type: CONNECTION_TYPE.ANTHROPIC, name: "Claude", baseUrl: "https://api.anthropic.com", extraJson: { apiKey: "c" } }),
			row({ id: 5, type: CONNECTION_TYPE.OPENAI, name: "Fake", baseUrl: "http://127.0.0.1:47991/v1" }),
			row({ id: 6, type: CONNECTION_TYPE.OPENAI, name: "Dead", baseUrl: "http://127.0.0.1:9/v1" })
		])
		expect(groups.map((g) => [g.name, g.preset?.slug ?? null, g.members.length])).toEqual([
			["OpenRouter", "openrouter", 2],
			["OpenRouter 2", "openrouter", 1],
			["Anthropic (Claude)", null, 1],
			["Custom (OpenAI-Compatible)", null, 1],
			["Custom (OpenAI-Compatible) 2", null, 1]
		])
		expect(groups[1].sameAddressAs).toEqual(["OpenRouter"])
		expect(groupNote(groups[0], plain)?.summary).toBe(
			'2 connections to OpenRouter at https://openrouter.ai/api/v1/ with the same API key were combined into one connection, "OpenRouter", with 2 models: model-1, model-2. In 0.5.3 they were "OR big" and "OR small".'
		)
		expect(groupNote(groups[1], plain)).toEqual({
			topic: "connection-renamed",
			summary:
				'"OR work" is now called "OpenRouter 2", the name Serene Pub gives a connection to OpenRouter at https://openrouter.ai/api/v1/; its model, model-3, is unchanged. It reaches the same address as "OpenRouter" with a different API key, so it is a connection of its own.'
		})
		expect(groupNote(groups[2], plain)?.summary).toMatch(/^"Claude" is now called "Anthropic \(Claude\)"/)
	})

	test("a row already named for its service says nothing", () => {
		const [g] = grouped([row({ type: CONNECTION_TYPE.LM_STUDIO, name: "LM Studio", baseUrl: "http://h:1234" })])
		expect(groupNote(g, plain)).toBeNull()
	})

	test("a type with no 0.6 name keeps the 0.5.3 one", () => {
		const [a, b] = grouped([
			row({ type: "mystery", name: "Mine" }),
			row({ type: "mystery", name: "Mine" })
		])
		expect([a.name, b.name]).toEqual(["Mine", "Mine 2"])
	})
})

describe("what the combined connection holds", () => {
	const url = "http://127.0.0.1:47991/"
	const think = row({
		id: 2,
		type: CONNECTION_TYPE.OLLAMA,
		name: "Fake Ollama (thinking)",
		baseUrl: url,
		model: "fake-think:7b",
		promptFormat: "chatml",
		extraJson: { stream: true, think: true, keepAlive: "5m", useChat: true }
	})
	const llmman = row({
		id: 3,
		type: CONNECTION_TYPE.OLLAMA,
		name: "llmman local",
		baseUrl: url,
		model: "gemma4",
		promptFormat: "vicuna",
		extraJson: { stream: true, think: false, keepAlive: "5m", useChat: true }
	})

	test("the first row is the endpoint; another row's differences ride on its model", () => {
		const [g] = grouped([llmman, think])
		expect(g.lead).toBe(think)
		expect(g.models.map((m) => [m.model, m.overrides])).toEqual([
			["fake-think:7b", {}],
			["gemma4", { promptFormat: "vicuna", extraJson: { think: false } }]
		])
		expect(groupNote(g, plain)?.summary).toBe(
			'2 connections to Ollama at http://127.0.0.1:47991/ were combined into one connection, "Ollama", with 2 models: fake-think:7b, gemma4. In 0.5.3 they were "Fake Ollama (thinking)" and "llmman local". Where their settings differed, each model keeps its own.'
		)
	})

	test("an option one row left to the default is not a difference", () => {
		const bare = row({ type: CONNECTION_TYPE.OLLAMA, baseUrl: url, model: "m", promptFormat: "chatml", extraJson: { think: true, keepAlive: "5m", useChat: true } })
		const [g] = grouped([think, bare])
		expect(g.models[1].overrides).toEqual({})
	})

	test("rows that disagree about the completion wire: the endpoint stays neutral, the model says it", () => {
		const completion = row({ type: CONNECTION_TYPE.KOBOLDCPP, baseUrl: "http://k:5001", model: "a", wantsCompletion: true, extraJson: { useChat: false } })
		const chat = row({ type: CONNECTION_TYPE.KOBOLDCPP, baseUrl: "http://k:5001", model: "b" })
		const [g] = grouped([completion, chat])
		expect(g.wantsCompletion).toBe(false)
		expect(g.models[0].overrides.wireChat).toBe(false)
		expect(g.models[1].overrides.wireChat).toBeUndefined()
		const [same] = grouped([
			{ ...completion, id: 50 },
			{ ...completion, id: 51, model: "c" }
		])
		expect(same.wantsCompletion).toBe(true)
		expect(same.models.every((m) => m.overrides.wireChat === undefined)).toBe(true)
	})

	test("two rows naming one model share it; differing settings are a conflict the note names", () => {
		const twin = { ...llmman, id: 9, name: "Gemma again", model: " gemma4 ", promptFormat: "chatml" }
		const [g] = grouped([think, llmman, twin])
		expect(g.models.map((m) => [m.model, m.from.map((r) => r.id)])).toEqual([
			["fake-think:7b", [2]],
			["gemma4", [3, 9]]
		])
		expect(conflictsOf(g)).toEqual([{ model: "gemma4", kept: "llmman local", others: ["Gemma again"] }])
		expect(groupNote(g, plain)?.summary).toContain(
			'"llmman local" and "Gemma again" both named gemma4 with different settings; those of "llmman local" were kept.'
		)
	})

	test("a row with no model still joins, and never leads", () => {
		const blank = row({ id: 1, type: CONNECTION_TYPE.OLLAMA, baseUrl: url, model: "  " })
		const [g] = grouped([blank, think])
		expect(g.lead).toBe(think)
		expect(g.members.map((m) => m.id)).toEqual([1, 2])
		expect(g.models.map((m) => m.model)).toEqual(["fake-think:7b"])
	})
})

describe("uniqueName (shared with the Add menu's managers)", () => {
	test("numbered from 2, case and spacing ignored", () => {
		expect(uniqueName("OpenRouter", [" openrouter ", "OpenRouter 2"])).toBe("OpenRouter 3")
		expect(uniqueName("Ollama", [])).toBe("Ollama")
	})
})
