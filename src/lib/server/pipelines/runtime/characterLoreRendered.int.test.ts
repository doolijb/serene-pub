/**
 * **Admitted character lore reaches the prompt's text, in every genre that
 * admits it** — and only the lore the speaker may see.
 *
 * Each genre's shipped respond document runs against a freshly booted install
 * (the shipped presets, the shipped context template, the real executor and
 * host) with the model stubbed at the binding. The book is the same for every
 * genre: two carded cast members, Verity and Brask, each holding a private
 * secret the message names, a background member (the Cook, no card) with a
 * secret of their own, and one world entry.
 *
 * What is asserted is the prompt the speaker's assemble node rendered:
 *
 *  - the speaker's own secret is in its text, under the shipped
 *    `Character lore:` heading and beside the cast member it belongs to — the
 *    template places `{{{characterLore}}}` and Assemble lays it out;
 *  - the other members' secrets are nowhere in it (a speaker reads its own
 *    private lore, never another member's);
 *  - the narrator, speaking as nobody, gets the background member's and no
 *    carded character's.
 */

import { afterAll, beforeAll, describe, expect, it, vi } from "vitest"
import fs from "fs/promises"
import os from "os"
import path from "path"
import { ok, run } from "@serene-pub/sdk"
import {
	ADVENTURE_GENRE_ID,
	ADVENTURE_RESPOND_SPEC_ID,
	CORE_SPECS,
	LAIR_GENRE_ID,
	LAIR_RESPOND_SPEC_ID,
	NARRATE_CHARACTER_SPEC_ID,
	NARRATE_SPEC_ID,
	RESPOND_SPEC_ID
} from "@serene-pub/core-catalog"
import * as schema from "$lib/server/db/schema"
import { coreBindings } from "$lib/server/pipelines/runtime/bindings"
import { createHost } from "$lib/server/pipelines/runtime/host"
import { buildWorld } from "$lib/server/pipelines/config/world"
import type { TestDb } from "$lib/server/utils/testDb"

vi.setConfig({ testTimeout: 60_000, hookTimeout: 180_000 })

// No embedding model: retrieval stays on the keyword path.
vi.mock("$lib/server/embedding", () => ({
	isModelReady: () => false,
	getLoadedModelId: () => null,
	embed: async () => [],
	batchEmbed: async () => []
}))

vi.mock("$lib/server/db", async () => {
	const { createTestDb } = await import("$lib/server/utils/testDb")
	const db = await createTestDb()
	return { db, getCryptoSecretKey: () => "character-lore-rendered-secret" }
})

let db: TestDb
let dataDir: string

beforeAll(async () => {
	dataDir = await fs.mkdtemp(
		path.join(os.tmpdir(), "serene-pub-vitest-character-lore-rendered-")
	)
	process.env.SERENE_PUB_DATA_DIR = dataDir
	db = (await import("$lib/server/db")).db as unknown as TestDb
	await (await import("$lib/server/db/defaults")).sync()
	const { bootstrapPipelines } = await import(
		"$lib/server/pipelines/boot/bootstrap"
	)
	await bootstrapPipelines(db as any)
})

afterAll(async () => {
	await fs.rm(dataDir, { recursive: true, force: true })
})

const MESSAGE = "Verity, what happened to the ledger?"
const VERITY_SECRET = "Verity burned the ledger in the stove at midnight."
const BRASK_SECRET = "Brask watched the stove and said nothing about the ledger."
const COOK_SECRET = "The cook was paid to forget the ledger."
const WORLD_FACT = "The ledger went missing from the study on the night of the storm."

/** The planner's answer, for every structured step: Verity is the one who speaks. */
const ANSWER = JSON.stringify({
	beats: ["The fire cracks."],
	speakers: [{ name: "Verity", intent: "answer about the ledger" }],
	worldHints: {},
	needsLookup: false,
	clueSurfaced: false,
	values: [],
	inventory: []
})

const stubbed = () => {
	const parsed = JSON.parse(ANSWER) as Record<string, unknown>
	return {
		...coreBindings(),
		"core:oracle/generate-text@1": async () =>
			ok({ main: "Hm.", text: "Hm.", connection: { type: "stub" } }),
		"core:oracle/generate-json@1": async (input: any) => {
			const at = typeof input?.params?.path === "string" ? input.params.path : ""
			const items = at
				.split(",")
				.map((p: string) => p.trim())
				.filter(Boolean)
				.flatMap((p: string) => {
					const value = parsed[p]
					return Array.isArray(value) ? value : value == null ? [] : [value]
				})
			return ok({
				main: parsed,
				json: parsed,
				value: items,
				items,
				text: ANSWER,
				connection: { type: "stub" },
				structured: { mode: "schema", capability: "json_schema" }
			})
		}
	}
}

let n = 0

/** A session of `genreId` over a book where Verity and Brask each keep a secret. */
async function book(genreId: string, fields: Record<string, unknown> = {}) {
	const { createTestUser } = await import("$lib/server/utils/testDb")
	const { characterLoreValues, worldLoreValues } = await import(
		"$lib/server/pipelines/testing/fixtures"
	)
	const tag = `clr-${++n}`
	const user = await createTestUser(db, tag)
	const [lorebook] = await db
		.insert(schema.lorebooks)
		.values({ userId: user.id, name: `The case ${tag}` })
		.returning()
	const [session] = await db
		.insert(schema.sessions)
		.values({
			userId: user.id,
			isGroup: true,
			name: `Session ${tag}`,
			genreId,
			lorebookId: lorebook!.id,
			genreFields: fields
		})
		.returning()
	const cast: Record<string, number> = {}
	for (const [i, name] of ["Verity", "Brask"].entries()) {
		const [c] = await db
			.insert(schema.characters)
			.values({ userId: user.id, name, description: `${name}, a guest at the manor.` })
			.returning()
		cast[name] = c!.id
		await db.insert(schema.sessionCharacters).values({
			sessionId: session!.id,
			characterId: c!.id,
			isActive: true,
			position: i
		} as any)
	}
	const [verity, brask, cook] = await db
		.insert(schema.lorebookBindings)
		.values([
			{ lorebookId: lorebook!.id, binding: "{{char:1}}", name: "Verity", characterId: cast.Verity! },
			{ lorebookId: lorebook!.id, binding: "{{char:2}}", name: "Brask", characterId: cast.Brask! },
			{ lorebookId: lorebook!.id, binding: "{{char:3}}", name: "The Cook", characterId: null }
		])
		.returning()
	await db.insert(schema.lorebookEntries).values([
		...worldLoreValues([
			{ lorebookId: lorebook!.id, name: "The missing ledger", keys: "ledger", content: WORLD_FACT }
		]),
		...characterLoreValues([
			{
				lorebookId: lorebook!.id,
				name: "Verity's secret",
				keys: "ledger",
				content: VERITY_SECRET,
				lorebookBindingId: verity!.id
			},
			{
				lorebookId: lorebook!.id,
				name: "Brask's secret",
				keys: "ledger",
				content: BRASK_SECRET,
				lorebookBindingId: brask!.id
			},
			{
				lorebookId: lorebook!.id,
				name: "The Cook's secret",
				keys: "ledger",
				content: COOK_SECRET,
				lorebookBindingId: cook!.id
			}
		])
	])
	const [message] = await db
		.insert(schema.sessionMessages)
		.values({ sessionId: session!.id, role: "user", content: MESSAGE } as any)
		.returning()
	await db
		.insert(schema.messages)
		.values({ id: message!.id, sessionId: session!.id, role: "user" } as any)
	return { user, session: session!, cast }
}
type Book = Awaited<ReturnType<typeof book>>

/** Run a shipped spec over `b`, on the world a real turn resolves. */
async function turn(b: Book, specId: string, input: Record<string, unknown>) {
	const entry = CORE_SPECS.find((s) => s.slug === specId)
	expect(entry, `${specId} is not a shipped spec`).toBeTruthy()
	const receipt: any = await run(entry!.build(), {
		input: { text: MESSAGE, sessionId: b.session.id, ...input },
		seed: `seed:${specId}`,
		triggerSource: "event",
		compactHaltReceipts: false,
		bindings: stubbed(),
		world: await buildWorld(db as any, { sessionId: b.session.id, specId }),
		host: createHost(db as any, { sessionId: b.session.id, userId: b.user.id })
	} as any)
	return receipt
}

/** Every prompt text the assemble node at `key` rendered in this run. */
function promptsAt(receipt: any, key: string): string[] {
	const nodes = (receipt.nodes as any[]).filter((node) => node.nodeKey === key)
	expect(
		nodes.length,
		`${key} did not run (${receipt.outcome} ${receipt.haltReason ?? ""})`
	).toBeGreaterThan(0)
	return nodes.map((node) => {
		const main = node.output?.main ?? node.output
		return typeof main?.rendered === "string"
			? main.rendered
			: JSON.stringify(main?.messages ?? node.output)
	})
}

/** Verity's secret is in the prompt, beside her name; nobody else's is. */
function expectVerityOnly(prompt: string) {
	expect(prompt).toContain("Character lore:")
	expect(prompt).toContain(VERITY_SECRET)
	expect(prompt).toMatch(/"castMember":\s*"Verity"/)
	expect(prompt).not.toContain(BRASK_SECRET)
	expect(prompt).not.toContain("Brask's secret")
	expect(prompt).not.toContain(COOK_SECRET)
}

describe("Chat: the speaking character's admitted lore is rendered", () => {
	it("Verity's reply prompt carries her secret and not Brask's", async () => {
		const b = await book("core:genre/chat")
		const receipt = await turn(b, RESPOND_SPEC_ID, {
			characterId: b.cast.Verity,
			sessionScope: { sessionId: b.session.id, currentCharacterId: b.cast.Verity }
		})
		const [prompt] = promptsAt(receipt, "prompt")
		expectVerityOnly(prompt!)
		expect(prompt).toContain(WORLD_FACT)
	})
})

describe("Chat narrator: the narrator's prompt carries the lore the narrator may read", () => {
	it("narrate renders the background member's secret, and no carded character's", async () => {
		const b = await book("core:genre/chat")
		const receipt = await turn(b, NARRATE_SPEC_ID, {
			characterId: null,
			sessionScope: { sessionId: b.session.id, currentCharacterId: null }
		})
		const [prompt] = promptsAt(receipt, "prompt")
		expect(prompt).toContain("Character lore:")
		expect(prompt).toContain(COOK_SECRET)
		expect(prompt).toMatch(/"castMember":\s*"The Cook"/)
		expect(prompt).not.toContain(VERITY_SECRET)
		expect(prompt).not.toContain(BRASK_SECRET)
	})

	it("narrate-character, speaking as Verity, renders her secret and not Brask's", async () => {
		const b = await book("core:genre/chat")
		const receipt = await turn(b, NARRATE_CHARACTER_SPEC_ID, {
			characterId: b.cast.Verity,
			sessionScope: { sessionId: b.session.id, currentCharacterId: b.cast.Verity },
			sideCharacter: { characterId: b.cast.Verity, name: "Verity" },
			speaker: `character:${b.cast.Verity}`
		})
		const [prompt] = promptsAt(receipt, "prompt")
		expectVerityOnly(prompt!)
	})
})

describe("Adventure: each voice's own lore is rendered", () => {
	it("the voice the planner named renders Verity's secret and not Brask's", async () => {
		const b = await book(ADVENTURE_GENRE_ID, { tone: "grounded", difficulty: "normal", trustNarrator: false })
		const receipt = await turn(b, ADVENTURE_RESPOND_SPEC_ID, {
			characterId: null,
			sessionScope: { sessionId: b.session.id, currentCharacterId: null },
			fields: { tone: "grounded", difficulty: "normal", trustNarrator: false }
		})
		for (const prompt of promptsAt(receipt, "voices.item.prompt")) expectVerityOnly(prompt)
	})
})

describe("Lair: the delver who speaks renders their own lore", () => {
	it("Verity's character turn prompt carries her secret and not Brask's", async () => {
		const b = await book(LAIR_GENRE_ID, { trustNarrator: false })
		const receipt = await turn(b, LAIR_RESPOND_SPEC_ID, {
			characterId: b.cast.Verity,
			sessionScope: { sessionId: b.session.id },
			fields: { trustNarrator: false }
		})
		const [prompt] = promptsAt(
			receipt,
			"via.turn.channel.story.door.play.speech.each.character.turn.prompt"
		)
		expectVerityOnly(prompt!)
	})
})
