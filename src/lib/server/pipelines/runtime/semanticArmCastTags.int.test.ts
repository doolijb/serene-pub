/**
 * **Lore found by meaning reads as the lore read has it** (plan A19, the
 * search-by-meaning path).
 *
 * The lorebook read (`lorebook_entries`) readies every entry before any
 * mechanism sees it: `@@` decorator lines stripped, `{{char:N}}` turned into
 * the member's name at the session's reading. The vector index keeps the
 * stored text, and the semantic arm handed a hit on to the prompt with that
 * text — so an entry only Search by meaning found reached the model with its
 * raw cast tags and decorator lines.
 *
 * Asserted on the rendered prompt of the SHIPPED reply spec, over the real
 * candidate fetch, with Search by meaning on: the entry's only way in is by
 * meaning (its keyword is never said).
 */

import { afterAll, beforeAll, describe, expect, it, vi } from "vitest"
import fs from "fs/promises"
import os from "os"
import path from "path"
import { run } from "@serene-pub/sdk"
import * as schema from "$lib/server/db/schema"
import { releaseDataDir, type TestDb } from "$lib/server/utils/testDb"
import { createHost } from "$lib/server/pipelines/runtime/host"
import { coreBindings } from "$lib/server/pipelines/runtime/bindings"
import { respondSpec, CHAT_RESPOND_SPEC_ID } from "$lib/server/pipelines/specs"
import { bootstrapPipelines } from "$lib/server/pipelines/boot/bootstrap"
import {
	characterLoreValues,
	seedEntryVectors,
	worldLoreValues
} from "$lib/server/pipelines/testing/fixtures"

vi.setConfig({ testTimeout: 60_000, hookTimeout: 120_000 })

const MODEL = "test-embed-model"

vi.mock("$lib/server/db", async () => {
	const { createTestDb } = await import("$lib/server/utils/testDb")
	const db = await createTestDb()
	return { db }
})

/** A toy embedding: one axis for "is this about the ashguard". */
const vectorFor = (text: string): number[] => [
	text.toLowerCase().includes("ashguard") ? 1 : 0,
	1
]

vi.mock("$lib/server/embedding", async (importOriginal) => ({
	...(await importOriginal<typeof import("$lib/server/embedding")>()),
	isModelReady: () => true,
	getLoadedModelId: () => MODEL,
	embed: async (text: string) => vectorFor(text),
	batchEmbed: async (texts: string[]) => texts.map(vectorFor)
}))

vi.mock("$lib/server/embedding/vectorizationQueue", async (importOriginal) => ({
	...(await importOriginal<
		typeof import("$lib/server/embedding/vectorizationQueue")
	>()),
	promoteScopedVectors: async () => ({
		requested: 0,
		processed: 0,
		remaining: 0,
		boundHit: false,
		reason: "nothing to index — the scope was already covered"
	})
}))

let db: TestDb
let dataDir: string
let sessionId: number
let userId: number

const STORED = "@@depth 3\n{{char:1}} rides with the ashguard at dawn."
const WARDEN_SECRET = "The warden swore the ashguard oath and broke it."

beforeAll(async () => {
	dataDir = await fs.mkdtemp(
		path.join(os.tmpdir(), "serene-pub-semantic-cast-tags-")
	)
	process.env.SERENE_PUB_DATA_DIR = dataDir
	db = (await import("$lib/server/db")).db as unknown as TestDb
	await (await import("$lib/server/db/defaults")).sync()
	await bootstrapPipelines(db)

	const [user] = await db
		.insert(schema.users)
		.values({ username: "semantic-cast-tags", isAdmin: false })
		.returning()
	userId = user.id
	const [book] = await db
		.insert(schema.lorebooks)
		.values({ name: "Ashfall", userId })
		.returning()
	const [session] = await db
		.insert(schema.sessions)
		.values({ userId, isGroup: false, lorebookId: book.id })
		.returning()
	sessionId = session.id

	const [warden] = await db
		.insert(schema.lorebookBindings)
		.values({
			lorebookId: book.id,
			binding: "{{char:1}}",
			name: "Warden Ashe"
		})
		.returning()

	// Reachable by meaning alone: its keyword is never said.
	const [entry] = await db
		.insert(schema.lorebookEntries)
		.values(
			worldLoreValues([
				{
					lorebookId: book.id,
					name: "The riders",
					keys: "wastes",
					content: STORED
				}
			])
		)
		.returning()
	await seedEntryVectors(db, [entry!.id], vectorFor(STORED), MODEL)

	// A background member's private lore, reachable by meaning alone: the
	// narrator (no speaker) reads it.
	const [secret] = await db
		.insert(schema.lorebookEntries)
		.values(
			characterLoreValues([
				{
					lorebookId: book.id,
					name: "The warden's oath",
					keys: "wastes",
					content: WARDEN_SECRET,
					lorebookBindingId: warden!.id
				}
			])
		)
		.returning()
	await seedEntryVectors(db, [secret!.id], vectorFor(WARDEN_SECRET), MODEL)

	await db.insert(schema.sessionMessages).values({
		sessionId,
		role: "user",
		content: "tell me about the ashguard"
	} as any)
})

afterAll(async () => {
	await releaseDataDir(dataDir)
})

/** One turn of the shipped reply spec with Search by meaning on: its prompt. */
const prompt = async (): Promise<string> => {
	const { buildWorld } = await import("$lib/server/pipelines/config/world")
	const world = await buildWorld(db, { sessionId, specId: CHAT_RESPOND_SPEC_ID })
	world.overrides.push({
		nodeKey: "semantic.arm.queries",
		slot: "params",
		path: "searchByMeaning",
		value: "on",
		scopeKind: "defaults"
	} as any)
	const receipt = (await run(respondSpec(), {
		world,
		input: {
			text: "tell me about the ashguard",
			sessionId,
			characterId: null,
			sessionScope: { sessionId, currentCharacterId: null }
		},
		seed: "seed:semantic-cast-tags",
		bindings: coreBindings(),
		host: createHost(db, { sessionId, userId }),
		preview: true
	} as any)) as any
	const search = receipt.nodes.find(
		(n: any) => n.nodeKey === "semantic.arm.search"
	)
	expect(search?.result, search?.reason).toBe("ok")
	const node = receipt.nodes.find((n: any) => n.nodeKey === "prompt")
	const rendered = node?.output?.main?.rendered
	expect(typeof rendered, "the assemble node rendered no prompt").toBe(
		"string"
	)
	return rendered as string
}

describe("an entry Search by meaning found", () => {
	it("reaches the prompt readied: its tag named, its decorator gone", async () => {
		const text = await prompt()
		expect(text).toContain("Warden Ashe rides with the ashguard at dawn.")
		expect(text).not.toContain("{{char:1}}")
		expect(text).not.toContain("@@depth")
	})

	it("a character-lore entry found by meaning renders with the cast member it is bound to", async () => {
		const text = await prompt()
		expect(text).toContain("Character lore:")
		expect(text).toContain(WARDEN_SECRET)
		expect(text).toMatch(/"castMember":\s*"Warden Ashe"/)
	})
})
