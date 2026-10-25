import { describe, expect, test } from "vitest"
import {
	chatChoice,
	chatModelCount,
	readinessRow,
	readinessRows,
	servesChat,
	stateOfDefault,
	type ChatSource
} from "./readiness"
import { defaultsSummary } from "./defaultsSummary"
import type { DefaultsSummaryEntry } from "./defaultsSummary"
import { chatFacts } from "./jobTile"

const entry = (
	over: Partial<DefaultsSummaryEntry> = {}
): DefaultsSummaryEntry => ({
	capability: "text->text",
	label: "Chat",
	outputKind: "text",
	connection: { id: 1, name: "OpenRouter", models: [] },
	model: {
		id: 11,
		name: "gpt-4o",
		enabled: true,
		missingSince: null
	},
	set: true,
	state: "ok",
	stateWord: "ready",
	...over
})

describe("readinessRow — four of the connection states", () => {
	test("ready names the model, the connection and where it is", () => {
		const row = readinessRow(entry())
		expect(row.state).toBe("ready")
		// "ready" is the machine shrugging; a host LISTS a model.
		expect(row.sentence).toBe("gpt-4o · OpenRouter · listed")
		expect(row.action).toBeNull()
	})

	test("unset chat is unfinished, and the only gold button", () => {
		const row = readinessRow(
			entry({ set: false, state: "unset", stateWord: "not set" })
		)
		expect(row.state).toBe("unfinished")
		expect(row.sentence).toBe("Not set · sessions can't reply")
		expect(row.action).toEqual({
			verb: "setup",
			label: "Set up",
			emphasis: "primary"
		})
	})

	test("an unset non-chat capability's Set up is tonal, not gold", () => {
		const row = readinessRow(
			entry({
				capability: "text->image",
				label: "Images",
				set: false,
				state: "unset",
				stateWord: "not set"
			})
		)
		expect(row.action).toEqual({
			verb: "setup",
			label: "Set up",
			emphasis: "tonal"
		})
	})

	test("an unset transform with no hand-written consequence falls back to the SDK tagline", () => {
		const row = readinessRow(
			entry({
				capability: "text+image->text",
				label: "Vision",
				set: false,
				state: "unset",
				stateWord: "not set"
			})
		)
		expect(row.sentence).toBe("Not set · Can look at pictures you send it")
	})

	test("busy counts bytes and offers no button", () => {
		const row = readinessRow(
			entry({ state: "pending", stateWord: "downloading" }),
			{
				localState: "downloading",
				downloadedBytes: 400_000_000,
				totalBytes: 1_200_000_000
			}
		)
		expect(row.state).toBe("busy")
		expect(row.sentence).toBe("Downloading gpt-4o · 400 of 1200 MB")
		expect(row.action).toBeNull()
	})

	test("broken repeats the summary's word and picks one fix", () => {
		const row = readinessRow(
			entry({ state: "warning", stateWord: "not listed" }),
			{ syncError: "401 Unauthorized" }
		)
		expect(row.state).toBe("broken")
		expect(row.sentence).toBe("gpt-4o · OpenRouter · not listed")
		expect(row.action?.verb).toBe("refresh")
	})
})

describe("readinessRow — the fix is the most direct undo", () => {
	test("files that never arrived get Download", () => {
		const row = readinessRow(
			entry({ state: "warning", stateWord: "not downloaded" }),
			{ localState: "not_downloaded" }
		)
		expect(row.action).toEqual({
			verb: "download",
			label: "Download",
			emphasis: "tonal"
		})
	})

	test("a crashed managed process is broken on its own, with Start", () => {
		const row = readinessRow(entry(), { kcppRun: "crashed" })
		expect(row.state).toBe("broken")
		expect(row.sentence).toBe(
			"OpenRouter stopped unexpectedly · gpt-4o can't run"
		)
		expect(row.action?.verb).toBe("start")
	})

	test("a manager switched off outranks the row reading as healthy", () => {
		const row = readinessRow(entry(), {
			managerEnabled: false,
			managerLabel: "KoboldCPP"
		})
		expect(row.state).toBe("broken")
		expect(row.sentence).toBe(
			"KoboldCPP is switched off · gpt-4o can't run"
		)
		expect(row.action?.verb).toBe("change")
	})

	test("anything else is Change", () => {
		const row = readinessRow(
			entry({ state: "warning", stateWord: "switched off" })
		)
		expect(row.action?.verb).toBe("change")
	})

	test("an unanswered fact never invents a fault", () => {
		expect(readinessRow(entry(), {}).state).toBe("ready")
		expect(readinessRow(entry(), { kcppRun: null }).state).toBe("ready")
		expect(readinessRow(entry(), { managerEnabled: true }).state).toBe(
			"ready"
		)
	})
})

describe("the seam with the defaults summary", () => {
	test("each summary word lands on one connection state", () => {
		expect(stateOfDefault("ok")).toBe("ready")
		expect(stateOfDefault("pending")).toBe("busy")
		expect(stateOfDefault("warning")).toBe("broken")
		expect(stateOfDefault("unset")).toBe("unfinished")
	})

	test("a registered pair the server no longer judges able is broken, with Change", () => {
		const [chat] = defaultsSummary(
			[
				{
					id: 1,
					name: "Ollama",
					models: [
						{
							id: 11,
							name: "nomic-embed-text",
							enabled: true,
							missingSince: null,
							satisfiableCapabilities: ["text->embedding"]
						}
					]
				}
			],
			{ "text->text": { connectionId: 1, connectionModelId: 11 } }
		).entries.filter((e) => e.capability === "text->text")
		const row = readinessRow(chat)
		expect(row.state).toBe("broken")
		expect(row.sentence).toBe(
			"nomic-embed-text · Ollama · can't do this loadout's work"
		)
		expect(row.action?.verb).toBe("change")
	})
})

describe("the rows as a whole", () => {
	const summary = defaultsSummary([], {})
	const rows = readinessRows(summary.entries)

	test("every SDK transform gets a row, and none is ready on a bare install", () => {
		// Twelve, with Hearing (`text+audio->text`, O4) and Spoken reply
		// (`text->text+audio`, O6).
		expect(rows).toHaveLength(12)
		expect(rows.every((r) => r.state === "unfinished")).toBe(true)
		const hearing = rows.find((r) => r.capability === "text+audio->text")
		const spoken = rows.find((r) => r.capability === "text->text+audio")
		expect(hearing?.label).toBe("Hearing")
		expect(spoken?.label).toBe("Spoken reply")
	})
})

/**
 * Plan §A (walk 2026-10-06): the strip's **Set up chat** installed KoboldCPP
 * beside an OpenRouter that already listed 503 chat models. The guided flow is
 * the answer only while nothing here serves chat.
 */
describe("chatChoice — set up anew only when nothing serves chat", () => {
	const chatModel = (over: Partial<ChatSource["models"][number]> = {}) => ({
		enabled: true,
		missingSince: null,
		satisfiableCapabilities: ["text->text"],
		...over
	})
	const openRouter: ChatSource = {
		name: "OpenRouter",
		models: Array.from({ length: 503 }, () => chatModel())
	}

	test("nothing connected: Set up chat, and nothing to pick", () => {
		expect(chatChoice([])).toEqual({ choose: false, sentence: null })
	})

	test("a connection whose models can't chat leaves the guided flow", () => {
		const images: ChatSource = {
			name: "Images",
			models: [chatModel({ satisfiableCapabilities: ["text->image"] })]
		}
		expect(chatChoice([images])).toEqual({ choose: false, sentence: null })
	})

	test("one connection listing chat models: choose, and say how many", () => {
		expect(chatChoice([openRouter])).toEqual({
			choose: true,
			sentence: "OpenRouter lists 503 models · pick one"
		})
	})

	test("several: the connections and the total", () => {
		const local: ChatSource = { name: "Ollama", models: [chatModel()] }
		expect(chatChoice([openRouter, local]).sentence).toBe(
			"2 connections list 504 models · pick one"
		)
	})

	test("counts only what the job picker offers with Use", () => {
		const mixed: ChatSource = {
			name: "Mixed",
			models: [
				chatModel(),
				chatModel({ enabled: false }),
				chatModel({ missingSince: "2026-10-01T00:00:00Z" }),
				chatModel({ local: { state: "not_downloaded" } }),
				chatModel({ satisfiableCapabilities: ["text->embedding"] })
			]
		}
		expect(chatModelCount(mixed)).toBe(1)
		expect(chatChoice([mixed]).sentence).toBe(
			"Mixed lists 1 model · pick one"
		)
	})

	test("chat models all switched off: still choose, never the flow", () => {
		// The job picker says they are switched off; installing
		// KoboldCPP beside them is the trap, not the fix.
		const off: ChatSource = {
			name: "Off",
			models: [chatModel({ enabled: false })]
		}
		expect(servesChat(off)).toBe(true)
		expect(chatChoice([off])).toEqual({ choose: true, sentence: null })
	})
})

describe("chatFacts — what the strip says about chat", () => {
	const openRouterRow = {
		id: 1,
		name: "OpenRouter",
		models: [
			{
				id: 11,
				name: "gpt-4o",
				model: "openai/gpt-4o",
				enabled: true,
				missingSince: null,
				satisfiableCapabilities: ["text->text"]
			}
		],
		modelsSync: { at: "2026-10-06T10:00:00Z", error: null }
	}

	test("unset beside a listed service: Choose, with its line", () => {
		const summary = defaultsSummary([openRouterRow], {})
		const facts = chatFacts(
			summary.entries,
			readinessRows(summary.entries),
			[openRouterRow]
		)
		expect(facts.state).toBe("unfinished")
		expect(facts.set).toBe(false)
		expect(facts.choose).toBe(true)
		expect(facts.choiceSentence).toBe("OpenRouter lists 1 model · pick one")
	})

	test("set: nothing to choose, the pair is named instead", () => {
		const summary = defaultsSummary([openRouterRow], {
			"text->text": { connectionId: 1, connectionModelId: 11 }
		})
		const facts = chatFacts(
			summary.entries,
			readinessRows(summary.entries),
			[openRouterRow]
		)
		expect(facts.state).toBe("ready")
		expect(facts.set).toBe(true)
		expect(facts.modelName).toBe("gpt-4o")
		expect(facts.choose).toBe(false)
		expect(facts.choiceSentence).toBeNull()
	})
})
