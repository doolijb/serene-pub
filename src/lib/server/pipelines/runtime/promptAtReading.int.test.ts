/**
 * **The prompt reads the book where the session stands** (plan lorebooks
 * consolidation A19, A20, and A25's visibility leftover).
 *
 * Every assertion is on the rendered prompt of the shipped reply spec, stopped
 * before the model — the text a model would be sent:
 *
 * - **A19** — a `{{char:N}}` tag reads as the member's name when the member
 *   has no card (a background member) or their card was deleted, and that
 *   name is the one the session's reading has (a cast amendment by then).
 *   The card is the one the reading draws them with: a dated Unlink, Link or
 *   Change card by then moves the tag with it, as the editor's chip does.
 * - **A20** — history entries sharing a date each reach the prompt; a
 *   year-only date keeps its place in newest-first order; with no clock of
 *   its own, the session is told its line's present, not the newest entry
 *   retrieval happened to pick.
 * - **A25 leftover** — a member's visibility read at the session's reading:
 *   hidden from a date on, their ties drop out; legendary from a date on,
 *   they join the figures everyone knows of. The relationship hop's lore
 *   links (`readGraphEntryLinks`) name a member as of then, and leave a
 *   hidden one out, as the cast's own ties do.
 *
 * The book: Amara speaks, Kiran is seated beside her. The Ashguard has no
 * card and is renamed Warden Ashe in year 5. Mira's card was deleted. Kiran
 * is hidden from year 10, and the Old King becomes legendary in year 10.
 * Dated cards, from year 9: Aria is unlinked and renamed The Widow; the
 * cardless Stranger is linked to the Keeper's card; the Novice's card is
 * changed for the Old Keeper's; Ghost's card is changed for one since deleted.
 * The Ashguard watches over the gate and Kiran holds its key (lore links).
 * History: year 3, two entries in year 7, year 7 month 2, and year 20 (which
 * no keyword of this turn triggers — the line's present, never retrieved).
 */

import { afterAll, beforeAll, describe, expect, it, vi } from "vitest"
import fs from "fs/promises"
import os from "os"
import path from "path"
import { eq } from "drizzle-orm"
import { run } from "@serene-pub/sdk"
import * as schema from "$lib/server/db/schema"
import { releaseDataDir, type TestDb } from "$lib/server/utils/testDb"
import { coreBindings } from "$lib/server/pipelines/runtime/bindings"
import { createHost } from "$lib/server/pipelines/runtime/host"
import { buildWorld } from "$lib/server/pipelines/config/world"
import { bootstrapPipelines } from "$lib/server/pipelines/boot/bootstrap"
import { respondSpec, CHAT_RESPOND_SPEC_ID } from "$lib/server/pipelines/specs"
import {
	historyValues,
	worldLoreValues
} from "$lib/server/pipelines/testing/fixtures"

// No embedding model: retrieval stays on the keyword path.
vi.mock("$lib/server/embedding", () => ({
	isModelReady: () => false,
	getLoadedModelId: () => null
}))

vi.mock("$lib/server/db", async () => {
	const { createTestDb } = await import("$lib/server/utils/testDb")
	const db = await createTestDb()
	return { db, getCryptoSecretKey: () => "prompt-at-reading-secret" }
})

vi.setConfig({ testTimeout: 60_000, hookTimeout: 120_000 })

/** The tie as the relationships block renders it; the reply prompt's own prose may say "trusts". */
const TRUSTS_TIE = '"type": "trusts"'

let db: TestDb
let dataDir: string
let sessionId: number
let userId: number
let speakerCharacterId: number

beforeAll(async () => {
	dataDir = await fs.mkdtemp(
		path.join(os.tmpdir(), "serene-pub-prompt-at-reading-")
	)
	process.env.SERENE_PUB_DATA_DIR = dataDir
	db = (await import("$lib/server/db")).db as unknown as TestDb
	await (await import("$lib/server/db/defaults")).sync()
	await bootstrapPipelines(db)

	const [user] = await db
		.insert(schema.users)
		.values({ username: "prompt-at-reading", isAdmin: false })
		.returning()
	userId = user.id
	const [book] = await db
		.insert(schema.lorebooks)
		.values({ userId, name: "Ashfall" })
		.returning()
	const [session] = await db
		.insert(schema.sessions)
		.values({ userId, isGroup: true, lorebookId: book.id })
		.returning()
	sessionId = session.id

	const card = async (name: string, isDeleted = false) =>
		(
			await db
				.insert(schema.characters)
				.values({ userId, name, description: "", isDeleted } as any)
				.returning()
		)[0].id
	const amara = await card("Amara")
	const kiran = await card("Kiran")
	const goneCard = await card("Carded Mira", true)
	const aria = await card("Aria")
	const keeperCard = await card("Keeper Card")
	const noviceCard = await card("Novice Card")
	const oldKeeperCard = await card("Old Keeper Card")
	const ghostCard = await card("Ghost Card")
	const burnedCard = await card("Burned Card", true)
	speakerCharacterId = amara

	const [amaraM, kiranM, ashguard, , king, widow, stranger, novice, ghost] = await db
		.insert(schema.lorebookBindings)
		.values([
			{
				lorebookId: book.id,
				binding: "{{char:1}}",
				name: "Amara",
				characterId: amara
			},
			{
				lorebookId: book.id,
				binding: "{{char:2}}",
				name: "Kiran",
				characterId: kiran
			},
			{
				lorebookId: book.id,
				binding: "{{char:3}}",
				name: "The Ashguard"
			},
			{
				lorebookId: book.id,
				binding: "{{char:4}}",
				name: "Mira",
				characterId: goneCard
			},
			{ lorebookId: book.id, binding: "{{char:5}}", name: "The Old King" },
			{
				lorebookId: book.id,
				binding: "{{char:6}}",
				name: "Aria",
				characterId: aria
			},
			{ lorebookId: book.id, binding: "{{char:7}}", name: "Stranger" },
			{
				lorebookId: book.id,
				binding: "{{char:8}}",
				name: "Novice",
				characterId: noviceCard
			},
			{
				lorebookId: book.id,
				binding: "{{char:9}}",
				name: "Ghost",
				characterId: ghostCard
			}
		])
		.returning()
	await db.insert(schema.sessionCharacters).values([
		{ sessionId, characterId: amara, position: 0 },
		{ sessionId, characterId: kiran, position: 1 }
	] as any)

	await db.insert(schema.castAmendments).values([
		{
			lorebookId: book.id,
			lorebookBindingId: ashguard.id,
			year: 5,
			fields: { name: "Warden Ashe" }
		},
		{
			lorebookId: book.id,
			lorebookBindingId: kiranM.id,
			year: 10,
			fields: { nodeVisibility: "hidden" }
		},
		{
			lorebookId: book.id,
			lorebookBindingId: king.id,
			year: 10,
			fields: { nodeVisibility: "legendary" }
		},
		{
			lorebookId: book.id,
			lorebookBindingId: widow.id,
			year: 9,
			fields: { characterId: null, name: "The Widow" }
		},
		{
			lorebookId: book.id,
			lorebookBindingId: stranger.id,
			year: 9,
			fields: { characterId: keeperCard }
		},
		{
			lorebookId: book.id,
			lorebookBindingId: novice.id,
			year: 9,
			fields: { characterId: oldKeeperCard }
		},
		{
			lorebookId: book.id,
			lorebookBindingId: ghost.id,
			year: 9,
			fields: { characterId: burnedCard }
		}
	])

	await db.insert(schema.narrativeRelationships).values([
		{
			lorebookId: book.id,
			fromNodeId: amaraM.id,
			toNodeId: kiranM.id,
			relationshipType: "trusts",
			visibility: "acknowledged",
			status: "active",
			description: ""
		},
		{
			lorebookId: book.id,
			fromNodeId: king.id,
			toNodeId: amaraM.id,
			relationshipType: "banished",
			visibility: "public",
			status: "active",
			description: ""
		}
	] as any)

	const [gate] = await db
		.insert(schema.lorebookEntries)
		.values(
			worldLoreValues([
				{
					lorebookId: book.id,
					name: "The gate",
					keys: "",
					constant: true,
					content:
						"{{char:3}} guards the gate. {{char:4}} keeps the ledger."
				},
				{
					lorebookId: book.id,
					name: "The hall",
					keys: "",
					constant: true,
					content:
						"{{char:6}} mourns. {{char:7}} watches. {{char:8}} keeps the keys. {{char:9}} haunts the hall."
				}
			])
		)
		.returning()
	await db.insert(schema.narrativeRelationships).values([
		{
			lorebookId: book.id,
			fromNodeId: ashguard.id,
			toEntryId: gate.id,
			relationshipType: "watches over",
			visibility: "public",
			status: "active",
			description: ""
		},
		{
			lorebookId: book.id,
			fromNodeId: kiranM.id,
			toEntryId: gate.id,
			relationshipType: "holds the key to",
			visibility: "public",
			status: "active",
			description: ""
		}
	] as any)
	await db.insert(schema.lorebookEntries).values(
		historyValues([
			{
				lorebookId: book.id,
				year: 3,
				keys: "",
				constant: true,
				content: "The first frost."
			},
			{
				lorebookId: book.id,
				year: 7,
				keys: "",
				constant: true,
				content: "The bridge fell."
			},
			{
				lorebookId: book.id,
				year: 7,
				keys: "",
				constant: true,
				content: "The tower burned."
			},
			{
				lorebookId: book.id,
				year: 7,
				month: 2,
				keys: "",
				constant: true,
				content: "Ice on the river."
			},
			// The line's newest entry, which nothing in this turn triggers.
			{
				lorebookId: book.id,
				year: 20,
				keys: "comet",
				content: "The comet came."
			}
		])
	)

	await db.insert(schema.sessionMessages).values({
		sessionId,
		role: "user",
		content: "What news?"
	} as any)
})

afterAll(async () => {
	await releaseDataDir(dataDir)
})

/** The session's own clock: a year, or none (following its line's present). */
const setClock = async (year: number | null) =>
	await db
		.update(schema.sessions)
		.set({
			storyClockYear: year,
			storyClockMonth: null,
			storyClockDay: null
		})
		.where(eq(schema.sessions.id, sessionId))

/** One turn of the shipped reply spec, stopped before the model: its prompt. */
const prompt = async (): Promise<string> => {
	const receipt = (await run(respondSpec(), {
		input: {
			text: "What news?",
			sessionId,
			characterId: speakerCharacterId,
			sessionScope: { sessionId, currentCharacterId: speakerCharacterId }
		},
		seed: "seed:prompt-at-reading",
		bindings: coreBindings(),
		world: await buildWorld(db, { sessionId, specId: CHAT_RESPOND_SPEC_ID }),
		host: createHost(db, { sessionId, userId }),
		preview: true
	} as any)) as any
	const node = (receipt.nodes as any[]).find((n) => n.nodeKey === "prompt")
	const rendered = node?.output?.main?.rendered
	expect(typeof rendered, "the assemble node rendered no prompt").toBe(
		"string"
	)
	return rendered as string
}

/**
 * The relationship hop's lore links as the session reads them, each said
 * `[from, relationship type, to]` — what the relationships band words a hop by.
 */
const loreLinks = async (): Promise<string[][]> => {
	const { readGraphEntryLinks } = await import(
		"$lib/server/utils/graphEntryLinks"
	)
	return ((await readGraphEntryLinks(db as any, sessionId)) ?? [])
		.map((l) => [l.from.name, l.relationshipType, l.to.name])
		.sort((a, b) => a[1].localeCompare(b[1]))
}

/** The history section, from its heading to the fence that closes it. */
const historyBlock = (text: string): string => {
	const at = text.indexOf("Story history:")
	expect(at, "the prompt has no history section").toBeGreaterThan(-1)
	const opened = text.indexOf("```", at)
	const closed = text.indexOf("```", opened + 3)
	return text.slice(at, closed === -1 ? undefined : closed)
}

describe("following the line's present (no clock of its own)", () => {
	let text = ""
	beforeAll(async () => {
		await setClock(null)
		text = await prompt()
	})

	it("a cardless member's tag reads as their name, as amended by then (A19)", () => {
		expect(text).toContain("Warden Ashe guards the gate.")
		expect(text).not.toContain("{{char:3}}")
	})

	it("a member whose card was deleted reads as their own name (A19)", () => {
		expect(text).toContain("Mira keeps the ledger.")
		expect(text).not.toContain("Carded Mira")
	})

	it("two history entries sharing a date both reach the prompt (A20 a)", () => {
		const block = historyBlock(text)
		expect(block).toContain("The bridge fell.")
		expect(block).toContain("The tower burned.")
	})

	it("a year-only date keeps its place, newest first (A20 b)", () => {
		const block = historyBlock(text)
		const river = block.indexOf("Ice on the river.")
		const bridge = block.indexOf("The bridge fell.")
		const frost = block.indexOf("The first frost.")
		expect(river).toBeGreaterThan(-1)
		expect(river).toBeLessThan(bridge)
		expect(bridge).toBeLessThan(frost)
	})

	it("the date the session is told is its line's present (A20 c)", () => {
		expect(text).toContain("The current date in the story is 20.")
	})

	it("a member hidden by a dated change drops out of the speaker's ties", () => {
		expect(text).not.toContain(TRUSTS_TIE)
	})

	it("a member legendary by a dated change is a figure everyone knows of", () => {
		expect(text).toContain("The Old King")
		expect(text).toContain("banished")
	})

	it("a tag reads the card a dated change draws the member with (A19)", () => {
		expect(text).toContain(
			"The Widow mourns. Keeper Card watches. Old Keeper Card keeps the keys. Ghost haunts the hall."
		)
	})

	it("a lore link names a member as of then, and drops a hidden one", async () => {
		expect(await loreLinks()).toEqual([
			["Warden Ashe", "watches over", "The gate"]
		])
	})
})

describe("a session clock before the dated changes (year 4)", () => {
	let text = ""
	beforeAll(async () => {
		await setClock(4)
		text = await prompt()
	})

	it("a tag reads the card the member had then", () => {
		expect(text).toContain(
			"Aria mourns. Stranger watches. Novice Card keeps the keys. Ghost Card haunts the hall."
		)
	})

	it("a lore link names each member as they were then", async () => {
		expect(await loreLinks()).toEqual([
			["Kiran", "holds the key to", "The gate"],
			["The Ashguard", "watches over", "The gate"]
		])
	})

	it("the cardless member reads by the name they had then", () => {
		expect(text).toContain("The Ashguard guards the gate.")
	})

	it("the member not yet hidden keeps their tie", () => {
		expect(text).toContain(TRUSTS_TIE)
	})

	it("the member not yet legendary is nobody's figure", () => {
		expect(text).not.toContain("The Old King")
		expect(text).not.toContain("banished")
	})

	it("the date is the session's own clock", () => {
		expect(text).toContain("The current date in the story is 4.")
	})
})

describe("a session clock after the dated changes (year 12)", () => {
	let text = ""
	beforeAll(async () => {
		await setClock(12)
		text = await prompt()
	})

	it("the cardless member reads by their new name", () => {
		expect(text).toContain("Warden Ashe guards the gate.")
	})

	it("the hidden member's tie is gone", () => {
		expect(text).not.toContain(TRUSTS_TIE)
	})

	it("the legendary member is a figure everyone knows of", () => {
		expect(text).toContain("The Old King")
		expect(text).toContain("banished")
	})

	it("a tag reads the card the member is drawn with by then", () => {
		expect(text).toContain(
			"The Widow mourns. Keeper Card watches. Old Keeper Card keeps the keys. Ghost haunts the hall."
		)
		expect(text).not.toContain("Aria")
		expect(text).not.toContain("Novice Card")
	})

	it("a lore link names the member by their new name, and the hidden one is gone", async () => {
		expect(await loreLinks()).toEqual([
			["Warden Ashe", "watches over", "The gate"]
		])
	})
})
