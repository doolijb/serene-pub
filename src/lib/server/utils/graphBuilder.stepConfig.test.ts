/**
 * Each graph step resolves its own prompt, model and sampling.
 *
 * Before this, buildGraphFromScenes took one `connection`/`sampling` pair and
 * used it for all five LLM steps, and the three prompts stored on
 * graphBuildConfigs were never read at all — the builder used imported
 * constants and two local functions, so a user editing the config's prompts saw
 * no effect whatsoever. narrativeGraph also resolved only `graph_perspective`,
 * so node descriptions and state detection silently ran on the extraction
 * profile.
 *
 * These pin the three properties that fixes: the configured prompt is what gets
 * sent, a blank column falls back to the code default rather than sending an
 * empty system prompt, and per-step connection/sampling actually reach the call.
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
			opts: any
			constructor(opts: any) {
				this.opts = opts
			}
		}
	})
}))

const baseConn = { id: 1, name: "base-conn", type: "openai_session" } as any
const baseSampling = { id: 1, name: "base-sampling" } as any

/** label -> what the call actually ran with */
const calls: Array<{
	label: string
	system: string
	connection: string
	sampling: string
}> = []

beforeEach(() => {
	calls.length = 0
	runQueuedLLMCallMock.mockReset()
	runQueuedLLMCallMock.mockImplementation(async (opts: any) => {
		const label: string = opts?.label ?? ""
		calls.push({
			label,
			system: opts.adapter?.opts?.promptConfig?.systemPrompt ?? "",
			connection: opts.connectionName,
			sampling: opts.samplingName
		})
		if (label.includes("character extraction"))
			return {
				text: '{"participants": ["Aria", "Nym"], "mentioned": []}'
			}
		if (label.includes("Character Perspective"))
			return {
				text: '{"relationships": [{"from": "Aria", "to": "Nym", "type": "ally", "reason": "r", "description": "d", "status": "active", "visibility": "secret"}]}'
			}
		if (label.includes("Node Description"))
			return { text: "Nym is a scout." }
		return { text: "{}" }
	})
})
afterEach(() => runQueuedLLMCallMock.mockReset())

async function runBuild(steps?: any) {
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
		connection: baseConn,
		sampling: baseSampling,
		contextConfig: { id: 1 } as any,
		promptConfig: { id: 1 } as any,
		steps,
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

const find = (needle: string) => calls.find((c) => c.label.includes(needle))

describe("per-step graph config", () => {
	test("the CONFIGURED prompt is what gets sent, per step", async () => {
		await runBuild({
			perspective: { systemPrompt: "CUSTOM PERSPECTIVE PROMPT" },
			nodeDescription: { systemPrompt: "CUSTOM DESCRIPTION PROMPT" },
			stateDetection: { systemPrompt: "CUSTOM STATE PROMPT" }
		})
		expect(find("Character Perspective")!.system).toBe(
			"CUSTOM PERSPECTIVE PROMPT"
		)
		expect(find("Node Description")!.system).toBe(
			"CUSTOM DESCRIPTION PROMPT"
		)
		expect(find("State Detection")!.system).toBe("CUSTOM STATE PROMPT")
	})

	test("a blank prompt column falls back to the code default", async () => {
		// graphBuildConfigs' prompt columns default to "", so an unconfigured
		// step must NOT send an empty system prompt.
		const { DEFAULT_GRAPH_PERSPECTIVE_SYSTEM_PROMPT } = await import(
			"./graphPrompts"
		)
		await runBuild({ perspective: { systemPrompt: "   " } })
		expect(find("Character Perspective")!.system).toBe(
			DEFAULT_GRAPH_PERSPECTIVE_SYSTEM_PROMPT
		)
	})

	test("steps run on their own connection and sampling", async () => {
		await runBuild({
			perspective: {
				connection: {
					id: 2,
					name: "fast-model",
					type: "openai_session"
				},
				sampling: { id: 2, name: "precise" }
			},
			nodeDescription: {
				connection: {
					id: 3,
					name: "prose-model",
					type: "openai_session"
				},
				sampling: { id: 3, name: "creative" }
			}
		})
		expect(find("Character Perspective")!.connection).toBe("fast-model")
		expect(find("Character Perspective")!.sampling).toBe("precise")
		expect(find("Node Description")!.connection).toBe("prose-model")
		expect(find("Node Description")!.sampling).toBe("creative")
	})

	test("an unconfigured step falls back to the build-wide connection", async () => {
		await runBuild({
			perspective: {
				connection: {
					id: 2,
					name: "fast-model",
					type: "openai_session"
				},
				sampling: { id: 2, name: "precise" }
			}
		})
		// stateDetection was left unset, so it uses the base pair — and must
		// NOT silently borrow perspective's, which is what used to happen.
		expect(find("State Detection")!.connection).toBe("base-conn")
		expect(find("State Detection")!.sampling).toBe("base-sampling")
	})

	test("with no steps at all, every call still works off the defaults", async () => {
		const { DEFAULT_GRAPH_STATE_DETECTION_SYSTEM_PROMPT } = await import(
			"./graphPrompts"
		)
		await runBuild(undefined)
		expect(find("State Detection")!.system).toBe(
			DEFAULT_GRAPH_STATE_DETECTION_SYSTEM_PROMPT
		)
		expect(find("State Detection")!.connection).toBe("base-conn")
	})
})
