/**
 * 🚧 A lorebook file names its book's rules (owner ruling ★M3b-S5-1,
 * 2026-11-05: "In the book file, beside the story clock"):
 * `extensions.serenepub.primaryRuleset` and an optional `rulesetVersion`.
 * The exporter writes them for a book that is not on Freeform; the importer
 * reads them — a new book takes them, an overwrite takes them when the file
 * names them and keeps its own when it names none.
 */
import { afterAll, beforeAll, describe, expect, test, vi } from "vitest"
import fs from "fs/promises"
import os from "os"
import path from "path"
import { eq } from "drizzle-orm"
import * as schema from "$lib/server/db/schema"
import type { TestDb } from "$lib/server/utils/testDb"
import { releaseDataDir } from "$lib/server/utils/testDb"

vi.setConfig({ testTimeout: 60_000, hookTimeout: 60_000 })

let testDb: TestDb
let dataDir: string

vi.mock("$lib/server/db", async (importOriginal) => {
	const actual = await importOriginal<typeof import("$lib/server/db")>()
	const { createTestDb } = await import("$lib/server/utils/testDb")
	const db = await createTestDb()
	return { ...actual, db }
})
vi.mock("$lib/server/embedding/vectorizationQueue", async (importOriginal) => ({
	...(await importOriginal<object>()),
	autoEnqueueLorebook: vi.fn(async () => {})
}))
vi.mock("$lib/server/annotations/queue", async (importOriginal) => ({
	...(await importOriginal<object>()),
	enqueueLorebookAnnotation: vi.fn(() => {})
}))

beforeAll(async () => {
	dataDir = await fs.mkdtemp(
		path.join(os.tmpdir(), "serene-pub-vitest-bf-book-rules-")
	)
	process.env.SERENE_PUB_DATA_DIR = dataDir
	testDb = (await import("$lib/server/db")).db as unknown as TestDb
}, 60_000)

afterAll(async () => {
	await releaseDataDir(dataDir)
})

const FREEFORM = "core:ruleset/freeform@1"
const VIS = "core:ruleset/vis-itineris@1"
const NONESUCH = "core:ruleset/nonesuch@1"
let n = 0

async function person() {
	const { createTestUser } = await import("$lib/server/utils/testDb")
	return createTestUser(testDb, `book-rules-file-${++n}`)
}

async function book(
	ownerId: number,
	values: Partial<typeof schema.lorebooks.$inferInsert> = {}
) {
	const [row] = await testDb
		.insert(schema.lorebooks)
		.values({ userId: ownerId, name: `Codex ${++n}`, ...values })
		.returning()
	return row
}

async function stored(id: number) {
	const [row] = await testDb
		.select()
		.from(schema.lorebooks)
		.where(eq(schema.lorebooks.id, id))
	return row
}

async function exported(id: number, userId: number) {
	const { buildLorebookExportData } = await import(
		"$lib/server/utils/lorebookExportBuilder"
	)
	return (await buildLorebookExportData(id, userId)).specBookWithGraph as any
}

const plainFile = (name: string, serenepub?: Record<string, unknown>) =>
	JSON.stringify({
		name,
		description: "",
		entries: [],
		...(serenepub ? { extensions: { serenepub } } : {})
	})

const rulesWarning = (w: string) => /plays|was made with version/.test(w)
const quiet = (async () => {}) as any
const as = (id: number) => ({ user: { id } }) as any

describe("the exporter writes a book's rules", () => {
	test("a book on VIS round trips: the file names it, no version, and the import lands on it", async () => {
		const { importLorebookDocument } = await import("./lorebooks")
		const me = await person()
		const other = await person()
		const b = await book(me.id, { primaryRuleset: VIS })
		const file = await exported(b.id, me.id)
		expect(file.extensions.serenepub.primaryRuleset).toBe(VIS)
		expect("rulesetVersion" in file.extensions.serenepub).toBe(false)

		const { book: copy, warnings } = await importLorebookDocument(
			other.id,
			JSON.stringify(file)
		)
		const row = await stored(copy.id)
		expect(row.primaryRuleset).toBe(VIS)
		expect(row.rulesetVersion).toBeNull()
		expect(warnings.filter(rulesWarning)).toEqual([])
	})

	test("a pinned version is written too", async () => {
		const me = await person()
		const b = await book(me.id, {
			primaryRuleset: VIS,
			rulesetVersion: "1.2.0"
		})
		const file = await exported(b.id, me.id)
		expect(file.extensions.serenepub.primaryRuleset).toBe(VIS)
		expect(file.extensions.serenepub.rulesetVersion).toBe("1.2.0")
	})

	test("a Freeform book writes no rules, so its bytes do not move", async () => {
		const me = await person()
		const b = await book(me.id)
		const file = await exported(b.id, me.id)
		expect(
			file.extensions?.serenepub &&
				"primaryRuleset" in file.extensions.serenepub
		).toBeFalsy()
		expect(
			file.extensions?.serenepub &&
				"rulesetVersion" in file.extensions.serenepub
		).toBeFalsy()
	})
})

describe("the importer reads a book's rules", () => {
	test("rules this pub lacks bring the book in on Freeform, said in words", async () => {
		const { importLorebookDocument } = await import("./lorebooks")
		const me = await person()
		const { book: row, warnings } = await importLorebookDocument(
			me.id,
			plainFile("Nonesuch Vale", { primaryRuleset: NONESUCH })
		)
		expect((await stored(row.id)).primaryRuleset).toBe(FREEFORM)
		expect(warnings).toContain(
			`Nonesuch Vale plays ${NONESUCH}, which this pub doesn't have — imported on Freeform.`
		)
	})

	test("a file that names none lands on Freeform with nothing to say", async () => {
		const { importLorebookDocument } = await import("./lorebooks")
		const me = await person()
		const { book: row, warnings } = await importLorebookDocument(
			me.id,
			plainFile("Plain Vale")
		)
		const stored1 = await stored(row.id)
		expect(stored1.primaryRuleset).toBe(FREEFORM)
		expect(stored1.rulesetVersion).toBeNull()
		expect(warnings.filter(rulesWarning)).toEqual([])
	})

	test("a version this pub never kept is dropped, said; a kept one is pinned", async () => {
		const { importLorebookDocument } = await import("./lorebooks")
		const me = await person()
		const unknown = await importLorebookDocument(
			me.id,
			plainFile("Old Vale", {
				primaryRuleset: VIS,
				rulesetVersion: "9.9.9"
			})
		)
		const unknownRow = await stored(unknown.book.id)
		expect(unknownRow.primaryRuleset).toBe(VIS)
		expect(unknownRow.rulesetVersion).toBeNull()
		expect(unknown.warnings).toContain(
			`Old Vale was made with version 9.9.9 of ${VIS}, which this pub doesn't keep — it plays the installed version.`
		)

		// A kept version is a `ruleset_versions` row (keptRulesetDocument's source).
		await testDb
			.insert(schema.rulesets)
			.values({
				rulesetId: VIS,
				ownerSlug: "core",
				label: "Vis Itineris",
				draft: {}
			})
			.onConflictDoNothing()
		await testDb
			.insert(schema.rulesetVersions)
			.values({ rulesetId: VIS, version: "1.2.0", document: {} })
		const kept = await importLorebookDocument(
			me.id,
			plainFile("Kept Vale", {
				primaryRuleset: VIS,
				rulesetVersion: "1.2.0"
			})
		)
		const keptRow = await stored(kept.book.id)
		expect(keptRow.primaryRuleset).toBe(VIS)
		expect(keptRow.rulesetVersion).toBe("1.2.0")
		expect(kept.warnings.filter(rulesWarning)).toEqual([])
	})
})

describe("an overwrite takes a file's rules and keeps its own when the file names none", () => {
	test("Freeform book overwritten by a VIS file is on VIS; a file naming none leaves it there", async () => {
		const { lorebookImportHandler, lorebookImportResolveHandler } =
			await import("./lorebooks")
		const me = await person()
		const b = await book(me.id)
		const base = await exported(b.id, me.id)
		expect(base.extensions.serenepub.uuid).toBeTruthy()

		const withRules = structuredClone(base)
		withRules.extensions.serenepub.primaryRuleset = VIS
		const conflict = await lorebookImportHandler.handler(
			as(me.id),
			{ lorebookJson: JSON.stringify(withRules) },
			quiet
		)
		expect(conflict.status).toBe("conflict")
		await lorebookImportResolveHandler.handler(
			as(me.id),
			{
				heldImportId: conflict.conflict!.heldImportId,
				action: "overwrite",
				existingId: b.id
			},
			quiet
		)
		expect((await stored(b.id)).primaryRuleset).toBe(VIS)

		// A file that names none (same book, one entry's worth of difference).
		const noRules = structuredClone(base)
		noRules.name = "Renamed in the file"
		const again = await lorebookImportHandler.handler(
			as(me.id),
			{ lorebookJson: JSON.stringify(noRules) },
			quiet
		)
		expect(again.status).toBe("conflict")
		await lorebookImportResolveHandler.handler(
			as(me.id),
			{
				heldImportId: again.conflict!.heldImportId,
				action: "overwrite",
				existingId: b.id
			},
			quiet
		)
		const after = await stored(b.id)
		expect(after.name).toBe("Renamed in the file")
		expect(after.primaryRuleset).toBe(VIS)
	})
})

describe("a provided book inherits it through the one importer", () => {
	test("a plugin's book file naming VIS lands on VIS", async () => {
		const { syncProvidedBooks } = await import(
			"$lib/server/plugins/providedBooks"
		)
		const { pluginPackageDirOf } = await import(
			"$lib/server/plugins/packageDir"
		)
		const { declaredPermissions, reviewMarks } = await import(
			"$lib/server/plugins/permissions"
		)
		const { markedBook } = await import("$lib/server/plugins/providedMarks")
		const k = ++n
		const pluginId = `acme.rulesbooks${k}`
		const [admin] = await testDb
			.insert(schema.users)
			.values({ username: `rules-file-admin-${k}`, isAdmin: true })
			.returning()
		const manifest = {
			assets: { dir: "assets" },
			provides: { lorebooks: ["assets/books/world.lorebook.json"] },
			permissions: ["applet:lorebooks:write"]
		}
		await testDb.insert(schema.plugins).values({
			pluginId,
			name: pluginId,
			version: "0.1.0",
			bundleSource: "",
			bundleHash: "x",
			enabled: true,
			enabledBy: admin.id,
			manifest,
			adminDenied: reviewMarks(declaredPermissions(manifest as any))
		} as any)
		const dir = path.join(
			dataDir,
			pluginPackageDirOf(pluginId, "0.1.0"),
			"assets/books"
		)
		await fs.mkdir(dir, { recursive: true })
		await fs.writeFile(
			path.join(dir, "world.lorebook.json"),
			plainFile(`Provided ${k}`, { primaryRuleset: VIS })
		)

		expect(
			(await syncProvidedBooks(testDb as any, pluginId)).imported
		).toEqual(["world"])
		const books = (await testDb.select().from(schema.lorebooks)).filter(
			(b) => markedBook(b.extraJson, b.uuid)?.plugin === pluginId
		)
		expect(books).toHaveLength(1)
		expect(books[0].primaryRuleset).toBe(VIS)
	})
})
