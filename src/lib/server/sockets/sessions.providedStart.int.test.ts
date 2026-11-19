/**
 * A new session on a live provided lorebook starts on a copy in its notes, and
 * the genre's cast is seated from the copy (owner 2026-11-17 AP2: "clone the
 * starter lorebook instead on session start so we are never superimposing on
 * something that can get deleted"). The provided lorebook is never attached by
 * a new session; a session that already reads it keeps it (next chapter, branch).
 */
import { afterAll, beforeAll, describe, expect, test, vi } from "vitest"
import fs from "fs/promises"
import os from "os"
import path from "path"
import { asc, eq, inArray } from "drizzle-orm"
import * as schema from "$lib/server/db/schema"
import type { TestDb } from "$lib/server/utils/testDb"
import { releaseDataDir } from "$lib/server/utils/testDb"
import { insertCard, insertCastMember } from "$lib/server/characters/versions"
import { insertLegacy } from "$lib/server/messages/store"
import { kitIsNotReadSentence } from "$lib/server/lorebooks/starterKits"

vi.setConfig({ testTimeout: 60_000, hookTimeout: 180_000 })

let testDb: TestDb
let dataDir: string

vi.mock("$lib/server/db", async () => {
	const { createTestDb, testDbModule } = await import(
		"$lib/server/utils/testDb"
	)
	return {
		...testDbModule(await createTestDb()),
		getCryptoSecretKey: () => "provided-start-test-secret"
	}
})
vi.mock("$lib/server/embedding", () => ({
	isModelReady: () => false,
	getLoadedModelId: () => null,
	embed: async () => [],
	batchEmbed: async () => []
}))
vi.mock("$lib/server/embedding/vectorizationQueue", () => ({
	ensureSessionMessageEmbedded: async () => {},
	autoEnqueueSession: async () => {},
	autoEnqueueLorebook: async () => {},
	autoEnqueueCharacter: async () => {}
}))
vi.mock("$lib/server/annotations/queue", async (importOriginal) => ({
	...(await importOriginal<object>()),
	enqueueLorebookAnnotation: vi.fn(() => {})
}))
vi.mock("$lib/server/sockets/utils/broadcastHelpers", () => ({
	emitToUserRedacted: async () => {},
	broadcastToSessionUsers: async () => {}
}))
vi.mock("$lib/server/sockets/scenes", async (importOriginal) => ({
	...(await importOriginal<typeof import("$lib/server/sockets/scenes")>()),
	runSceneSummaries: async () => {}
}))

const DECLARED = "test:genre/provided-start"
const PLAIN = "test:genre/provided-start-plain"
const STORY = "core:genre/story"
const noEmit = () => {}
let n = 0

/** Publish one test genre as a create spec, the way a plugin genre arrives. */
async function publishGenre(genreId: string, declare: boolean) {
	const { genre, spec, compile, sessionEvents } = await import(
		"@serene-pub/sdk"
	)
	const C = await import("@serene-pub/contracts")
	const decl = genre(genreId, {
		name: { en: declare ? "Provided start" : "Provided start (plain)" },
		family: "fixture",
		shape: {
			characters: { min: 0 },
			personas: { min: 0, max: 1 },
			lorebook: "optional",
			composer: "text",
			voice: "narrator",
			greeting: { enabled: false },
			fields: {
				examples: {
					type: "boolean",
					label: { en: "Examples" },
					default: true
				}
			},
			...(declare ? { castFromLorebook: { field: "examples" } } : {})
		} as any,
		events: { [sessionEvents.messageRespond]: { required: true } }
	})
	const doc = compile(
		spec(`${genreId.replace("genre/", "spec/")}-create`, {
			version: "1.0.0",
			taxonomy: { role: "create" },
			genre: {
				name: decl.name,
				family: decl.family,
				shape: decl.shape,
				events: decl.events as Record<
					string,
					{ required?: boolean; open?: boolean }
				>
			}
		})
			.inlet("input", C.sessionCreated.v1(), {
				genre: decl,
				event: sessionEvents.sessionCreated
			})
			.query("collect", ($) =>
				C.sessionGreetings.v1({ scope: $.input.sessionScope })
			)
			.outlet("seed", ($) =>
				C.seedGreetings.v1({
					greetings: $.collect.greetings,
					channel: "main"
				})
			)
			.build()
	)
	const { saveDocument } = await import("$lib/server/pipelines/boot/store")
	await saveDocument(testDb as any, doc, { publish: true })
}

beforeAll(async () => {
	dataDir = await fs.mkdtemp(
		path.join(os.tmpdir(), "serene-pub-vitest-provided-start-")
	)
	process.env.SERENE_PUB_DATA_DIR = dataDir
	testDb = (await import("$lib/server/db")).db as unknown as TestDb
	await (await import("$lib/server/db/defaults")).sync()
	const { bootstrapPipelines } = await import(
		"$lib/server/pipelines/boot/bootstrap"
	)
	await bootstrapPipelines(testDb as any)
	await publishGenre(DECLARED, true)
	await publishGenre(PLAIN, false)
}, 180_000)

afterAll(async () => {
	await releaseDataDir(dataDir)
})

const socket = (userId: number, isAdmin: boolean) =>
	({
		id: `s-${userId}`,
		user: { id: userId, isAdmin },
		io: { to: () => ({ emit: () => {} }) }
	}) as any

async function admin() {
	const a = await testDb.query.users.findFirst({
		where: (u, { eq }) => eq(u.isAdmin, true),
		orderBy: (u, { asc }) => [asc(u.id)]
	})
	return a!
}

async function member() {
	const { createTestUser } = await import("$lib/server/utils/testDb")
	return createTestUser(testDb, `provided-start-member-${++n}`)
}

async function card(userId: number, name: string, persona = false) {
	const { card: row } = await insertCard(testDb as any, {
		userId,
		name: `${name} ${++n}`,
		description: "",
		isPersona: persona
	} as any)
	return row!
}

/**
 * A plugin's provided lorebook (genuine mark, owner row present) of `kind`,
 * owned by the admin: an entry and members Ivo (a card), a persona's member,
 * and card-less Ola.
 */
async function provided(kind: "book" | "starter_kit" = "book") {
	const k = ++n
	const pluginId = `acme.providedstart${k}`
	const a = await admin()
	await testDb.insert(schema.plugins).values({
		pluginId,
		name: pluginId,
		version: "0.1.0",
		bundleSource: "",
		bundleHash: "x",
		enabled: true,
		manifest: {},
		adminDenied: []
	} as any)
	const uuid = crypto.randomUUID()
	const [book] = await testDb
		.insert(schema.lorebooks)
		.values({
			userId: a.id,
			name: `Provided start ${k}`,
			kind,
			uuid,
			extraJson: {
				provided: {
					plugin: pluginId,
					slug: "world",
					version: "0.1.0",
					sha256: "x",
					uuid,
					entries: {}
				}
			}
		} as any)
		.returning()
	await testDb.insert(schema.lorebookEntries).values({
		lorebookId: book.id,
		typeId: "core:entry/world-lore",
		typeVersion: 1,
		position: 0,
		title: "The ferry",
		content: "Ivo and Ola at the ferry."
	} as any)
	const ivoCard = await card(a.id, "Ivo")
	const personaCard = await card(a.id, "Persona", true)
	const mk = (characterId: number | null, name: string) =>
		insertCastMember(testDb as any, {
			lorebookId: book.id,
			characterId,
			binding: `{{char:${++n}}}`,
			name,
			...(characterId == null ? { description: `${name}, own words.` } : {})
		} as any).then((r) => r.member)
	const ivo = await mk(ivoCard.id, "Ivo")
	const persona = await mk(personaCard.id, "Persona member")
	const ola = await mk(null, "Ola")
	return { book, pluginId, ivo, persona, ola, admin: a }
}

async function create(
	userId: number,
	isAdmin: boolean,
	p: {
		genreId?: string
		mode?: "branch" | "next-chapter"
		from?: number
		lorebookId?: number
		starterKit?: { lorebookId: number }
		castMemberIds?: number[]
		personaIds?: number[]
	}
) {
	const { sessionsCreateHandler } = await import(
		"$lib/server/sockets/sessions"
	)
	return (await sessionsCreateHandler.handler(
		socket(userId, isAdmin),
		{
			...(p.mode ? { mode: p.mode, from: p.from } : {}),
			session: {
				name: "S",
				genreId: p.genreId ?? PLAIN,
				...(p.lorebookId != null ? { lorebookId: p.lorebookId } : {})
			},
			...(p.starterKit ? { starterKit: p.starterKit } : {}),
			characterIds: [],
			personaIds: p.personaIds ?? [],
			...(p.castMemberIds ? { castMemberIds: p.castMemberIds } : {})
		} as any,
		noEmit
	)) as any
}

const sessionRow = async (id: number) =>
	(
		await testDb
			.select()
			.from(schema.sessions)
			.where(eq(schema.sessions.id, id))
	)[0]!

const notesOf = async (sessionId: number) =>
	(
		await testDb
			.select()
			.from(schema.lorebooks)
			.where(eq(schema.lorebooks.sessionId, sessionId))
	)[0]!

const membersOf = (lorebookId: number) =>
	testDb
		.select()
		.from(schema.lorebookBindings)
		.where(eq(schema.lorebookBindings.lorebookId, lorebookId))
		.orderBy(asc(schema.lorebookBindings.id))

const entriesOf = (lorebookId: number) =>
	testDb
		.select()
		.from(schema.lorebookEntries)
		.where(eq(schema.lorebookEntries.lorebookId, lorebookId))
		.orderBy(asc(schema.lorebookEntries.id))

/** The provided lorebook's rows, as stored. */
async function snapshot(lorebookId: number) {
	const [row] = await testDb
		.select()
		.from(schema.lorebooks)
		.where(eq(schema.lorebooks.id, lorebookId))
	return JSON.stringify({
		row,
		entries: await entriesOf(lorebookId),
		members: await membersOf(lorebookId)
	})
}

const seatsOf = async (sessionId: number) =>
	testDb
		.select({
			castMemberId: schema.sessionCharacters.castMemberId,
			characterId: schema.sessionCharacters.characterId
		})
		.from(schema.sessionCharacters)
		.where(eq(schema.sessionCharacters.sessionId, sessionId))
		.orderBy(asc(schema.sessionCharacters.position))

const lorebookCount = async () =>
	(await testDb.select({ id: schema.lorebooks.id }).from(schema.lorebooks))
		.length

async function expectStartedOnCopy(
	p: Awaited<ReturnType<typeof provided>>,
	userId: number
) {
	const before = await snapshot(p.book.id)
	const first = await create(userId, false, {
		starterKit: { lorebookId: p.book.id }
	})
	expect(first.error).toBeUndefined()
	expect((await sessionRow(first.session.id)).lorebookId).toBeNull()
	const notes = await notesOf(first.session.id)
	expect(notes.id).not.toBe(p.book.id)
	const extra = (notes.extraJson ?? {}) as Record<string, unknown>
	expect(extra.provided).toBeUndefined()
	expect((await entriesOf(notes.id)).map((e) => e.title)).toEqual(
		(await entriesOf(p.book.id)).map((e) => e.title)
	)
	const copied = await membersOf(notes.id)
	expect(copied.map((m) => m.name)).toEqual(
		(await membersOf(p.book.id)).map((m) => m.name)
	)
	for (const m of copied) expect(m.characterId).toBeNull()
	expect(await snapshot(p.book.id)).toBe(before)
	const second = await create(userId, false, {
		starterKit: { lorebookId: p.book.id }
	})
	expect(second.error).toBeUndefined()
	const notes2 = await notesOf(second.session.id)
	expect(notes2.id).not.toBe(notes.id)
	const copied2 = await membersOf(notes2.id)
	expect(copied2.length).toBe(copied.length)
	expect(copied2.map((m) => m.id).some((id) => copied.some((c) => c.id === id)))
		.toBe(false)
	expect(await snapshot(p.book.id)).toBe(before)
}

describe("a new session on a live provided lorebook starts on a copy", () => {
	test("of kind book: the notes hold a card-less copy; the provided rows are untouched", async () => {
		const p = await provided("book")
		const m = await member()
		await expectStartedOnCopy(p, m.id)
	})

	test("of kind starter_kit (a primer row): the same", async () => {
		const p = await provided("starter_kit")
		const m = await member()
		await expectStartedOnCopy(p, m.id)
	})
})

describe("a live provided lorebook is not attached by a new session", () => {
	test("forged: lorebookId alone is refused in words and makes nothing", async () => {
		const p = await provided("book")
		const m = await member()
		const books = await lorebookCount()
		const sessions = (await testDb.select().from(schema.sessions)).length
		const res = await create(m.id, false, { lorebookId: p.book.id })
		expect(res.error).toBe(kitIsNotReadSentence(p.book.name))
		expect(await lorebookCount()).toBe(books)
		expect((await testDb.select().from(schema.sessions)).length).toBe(sessions)
	})

	test("checkLorebookOwnership: false for a member and for the administrator; true for the session that reads it", async () => {
		const { checkLorebookOwnership } = await import(
			"$lib/server/sockets/sessions.shared"
		)
		const p = await provided("book")
		const m = await member()
		expect(await checkLorebookOwnership(p.book.id, m.id)).toBe(false)
		expect(await checkLorebookOwnership(p.book.id, p.admin.id)).toBe(false)
		const [reading] = await testDb
			.insert(schema.sessions)
			.values({
				userId: m.id,
				isGroup: false,
				genreId: PLAIN,
				lorebookId: p.book.id,
				name: "Reader"
			})
			.returning()
		expect(await checkLorebookOwnership(p.book.id, m.id, reading.id)).toBe(true)
		const [other] = await testDb
			.insert(schema.sessions)
			.values({ userId: m.id, isGroup: false, genreId: PLAIN, name: "Other" })
			.returning()
		expect(await checkLorebookOwnership(p.book.id, m.id, other.id)).toBe(false)
	})
})

describe("a session that already reads a provided lorebook keeps it", () => {
	async function reader() {
		const p = await provided("book")
		const m = await member()
		const [session] = await testDb
			.insert(schema.sessions)
			.values({
				userId: m.id,
				isGroup: false,
				genreId: STORY,
				lorebookId: p.book.id,
				name: "Reader"
			})
			.returning()
		const { insertOwnBook } = await import("$lib/server/lorebooks/ownBook")
		await insertOwnBook(testDb as unknown as Db, {
			sessionId: session.id,
			userId: m.id,
			name: session.name,
			overlayOf: p.book.id,
			primaryRuleset: session.primaryRuleset,
			rulesetVersion: session.rulesetVersion ?? null
		})
		await insertLegacy(testDb as unknown as Db, {
			sessionId: session.id,
			role: "user",
			content: "a line",
			channel: "main"
		})
		return { p, m, session }
	}

	test("a next chapter reads the same provided lorebook", async () => {
		const { p, m, session } = await reader()
		const res = await create(m.id, false, {
			mode: "next-chapter",
			from: session.id,
			genreId: STORY
		})
		expect(res.error ?? null).toBeNull()
		expect(res.session.lorebookId).toBe(p.book.id)
	})

	test("a branch reads it too", async () => {
		const { p, m, session } = await reader()
		const res = await create(m.id, false, {
			mode: "branch",
			from: session.id,
			genreId: STORY
		})
		expect(res.error ?? null).toBeNull()
		expect(res.session.lorebookId).toBe(p.book.id)
	})
})

describe("the genre's cast is seated from the copy", () => {
	const copyMemberIds = async (sessionId: number) =>
		(await membersOf((await notesOf(sessionId)).id)).map((m) => m.id)

	test("a provided lorebook: the copy's members, the persona member left out", async () => {
		const p = await provided("book")
		const m = await member()
		const res = await create(m.id, false, {
			genreId: DECLARED,
			starterKit: { lorebookId: p.book.id }
		})
		expect(res.error).toBeUndefined()
		const seats = await seatsOf(res.session.id)
		const mine = await copyMemberIds(res.session.id)
		const providedIds = (await membersOf(p.book.id)).map((x) => x.id)
		expect(seats).toHaveLength(2)
		for (const s of seats) {
			expect(mine).toContain(s.castMemberId)
			expect(providedIds).not.toContain(s.castMemberId)
		}
		const names = await testDb
			.select({ name: schema.lorebookBindings.name })
			.from(schema.lorebookBindings)
			.where(
				inArray(
					schema.lorebookBindings.id,
					seats.map((s) => s.castMemberId!)
				)
			)
		expect(names.map((x) => x.name).sort()).toEqual(["Ivo", "Ola"])
		expect((await sessionRow(res.session.id)).isGroup).toBe(true)
	})

	test("a picked card-less member of the provided lorebook is accepted, seated as the copy's member", async () => {
		const p = await provided("book")
		const m = await member()
		const res = await create(m.id, false, {
			genreId: DECLARED,
			starterKit: { lorebookId: p.book.id },
			castMemberIds: [p.ola.id]
		})
		expect(res.error).toBeUndefined()
		const seats = await seatsOf(res.session.id)
		const mine = await membersOf((await notesOf(res.session.id)).id)
		const olaCopy = mine.find((x) => x.name === "Ola")!
		expect(seats.map((s) => s.castMemberId)).toContain(olaCopy.id)
		expect(seats.map((s) => s.castMemberId)).not.toContain(p.ola.id)
		// Picked once, not seated again.
		expect(seats.filter((s) => s.castMemberId === olaCopy.id)).toHaveLength(1)
	})

	test("a genre without the declaration seats nobody from it", async () => {
		const p = await provided("book")
		const m = await member()
		const res = await create(m.id, false, {
			genreId: PLAIN,
			starterKit: { lorebookId: p.book.id }
		})
		expect(res.error).toBeUndefined()
		expect(await seatsOf(res.session.id)).toEqual([])
	})

	test("an admin starter kit seats from its copy too", async () => {
		const a = await admin()
		const [kit] = await testDb
			.insert(schema.lorebooks)
			.values({
				userId: a.id,
				name: `Admin kit ${++n}`,
				kind: "starter_kit"
			} as any)
			.returning()
		const kitCard = await card(a.id, "Kit card")
		await insertCastMember(testDb as any, {
			lorebookId: kit.id,
			characterId: kitCard.id,
			binding: `{{char:${++n}}}`,
			name: "Kit one"
		} as any)
		await insertCastMember(testDb as any, {
			lorebookId: kit.id,
			characterId: null,
			binding: `{{char:${++n}}}`,
			name: "Kit two",
			description: "Kit two, own words."
		} as any)
		const m = await member()
		const res = await create(m.id, false, {
			genreId: DECLARED,
			starterKit: { lorebookId: kit.id }
		})
		expect(res.error).toBeUndefined()
		const seats = await seatsOf(res.session.id)
		const mine = await copyMemberIds(res.session.id)
		const kitIds = (await membersOf(kit.id)).map((x) => x.id)
		expect(seats).toHaveLength(2)
		for (const s of seats) {
			expect(mine).toContain(s.castMemberId)
			expect(kitIds).not.toContain(s.castMemberId)
		}
	})
})
