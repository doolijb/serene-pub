/**
 * A Library import (`characters:importFromLibrary`) under the same import
 * limit as a file import, with the fetch inside it (S4 review).
 *
 * The fetch and the source's own full parse ran BEFORE any limit, the bytes
 * were then base64-encoded only to be decoded again by the file-import
 * handler, and a refusal on that path reached the person as "Failed to import
 * character from library" instead of its own sentence.
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
import {
	IMPORTS_RUNNING_PER_USER,
	TOO_MANY_IMPORTS,
	withImportLimit
} from "$lib/server/imports/importLimit"

let testDb: TestDb
let dataDir: string
let fetches = 0
let fetchedBuffer: Buffer

vi.mock("$lib/server/db", async () => {
	const { createTestDb } = await import("$lib/server/utils/testDb")
	const db = await createTestDb()
	return { db }
})

// The network half is not under test: the import cache hands back a
// controlled card and counts that it was asked.
vi.mock("$lib/server/cardSources/importCache", () => ({
	getOrFetchImportedCardBytes: async () => {
		fetches++
		return fetchedBuffer
	}
}))
vi.mock("$lib/server/cardSources/diskCache", () => ({
	getOrFetchCardBytes: async () => {
		fetches++
		return fetchedBuffer
	}
}))

// Wrapped, not replaced, so the counts below are of the real functions.
vi.mock("$lib/server/utils/characterCardParser", async (importOriginal) => {
	const actual =
		await importOriginal<
			typeof import("$lib/server/utils/characterCardParser")
		>()
	return {
		...actual,
		decodeCardFileBase64: vi.fn(actual.decodeCardFileBase64)
	}
})

beforeAll(async () => {
	dataDir = await fs.mkdtemp(
		path.join(os.tmpdir(), "serene-pub-library-import-int-test-")
	)
	process.env.SERENE_PUB_DATA_DIR = dataDir
	const dbModule = await import("$lib/server/db")
	testDb = dbModule.db as unknown as TestDb
}, 60_000)

afterAll(async () => {
	await releaseDataDir(dataDir)
})

afterEach(() => {
	fetches = 0
	vi.clearAllMocks()
})

const socketOf = (userId: number) =>
	({ user: { id: userId }, id: `s${userId}` }) as any

function recorder() {
	const emits: Array<[string, any]> = []
	const emit = (event: string, data: any) => {
		emits.push([event, typeof data === "function" ? undefined : data])
	}
	return { emits, emit }
}

const cardBytes = (name: string) =>
	Buffer.from(
		JSON.stringify({
			spec: "chara_card_v2",
			spec_version: "2.0",
			data: {
				name,
				description: "From the Library",
				first_mes: "Hello.",
				tags: [],
				extensions: {}
			}
		})
	)

const outcomeOf = (work: Promise<any>) =>
	work.then(
		(res) => `ok:${res?.character?.name ?? "done"}`,
		(e) => String(e?.message ?? e)
	)

const params = {
	source: "charavault",
	ref: { folder: "f", file: "g.png" }
} as any

describe("a Library import runs under the import limit", () => {
	test("past the limit it is refused in its own sentence, before anything is fetched", async () => {
		const { charactersImportFromLibrary } = await import("./characters")
		const { createTestUser } = await import("$lib/server/utils/testDb")
		const user = await createTestUser(testDb, "library-busy")
		fetchedBuffer = cardBytes("Busy")
		const gates: Array<() => void> = []
		const running = Array.from({ length: IMPORTS_RUNNING_PER_USER }, () =>
			withImportLimit(
				user.id,
				() => new Promise<void>((resolve) => gates.push(resolve))
			)
		)
		const { emits, emit } = recorder()
		try {
			expect(
				await outcomeOf(
					charactersImportFromLibrary.handler(
						socketOf(user.id),
						params,
						emit
					)
				)
			).toBe(TOO_MANY_IMPORTS)
		} finally {
			gates.forEach((open) => open())
			await Promise.all(running)
		}
		expect(fetches).toBe(0)
		expect(emits).toContainEqual([
			"characters:importFromLibrary:error",
			{ error: TOO_MANY_IMPORTS }
		])
	}, 60_000)

	test("the fetched bytes are imported as they are — never base64 and back", async () => {
		const { charactersImportFromLibrary } = await import("./characters")
		const { decodeCardFileBase64 } = await import(
			"$lib/server/utils/characterCardParser"
		)
		const { createTestUser } = await import("$lib/server/utils/testDb")
		const user = await createTestUser(testDb, "library-direct")
		fetchedBuffer = cardBytes("Straight Through")
		expect(
			await outcomeOf(
				charactersImportFromLibrary.handler(
					socketOf(user.id),
					params,
					() => {}
				)
			)
		).toBe("ok:Straight Through")
		expect(fetches).toBe(1)
		expect(decodeCardFileBase64).not.toHaveBeenCalled()
	}, 60_000)

	test("a card the import refuses reaches the person as that sentence", async () => {
		const { charactersImportFromLibrary } = await import("./characters")
		const { createTestUser } = await import("$lib/server/utils/testDb")
		const user = await createTestUser(testDb, "library-nameless")
		fetchedBuffer = Buffer.from(
			JSON.stringify({
				spec: "chara_card_v2",
				spec_version: "2.0",
				data: { name: "" }
			})
		)
		const { emits, emit } = recorder()
		await outcomeOf(
			charactersImportFromLibrary.handler(socketOf(user.id), params, emit)
		)
		expect(emits).toContainEqual([
			"characters:importFromLibrary:error",
			{
				error: "This file doesn't look like a valid character card — no character name was found."
			}
		])
	}, 60_000)

	test("opening a Library card's details counts too", async () => {
		// A detail view fetches up to a whole card file and parses it — an
		// import's memory, with no limit before (S4 review).
		const { charaVaultSource } = await import(
			"$lib/server/cardSources/charaVault/charaVaultSource"
		)
		const { createTestUser } = await import("$lib/server/utils/testDb")
		const user = await createTestUser(testDb, "library-detail-busy")
		fetchedBuffer = cardBytes("Detail")
		const gates: Array<() => void> = []
		const running = Array.from({ length: IMPORTS_RUNNING_PER_USER }, () =>
			withImportLimit(
				user.id,
				() => new Promise<void>((resolve) => gates.push(resolve))
			)
		)
		try {
			await expect(
				charaVaultSource.getCardDetail!(params.ref, { userId: user.id })
			).rejects.toThrow(TOO_MANY_IMPORTS)
		} finally {
			gates.forEach((open) => open())
			await Promise.all(running)
		}
		expect(fetches).toBe(0)
		await expect(
			charaVaultSource.getCardDetail!(params.ref, { userId: user.id })
		).resolves.toMatchObject({ description: "From the Library" })
	}, 60_000)
})
