/**
 * Lore retrieval end to end: real lorebook rows, through the keyword Query and
 * the ranker, inside a running pipeline.
 *
 * The claim being tested is the one the decomposition exists for — that the
 * three stages give three separate, attributable answers:
 *
 *   the Query says **what matched**
 *   the ranker says **what won**
 *   the selection says **what fit**
 *
 * Today all three collapse into one pass, so a missing lore entry has exactly
 * one diagnosis available: read the code.
 */

import { describe, it, expect, beforeAll, vi } from "vitest"
import { createTestDb, type TestDb } from "$lib/server/utils/testDb"
import { createHost } from "./host"
import { coreBindings } from "./bindings"
import { spec, compile, run, slot } from "@serene-pub/sdk"
import * as C from "@serene-pub/contracts"
import * as schema from "$lib/server/db/schema"

// Embedding readiness is instance state the host reads, so the arm-selection
// tests toggle it here rather than passing a flag along a data edge.
let modelReady = false
vi.mock("$lib/server/embedding", () => ({
	isModelReady: () => modelReady,
	getLoadedModelId: () => (modelReady ? "test-embed-model" : null)
}))

let db: TestDb
let chatId: number
let userId: number
let lorebookId: number

const retrieval = () =>
	compile(
		spec("core:spec/lore-turn", { version: "1.0.0" })
			.input("input", C.userMessage.v1())
			.query("lore", ($) => C.lorebookTriggers.v1({ text: $.input.text }))
			.build()
	)

beforeAll(async () => {
	db = await createTestDb()

	const [user] = await db
		.insert(schema.users)
		.values({ username: "retrieval-test", isAdmin: false })
		.returning()
	userId = user.id

	const [lorebook] = await db
		.insert(schema.lorebooks)
		.values({ name: "Test Lore", userId })
		.returning()
	lorebookId = lorebook.id

	const [chat] = await db
		.insert(schema.chats)
		.values({ userId, isGroup: false, lorebookId })
		.returning()
	chatId = chat.id

	await db.insert(schema.worldLoreEntries).values([
		{
			lorebookId,
			name: "The Ashguard",
			keys: "ashguard, banner",
			content: "An order of oathbound riders."
		},
		{
			lorebookId,
			name: "Silverwood",
			keys: "silverwood",
			content: "A forest nobody has mentioned."
		},
		{
			lorebookId,
			name: "Standing Orders",
			keys: "",
			constant: true,
			content: "Always remember the oath."
		},
		{
			lorebookId,
			name: "Retired Fact",
			keys: "ashguard",
			enabled: false,
			content: "Something switched off."
		},
		{
			lorebookId,
			name: "Vector Only",
			keys: "ashguard",
			retrievalStrategy: "rag",
			content: "Belongs to the other arm."
		}
	])

	await db.insert(schema.chatMessages).values([
		{
			chatId,
			role: "user",
			content: "The ashguard rode under a torn banner."
		}
	])
}, 60_000)

const execute = (input: Record<string, unknown> = {}) =>
	run(retrieval(), {
		input: {
			text: "tell me about the ashguard",
			chatScope: { chatId },
			...input
		},
		seed: "seed:lore",
		bindings: coreBindings(),
		host: createHost(db as any, { chatId, userId })
	})

describe("lore retrieval in a pipeline", () => {
	it("surfaces entries whose keys matched real messages", async () => {
		const receipt = await execute()
		expect(receipt.outcome).toBe("ok")

		const lore = receipt.nodes.find((n) => n.nodeKey === "lore")!
		const names = (lore.output as any).hits.map((h: any) => h.payload.name)
		expect(names).toContain("The Ashguard")
	})

	it("includes a constant entry that matched nothing", async () => {
		const lore = (await execute()).nodes.find((n) => n.nodeKey === "lore")!
		const pinned = (lore.output as any).hits.find(
			(h: any) => h.payload.name === "Standing Orders"
		)
		expect(pinned.pinned).toBe(true)
	})

	it("says why each entry it declined was declined", async () => {
		// The assertion this whole file exists for: three different reasons, each
		// pointing at a different fix, where today all three read as absent lore.
		const lore = (await execute()).nodes.find((n) => n.nodeKey === "lore")!
		const skipped = (lore.output as any).skipped as any[]
		const reasons = skipped.map((s) => s.reason).join(" | ")

		expect(reasons).toMatch(/disabled/)
		expect(reasons).toMatch(/no key matched in the last 10 messages/)
	})

	it("a rag entry falls back to keyword when this instance has no embeddings", async () => {
		// Availability is false in the binding until the vector arm is bound, so
		// "Vector Only" is findable rather than silently unreachable.
		const lore = (await execute()).nodes.find((n) => n.nodeKey === "lore")!
		const names = (lore.output as any).hits.map((h: any) => h.payload.name)
		expect(names).toContain("Vector Only")
	})

	it("the same entry is handled by the other arm once embeddings exist", async () => {
		modelReady = true
		const lore = (await execute()).nodes.find((n) => n.nodeKey === "lore")!
		const names = (lore.output as any).hits.map((h: any) => h.payload.name)
		expect(names).not.toContain("Vector Only")

		const skipped = (lore.output as any).skipped as any[]
		expect(skipped.map((s) => s.reason).join(" ")).toMatch(/vector search/)
		modelReady = false
	})

	it("says why vector search did not run, in the run's own diagnostics", async () => {
		// So "why is RAG not working" is answerable from the receipt rather than
		// from the embedding settings screen.
		const lore = (await execute()).nodes.find((n) => n.nodeKey === "lore")!
		expect((lore.output as any).diagnostics.vectorSearch).toMatch(
			/no embedding model is loaded/
		)
	})

	it("reports how far it looked, so an empty result is diagnosable", async () => {
		const lore = (await execute()).nodes.find((n) => n.nodeKey === "lore")!
		const d = (lore.output as any).diagnostics
		expect(d.scanDepth).toBe(10)
		expect(d.considered).toBe(5)
		expect(d.windowChars).toBeGreaterThan(0)
	})

	it("a chat with no lorebook retrieves nothing rather than failing", async () => {
		const [bare] = await db
			.insert(schema.chats)
			.values({ userId, isGroup: false })
			.returning()

		const receipt = await run(retrieval(), {
			input: { text: "anything", chatScope: { chatId: bare.id } },
			seed: "seed:lore",
			bindings: coreBindings(),
			host: createHost(db as any, { chatId: bare.id, userId })
		})
		expect(receipt.outcome).toBe("ok")
		const lore = receipt.nodes.find((n) => n.nodeKey === "lore")!
		expect((lore.output as any).hits).toEqual([])
	})

	it("lore from another chat's lorebook is refused, not filtered", async () => {
		const host = createHost(db as any, { chatId, userId })
		await expect(
			host.read!(
				"lorebook_entries",
				{ chatId: chatId + 999 },
				{
					key: "lore",
					typeId: "core:query/lorebook-triggers",
					typeVersion: 1,
					kind: "query"
				}
			)
		).rejects.toThrow(/may only read the chat it was triggered in/)
	})
})

/**
 * Character lore is private self-knowledge, and the pipeline never enforced it.
 *
 * `isCharacterLoreEntryVisible` has gated this on the legacy path since it was
 * written; nothing under `pipelines/` called it, so every character's private
 * lore competed for the same ranking budget as world lore on every turn — and
 * would have leaked outright the moment character lore was wired into the cast
 * cards. The gate now runs at the host read, next to the decorator stripping,
 * for the reason the file already gives for `isHidden`: a new Query type cannot
 * forget what the read applies for it.
 */
describe("character lore is only visible to whoever it belongs to", () => {
	let ash: number
	let bran: number
	let loreChat: number

	const node = {
		key: "lore",
		typeId: "core:query/lorebook-triggers",
		typeVersion: 1,
		kind: "query" as const
	}

	beforeAll(async () => {
		const [a] = await db
			.insert(schema.characters)
			.values({ userId, name: "Ash", description: "A rider." })
			.returning()
		const [b] = await db
			.insert(schema.characters)
			.values({ userId, name: "Brannoc", description: "A smith." })
			.returning()
		ash = a.id
		bran = b.id

		const [chat] = await db
			.insert(schema.chats)
			.values({ userId, isGroup: true, lorebookId })
			.returning()
		loreChat = chat.id

		const [binding] = await db
			.insert(schema.lorebookBindings)
			.values({ lorebookId, characterId: ash, binding: "{{char:1}}" })
			.returning()
		// Bound to nothing: a background/NPC row, which the rule reserves for
		// the omniscient narrator.
		const [npc] = await db
			.insert(schema.lorebookBindings)
			.values({ lorebookId, binding: "{{char:2}}" })
			.returning()

		await db.insert(schema.characterLoreEntries).values([
			{
				lorebookId,
				lorebookBindingId: binding.id,
				name: "Ash's secret",
				keys: "secret",
				content: "Ash opened the lower gate."
			},
			{
				lorebookId,
				lorebookBindingId: npc.id,
				name: "The gatekeeper",
				keys: "gate",
				content: "Nobody remembers who hired them."
			}
		])
	})

	const readAs = async (currentCharacterId: number | null) => {
		const host = createHost(db as any, { chatId: loreChat, userId })
		const rows = (await host.read!(
			"lorebook_entries",
			{ chatId: loreChat, currentCharacterId },
			node
		)) as any[]
		return rows
			.filter((r) => r.source === "characterLore")
			.map((r) => r.name)
	}

	it("shows a character their own lore", async () => {
		expect(await readAs(ash)).toContain("Ash's secret")
	})

	it("hides it from everyone else", async () => {
		// The failure this prevents: Brannoc's reply is budgeted against — and
		// would eventually be written from — knowledge only Ash has.
		expect(await readAs(bran)).not.toContain("Ash's secret")
	})

	it("reserves an unbound entry for the narrator", async () => {
		expect(await readAs(null)).toContain("The gatekeeper")
		expect(await readAs(ash)).not.toContain("The gatekeeper")
	})

	it("never gates world lore, which has no binding to gate on", async () => {
		const host = createHost(db as any, { chatId: loreChat, userId })
		const rows = (await host.read!(
			"lorebook_entries",
			{ chatId: loreChat, currentCharacterId: bran },
			node
		)) as any[]
		expect(
			rows.filter((r) => r.source === "worldLore").length
		).toBeGreaterThan(0)
	})
})
