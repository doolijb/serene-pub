/**
 * One import semantics, two doors.
 *
 * `lorebooks:import` runs every entry through `lorebookImportMapper`; the bulk
 * SillyTavern data-directory import used to insert `character_book` entries by
 * hand, which is how it came to write a different row for the same bytes — no
 * `matchMode`, a `useRegex` read off ST's constant `use_regex: true`, a dropped
 * `extensions` bag, and an insertion order clamped into the priority band. Both
 * doors now call the same mapper, and this file is what says so: the same
 * entry, through both, has to land as the same row.
 *
 * The bulk path is driven through its real handlers — start a staging session,
 * write the files into it, execute — rather than by calling the mapper twice,
 * because "the handler calls the mapper" is the entire claim under test.
 *
 * The second divergence this file pins is upstream of the mapper (R7):
 * `lorebooks:import` used to hand its payload to `@lenml/char-card-reader`,
 * whose book constructor splits every key on `[,|;，；]`, so `/foo|bar/i`
 * reached the mapper as `/foo` and `bar/i` — two half-patterns, correctly
 * judged a literal — while the bulk path read the same file's keys intact. The
 * punctuation test below is what says the reader is gone.
 */
import { afterAll, beforeAll, describe, expect, test, vi } from "vitest"
import fs from "fs/promises"
import os from "os"
import path from "path"
import { and, eq } from "drizzle-orm"
import * as schema from "$lib/server/db/schema"
import {
	WORLD_LORE_TYPE_ID,
	joinKeys,
	type SelectLorebookEntry
} from "$lib/server/utils/lorebookEntries"
import type { TestDb } from "$lib/server/utils/testDb"
import { releaseDataDir } from "$lib/server/utils/testDb"

let testDb: TestDb
let dataDir: string

vi.mock("$lib/server/db", async () => {
	const { createTestDb } = await import("$lib/server/utils/testDb")
	const db = await createTestDb()
	return { db }
})

beforeAll(async () => {
	dataDir = await fs.mkdtemp(
		path.join(os.tmpdir(), "serene-pub-import-parity-int-test-")
	)
	process.env.SERENE_PUB_DATA_DIR = dataDir

	const dbModule = await import("$lib/server/db")
	testDb = dbModule.db as unknown as TestDb
}, 60_000)

afterAll(async () => {
	await releaseDataDir(dataDir)
})

const noopEmit = () => {}

/** The bulk import handlers refuse a non-admin, so the socket has to say so. */
function adminSocket(userId: number) {
	return { user: { id: userId, isAdmin: true } } as any
}

async function makeUser(username: string) {
	const { createTestUser } = await import("$lib/server/utils/testDb")
	return createTestUser(testDb, username)
}

/**
 * A SillyTavern `character_book` entry as ST's own exporter writes one.
 *
 * `use_regex: true` is not a mistake in the fixture — ST stamps it on every
 * entry unconditionally (`src/endpoints/characters.js`, commented "ST keys are
 * always regex"), which is the whole reason `useRegexOf` reads the keys instead.
 * The `extensions` bag is the shape that same function writes.
 */
function stCharacterBookEntry(overrides: Record<string, any> = {}) {
	return {
		id: 0,
		keys: ["the Ashguard"],
		secondary_keys: [],
		comment: "Ashguard",
		content: "An order of wardens.",
		constant: false,
		selective: false,
		insertion_order: 100,
		enabled: true,
		position: "before_char",
		use_regex: true,
		case_sensitive: null,
		extensions: {
			position: 0,
			exclude_recursion: false,
			display_index: 0,
			probability: 100,
			useProbability: true,
			depth: 4,
			selectiveLogic: 0,
			group: "",
			group_override: false,
			group_weight: null,
			prevent_recursion: false,
			delay_until_recursion: false,
			scan_depth: null,
			match_whole_words: true,
			use_group_scoring: false,
			case_sensitive: null,
			automation_id: "",
			role: 0,
			vectorized: false,
			sticky: null,
			cooldown: null,
			delay: null
		},
		...overrides
	}
}

function characterCard(name: string, entries: any[]) {
	return {
		spec: "chara_card_v2",
		spec_version: "2.0",
		data: {
			name,
			description: "A warden.",
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
			extensions: {},
			character_book: {
				name: `${name} Lorebook`,
				description: "",
				entries
			}
		}
	}
}

/** Stage `files` into a fresh import session and run the bulk import over it. */
async function runBulkImport(
	userId: number,
	files: Record<string, string>,
	selected: {
		characters?: Array<{ filename: string; name: string }>
		lorebooks?: Array<{ filename: string; name: string }>
	}
) {
	const {
		importStartSillyTavernSession,
		importStageSillyTavernFiles,
		importExecuteSillyTavern
	} = await import("./import")

	const socket = adminSocket(userId)
	const started = await importStartSillyTavernSession.handler(
		socket,
		{},
		noopEmit
	)
	expect(started.success).toBe(true)
	const importSessionId = started.importSessionId!

	const manifest: Array<{ relativePath: string; length: number }> = []
	const chunks: Buffer[] = []
	for (const [relativePath, contents] of Object.entries(files)) {
		const buf = Buffer.from(contents, "utf8")
		manifest.push({ relativePath, length: buf.length })
		chunks.push(buf)
	}
	const staged = await importStageSillyTavernFiles.handler(
		socket,
		{ importSessionId, manifest, blob: Buffer.concat(chunks) },
		noopEmit
	)
	expect(staged.success).toBe(true)

	const result = await importExecuteSillyTavern.handler(
		socket,
		{
			importSessionId,
			selectedData: {
				characters: (selected.characters ?? []).map((c) => ({
					...c,
					selected: true
				})),
				personas: [],
				sessions: [],
				groupSessions: [],
				lorebooks: (selected.lorebooks ?? []).map((l) => ({
					...l,
					selected: true
				}))
			}
		},
		noopEmit
	)
	expect(result.errors ?? []).toEqual([])
	expect(result.success).toBe(true)
	return result
}

/** Every world-lore row of a lorebook, in authored order. */
async function entriesOf(lorebookId: number): Promise<SelectLorebookEntry[]> {
	return testDb
		.select()
		.from(schema.lorebookEntries)
		.where(
			and(
				eq(schema.lorebookEntries.lorebookId, lorebookId),
				eq(schema.lorebookEntries.typeId, WORLD_LORE_TYPE_ID)
			)
		)
		.orderBy(schema.lorebookEntries.position)
}

async function lorebookIdByName(userId: number, name: string) {
	const book = await testDb.query.lorebooks.findFirst({
		where: and(
			eq(schema.lorebooks.userId, userId),
			eq(schema.lorebooks.name, name)
		)
	})
	expect(book, `lorebook "${name}" was not created`).toBeTruthy()
	return book!.id
}

/** Import the same book through `lorebooks:import` and return its rows. */
async function runSingleBookImport(userId: number, book: any) {
	const { lorebookImportHandler } = await import("./lorebooks")
	const res = await lorebookImportHandler.handler(
		{ user: { id: userId } } as any,
		{ lorebookData: book },
		noopEmit
	)
	expect(res.status).toBe("created")
	return entriesOf(res.lorebook!.id)
}

/**
 * The fields the two doors have to agree on.
 *
 * Not the whole row: `id`, `lorebookId`, `createdAt`/`updatedAt` and the
 * lorebook's own name are per-import by definition. Everything below is a fact
 * about the *entry*, and a difference in any of them is a difference in what
 * the file was understood to say.
 */
function comparable(row: SelectLorebookEntry) {
	return {
		title: row.title,
		keys: joinKeys(row.keys),
		secondaryKeys: joinKeys(row.secondaryKeys),
		selectiveLogic: row.selectiveLogic,
		content: row.content,
		enabled: row.enabled,
		constant: row.constant,
		caseSensitive: row.caseSensitive,
		useRegex: row.useRegex,
		matchMode: row.matchMode,
		extraJson: row.extraJson,
		priority: row.fields?.priority ?? null,
		position: row.position
	}
}

describe("SillyTavern import: bulk folder and single book agree", () => {
	test("an embedded character_book lands identically through both doors", async () => {
		const user = await makeUser("st-parity-book")
		const card = characterCard("Vera", [
			stCharacterBookEntry(),
			// A genuinely delimited key: regex by shape, so no declared
			// matchMode and the delimiters are stripped off the stored key.
			stCharacterBookEntry({
				id: 1,
				keys: ["/ash.*guard/i"],
				comment: "Ashguard pattern",
				content: "Anything Ashguard-ish.",
				extensions: {
					...stCharacterBookEntry().extensions,
					match_whole_words: true
				}
			}),
			// Whole-word explicitly declined, and a priority the file
			// really does state, above Serene Pub's 1-3 band.
			stCharacterBookEntry({
				id: 2,
				keys: ["gate"],
				comment: "The Gate",
				content: "A gate of black iron.",
				priority: 9,
				extensions: {
					...stCharacterBookEntry().extensions,
					match_whole_words: false
				}
			})
		])

		await runBulkImport(
			user.id,
			{ "characters/Vera.json": JSON.stringify(card) },
			{ characters: [{ filename: "Vera.json", name: "Vera" }] }
		)
		const bulkRows = await entriesOf(
			await lorebookIdByName(user.id, "Vera Lorebook")
		)

		const singleRows = await runSingleBookImport(
			user.id,
			card.data.character_book
		)

		expect(bulkRows).toHaveLength(3)
		expect(bulkRows.map(comparable)).toEqual(singleRows.map(comparable))

		// And the values themselves, so this cannot pass by both doors
		// being wrong in the same way.
		const [wholeWord, byShape, substring] = bulkRows.map(comparable)

		// Bug 11: a plain key is a literal no matter what `use_regex` says.
		expect(wholeWord.useRegex).toBe(false)
		// Bug 6: ST's declared whole-word intent is recorded.
		expect(wholeWord.matchMode).toBe("word")
		// Bug 14: the foreign extension bag survives the bulk path.
		expect(wholeWord.extraJson).toMatchObject({
			match_whole_words: true,
			exclude_recursion: false,
			probability: 100
		})
		// Bug 14: `insertion_order: 100` is not a priority.
		expect(wholeWord.priority).toBe(1)

		// Regex wins outright, and declares no matchMode.
		expect(byShape.useRegex).toBe(true)
		expect(byShape.matchMode).toBeNull()
		expect(byShape.keys).toBe("ash.*guard")

		expect(substring.matchMode).toBe("substring")
		// A stated priority is honoured, clamped into the supported band.
		expect(substring.priority).toBe(3)
	}, 60_000)

	test("keys carrying commas, pipes and semicolons agree too", async () => {
		const user = await makeUser("st-parity-punctuation")
		const card = characterCard("Ilse", [
			// The defect in one entry: a real regex whose body holds the
			// reader's own delimiter. Split, it was a literal `/foo` + `bar/i`.
			stCharacterBookEntry({
				id: 0,
				keys: ["/ash|guard/i"],
				comment: "Either name",
				content: "Ash or guard."
			}),
			// A literal the reader also split, on a character Serene Pub's own
			// key list does not treat as a separator at all.
			stCharacterBookEntry({
				id: 1,
				keys: ["ward;keeper"],
				comment: "Wardkeeper",
				content: "One word, one key."
			}),
			// A comma is the one case that always agreed, and not by accident:
			// it is Serene Pub's own key separator, so `keysToArray` splits it
			// on the way into the row whichever door the entry came through.
			stCharacterBookEntry({
				id: 2,
				keys: ["Ash, the Warden"],
				comment: "Two keys",
				content: "Comma-separated."
			}),
			// The reader split full-width punctuation as well; nothing in
			// Serene Pub does.
			stCharacterBookEntry({
				id: 3,
				keys: ["名前，別名"],
				comment: "Full width",
				content: "Still one key."
			}),
			// Mixed: one delimited key, one plain. Imports as a literal with
			// its keys verbatim (see useRegexOf) — the point being that the
			// keys it keeps are the file's, not the reader's.
			stCharacterBookEntry({
				id: 4,
				keys: ["/ash|guard/i", "plain"],
				comment: "Mixed",
				content: "Under-matching, visibly."
			})
		])

		await runBulkImport(
			user.id,
			{ "characters/Ilse.json": JSON.stringify(card) },
			{ characters: [{ filename: "Ilse.json", name: "Ilse" }] }
		)
		const bulkRows = await entriesOf(
			await lorebookIdByName(user.id, "Ilse Lorebook")
		)

		const singleRows = await runSingleBookImport(
			user.id,
			card.data.character_book
		)

		expect(bulkRows).toHaveLength(5)
		expect(bulkRows.map(comparable)).toEqual(singleRows.map(comparable))

		const [regex, semicolon, comma, fullWidth, mixed] =
			singleRows.map(comparable)

		// A regex is a regex on both doors now: one key, delimiters stripped.
		expect(regex.useRegex).toBe(true)
		expect(regex.keys).toBe("ash|guard")
		expect(regex.matchMode).toBeNull()

		// One key, spelled as the file spelled it.
		expect(semicolon.useRegex).toBe(false)
		expect(semicolon.keys).toBe("ward;keeper")
		expect(fullWidth.keys).toBe("名前，別名")

		// Two keys — because a comma separates keys here, not because the
		// reader split them.
		expect(comma.keys).toBe("Ash, the Warden")

		// Mixed stays a literal, and keeps the delimited key verbatim.
		expect(mixed.useRegex).toBe(false)
		expect(mixed.keys).toBe("/ash|guard/i, plain")
	}, 60_000)

	test("a condition's keys and mode land identically through both doors", async () => {
		const user = await makeUser("st-parity-condition")
		const card = characterCard("Roone", [
			// ⚠ `NOT_ALL = 1` and `AND_ALL = 3` — the pair nobody guesses, and
			// the reason SELECTIVE_LOGIC_BY_ST_CODE exists. An importer
			// indexing a four-element array in the obvious order lands these
			// two on each other's meaning, silently, on both doors at once.
			stCharacterBookEntry({
				id: 0,
				keys: ["dragon"],
				comment: "Not every warning",
				content: "A dragon, unless every sign is present.",
				secondary_keys: ["statue", "mural"],
				selective: true,
				extensions: {
					...stCharacterBookEntry().extensions,
					selectiveLogic: 1
				}
			}),
			stCharacterBookEntry({
				id: 1,
				keys: ["gate"],
				comment: "Only with both",
				content: "The gate, when both wardens are named.",
				secondary_keys: ["ash", "warden"],
				selective: true,
				extensions: {
					...stCharacterBookEntry().extensions,
					selectiveLogic: 3
				}
			}),
			// SillyTavern's own gate on the condition, and it says no. The
			// keys are still the author's data and still arrive.
			stCharacterBookEntry({
				id: 2,
				keys: ["wyrm"],
				comment: "Condition switched off",
				content: "A wyrm.",
				secondary_keys: ["statue"],
				selective: false
			})
		])

		await runBulkImport(
			user.id,
			{ "characters/Roone.json": JSON.stringify(card) },
			{ characters: [{ filename: "Roone.json", name: "Roone" }] }
		)
		const bulkRows = await entriesOf(
			await lorebookIdByName(user.id, "Roone Lorebook")
		)

		const singleRows = await runSingleBookImport(
			user.id,
			card.data.character_book
		)

		expect(bulkRows).toHaveLength(3)
		expect(bulkRows.map(comparable)).toEqual(singleRows.map(comparable))

		const [notAll, andAll, gated] = bulkRows.map(comparable)

		expect(notAll.secondaryKeys).toBe("statue, mural")
		expect(notAll.selectiveLogic).toBe("notAll")

		expect(andAll.secondaryKeys).toBe("ash, warden")
		expect(andAll.selectiveLogic).toBe("andAll")

		expect(gated.secondaryKeys).toBe("statue")
		expect(gated.selectiveLogic).toBeNull()

		// And the constant ST stamps on every entry it writes — the fixture's
		// own `selectiveLogic: 0`, beside `use_regex: true` — is not a
		// condition on an entry with no condition keys.
		const [plain] = await runSingleBookImport(user.id, {
			name: "Plain",
			entries: [stCharacterBookEntry()]
		})
		expect(plain.selectiveLogic).toBeNull()
		expect(plain.secondaryKeys).toEqual([])
	}, 60_000)

	test("a native World Info file records the intent it declares", async () => {
		const user = await makeUser("st-parity-world")
		const world = {
			name: "Silverwood",
			description: "",
			entries: [
				{
					uid: 0,
					key: ["the Silverwood"],
					keysecondary: [],
					comment: "Silverwood",
					content: "A wood of pale trees.",
					constant: false,
					selective: false,
					order: 100,
					position: 0,
					disable: true,
					caseSensitive: true,
					matchWholeWords: true
				},
				{
					uid: 1,
					key: ["the Hollow"],
					// The native spelling of the condition: `keysecondary`,
					// and the mode as a *top-level* integer rather than the
					// `extensions.selectiveLogic` a character_book carries.
					keysecondary: ["moonlight"],
					selectiveLogic: 2,
					comment: "Hollow",
					content: "A hollow beneath the pale trees.",
					constant: false,
					selective: true,
					order: 100,
					position: 0,
					disable: false,
					caseSensitive: false,
					matchWholeWords: null
				}
			]
		}

		await runBulkImport(
			user.id,
			{ "worlds/Silverwood.json": JSON.stringify(world) },
			{
				lorebooks: [{ filename: "Silverwood.json", name: "Silverwood" }]
			}
		)
		const [row, hollow] = await entriesOf(
			await lorebookIdByName(user.id, "Silverwood")
		)

		// The native shape's own names, read as the facts they are.
		expect(row.title).toBe("Silverwood")
		expect(joinKeys(row.keys)).toBe("the Silverwood")
		expect(row.enabled).toBe(false)
		expect(row.caseSensitive).toBe(true)
		// Bug 6, through the native spelling of the same flag.
		expect(row.matchMode).toBe("word")
		expect(row.useRegex).toBe(false)
		// `order` is an insertion index, not a priority band — the file
		// declares no priority, so the entry takes the mapper's default,
		// which is what `lorebooks:import` gives the same file.
		expect(row.fields?.priority).toBe(1)
		// The first entry declares no condition at all — `keysecondary: []`
		// with `selective: false` — and gets none.
		expect(joinKeys(row.secondaryKeys)).toBe("")
		expect(row.selectiveLogic).toBeNull()

		// The second declares one, in the native spelling of both halves.
		expect(joinKeys(hollow.secondaryKeys)).toBe("moonlight")
		expect(hollow.selectiveLogic).toBe("notAny")
	}, 60_000)
})
