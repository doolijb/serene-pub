/**
 * Shared test-only fixtures for the prompt and ranking suites — not a test
 * file itself (no *.test.ts suffix), so vitest's `include` pattern never picks
 * it up as its own suite.
 *
 * Two kinds of fixtures:
 *  - In-memory builders (worldLoreEntry, characterLoreEntry, sessionCharacter,
 *    buildSession, ...) — plain objects matching the shapes the lore path
 *    reads. Nothing on that path touches the DB for lore
 *    content itself, so most tests never need a real row for these.
 *  - DB insert helpers (insertLorebook, insertNarrativeNode, ...) — for the
 *    handful of code paths that *do* run real drizzle queries (the narrative
 *    graph section, and RAG's embedding similarity search),
 *    backed by the real in-memory PGlite instance from testDb.ts.
 */
import Handlebars from "handlebars"
import { eq } from "drizzle-orm"
import type { TestDb } from "$lib/server/utils/testDb"
import * as schema from "$lib/server/db/schema"
import {
	CHARACTER_LORE_TYPE_ID,
	DEFAULT_VECTOR_NAME,
	HISTORY_TYPE_ID,
	WORLD_LORE_TYPE_ID,
	entryInsert,
	nextPosition,
	toEntryRow,
	type EntryTypeId,
	type InsertLorebookEntry,
	type LorebookEntry,
	type NewLorebookEntry
} from "$lib/server/utils/lorebookEntries"
import { splitKeys, type KeyList } from "$lib/server/pipelines/ranking/signals"

/**
 * A fixture row, stated partially.
 *
 * `lorebookId` is required because a fixture always knows which book it is in;
 * `id` is optional and honoured, because several suites pin ids so their
 * assertions can name a row.
 */
type EntryOverrides<T extends EntryTypeId> = WithKeyLists<
	Partial<NewLorebookEntry<T>>
> & {
	// Both server-allocated on the real write path, and both legitimately
	// stated by a fixture: several suites pin an id so their assertions can
	// name a row, and several pin a position so their ordering assertions mean
	// something.
	id?: number
	position?: number
}
/**
 * Keys as a fixture may state them: the list the wire carries, or a comma
 * string for brevity (`"gate, warden"`). A string is split once, here, on the
 * way in — the writer's legacy boundary — never on the wire (finding #146).
 */
type WithKeyLists<T> = Omit<T, "keys" | "secondaryKeys"> & {
	keys?: KeyList
	secondaryKeys?: KeyList
}

/** An in-memory builder's overrides, with its keys normalised to the list. */
const keyedOverrides = <T extends { keys?: KeyList; secondaryKeys?: KeyList }>(
	overrides: T
) => ({
	...overrides,
	...(overrides.keys === undefined ? {} : { keys: splitKeys(overrides.keys) }),
	...(overrides.secondaryKeys === undefined
		? {}
		: { secondaryKeys: splitKeys(overrides.secondaryKeys) })
})

type SeedRow<T extends EntryTypeId> = EntryOverrides<T> & {
	lorebookId: number
}
import { registerContextHandlebarsHelpers } from "$lib/shared/utils/contextHandlebarsHelpers"
import { PromptFormats } from "$lib/shared/constants/PromptFormats"

let idCounter = 1

/** Monotonic id generator for in-memory-only fixtures (never inserted into the DB). */
export function nextId(): number {
	return idCounter++
}

// ─── Template / handlebars / token counter ─────────────────────────────────

/**
 * Deliberately minimal — just enough to expose every field the engines write
 * into the template context, so tests can assert on rendered substrings
 * without depending on the real production template in defaults.ts.
 */
export const TEST_TEMPLATE = `WORLDLORE:{{{worldLore}}}
CHARACTERS:{{{characters}}}
PERSONAS:{{{personas}}}
CHARLORE:{{#each characterLore}}{{{name}}}||{{/each}}
HISTORY:{{{history}}}
CURRENTDATE:{{{currentDate}}}
GRAPH:{{{narrativeGraph}}}
MESSAGES:
{{#each sessionMessages as |sessionMessage msgIndex|}}{{#with ../postHistory}}{{#if (and (eq msgIndex targetIndex) hasContent)}}POSTHISTORY:[{{{instructions}}}][{{{charInstructions}}}][{{{exampleDialogue}}}]
{{/if}}{{/with}}{{{name}}}|{{{message}}}
{{/each}}`

export function makeHandlebars(): typeof Handlebars {
	const hb = Handlebars.create()
	registerContextHandlebarsHelpers(hb, { promptFormat: PromptFormats.VICUNA })
	return hb
}

export function makeContextConfig(template: string = TEST_TEMPLATE): any {
	return { template }
}

/** 1 char = 1 token — deterministic and easy to reason about in budget tests. */
export function makeTokenCounter(): {
	countTokens: (text: string) => Promise<number>
} {
	return {
		countTokens: async (text: string) => text.length
	}
}

export function makeTemplateContext(overrides: Partial<any> = {}): any {
	return {
		instructions: "",
		characters: [],
		personas: [],
		scenario: "",
		sessionMessages: [],
		char: "",
		character: "",
		user: "",
		persona: "",
		characterNames: "",
		personaNames: "",
		...overrides
	}
}

export function makeInfillOptions(overrides: Partial<any> = {}): any {
	return {
		charName: "Alice",
		seedName: "Alice",
		personaName: "Test User",
		templateContext: makeTemplateContext(),
		useChatFormat: false,
		tokenLimit: 100_000,
		contextThresholdPercent: 1,
		tokenCounter: makeTokenCounter(),
		handlebars: makeHandlebars(),
		contextConfig: makeContextConfig(),
		postHistoryDepth: 0,
		postHistoryTokenTrigger: 0,
		...overrides
	}
}

// ─── In-memory entry builders ───────────────────────────────────────────────

export function worldLoreEntry(
	overrides: WithKeyLists<Partial<LorebookEntry<typeof WORLD_LORE_TYPE_ID>>> = {}
): LorebookEntry<typeof WORLD_LORE_TYPE_ID> {
	const id = overrides.id ?? nextId()
	return {
		id,
		lorebookId: 1,
		typeId: WORLD_LORE_TYPE_ID,
		name: `World Lore ${id}`,
		category: null,
		keys: [],
		// No condition — the state every stored row lands in, spelled as the
		// pair that means it: no keys, no mode. See `selectiveLogicHolds`.
		secondaryKeys: [],
		selectiveLogic: null,
		useRegex: false,
		// Null, not zero: an entry nobody has ruled on defers to the node.
		recursionDepth: null,
		caseSensitive: false,
		// A fixture entry is a root; the `parent` role is what a test sets.
		anchorEntryId: null,
		// Shared: a fixture belongs to every line, which is what null means.
		branchId: null,
		matchMode: null,
		content: "Some world lore content.",
		priority: 1,
		constant: false,
		enabled: true,
		// A fixture row is one a person wrote and has not shelved.
		archived: false,
		provenance: "human",
		extraJson: {},
		createdAt: new Date() as any,
		updatedAt: new Date() as any,
		position: 0,
		embedding: null,
		embeddingModel: null,
		vectorizedAt: null,
		...keyedOverrides(overrides)
	}
}

export function characterLoreEntry(
	overrides: WithKeyLists<Partial<LorebookEntry<typeof CHARACTER_LORE_TYPE_ID>>> = {}
): LorebookEntry<typeof CHARACTER_LORE_TYPE_ID> {
	const id = overrides.id ?? nextId()
	return {
		id,
		lorebookId: 1,
		typeId: CHARACTER_LORE_TYPE_ID,
		lorebookBindingId: null,
		name: `Character Lore ${id}`,
		keys: [],
		// No condition — the state every stored row lands in, spelled as the
		// pair that means it: no keys, no mode. See `selectiveLogicHolds`.
		secondaryKeys: [],
		selectiveLogic: null,
		useRegex: false,
		// Null, not zero: an entry nobody has ruled on defers to the node.
		recursionDepth: null,
		caseSensitive: false,
		// A fixture entry is a root; the `parent` role is what a test sets.
		anchorEntryId: null,
		// Shared: a fixture belongs to every line, which is what null means.
		branchId: null,
		matchMode: null,
		content: "Some character lore content.",
		priority: 1,
		constant: false,
		enabled: true,
		// A fixture row is one a person wrote and has not shelved.
		archived: false,
		provenance: "human",
		extraJson: {},
		createdAt: new Date() as any,
		updatedAt: new Date() as any,
		position: 0,
		embedding: null,
		embeddingModel: null,
		vectorizedAt: null,
		...keyedOverrides(overrides)
	} as LorebookEntry<typeof CHARACTER_LORE_TYPE_ID>
}

export function historyEntry(
	overrides: WithKeyLists<Partial<LorebookEntry<typeof HISTORY_TYPE_ID>>> = {}
): LorebookEntry<typeof HISTORY_TYPE_ID> {
	const id = overrides.id ?? nextId()
	return {
		id,
		lorebookId: 1,
		typeId: HISTORY_TYPE_ID,
		// History declares no `title` role, so its wire row carries none.
		name: null,
		year: 1000,
		month: null,
		day: null,
		keys: [],
		// No condition — the state every stored row lands in, spelled as the
		// pair that means it: no keys, no mode. See `selectiveLogicHolds`.
		secondaryKeys: [],
		selectiveLogic: null,
		useRegex: false,
		// Null, not zero: an entry nobody has ruled on defers to the node.
		recursionDepth: null,
		caseSensitive: false,
		// A fixture entry is a root; the `parent` role is what a test sets.
		anchorEntryId: null,
		// Shared: a fixture belongs to every line, which is what null means.
		branchId: null,
		matchMode: null,
		content: "Some history content.",
		constant: false,
		enabled: true,
		// A fixture row is one a person wrote and has not shelved.
		archived: false,
		provenance: "human",
		extraJson: {},
		createdAt: new Date() as any,
		updatedAt: new Date() as any,
		position: 0,
		isCompleted: false,
		graphed: false,
		embedding: null,
		embeddingModel: null,
		vectorizedAt: null,
		...keyedOverrides(overrides)
	} as LorebookEntry<typeof HISTORY_TYPE_ID>
}

export function lorebookBinding(
	overrides: Partial<SelectLorebookBinding> = {}
): SelectLorebookBinding {
	const id = overrides.id ?? nextId()
	return {
		id,
		lorebookId: 1,
		characterId: null,
		personaId: null,
		binding: `{{char:${id}}}`,
		...overrides
	} as SelectLorebookBinding
}

export function character(
	overrides: Partial<SelectCharacter> = {}
): SelectCharacter {
	const id = overrides.id ?? nextId()
	return {
		id,
		uuid: `char-uuid-${id}`,
		userId: 1,
		name: `Character ${id}`,
		nickname: null,
		characterVersion: "1.0",
		description: "A character.",
		personality: null,
		scenario: null,
		firstMessage: null,
		alternateGreetings: [],
		exampleDialogues: [],
		metadata: {},
		avatar: null,
		creatorNotes: null,
		creatorNotesMultilingual: null,
		groupOnlyGreetings: null,
		postHistoryInstructions: null,
		source: [],
		assets: [],
		createdAt: new Date() as any,
		updatedAt: new Date() as any,
		lorebookId: null,
		extensions: {},
		...overrides
	} as unknown as SelectCharacter
}

/**
 * A character the user voices — a CHARACTER row, flagged `isPersona` so a
 * fixture built here matches what the app writes. Kept under its own name
 * because the role it stands for is its own thing.
 */
export function persona(
	overrides: Partial<SelectCharacter> = {}
): SelectCharacter {
	const id = overrides.id ?? nextId()
	return {
		...character({
			id,
			uuid: `persona-uuid-${id}`,
			name: `Persona ${id}`,
			description: "A persona.",
			isPersona: true,
			isDefaultPersona: false,
			folderId: null
		}),
		...overrides
	} as unknown as SelectCharacter
}

export function sessionCharacter(
	char: SelectCharacter,
	overrides: Partial<SelectSessionCharacter> = {}
): SelectSessionCharacter & { character: SelectCharacter } {
	return {
		sessionId: 1,
		characterId: char.id,
		position: 0,
		isActive: true,
		// The cast read's name for `is_active` (host, `session_cast`).
		enabled: true,
		...overrides,
		character: char
	} as any
}

export function sessionPersona(
	p: SelectCharacter,
	overrides: Partial<SelectSessionPersona> = {}
): SelectSessionPersona & { persona: SelectCharacter } {
	return {
		sessionId: 1,
		personaId: p.id,
		position: 0,
		...overrides,
		persona: p
	} as any
}

export function sessionMessage(
	overrides: Partial<SelectSessionMessage> = {}
): SelectSessionMessage {
	const id = overrides.id ?? nextId()
	return {
		id,
		sessionId: 1,
		userId: null,
		characterId: null,
		personaId: null,
		role: "user",
		isNarratorResponse: false,
		content: `Message ${id}`,
		createdAt: new Date() as any,
		updatedAt: new Date() as any,
		isEdited: false,
		metadata: {},
		isGenerating: false,
		generationStage: null,
		error: null,
		queueItemId: null,
		isHidden: false,
		debugMeta: null,
		embedding: null,
		embeddingModel: null,
		vectorizedAt: null,
		...overrides
	} as unknown as SelectSessionMessage
}

export type TestLorebook = {
	id: number
	lorebookBindings: (SelectLorebookBinding & {
		character?: SelectCharacter | null
		persona?: SelectCharacter | null
	})[]
	worldLoreEntries: LorebookEntry<typeof WORLD_LORE_TYPE_ID>[]
	characterLoreEntries: LorebookEntry<typeof CHARACTER_LORE_TYPE_ID>[]
	historyEntries: LorebookEntry<typeof HISTORY_TYPE_ID>[]
}

export function buildLorebook(overrides: Partial<TestLorebook> = {}): any {
	return {
		id: 1,
		lorebookBindings: [],
		worldLoreEntries: [],
		characterLoreEntries: [],
		historyEntries: [],
		...overrides
	}
}

/** Builds a plain object matching the runtime shape the lore path reads off `this.session`. */
export function buildSession(overrides: Record<string, any> = {}): any {
	return {
		id: 1,
		name: "Test Session",
		isGroup: true,
		sessionType: "roleplay",
		userId: 1,
		scenario: null,
		metadata: {},
		lorebookId: null,
		lorebook: null,
		sessionCharacters: [],
		sessionPersonas: [],
		sessionMessages: [],
		...overrides
	}
}

// ─── DB-backed fixtures (narrative graph / RAG tests) ───────────────────────

export async function insertLorebook(
	db: TestDb,
	userId: number,
	overrides: Partial<InsertLorebook> = {}
) {
	const [row] = await db
		.insert(schema.lorebooks)
		.values({
			name: "Test Lorebook",
			userId,
			...overrides
		})
		.returning()
	return row
}

export async function insertCharacterRow(
	db: TestDb,
	userId: number,
	overrides: Partial<InsertCharacter> = {}
) {
	const [row] = await db
		.insert(schema.characters)
		.values({
			userId,
			name: "Character",
			description: "A character.",
			...overrides
		})
		.returning()
	return row
}

/** A character row flagged as one the user plays — see `persona()` above. */
export async function insertPersonaRow(
	db: TestDb,
	userId: number,
	overrides: Partial<InsertCharacter> = {}
) {
	const [row] = await db
		.insert(schema.characters)
		.values({
			userId,
			isPersona: true,
			name: "Persona",
			description: "A persona.",
			...overrides
		})
		.returning()
	return row
}

export async function insertSessionRow(
	db: TestDb,
	userId: number,
	overrides: Partial<InsertSession> = {}
) {
	const [row] = await db
		.insert(schema.sessions)
		.values({ userId, isGroup: true, ...overrides })
		.returning()
	return row
}

export async function insertLorebookBindingRow(
	db: TestDb,
	lorebookId: number,
	overrides: Partial<InsertLorebookBinding> = {}
) {
	const [row] = await db
		.insert(schema.lorebookBindings)
		.values({
			lorebookId,
			binding: "{{char:1}}",
			...overrides
		})
		.returning()
	return row
}

/**
 * Post-merge (see the lorebookBindings/narrativeNodes merge plan), a "node"
 * IS a lorebookBindings row — this writes the node-shaped fields onto the
 * binding row named by `overrides.lorebookBindingId` (an UPDATE, not a
 * separate table insert) and returns it, so the returned `.id` equals the
 * binding's own id. Kept as a distinctly-named helper (rather than folding
 * call sites into insertLorebookBindingRow directly) since most tests build
 * the binding and its graph-state overrides at different points.
 */
export async function insertNarrativeNodeRow(
	db: TestDb,
	lorebookId: number,
	overrides: Partial<InsertNarrativeNode> & {
		lorebookBindingId?: number
	} = {}
) {
	const { lorebookBindingId, ...rest } = overrides
	if (lorebookBindingId != null) {
		const [row] = await db
			.update(schema.lorebookBindings)
			.set({ name: "Node", ...rest } as any)
			.where(eq(schema.lorebookBindings.id, lorebookBindingId))
			.returning()
		return row
	}
	// No binding supplied — create a standalone unbound row (background/NPC
	// node with no character/persona attached).
	const [row] = await db
		.insert(schema.lorebookBindings)
		.values({
			lorebookId,
			name: "Node",
			binding: `{{char:test-${lorebookId}-${Math.random().toString(36).slice(2)}}}`,
			...rest
		} as any)
		.returning()
	return row
}

export async function insertNarrativeRelationshipRow(
	db: TestDb,
	lorebookId: number,
	fromNodeId: number,
	toNodeId: number,
	overrides: Partial<InsertNarrativeRelationship> = {}
) {
	const [row] = await db
		.insert(schema.narrativeRelationships)
		.values({
			lorebookId,
			fromNodeId,
			toNodeId,
			status: "active",
			...overrides
		})
		.returning()
	return row
}

export async function insertSessionCharacterRow(
	db: TestDb,
	sessionId: number,
	characterId: number,
	overrides: Partial<InsertSessionCharacter> = {}
) {
	const [row] = await db
		.insert(schema.sessionCharacters)
		.values({ sessionId, characterId, ...overrides })
		.returning()
	return row
}

export async function insertSessionPersonaRow(
	db: TestDb,
	sessionId: number,
	personaId: number,
	overrides: Partial<InsertSessionPersona> = {}
) {
	const [row] = await db
		.insert(schema.sessionPersonas)
		.values({ sessionId, personaId, ...overrides })
		.returning()
	return row
}

export async function insertSessionMessageRow(
	db: TestDb,
	sessionId: number,
	overrides: Partial<InsertSessionMessage> = {}
) {
	const [row] = await db
		.insert(schema.sessionMessages)
		.values({ sessionId, role: "user", content: "Hello", ...overrides })
		.returning()
	return row
}

/**
 * Legacy-shaped seed rows → `lorebook_entries` values, numbered in call order.
 *
 * ⚠ **`position` has no column default on the one table and is unique per
 * `(lorebook_id, type_id)`**, so a fixture seeding entries into a book has to
 * say where each one goes, and two separate calls into the same book must not
 * both start at 1. The counter is per `(lorebook, type)` and per test file —
 * each file gets its own module instance and its own database — so what it
 * produces is "the order they were seeded in", which is what a fixture means.
 * A row that states its own `position` keeps it, and so does one that states
 * its own `id` — several suites pin ids so their assertions can name a row.
 */
const seedPositions = new Map<string, number>()
const nextSeedPosition = (lorebookId: number, typeId: string): number => {
	const key = `${lorebookId}:${typeId}`
	const next = (seedPositions.get(key) ?? 0) + 1
	seedPositions.set(key, next)
	return next
}

export const worldLoreValues = (
	rows: Array<SeedRow<typeof WORLD_LORE_TYPE_ID>>
): InsertLorebookEntry[] =>
	rows.map((r) => ({
		...entryInsert({
			typeId: WORLD_LORE_TYPE_ID,
			position: nextSeedPosition(r.lorebookId, WORLD_LORE_TYPE_ID),
			...r
		}),
		...(r.id === undefined ? {} : { id: r.id })
	}))

export const characterLoreValues = (
	rows: Array<SeedRow<typeof CHARACTER_LORE_TYPE_ID>>
): InsertLorebookEntry[] =>
	rows.map((r) => ({
		...entryInsert({
			typeId: CHARACTER_LORE_TYPE_ID,
			position: nextSeedPosition(r.lorebookId, CHARACTER_LORE_TYPE_ID),
			...r
		}),
		...(r.id === undefined ? {} : { id: r.id })
	}))

export const historyValues = (
	rows: Array<SeedRow<typeof HISTORY_TYPE_ID>>
): InsertLorebookEntry[] =>
	rows.map((r) => ({
		...entryInsert({
			typeId: HISTORY_TYPE_ID,
			position: nextSeedPosition(r.lorebookId, HISTORY_TYPE_ID),
			...r
		}),
		...(r.id === undefined ? {} : { id: r.id })
	}))

/**
 * Insert entry rows in chunks, and hand back their ids.
 *
 * ⚠ **Chunked because one statement of a few thousand entries no longer fits
 * on the wire.** A row is sixteen bind parameters on the one table where it was
 * six on the three, so a fixture that seeded past the RAG fetch cap in a single
 * `values([...])` now overflows the protocol before Postgres ever sees it. The
 * chunk size is arbitrary and only has to be small.
 */
export async function seedEntries(
	db: TestDb,
	values: InsertLorebookEntry[],
	chunkSize = 250
): Promise<number[]> {
	const ids: number[] = []
	for (let i = 0; i < values.length; i += chunkSize) {
		const rows = await db
			.insert(schema.lorebookEntries)
			.values(values.slice(i, i + chunkSize))
			.returning({ id: schema.lorebookEntries.id })
		ids.push(...rows.map((r) => r.id))
	}
	return ids
}

/**
 * Give entries a default-space vector, the way the queue would.
 *
 * The `embedding`/`embeddingModel`/`vectorizedAt` columns a fixture used to set
 * on the row itself are a row of their own now, so seeding one is a second
 * insert rather than three more fields.
 */
export async function seedEntryVectors(
	db: TestDb,
	entryIds: number[],
	embedding: number[],
	model: string | null,
	vectorizedAt: Date | null = new Date()
) {
	if (!entryIds.length) return
	await db.insert(schema.lorebookEntryVectors).values(
		entryIds.map((entryId) => ({
			entryId,
			vectorName: DEFAULT_VECTOR_NAME,
			chunkIndex: 0,
			model,
			dims: embedding.length,
			vector: embedding,
			vectorizedAt
		}))
	)
}

/**
 * The three entry inserters, writing rows of the declared type and handing back
 * the shape the wire still uses.
 *
 * ⚠ **`position` is allocated rather than defaulted.** It is unique per
 * `(lorebook_id, type_id)` and has no column default on the one table, so a
 * fixture that seeds two entries into a book without saying where they go used
 * to get two rows at `0` and now gets a constraint violation. The first free
 * slot is the socket handlers' own allocator, so a fixture and a real create
 * agree.
 */
async function insertEntryRow(
	db: TestDb,
	lorebookId: number,
	typeId: string,
	values: InsertLorebookEntry
) {
	const [row] = await db
		.insert(schema.lorebookEntries)
		.values({
			...values,
			position:
				values.position ?? (await nextPosition(db, lorebookId, typeId))
		})
		.returning()
	return row
}

export async function insertWorldLoreEntryRow(
	db: TestDb,
	lorebookId: number,
	overrides: EntryOverrides<typeof WORLD_LORE_TYPE_ID> = {}
) {
	return toEntryRow(
		await insertEntryRow(
			db,
			lorebookId,
			WORLD_LORE_TYPE_ID,
			entryInsert({
				typeId: WORLD_LORE_TYPE_ID,
				lorebookId,
				name: "World Lore",
				position: undefined as any,
				...overrides
			})
		)
	)
}

export async function insertCharacterLoreEntryRow(
	db: TestDb,
	lorebookId: number,
	overrides: EntryOverrides<typeof CHARACTER_LORE_TYPE_ID> = {}
) {
	return toEntryRow(
		await insertEntryRow(
			db,
			lorebookId,
			CHARACTER_LORE_TYPE_ID,
			entryInsert({
				typeId: CHARACTER_LORE_TYPE_ID,
				lorebookId,
				name: "Character Lore",
				position: undefined as any,
				...overrides
			})
		)
	)
}

export async function insertHistoryEntryRow(
	db: TestDb,
	lorebookId: number,
	overrides: EntryOverrides<typeof HISTORY_TYPE_ID> = {}
) {
	return toEntryRow(
		await insertEntryRow(
			db,
			lorebookId,
			HISTORY_TYPE_ID,
			entryInsert({
				typeId: HISTORY_TYPE_ID,
				lorebookId,
				position: undefined as any,
				...overrides
			})
		)
	)
}
