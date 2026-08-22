/**
 * A summary, run as a pipeline against real rows — and stopped at the write.
 *
 * The summarize sockets run their spec with `preview: {atNode: "save"}`: every
 * model step executes, and the run halts before the `create-lore-entry`
 * consumer because the handler has never written the entry — a person reviews
 * the result in the modal and saves. This file asks whether that whole path
 * holds together: the spec loads from rows, `summarize_source` resolves sender
 * names, the topic travels the wired `request` port into the drafting prompt,
 * and the receipt carries the synth and naming outputs the socket reads back.
 *
 * The model is faked and only the model.
 */

import { describe, it, expect, beforeAll, vi } from "vitest"
import { createTestDb, type TestDb } from "$lib/server/utils/testDb"
import * as schema from "$lib/server/db/schema"

vi.setConfig({ testTimeout: 30_000, hookTimeout: 60_000 })

/** Every prompt the fake model was handed, in call order. */
const calls: Array<{ systemPrompt: string; userPrompt: string }> = []

/** Canned answers, in the world spec's step order: draft → synth → name. */
const answers = [
	"<content>• The gate was sealed with old iron.</content>",
	"<content>The gate was sealed, so they went under it.</content>",
	"The Sealed Gate"
]

class FakeStepAdapter {
	private system: string
	private user: string
	constructor(p: any) {
		this.system = p?.promptConfig?.systemPrompt ?? ""
		this.user = p?.chat?.chatMessages?.[0]?.content ?? ""
	}
	abort() {}
	async preflight() {}
	async generate() {
		calls.push({ systemPrompt: this.system, userPrompt: this.user })
		const text = answers[Math.min(calls.length - 1, answers.length - 1)]!
		return {
			compiledPrompt: {},
			isAborted: false,
			completionResult: async (onContent: (c: string) => void) => {
				onContent(text)
			}
		}
	}
}

vi.mock("$lib/server/utils/getConnectionAdapter", () => ({
	getConnectionAdapter: async () => ({ Adapter: FakeStepAdapter })
}))
vi.mock("$lib/server/embedding", () => ({
	isModelReady: () => false,
	getLoadedModelId: () => null,
	embed: async () => [],
	batchEmbed: async () => []
}))

let db: TestDb
let chatId: number
let userId: number

beforeAll(async () => {
	db = await createTestDb()
	const { bootstrapPipelines } = await import("./bootstrap")
	await bootstrapPipelines(db as any)

	const [user] = await db
		.insert(schema.users)
		.values({ username: "summarize-run-test", isAdmin: false })
		.returning()
	userId = user.id

	const [character] = await db
		.insert(schema.characters)
		.values({ userId, name: "Mira", description: "A scout." })
		.returning()

	const [lorebook] = await db
		.insert(schema.lorebooks)
		.values({ name: "Run Lore", userId })
		.returning()

	const [chat] = await db
		.insert(schema.chats)
		.values({ userId, isGroup: false, lorebookId: lorebook.id })
		.returning()
	chatId = chat.id

	await db.insert(schema.chatMessages).values([
		{
			chatId,
			role: "assistant",
			characterId: character.id,
			content: "The gate was sealed with old iron."
		},
		{
			chatId,
			role: "user",
			content: "Then we go under it, not through it."
		}
	])

	// The steps resolve their connection through the instance default — the
	// "first time someone presses Summarize" path.
	const [connection] = await db
		.insert(schema.connections)
		.values({ name: "Fake", type: "koboldcpp", baseUrl: "http://x" })
		.returning()
	const [sampling] = await db
		.insert(schema.samplingConfigs)
		.values({ name: "Fake sampling", isImmutable: false })
		.returning()
	await db
		.insert(schema.systemSettings)
		.values({
			id: 1,
			defaultConnectionId: connection.id,
			defaultSamplingConfigId: sampling.id
		})
		.onConflictDoUpdate({
			target: [schema.systemSettings.id],
			set: {
				defaultConnectionId: connection.id,
				defaultSamplingConfigId: sampling.id
			}
		})
}, 120_000)

describe("a summarize run, stopped at the write", () => {
	it("runs every step, halts at save, and the outputs are on the receipt", async () => {
		const { runSpec } = await import("./runTurn")
		const { SUMMARIZE_WORLD_SPEC_ID } = await import("./specs/summarize")

		const seen: string[] = []
		const receipt = await runSpec({
			db,
			chatId,
			userId,
			specId: SUMMARIZE_WORLD_SPEC_ID,
			input: {
				scope: { chatId },
				request: { topic: "the gate" }
			},
			preview: { atNode: "save" },
			onNode: (e) => {
				if (e.phase === "start" && e.kind === "provider")
					seen.push(e.typeId)
			},
			skipReceipt: true
		})

		// Halted, not errored: stopping before the write is the designed
		// outcome of this flow, and the socket keys on the node outputs.
		expect(receipt.outcome).toBe("halt")
		expect(receipt.haltNodeKey).toBe("save")

		const out = (key: string) =>
			(receipt.nodes.find((n: any) => n.nodeKey === key) as any)?.output
		expect(out("synth")?.content).toBe(
			"The gate was sealed, so they went under it."
		)
		expect(out("naming")?.name).toBeTruthy()

		// No lore entry was written — that is the whole point of the stop.
		const entries = await db.select().from(schema.worldLoreEntries)
		expect(entries.length).toBe(0)

		// Every model step announced itself, in phase order — the executor's
		// inherent node events, not a per-trigger wiring.
		expect(seen).toEqual([
			"core:provider/summarize-batch@1",
			"core:provider/summarize-synth@1",
			"core:provider/name-entry@1"
		])
	})

	it("carries sender names and the topic into the drafting prompt", async () => {
		const draft = calls[0]!
		// The `summarize_source` read resolved the speaker, so the drafting
		// prompt shows "Mira", not "Unknown".
		expect(draft.userPrompt).toContain("Mira")
		expect(draft.userPrompt).toContain("old iron")
		// The topic travelled the `request` port into phase 1 — per batch,
		// not just at synthesis.
		expect(draft.userPrompt).toContain('Focus specifically on: "the gate"')
	})
})
