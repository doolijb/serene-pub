/**
 * 🚧 **What a message changed goes with it** (RF fix 4, 2026-10-23) — on a
 * real Story turn with a scripted model, through the real swipe, delete and
 * edit handlers.
 *
 * The session plays a copy of the romance archetype at Full on its own
 * lorebook, *Replies carry changes* on. A reply moves Mara's side of her bond
 * with Wren (a zone snapshot) and so the bond's words on her relationship row
 * (a tie landing); the reply's own run also changes a place's field on the
 * book and files a note in the session's own notes. Then:
 *
 *  1. a swipe takes all four back before the new reply, and the new reply
 *     lands its own;
 *  2. a field someone changed after the reply stays, the place says so
 *     (`keptImprints`), and Revert puts it back;
 *  3. a delete takes back what a swipe does;
 *  4. an edit of the reply's prose takes back nothing;
 *  5. a replacement that fails puts everything back as it was.
 */
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest"
import fs from "fs/promises"
import os from "os"
import path from "path"
import { and, desc, eq } from "drizzle-orm"
import * as schema from "$lib/server/db/schema"
import { LOCATION_TYPE_ID } from "$lib/shared/entries/types"
import type { TestDb } from "$lib/server/utils/testDb"

let db: TestDb
let dataDir: string

vi.mock("$lib/server/db", async () => {
	const { createTestDb } = await import("$lib/server/utils/testDb")
	const db = await createTestDb()
	return { db, getCryptoSecretKey: () => "retraction-test-secret" }
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
	autoEnqueueLorebook: async () => {}
}))
vi.mock("$lib/server/sockets/utils/broadcastHelpers", () => ({
	emitToUserRedacted: async () => {},
	broadcastToSessionUsers: async () => {}
}))

/** What the reply answers (JSON while it carries changes); every other call says nothing to file. */
const script = vi.hoisted(() => ({ reply: "They walk on." as string }))
class FakeAdapter {
	injected: any
	abort() {}
	async preflight() {}
	withStops() {
		return this
	}
	withStreaming() {
		return this
	}
	withCompiledPrompt(p: any) {
		this.injected = p
		return this
	}
	async generateText() {
		const asked = JSON.stringify(this.injected ?? {})
		const text = asked.includes("You keep the record of a story")
			? JSON.stringify({ changes: [], clock: [], place: [] })
			: asked.includes("You keep the books of a story")
				? "They walk on."
				: script.reply
		return {
			compiledPrompt: this.injected ?? { prompt: "p", messages: undefined, meta: {} },
			isAborted: false,
			completionResult: async (onContent: (c: string) => void) => onContent(text)
		}
	}
}
vi.mock("$lib/server/utils/getConnectionAdapter", () => ({
	getConnectionAdapter: async () => ({ Adapter: FakeAdapter })
}))

const ROMANCE = "test:ruleset/retraction-romance@1"
let ownerId: number
const fakeSocket = (uid: number) => ({ user: { id: uid, isAdmin: false }, io: quietIo() }) as any
const emit = () => {}
function quietIo() {
	return {
		sockets: { adapter: { rooms: { get: () => undefined } }, sockets: { get: () => undefined, values: () => [].values() } },
		to: () => ({ emit: () => {} })
	}
}
async function settle() {
	await (await import("$lib/server/pipelines/runtime/sessionEvents")).settleSessionEvents()
}

/** The session, its people, its book and the rows each way, set up once. */
let s: {
	sessionId: number
	bookId: number
	wren: { id: number; name: string }
	mara: { id: number; name: string }
	maraRowId: number
	pierId: number
}

const key = (c: { id: number }) => `character:${c.id}`
const affectionTo = (value: number) => ({
	owner: "Mara",
	changes: "entry",
	attribute: "",
	entryType: "bond",
	op: "set",
	field: "affection",
	value: String(value),
	name: "Wren",
	reason: "his words landed"
})
async function scripted<T>(reply: string, fn: () => Promise<T>): Promise<T> {
	script.reply = reply
	try {
		const out = await fn()
		await settle()
		return out
	} finally {
		script.reply = "They walk on."
	}
}
const answer = (affection: number) => JSON.stringify({ message: "Mara looks at Wren a long moment.", changes: [affectionTo(affection)] })

/** A persona line and the reply it draws, in the one grammar. */
async function turn(affection: number) {
	const { sessionMessagesSendPersonaMessageHandler } = await import("./sessions")
	const res: any = await scripted(answer(affection), () =>
		sessionMessagesSendPersonaMessageHandler.handler(
			fakeSocket(ownerId),
			{ sessionId: s.sessionId, personaId: null, content: "I meant every word.", channel: "main" } as any,
			emit
		)
	)
	expect(res?.error, res?.error).toBeUndefined()
	return newestReply()
}
async function newestReply() {
	const [row] = await db
		.select()
		.from(schema.sessionMessages)
		.where(and(eq(schema.sessionMessages.sessionId, s.sessionId), eq(schema.sessionMessages.role, "assistant")))
		.orderBy(desc(schema.sessionMessages.id))
		.limit(1)
	return row!
}
async function swipe(id: number, reply: string) {
	const { sessionMessagesSwipeRightHandler } = await import("./sessions")
	return scripted(reply, () => sessionMessagesSwipeRightHandler.handler(fakeSocket(ownerId), { id } as any, emit))
}
async function maraSide() {
	const { zonesFor } = await import("$lib/server/rulesets/zones")
	const zones = await zonesFor(db, s.sessionId, ROMANCE, [s.wren, s.mara].map((c) => ({ key: key(c), owner: { kind: "session_cast", id: c.id } })) as any)
	return zones[key(s.mara)]?.bonds?.[0]?.fields
}
const maraRow = async () =>
	(await db.select().from(schema.narrativeRelationships).where(eq(schema.narrativeRelationships.id, s.maraRowId)))[0]!
const pierCategory = async () =>
	((await db.select().from(schema.lorebookEntries).where(eq(schema.lorebookEntries.id, s.pierId)))[0]!.fields as any).category
const notesNamed = async (title: string) => {
	const { ownBookOf } = await import("$lib/server/lorebooks/ownBook")
	const notes = await ownBookOf(db as any, s.sessionId)
	if (!notes) return []
	return db
		.select({ id: schema.lorebookEntries.id })
		.from(schema.lorebookEntries)
		.where(and(eq(schema.lorebookEntries.lorebookId, notes.id), eq(schema.lorebookEntries.title, title)))
}

/**
 * What else the reply's own run wrote: a field of a place on the book, and a
 * note in the session's own notes — through the outlets a reply's run uses,
 * as that run, anchored where its writes anchor (the run's live row).
 */
async function alsoWrote(runId: string, category: string, note: string) {
	const { createHost } = await import("$lib/server/pipelines/runtime/host")
	const host = createHost(db as any, { sessionId: s.sessionId, userId: ownerId, runId })
	await host.commit!({ entry: s.pierId, fields: { category } }, { key: "change", definitionId: "core:outlet/update-lore-entry" } as any)
	await host.commit!(
		{ name: note, content: "Seen from the pier.", params: { entryType: LOCATION_TYPE_ID }, toNotes: true },
		{ key: "file", definitionId: "core:outlet/create-lore-entry" } as any
	)
}

beforeAll(async () => {
	dataDir = await fs.mkdtemp(path.join(os.tmpdir(), "serene-pub-vitest-retraction-"))
	process.env.SERENE_PUB_DATA_DIR = dataDir
	db = (await import("$lib/server/db")).db as unknown as TestDb
	await (await import("$lib/server/db/defaults")).sync()
	const { bootstrapPipelines } = await import("$lib/server/pipelines/boot/bootstrap")
	await bootstrapPipelines(db)
	const { defineRuleset } = await import("@serene-pub/sdk")
	const { romanceTemplate } = await import("@serene-pub/core-catalog")
	const { template: _template, ...romance } = romanceTemplate.ruleset as unknown as Record<string, unknown>
	defineRuleset(ROMANCE, romance as never)
	const { createTestUser } = await import("$lib/server/utils/testDb")
	ownerId = (await createTestUser(db, "retraction-owner")).id
	const [textConn] = await db.insert(schema.connections).values({ name: "Text", type: "openai", baseUrl: "http://text/v1" }).returning()
	const { ensureConnectionModel } = await import("$lib/server/connections/models")
	const modelId = (await ensureConnectionModel(db, textConn!.id, "reply-7b"))!.id
	const [sampling] = await db
		.insert(schema.samplingConfigs)
		.values({
			name: "Retraction test sampling",
			isImmutable: false,
			values: { contextTokens: 8192, responseTokens: 300, temperature: 0.2 },
			enabled: ["contextTokens", "responseTokens", "temperature"]
		} as any)
		.returning()
	const { setCapabilityDefault } = await import("$lib/server/connections/capabilityDefaults")
	await setCapabilityDefault(db, "text->text", { connectionId: textConn!.id, connectionModelId: modelId, samplingConfigId: sampling!.id })

	const [wren, mara] = await db
		.insert(schema.characters)
		.values(["Wren", "Mara"].map((name) => ({ userId: ownerId, name, description: `${name}.`, isPersona: false })))
		.returning()
	const [preset] = await db.select({ id: schema.sessionPresets.id }).from(schema.sessionPresets).where(eq(schema.sessionPresets.seedKey, "core-story-living"))
	const { sessionsCreateHandler } = await import("$lib/server/sockets/sessions")
	const created: any = await sessionsCreateHandler.handler(
		fakeSocket(ownerId),
		{ session: { name: "The pier", presetId: preset!.id }, characterIds: [wren!.id, mara!.id], personaIds: [], characterPositions: {}, tags: [] } as any,
		emit
	)
	expect(created?.error, created?.error).toBeUndefined()
	await settle()
	const sessionId = created.session.id as number

	const [book] = await db.insert(schema.lorebooks).values({ userId: ownerId, name: "Hollow Hearts" }).returning()
	const bindings = await db
		.insert(schema.lorebookBindings)
		.values([wren!, mara!].map((c, i) => ({ lorebookId: book!.id, characterId: c.id, binding: `{{char:${i + 1}}}`, name: c.name })))
		.returning()
	const bindingOf = (c: { id: number }) => bindings.find((b) => b.characterId === c.id)!
	const [wrenRow, maraRowMade] = await db
		.insert(schema.narrativeRelationships)
		.values([
			{ lorebookId: book!.id, fromNodeId: bindingOf(wren!).id, toNodeId: bindingOf(mara!).id, relationshipType: "warm" },
			{ lorebookId: book!.id, fromNodeId: bindingOf(mara!).id, toNodeId: bindingOf(wren!).id, relationshipType: "wary" }
		])
		.returning()
	const [pier] = await db
		.insert(schema.lorebookEntries)
		.values({ lorebookId: book!.id, typeId: LOCATION_TYPE_ID, typeVersion: 1, position: 1, title: "The Pier", content: "Grey planks.", fields: { category: "Docks" } })
		.returning()
	// One reply per send (`next`): the reply a swipe replaces is the newest.
	const [made] = await db.select({ genreFields: schema.sessions.genreFields }).from(schema.sessions).where(eq(schema.sessions.id, sessionId))
	await db
		.update(schema.sessions)
		.set({ lorebookId: book!.id, primaryRuleset: ROMANCE, rigour: "mechanics", genreFields: { ...((made?.genreFields ?? {}) as object), autoAdvance: "next" } })
		.where(eq(schema.sessions.id, sessionId))
	const side = (who: { id: number }, other: { id: number; name: string }, row: { id: number }, fields: Record<string, unknown>) => ({
		sessionId,
		ownerKind: "session_cast",
		ownerId: who.id,
		rulesetId: ROMANCE,
		zoneType: "bonds",
		entries: [{ entryId: null, entryType: "bond", name: other.name, sideOwner: key(who), fields: { towards: key(other), edge: String(row.id), ...fields } }]
	})
	await db.insert(schema.zoneContents).values([side(wren!, mara!, wrenRow!, { affection: 7, standing: "warm" }), side(mara!, wren!, maraRowMade!, { affection: 4, standing: "wary" })])

	// *Replies carry changes*: the reply's own `changes` duty, on in this session.
	const { STORY_RESPOND_SPEC_ID } = await import("@serene-pub/core-catalog")
	const { effectiveRegistrations } = await import("$lib/server/pipelines/registrations/resolve")
	const { rowOfChange } = await import("$lib/server/pipelines/registrations/rows")
	const { upsertRow } = await import("$lib/server/pipelines/registrations/write")
	const replyReg = (await effectiveRegistrations(db as never, sessionId))!.effective.find((r) => r.pipeline === STORY_RESPOND_SPEC_ID)!
	await upsertRow(db as never, rowOfChange({ key: replyReg.key, values: { reading: { params: { changes: true } } } }, { kind: "session", sessionId }, "owner"))

	s = { sessionId, bookId: book!.id, wren: wren!, mara: mara!, maraRowId: maraRowMade!.id, pierId: pier!.id }
}, 180_000)

afterAll(async () => {
	await fs.rm(dataDir, { recursive: true, force: true })
})

describe("🚧 RF fix 4: what a message changed goes with it", () => {
	it("a swipe takes back the zone, the tie's words, the book's field and the note; the new reply lands its own", async () => {
		const reply = await turn(9)
		expect(await maraSide()).toMatchObject({ affection: 9, standing: "close" })
		const first = await maraRow()
		expect(first.relationshipType).toBe("close")
		const firstRun = first.rulesRunId!
		await alsoWrote(firstRun, "Harbour", "A gull")
		expect(await pierCategory()).toBe("Harbour")
		expect(await notesNamed("A gull")).toHaveLength(1)
		const { imprintsOf } = await import("$lib/server/lorebooks/imprints")
		const filed = await imprintsOf(db as any, s.sessionId)
		expect(new Set(filed.map((i) => i.messageId))).toEqual(new Set([reply.id]))
		expect(new Set(filed.map((i) => i.runId))).toEqual(new Set([firstRun]))

		const res: any = await swipe(reply.id, answer(6))
		expect(res?.error, res?.error).toBeUndefined()
		expect(await maraSide()).toMatchObject({ affection: 6, standing: "warm" })
		const now = await maraRow()
		expect(now.relationshipType).toBe("warm")
		expect(now.rulesRunId).not.toBe(firstRun)
		expect(await pierCategory()).toBe("Docks")
		expect(await notesNamed("A gull")).toEqual([])
		const left = await imprintsOf(db as any, s.sessionId)
		expect(left.filter((i) => i.runId === firstRun)).toEqual([])
		expect(left.some((i) => i.runId === now.rulesRunId && i.field === "relationshipType")).toBe(true)
	}, 180_000)

	it("a field someone changed since stays, the place says so, and Revert puts it back", async () => {
		const reply = await newestReply()
		const run = (await maraRow()).rulesRunId!
		await alsoWrote(run, "Harbour", "A heron")
		const { updateEntryHandler, listEntryRows, settleImprintHandler } = await import("./entries")
		await updateEntryHandler.handler(fakeSocket(ownerId), { entry: { id: s.pierId, typeId: LOCATION_TYPE_ID, category: "Wharf" } } as any, emit)
		expect(await pierCategory()).toBe("Wharf")

		const res: any = await swipe(reply.id, answer(2))
		expect(res?.error, res?.error).toBeUndefined()
		expect(await maraSide()).toMatchObject({ affection: 2, standing: "cold" })
		expect((await maraRow()).relationshipType).toBe("cold")
		expect(await notesNamed("A heron")).toEqual([])
		// Changed since: it stays, and the place says it was written by a reply since replaced.
		expect(await pierCategory()).toBe("Wharf")
		const pier = (await listEntryRows(s.bookId, LOCATION_TYPE_ID)).find((e) => e.id === s.pierId)!
		expect(pier.keptImprints).toEqual([expect.objectContaining({ field: "fields.category", before: "Docks", after: "Harbour" })])
		await settleImprintHandler.handler(fakeSocket(ownerId), { imprintId: pier.keptImprints![0]!.id, choice: "revert" }, emit)
		expect(await pierCategory()).toBe("Docks")
		expect((await listEntryRows(s.bookId, LOCATION_TYPE_ID)).find((e) => e.id === s.pierId)!.keptImprints).toBeUndefined()
	}, 180_000)

	it("a delete takes back what a swipe does", async () => {
		// 🚧 Deletion needs a pipeline (RF fix 5): this session registers one.
		const { registerTestDeletion } = await import("$lib/server/utils/testDb")
		await registerTestDeletion(db, s.sessionId)
		const before = { side: await maraSide(), words: (await maraRow()).relationshipType }
		const reply = await turn(9)
		await alsoWrote((await maraRow()).rulesRunId!, "Harbour", "A crab")
		expect((await maraRow()).relationshipType).toBe("close")
		const { sessionMessagesDeleteHandler } = await import("./sessions")
		const res: any = await sessionMessagesDeleteHandler.handler(fakeSocket(ownerId), { id: reply.id } as any, emit)
		await settle()
		expect(res?.error, res?.error).toBeUndefined()
		expect(await maraSide()).toMatchObject(before.side as object)
		expect((await maraRow()).relationshipType).toBe(before.words)
		expect(await pierCategory()).toBe("Docks")
		expect(await notesNamed("A crab")).toEqual([])
	}, 180_000)

	it("an edit of the reply's prose takes back nothing", async () => {
		const reply = await turn(9)
		await alsoWrote((await maraRow()).rulesRunId!, "Harbour", "A seal")
		const { imprintsOf } = await import("$lib/server/lorebooks/imprints")
		const filed = (await imprintsOf(db as any, s.sessionId)).map((i) => [i.id, i.status])
		const { sessionMessagesUpdateHandler } = await import("./sessions")
		const res: any = await sessionMessagesUpdateHandler.handler(fakeSocket(ownerId), { id: reply.id, content: "Mara says nothing at all." } as any, emit)
		await settle()
		expect(res?.error, res?.error).toBeUndefined()
		expect(await maraSide()).toMatchObject({ affection: 9, standing: "close" })
		expect((await maraRow()).relationshipType).toBe("close")
		expect(await pierCategory()).toBe("Harbour")
		expect(await notesNamed("A seal")).toHaveLength(1)
		expect((await imprintsOf(db as any, s.sessionId)).map((i) => [i.id, i.status])).toEqual(filed)
	}, 180_000)

	it("a replacement that fails puts everything back as it was", async () => {
		const reply = await turn(5)
		expect(await maraSide()).toMatchObject({ affection: 5, standing: "wary" })
		const run = (await maraRow()).rulesRunId!
		await alsoWrote(run, "Haven", "An eel")
		await swipe(reply.id, "")
		const row = (await db.select().from(schema.sessionMessages).where(eq(schema.sessionMessages.id, reply.id)))[0]!
		expect(row.isGenerating).toBe(false)
		expect(row.error).not.toBeNull()
		expect(await maraSide()).toMatchObject({ affection: 5, standing: "wary" })
		expect(await maraRow()).toMatchObject({ relationshipType: "wary", rulesRunId: run })
		expect(await pierCategory()).toBe("Haven")
		expect(await notesNamed("An eel")).toHaveLength(1)
	}, 180_000)
})
