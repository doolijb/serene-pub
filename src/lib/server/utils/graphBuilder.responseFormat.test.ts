/**
 * Which graph calls are JSON-constrained, and which must not be.
 *
 * runLLM sets `adapter.responseFormat` for every call it makes, and it used to
 * set "json" unconditionally. Node descriptions are prose — the prompt asks for
 * "exactly two sentences in present tense" — so under a JSON-object grammar the
 * model wrapped its answer to satisfy the decoder and the wrapper was stored
 * verbatim as the node's summary:
 *
 *   { "introduction": "The Glimmer-Scuttler is a creature possessing neurotoxic
 *     venom. It was handled by Amara Lin without the use of gloves." }
 *
 * which is what a user then saw in the graph panel. A grammar beats the prompt,
 * so a call whose result is not parsed as JSON has to opt out.
 */
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest"

const runQueuedLLMCallMock = vi.fn()

vi.mock("./runQueuedLLMCall", () => ({
	runQueuedLLMCall: (...args: unknown[]) => runQueuedLLMCallMock(...args)
}))

vi.mock("./getConnectionAdapter", () => ({
	getConnectionAdapter: async () => ({
		Adapter: class {
			responseFormat = "text"
			responseSchema: unknown
			constructor(_opts: unknown) {}
		}
	})
}))

const conn = { id: 1, name: "c", type: "openai_session" } as any
const base = {
	connection: conn,
	sampling: { id: 1, name: "s" } as any,
	contextConfig: { id: 1 } as any,
	promptConfig: { id: 1 } as any
}

/** label -> { responseFormat, hasSchema } actually set on the adapter */
const seen = new Map<string, { format: string; hasSchema: boolean }>()

beforeEach(() => {
	seen.clear()
	runQueuedLLMCallMock.mockReset()
	runQueuedLLMCallMock.mockImplementation(async (opts: any) => {
		seen.set(opts.label ?? "", {
			format: opts.adapter?.responseFormat,
			hasSchema: !!opts.adapter?.responseSchema
		})
		const label: string = opts?.label ?? ""
		if (label.includes("character extraction"))
			return {
				text: '{"participants": ["Aria", "Nym"], "mentioned": []}'
			}
		if (label.includes("Character Perspective"))
			return {
				text: '{"relationships": [{"from": "Aria", "to": "Nym", "type": "ally", "reason": "r", "description": "d", "status": "active", "visibility": "secret"}]}'
			}
		if (label.includes("Node Description"))
			return { text: "Nym is a scout. She keeps to the ridgeline." }
		return { text: "{}" }
	})
})
afterEach(() => runQueuedLLMCallMock.mockReset())

async function runBuild() {
	const { buildGraphFromScenes } = await import("./graphBuilder")
	return buildGraphFromScenes({
		scenes: [
			{
				id: 1,
				name: "Scene 1",
				summary: "Aria met Nym on the ridge.",
				historyEntryId: 1,
				historyEntry: { id: 1, year: 1, month: null, day: null },
				participantCharacters: null,
				mentionedCharacters: null,
				sessionId: 1,
				selectedMessageIds: [1]
			}
		] as any,
		...base,
		seedNodes: [
			{
				id: 10,
				name: "Aria",
				nodeState: "active",
				summary: "a scout",
				aliases: []
			}
		],
		fetchSceneMessages: async () => [
			{ senderName: "Nym", content: "Nym watches the ridge." }
		]
	})
}

const findLabel = (needle: string) =>
	[...seen.entries()].find(([l]) => l.includes(needle))?.[1]

describe("responseFormat per graph call", () => {
	test("a node description is generated as TEXT, never JSON-constrained", async () => {
		await runBuild()
		const nodeDesc = findLabel("Node Description")
		expect(nodeDesc, "no Node Description call was made").toBeDefined()
		expect(nodeDesc!.format).toBe("text")
		expect(nodeDesc!.hasSchema).toBe(false)
	})

	test("the produced summary is stored as prose, with no JSON wrapper", async () => {
		const result = await runBuild()
		const nym = result.proposal.nodes.find((n: any) => n.name === "Nym")
		expect(nym?.summary).toBe("Nym is a scout. She keeps to the ridgeline.")
		expect(nym?.summary).not.toMatch(/^\s*[{[]/)
	})

	test("perspective calls stay JSON, and carry the subject-pinned schema", async () => {
		await runBuild()
		const persp = findLabel("Character Perspective")
		expect(persp, "no perspective call was made").toBeDefined()
		expect(persp!.format).toBe("json")
		expect(persp!.hasSchema).toBe(true)
	})
})
