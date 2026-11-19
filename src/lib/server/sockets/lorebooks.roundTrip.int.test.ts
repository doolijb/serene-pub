/**
 * The lorebook round trip, measured (lane io-1, phase 1: measurement only).
 *
 * One rich book is seeded, then sent through export → import as a new book,
 * duplicate, and overwrite import. Each copy is compared with the original
 * field by field, every id replaced by the label of the row it points at, and
 * every difference is listed by table, row label and column. The tests are
 * expected to report differences today; a guard fails when a table the book
 * owns gains a column the comparison has not classified.
 */

import { afterAll, beforeAll, describe, expect, test, vi } from "vitest"
import fs from "fs/promises"
import os from "os"
import path from "path"
import { PNG } from "pngjs"
import { and, eq, getTableColumns, inArray, isNull, or } from "drizzle-orm"
import { getTableConfig, type PgTable } from "drizzle-orm/pg-core"
import * as schema from "$lib/server/db/schema"
import {
	LOREBOOK_TABLES,
	bookStatOwners
} from "$lib/server/lorebooks/tableRegistry"
import {
	ITEM_TYPE_ID,
	LOCATION_TYPE_ID,
	entryInsert
} from "$lib/server/utils/lorebookEntries"
import type { TestDb } from "$lib/server/utils/testDb"
import { releaseDataDir } from "$lib/server/utils/testDb"

vi.setConfig({ testTimeout: 60_000, hookTimeout: 60_000 })

let testDb: TestDb
let dataDir: string

vi.mock("$lib/server/db", async () => {
	const { createTestDb, testDbModule } = await import(
		"$lib/server/utils/testDb"
	)
	return testDbModule(await createTestDb())
})
// An import queues vectorization and annotation of the new book's entries;
// those rows are derived, never compared, and must not appear mid-test.
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
		path.join(os.tmpdir(), "serene-pub-vitest-io1-round-trip-")
	)
	process.env.SERENE_PUB_DATA_DIR = dataDir
	testDb = (await import("$lib/server/db")).db as unknown as TestDb
}, 60_000)

afterAll(async () => {
	await releaseDataDir(dataDir)
})

let userCount = 0
async function makeUser(prefix: string) {
	const { createTestUser } = await import("$lib/server/utils/testDb")
	return createTestUser(testDb, `${prefix}-${++userCount}`)
}

const fakeSocket = (userId: number) => ({ user: { id: userId } }) as any
const noopEmit = () => {}

// ── Column classification ───────────────────────────────────────────────────

/** `"compare"`, or the reason the column is not compared. */
type Classification = "compare" | (string & {})
const C = "compare" as const
const OWN_ID = "the row's own id"
const BOOK_KEY = "the book's own id, the row's own table key"
const STAMP = "timestamp, set when the row is written"
const VECTOR = "an embedding the import recomputes"
const HASH = "a hash of derived data the import recomputes"
const PER_PATH = "per path: handled by the tests, not by the diff"

/**
 * Every column (drizzle property name) of the book row and of every table in
 * `LOREBOOK_TABLES`, keyed by the table's SQL name. `diffSnapshots` compares
 * exactly the `"compare"` columns. A column nobody has classified fails the
 * guard test by name. Where it was not obvious whether a column should be
 * compared it is marked `"compare"` (see the report: `lorebook_entries.position`,
 * `character_versions.writeOrder` / `retiredOrder` as ranks).
 */
const COLUMNS: Record<string, Record<string, Classification>> = {
	lorebooks: {
		id: OWN_ID,
		uuid: PER_PATH,
		name: PER_PATH,
		description: C,
		coverMediaId: C,
		loreWriteMode: C,
		kind: C,
		extraJson: C,
		userId: PER_PATH,
		nextBindingNumber: C,
		storyCalendar: C,
		timelineEnabled: C,
		storyClockYear: C,
		storyClockMonth: C,
		storyClockDay: C,
		storyClockHour: C,
		storyClockMinute: C,
		primaryRuleset: C,
		rulesetVersion: C,
		sessionId: C,
		overlayOf: C,
		surfacedFromSessionId: C,
		annex: C,
		annexAudiences: C,
		annexVersions: C,
		createdAt: STAMP,
		updatedAt: STAMP
	},
	lorebook_branches: {
		id: OWN_ID,
		lorebookId: BOOK_KEY,
		name: C,
		forkedFromBranchId: C,
		forkYear: C,
		forkMonth: C,
		forkDay: C,
		storyClockYear: C,
		storyClockMonth: C,
		storyClockDay: C,
		storyClockHour: C,
		storyClockMinute: C,
		createdAt: STAMP,
		updatedAt: STAMP
	},
	lorebook_bindings: {
		id: OWN_ID,
		lorebookId: BOOK_KEY,
		characterId: C,
		binding: C,
		sceneId: C,
		historyEntryId: C,
		name: C,
		nodeState: C,
		nodeVisibility: C,
		aliases: C,
		absorbedAliases: C,
		summary: C,
		spriteSet: C,
		description: C,
		personality: C,
		scenario: C,
		firstMessage: C,
		alternateGreetings: C,
		exampleDialogues: C,
		faceMediaId: C,
		retold: C,
		ownName: C,
		ownNickname: C,
		embedding: VECTOR,
		embeddingModel: VECTOR,
		embeddingSourceHash: HASH,
		embedTextHash: HASH,
		vectorizedAt: VECTOR,
		parentNodeId: C,
		overlayOf: C,
		timbre: C,
		castMemberLock: C,
		createdBy: "a user id: never exported or compared",
		createdAt: STAMP,
		updatedAt: STAMP
	},
	lorebook_entries: {
		id: OWN_ID,
		lorebookId: BOOK_KEY,
		typeId: C,
		typeVersion: C,
		keys: C,
		matchMode: C,
		useRegex: C,
		caseSensitive: C,
		secondaryKeys: C,
		selectiveLogic: C,
		recursionDepth: C,
		content: C,
		constant: C,
		enabled: C,
		archived: C,
		decayRate: C,
		entryLock: C,
		notCommonKnowledge: C,
		provenance: C,
		position: C,
		title: C,
		embedTextHash: HASH,
		annotationTextHash: HASH,
		anchorBindingId: C,
		anchorEntryId: C,
		branchId: C,
		fields: C,
		derivedFrom: C,
		sourceMessageId: C,
		extraJson: C,
		createdAt: STAMP,
		updatedAt: STAMP
	},
	lorebook_entry_vectors: {
		entryId: C,
		vectorName: C,
		chunkIndex: C,
		model: VECTOR,
		modelVersion: VECTOR,
		normalization: VECTOR,
		dims: VECTOR,
		vector: VECTOR,
		sourceHash: HASH,
		extractorVersion: HASH,
		gazetteerHash: HASH,
		chunkMeta: VECTOR,
		vectorizedAt: VECTOR
	},
	entry_annotations: {
		entryId: C,
		entityKey: C,
		surface: C,
		normalized: C,
		tier: C,
		characterId: C,
		refEntryId: C,
		confidence: "derived annotation score the import recomputes",
		mentions: "derived annotation data the import recomputes",
		spans: "derived annotation data the import recomputes",
		extractorVersion: HASH,
		sourceHash: HASH,
		gazetteerHash: HASH,
		entityModel: "derived annotation data the import recomputes",
		entityLabel: "derived annotation data the import recomputes",
		annotatedAt: STAMP
	},
	lore_redlines: {
		id: OWN_ID,
		entryId: C,
		characterVersionId: C,
		sceneId: C,
		amendmentId: C,
		changes: C,
		cause: C,
		userId: "who made the edit; per path",
		sessionId: C,
		messageId: C,
		runId: C,
		shownAs: C,
		createdAt: STAMP
	},
	scenes: {
		id: OWN_ID,
		sessionId: C,
		lorebookId: BOOK_KEY,
		historyEntryId: C,
		name: C,
		nameIsDefault: C,
		sceneLock: C,
		selectedMessageIds: C,
		summary: C,
		castResolvedAt: STAMP,
		embedding: VECTOR,
		embeddingModel: VECTOR,
		graphed: C,
		branchId: C,
		channel: C,
		openedAtMessageId: C,
		closedAtMessageId: C,
		openedStoryClockYear: C,
		openedStoryClockMonth: C,
		openedStoryClockDay: C,
		openedStoryClockHour: C,
		openedStoryClockMinute: C,
		closedStoryClockYear: C,
		closedStoryClockMonth: C,
		closedStoryClockDay: C,
		closedStoryClockHour: C,
		closedStoryClockMinute: C,
		summaryStatus: C,
		processedBySpecId: C,
		summaryOrigin: C,
		notes: C,
		createdAt: STAMP,
		updatedAt: STAMP
	},
	scene_characters: {
		id: OWN_ID,
		sceneId: C,
		bindingId: C,
		role: C,
		ordinal: C
	},
	narrative_relationships: {
		id: OWN_ID,
		lorebookId: BOOK_KEY,
		fromNodeId: C,
		toNodeId: C,
		fromEntryId: C,
		toEntryId: C,
		historyEntryId: C,
		sceneId: C,
		relationshipType: C,
		description: C,
		title: C,
		reverseRelationshipType: C,
		knowledgeKind: C,
		rulesRunId: C,
		visibility: C,
		status: C,
		reason: C,
		branchId: C,
		embedding: VECTOR,
		embeddingModel: VECTOR,
		embeddingSourceHash: HASH,
		vectorizedAt: VECTOR,
		createdAt: STAMP,
		updatedAt: STAMP
	},
	entry_amendments: {
		id: OWN_ID,
		lorebookId: BOOK_KEY,
		entryId: C,
		branchId: C,
		year: C,
		month: C,
		day: C,
		sourceMessageId: C,
		base: C,
		fields: C,
		historyEntryId: C,
		createdAt: STAMP,
		updatedAt: STAMP
	},
	cast_amendments: {
		id: OWN_ID,
		lorebookBindingId: C,
		lorebookId: BOOK_KEY,
		branchId: C,
		year: C,
		month: C,
		day: C,
		personalPosition: C,
		fields: C,
		historyEntryId: C,
		createdAt: STAMP,
		updatedAt: STAMP
	},
	character_versions: {
		id: OWN_ID,
		cardId: C,
		castMemberId: C,
		number: C,
		label: C,
		parentVersionId: C,
		lorebookId: BOOK_KEY,
		branchId: C,
		year: C,
		month: C,
		day: C,
		historyEntryId: C,
		atHour: C,
		atMinute: C,
		personalPosition: C,
		sourceSessionId: C,
		sourceMessageId: C,
		writtenBy: C,
		note: C,
		liftedFromAmendmentId: C,
		validFromMessageId: C,
		writeOrder: C,
		retiredOrder: C,
		name: C,
		nickname: C,
		aliases: C,
		summary: C,
		description: C,
		personality: C,
		scenario: C,
		greetings: C,
		exampleDialogues: C,
		postHistoryInstructions: C,
		creatorNotes: C,
		strokes: C,
		faceMediaId: C,
		likeness: C,
		timbre: C,
		spriteSet: C,
		extensions: C,
		nodeState: C,
		nodeVisibility: C,
		follows: C,
		createdAt: STAMP,
		updatedAt: STAMP
	},
	cast_presences: {
		id: OWN_ID,
		lorebookBindingId: C,
		lorebookId: BOOK_KEY,
		branchId: C,
		personalPosition: C,
		fromYear: C,
		fromMonth: C,
		fromDay: C,
		untilYear: C,
		untilMonth: C,
		untilDay: C,
		note: C,
		createdAt: STAMP,
		updatedAt: STAMP
	},
	sprite_sets: {
		id: OWN_ID,
		characterId: C,
		castMemberId: C,
		name: C,
		isDefault: C,
		position: C,
		createdAt: STAMP
	},
	sprites: {
		id: OWN_ID,
		spriteSetId: C,
		label: C,
		position: C,
		fileId: C,
		source: C,
		createdAt: STAMP
	},
	cast_member_files: {
		id: OWN_ID,
		castMemberId: C,
		fileId: C,
		position: C,
		createdAt: STAMP
	},
	lorebook_tags: {
		lorebookId: BOOK_KEY,
		tagId: C
	},
	dismissed_duplicate_pairs: {
		id: OWN_ID,
		lorebookId: BOOK_KEY,
		bindingIdA: C,
		bindingIdB: C,
		createdAt: STAMP
	},
	binding_suggestions: {
		id: OWN_ID,
		lorebookId: BOOK_KEY,
		entityKey: C,
		surface: C,
		status: C,
		occurrences: C,
		sourceCount: C,
		firstSeenAt: STAMP,
		lastSeenAt: STAMP,
		exampleContext: C,
		exampleSourceKind: C,
		exampleSourceId: C,
		resolvedBindingId: C,
		decidedAt: STAMP,
		createdAt: STAMP,
		updatedAt: STAMP
	},
	binding_merge_logs: {
		id: OWN_ID,
		lorebookId: BOOK_KEY,
		userId: "who merged; per path",
		survivorId: C,
		absorbedSnapshot: C,
		relationshipRewrites: C,
		deletedRelationships: C,
		sceneSnapshots: C,
		absorbedAliasesAdded: C,
		reassignedCharacterLoreEntryIds: C,
		reassignedChildNodeIds: C,
		tagRewrites: C,
		createdAt: STAMP
	},
	attribute_configs: {
		id: OWN_ID,
		ownerKind: C,
		ownerId: C,
		slotId: C,
		config: C,
		sessionId: C,
		validFromMessageId: C,
		updatedBy: C,
		branchId: C,
		historyEntryId: C,
		sceneId: C,
		sourceSessionId: C,
		sourceMessageId: C,
		note: C,
		createdAt: STAMP
	},
	attribute_values: {
		id: OWN_ID,
		ownerKind: C,
		ownerId: C,
		slotId: C,
		value: C,
		sessionId: C,
		validFromMessageId: C,
		updatedBy: C,
		branchId: C,
		historyEntryId: C,
		sceneId: C,
		sourceSessionId: C,
		sourceMessageId: C,
		note: C,
		stateVersion: C,
		storyClockYear: C,
		storyClockMonth: C,
		storyClockDay: C,
		storyClockHour: C,
		storyClockMinute: C,
		createdAt: STAMP
	},
	owner_sheets: {
		id: OWN_ID,
		ownerKind: C,
		ownerId: C,
		sheetId: C,
		sessionId: C,
		position: C,
		createdAt: STAMP
	}
}

/** What an id column points at, so the snapshot can replace it by a label. */
type RefKind =
	| "branch"
	| "member"
	| "entry"
	| "scene"
	| "file"
	| "card"
	| "cardVersion"
	| "spriteSet"
	| "version"
	| "amendment"
	| "tag"
	| "owner"
	| "entityKey"
	| "exampleSource"
	| "foreign"

/**
 * Per table, the compared columns that hold an id. A compared column that is
 * a foreign key and is missing here fails the guard: an id would be compared
 * raw, and a copy never has the original's ids.
 */
const REFS: Record<string, Record<string, RefKind>> = {
	lorebooks: {
		coverMediaId: "file",
		sessionId: "foreign",
		overlayOf: "foreign",
		surfacedFromSessionId: "foreign"
	},
	lorebook_branches: { forkedFromBranchId: "branch" },
	lorebook_bindings: {
		characterId: "card",
		sceneId: "scene",
		historyEntryId: "entry",
		faceMediaId: "file",
		parentNodeId: "member",
		overlayOf: "member"
	},
	lorebook_entries: {
		anchorBindingId: "member",
		anchorEntryId: "entry",
		branchId: "branch",
		sourceMessageId: "foreign"
	},
	lorebook_entry_vectors: { entryId: "entry" },
	entry_annotations: {
		entryId: "entry",
		entityKey: "entityKey",
		characterId: "card",
		refEntryId: "entry"
	},
	lore_redlines: {
		entryId: "entry",
		characterVersionId: "version",
		sceneId: "scene",
		amendmentId: "amendment",
		sessionId: "foreign",
		messageId: "foreign"
	},
	scenes: {
		sessionId: "foreign",
		historyEntryId: "entry",
		branchId: "branch",
		openedAtMessageId: "foreign",
		closedAtMessageId: "foreign"
	},
	scene_characters: { sceneId: "scene", bindingId: "member" },
	narrative_relationships: {
		fromNodeId: "member",
		toNodeId: "member",
		fromEntryId: "entry",
		toEntryId: "entry",
		historyEntryId: "entry",
		sceneId: "scene",
		branchId: "branch"
	},
	entry_amendments: {
		entryId: "entry",
		branchId: "branch",
		sourceMessageId: "foreign",
		historyEntryId: "entry"
	},
	cast_amendments: {
		lorebookBindingId: "member",
		branchId: "branch",
		historyEntryId: "entry"
	},
	character_versions: {
		cardId: "card",
		castMemberId: "member",
		parentVersionId: "cardVersion",
		branchId: "branch",
		historyEntryId: "entry",
		sourceSessionId: "foreign",
		sourceMessageId: "foreign",
		liftedFromAmendmentId: "amendment",
		validFromMessageId: "foreign",
		faceMediaId: "file"
	},
	cast_presences: { lorebookBindingId: "member", branchId: "branch" },
	sprite_sets: { characterId: "card", castMemberId: "member" },
	sprites: { spriteSetId: "spriteSet", fileId: "file" },
	cast_member_files: { castMemberId: "member", fileId: "file" },
	lorebook_tags: { tagId: "tag" },
	dismissed_duplicate_pairs: { bindingIdA: "member", bindingIdB: "member" },
	binding_suggestions: {
		exampleSourceId: "exampleSource",
		resolvedBindingId: "member"
	},
	binding_merge_logs: { survivorId: "member" },
	attribute_configs: {
		ownerId: "owner",
		sessionId: "foreign",
		validFromMessageId: "foreign",
		branchId: "branch",
		historyEntryId: "entry",
		sceneId: "scene",
		sourceSessionId: "foreign",
		sourceMessageId: "foreign"
	},
	attribute_values: {
		ownerId: "owner",
		sessionId: "foreign",
		validFromMessageId: "foreign",
		branchId: "branch",
		historyEntryId: "entry",
		sceneId: "scene",
		sourceSessionId: "foreign",
		sourceMessageId: "foreign"
	},
	owner_sheets: { ownerId: "owner", sessionId: "foreign" }
}

/**
 * Foreign keys into a shared catalogue, whose ids are stable text and the same
 * in every book: compared as they are, so they need no ref kind.
 */
const CATALOGUE_FKS = new Set([
	"lorebook_entries.typeId",
	"lorebook_entries.typeVersion",
	"owner_sheets.sheetId"
])

const nameOf = (t: PgTable) => getTableConfig(t).name
const BOOK_TABLE_LIST: Array<{ name: string; table: PgTable }> = [
	{ name: "lorebooks", table: schema.lorebooks },
	...LOREBOOK_TABLES.map((s) => ({ name: nameOf(s.table), table: s.table }))
]

describe("the lorebook comparison's column classification", () => {
	test("every column of the book row and of every table the book owns is classified, and every classified column exists", () => {
		const problems: string[] = []
		for (const { name, table } of BOOK_TABLE_LIST) {
			const real = Object.keys(getTableColumns(table))
			const classified = COLUMNS[name]
			if (!classified) {
				problems.push(`${name}: table is not classified at all`)
				continue
			}
			for (const column of real)
				if (!(column in classified))
					problems.push(`${name}.${column}: not classified`)
			for (const column of Object.keys(classified))
				if (!real.includes(column))
					problems.push(
						`${name}.${column}: classified but not a column`
					)
		}
		for (const name of Object.keys(COLUMNS))
			if (!BOOK_TABLE_LIST.some((t) => t.name === name))
				problems.push(`${name}: classified but not a book table`)
		expect(problems).toEqual([])
	})

	test("a compared column that is a foreign key names what it points at", () => {
		const problems: string[] = []
		for (const { name, table } of BOOK_TABLE_LIST) {
			const columns = getTableColumns(table)
			const byDbName = new Map(
				Object.entries(columns).map(([prop, col]) => [col.name, prop])
			)
			for (const fk of getTableConfig(table).foreignKeys)
				for (const col of fk.reference().columns) {
					const prop = byDbName.get(col.name)
					if (!prop || COLUMNS[name]?.[prop] !== C) continue
					if (
						!REFS[name]?.[prop] &&
						!CATALOGUE_FKS.has(`${name}.${prop}`)
					)
						problems.push(
							`${name}.${prop}: compared foreign key has no ref kind`
						)
				}
			for (const prop of Object.keys(REFS[name] ?? {}))
				if (COLUMNS[name]?.[prop] !== C)
					problems.push(
						`${name}.${prop}: ref kind on a column that is not compared`
					)
		}
		expect(problems).toEqual([])
	})
})

// ── Snapshot ────────────────────────────────────────────────────────────────

interface SnapRow {
	label: string
	/** `main`, a line's name, or null for a row that stands on no line. */
	line: string | null
	values: Record<string, unknown>
}
type Snapshot = Record<string, SnapRow[]>

const asRows = (rows: unknown): any[] => rows as any[]

/** Every row of the book, every id replaced by the label of the row it points at (`FOREIGN:<id>` outside the book). */
async function snapshotBook(bookId: number): Promise<Snapshot> {
	const all = async (table: PgTable) =>
		asRows(await testDb.select().from(table as any))
	const where = async (table: PgTable, condition: any) =>
		asRows(
			await testDb
				.select()
				.from(table as any)
				.where(condition)
		)
	const inList = async (table: PgTable, column: any, ids: number[]) =>
		ids.length ? where(table, inArray(column, ids)) : []

	// Labels that cross books: a card by its name, a file by its hash, a tag by its name.
	const cards = new Map<number, string>(
		(await all(schema.characters)).map((c) => [c.id, `card:${c.name}`])
	)
	const files = new Map<number, string>(
		(await all(schema.files)).map((f) => [
			f.id,
			`file:${String(f.hash).slice(0, 12)}`
		])
	)
	const tags = new Map<number, string>(
		(await all(schema.tags)).map((t) => [t.id, `tag:${t.name}`])
	)
	const cardVersions = new Map<number, string>(
		(await all(schema.characterVersions))
			.filter((v) => v.cardId != null)
			.map((v) => [
				v.id,
				`cardVersion:${cards.get(v.cardId) ?? v.cardId}#${v.number}`
			])
	)

	const unique = (
		labels: Map<number, string>,
		rows: any[],
		make: (r: any) => string
	) => {
		const seen = new Map<string, number>()
		for (const r of [...rows].sort((a, b) => a.id - b.id)) {
			const base = make(r)
			const n = (seen.get(base) ?? 0) + 1
			seen.set(base, n)
			labels.set(r.id, n === 1 ? base : `${base} #${n}`)
		}
	}
	const dayOf = (r: any, y = "year", m = "month", d = "day") =>
		`${r[y] ?? "-"}-${r[m] ?? "-"}-${r[d] ?? "-"}`

	const [book] = await where(
		schema.lorebooks,
		eq(schema.lorebooks.id, bookId)
	)
	const branches = await where(
		schema.lorebookBranches,
		eq(schema.lorebookBranches.lorebookId, bookId)
	)
	const members = await where(
		schema.lorebookBindings,
		eq(schema.lorebookBindings.lorebookId, bookId)
	)
	const entries = await where(
		schema.lorebookEntries,
		eq(schema.lorebookEntries.lorebookId, bookId)
	)
	const scenes = await where(
		schema.scenes,
		eq(schema.scenes.lorebookId, bookId)
	)
	const amendments = await where(
		schema.entryAmendments,
		eq(schema.entryAmendments.lorebookId, bookId)
	)
	const versions = await where(
		schema.characterVersions,
		eq(schema.characterVersions.lorebookId, bookId)
	)

	const branchL = new Map<number, string>()
	unique(branchL, branches, (b) => `branch:${b.name}`)
	const lineOf = (branchId: number | null | undefined) =>
		branchId == null
			? "main"
			: (branchL.get(branchId) ?? `FOREIGN:${branchId}`).replace(
					/^branch:/,
					""
				)
	const memberL = new Map<number, string>()
	unique(memberL, members, (m) => {
		const card = m.characterId == null ? null : cards.get(m.characterId)
		return `member:${card ? card.replace(/^card:/, "") : m.name}`
	})
	const entryL = new Map<number, string>()
	unique(entryL, entries, (e) => {
		const heading = e.title || String(e.content ?? "").slice(0, 30)
		return `entry:${e.typeId}:${heading}@${lineOf(e.branchId)}`
	})
	const sceneL = new Map<number, string>()
	unique(sceneL, scenes, (s) => `scene:${s.name}@${lineOf(s.branchId)}`)
	const amendmentL = new Map<number, string>()
	unique(
		amendmentL,
		amendments,
		(a) =>
			`amend:${entryL.get(a.entryId) ?? `FOREIGN:${a.entryId}`}#${dayOf(a)}@${lineOf(a.branchId)}`
	)
	const versionL = new Map<number, string>()
	unique(
		versionL,
		versions,
		(v) =>
			`version:${v.castMemberId == null ? "card" : (memberL.get(v.castMemberId) ?? `FOREIGN:${v.castMemberId}`)}@${lineOf(v.branchId)}#${dayOf(v)}/p${v.personalPosition ?? "-"}`
	)

	const spriteSets = await inList(
		schema.spriteSets,
		schema.spriteSets.castMemberId,
		members.map((m) => m.id)
	)
	const spriteSetL = new Map<number, string>()
	unique(
		spriteSetL,
		spriteSets,
		(x) =>
			`spriteSet:${memberL.get(x.castMemberId) ?? `FOREIGN:${x.castMemberId}`}/${x.name}`
	)

	const entryIds = entries.map((e) => e.id)
	const memberIds = members.map((m) => m.id)
	const sceneIds = scenes.map((s) => s.id)
	const owners = (await bookStatOwners(testDb as any, bookId)).filter(
		([, ids]) => ids.length > 0
	)

	const rowsFor = async (
		spec: (typeof LOREBOOK_TABLES)[number]
	): Promise<any[]> => {
		const t: any = spec.table
		const name = nameOf(spec.table)
		if (spec.scope === "book")
			return where(spec.table, eq(t.lorebookId, bookId))
		if (spec.scope === "entry")
			return inList(spec.table, t.entryId, entryIds)
		if (spec.scope === "scene")
			return inList(spec.table, t.sceneId, sceneIds)
		if (spec.scope === "binding") {
			if (name === "sprite_sets")
				return inList(spec.table, t.castMemberId, memberIds)
			if (name === "cast_member_files")
				return inList(spec.table, t.castMemberId, memberIds)
			const sets = await inList(
				schema.spriteSets,
				schema.spriteSets.castMemberId,
				memberIds
			)
			return inList(
				spec.table,
				t.spriteSetId,
				sets.map((s) => s.id)
			)
		}
		if (owners.length === 0) return []
		return where(
			spec.table,
			or(
				...owners.map(([kinds, ids]) =>
					and(
						inArray(t.ownerKind, [...kinds]),
						inArray(t.ownerId, ids)
					)
				)
			)
		)
	}

	const ownerLabel = (row: any) => {
		if (row.ownerKind === "lorebook")
			return row.ownerId === bookId ? "book" : `FOREIGN:${row.ownerId}`
		if (row.ownerKind === "cast_member")
			return memberL.get(row.ownerId) ?? `FOREIGN:${row.ownerId}`
		return entryL.get(row.ownerId) ?? `FOREIGN:${row.ownerId}`
	}
	const entityKeyLabel = (key: string) => {
		const m = /^(entry|cast_member):(\d+)$/.exec(key)
		if (!m) return key
		const map = m[1] === "entry" ? entryL : memberL
		return `${m[1]}:${map.get(Number(m[2])) ?? `FOREIGN:${m[2]}`}`
	}
	const refLabel = (kind: RefKind, value: any, row: any): unknown => {
		if (value == null) return null
		const pick = (m: Map<number, string>) =>
			m.get(value) ?? `FOREIGN:${value}`
		switch (kind) {
			case "branch":
				return pick(branchL)
			case "member":
				return pick(memberL)
			case "entry":
				return pick(entryL)
			case "scene":
				return pick(sceneL)
			case "file":
				return pick(files)
			case "card":
				return pick(cards)
			case "cardVersion":
				return pick(cardVersions)
			case "spriteSet":
				return pick(spriteSetL)
			case "version":
				return pick(versionL)
			case "amendment":
				return pick(amendmentL)
			case "tag":
				return pick(tags)
			case "owner":
				return ownerLabel(row)
			case "entityKey":
				return entityKeyLabel(value)
			case "exampleSource":
				return row.exampleSourceKind === "entry" ? pick(entryL) : value
			case "foreign":
				return `FOREIGN:${value}`
		}
	}

	/** The label a row of `table` goes by; never its position or id alone. */
	const labelOf = (table: string, r: any): string => {
		const member = (id: number | null) =>
			id == null ? "-" : (memberL.get(id) ?? `FOREIGN:${id}`)
		const entry = (id: number | null) =>
			id == null ? "-" : (entryL.get(id) ?? `FOREIGN:${id}`)
		switch (table) {
			case "lorebooks":
				return "book"
			case "lorebook_branches":
				return branchL.get(r.id)!
			case "lorebook_bindings":
				return memberL.get(r.id)!
			case "lorebook_entries":
				return entryL.get(r.id)!
			case "lorebook_entry_vectors":
				return `vector:${entry(r.entryId)}/${r.vectorName}#${r.chunkIndex}`
			case "entry_annotations":
				return `annotation:${entry(r.entryId)}/${entityKeyLabel(r.entityKey)}/${r.surface}`
			case "lore_redlines":
				return `redline:${r.entryId != null ? entry(r.entryId) : r.sceneId != null ? `scene:${sceneL.get(r.sceneId) ?? `FOREIGN:${r.sceneId}`}` : (versionL.get(r.characterVersionId) ?? `FOREIGN:${r.characterVersionId}`)}/${r.cause}/${r.shownAs ?? ""}`
			case "scenes":
				return sceneL.get(r.id)!
			case "scene_characters":
				return `sceneCast:${sceneL.get(r.sceneId)}/${member(r.bindingId)}/${r.role}`
			case "narrative_relationships": {
				const from =
					r.fromNodeId != null
						? member(r.fromNodeId)
						: entry(r.fromEntryId)
				const to =
					r.toNodeId != null ? member(r.toNodeId) : entry(r.toEntryId)
				const dated =
					r.historyEntryId == null
						? ""
						: `~${entry(r.historyEntryId)}`
				return `link:${from}->${to}:${r.relationshipType}${r.title ? `[${r.title}]` : ""}@${lineOf(r.branchId)}${dated}`
			}
			case "entry_amendments":
				return amendmentL.get(r.id)!
			case "cast_amendments":
				return `castAmendment:${member(r.lorebookBindingId)}#${dayOf(r)}@${lineOf(r.branchId)}`
			case "character_versions":
				return versionL.get(r.id)!
			case "cast_presences":
				return `presence:${member(r.lorebookBindingId)}@${lineOf(r.branchId)}#${dayOf(r, "fromYear", "fromMonth", "fromDay")}`
			case "sprite_sets":
				return `spriteSet:${member(r.castMemberId)}/${r.name}`
			case "sprites":
				return `sprite:${spriteSetL.get(r.spriteSetId) ?? `FOREIGN:${r.spriteSetId}`}/${r.label}/${files.get(r.fileId) ?? "-"}`
			case "cast_member_files":
				return `gallery:${member(r.castMemberId)}/${files.get(r.fileId) ?? "-"}`
			case "lorebook_tags":
				return tags.get(r.tagId) ?? `FOREIGN:${r.tagId}`
			case "dismissed_duplicate_pairs":
				return `dismissed:${[member(r.bindingIdA), member(r.bindingIdB)].sort().join("|")}`
			case "binding_suggestions":
				return `suggestion:${entityKeyLabel(r.entityKey)}`
			case "binding_merge_logs":
				return `mergeLog:${member(r.survivorId)}/${(r.absorbedSnapshot as any)?.name ?? ""}`
			case "attribute_configs":
			case "attribute_values":
			case "owner_sheets":
				return `${table}:${ownerLabel(r)}/${r.slotId ?? r.sheetId}@${lineOf(r.branchId)}${r.sessionId == null ? "" : `/session ${r.sessionId}`}`
		}
		throw new Error(`no label for ${table}`)
	}

	/** The line a row stands on: its own, its scene's, or none. */
	const lineFor = (table: string, r: any): string | null => {
		if (table === "scene_characters") {
			const scene = scenes.find((s) => s.id === r.sceneId)
			return scene ? lineOf(scene.branchId) : null
		}
		return "branchId" in r ? lineOf(r.branchId) : null
	}

	const snapshot: Snapshot = {}
	for (const { name, table } of BOOK_TABLE_LIST) {
		const spec = LOREBOOK_TABLES.find((s) => nameOf(s.table) === name)
		const rows = name === "lorebooks" ? [book] : await rowsFor(spec!)
		const columns = getTableColumns(table)
		const seen = new Map<string, number>()
		const out: SnapRow[] = []
		// Rank, not absolute value: a copy may renumber an ordering counter.
		const rankColumns =
			name === "character_versions" ? ["writeOrder", "retiredOrder"] : []
		const ranks = new Map<string, Map<number, number>>()
		for (const column of rankColumns) {
			const present = rows
				.map((r) => r[column])
				.filter((v) => v != null)
				.sort((a, b) => a - b)
			ranks.set(column, new Map(present.map((v, i) => [v, i + 1])))
		}
		for (const r of [...rows].sort((a, b) => (a.id ?? 0) - (b.id ?? 0))) {
			let label = labelOf(name, r)
			const n = (seen.get(label) ?? 0) + 1
			seen.set(label, n)
			if (n > 1) label = `${label} #${n}`
			const values: Record<string, unknown> = {}
			for (const prop of Object.keys(columns)) {
				if (COLUMNS[name][prop] !== C) continue
				const ref = REFS[name]?.[prop]
				let v: unknown = ref ? refLabel(ref, r[prop], r) : r[prop]
				if (ranks.has(prop) && r[prop] != null)
					v = `rank ${ranks.get(prop)!.get(r[prop])}`
				values[prop] = v
			}
			if (name === "dismissed_duplicate_pairs") {
				const pair = [values.bindingIdA, values.bindingIdB].sort()
				values.bindingIdA = pair[0]
				values.bindingIdB = pair[1]
			}
			out.push({ label, line: lineFor(name, r), values })
		}
		snapshot[name] = out
	}
	return snapshot
}

/** A stable text of any value: object keys sorted, dates as ISO text. */
function show(value: unknown): string {
	const sorted = (v: any): any =>
		v instanceof Date
			? v.toISOString()
			: Array.isArray(v)
				? v.map(sorted)
				: v && typeof v === "object"
					? Object.fromEntries(
							Object.keys(v)
								.sort()
								.map((k) => [k, sorted(v[k])])
						)
					: v === undefined
						? null
						: v
	const text = JSON.stringify(sorted(value))
	return text.length > 240 ? `${text.slice(0, 240)}…` : text
}

/** Every difference between two snapshots, one string each; rows match by label. */
function diffSnapshots(a: Snapshot, b: Snapshot): string[] {
	const out: string[] = []
	for (const table of Object.keys(a)) {
		const left = new Map(a[table].map((r) => [r.label, r]))
		const right = new Map((b[table] ?? []).map((r) => [r.label, r]))
		for (const [label, row] of left) {
			const other = right.get(label)
			if (!other) {
				out.push(`${table} @${label}: missing in b`)
				continue
			}
			for (const column of Object.keys(row.values)) {
				if (show(row.values[column]) !== show(other.values[column]))
					out.push(
						`${table} @${label}: ${column} a=${show(row.values[column])} b=${show(other.values[column])}`
					)
			}
		}
		for (const label of right.keys())
			if (!left.has(label)) out.push(`${table} @${label}: extra in b`)
	}
	return out
}

/** Only the rows standing on main (or on no line), without the line rows themselves. */
function mainLineOnly(s: Snapshot): Snapshot {
	const out: Snapshot = {}
	for (const [table, rows] of Object.entries(s)) {
		if (table === "lorebook_branches") {
			out[table] = []
			continue
		}
		out[table] = rows.filter((r) => r.line == null || r.line === "main")
	}
	return out
}

/** What the diff leaves to the tests: the book's name, owner and identity. */
function identityDiff(
	a: any,
	b: any,
	expected: { name: string; userId: number }
): string[] {
	const out: string[] = []
	if (b.name !== expected.name)
		out.push(
			`lorebooks @book: name expected=${show(expected.name)} b=${show(b.name)}`
		)
	if (b.userId !== expected.userId)
		out.push(
			`lorebooks @book: userId expected=${expected.userId} b=${b.userId}`
		)
	if (a.uuid === b.uuid)
		out.push(`lorebooks @book: uuid a=${a.uuid} b=${b.uuid} (same)`)
	return out
}

// ── Seed ────────────────────────────────────────────────────────────────────

/** A distinct small PNG per `width`, so each seeded file has its own hash. */
function pngBytes(width: number): Buffer {
	const png = new PNG({ width, height: 1 })
	png.data.fill(255)
	return PNG.sync.write(png)
}

const VIS = "core:ruleset/vis-itineris@1"

const positions = new Map<string, number>()
async function insertEntry(
	lorebookId: number,
	data: Record<string, any>,
	extra: Record<string, any> = {}
) {
	const key = `${lorebookId}:${data.typeId}`
	const position = (positions.get(key) ?? -1) + 1
	positions.set(key, position)
	const [row] = await testDb
		.insert(schema.lorebookEntries)
		.values({
			...entryInsert({ lorebookId, position, ...data } as any),
			...extra
		})
		.returning()
	return row
}

/**
 * One book with a little of everything a round trip should carry.
 *
 * The base seed: the fixture `lorebook-format2-2026-11-16.json` was exported
 * from exactly this; never change what it writes. `extendSeed` builds on it.
 */
async function seedRoundTripBook(ownerId: number, name = "Round Trip Book") {
	const { lorebooksCreateHandler } = await import("./lorebooks")
	const { lorebook } = await lorebooksCreateHandler.handler(
		fakeSocket(ownerId),
		{ name },
		noopEmit
	)
	const bookId = lorebook.id

	const { createMedia } = await import("$lib/server/media")
	const cover = (
		await createMedia(testDb as any, {
			userId: ownerId,
			lorebookId: bookId,
			bytes: pngBytes(3)
		})
	).file

	await testDb
		.update(schema.lorebooks)
		.set({
			description: "A book that has everything.",
			extraJson: { scanDepth: 4 },
			storyCalendar: {
				months: [
					{ name: "Frost", days: 30 },
					{ name: "Thaw", days: 30 }
				]
			} as any,
			storyClockYear: 1201,
			storyClockMonth: 2,
			storyClockDay: 3,
			storyClockHour: 14,
			storyClockMinute: 30,
			primaryRuleset: VIS,
			loreWriteMode: "review",
			coverMediaId: cover.id,
			nextBindingNumber: 3
		})
		.where(eq(schema.lorebooks.id, bookId))

	const [tag] = await testDb
		.insert(schema.tags)
		.values({ userId: ownerId, name: "fantasy" })
		.returning()
	await testDb
		.insert(schema.lorebookTags)
		.values({ lorebookId: bookId, tagId: tag.id })

	// Two lines: main, and a branch with a branch point and its own clock.
	const [northRoad] = await testDb
		.insert(schema.lorebookBranches)
		.values({
			lorebookId: bookId,
			name: "North road",
			forkYear: 1200,
			forkMonth: 1,
			forkDay: 20,
			storyClockYear: 1200,
			storyClockMonth: 2,
			storyClockDay: 9
		})
		.returning()

	// Cast: a member with a card the owner owns, and a background member.
	const { insertCastMember, insertCharacterVersions, ensureCardVersion } =
		await import("$lib/server/characters/versions")
	const [card] = await testDb
		.insert(schema.characters)
		.values({
			userId: ownerId,
			name: "Maren",
			description: "A smith."
		})
		.returning()
	const { member: maren } = await insertCastMember(
		testDb as any,
		{
			lorebookId: bookId,
			binding: "{{char:1}}",
			characterId: card.id,
			name: "Maren",
			aliases: ["the smith"],
			summary: "Keeps the forge."
		} as any
	)
	const { member: hooded } = await insertCastMember(
		testDb as any,
		{
			lorebookId: bookId,
			binding: "{{char:2}}",
			name: "Hooded figure",
			castMemberLock: true,
			summary: "Nobody knows who."
		} as any
	)

	// Entries.
	const city = await insertEntry(bookId, {
		typeId: "core:entry/world-lore",
		name: "City of Ash",
		content: "A city on a river.",
		keys: "city, river",
		year: 1100,
		month: 1,
		day: 5
	})
	const district = await insertEntry(bookId, {
		typeId: "core:entry/world-lore",
		name: "Smiths' district",
		content: "Where the forges are.",
		anchorEntryId: city.id
	})
	const archived = await insertEntry(bookId, {
		typeId: "core:entry/world-lore",
		name: "Old rumour",
		content: "Forgotten.",
		archived: true,
		enabled: false
	})
	const vault = await insertEntry(
		bookId,
		{
			typeId: "core:entry/world-lore",
			name: "Secret of the vault",
			content: "The vault is empty."
		},
		{ notCommonKnowledge: true }
	)
	const camp = await insertEntry(bookId, {
		typeId: "core:entry/world-lore",
		name: "Ambush camp",
		content: "Only on the north road.",
		branchId: northRoad.id
	})
	await insertEntry(bookId, {
		typeId: "core:entry/character-lore",
		name: "Maren's past",
		content: "She forged the king's sword.",
		lorebookBindingId: maren.id
	})
	const sword = await insertEntry(
		bookId,
		{
			typeId: ITEM_TYPE_ID,
			name: "Kingsblade",
			content: "A sword.",
			supply: "limited",
			supplyLimit: 1
		},
		{ provenance: "model" }
	)
	const tavern = await insertEntry(bookId, {
		typeId: LOCATION_TYPE_ID,
		name: "The Tavern",
		content: "A noisy tavern."
	})
	const cellar = await insertEntry(bookId, {
		typeId: LOCATION_TYPE_ID,
		name: "The Cellar",
		content: "Cold and damp."
	})
	const dayMain = await insertEntry(bookId, {
		typeId: "core:entry/history",
		content: "The city was founded on the river.",
		year: 1200,
		month: 1,
		day: 2
	})
	const dayBranch = await insertEntry(bookId, {
		typeId: "core:entry/history",
		content: "The road splits and the king rides north.",
		year: 1200,
		month: 2,
		day: 12,
		branchId: northRoad.id
	})

	// Entry versions, one on main and one on the line.
	await testDb.insert(schema.entryAmendments).values([
		{
			lorebookId: bookId,
			entryId: sword.id,
			year: 1201,
			month: 1,
			day: 1,
			fields: { content: "A broken sword." },
			historyEntryId: dayMain.id
		},
		{
			lorebookId: bookId,
			entryId: city.id,
			branchId: northRoad.id,
			year: 1200,
			month: 3,
			day: 1,
			fields: { content: "The city burns." },
			historyEntryId: dayBranch.id
		}
	])

	// A member version on the line.
	const cardV1 = await ensureCardVersion(testDb as any, card.id)
	await insertCharacterVersions(testDb as any, [
		{
			castMemberId: maren.id,
			lorebookId: bookId,
			parentVersionId: cardV1!.id,
			follows: ["description"],
			branchId: northRoad.id,
			year: 1200,
			month: 3,
			day: 1,
			personalPosition: 1,
			historyEntryId: dayBranch.id,
			name: "Maren the Exile",
			nodeState: "active",
			nodeVisibility: "normal"
		}
	])
	await testDb.insert(schema.castPresences).values({
		lorebookId: bookId,
		lorebookBindingId: maren.id,
		personalPosition: 1,
		fromYear: 1200,
		untilYear: 1201,
		untilMonth: 2,
		note: "on the road"
	})

	// Links: cast↔cast on each line, a way between two places, and one
	// knowledge tie of each kind.
	await testDb.insert(schema.narrativeRelationships).values([
		{
			lorebookId: bookId,
			fromNodeId: maren.id,
			toNodeId: hooded.id,
			relationshipType: "distrusts",
			description: "on main",
			historyEntryId: dayMain.id
		},
		{
			lorebookId: bookId,
			fromNodeId: hooded.id,
			toNodeId: maren.id,
			relationshipType: "follows",
			description: "on the road",
			branchId: northRoad.id,
			historyEntryId: dayBranch.id
		},
		{
			lorebookId: bookId,
			fromEntryId: tavern.id,
			toEntryId: cellar.id,
			relationshipType: "leads to",
			reverseRelationshipType: "leads up to",
			title: "the trapdoor",
			description: "a way"
		}
	])
	const { writeKnowledgeTie } = await import(
		"$lib/server/lorebooks/entryKnowledge"
	)
	const tie = (
		castMemberId: number,
		entryId: number,
		kind: any,
		historyEntryId?: number
	) =>
		writeKnowledgeTie(testDb as any, {
			userId: ownerId,
			lorebookId: bookId,
			castMemberId,
			entryId,
			kind,
			historyEntryId
		})
	await tie(maren.id, vault.id, "knows")
	await tie(maren.id, cellar.id, "has_been_there")
	await tie(hooded.id, vault.id, "was_told", dayMain.id)
	await tie(hooded.id, archived.id, "kept_from")

	// Scenes: one compiled under the main day, one still open.
	const [meeting] = await testDb
		.insert(schema.scenes)
		.values({
			lorebookId: bookId,
			historyEntryId: dayMain.id,
			name: "The meeting",
			summary: "They meet at the tavern.",
			selectedMessageIds: []
		})
		.returning()
	await testDb.insert(schema.sceneCharacters).values([
		{
			sceneId: meeting.id,
			bindingId: maren.id,
			role: "participant",
			ordinal: 0
		},
		{
			sceneId: meeting.id,
			bindingId: hooded.id,
			role: "mentioned",
			ordinal: 1
		}
	])
	const [open] = await testDb
		.insert(schema.scenes)
		.values({
			lorebookId: bookId,
			name: "The open scene",
			summary: "",
			selectedMessageIds: [],
			openedStoryClockYear: 1201,
			openedStoryClockMonth: 2,
			openedStoryClockDay: 3
		})
		.returning()
	await testDb.insert(schema.sceneCharacters).values({
		sceneId: open.id,
		bindingId: maren.id,
		role: "participant",
		ordinal: 0
	})

	// Stats: the template layer on the book, a member and a place.
	await testDb.insert(schema.attributeValues).values([
		{
			ownerKind: "lorebook",
			ownerId: bookId,
			slotId: "core:slot/weather@1",
			value: { v: "rain" }
		},
		{
			ownerKind: "cast_member",
			ownerId: maren.id,
			slotId: "core:slot/hp@1",
			value: { v: 12 }
		},
		{
			ownerKind: "location",
			ownerId: tavern.id,
			slotId: "core:slot/stock@1",
			value: { v: 3 }
		}
	])
	await testDb.insert(schema.attributeConfigs).values({
		ownerKind: "cast_member",
		ownerId: maren.id,
		slotId: "core:slot/hp@1",
		config: { max: 20 }
	})

	void district
	void camp
	return { bookId, name, maren, hooded, tavern, city }
}

/**
 * The full seed: `seedRoundTripBook`, then every compared column of every
 * table given a value that is not its default, in at least one row, where the
 * app can hold one (`NOT_SEEDED` names the columns it cannot, each with its
 * reason). Corrects the base seed's two artefacts on this copy: an item's
 * provenance is one the app writes (`pipeline`), and scene cast is numbered
 * per role from 0 (`writeSceneCast`). Never run on the old-file test's seed.
 */
async function extendSeed(ownerId: number, bookId: number) {
	const { createMedia, addToMemberGallery } = await import(
		"$lib/server/media"
	)
	const {
		insertCastMember,
		insertCharacterVersions,
		ensureCardVersion,
		nextWriteOrder,
		updateCastVersion
	} = await import("$lib/server/characters/versions")

	const one = async (rows: Promise<any[]>) => (await rows)[0]
	const entryTitled = (title: string) =>
		one(
			testDb
				.select()
				.from(schema.lorebookEntries)
				.where(
					and(
						eq(schema.lorebookEntries.lorebookId, bookId),
						eq(schema.lorebookEntries.title, title)
					)
				)
		)
	const dayOn = (prefix: string) =>
		one(
			testDb
				.select()
				.from(schema.lorebookEntries)
				.where(
					and(
						eq(schema.lorebookEntries.lorebookId, bookId),
						eq(schema.lorebookEntries.typeId, "core:entry/history")
					)
				)
				.then((rows) =>
					rows.filter((r: any) =>
						String(r.content).startsWith(prefix)
					)
				)
		)
	const memberTagged = (binding: string) =>
		one(
			testDb
				.select()
				.from(schema.lorebookBindings)
				.where(
					and(
						eq(schema.lorebookBindings.lorebookId, bookId),
						eq(schema.lorebookBindings.binding, binding)
					)
				)
		)
	const sceneNamed = (name: string) =>
		one(
			testDb
				.select()
				.from(schema.scenes)
				.where(
					and(
						eq(schema.scenes.lorebookId, bookId),
						eq(schema.scenes.name, name)
					)
				)
		)
	const picture = async (width: number) =>
		(
			await createMedia(testDb as any, {
				userId: ownerId,
				lorebookId: bookId,
				bytes: pngBytes(width)
			})
		).file

	const maren = await memberTagged("{{char:1}}")
	const hooded = await memberTagged("{{char:2}}")
	const tavern = await entryTitled("The Tavern")
	const cellar = await entryTitled("The Cellar")
	const sword = await entryTitled("Kingsblade")
	const dayMain = await dayOn("The city was founded")
	const dayBranch = await dayOn("The road splits")
	const meeting = await sceneNamed("The meeting")
	const [northRoad] = await testDb
		.select()
		.from(schema.lorebookBranches)
		.where(
			and(
				eq(schema.lorebookBranches.lorebookId, bookId),
				eq(schema.lorebookBranches.name, "North road")
			)
		)

	// The two artefacts of the base seed.
	await testDb
		.update(schema.lorebookEntries)
		.set({ provenance: "pipeline" })
		.where(eq(schema.lorebookEntries.id, sword.id))
	await testDb
		.update(schema.sceneCharacters)
		.set({ ordinal: 0 })
		.where(
			and(
				eq(schema.sceneCharacters.sceneId, meeting.id),
				eq(schema.sceneCharacters.bindingId, hooded.id)
			)
		)

	// The book row. The importer keeps a ruleset version only when the pub keeps
	// it (`importedBookRules` → `keptRulesetDocument`); this test pub is new and
	// keeps none of a core ruleset, so it keeps one the way a publish does.
	const { keepRulesetVersion, keptRulesetDocument } = await import(
		"$lib/server/rulesets/versions"
	)
	const rulesetVersion = "1.0.0"
	await testDb
		.insert(schema.rulesets)
		.values({
			rulesetId: VIS,
			ownerSlug: "core",
			label: "Vis Itineris",
			draft: {},
			published: { id: VIS, version: rulesetVersion },
			publishedVersion: rulesetVersion
		})
		.onConflictDoNothing()
	await keepRulesetVersion(testDb as any, {
		rulesetId: VIS,
		version: rulesetVersion,
		document: { id: VIS, version: rulesetVersion },
		publishedBy: null
	})
	expect(
		await keptRulesetDocument(testDb as any, VIS, rulesetVersion)
	).not.toBeNull()
	await testDb
		.update(schema.lorebooks)
		.set({
			kind: "starter_kit",
			timelineEnabled: false,
			rulesetVersion,
			extraJson: {
				scanDepth: 4,
				tokenBudget: 2048,
				recursiveScanning: true
			},
			annex: { "tavern-rumours": { heard: 2 } },
			annexAudiences: { "tavern-rumours": { heard: ["Maren"] } },
			annexVersions: { "tavern-rumours": 3 },
			nextBindingNumber: 4
		})
		.where(eq(schema.lorebooks.id, bookId))

	// What only a carded member has: its own name and nickname in this book, and
	// retold fields, written the way the member page saves them (the update
	// handler writes the row and the base version together).
	const { updateLorebookBindingHandler } = await import("./lorebooks")
	const [marenBase] = await testDb
		.select()
		.from(schema.characterVersions)
		.where(
			and(
				eq(schema.characterVersions.castMemberId, maren.id),
				isNull(schema.characterVersions.branchId),
				isNull(schema.characterVersions.year),
				isNull(schema.characterVersions.retiredOrder)
			)
		)
	const marenOwn = {
		ownName: "Maren of the forge",
		ownNickname: "Mare",
		retold: { description: true, personality: true, scenario: true },
		description: "Broad-shouldered, soot to the elbow.",
		personality: "Gruff and kind.",
		scenario: "Hammers out the king's orders."
	}
	await updateLorebookBindingHandler.handler(
		fakeSocket(ownerId),
		{
			lorebookBinding: { id: maren.id, ...marenOwn },
			castVersionId: marenBase.id
		} as any,
		noopEmit
	)
	// The update writes the base version; the row's own columns are written
	// here so the two agree (the base is authoritative: the export reads it).
	await testDb
		.update(schema.lorebookBindings)
		.set(marenOwn)
		.where(eq(schema.lorebookBindings.id, maren.id))

	// A second line, forked from the first, with a clock to the minute.
	const [ambushLine] = await testDb
		.insert(schema.lorebookBranches)
		.values({
			lorebookId: bookId,
			name: "Ambush",
			forkedFromBranchId: northRoad.id,
			forkYear: 1200,
			forkMonth: 3,
			forkDay: 4,
			storyClockYear: 1200,
			storyClockMonth: 3,
			storyClockDay: 9,
			storyClockHour: 6,
			storyClockMinute: 45
		})
		.returning()

	// A background member with every own column and its own art.
	const face = await picture(11)
	const art = []
	for (const width of [12, 13, 14, 15, 16, 17]) art.push(await picture(width))
	const [
		spriteJoy,
		spriteGrim,
		spriteSummer,
		galleryOne,
		galleryTwo,
		faceTwo
	] = art
	// A card-less member's own words are its base version's: the row carries
	// no own name, own nickname or retold flags, and the row and the base agree.
	const { member: rook, base: rookBase } = await insertCastMember(
		testDb as any,
		{
			lorebookId: bookId,
			binding: "{{char:3}}",
			name: "Rook",
			aliases: ["the warden"],
			absorbedAliases: ["old crow"],
			summary: "Wardens the north road.",
			description: "Lean, grey-eyed.",
			personality: "Patient.",
			scenario: "Watches the road.",
			firstMessage: "Halt.",
			alternateGreetings: ["Who goes there?"],
			exampleDialogues: "<START>\nRook: Halt.",
			faceMediaId: face.id,
			spriteSet: "winter",
			timbre: { description: "low and calm", language: "en" },
			parentNodeId: hooded.id,
			sceneId: meeting.id,
			historyEntryId: dayMain.id,
			nodeState: "missing",
			nodeVisibility: "hidden"
		} as any
	)
	// The profile fields the row has no column for.
	await updateCastVersion(testDb as any, rookBase!.id, {
		changes: {
			nickname: "The Crow",
			postHistoryInstructions: "Speak in short orders.",
			creatorNotes: { text: "Never smiles.", variants: {} }
		}
	})
	const [winter, summer] = await testDb
		.insert(schema.spriteSets)
		.values([
			{ castMemberId: rook.id, name: "winter", isDefault: true },
			{ castMemberId: rook.id, name: "summer", position: 1 }
		])
		.returning()
	await testDb.insert(schema.sprites).values([
		{
			spriteSetId: winter.id,
			label: "joy",
			fileId: spriteJoy.id,
			source: "generated"
		},
		{
			spriteSetId: winter.id,
			label: "grim",
			position: 1,
			fileId: spriteGrim.id,
			source: "sillytavern"
		},
		{ spriteSetId: summer.id, label: "joy", fileId: spriteSummer.id }
	])
	await addToMemberGallery(testDb as any, rook.id, [
		galleryOne.id,
		galleryTwo.id
	])

	// Cast versions: a fully written dated one, and a retired one.
	const cardV1 = await ensureCardVersion(testDb as any, maren.characterId)
	const [, retired] = await insertCharacterVersions(testDb as any, [
		{
			castMemberId: maren.id,
			lorebookId: bookId,
			parentVersionId: cardV1!.id,
			follows: ["personality"],
			year: 1202,
			month: 1,
			day: 5,
			historyEntryId: dayMain.id,
			atHour: 9,
			atMinute: 15,
			personalPosition: 2,
			writtenBy: `user:${ownerId}`,
			note: "after the siege",
			label: "After the siege",
			name: "Maren Ashhand",
			nickname: "Ash",
			aliases: ["Ashhand"],
			summary: "Burnt, not broken.",
			description: "Scarred hands.",
			scenario: "Rebuilds the forge.",
			greetings: [{ text: "Hello.", groupOnly: true }],
			exampleDialogues: ["Maren: Hm."],
			postHistoryInstructions: "Stay terse.",
			creatorNotes: { text: "Keep her quiet.", variants: {} },
			strokes: [
				{
					kind: "description",
					slug: "eyes",
					label: "Eyes",
					text: "grey",
					when: { mode: "always" }
				}
			],
			faceMediaId: faceTwo.id,
			likeness: { prompt: "soot-streaked" },
			timbre: { description: "rough" },
			spriteSet: "winter",
			extensions: { custom: true },
			nodeState: "departed",
			nodeVisibility: "legendary"
		} as any,
		{
			castMemberId: maren.id,
			lorebookId: bookId,
			parentVersionId: cardV1!.id,
			follows: ["description"],
			year: 1199,
			month: 6,
			day: 1,
			personalPosition: 1,
			name: "Maren the Younger",
			nodeState: "active",
			nodeVisibility: "normal"
		} as any
	])
	await testDb
		.update(schema.characterVersions)
		.set({ retiredOrder: await nextWriteOrder(testDb as any) })
		.where(eq(schema.characterVersions.id, retired.id))

	// Entries: one that sets every matching and condition column.
	const dragon = await insertEntry(
		bookId,
		{
			typeId: "core:entry/world-lore",
			name: "Dragon rumour",
			content: "A wyrm sleeps under the hill.",
			keys: "dragons?, wyr[mn]",
			secondaryKeys: "fire, scale",
			selectiveLogic: "andAll",
			matchMode: "regex",
			useRegex: true,
			caseSensitive: true,
			recursionDepth: 2,
			constant: true,
			decayRate: 0.25,
			extraJson: { note: "heard at the tavern" }
		},
		{
			entryLock: true,
			derivedFrom: {
				compendium: "test:compendium/rumours@1",
				piece: "dragon",
				version: "1.0"
			}
		}
	)
	await testDb.insert(schema.lorebookEntryVectors).values([
		{
			entryId: dragon.id,
			vectorName: "core:vec/default@1",
			dims: 2,
			vector: [0.5, 0.5]
		},
		{
			entryId: dragon.id,
			vectorName: "core:vec/default@1",
			chunkIndex: 1,
			dims: 2,
			vector: [0.1, 0.9]
		}
	] as any)
	await testDb.insert(schema.entryAnnotations).values([
		{
			entryId: dragon.id,
			entityKey: `entry:${tavern.id}`,
			surface: "Tavern",
			normalized: "tavern",
			tier: "gazetteer",
			refEntryId: tavern.id,
			extractorVersion: "test",
			sourceHash: "h",
			gazetteerHash: "g"
		},
		{
			entryId: dragon.id,
			entityKey: `character:${maren.characterId}`,
			surface: "Maren",
			normalized: "maren",
			tier: "gazetteer",
			characterId: maren.characterId,
			extractorVersion: "test",
			sourceHash: "h",
			gazetteerHash: "g"
		},
		{
			entryId: dragon.id,
			entityKey: `cast_member:${rook.id}`,
			surface: "Rook",
			normalized: "rook",
			tier: "gazetteer",
			extractorVersion: "test",
			sourceHash: "h",
			gazetteerHash: "g"
		}
	] as any)

	// An entry version with its base, and the edit history that names it.
	const [tavernVersion] = await testDb
		.insert(schema.entryAmendments)
		.values({
			lorebookId: bookId,
			entryId: tavern.id,
			year: 1202,
			month: 3,
			day: 4,
			base: { content: { v: "A noisy tavern." } },
			fields: { content: "A burnt tavern." },
			historyEntryId: dayMain.id
		})
		.returning()
	await testDb.insert(schema.loreRedlines).values([
		{
			entryId: tavern.id,
			amendmentId: tavernVersion.id,
			changes: {
				content: { before: { v: "Old." }, after: { v: "New." } }
			},
			cause: "save",
			userId: ownerId,
			runId: "run-7",
			shownAs: "saved by hand"
		}
	] as any)

	// Scenes: one on the second line, closed, with notes; cast numbered per role.
	const [ambush] = await testDb
		.insert(schema.scenes)
		.values({
			lorebookId: bookId,
			branchId: northRoad.id,
			historyEntryId: dayBranch.id,
			name: "The ambush",
			nameIsDefault: true,
			sceneLock: true,
			selectedMessageIds: [7, 8],
			summary: "Arrows fly.",
			graphed: true,
			channel: "whisper",
			openedStoryClockYear: 1200,
			openedStoryClockMonth: 3,
			openedStoryClockDay: 1,
			openedStoryClockHour: 6,
			openedStoryClockMinute: 10,
			closedStoryClockYear: 1200,
			closedStoryClockMonth: 3,
			closedStoryClockDay: 1,
			closedStoryClockHour: 7,
			closedStoryClockMinute: 20,
			summaryStatus: "done",
			processedBySpecId: "core:routine/summary@1",
			summaryOrigin: "routine",
			notes: [
				{
					text: "Marked by the keeper.",
					runId: "run-9",
					messageId: null,
					at: "2026-11-16T00:00:00.000Z"
				}
			]
		})
		.returning()
	await testDb.insert(schema.sceneCharacters).values([
		{
			sceneId: meeting.id,
			bindingId: rook.id,
			role: "participant",
			ordinal: 1
		},
		{
			sceneId: ambush.id,
			bindingId: maren.id,
			role: "participant",
			ordinal: 0
		},
		{
			sceneId: ambush.id,
			bindingId: rook.id,
			role: "participant",
			ordinal: 1
		},
		{
			sceneId: ambush.id,
			bindingId: hooded.id,
			role: "mentioned",
			ordinal: 0
		}
	])

	// A scene's edit history: a row the book's snapshot never reaches, and no file carries.
	await testDb.insert(schema.loreRedlines).values({
		sceneId: meeting.id,
		changes: {
			participantCharacters: { before: { v: [] }, after: { v: [rook.id] } }
		},
		cause: "save",
		userId: ownerId,
		shownAs: "saved by hand"
	} as any)

	// Links, presences and a cast version of the book's second member.
	const [trust] = await testDb
		.insert(schema.narrativeRelationships)
		.values({
			lorebookId: bookId,
			fromNodeId: maren.id,
			toNodeId: rook.id,
			relationshipType: "trusts",
			description: "once",
			visibility: "secret",
			status: "resolved",
			reason: "betrayal",
			historyEntryId: dayMain.id,
			sceneId: meeting.id,
			rulesRunId: "run-3"
		})
		.returning()
	await testDb.insert(schema.castPresences).values({
		lorebookId: bookId,
		lorebookBindingId: rook.id,
		branchId: northRoad.id,
		personalPosition: 2,
		fromYear: 1200,
		fromMonth: 2,
		fromDay: 3,
		untilYear: 1200,
		untilMonth: 5,
		untilDay: 7,
		note: "on watch"
	})
	await testDb.insert(schema.castAmendments).values({
		lorebookId: bookId,
		lorebookBindingId: rook.id,
		branchId: northRoad.id,
		year: 1200,
		month: 3,
		day: 1,
		personalPosition: 2,
		fields: { name: "Rook the Warden" },
		historyEntryId: dayBranch.id
	})

	// Stats and sheets.
	await testDb.insert(schema.attributeValues).values({
		ownerKind: "cast_member",
		ownerId: rook.id,
		slotId: "core:slot/mana@1",
		value: { v: 5 },
		updatedBy: "pipeline",
		branchId: northRoad.id,
		historyEntryId: dayBranch.id,
		sceneId: ambush.id,
		note: "after the ambush",
		stateVersion: 2,
		storyClockYear: 1200,
		storyClockMonth: 3,
		storyClockDay: 1,
		storyClockHour: 7,
		storyClockMinute: 20
	})
	await testDb.insert(schema.attributeConfigs).values({
		ownerKind: "cast_member",
		ownerId: rook.id,
		slotId: "core:slot/mana@1",
		config: { max: 9 },
		updatedBy: "pipeline",
		branchId: northRoad.id,
		historyEntryId: dayBranch.id,
		sceneId: ambush.id,
		note: "raised for the road"
	})
	await testDb
		.insert(schema.attributeSheets)
		.values({ id: "test:sheet/round-trip@1", props: {} })
		.onConflictDoNothing()
	await testDb.insert(schema.ownerSheets).values([
		{
			ownerKind: "cast_member",
			ownerId: maren.id,
			sheetId: "test:sheet/round-trip@1"
		},
		{
			ownerKind: "location",
			ownerId: tavern.id,
			sheetId: "test:sheet/round-trip@1",
			position: 1
		}
	])

	// Cast curation.
	await testDb.insert(schema.dismissedDuplicatePairs).values({
		lorebookId: bookId,
		bindingIdA: maren.id,
		bindingIdB: hooded.id
	})
	await testDb.insert(schema.bindingSuggestions).values({
		lorebookId: bookId,
		entityKey: "open:the ferryman",
		surface: "the Ferryman",
		status: "added",
		occurrences: 3,
		sourceCount: 2,
		exampleContext: "…the Ferryman said nothing…",
		exampleSourceKind: "entry",
		exampleSourceId: tavern.id,
		resolvedBindingId: rook.id,
		decidedAt: new Date()
	})
	await testDb.insert(schema.bindingMergeLogs).values({
		lorebookId: bookId,
		userId: ownerId,
		survivorId: hooded.id,
		absorbedSnapshot: { name: "Gone" },
		relationshipRewrites: [
			{ id: trust.id, oldFromNodeId: rook.id, oldToNodeId: null }
		],
		deletedRelationships: [{ description: "a link that went with it" }],
		sceneSnapshots: [
			{
				sceneId: meeting.id,
				participantCharacters: [maren.id],
				mentionedCharacters: []
			}
		],
		absorbedAliasesAdded: ["Gone"],
		reassignedCharacterLoreEntryIds: [dragon.id],
		reassignedChildNodeIds: [rook.id],
		tagRewrites: [
			{
				site: "entry",
				id: dragon.id,
				column: "content",
				from: 3,
				to: "{{char:2}}",
				before: "A wyrm sleeps under the hill."
			}
		]
	} as any)

	void cellar
	return { rook, ambush, ambushLine, dragon }
}

const FIXTURE = path.join(
	process.cwd(),
	"src/lib/server/sockets/fixtures/lorebook-format2-2026-11-16.json"
)

async function exportFile(bookId: number, userId: number): Promise<string> {
	const { buildLorebookExportData } = await import(
		"$lib/server/utils/lorebookExportBuilder"
	)
	const { specBookWithGraph } = await buildLorebookExportData(
		bookId,
		userId,
		{}
	)
	return JSON.stringify(specBookWithGraph, null, 2)
}

async function importAsConflict(userId: number, lorebookJson: string) {
	const { lorebookImportHandler } = await import("./lorebooks")
	const res: any = await lorebookImportHandler.handler(
		fakeSocket(userId),
		{ lorebookJson },
		noopEmit
	)
	return res
}

/** The seeds have this much; an empty diff of an empty snapshot would prove nothing. */
const BASE_COUNTS = {
	lorebooks: 1,
	lorebook_branches: 1,
	lorebook_bindings: 2,
	lorebook_entries: 11,
	scenes: 2,
	scene_characters: 3,
	narrative_relationships: 7,
	entry_amendments: 2,
	character_versions: 3,
	cast_presences: 1,
	lorebook_tags: 1,
	attribute_values: 3,
	attribute_configs: 1
}
const FULL_COUNTS = {
	lorebooks: 1,
	lorebook_branches: 2,
	lorebook_bindings: 3,
	lorebook_entries: 12,
	scenes: 3,
	scene_characters: 7,
	narrative_relationships: 8,
	entry_amendments: 3,
	character_versions: 6,
	cast_presences: 2,
	lorebook_tags: 1,
	attribute_values: 4,
	attribute_configs: 2,
	lorebook_entry_vectors: 2,
	entry_annotations: 3,
	lore_redlines: 1,
	cast_amendments: 1,
	sprite_sets: 2,
	sprites: 3,
	cast_member_files: 2,
	dismissed_duplicate_pairs: 1,
	binding_suggestions: 1,
	binding_merge_logs: 1,
	owner_sheets: 2
}
function expectSeeded(s: Snapshot, counts: Record<string, number>) {
	const found = Object.fromEntries(
		Object.entries(s).map(([table, rows]) => [table, rows.length])
	)
	expect(found).toEqual(expect.objectContaining(counts))
}

const log = (title: string, lines: string[]) =>
	console.log(
		`\n=== ${title}: ${lines.length} difference(s) ===\n${lines.join("\n")}\n`
	)

// ── Coverage of the full seed ───────────────────────────────────────────────

const SESSION_TIE =
	"a session's own row: the book-layer rows of this seed belong to no session"
const MESSAGE_TIE =
	"points at a message of a session; the book-layer rows of this seed have none"

/**
 * Compared columns the full seed cannot give a value, each with the reason.
 * Every other compared column holds a non-default value in at least one row
 * (`coverageGaps`).
 */
const NOT_SEEDED: Record<string, Record<string, string>> = {
	lorebooks: {
		sessionId: `${SESSION_TIE} (a session's own book)`,
		overlayOf: `${SESSION_TIE} (a session's book over its parent)`,
		surfacedFromSessionId: SESSION_TIE
	},
	lorebook_bindings: {
		overlayOf: `${SESSION_TIE} (a session's overlay row)`
	},
	lorebook_entries: {
		sourceMessageId: `${MESSAGE_TIE} (a session's own note)`
	},
	lore_redlines: {
		characterVersionId:
			"the snapshot reaches a book's redlines through their entry (the registry's scope); a redline of a cast version has entry_id NULL (lore_redlines_subject_check), so no row of the book's reaches it",
		sceneId:
			"the snapshot reaches a book's redlines through their entry (the registry's scope); a redline of a scene has entry_id NULL (lore_redlines_subject_check), so no row of the book's reaches it",
		sessionId: SESSION_TIE,
		messageId: MESSAGE_TIE
	},
	scenes: {
		sessionId: SESSION_TIE,
		openedAtMessageId: MESSAGE_TIE,
		closedAtMessageId: MESSAGE_TIE
	},
	entry_amendments: { sourceMessageId: MESSAGE_TIE },
	character_versions: {
		cardId: "a card version has no lorebook_id (character_versions_card_version_check), so it is never a row of the book",
		number: "a card version's own number; a cast version has none (character_versions_cast_version_check)",
		sourceSessionId: SESSION_TIE,
		sourceMessageId: MESSAGE_TIE,
		validFromMessageId: MESSAGE_TIE,
		liftedFromAmendmentId:
			"a plain int naming the cast amendment a version was lifted from, written only by the boot lift"
	},
	sprite_sets: {
		characterId:
			"a card's own sprite sets belong to the card, never to the book (tableRegistry)"
	},
	attribute_configs: {
		sessionId: SESSION_TIE,
		validFromMessageId: MESSAGE_TIE,
		sourceSessionId: SESSION_TIE,
		sourceMessageId: MESSAGE_TIE
	},
	attribute_values: {
		sessionId: SESSION_TIE,
		validFromMessageId: MESSAGE_TIE,
		sourceSessionId: SESSION_TIE,
		sourceMessageId: MESSAGE_TIE
	},
	owner_sheets: { sessionId: SESSION_TIE }
}

/**
 * Nothing worth carrying: null, `""`, `[]`, `{}`, `false` or `0`. Such a value
 * still counts when the column's plain default is something else (`false` on
 * a column that defaults to `true`).
 */
function isEmptyish(v: unknown, dflt: unknown, plain: boolean): boolean {
	const empty =
		v == null ||
		v === "" ||
		v === false ||
		v === 0 ||
		(Array.isArray(v) && v.length === 0) ||
		(typeof v === "object" &&
			!Array.isArray(v) &&
			Object.keys(v as object).length === 0)
	return empty && !(plain && show(v) !== show(dflt) && v != null)
}

/** Compared columns no row of `s` gives a non-default value, and `NOT_SEEDED` entries that are stale. */
function coverageGaps(s: Snapshot): string[] {
	const gaps: string[] = []
	for (const { name, table } of BOOK_TABLE_LIST) {
		const rows = s[name] ?? []
		const columns = getTableColumns(table)
		for (const [prop, how] of Object.entries(COLUMNS[name])) {
			if (how !== C) {
				if (NOT_SEEDED[name]?.[prop])
					gaps.push(`${name}.${prop}: in NOT_SEEDED but not compared`)
				continue
			}
			const reason = NOT_SEEDED[name]?.[prop]
			const dflt: unknown = (columns[prop] as any).default
			const plain =
				dflt !== undefined &&
				!(
					typeof dflt === "object" &&
					dflt !== null &&
					"queryChunks" in dflt
				)
			const seeded = rows.some((r) => {
				const v = r.values[prop]
				if (isEmptyish(v, dflt, plain)) return false
				return !(plain && show(v) === show(dflt))
			})
			if (seeded && reason)
				gaps.push(
					`${name}.${prop}: in NOT_SEEDED but the seed holds a value`
				)
			if (!seeded && !reason)
				gaps.push(
					`${name}.${prop}: no row of the full seed holds a non-default value`
				)
		}
		for (const prop of Object.keys(NOT_SEEDED[name] ?? {}))
			if (!(prop in columns))
				gaps.push(`${name}.${prop}: in NOT_SEEDED but not a column`)
	}
	for (const name of Object.keys(NOT_SEEDED))
		if (!BOOK_TABLE_LIST.some((t) => t.name === name))
			gaps.push(`${name}: in NOT_SEEDED but not a book table`)
	return gaps
}

// ── Named allowances ────────────────────────────────────────────────────────

interface Allowance {
	match: RegExp
	reason: string
}

/**
 * Every difference a test prints must match an allowance, and every allowance
 * must match a difference: a stale one fails. Patterns carry no user or row id
 * (`user:\d+`).
 */
function expectOnlyAllowed(diff: string[], allowed: Allowance[]) {
	const unlisted = diff.filter((d) => !allowed.some((a) => a.match.test(d)))
	const stale = allowed
		.filter((a) => !diff.some((d) => a.match.test(d)))
		.map((a) => String(a.match))
	expect({ unlisted, stale }).toEqual({ unlisted: [], stale: [] })
}

// By design.
const U_LINES =
	"★ unclear (ruling conflict): a file carries main only — docs/lorebooks.md 'it lists what the file can't bring back (such as branches, dated changes and scenes captured from sessions)'; lorebookExportBuilder.ts header. ★ owner: the programme asks to carry lines"
const D_DATED =
	"by design: dated changes stay with the book — docs/lorebooks.md 'such as branches, dated changes …'; counted by overwriteLosses (amendments, presences)"
const D_EDIT_HISTORY =
	"by design: docs/lorebooks.md 'The edit history belongs to the lorebook and never travels: … a lorebook file carr[ies] none'"
const D_MERGE_UNDO =
	"by design: a merge's undo record is the original's (tableRegistry.ts bindingMergeLogs: 'an undo record of the original's rows'; docs/lorebooks.md 'the undo of a past merge stays with the original')"
const D_INDEXING =
	"by design: derived; docs/lorebooks.md 'An imported book is queued for search indexing straight away.'"
const D_SHEETS =
	"by design: overwriteLosses statsNoFileCarries — 'every stat sheet assigned to the book … that no file carries, whatever its format'"
const D_NEW_BOOK = "by design: docs/lorebooks.md 'It always makes a new book'"
const D_IMPORTER_WRITES =
	"by design: the import writes each member's base version as the importing person (writtenBy user:N)"
const D_ST_MIRROR =
	"by design: the file's SillyTavern mirror keys are re-derived from the row on every export (lorebookExportMapper.ts mapEntry: 'The row is authoritative'); the import keeps the entry's whole foreign bag"
const D_DUP_SCENE =
	"by design: a copy has no session (docs/lorebooks.md 'Scenes in the copy keep their summaries but not the session messages they were captured from'; tableRegistry.ts scenes '★4b: … custom from here on')"
const D_HELD =
	"by design: a held amendment is one session's own change on another book's entry: a copy never carries it (tableRegistry.ts entryAmendments)"
const D_FROZEN_SEED =
	"the frozen base seed's own artefact, not a loss: provenance 'model' is not one this app writes (ENTRY_PROVENANCES); scene cast is numbered per role (writeSceneCast)"

// Owner ruling 2026-11-16 (D37a): the file's format is frozen while export is paused.
const D_FROZEN_FORMAT =
	"ruling 2026-11-16 D37a ('Back them out. We aren't ready to re-enable exports.'; 2026-09-28 'never re-enable export or widen its format without a new ruling'): the file's format is frozen while export is paused, so a member's own sheet, a carded member's aliases and a card-less member's name and nickname are not carried"

// Unclear, left for the owner.
const U_IMAGES =
	"★ unclear: images are not in the file (cover, a member's face, sprite sets and sprites, gallery files)"
const U_TAGS = "★ unclear: tags are not in the file"
const U_WRITE_MODE =
	"★ unclear: the book's Writes from sessions (loreWriteMode) is not in the file"
const U_ANNEX = "★ unclear: the annex is not in the file"
const U_UNFILED_SCENE =
	"★ unclear: an unfiled scene goes out under a synthetic empty history entry (lorebookExportBuilder.ts §0-B), which the import writes as a real history day; its opened story clock is not in the file"
const U_DERIVED_FROM =
	"★ unclear: an entry's library origin (derivedFrom) is not in the file"
const U_DISMISSED_SUGGESTIONS =
	"★ unclear: dismissed duplicate pairs and binding suggestions are not in the file"
const U_RULES_RUN =
	"★ unclear: a link's rules run (rulesRunId) is not in the file"

const allow = (match: RegExp, reason: string): Allowance => ({ match, reason })

// One allowance per family of differences, shared by the tests that show it.
const BOOK_COVER = allow(
	/^lorebooks @book: coverMediaId a="file:[0-9a-f]{12}" b=null$/,
	U_IMAGES
)
const BOOK_WRITE_MODE = allow(
	/^lorebooks @book: loreWriteMode a="review" b="full"$/,
	U_WRITE_MODE
)
const BOOK_KIND = allow(
	/^lorebooks @book: kind a="starter_kit" b="book"$/,
	D_NEW_BOOK
)
const BOOK_ANNEX = allow(
	/^lorebooks @book: annex(Audiences|Versions)? a=.* b=\{\}$/,
	U_ANNEX
)
const BRANCH_ROWS = allow(
	/^lorebook_branches @branch:.*: missing in b$/,
	U_LINES
)
const LINE_ENTRIES = allow(
	/^lorebook_entries @entry:.*@(North road|Ambush): missing in b$/,
	U_LINES
)
const ENTRY_POSITION = allow(
	/^lorebook_entries @entry:.*@main: position a=\d+ b=\d+$/,
	U_LINES
)
const ENTRY_DERIVED_FROM = allow(
	/^lorebook_entries @entry:.*: derivedFrom a=\{.*\} b=null$/,
	U_DERIVED_FROM
)
const ENTRY_ST_MIRROR = allow(
	/^lorebook_entries @entry:.*: extraJson a=\{"note":"heard at the tavern"\} b=\{"note":"heard at the tavern","selectiveLogic":3\}$/,
	D_ST_MIRROR
)
const UNFILED_DAY = allow(
	/^lorebook_entries @entry:core:entry\/history:@main: extra in b$/,
	U_UNFILED_SCENE
)
const UNFILED_SCENE = allow(
	/^scenes @scene:The open scene@main: (historyEntryId a=null b="entry:core:entry\/history:@main"|openedStoryClock(Year|Month|Day) a=\d+ b=null)$/,
	U_UNFILED_SCENE
)
const VECTORS = allow(
	/^lorebook_entry_vectors @vector:.*: missing in b$/,
	D_INDEXING
)
const ANNOTATIONS = allow(
	/^entry_annotations @annotation:.*: missing in b$/,
	D_INDEXING
)
const REDLINES = allow(
	/^lore_redlines @redline:.*: missing in b$/,
	D_EDIT_HISTORY
)
const LINE_SCENES = allow(
	/^scenes @scene:.*@(North road|Ambush): missing in b$/,
	U_LINES
)
const LINE_SCENE_CAST = allow(
	/^scene_characters @sceneCast:scene:.*@(North road|Ambush)\/.*: missing in b$/,
	U_LINES
)
const LINE_LINKS = allow(
	/^narrative_relationships @link:.*@(North road|Ambush)\b.*: missing in b$/,
	U_LINES
)
const LINE_AMENDMENTS = allow(
	/^entry_amendments @amend:.*@(North road|Ambush): missing in b$/,
	U_LINES
)
const MAIN_AMENDMENTS = allow(
	/^entry_amendments @amend:.*@main: missing in b$/,
	D_DATED
)
const CAST_AMENDMENTS = allow(
	/^cast_amendments @castAmendment:.*: missing in b$/,
	D_DATED
)
const VERSION_WRITTEN_BY = allow(
	/^character_versions @version:.*: writtenBy a=null b="user:\d+"$/,
	D_IMPORTER_WRITES
)
const LINE_VERSIONS = allow(
	/^character_versions @version:.*@(North road|Ambush)#.*: missing in b$/,
	U_LINES
)
const DATED_VERSIONS = allow(
	/^character_versions @version:.*@main#\d.*: missing in b$/,
	D_DATED
)
const LINE_PRESENCES = allow(
	/^cast_presences @presence:.*@(North road|Ambush)#.*: missing in b$/,
	U_LINES
)
const MAIN_PRESENCES = allow(
	/^cast_presences @presence:.*@main#.*: missing in b$/,
	D_DATED
)
const MEMBER_IMAGES = allow(
	/^(sprite_sets|sprites|cast_member_files) @.*: missing in b$/,
	U_IMAGES
)
const BOOK_TAGS = allow(/^lorebook_tags @tag:.*: missing in b$/, U_TAGS)
const CAST_CURATION = allow(
	/^(dismissed_duplicate_pairs|binding_suggestions) @.*: missing in b$/,
	U_DISMISSED_SUGGESTIONS
)
const MERGE_LOGS = allow(
	/^binding_merge_logs @.*: (missing|extra) in b$/,
	D_MERGE_UNDO
)
const LINE_STATS = allow(
	/^attribute_(configs|values) @.*@(North road|Ambush): missing in b$/,
	U_LINES
)
// A member's own sheet and aliases are not carried (D37a). Maren is the seed's carded member.
const MEMBER_SHEET = allow(
	/^(lorebook_bindings @member:Maren|character_versions @version:member:Maren@main#-----\/p-): (aliases|description|personality|scenario|retold|follows) a=/,
	D_FROZEN_FORMAT
)
// The seed's card-less member comes back under its base name (its nickname is not carried).
const CARDLESS_NAME = allow(
	/^(lorebook_bindings @member:(The Crow|Rook)|character_versions @version:member:(The Crow|Rook)@main#-----\/p-|scene_characters @sceneCast:scene:.*\/member:(The Crow|Rook)\/participant|narrative_relationships @link:member:Maren->member:(The Crow|Rook):.*): (missing|extra) in b$/,
	D_FROZEN_FORMAT
)
// The locks are columns the frozen file format has no key for.
const ENTRY_LOCK = allow(
	/^lorebook_entries @entry:.*: entryLock a=true b=false$/,
	D_FROZEN_FORMAT
)
const MEMBER_LOCK = allow(
	/^lorebook_bindings @member:.*: castMemberLock a=true b=false$/,
	D_FROZEN_FORMAT
)
const OWNER_SHEETS = allow(/^owner_sheets @.*: missing in b$/, D_SHEETS)

// What the seed's two members show, after the realistic seed.
const ROUND_TRIP_ALLOWED: Allowance[] = [
	ENTRY_LOCK,
	MEMBER_LOCK,
	BOOK_COVER,
	BOOK_WRITE_MODE,
	BOOK_KIND,
	BOOK_ANNEX,
	BRANCH_ROWS,
	MEMBER_SHEET,
	CARDLESS_NAME,
	LINE_ENTRIES,
	ENTRY_POSITION,
	ENTRY_DERIVED_FROM,
	ENTRY_ST_MIRROR,
	UNFILED_DAY,
	UNFILED_SCENE,
	VECTORS,
	ANNOTATIONS,
	REDLINES,
	LINE_SCENES,
	LINE_SCENE_CAST,
	LINE_LINKS,
	LINE_AMENDMENTS,
	MAIN_AMENDMENTS,
	CAST_AMENDMENTS,
	VERSION_WRITTEN_BY,
	LINE_VERSIONS,
	DATED_VERSIONS,
	LINE_PRESENCES,
	MAIN_PRESENCES,
	MEMBER_IMAGES,
	BOOK_TAGS,
	CAST_CURATION,
	MERGE_LOGS,
	LINE_STATS,
	OWNER_SHEETS
]
const DUPLICATE_ALLOWED: Allowance[] = [
	allow(/^lore_redlines @redline:.*: missing in b$/, D_EDIT_HISTORY),
	allow(
		/^scenes @scene:.*: (nameIsDefault a=true b=false|selectedMessageIds a=\[7,8\] b=\[\])$/,
		D_DUP_SCENE
	),
	allow(
		/^entry_amendments @amend:entry:core:entry\/location:The Tavern@main#.*: missing in b$/,
		D_HELD
	),
	CAST_AMENDMENTS,
	MERGE_LOGS
]
const OVERWRITE_ALLOWED: Allowance[] = [
	ENTRY_LOCK,
	MEMBER_LOCK,
	MEMBER_SHEET,
	CARDLESS_NAME,
	ENTRY_POSITION,
	ENTRY_DERIVED_FROM,
	ENTRY_ST_MIRROR,
	UNFILED_DAY,
	UNFILED_SCENE,
	VECTORS,
	ANNOTATIONS,
	REDLINES,
	MAIN_AMENDMENTS,
	VERSION_WRITTEN_BY,
	DATED_VERSIONS,
	MAIN_PRESENCES,
	MEMBER_IMAGES,
	CAST_CURATION,
	MERGE_LOGS,
	OWNER_SHEETS
]
const OLD_FILE_ALLOWED: Allowance[] = [
	MEMBER_LOCK,
	MEMBER_SHEET,
	BOOK_COVER,
	BOOK_WRITE_MODE,
	BRANCH_ROWS,
	LINE_ENTRIES,
	allow(
		/^lorebook_entries @entry:.*: provenance a="model" b="human"$/,
		D_FROZEN_SEED
	),
	UNFILED_DAY,
	UNFILED_SCENE,
	allow(/^scene_characters @sceneCast:.*: ordinal a=1 b=0$/, D_FROZEN_SEED),
	LINE_LINKS,
	MAIN_AMENDMENTS,
	LINE_AMENDMENTS,
	VERSION_WRITTEN_BY,
	LINE_VERSIONS,
	MAIN_PRESENCES,
	BOOK_TAGS
]

// ── Tests ───────────────────────────────────────────────────────────────────

async function bookRow(id: number) {
	const [row] = await testDb
		.select()
		.from(schema.lorebooks)
		.where(eq(schema.lorebooks.id, id))
	return row
}

describe("lorebook round trip, duplicate, overwrite and old file (measurement)", () => {
	test("the full seed holds a value in every compared column", async () => {
		const owner = await makeUser("io1-coverage")
		const seeded = await seedRoundTripBook(owner.id)
		await extendSeed(owner.id, seeded.bookId)
		const s = await snapshotBook(seeded.bookId)
		expectSeeded(s, FULL_COUNTS)
		expect(coverageGaps(s)).toEqual([])
	})

	test("export, then import as a new book", async () => {
		const owner = await makeUser("io1-roundtrip")
		const seeded = await seedRoundTripBook(owner.id)
		await extendSeed(owner.id, seeded.bookId)
		const file = await exportFile(seeded.bookId, owner.id)
		const a = await snapshotBook(seeded.bookId)
		expectSeeded(a, FULL_COUNTS)

		// One change the file comparison sees, so the import asks what to do.
		await testDb
			.update(schema.lorebooks)
			.set({ description: "Changed after the export." })
			.where(eq(schema.lorebooks.id, seeded.bookId))

		const first = await importAsConflict(owner.id, file)
		expect(first.status).toBe("conflict")
		const { lorebookImportResolveHandler } = await import("./lorebooks")
		const resolved: any = await lorebookImportResolveHandler.handler(
			fakeSocket(owner.id),
			{
				action: "createNew",
				heldImportId: first.conflict.heldImportId,
				existingId: first.conflict.existingLorebook.id
			},
			noopEmit
		)
		const copyId: number = resolved.lorebook.id
		expect(copyId).not.toBe(seeded.bookId)

		// The file carries no edit history: the copy's scenes have no row.
		const copiedScenes = await testDb
			.select({ id: schema.scenes.id })
			.from(schema.scenes)
			.where(eq(schema.scenes.lorebookId, copyId))
		expect(copiedScenes.length).toBeGreaterThan(0)
		expect(
			await testDb
				.select({ id: schema.loreRedlines.id })
				.from(schema.loreRedlines)
				.where(
					inArray(
						schema.loreRedlines.sceneId,
						copiedScenes.map((x) => x.id)
					)
				)
		).toEqual([])

		const b = await snapshotBook(copyId)
		const diff = [
			...identityDiff(
				await bookRow(seeded.bookId),
				await bookRow(copyId),
				{
					name: (await bookRow(seeded.bookId)).name,
					userId: owner.id
				}
			),
			...diffSnapshots(a, b)
		]
		log("export -> import as a new book", diff)
		expectOnlyAllowed(diff, ROUND_TRIP_ALLOWED)
	})

	test("duplicate", async () => {
		const owner = await makeUser("io1-duplicate")
		const seeded = await seedRoundTripBook(owner.id)
		await extendSeed(owner.id, seeded.bookId)
		const { lorebooksDuplicateHandler } = await import("./lorebooks")
		const { lorebook: copy } = await lorebooksDuplicateHandler.handler(
			fakeSocket(owner.id),
			{ lorebookId: seeded.bookId },
			noopEmit
		)
		const a = await snapshotBook(seeded.bookId)
		const b = await snapshotBook(copy.id)
		expectSeeded(a, FULL_COUNTS)
		const source = await bookRow(seeded.bookId)
		const diff = [
			...identityDiff(source, copy, {
				name: `${source.name} (copy)`,
				userId: owner.id
			}),
			...diffSnapshots(a, b)
		]
		log("duplicate", diff)
		// The registry's `notCopied` tables hold nothing in the copy.
		for (const table of [
			"cast_amendments",
			"lore_redlines",
			"binding_merge_logs"
		])
			expect(b[table]).toEqual([])
		expectOnlyAllowed(diff, DUPLICATE_ALLOWED)
	})

	test("overwrite", async () => {
		const owner = await makeUser("io1-overwrite")
		const seeded = await seedRoundTripBook(owner.id)
		await extendSeed(owner.id, seeded.bookId)
		const file = await exportFile(seeded.bookId, owner.id)
		const exported = mainLineOnly(await snapshotBook(seeded.bookId))

		// Change the book after the export.
		await testDb
			.update(schema.lorebookEntries)
			.set({ content: "Changed after the export." })
			.where(eq(schema.lorebookEntries.lorebookId, seeded.bookId))
		await insertEntry(seeded.bookId, {
			typeId: "core:entry/world-lore",
			name: "Added after the export",
			content: "New."
		})

		const conflict = await importAsConflict(owner.id, file)
		expect(conflict.status).toBe("conflict")
		// The prompt names what an overwrite cannot bring back.
		expect(conflict.conflict.losses).toEqual(
			expect.objectContaining({
				branches: 2,
				amendments: 4,
				presences: 2
			})
		)

		const { lorebookImportResolveHandler } = await import("./lorebooks")
		await lorebookImportResolveHandler.handler(
			fakeSocket(owner.id),
			{
				action: "overwrite",
				heldImportId: conflict.conflict.heldImportId,
				existingId: seeded.bookId
			},
			noopEmit
		)
		const after = mainLineOnly(await snapshotBook(seeded.bookId))
		const diff = diffSnapshots(exported, after)
		log(
			"overwrite (main line, against the snapshot taken right after the export)",
			diff
		)
		expectOnlyAllowed(diff, OVERWRITE_ALLOWED)
	})

	test("old file", async () => {
		const stranger = await makeUser("io1-oldfile")
		const fresh = await makeUser("io1-oldfile-seed")
		const lorebookJson = await fs.readFile(FIXTURE, "utf-8")
		const res = await importAsConflict(stranger.id, lorebookJson)
		expect(res.status).toBe("created")
		// The base seed alone: the fixture was exported from exactly it.
		const seeded = await seedRoundTripBook(fresh.id)

		const a = await snapshotBook(seeded.bookId)
		expectSeeded(a, BASE_COUNTS)
		const b = await snapshotBook(res.lorebook.id)
		const diff = [
			...identityDiff(
				await bookRow(seeded.bookId),
				await bookRow(res.lorebook.id),
				{
					name: (await bookRow(seeded.bookId)).name,
					userId: stranger.id
				}
			),
			...diffSnapshots(a, b)
		]
		log(
			"old file (format 2, 2026-11-16) imported by a fresh user, against a fresh base seed",
			diff
		)
		expectOnlyAllowed(diff, OLD_FILE_ALLOWED)
	})

	test("a member's own sheet and aliases are not carried by the file", async () => {
		// Owner ruling 2026-11-16 (D37a): the file's format is frozen while export is paused.
		const owner = await makeUser("io2-frozen")
		const seeded = await seedRoundTripBook(owner.id)
		await extendSeed(owner.id, seeded.bookId)
		const file = JSON.parse(await exportFile(seeded.bookId, owner.id))
		const bindings = file.extensions.serenepub.bindings
		expect(bindings.length).toBeGreaterThan(0)
		const allowedKeys = new Set([
			"localId",
			"bindingText",
			"kind",
			"characterLocalId",
			"personaLocalId",
			"spriteSet",
			"ownName",
			"ownNickname"
		])
		for (const b of bindings)
			expect(Object.keys(b).filter((k) => !allowedKeys.has(k))).toEqual([])
	})

	test("an older file that carries the member-sheet keys imports, and the keys are ignored", async () => {
		const stranger = await makeUser("io2-oldkeys")
		const file = JSON.parse(await fs.readFile(FIXTURE, "utf-8"))
		for (const b of file.extensions.serenepub.bindings)
			Object.assign(b, {
				nickname: "Nick",
				description: "A carried description.",
				personality: "A carried personality.",
				scenario: "A carried scenario.",
				firstMessage: "Hello.",
				alternateGreetings: ["Hi."],
				groupOnlyGreetings: ["Hey."],
				exampleDialogues: "A: x",
				postHistoryInstructions: "Be brief.",
				creatorNotes: { text: "note", variants: {} },
				timbre: { description: "low" },
				retold: { description: true }
			})
		const res = await importAsConflict(stranger.id, JSON.stringify(file))
		expect(res.status).toBe("created")
		const members = await testDb
			.select()
			.from(schema.lorebookBindings)
			.where(eq(schema.lorebookBindings.lorebookId, res.lorebook.id))
		expect(members.length).toBe(2)
		for (const m of members) {
			expect(m.description ?? "").toBe("")
			expect(m.personality ?? "").toBe("")
			expect(m.scenario ?? "").toBe("")
			expect(m.retold ?? {}).toEqual({})
		}
	})
})
