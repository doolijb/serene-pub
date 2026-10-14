/**
 * Card I/O with strokes and the card dowry (DESIGN-card-strokes §A.6, §B.5,
 * §B.6) — through the real export and import handlers, on PGlite.
 *
 * "Another install" is simulated by exporting as one person, then removing
 * that person's declarations from the registry and the tables before a second
 * person imports: the importer's install has never seen them.
 */

import { afterAll, beforeAll, describe, expect, test, vi } from "vitest"
import fs from "fs/promises"
import os from "os"
import path from "path"
import { and, eq, like } from "drizzle-orm"
import * as schema from "$lib/server/db/schema"
import {
	DOWRY_LIMITS,
	defineAttributeSlot,
	_clearAttributeSheets,
	_clearAttributeSlots,
	type AttributeSlotProps,
	type Stroke
} from "@serene-pub/sdk"
import type { TestDb } from "$lib/server/utils/testDb"

let testDb: TestDb
let dataDir: string

// Strokes are paused (`strokesFlag.ts`, owner 2026-10-11): this file runs the
// stroke paths with the flag ON, and the "strokes paused" block at the end
// with it OFF. A getter, so each call reads the value of the moment.
const strokesFlag = vi.hoisted(() => ({ on: true }))
vi.mock("$lib/shared/characters/strokesFlag", () => ({
	get STROKES_ENABLED() {
		return strokesFlag.on
	}
}))

vi.mock("$lib/server/db", async () => {
	const { createTestDb } = await import("$lib/server/utils/testDb")
	const db = await createTestDb()
	return { db }
})

beforeAll(async () => {
	dataDir = await fs.mkdtemp(path.join(os.tmpdir(), "serene-pub-card-io-int-"))
	process.env.SERENE_PUB_DATA_DIR = dataDir
	const dbModule = await import("$lib/server/db")
	testDb = dbModule.db as unknown as TestDb
}, 60_000)

afterAll(async () => {
	await fs.rm(dataDir, { recursive: true, force: true })
})

const HP = "core:slot/hp@1"
const hpProps: AttributeSlotProps = {
	type: "integer",
	label: { en: "HP" },
	descriptor: "Hit points.",
	appliesTo: ["cast"]
} as AttributeSlotProps
const sanityProps: AttributeSlotProps = {
	type: "integer",
	label: { en: "Sanity" },
	descriptor: "How much of their mind is left.",
	appliesTo: ["cast"],
	config: { min: 0, max: 100 }
} as AttributeSlotProps

function freshRegistry() {
	_clearAttributeSlots()
	_clearAttributeSheets()
	defineAttributeSlot(HP, hpProps)
}

const makeUser = async (username: string) => {
	const { createTestUser } = await import("$lib/server/utils/testDb")
	return createTestUser(testDb, username)
}
const sock = (userId: number) => ({ user: { id: userId } }) as any
const noop = () => {}
const b64 = (card: unknown) =>
	Buffer.from(JSON.stringify(card), "utf-8").toString("base64")

const strokes: Stroke[] = [
	{ kind: "description", slug: "body", text: "Tall and wiry.", when: { mode: "always" } },
	{
		kind: "description",
		slug: "eyes",
		label: "Eyes",
		text: "green, and they glow in the dark",
		when: { mode: "keywords", keys: ["eyes", "glow"], caseSensitive: true }
	},
	{ kind: "personality", text: "A secret fear of water.", when: { mode: "off" } },
	{ kind: "personality", text: "Bold.", when: { mode: "always" } }
]

async function exportJson(userId: number, id: number) {
	const { charactersExportCard } = await import("$lib/server/sockets/characters")
	const res: any = await charactersExportCard.handler(sock(userId), { id, format: "json" }, noop)
	return JSON.parse(Buffer.from(res.blob).toString("utf-8"))
}

async function importCard(userId: number, card: unknown) {
	const { charactersImportCard } = await import("$lib/server/sockets/characters")
	return charactersImportCard.handler(sock(userId), { file: b64(card) }, noop)
}

describe("card strokes and dowry — round trip", () => {
	test(
		"SP → file → SP: strokes identical, keyword strokes in the book, dowry re-owned once, rows and sheet order kept, foreign extensions kept",
		async () => {
			freshRegistry()
			const { declareSlot, declareSheet, setOwnerSheets } = await import(
				"$lib/server/state/declarations"
			)
			const { applyStrokesToCard } = await import("$lib/server/characters/strokes")
			const alice = await makeUser("alice")
			const bob = await makeUser("bob")

			await declareSlot(testDb, alice.id, "alice:slot/sanity@1", sanityProps)
			await declareSheet(testDb, alice.id, "alice:sheet/kit@1", {
				label: { en: "Kit" },
				slots: [{ id: "alice:slot/sanity@1" }, { id: HP }]
			} as any)
			await declareSheet(testDb, alice.id, "alice:sheet/extra@1", {
				label: { en: "Extra" },
				slots: [{ id: HP }]
			} as any)

			const fields = applyStrokesToCard({ strokes, description: "", personality: null })
			const [card] = await testDb
				.insert(schema.characters)
				.values({
					userId: alice.id,
					name: "Mara",
					description: fields.description!,
					personality: fields.personality,
					strokes,
					extensions: { risuai: { utilityBot: false, custom: [1, 2] } }
				})
				.returning()
			await setOwnerSheets(
				testDb,
				{ kind: "card", id: card.id },
				["alice:sheet/kit@1", "alice:sheet/extra@1"],
				{ userId: alice.id }
			)
			await testDb.insert(schema.attributeConfigs).values({
				ownerKind: "card",
				ownerId: card.id,
				slotId: "alice:slot/sanity@1",
				config: { max: 80 }
			})
			await testDb.insert(schema.attributeValues).values([
				{ ownerKind: "card", ownerId: card.id, slotId: "alice:slot/sanity@1", value: { v: 64 } },
				{ ownerKind: "card", ownerId: card.id, slotId: HP, value: { v: 12 }, note: "bruised" }
			])

			const file = await exportJson(alice.id, card.id)
			const ext = file.data.extensions
			expect(ext.risuai).toEqual({ utilityBot: false, custom: [1, 2] })
			expect(ext.serenepub.strokes).toEqual(strokes)
			expect(file.data.description).toBe(fields.description)
			// Only the keyword stroke reaches the book.
			expect(file.data.character_book.entries).toHaveLength(1)
			expect(file.data.character_book.entries[0]).toMatchObject({
				keys: ["eyes", "glow"],
				name: "Eyes",
				content: "Eyes: green, and they glow in the dark",
				enabled: true,
				constant: false,
				use_regex: false,
				case_sensitive: true,
				extensions: { serenepub: { stroke: "eyes" } }
			})
			const dowry = ext.serenepub.dowry
			expect(dowry.sheets).toEqual(["alice:sheet/kit@1", "alice:sheet/extra@1"])
			expect(dowry.declarations.slots.map((d: any) => d.id)).toEqual(["alice:slot/sanity@1"])
			expect(dowry.declarations.slots[0].origin).toBe("stored")
			expect(dowry.declarations.sheets.map((d: any) => d.id).sort()).toEqual([
				"alice:sheet/extra@1",
				"alice:sheet/kit@1"
			])
			expect(dowry.refs.map((r: any) => r.id)).toEqual([HP])
			expect(dowry.rows).toHaveLength(3)

			// Another install: alice's vocabulary was never here.
			freshRegistry()
			await testDb.delete(schema.attributeSheets).where(like(schema.attributeSheets.id, "alice:%"))
			await testDb
				.delete(schema.attributeDeclarations)
				.where(like(schema.attributeDeclarations.id, "alice:%"))

			const res: any = await importCard(bob.id, file)
			expect(res.status).toBe("created")
			expect(res.book).toBeNull()
			expect(res.summary.some((l: string) => /added to your stats as bob:slot\/sanity@1/.test(l))).toBe(true)
			const imported = await testDb.query.characters.findFirst({
				where: eq(schema.characters.id, res.character.id)
			})
			expect(imported!.strokes).toEqual(strokes)
			expect(imported!.description).toBe(fields.description)
			expect(imported!.extensions).toEqual({
				risuai: { utilityBot: false, custom: [1, 2] },
				depth_prompt: ext.depth_prompt
			})

			const slot = await testDb.query.attributeDeclarations.findFirst({
				where: eq(schema.attributeDeclarations.id, "bob:slot/sanity@1")
			})
			expect(slot?.origin).toBe("stored")
			expect((slot?.props as any).importedFrom).toBe("alice:slot/sanity@1")
			const kit = await testDb.query.attributeSheets.findFirst({
				where: eq(schema.attributeSheets.id, "bob:sheet/kit@1")
			})
			expect((kit?.props as any).slots.map((s: any) => s.id)).toEqual(["bob:slot/sanity@1", HP])

			const sheets = await testDb
				.select({ sheetId: schema.ownerSheets.sheetId })
				.from(schema.ownerSheets)
				.where(and(eq(schema.ownerSheets.ownerKind, "card"), eq(schema.ownerSheets.ownerId, res.character.id)))
				.orderBy(schema.ownerSheets.position)
			expect(sheets.map((s) => s.sheetId)).toEqual(["bob:sheet/kit@1", "bob:sheet/extra@1"])
			const values = await testDb
				.select()
				.from(schema.attributeValues)
				.where(and(eq(schema.attributeValues.ownerKind, "card"), eq(schema.attributeValues.ownerId, res.character.id)))
			expect(values.map((v) => [v.slotId, v.value, v.note]).sort()).toEqual(
				[
					["bob:slot/sanity@1", { v: 64 }, null],
					[HP, { v: 12 }, "bruised"]
				].sort()
			)
			const configs = await testDb
				.select()
				.from(schema.attributeConfigs)
				.where(and(eq(schema.attributeConfigs.ownerKind, "card"), eq(schema.attributeConfigs.ownerId, res.character.id)))
			expect(configs.map((c) => [c.slotId, c.config])).toEqual([["bob:slot/sanity@1", { max: 80 }]])

			// The same card again (a fresh copy — no uuid): still one declaration.
			const again = structuredClone(file)
			delete again.data.extensions.serenepub.uuid
			const res2: any = await importCard(bob.id, again)
			expect(res2.status).toBe("created")
			const copies = await testDb
				.select({ id: schema.attributeDeclarations.id })
				.from(schema.attributeDeclarations)
				.where(like(schema.attributeDeclarations.id, "bob:slot/sanity%"))
			expect(copies).toHaveLength(1)
			const sheetCopies = await testDb
				.select({ id: schema.attributeSheets.id })
				.from(schema.attributeSheets)
				.where(like(schema.attributeSheets.id, "bob:sheet/%"))
			expect(sheetCopies.map((s) => s.id).sort()).toEqual(["bob:sheet/extra@1", "bob:sheet/kit@1"])
			const values2 = await testDb
				.select({ slotId: schema.attributeValues.slotId })
				.from(schema.attributeValues)
				.where(and(eq(schema.attributeValues.ownerKind, "card"), eq(schema.attributeValues.ownerId, res2.character.id)))
			expect(values2.map((v) => v.slotId).sort()).toEqual([HP, "bob:slot/sanity@1"].sort())

			// And the re-imported card exports its strokes and stats again.
			const back = await exportJson(bob.id, res.character.id)
			expect(back.data.extensions.serenepub.strokes).toEqual(strokes)
			expect(back.data.extensions.risuai).toEqual({ utilityBot: false, custom: [1, 2] })
			expect(back.data.extensions.serenepub.dowry.sheets).toEqual(["bob:sheet/kit@1", "bob:sheet/extra@1"])
		},
		60_000
	)
})

const foreignCard = (book: unknown) => ({
	spec: "chara_card_v2",
	spec_version: "2.0",
	data: {
		name: "Wren",
		description: "A courier.",
		personality: "Wry",
		scenario: "",
		first_mes: "Hi.",
		mes_example: "",
		creator_notes: "",
		system_prompt: "",
		post_history_instructions: "",
		alternate_greetings: [],
		tags: [],
		creator: "",
		character_version: "",
		extensions: { risuai: { x: 1 } },
		character_book: book
	}
})

describe("a foreign card's book", () => {
	test(
		"small and plain → keyword strokes, no held book",
		async () => {
			freshRegistry()
			const user = await makeUser("plain-book")
			const res: any = await importCard(
				user.id,
				foreignCard({
					name: "Wren's book",
					extensions: {},
					entries: [
						{ keys: ["satchel"], name: "Satchel", content: "Satchel: Always full of letters.", enabled: true, insertion_order: 0, extensions: {} },
						{ keys: ["^sco+t$"], content: "Her brother.", use_regex: true, case_sensitive: true, position: "after_char", enabled: true, insertion_order: 1, extensions: {} }
					]
				})
			)
			expect(res.status).toBe("created")
			expect(res.book).toBeNull()
			expect(res.summary.some((l: string) => /small and plain/.test(l))).toBe(true)
			const row = await testDb.query.characters.findFirst({ where: eq(schema.characters.id, res.character.id) })
			expect(row!.strokes).toEqual([
				{ kind: "description", text: "A courier.", when: { mode: "always" } },
				{ kind: "personality", text: "Wry", when: { mode: "always" } },
				{ kind: "description", label: "Satchel", text: "Always full of letters.", when: { mode: "keywords", keys: ["satchel"] } },
				{ kind: "description", text: "Her brother.", when: { mode: "keywords", keys: ["^sco+t$"], matchMode: "regex", caseSensitive: true } }
			])
			expect(row!.description).toBe("A courier.\n\nSatchel: Always full of letters.\n\nHer brother.")
			expect(row!.personality).toBe("Wry")
			expect(row!.extensions).toEqual({ risuai: { x: 1 } })
		},
		60_000
	)

	test(
		"large or selective → held book, no strokes",
		async () => {
			freshRegistry()
			const user = await makeUser("selective-book")
			const res: any = await importCard(
				user.id,
				foreignCard({
					name: "Big book",
					extensions: {},
					entries: [
						{ keys: ["a"], secondary_keys: ["b"], selective: true, content: "Both.", enabled: true, insertion_order: 0, extensions: {} }
					]
				})
			)
			expect(res.book?.name).toBe("Big book")
			expect(res.summary.some((l: string) => /offered as a lorebook/.test(l))).toBe(true)
			const row = await testDb.query.characters.findFirst({ where: eq(schema.characters.id, res.character.id) })
			expect(row!.strokes).toEqual([])
			expect(row!.description).toBe("A courier.")

			const many = Array.from({ length: 25 }, (_, i) => ({
				keys: [`k${i}`], content: `Entry ${i}.`, enabled: true, insertion_order: i, extensions: {}
			}))
			const res2: any = await importCard(user.id, foreignCard({ name: "Many", extensions: {}, entries: many }))
			expect(res2.book?.name).toBe("Many")
			const row2 = await testDb.query.characters.findFirst({ where: eq(schema.characters.id, res2.character.id) })
			expect(row2!.strokes).toEqual([])
		},
		60_000
	)
})

describe("a dowry over its limits", () => {
	test(
		"the card is imported, the dowry skipped with a summary line",
		async () => {
			freshRegistry()
			const user = await makeUser("over-limits")
			const card: any = foreignCard(undefined)
			delete card.data.character_book
			card.data.extensions.serenepub = {
				dowry: {
					format: 1,
					sheets: [],
					rows: Array.from({ length: DOWRY_LIMITS.maxRows + 1 }, () => ({ slotId: HP, value: { v: 1 } })),
					declarations: { slots: [], sheets: [] },
					refs: []
				}
			}
			const res: any = await importCard(user.id, card)
			expect(res.status).toBe("created")
			expect(res.summary.some((l: string) => /stats were not imported/.test(l))).toBe(true)
			const values = await testDb
				.select()
				.from(schema.attributeValues)
				.where(and(eq(schema.attributeValues.ownerKind, "card"), eq(schema.attributeValues.ownerId, res.character.id)))
			expect(values).toHaveLength(0)
		},
		60_000
	)
})

describe("strokes paused (STROKES_ENABLED off)", () => {
	beforeAll(() => {
		strokesFlag.on = false
	})
	afterAll(() => {
		strokesFlag.on = true
	})

	test(
		"a card carrying serenepub.strokes imports as its prose, strokes [], the stroke entries not held",
		async () => {
			freshRegistry()
			const user = await makeUser("paused-import")
			const card: any = foreignCard({
				name: "Mixed book",
				extensions: {},
				entries: [
					{ id: 1, keys: ["lamp"], content: "A lamp.", enabled: true, insertion_order: 0, extensions: {} },
					{ id: 2, keys: ["eyes"], name: "Eyes", content: "Eyes: green", enabled: true, insertion_order: 1, extensions: { serenepub: { stroke: "eyes" } } }
				]
			})
			card.data.description = "Tall and wiry.\n\nEyes: green"
			card.data.extensions.serenepub = { strokes }
			const res: any = await importCard(user.id, card)
			expect(res.status).toBe("created")
			expect(res.summary ?? []).toEqual([])
			// The book is held — only the entry the strokes did not write.
			expect(res.book?.name).toBe("Mixed book")
			const row = await testDb.query.characters.findFirst({ where: eq(schema.characters.id, res.character.id) })
			expect(row!.strokes).toEqual([])
			expect(row!.description).toBe("Tall and wiry.\n\nEyes: green")
			expect(row!.personality).toBe("Wry")
			expect(row!.extensions).toEqual({ risuai: { x: 1 } })
		},
		60_000
	)

	test(
		"a small and plain book is held as a lorebook, never made strokes",
		async () => {
			freshRegistry()
			const user = await makeUser("paused-plain")
			const res: any = await importCard(
				user.id,
				foreignCard({
					name: "Plain book",
					extensions: {},
					entries: [{ keys: ["satchel"], content: "Always full of letters.", enabled: true, insertion_order: 0, extensions: {} }]
				})
			)
			expect(res.status).toBe("created")
			expect(res.book?.name).toBe("Plain book")
			expect(res.summary ?? []).toEqual([])
			const row = await testDb.query.characters.findFirst({ where: eq(schema.characters.id, res.character.id) })
			expect(row!.strokes).toEqual([])
			expect(row!.description).toBe("A courier.")
			expect(row!.personality).toBe("Wry")
		},
		60_000
	)

	test(
		"export of a card with stored strokes carries no serenepub.strokes and no stroke entries",
		async () => {
			freshRegistry()
			const user = await makeUser("paused-export")
			const [card] = await testDb
				.insert(schema.characters)
				.values({
					userId: user.id,
					name: "Mara",
					description: "Tall and wiry.\n\nEyes: green, and they glow in the dark",
					personality: "Bold.",
					strokes,
					extensions: { risuai: { kept: true } }
				})
				.returning()
			const file = await exportJson(user.id, card.id)
			expect(file.data.extensions.serenepub?.strokes).toBeUndefined()
			expect(file.data.extensions.risuai).toEqual({ kept: true })
			expect(file.data.description).toBe("Tall and wiry.\n\nEyes: green, and they glow in the dark")
			const entries: any[] = file.data.character_book?.entries ?? []
			expect(entries.some((e) => e?.extensions?.serenepub?.stroke !== undefined)).toBe(false)
		},
		60_000
	)
})
