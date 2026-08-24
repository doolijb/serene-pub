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
		useSessionFormat: false,
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
	overrides: Partial<SelectWorldLoreEntry> = {}
): SelectWorldLoreEntry {
	const id = overrides.id ?? nextId()
	return {
		id,
		lorebookId: 1,
		name: `World Lore ${id}`,
		category: null,
		keys: "",
		useRegex: false,
		// Null, not zero: an entry nobody has ruled on defers to the node.
		recursionDepth: null,
		caseSensitive: false,
		// Added with the retrieval-strategy migration. NULL means "the default",
		// which keeps every existing fixture on today's behaviour.
		retrievalStrategy: null,
		matchMode: null,
		content: "Some world lore content.",
		priority: 1,
		constant: false,
		enabled: true,
		extraJson: {},
		createdAt: new Date() as any,
		updatedAt: new Date() as any,
		position: 0,
		embedding: null,
		embeddingModel: null,
		vectorizedAt: null,
		...overrides
	}
}

export function characterLoreEntry(
	overrides: Partial<SelectCharacterLoreEntry> = {}
): SelectCharacterLoreEntry {
	const id = overrides.id ?? nextId()
	return {
		id,
		lorebookId: 1,
		lorebookBindingId: null,
		name: `Character Lore ${id}`,
		keys: "",
		useRegex: false,
		// Null, not zero: an entry nobody has ruled on defers to the node.
		recursionDepth: null,
		caseSensitive: false,
		// Added with the retrieval-strategy migration. NULL means "the default",
		// which keeps every existing fixture on today's behaviour.
		retrievalStrategy: null,
		matchMode: null,
		content: "Some character lore content.",
		priority: 1,
		constant: false,
		enabled: true,
		extraJson: {},
		createdAt: new Date() as any,
		updatedAt: new Date() as any,
		position: 0,
		embedding: null,
		embeddingModel: null,
		vectorizedAt: null,
		...overrides
	} as SelectCharacterLoreEntry
}

export function historyEntry(
	overrides: Partial<SelectHistoryEntry> = {}
): SelectHistoryEntry {
	const id = overrides.id ?? nextId()
	return {
		id,
		lorebookId: 1,
		year: 1000,
		month: null,
		day: null,
		keys: "",
		useRegex: false,
		// Null, not zero: an entry nobody has ruled on defers to the node.
		recursionDepth: null,
		caseSensitive: false,
		// Added with the retrieval-strategy migration. NULL means "the default",
		// which keeps every existing fixture on today's behaviour.
		retrievalStrategy: null,
		matchMode: null,
		content: "Some history content.",
		constant: false,
		enabled: true,
		extraJson: {},
		createdAt: new Date() as any,
		updatedAt: new Date() as any,
		position: 0,
		isCompleted: false,
		graphed: false,
		embedding: null,
		embeddingModel: null,
		vectorizedAt: null,
		...overrides
	} as SelectHistoryEntry
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

export function persona(overrides: Partial<SelectPersona> = {}): SelectPersona {
	const id = overrides.id ?? nextId()
	return {
		id,
		uuid: `persona-uuid-${id}`,
		userId: 1,
		isDefault: false,
		avatar: null,
		name: `Persona ${id}`,
		description: "A persona.",
		position: 0,
		createdAt: new Date() as any,
		updatedAt: new Date() as any,
		lorebookId: null,
		aliases: [],
		summary: null,
		creator: null,
		category: null,
		isDeleted: false,
		embedding: null,
		embeddingModel: null,
		vectorizedAt: null,
		...overrides
	} as unknown as SelectPersona
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
		visibility: "visible",
		...overrides,
		character: char
	} as any
}

export function sessionPersona(
	p: SelectPersona,
	overrides: Partial<SelectSessionPersona> = {}
): SelectSessionPersona & { persona: SelectPersona } {
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
		persona?: SelectPersona | null
	})[]
	worldLoreEntries: SelectWorldLoreEntry[]
	characterLoreEntries: SelectCharacterLoreEntry[]
	historyEntries: SelectHistoryEntry[]
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
		groupReplyStrategy: "ordered",
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
		.values({ name: "Test Lorebook", userId, ...overrides })
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

export async function insertPersonaRow(
	db: TestDb,
	userId: number,
	overrides: Partial<InsertPersona> = {}
) {
	const [row] = await db
		.insert(schema.personas)
		.values({
			userId,
			isDefault: false,
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

export async function insertWorldLoreEntryRow(
	db: TestDb,
	lorebookId: number,
	overrides: Partial<InsertWorldLoreEntry> = {}
) {
	const [row] = await db
		.insert(schema.worldLoreEntries)
		.values({ lorebookId, name: "World Lore", ...overrides })
		.returning()
	return row
}

export async function insertCharacterLoreEntryRow(
	db: TestDb,
	lorebookId: number,
	overrides: Partial<InsertCharacterLoreEntry> = {}
) {
	const [row] = await db
		.insert(schema.characterLoreEntries)
		.values({ lorebookId, name: "Character Lore", ...overrides })
		.returning()
	return row
}

export async function insertHistoryEntryRow(
	db: TestDb,
	lorebookId: number,
	overrides: Partial<InsertHistoryEntry> = {}
) {
	const [row] = await db
		.insert(schema.historyEntries)
		.values({ lorebookId, ...overrides })
		.returning()
	return row
}
