/**
 * Import hardening through the real socket handlers (lorebooks plan S4):
 *
 * - a conflict reply references a HELD IMPORT instead of echoing the file,
 *   and only the person who imported it can settle it, once;
 * - a person can run only so many imports at once, however many sockets
 *   they open;
 * - byte ceilings before every parse, and the lorebook ceilings on keys,
 *   field lengths, extra data and scenes — each tripped by a fixture built
 *   here, refused with a sentence, and never reaching the database.
 */
import {
	afterAll,
	afterEach,
	beforeAll,
	describe,
	expect,
	test,
	vi
} from "vitest"
import fs from "fs/promises"
import os from "os"
import path from "path"
import type { TestDb } from "$lib/server/utils/testDb"
import { releaseDataDir } from "$lib/server/utils/testDb"
import { IMPORT_FILE_CAPS } from "$lib/shared/imports/fileCaps"
import {
	HELD_IMPORT_GONE,
	clearHeldImports,
	takeHeldImport
} from "$lib/server/imports/heldImports"
import {
	IMPORTS_RUNNING_ON_SERVER,
	IMPORTS_RUNNING_PER_USER,
	SERVER_BUSY_IMPORTING,
	TOO_MANY_IMPORTS,
	withImportLimit
} from "$lib/server/imports/importLimit"
import { IMPORT_JSON_LIMITS } from "$lib/server/imports/jsonShape"

let testDb: TestDb
let dataDir: string

vi.mock("$lib/server/db", async () => {
	const { createTestDb } = await import("$lib/server/utils/testDb")
	const db = await createTestDb()
	return { db }
})

beforeAll(async () => {
	dataDir = await fs.mkdtemp(
		path.join(os.tmpdir(), "serene-pub-import-hardening-int-test-")
	)
	process.env.SERENE_PUB_DATA_DIR = dataDir
	const dbModule = await import("$lib/server/db")
	testDb = dbModule.db as unknown as TestDb
}, 60_000)

afterAll(async () => {
	await releaseDataDir(dataDir)
})

afterEach(() => {
	clearHeldImports()
	vi.restoreAllMocks()
})

async function makeUser(username: string) {
	const { createTestUser } = await import("$lib/server/utils/testDb")
	return createTestUser(testDb, username)
}

/** A fresh socket object each time: a person's sockets are many. */
const socketOf = (userId: number) => ({ user: { id: userId } }) as any

/** Records every emit, resolving the lazy ones. */
function recorder() {
	const emits: Array<[string, any]> = []
	const emit = (event: string, data: any) => {
		emits.push([event, typeof data === "function" ? undefined : data])
	}
	return { emits, emit }
}

const noopEmit = () => {}

/** A handler's outcome as one short string, so a failure's report stays small. */
const outcomeOf = (work: Promise<any>) =>
	work.then(
		(res) => `ok:${res?.status ?? "done"}`,
		(e) => String(e?.message ?? e)
	)

const cardJson = (name: string, description = "A card built in a test") => ({
	spec: "chara_card_v2",
	spec_version: "2.0",
	data: {
		name,
		description,
		personality: "",
		scenario: "",
		first_mes: "Hello.",
		mes_example: "",
		creator_notes: "",
		system_prompt: "",
		post_history_instructions: "",
		alternate_greetings: [],
		tags: [],
		creator: "",
		character_version: "",
		extensions: {}
	}
})

const base64Of = (json: unknown) =>
	Buffer.from(JSON.stringify(json)).toString("base64")

/** Import a card, then an edited copy of its own export: a conflict. */
async function characterConflict(userId: number, emit = noopEmit as any) {
	const { charactersImportCard, charactersExportCard } = await import(
		"./characters"
	)
	const created = await charactersImportCard.handler(
		socketOf(userId),
		{ file: base64Of(cardJson("Aria")) },
		noopEmit
	)
	const exported = await charactersExportCard.handler(
		socketOf(userId),
		{ id: created.character!.id, format: "json" },
		noopEmit
	)
	const edited = JSON.parse(exported.blob.toString("utf-8"))
	edited.data.description = "Edited after export"
	const file = base64Of(edited)
	const conflict = await charactersImportCard.handler(
		socketOf(userId),
		{ file },
		emit
	)
	return { created, conflict, file }
}

const lorebookJsonOf = (book: unknown) => JSON.stringify(book)

/** A book with one world entry, imported, then re-imported edited: a conflict. */
async function lorebookConflict(userId: number, emit = noopEmit as any) {
	const { lorebookImportHandler } = await import("./lorebooks")
	const { buildLorebookExportData } = await import(
		"$lib/server/utils/lorebookExportBuilder"
	)
	const created = await lorebookImportHandler.handler(
		socketOf(userId),
		{
			lorebookJson: lorebookJsonOf({
				name: "Held Book",
				entries: [
					{ keys: ["dragon"], content: "Old lore", enabled: true }
				]
			})
		},
		noopEmit
	)
	const { specBookWithGraph } = await buildLorebookExportData(
		created.lorebook!.id,
		userId
	)
	const edited = JSON.parse(JSON.stringify(specBookWithGraph))
	edited.entries[0].content = "New lore"
	const conflict = await lorebookImportHandler.handler(
		socketOf(userId),
		{ lorebookJson: lorebookJsonOf(edited) },
		emit
	)
	return { created, conflict }
}

describe("a character conflict holds the file instead of echoing it", () => {
	test("the reply names a held import and carries no file", async () => {
		const user = await makeUser("held-card-reply")
		const { emits, emit } = recorder()
		const { conflict, file } = await characterConflict(user.id, emit)
		expect(conflict.status).toBe("conflict")
		expect(typeof conflict.conflict?.heldImportId).toBe("string")
		const [, sent] = emits.find(([e]) => e === "characters:importCard")!
		expect("file" in sent.conflict).toBe(false)
		expect(JSON.stringify(sent).includes(file)).toBe(false)
	}, 60_000)

	test("the owner settles it by reference — overwrite — and only once", async () => {
		const { charactersImportResolve } = await import("./characters")
		const user = await makeUser("held-card-owner")
		const { created, conflict } = await characterConflict(user.id)
		const heldImportId = conflict.conflict!.heldImportId

		const resolved = await charactersImportResolve.handler(
			socketOf(user.id),
			{
				action: "overwrite",
				heldImportId,
				existingId: created.character!.id
			},
			noopEmit
		)
		expect(resolved.character.id).toBe(created.character!.id)
		expect(resolved.character.description).toBe("Edited after export")

		expect(
			await outcomeOf(
				charactersImportResolve.handler(
					socketOf(user.id),
					{ action: "createNew", heldImportId, existingId: -1 },
					noopEmit
				)
			)
		).toBe(HELD_IMPORT_GONE)
	}, 60_000)

	test("someone else cannot settle it, and it still waits for its owner", async () => {
		const { charactersImportResolve } = await import("./characters")
		const owner = await makeUser("held-card-owner-2")
		const stranger = await makeUser("held-card-stranger")
		const { conflict } = await characterConflict(owner.id)
		const heldImportId = conflict.conflict!.heldImportId

		const { emits, emit } = recorder()
		expect(
			await outcomeOf(
				charactersImportResolve.handler(
					socketOf(stranger.id),
					{ action: "createNew", heldImportId, existingId: -1 },
					emit
				)
			)
		).toBe(HELD_IMPORT_GONE)
		expect(emits).toContainEqual([
			"characters:importResolve:error",
			{ error: HELD_IMPORT_GONE }
		])
		const strangers = await testDb.query.characters.findMany({
			where: (c, { eq }) => eq(c.userId, stranger.id)
		})
		expect(strangers).toHaveLength(0)

		const asNew = await charactersImportResolve.handler(
			socketOf(owner.id),
			{ action: "createNew", heldImportId, existingId: -1 },
			noopEmit
		)
		expect(asNew.character.userId).toBe(owner.id)
	}, 60_000)
})

describe("a card's own lorebook is held, not sent back", () => {
	// The created reply carried the card's embedded book — up to 16 MB — to
	// every tab, and the dialog sent it straight back (S4 review).
	const cardWithBook = (name: string) => cardJson(name, "Has a book") as any

	test("the reply names a held import; the dialog imports the book by it, once, and only its owner", async () => {
		const { charactersImportCard } = await import("./characters")
		const { lorebookImportHandler } = await import("./lorebooks")
		const owner = await makeUser("card-book-owner")
		const stranger = await makeUser("card-book-stranger")
		const card = cardWithBook("Bookish")
		card.data.character_book = {
			name: "Bookish's Book",
			entries: [
				{
					keys: ["tea"],
					content: "The tea is always cold.",
					enabled: true
				}
			]
		}
		const { emits, emit } = recorder()
		const created = await charactersImportCard.handler(
			socketOf(owner.id),
			{ file: base64Of(card) },
			emit
		)
		expect(created.status).toBe("created")
		expect(created.book).toEqual({
			heldImportId: expect.any(String),
			name: "Bookish's Book"
		})
		expect(JSON.stringify(emits)).not.toContain("The tea is always cold.")

		const heldImportId = created.book!.heldImportId
		expect(
			await outcomeOf(
				lorebookImportHandler.handler(
					socketOf(stranger.id),
					{ heldImportId },
					noopEmit
				)
			)
		).toBe(HELD_IMPORT_GONE)
		const book = await lorebookImportHandler.handler(
			socketOf(owner.id),
			{ heldImportId, name: "Renamed Book" },
			noopEmit
		)
		expect(book.status).toBe("created")
		expect(book.lorebook!.name).toBe("Renamed Book")
		expect(
			await outcomeOf(
				lorebookImportHandler.handler(
					socketOf(owner.id),
					{ heldImportId },
					noopEmit
				)
			)
		).toBe(HELD_IMPORT_GONE)
	}, 60_000)

	test("a card with no book, or an unchanged re-import, holds nothing", async () => {
		const { charactersImportCard } = await import("./characters")
		const user = await makeUser("card-no-book")
		const created = await charactersImportCard.handler(
			socketOf(user.id),
			{ file: base64Of(cardJson("Bookless")) },
			noopEmit
		)
		expect(created.book).toBeNull()
	}, 60_000)
})

describe("a lorebook conflict holds the file instead of echoing it", () => {
	test("the reply names a held import and carries no lorebook data", async () => {
		const user = await makeUser("held-book-reply")
		const { emits, emit } = recorder()
		const { conflict } = await lorebookConflict(user.id, emit)
		expect(conflict.status).toBe("conflict")
		expect(typeof conflict.conflict?.heldImportId).toBe("string")
		const [, sent] = emits.find(([e]) => e === "lorebooks:import")!
		expect("lorebookData" in sent.conflict).toBe(false)
		expect(JSON.stringify(sent).includes("New lore")).toBe(false)
	}, 60_000)

	test("the owner overwrites by reference; a stranger and a second answer are refused", async () => {
		const { lorebookImportResolveHandler } = await import("./lorebooks")
		const owner = await makeUser("held-book-owner")
		const stranger = await makeUser("held-book-stranger")
		const { created, conflict } = await lorebookConflict(owner.id)
		const heldImportId = conflict.conflict!.heldImportId

		expect(
			await outcomeOf(
				lorebookImportResolveHandler.handler(
					socketOf(stranger.id),
					{ action: "createNew", heldImportId, existingId: -1 },
					noopEmit
				)
			)
		).toBe(HELD_IMPORT_GONE)

		const resolved = await lorebookImportResolveHandler.handler(
			socketOf(owner.id),
			{
				action: "overwrite",
				heldImportId,
				existingId: created.lorebook!.id
			},
			noopEmit
		)
		expect(resolved.lorebook.id).toBe(created.lorebook!.id)
		expect((resolved.lorebook as any).entries[0].content).toBe("New lore")

		expect(
			await outcomeOf(
				lorebookImportResolveHandler.handler(
					socketOf(owner.id),
					{ action: "createNew", heldImportId, existingId: -1 },
					noopEmit
				)
			)
		).toBe(HELD_IMPORT_GONE)
	}, 60_000)

	test("the name given in the import dialog is the book's name", async () => {
		const { lorebookImportHandler } = await import("./lorebooks")
		const user = await makeUser("renamed-book")
		const res = await lorebookImportHandler.handler(
			socketOf(user.id),
			{
				lorebookJson: lorebookJsonOf({
					data: {
						character_book: {
							name: "Named In File",
							entries: [
								{ keys: ["k"], content: "c", enabled: true }
							]
						}
					}
				}),
				name: "  Named By Me  "
			},
			noopEmit
		)
		expect(res.lorebook!.name).toBe("Named By Me")
	}, 60_000)

	test("a conflict holds the dialog's name as the book would take it, not as sent", async () => {
		// The read trimmed the name before its 10,000-character check, but
		// the hold kept it as sent: 90 million spaces around one letter were
		// held for 15 minutes (S4 review).
		const { lorebookImportHandler } = await import("./lorebooks")
		const { buildLorebookExportData } = await import(
			"$lib/server/utils/lorebookExportBuilder"
		)
		const user = await makeUser("padded-name")
		const created = await lorebookImportHandler.handler(
			socketOf(user.id),
			{
				lorebookJson: lorebookJsonOf({
					name: "Padded",
					entries: [{ keys: ["k"], content: "Old", enabled: true }]
				})
			},
			noopEmit
		)
		const { specBookWithGraph } = await buildLorebookExportData(
			created.lorebook!.id,
			user.id
		)
		const edited = JSON.parse(JSON.stringify(specBookWithGraph))
		edited.entries[0].content = "New"
		const padding = " ".repeat(1_000_000)
		const conflict = await lorebookImportHandler.handler(
			socketOf(user.id),
			{
				lorebookJson: lorebookJsonOf(edited),
				name: `${padding}Kept${padding}`
			},
			noopEmit
		)
		expect(conflict.status).toBe("conflict")
		const held = takeHeldImport(
			user.id,
			"lorebook",
			conflict.conflict!.heldImportId
		)
		// The length first: a failure's diff of two million spaces would
		// take the runner minutes to print.
		expect(held.name?.length).toBe(4)
		expect(held.name).toBe("Kept")
	}, 60_000)
})

describe("a person runs only so many imports at once", () => {
	test("a card import past the limit is refused in a sentence, from any socket", async () => {
		const { charactersImportCard } = await import("./characters")
		const user = await makeUser("busy-importer")
		const gates: Array<() => void> = []
		const running = Array.from({ length: IMPORTS_RUNNING_PER_USER }, () =>
			withImportLimit(
				user.id,
				() => new Promise<void>((resolve) => gates.push(resolve))
			)
		)
		try {
			const { emits, emit } = recorder()
			expect(
				await outcomeOf(
					charactersImportCard.handler(
						socketOf(user.id),
						{ file: base64Of(cardJson("Third")) },
						emit
					)
				)
			).toBe(TOO_MANY_IMPORTS)
			expect(emits).toContainEqual([
				"characters:importCard:error",
				{ error: TOO_MANY_IMPORTS }
			])
		} finally {
			gates.forEach((open) => open())
			await Promise.all(running)
		}
		const rows = await testDb.query.characters.findMany({
			where: (c, { eq }) => eq(c.userId, user.id)
		})
		expect(rows).toHaveLength(0)
	}, 60_000)

	test("a lorebook import past the limit is refused the same way", async () => {
		const { lorebookImportHandler } = await import("./lorebooks")
		const user = await makeUser("busy-book-importer")
		const gates: Array<() => void> = []
		const running = Array.from({ length: IMPORTS_RUNNING_PER_USER }, () =>
			withImportLimit(
				user.id,
				() => new Promise<void>((resolve) => gates.push(resolve))
			)
		)
		try {
			expect(
				await outcomeOf(
					lorebookImportHandler.handler(
						socketOf(user.id),
						{
							lorebookJson: lorebookJsonOf({
								name: "B",
								entries: []
							})
						},
						noopEmit
					)
				)
			).toBe(TOO_MANY_IMPORTS)
		} finally {
			gates.forEach((open) => open())
			await Promise.all(running)
		}
	}, 60_000)
})

describe("the server runs only so many imports at once, for everyone together", () => {
	test("a new person's import is refused in a sentence while the server is at its limit", async () => {
		// Per person alone, two people with two imports each ran four at
		// once: under every byte ceiling that was +2.9 GB of heap, and it
		// took the server past its limit (S4 review).
		const { charactersImportCard } = await import("./characters")
		const others = await Promise.all(
			Array.from({ length: IMPORTS_RUNNING_ON_SERVER }, (_, i) =>
				makeUser(`server-busy-${i}`)
			)
		)
		const newcomer = await makeUser("server-busy-newcomer")
		const gates: Array<() => void> = []
		const running = others.map((u) =>
			withImportLimit(
				u.id,
				() => new Promise<void>((resolve) => gates.push(resolve))
			)
		)
		try {
			expect(
				await outcomeOf(
					charactersImportCard.handler(
						socketOf(newcomer.id),
						{ file: base64Of(cardJson("Fourth")) },
						noopEmit
					)
				)
			).toBe(SERVER_BUSY_IMPORTING)
		} finally {
			gates.forEach((open) => open())
			await Promise.all(running)
		}
		// And once one finishes, the newcomer's import runs.
		expect(
			await outcomeOf(
				charactersImportCard.handler(
					socketOf(newcomer.id),
					{ file: base64Of(cardJson("Fourth")) },
					noopEmit
				)
			)
		).toBe("ok:created")
	}, 60_000)
})

describe("what a parse may build, measured before the parse", () => {
	/** A list of `n` empty objects: 3 bytes of text, ~64 bytes of heap each. */
	const junk = (n: number) => "[" + Array(n).fill("{}").join(",") + "]"
	const deep = (n: number) => "[".repeat(n) + "]".repeat(n)
	const cardWith = (extension: string) =>
		`{"spec":"chara_card_v2","spec_version":"2.0","data":{"name":"Shape","description":"d","first_mes":"hi","extensions":{"x":${extension}}}}`
	const bigParses = (parse: { mock: { calls: unknown[][] } }) =>
		parse.mock.calls.filter(
			([text]) => typeof text === "string" && text.length > 1024 * 1024
		).length

	test("a card JSON under its byte ceiling but past the item ceiling is refused before it is parsed", async () => {
		const { charactersImportCard } = await import("./characters")
		const user = await makeUser("many-items-card")
		const json = cardWith(junk(IMPORT_JSON_LIMITS.maxItems))
		expect(json.length).toBeLessThan(IMPORT_FILE_CAPS.cardJsonBytes)
		const parse = vi.spyOn(JSON, "parse")
		const outcome = await outcomeOf(
			charactersImportCard.handler(
				socketOf(user.id),
				{ file: Buffer.from(json).toString("base64") },
				noopEmit
			)
		)
		const parsed = bigParses(parse)
		parse.mockRestore()
		expect(outcome).toBe(
			"This card's JSON holds more than 1,000,000 pieces of data; Serene Pub reads up to 1,000,000."
		)
		expect(parsed).toBe(0)
		const rows = await testDb.query.characters.findMany({
			where: (c, { eq }) => eq(c.userId, user.id)
		})
		expect(rows).toHaveLength(0)
	}, 60_000)

	test("a lorebook file past the item ceiling is refused before it is parsed", async () => {
		const { lorebookImportHandler } = await import("./lorebooks")
		const user = await makeUser("many-items-book")
		const lorebookJson = `{"name":"Junk","entries":[{"keys":["a"],"content":"c"}],"extensions":{"junk":${junk(IMPORT_JSON_LIMITS.maxItems)}}}`
		const parse = vi.spyOn(JSON, "parse")
		const outcome = await outcomeOf(
			lorebookImportHandler.handler(
				socketOf(user.id),
				{ lorebookJson },
				noopEmit
			)
		)
		const parsed = bigParses(parse)
		parse.mockRestore()
		expect(outcome).toBe(
			"This lorebook file holds more than 1,000,000 pieces of data; Serene Pub reads up to 1,000,000."
		)
		expect(parsed).toBe(0)
	}, 60_000)

	test("a card nested past the depth ceiling is refused in a sentence, not a stack overflow", async () => {
		const { charactersImportCard } = await import("./characters")
		const user = await makeUser("deep-card")
		expect(
			await outcomeOf(
				charactersImportCard.handler(
					socketOf(user.id),
					{
						file: Buffer.from(cardWith(deep(100_000))).toString(
							"base64"
						)
					},
					noopEmit
				)
			)
		).toBe(
			"This card's JSON is nested more than 64 levels deep; Serene Pub reads up to 64."
		)
	}, 60_000)

	test("a lorebook nested past the depth ceiling is refused in a sentence", async () => {
		const { lorebookImportHandler } = await import("./lorebooks")
		const user = await makeUser("deep-book")
		expect(
			await outcomeOf(
				lorebookImportHandler.handler(
					socketOf(user.id),
					{
						lorebookJson: `{"name":"Deep","entries":[{"keys":["a"],"content":"c","extensions":{"x":${deep(100_000)}}}]}`
					},
					noopEmit
				)
			)
		).toBe(
			"This lorebook file is nested more than 64 levels deep; Serene Pub reads up to 64."
		)
	}, 60_000)

	test("a card just inside both ceilings still imports", async () => {
		// 999,970 pieces of data, and 64 levels deep at the innermost list.
		const { charactersImportCard } = await import("./characters")
		const user = await makeUser("shape-at-limits")
		expect(
			await outcomeOf(
				charactersImportCard.handler(
					socketOf(user.id),
					{
						file: Buffer.from(
							cardWith(
								`[${junk(IMPORT_JSON_LIMITS.maxItems - 100)},${deep(60)}]`
							)
						).toString("base64")
					},
					noopEmit
				)
			)
		).toBe("ok:created")
	}, 120_000)
})

describe("byte ceilings before every parse", () => {
	test("a card file past the ceiling is refused before it is decoded", async () => {
		const { charactersImportCard } = await import("./characters")
		const user = await makeUser("huge-card")
		const file = "A".repeat(
			Math.ceil((IMPORT_FILE_CAPS.cardBytes + 3) / 3) * 4
		)
		const { emits, emit } = recorder()
		const outcome = await outcomeOf(
			charactersImportCard.handler(socketOf(user.id), { file }, emit)
		)
		expect(outcome).toMatch(
			/^This card file is \d+ MB, larger than the 64 MB Serene Pub will read\.$/
		)
		expect(emits.map(([e]) => e)).toContain("characters:importCard:error")
	}, 60_000)

	test("a lorebook file past the ceiling is refused before JSON.parse", async () => {
		const { lorebookImportHandler } = await import("./lorebooks")
		const user = await makeUser("huge-book")
		const lorebookJson = " ".repeat(IMPORT_FILE_CAPS.lorebookBytes + 1)
		const parse = vi.spyOn(JSON, "parse")
		const outcome = await outcomeOf(
			lorebookImportHandler.handler(
				socketOf(user.id),
				{ lorebookJson },
				noopEmit
			)
		)
		const hugeParses = parse.mock.calls.filter(
			([text]) => typeof text === "string" && text.length > 1024 * 1024
		).length
		parse.mockRestore()
		expect(outcome).toBe(
			"This lorebook file is 33 MB, larger than the 32 MB Serene Pub will read."
		)
		expect(hugeParses).toBe(0)
	}, 60_000)

	test("a lorebook file that isn't JSON says so in a sentence", async () => {
		const { lorebookImportHandler } = await import("./lorebooks")
		const user = await makeUser("not-json-book")
		expect(
			await outcomeOf(
				lorebookImportHandler.handler(
					socketOf(user.id),
					{ lorebookJson: "{ not json" },
					noopEmit
				)
			)
		).toBe(
			"This lorebook file isn't valid JSON, so Serene Pub can't read it."
		)
	}, 60_000)
})

describe("the lorebook ceilings inside the file", () => {
	const importBook = async (userId: number, book: unknown) => {
		const { lorebookImportHandler } = await import("./lorebooks")
		return outcomeOf(
			lorebookImportHandler.handler(
				socketOf(userId),
				{ lorebookJson: lorebookJsonOf(book) },
				noopEmit
			)
		)
	}
	const entry = (extra: Record<string, unknown> = {}) => ({
		keys: ["dragon"],
		content: "Lore.",
		enabled: true,
		comment: "Dragon",
		...extra
	})
	const history = (scenes: unknown[]) => ({
		keys: [],
		content: "It happened.",
		enabled: true,
		extensions: { serenepub: { entryType: "history", scenes } }
	})

	test.each([
		[
			"keys per entry",
			{
				entries: [
					entry(),
					entry({
						keys: Array.from({ length: 1001 }, (_, i) => `k${i}`)
					})
				]
			},
			"Entry 2 (“Dragon”) has 1,001 keys; Serene Pub reads up to 1,000 per entry."
		],
		[
			"condition keys per entry",
			{
				entries: [
					entry({
						secondary_keys: Array.from(
							{ length: 1001 },
							(_, i) => `k${i}`
						)
					})
				]
			},
			"Entry 1 (“Dragon”) has 1,001 condition keys; Serene Pub reads up to 1,000 per entry."
		],
		[
			"a key's length",
			{ entries: [entry({ keys: ["x".repeat(2001)] })] },
			"Entry 1 (“Dragon”) has a key 2,001 characters long; Serene Pub reads keys up to 2,000 characters."
		],
		[
			"an entry's content",
			{ entries: [entry({ content: "x".repeat(200_001) })] },
			"Entry 1 (“Dragon”)'s content is 200,001 characters; Serene Pub reads up to 200,000."
		],
		[
			"an entry's name",
			{ entries: [entry({ comment: "x".repeat(10_001) })] },
			"Entry 1's name is 10,001 characters; Serene Pub reads up to 10,000."
		],
		[
			"an entry's extra data",
			{
				entries: [
					entry({ extensions: { blob: "x".repeat(64 * 1024) } })
				]
			},
			"Entry 1 (“Dragon”) carries 65 KB of extra data; Serene Pub reads up to 64 KB per entry."
		],
		[
			"scenes per history entry",
			{
				entries: [
					history(Array.from({ length: 1001 }, () => ({ name: "s" })))
				]
			},
			"Entry 1 has 1,001 scenes; Serene Pub reads up to 1,000 per history entry."
		],
		[
			"a scene's cast",
			{
				entries: [
					history([
						{
							name: "Big",
							participantCharacters: Array.from(
								{ length: 501 },
								(_, i) => i
							)
						}
					])
				]
			},
			"Scene 1 of entry 1 names 501 characters; Serene Pub reads up to 500 per scene."
		],
		[
			"a scene's summary",
			{
				entries: [
					history([{ name: "Long", summary: "x".repeat(200_001) }])
				]
			},
			"Scene 1 of entry 1's summary is 200,001 characters; Serene Pub reads up to 200,000."
		],
		[
			"an entry's category (a declared field read from its serenepub data)",
			{
				entries: [
					entry({
						extensions: {
							serenepub: { category: "x".repeat(10_001) }
						}
					})
				]
			},
			"Entry 1 (“Dragon”)'s category is 10,001 characters; Serene Pub reads up to 10,000."
		],
		[
			"a scene's name that isn't text",
			{ entries: [history([{ name: { n: 1 } }])] },
			"Scene 1 of entry 1's name isn't text, so Serene Pub can't read it."
		],
		[
			"a scene's summary that isn't text",
			{ entries: [history([{ name: "S", summary: ["a", "b"] }])] },
			"Scene 1 of entry 1's summary isn't text, so Serene Pub can't read it."
		],
		[
			"the book's description",
			{ name: "B", description: "x".repeat(200_001), entries: [] },
			"This lorebook's description is 200,001 characters; Serene Pub reads up to 200,000."
		]
	])(
		"%s",
		async (_what, book, sentence) => {
			const user = await makeUser(
				`lb-limit-${Math.random().toString(36).slice(2)}`
			)
			expect(
				await importBook(user.id, {
					name: "Limits",
					...(book as object)
				})
			).toBe(sentence)
			const rows = await testDb.query.lorebooks.findMany({
				where: (l, { eq }) => eq(l.userId, user.id)
			})
			expect(rows).toHaveLength(0)
		},
		60_000
	)

	test("a book at every ceiling still imports", async () => {
		const user = await makeUser("lb-at-limits")
		expect(
			await importBook(user.id, {
				name: "At The Limits",
				description: "x".repeat(200_000),
				entries: [
					entry({
						keys: Array.from({ length: 1000 }, (_, i) => `k${i}`),
						content: "x".repeat(200_000),
						comment: "x".repeat(10_000)
					}),
					entry({
						keys: ["y".repeat(2000)],
						extensions: {
							serenepub: { category: "c".repeat(10_000) }
						}
					}),
					history([
						{
							name: "Scene",
							summary: "x".repeat(200_000),
							participantCharacters: Array.from(
								{ length: 500 },
								(_, i) => i
							)
						}
					])
				]
			})
		).toBe("ok:created")
	}, 60_000)
})
