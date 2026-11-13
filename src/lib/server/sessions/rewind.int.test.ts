/**
 * 🚧 **Back · Forward** (RF fix 5, owner ruling 2026-10-23: "disable message
 * deletions by default and introduce a back and forward button. If clicking
 * back, rewind the history. On continue/new write, replace the rewound
 * history.") — on a real Story turn with a scripted model, through the real
 * handlers.
 *
 * The session plays a copy of the romance archetype on its own lorebook,
 * *Replies carry changes* on, with a story clock. Each turn moves Mara's
 * side of her bond with Wren (a zone snapshot) and so the bond's words on
 * her relationship row (a tie landing); the reply's own run also changes a
 * place on the book, files a note in the session's notes, writes a value
 * and moves the clock. Then:
 *
 *  1. Back takes the newest turn out of the history — every one of those
 *     back, the rows kept but out of the page and the prompt, no routine and
 *     no reply run;
 *  2. Back again takes the turn before;
 *  3. a reload keeps the forward stack;
 *  4. Forward brings the newest rewound turn back, ids kept, the clock
 *     forward again;
 *  5. a new line while rewound deletes the turns ahead for good and plays on
 *     from the live tail;
 *  6. deletion is refused while no pipeline is registered, and done once one
 *     is.
 *
 * And on rows written straight (no model): a group's round is the unit, and
 * a branch's fork is the floor.
 */
import { memberFormOn } from "$lib/server/state/memberForm"
import { loadSeatMap, memberFormOf, type SeatMap } from "$lib/server/state/seatRefs"
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest"
import fs from "fs/promises"
import os from "os"
import path from "path"
import { and, asc, count, desc, eq, inArray, sql } from "drizzle-orm"
import {
	REWIND_REFUSALS,
	rewindStateOf,
	rewindStateWith
} from "$lib/shared/sessions/rewind"
import * as schema from "$lib/server/db/schema"
import { LOCATION_TYPE_ID } from "$lib/shared/entries/types"
import type { TestDb } from "$lib/server/utils/testDb"

let db: TestDb
let dataDir: string

vi.mock("$lib/server/db", async () => {
	const { createTestDb } = await import("$lib/server/utils/testDb")
	const db = await createTestDb()
	return { db, getCryptoSecretKey: () => "rewind-test-secret" }
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

/**
 * The step of Back (`GenreDecl.history.back`) is pinned here: this file tests both
 * unit shapes by name and holds `'turn'` by default, so its cases do not move
 * when Story's own `back: 'message'` line lands.
 */
const backStep = vi.hoisted(() => ({ value: "turn" as "turn" | "message" }))
vi.mock("@serene-pub/sdk", async (importOriginal) => {
	const real = await importOriginal<typeof import("@serene-pub/sdk")>()
	return {
		...real,
		getGenre: (id: string) => {
			const g = real.getGenre(id) as any
			return {
				...(g ?? {}),
				history: {
					settle: "on-commit",
					...(g?.history ?? {}),
					back: backStep.value
				}
			}
		}
	}
})

/** What the reply answers (JSON while it carries changes); every other call says nothing to file. */
const script = vi.hoisted(() => ({
	reply: "They walk on." as string,
	prompts: [] as string[]
}))
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
		if (text === script.reply) script.prompts.push(asked)
		return {
			compiledPrompt: this.injected ?? {
				prompt: "p",
				messages: undefined,
				meta: {}
			},
			isAborted: false,
			completionResult: async (onContent: (c: string) => void) =>
				onContent(text)
		}
	}
}
vi.mock("$lib/server/utils/getConnectionAdapter", () => ({
	getConnectionAdapter: async () => ({ Adapter: FakeAdapter })
}))

const ROMANCE = "test:ruleset/rewind-romance@1"
const MOOD = "test:slot/rewind-mood@1"
let ownerId: number
const fakeSocket = (uid: number) =>
	({ user: { id: uid, isAdmin: false }, io: quietIo() }) as any
const emit = () => {}
function quietIo() {
	return {
		sockets: {
			adapter: { rooms: { get: () => undefined } },
			sockets: { get: () => undefined, values: () => [].values() }
		},
		to: () => ({ emit: () => {} })
	}
}
async function settle() {
	await (
		await import("$lib/server/pipelines/runtime/sessionEvents")
	).settleSessionEvents()
}

let s: {
	sessionId: number
	bookId: number
	wren: { id: number; name: string }
	mara: { id: number; name: string }
	maraRowId: number
	pierId: number
}

const key = (c: { id: number }) => `character:${c.id}`
/** ⏳ The session's seats once made; read only with the member-form switch on (`seatedKey`, `seatedOwner`). */
let seatMap: SeatMap | null = null
/** ⏳ A seat's ref as it is stored: member form with the switch on, else the card's. */
const seatedKey = (c: { id: number }): string =>
	memberFormOn() && seatMap ? (memberFormOf(seatMap, key(c)) ?? key(c)) : key(c)
/** ⏳ A seat's state owner as it is stored: member form with the switch on, else the card's `session_cast`. */
const seatedOwner = (c: { id: number }): { kind: string; id: number } => {
	const owner = { kind: "session_cast", id: c.id }
	return memberFormOn() && seatMap ? (memberFormOf(seatMap, owner) ?? owner) : owner
}
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
const answer = (affection: number, said: string) =>
	JSON.stringify({ message: said, changes: [affectionTo(affection)] })
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

/** A persona line and the reply it draws: both rows. */
async function turn(affection: number, line: string, said: string) {
	const { sessionMessagesSendPersonaMessageHandler } = await import(
		"$lib/server/sockets/sessions"
	)
	const res: any = await scripted(answer(affection, said), () =>
		sessionMessagesSendPersonaMessageHandler.handler(
			fakeSocket(ownerId),
			{
				sessionId: s.sessionId,
				personaId: null,
				content: line,
				channel: "main"
			} as any,
			emit
		)
	)
	expect(res?.error, res?.error).toBeUndefined()
	const rows = await liveRows()
	const reply = rows.filter((r) => r.role === "assistant").at(-1)!
	const person = rows
		.filter((r) => r.role === "user" && r.content === line)
		.at(-1)!
	expect(reply.content).toContain(said)
	return { person, reply }
}
const liveRows = async () =>
	db
		.select()
		.from(schema.sessionMessages)
		.where(eq(schema.sessionMessages.sessionId, s.sessionId))
		.orderBy(asc(schema.sessionMessages.id))
const rowOf = async (id: number) =>
	(
		await db
			.select()
			.from(schema.sessionMessages)
			.where(eq(schema.sessionMessages.id, id))
	)[0]
async function maraSide() {
	const { zonesFor } = await import("$lib/server/rulesets/zones")
	const zones = await zonesFor(
		db,
		s.sessionId,
		ROMANCE,
		[s.wren, s.mara].map((c) => ({
			key: key(c),
			owner: seatedOwner(c)
		})) as any
	)
	return zones[key(s.mara)]?.bonds?.[0]?.fields
}
const maraRow = async () =>
	(
		await db
			.select()
			.from(schema.narrativeRelationships)
			.where(eq(schema.narrativeRelationships.id, s.maraRowId))
	)[0]!
/** The pier's category as the session reads it: a run's change to it is a held amendment, and the lorebook's own row never moves. */
const pierCategory = async () => {
	const { sessionReadingOf } = await import("$lib/server/state/reading")
	const { entryOverlaysFor, entryAt } = await import("$lib/server/state/entriesOnReading")
	const { toEntryRow } = await import("$lib/server/utils/lorebookEntries")
	const [row] = await db
		.select()
		.from(schema.lorebookEntries)
		.where(eq(schema.lorebookEntries.id, s.pierId))
	const reading = (await sessionReadingOf(db as any, s.sessionId))!
	const overlays = await entryOverlaysFor(db as any, row!.lorebookId, reading, [row!.id])
	return (entryAt(toEntryRow(row!), overlays, reading) as any).category
}
const pierBookCategory = async () =>
	(
		(
			await db
				.select()
				.from(schema.lorebookEntries)
				.where(eq(schema.lorebookEntries.id, s.pierId))
		)[0]!.fields as any
	).category
const notesNamed = async (title: string) => {
	const { ownBookOf } = await import("$lib/server/lorebooks/ownBook")
	const notes = await ownBookOf(db as any, s.sessionId)
	if (!notes) return []
	return db
		.select({ id: schema.lorebookEntries.id })
		.from(schema.lorebookEntries)
		.where(
			and(
				eq(schema.lorebookEntries.lorebookId, notes.id),
				eq(schema.lorebookEntries.title, title)
			)
		)
}
const moodRows = async () =>
	db
		.select({
			id: schema.attributeValues.id,
			value: schema.attributeValues.value,
			at: schema.attributeValues.validFromMessageId
		})
		.from(schema.attributeValues)
		.where(
			and(
				eq(schema.attributeValues.sessionId, s.sessionId),
				eq(schema.attributeValues.slotId, MOOD)
			)
		)
		.orderBy(asc(schema.attributeValues.id))
const clockOf = async () =>
	(
		await db
			.select({
				day: schema.sessions.storyClockDay,
				hour: schema.sessions.storyClockHour,
				minute: schema.sessions.storyClockMinute
			})
			.from(schema.sessions)
			.where(eq(schema.sessions.id, s.sessionId))
	)[0]!
const runsWhere = async (family?: string) =>
	Number(
		(
			await db
				.select({ n: count() })
				.from(schema.pipelineRuns)
				.where(
					and(
						eq(schema.pipelineRuns.sessionId, s.sessionId),
						family
							? eq(schema.pipelineRuns.triggerFamily, family)
							: undefined
					)
				)
		)[0]!.n
	)
const replyRuns = async () => {
	const { STORY_RESPOND_SPEC_ID } = await import("@serene-pub/core-catalog")
	return Number(
		(
			await db
				.select({ n: count() })
				.from(schema.pipelineRuns)
				.where(
					and(
						eq(schema.pipelineRuns.sessionId, s.sessionId),
						eq(schema.pipelineRuns.specSlug, STORY_RESPOND_SPEC_ID)
					)
				)
		)[0]!.n
	)
}

/**
 * What else the reply's own run wrote: a place's field on the book, a note
 * in the session's own notes, a value of the session's, and two hours of
 * story time — as that run, anchored where its writes anchor.
 */
async function alsoWrote(
	runId: string,
	reply: number,
	category: string,
	note: string,
	mood: string
) {
	const { createHost } = await import("$lib/server/pipelines/runtime/host")
	const host = createHost(db as any, {
		sessionId: s.sessionId,
		userId: ownerId,
		runId
	})
	await host.commit!({ entry: s.pierId, fields: { category } }, {
		key: "change",
		definitionId: "core:outlet/update-lore-entry"
	} as any)
	await host.commit!(
		{
			name: note,
			content: "Seen from the pier.",
			params: { entryType: LOCATION_TYPE_ID },
			toNotes: true
		},
		{ key: "file", definitionId: "core:outlet/create-lore-entry" } as any
	)
	await host.commit!({ by: 2, unit: "hours", cause: "action" }, {
		key: "advance",
		definitionId: "core:outlet/advance-story-clock",
		definitionVersion: 1
	} as any)
	await db.insert(schema.attributeValues).values({
		ownerKind: "session",
		ownerId: s.sessionId,
		slotId: MOOD,
		value: { v: mood },
		sessionId: s.sessionId,
		validFromMessageId: reply,
		updatedBy: `run:${runId}`
	} as any)
}

/** The story lane's turn tally, as the session holds it. */
async function storyTally() {
	const { readTurnTally } = await import(
		"$lib/server/pipelines/routines/turnTally"
	)
	const [row] = await db
		.select({ turnTally: schema.sessions.turnTally })
		.from(schema.sessions)
		.where(eq(schema.sessions.id, s.sessionId))
	return readTurnTally(row ?? null).lanes.main
}

async function back() {
	const { sessionsRewindTurnHandler } = await import(
		"$lib/server/sockets/sessions"
	)
	const res: any = await sessionsRewindTurnHandler.handler(
		fakeSocket(ownerId),
		{ sessionId: s.sessionId },
		emit
	)
	await settle()
	return res as {
		ok: boolean
		messageIds?: number[]
		ahead?: number
		error?: string
	}
}
async function forward() {
	const { sessionsForwardTurnHandler } = await import(
		"$lib/server/sockets/sessions"
	)
	const res: any = await sessionsForwardTurnHandler.handler(
		fakeSocket(ownerId),
		{ sessionId: s.sessionId },
		emit
	)
	await settle()
	return res as {
		ok: boolean
		messageIds?: number[]
		ahead?: number
		error?: string
	}
}

/** Both turns' rows and what each wrote — what the tests compare against. */
const t: Record<string, any> = {}

beforeAll(async () => {
	dataDir = await fs.mkdtemp(
		path.join(os.tmpdir(), "serene-pub-vitest-rewind-")
	)
	process.env.SERENE_PUB_DATA_DIR = dataDir
	db = (await import("$lib/server/db")).db as unknown as TestDb
	await (await import("$lib/server/db/defaults")).sync()
	const { bootstrapPipelines } = await import(
		"$lib/server/pipelines/boot/bootstrap"
	)
	await bootstrapPipelines(db)
	const { defineRuleset } = await import("@serene-pub/sdk")
	const { romanceTemplate } = await import("@serene-pub/core-catalog")
	const { template: _template, ...romance } =
		romanceTemplate.ruleset as unknown as Record<string, unknown>
	defineRuleset(ROMANCE, romance as never)
	const { createTestUser } = await import("$lib/server/utils/testDb")
	ownerId = (await createTestUser(db, "rewind-owner")).id
	const [textConn] = await db
		.insert(schema.connections)
		.values({ name: "Text", type: "openai", baseUrl: "http://text/v1" })
		.returning()
	const { ensureConnectionModel } = await import(
		"$lib/server/connections/models"
	)
	const modelId = (await ensureConnectionModel(db, textConn!.id, "reply-7b"))!
		.id
	const [sampling] = await db
		.insert(schema.samplingConfigs)
		.values({
			name: "Rewind test sampling",
			isImmutable: false,
			values: {
				contextTokens: 8192,
				responseTokens: 300,
				temperature: 0.2
			},
			enabled: ["contextTokens", "responseTokens", "temperature"]
		} as any)
		.returning()
	const { setCapabilityDefault } = await import(
		"$lib/server/connections/capabilityDefaults"
	)
	await setCapabilityDefault(db, "text->text", {
		connectionId: textConn!.id,
		connectionModelId: modelId,
		samplingConfigId: sampling!.id
	})

	const [wren, mara] = await db
		.insert(schema.characters)
		.values(
			["Wren", "Mara"].map((name) => ({
				userId: ownerId,
				name,
				description: `${name}.`,
				isPersona: false
			}))
		)
		.returning()
	const [preset] = await db
		.select({ id: schema.sessionPresets.id })
		.from(schema.sessionPresets)
		.where(eq(schema.sessionPresets.seedKey, "core-story-living"))
	const { sessionsCreateHandler } = await import(
		"$lib/server/sockets/sessions"
	)
	const created: any = await sessionsCreateHandler.handler(
		fakeSocket(ownerId),
		{
			session: { name: "The pier at night", presetId: preset!.id },
			characterIds: [wren!.id, mara!.id],
			personaIds: [],
			characterPositions: {},
			tags: []
		} as any,
		emit
	)
	expect(created?.error, created?.error).toBeUndefined()
	await settle()
	const sessionId = created.session.id as number
	seatMap = await loadSeatMap(db, sessionId)

	const [book] = await db
		.insert(schema.lorebooks)
		.values({ userId: ownerId, name: "Hollow Hearts" })
		.returning()
	const bindings = await db
		.insert(schema.lorebookBindings)
		.values(
			[wren!, mara!].map((c, i) => ({
				lorebookId: book!.id,
				characterId: c.id,
				binding: `{{char:${i + 1}}}`,
				name: c.name
			}))
		)
		.returning()
	const bindingOf = (c: { id: number }) =>
		bindings.find((b) => b.characterId === c.id)!
	const [wrenRow, maraRowMade] = await db
		.insert(schema.narrativeRelationships)
		.values([
			{
				lorebookId: book!.id,
				fromNodeId: bindingOf(wren!).id,
				toNodeId: bindingOf(mara!).id,
				relationshipType: "warm"
			},
			{
				lorebookId: book!.id,
				fromNodeId: bindingOf(mara!).id,
				toNodeId: bindingOf(wren!).id,
				relationshipType: "wary"
			}
		])
		.returning()
	const [pier] = await db
		.insert(schema.lorebookEntries)
		.values({
			lorebookId: book!.id,
			typeId: LOCATION_TYPE_ID,
			typeVersion: 1,
			position: 1,
			title: "The Pier",
			content: "Grey planks.",
			fields: { category: "Docks" }
		})
		.returning()
	const [made] = await db
		.select({ genreFields: schema.sessions.genreFields })
		.from(schema.sessions)
		.where(eq(schema.sessions.id, sessionId))
	await db
		.update(schema.sessions)
		.set({
			lorebookId: book!.id,
			primaryRuleset: ROMANCE,
			rigour: "mechanics",
			genreFields: {
				...((made?.genreFields ?? {}) as object),
				autoAdvance: "next"
			},
			// A story clock of its own: the moves a turn makes go back with it.
			storyClockYear: 412,
			storyClockMonth: 3,
			storyClockDay: 5,
			storyClockHour: 9,
			storyClockMinute: 0
		})
		.where(eq(schema.sessions.id, sessionId))
	const side = (
		who: { id: number },
		other: { id: number; name: string },
		row: { id: number },
		fields: Record<string, unknown>
	) => ({
		sessionId,
		ownerKind: seatedOwner(who).kind,
		ownerId: seatedOwner(who).id,
		rulesetId: ROMANCE,
		zoneType: "bonds",
		entries: [
			{
				entryId: null,
				entryType: "bond",
				name: other.name,
				sideOwner: seatedKey(who),
				fields: { towards: seatedKey(other), edge: String(row.id), ...fields }
			}
		]
	})
	await db
		.insert(schema.zoneContents)
		.values([
			side(wren!, mara!, wrenRow!, { affection: 7, standing: "warm" }),
			side(mara!, wren!, maraRowMade!, { affection: 4, standing: "wary" })
		])

	const { STORY_RESPOND_SPEC_ID } = await import("@serene-pub/core-catalog")
	const { effectiveRegistrations } = await import(
		"$lib/server/pipelines/registrations/resolve"
	)
	const { rowOfChange } = await import(
		"$lib/server/pipelines/registrations/rows"
	)
	const { upsertRow } = await import(
		"$lib/server/pipelines/registrations/write"
	)
	const replyReg = (await effectiveRegistrations(
		db as never,
		sessionId
	))!.effective.find((r) => r.pipeline === STORY_RESPOND_SPEC_ID)!
	await upsertRow(
		db as never,
		rowOfChange(
			{
				key: replyReg.key,
				values: { reading: { params: { changes: true } } }
			},
			{ kind: "session", sessionId },
			"owner"
		)
	)

	s = {
		sessionId,
		bookId: book!.id,
		wren: wren!,
		mara: mara!,
		maraRowId: maraRowMade!.id,
		pierId: pier!.id
	}

	// Turn one, and what its run wrote.
	t.clock0 = await clockOf()
	t.one = await turn(
		9,
		"I meant every word.",
		"Mara takes his hand on the pier."
	)
	t.runOne = (await maraRow()).rulesRunId!
	await alsoWrote(t.runOne, t.one.reply.id, "Harbour", "A gull", "tender")
	t.clock1 = await clockOf()
	t.gull = (await notesNamed("A gull"))[0]!.id
	t.moodOne = (await moodRows())[0]!.id
	// Turn two, and what its run wrote.
	t.two = await turn(
		6,
		"Then why do you hesitate?",
		"Mara lets go, and looks at the water."
	)
	t.runTwo = (await maraRow()).rulesRunId!
	await alsoWrote(t.runTwo, t.two.reply.id, "Haven", "A heron", "guarded")
	t.clock2 = await clockOf()
}, 240_000)

afterAll(async () => {
	await fs.rm(dataDir, { recursive: true, force: true })
})

describe("🚧 RF fix 5: Back · Forward", () => {
	it("Back takes the newest turn out of the history: everything it changed goes back; no routine and no reply runs", async () => {
		expect(await maraSide()).toMatchObject({
			affection: 6,
			standing: "warm"
		})
		expect((await maraRow()).relationshipType).toBe("warm")
		expect(await pierCategory()).toBe("Haven")
		expect(t.clock2).not.toEqual(t.clock1)
		const routines = await runsWhere("routine")
		const replies = await replyRuns()

		const res = await back()
		expect(res.error, res.error).toBeUndefined()
		expect(res.ahead).toBe(1)
		// The round: the person's line and the reply that answered it.
		expect(res.messageIds).toEqual(
			expect.arrayContaining([t.two.person.id, t.two.reply.id])
		)
		expect(res.messageIds).not.toContain(t.one.reply.id)
		for (const id of [t.two.person.id, t.two.reply.id]) {
			const row = (await rowOf(id))!
			expect(row.rewindOrdinal).toBe(1)
			expect(row.isHidden).toBe(true)
		}
		// Everything the turn changed is as turn one left it.
		expect(await maraSide()).toMatchObject({
			affection: 9,
			standing: "close"
		})
		expect((await maraRow()).relationshipType).toBe("close")
		expect(await pierCategory()).toBe("Harbour")
		// The lorebook itself was never written: the turn's held amendment went.
		expect(await pierBookCategory()).toBe("Docks")
		expect(await notesNamed("A heron")).toEqual([])
		expect(await notesNamed("A gull")).toHaveLength(1)
		expect((await moodRows()).map((r) => r.value)).toEqual([
			{ v: "tender" }
		])
		expect(await clockOf()).toEqual(t.clock1)
		// Nothing ran for it: no routine, no reply.
		expect(await runsWhere("routine")).toBe(routines)
		expect(await replyRuns()).toBe(replies)
		// The prompt reads the unhidden history: the rewound rows are not in it.
		const read = await db
			.select({ id: schema.sessionMessages.id })
			.from(schema.sessionMessages)
			.where(
				and(
					eq(schema.sessionMessages.sessionId, s.sessionId),
					eq(schema.sessionMessages.isHidden, false)
				)
			)
		expect(read.map((r) => r.id)).toContain(t.one.reply.id)
		expect(read.map((r) => r.id)).not.toContain(t.two.reply.id)
		// The newest message an anchor reads is turn one's reply.
		const { newestMessageId } = await import("$lib/server/state/write")
		expect(await newestMessageId(db as any, s.sessionId)).toBe(
			t.one.reply.id
		)
		// And the story's tally is the history's that is left.
		expect((await storyTally())?.lastMessageId).toBe(t.one.reply.id)
	}, 180_000)

	it("Back again takes the turn before onto the forward stack", async () => {
		const res = await back()
		expect(res.error, res.error).toBeUndefined()
		expect(res.ahead).toBe(2)
		expect(res.messageIds).toEqual(
			expect.arrayContaining([t.one.person.id, t.one.reply.id])
		)
		expect((await rowOf(t.one.reply.id))!.rewindOrdinal).toBe(2)
		expect(await maraSide()).toMatchObject({
			affection: 4,
			standing: "wary"
		})
		expect((await maraRow()).relationshipType).toBe("wary")
		expect(await pierCategory()).toBe("Docks")
		expect(await notesNamed("A gull")).toEqual([])
		expect(await moodRows()).toEqual([])
		expect(await clockOf()).toEqual(t.clock0)
		// Nothing left to go back to: the greeting stays.
		expect((await back()).error).toBe("There is nothing to go back to yet.")
	}, 180_000)

	it("a reload keeps the stack: the page's session leaves the rows out and says how many turns are ahead", async () => {
		const { sessionsGetHandler } = await import(
			"$lib/server/sockets/sessions"
		)
		const got: any = await sessionsGetHandler.handler(
			fakeSocket(ownerId),
			{ id: s.sessionId } as any,
			emit
		)
		const ids = (got.session.sessionMessages as Array<{ id: number }>).map(
			(m) => m.id
		)
		for (const id of [
			t.one.person.id,
			t.one.reply.id,
			t.two.person.id,
			t.two.reply.id
		])
			expect(ids).not.toContain(id)
		expect(got.session.rewind).toEqual({
			ahead: 2,
			back: "There is nothing to go back to yet.",
			forward: null,
			regenerate:
				"Nothing has been written yet, so there is no turn to regenerate."
		})
		const { forwardStackRows } = await import("$lib/server/sessions/rewind")
		const stack = await forwardStackRows(db as any, s.sessionId)
		expect(stack.map((r) => r.ordinal)).toEqual([2, 2, 1, 1])
	}, 180_000)

	it("Forward brings the newest rewound turn back, with the same ids, the clock forward again", async () => {
		const res = await forward()
		expect(res.error, res.error).toBeUndefined()
		expect(res.ahead).toBe(1)
		expect(res.messageIds).toEqual(
			expect.arrayContaining([t.one.person.id, t.one.reply.id])
		)
		const row = (await rowOf(t.one.reply.id))!
		expect(row.rewindOrdinal).toBeNull()
		expect(row.isHidden).toBe(false)
		expect(row.rewindTaken).toBeNull()
		expect(await maraSide()).toMatchObject({
			affection: 9,
			standing: "close"
		})
		expect((await maraRow()).relationshipType).toBe("close")
		expect(await pierCategory()).toBe("Harbour")
		expect((await notesNamed("A gull")).map((r) => r.id)).toEqual([t.gull])
		expect((await moodRows()).map((r) => r.id)).toEqual([t.moodOne])
		expect(await clockOf()).toEqual(t.clock1)
		expect((await storyTally())?.lastMessageId).toBe(t.one.reply.id)
		// Turn two is still ahead.
		expect((await rowOf(t.two.reply.id))!.rewindOrdinal).toBe(1)
	}, 180_000)

	it("a new line while rewound deletes the turns ahead for good, and play goes on from the live tail", async () => {
		script.prompts.length = 0
		const three = await turn(
			5,
			"Walk with me.",
			"Mara walks beside him, quiet."
		)
		// Turn two is gone, rows and all.
		expect(await rowOf(t.two.person.id)).toBeUndefined()
		expect(await rowOf(t.two.reply.id)).toBeUndefined()
		const { forwardStackHeight } = await import(
			"$lib/server/sessions/rewind"
		)
		expect(await forwardStackHeight(db as any, s.sessionId)).toBe(0)
		// The new reply wrote its own, over turn one's.
		expect(await maraSide()).toMatchObject({ affection: 5 })
		expect(three.reply.rewindOrdinal).toBeNull()
		// The model read turn one, and never turn two.
		const prompt = script.prompts.at(-1)!
		expect(prompt).toContain("Mara takes his hand on the pier.")
		expect(prompt).not.toContain("Mara lets go, and looks at the water.")
		expect((await forward()).error).toBe(
			"There is nothing ahead to bring back."
		)
	}, 180_000)

	it("deletion is refused while no pipeline is registered, and offered and done once one is", async () => {
		const reply = (await liveRows())
			.filter((r) => r.role === "assistant")
			.at(-1)!
		const { listSessionActions } = await import(
			"$lib/server/pipelines/entities/sessionActions"
		)
		const listed = async () => {
			const venues = await listSessionActions(db as any, s.sessionId, {
				userId: ownerId
			} as any)
			return [...venues.message.primary, ...venues.message.overflow]
				.filter((a) => a.specSlug === "core")
				.map((a) => a.key)
		}
		expect(await listed()).not.toContain("delete")
		expect(await listed()).toContain("hide")
		const { sessionMessagesDeleteHandler } = await import(
			"$lib/server/sockets/sessions"
		)
		const { DELETION_OFF } = await import("$lib/server/messages/deletion")
		const off: any = await sessionMessagesDeleteHandler.handler(
			fakeSocket(ownerId),
			{ id: reply.id } as any,
			emit
		)
		expect(off.error).toBe(DELETION_OFF)
		expect(await rowOf(reply.id)).toBeTruthy()

		const { registerTestDeletion } = await import(
			"$lib/server/utils/testDb"
		)
		await registerTestDeletion(db, s.sessionId)
		expect(await listed()).toContain("delete")
		const before = await maraSide()
		const on: any = await sessionMessagesDeleteHandler.handler(
			fakeSocket(ownerId),
			{ id: reply.id } as any,
			emit
		)
		await settle()
		expect(on.error, on.error).toBeUndefined()
		expect(await rowOf(reply.id)).toBeUndefined()
		// What it changed went with it: Mara's side is turn one's again.
		expect(before).toMatchObject({ affection: 5 })
		expect(await maraSide()).toMatchObject({
			affection: 9,
			standing: "close"
		})
	}, 180_000)
})

describe("🚧 the unit Back takes, on rows written straight", () => {
	/** A group session: two characters seated, the owner writing as themselves. */
	async function group(name: string) {
		const [a, b] = await db
			.insert(schema.characters)
			.values(
				["Ash", "Birch"].map((n) => ({
					userId: ownerId,
					name: `${n} ${name}`,
					description: n,
					isPersona: false
				}))
			)
			.returning()
		const [session] = await db
			.insert(schema.sessions)
			.values({
				userId: ownerId,
				isGroup: true,
				name,
				turnOrder: {
					v: 1,
					order: [],
					candidates: [a!, b!].map((c, position) => ({
						ref: `character:${c.id}`,
						kind: "character",
						name: c.name,
						position
					})),
					basedOnAt: 1,
					computedAt: 1,
					runId: null,
					event: null,
					strategy: null
				}
			} as any)
			.returning()
		const { insertLegacy } = await import("$lib/server/messages/store")
		const line = (content: string, who: "me" | typeof a) =>
			insertLegacy(
				db as any,
				{
					sessionId: session!.id,
					role: who === "me" ? "user" : "assistant",
					userId: ownerId,
					characterId: who === "me" ? null : who!.id,
					content
				} as any
			)
		return { session: session!, a: a!, b: b!, line }
	}

	it("a group's round is the unit: the person's line and every reply of the round", async () => {
		const g = await group("round")
		const greeting = await g.line("Welcome.", g.a)
		await db
			.update(schema.sessionMessages)
			.set({ metadata: { isGreeting: true } })
			.where(eq(schema.sessionMessages.id, greeting.id))
		const p1 = await g.line("Hello, both.", "me")
		const a1 = await g.line("Ash nods.", g.a)
		const b1 = await g.line("Birch waves.", g.b)
		const p2 = await g.line("Shall we go?", "me")
		const a2 = await g.line("Ash stands.", g.a)
		const { rewindUnitIds, rewindTurn } = await import(
			"$lib/server/sessions/rewind"
		)
		expect(await rewindUnitIds(db as any, g.session.id)).toEqual([
			p2.id,
			a2.id
		])
		const first = await rewindTurn(db as any, {
			sessionId: g.session.id,
			userId: ownerId
		})
		expect(first).toMatchObject({ ok: true, ahead: 1 })
		expect(await rewindUnitIds(db as any, g.session.id)).toEqual([
			p1.id,
			a1.id,
			b1.id
		])
		const second = await rewindTurn(db as any, {
			sessionId: g.session.id,
			userId: ownerId
		})
		expect(second).toMatchObject({ ok: true, ahead: 2 })
		// The greeting is where the session starts.
		expect(await rewindUnitIds(db as any, g.session.id)).toEqual([])
		const kept = await db
			.select({ id: schema.sessionMessages.id })
			.from(schema.sessionMessages)
			.where(
				and(
					eq(schema.sessionMessages.sessionId, g.session.id),
					inArray(schema.sessionMessages.id, [greeting.id])
				)
			)
		expect(kept).toHaveLength(1)
	}, 120_000)

	it("one person switching persona mid-round: Back takes only the newest exchange", async () => {
		const g = await group("personas")
		const [pa, pb] = await db
			.insert(schema.characters)
			.values(
				["Alma", "Bruno"].map((n) => ({
					userId: ownerId,
					name: `${n} personas`,
					description: n,
					isPersona: true
				}))
			)
			.returning()
		const { insertLegacy } = await import("$lib/server/messages/store")
		const mine = (content: string, personaId: number) =>
			insertLegacy(
				db as any,
				{
					sessionId: g.session.id,
					role: "user",
					userId: ownerId,
					personaId,
					content
				} as any
			)
		await mine("As Alma.", pa!.id)
		await g.line("Ash nods.", g.a)
		const p2 = await mine("As Bruno.", pb!.id)
		const a2 = await g.line("Ash stands.", g.a)
		const { rewindUnitIds } = await import("$lib/server/sessions/rewind")
		expect(await rewindUnitIds(db as any, g.session.id)).toEqual([
			p2.id,
			a2.id
		])
	}, 120_000)

	it("rewindStateOf.backTakes is the unit Back takes", async () => {
		const g = await group("takes")
		const { rewindStateOf, rewindUnitIds } = await import(
			"$lib/server/sessions/rewind"
		)
		expect(
			(await rewindStateOf(db as any, g.session.id)).backTakes
		).toBeUndefined()
		const p = await g.line("Hello.", "me")
		const a = await g.line("Ash nods.", g.a)
		const b = await g.line("Birch waves.", g.b)
		const ids = await rewindUnitIds(db as any, g.session.id)
		expect(ids).toEqual([p.id, a.id, b.id])
		const state = await rewindStateOf(db as any, g.session.id)
		expect(state.backTakes).toEqual({
			count: ids.filter((id) => id !== p.id).length,
			names: [g.a.name, g.b.name],
			throughId: Math.max(...ids)
		})
	}, 120_000)

	it("at a table of players the round is the turn: both players' lines and the reply", async () => {
		const g = await group("table")
		const { createTestUser } = await import("$lib/server/utils/testDb")
		const player = (await createTestUser(db, "rewind-player")).id
		await db
			.insert(schema.sessionGuests)
			.values({ sessionId: g.session.id, userId: player })
		const { insertLegacy } = await import("$lib/server/messages/store")
		await g.line("Hello, both.", "me")
		await g.line("Ash nods.", g.a)
		await g.line("Birch waves.", g.b)
		const mine = await g.line("I open the door.", "me")
		const theirs = await insertLegacy(
			db as any,
			{
				sessionId: g.session.id,
				role: "user",
				userId: player,
				content: "I hold the lamp."
			} as any
		)
		const answer = await g.line("Ash steps through.", g.a)
		const { rewindUnitIds } = await import("$lib/server/sessions/rewind")
		expect(await rewindUnitIds(db as any, g.session.id)).toEqual([
			mine.id,
			theirs.id,
			answer.id
		])
	}, 120_000)

	it("a branch's fork is the floor: Back takes what the branch played, never what it copied", async () => {
		const g = await group("fork")
		await g.line("Hello.", "me")
		const last = await g.line("Ash nods.", g.a)
		const { branchSession } = await import("$lib/server/sessions/branch")
		const branch = await branchSession(db as any, {
			sessionId: g.session.id,
			fromMessageId: last.id
		})
		const { rewindTurn, rewindUnitIds, REWIND_REFUSALS } = await import(
			"$lib/server/sessions/rewind"
		)
		expect(
			await rewindTurn(db as any, {
				sessionId: branch.id,
				userId: ownerId
			})
		).toEqual({ ok: false, error: REWIND_REFUSALS.fork })
		const { insertLegacy } = await import("$lib/server/messages/store")
		const mine = await insertLegacy(
			db as any,
			{
				sessionId: branch.id,
				role: "user",
				userId: ownerId,
				content: "In the branch."
			} as any
		)
		const reply = await insertLegacy(
			db as any,
			{
				sessionId: branch.id,
				role: "assistant",
				userId: ownerId,
				characterId: g.a.id,
				content: "Ash, elsewhere."
			} as any
		)
		expect(await rewindUnitIds(db as any, branch.id)).toEqual([
			mine.id,
			reply.id
		])
		expect(
			await rewindTurn(db as any, {
				sessionId: branch.id,
				userId: ownerId
			})
		).toMatchObject({ ok: true, ahead: 1 })
		expect(
			await rewindTurn(db as any, {
				sessionId: branch.id,
				userId: ownerId
			})
		).toEqual({ ok: false, error: REWIND_REFUSALS.fork })
		// The parent is untouched.
		const parent = await db
			.select({
				id: schema.sessionMessages.id,
				ordinal: schema.sessionMessages.rewindOrdinal
			})
			.from(schema.sessionMessages)
			.where(eq(schema.sessionMessages.sessionId, g.session.id))
			.orderBy(desc(schema.sessionMessages.id))
		expect(parent.every((r) => r.ordinal === null)).toBe(true)
	}, 120_000)

	it("only the session's owner presses Back", async () => {
		const g = await group("guest")
		await g.line("Hello.", "me")
		await g.line("Ash nods.", g.a)
		const { createTestUser } = await import("$lib/server/utils/testDb")
		const guest = (await createTestUser(db, "rewind-guest")).id
		await db
			.insert(schema.sessionGuests)
			.values({ sessionId: g.session.id, userId: guest })
		const { rewindTurn, forwardTurn, REWIND_REFUSALS } = await import(
			"$lib/server/sessions/rewind"
		)
		expect(
			await rewindTurn(db as any, {
				sessionId: g.session.id,
				userId: guest
			})
		).toEqual({ ok: false, error: REWIND_REFUSALS.notOwner })
		expect(
			await forwardTurn(db as any, {
				sessionId: g.session.id,
				userId: guest
			})
		).toEqual({ ok: false, error: REWIND_REFUSALS.notOwner })
	}, 120_000)

	describe("history.back: one message per press", () => {
		/** p1 a1 b1 sys, and a table row on another channel anchored to b1. */
		async function rows(name: string) {
			const g = await group(name)
			const { insertLegacy } = await import("$lib/server/messages/store")
			const p1 = await g.line("Hello, both.", "me")
			const a1 = await g.line("Ash nods.", g.a)
			const b1 = await g.line("Birch waves.", g.b)
			const sys = await insertLegacy(
				db as any,
				{
					sessionId: g.session.id,
					role: "system",
					userId: ownerId,
					channel: "main",
					content: "Time passes: 3 hours."
				} as any
			)
			const anchored = await insertLegacy(
				db as any,
				{
					sessionId: g.session.id,
					role: "assistant",
					userId: ownerId,
					channel: "ledger",
					content: "A tally.",
					metadata: { anchorMessageId: b1.id }
				} as any
			)
			return { g, p1, a1, b1, sys, anchored }
		}
		const asc_ = (...ids: number[]) => [...ids].sort((x, y) => x - y)

		it("'message': each press takes the newest message with the rows after it", async () => {
			const { g, p1, a1, b1, sys, anchored } = await rows("msg-steps")
			const { rewindUnitIds, rewindTurn } = await import(
				"$lib/server/sessions/rewind"
			)
			backStep.value = "message"
			try {
				expect(await rewindUnitIds(db as any, g.session.id)).toEqual(
					asc_(b1.id, sys.id, anchored.id)
				)
				const first = await rewindTurn(db as any, {
					sessionId: g.session.id,
					userId: ownerId
				})
				expect(first).toMatchObject({ ok: true, ahead: 1 })
				const taken = await db
					.select({ id: schema.sessionMessages.id })
					.from(schema.sessionMessages)
					.where(
						and(
							eq(schema.sessionMessages.sessionId, g.session.id),
							eq(schema.sessionMessages.rewindOrdinal, 1)
						)
					)
				expect(taken.map((r) => r.id).sort((x, y) => x - y)).toEqual(
					asc_(b1.id, sys.id, anchored.id)
				)
				expect(await rewindUnitIds(db as any, g.session.id)).toEqual([
					a1.id
				])
				await rewindTurn(db as any, {
					sessionId: g.session.id,
					userId: ownerId
				})
				expect(await rewindUnitIds(db as any, g.session.id)).toEqual([
					p1.id
				])
				await rewindTurn(db as any, {
					sessionId: g.session.id,
					userId: ownerId
				})
				expect(await rewindUnitIds(db as any, g.session.id)).toEqual([])
			} finally {
				backStep.value = "turn"
			}
		}, 120_000)

		it("'turn': the same rows are one whole unit", async () => {
			const { g, p1, a1, b1, sys, anchored } = await rows("turn-whole")
			const { rewindUnitIds } = await import(
				"$lib/server/sessions/rewind"
			)
			expect(await rewindUnitIds(db as any, g.session.id)).toEqual(
				asc_(p1.id, a1.id, b1.id, sys.id, anchored.id)
			)
		}, 120_000)

		it("Forward after a one-message Back restores it", async () => {
			const { g, b1, sys, anchored } = await rows("msg-forward")
			const {
				rewindUnitIds,
				rewindTurn,
				forwardTurn,
				forwardStackHeight
			} = await import("$lib/server/sessions/rewind")
			backStep.value = "message"
			try {
				const unit = await rewindUnitIds(db as any, g.session.id)
				expect(unit).toEqual(asc_(b1.id, sys.id, anchored.id))
				const before = await db
					.select({
						id: schema.sessionMessages.id,
						hidden: schema.sessionMessages.isHidden
					})
					.from(schema.sessionMessages)
					.where(inArray(schema.sessionMessages.id, unit))
					.orderBy(asc(schema.sessionMessages.id))
				await rewindTurn(db as any, {
					sessionId: g.session.id,
					userId: ownerId
				})
				expect(
					await forwardTurn(db as any, {
						sessionId: g.session.id,
						userId: ownerId
					})
				).toMatchObject({ ok: true })
				const after = await db
					.select({
						id: schema.sessionMessages.id,
						hidden: schema.sessionMessages.isHidden,
						ordinal: schema.sessionMessages.rewindOrdinal
					})
					.from(schema.sessionMessages)
					.where(inArray(schema.sessionMessages.id, unit))
					.orderBy(asc(schema.sessionMessages.id))
				expect(after.every((r) => r.ordinal === null)).toBe(true)
				expect(
					after.map((r) => ({ id: r.id, hidden: r.hidden }))
				).toEqual(before)
				expect(await forwardStackHeight(db as any, g.session.id)).toBe(
					0
				)
				expect(await rewindUnitIds(db as any, g.session.id)).toEqual(
					unit
				)
			} finally {
				backStep.value = "turn"
			}
		}, 120_000)

		it("Regenerate keeps the whole turn under 'message'", async () => {
			const { g } = await rows("msg-regen")
			const { turnUnitOf } = await import("$lib/server/sessions/rewind")
			const whole = await turnUnitOf(db as any, g.session.id, {
				includePersonLines: false
			})
			backStep.value = "message"
			try {
				const one = await turnUnitOf(db as any, g.session.id, {
					includePersonLines: false
				})
				expect(one.ok).toBe(whole.ok)
				if (one.ok && whole.ok)
					expect(one.unit.ids).toEqual(whole.unit.ids)
			} finally {
				backStep.value = "turn"
			}
		}, 120_000)

		it("backTakes: personLines at a table, newestMessage under 'message'", async () => {
			const g = await group("takes-facts")
			const { createTestUser } = await import("$lib/server/utils/testDb")
			const player = (await createTestUser(db, "rewind-facts-player")).id
			await db
				.insert(schema.sessionGuests)
				.values({ sessionId: g.session.id, userId: player })
			const { insertLegacy } = await import("$lib/server/messages/store")
			const { rewindStateOf } = await import(
				"$lib/server/sessions/rewind"
			)
			await g.line("Hello, both.", "me")
			await g.line("Ash nods.", g.a)
			await g.line("Birch waves.", g.b)
			await g.line("I open the door.", "me")
			await insertLegacy(
				db as any,
				{
					sessionId: g.session.id,
					role: "user",
					userId: player,
					content: "I hold the lamp."
				} as any
			)
			await g.line("Ash steps through.", g.a)
			expect(
				(await rewindStateOf(db as any, g.session.id)).backTakes
			).toMatchObject({ personLines: 2 })
			backStep.value = "message"
			try {
				const reply = (await rewindStateOf(db as any, g.session.id))
					.backTakes as any
				expect(reply.personLines).toBeUndefined()
				expect(reply.newestMessage).toEqual({
					author: g.a.name,
					yours: false,
					filed: 0
				})
				const sys = await insertLegacy(
					db as any,
					{
						sessionId: g.session.id,
						role: "system",
						userId: ownerId,
						channel: "main",
						content: "Time passes: 1 hour."
					} as any
				)
				expect(sys.id).toBeGreaterThan(0)
				const withSys = (await rewindStateOf(db as any, g.session.id))
					.backTakes as any
				expect(withSys.newestMessage).toEqual({
					author: g.a.name,
					yours: false,
					filed: 1
				})
				const own = await group("takes-own")
				await own.line("Hello.", "me")
				await own.line("Ash nods.", own.a)
				await own.line("My line.", "me")
				const mine = (await rewindStateOf(db as any, own.session.id))
					.backTakes as any
				expect(mine.newestMessage).toEqual({
					author: null,
					yours: true,
					filed: 0
				})
			} finally {
				backStep.value = "turn"
			}
		}, 120_000)
	})
})

describe("🚧 pr-6 R-c: one turn reader — a Lair planned turn", () => {
	/** A Lair-shaped turn written straight: GM line, plan (sanctum), roll form, dice, two planned replies and a waiting player's line. */
	async function plannedTurn(name: string) {
		const [a, b] = await db
			.insert(schema.characters)
			.values(
				["Brannoc", "Verity"].map((n) => ({
					userId: ownerId,
					name: `${n} ${name}`,
					description: n,
					isPersona: false
				}))
			)
			.returning()
		const [session] = await db
			.insert(schema.sessions)
			.values({ userId: ownerId, isGroup: true, name } as any)
			.returning()
		const { insertLegacy } = await import("$lib/server/messages/store")
		const sessionId = session!.id
		const run = async (label: string, created: number[] = []) => {
			const [r] = await db
				.insert(schema.pipelineRuns)
				.values({
					runId: `r-${name}-${label}`,
					specSlug: "core:spec/lair-reply",
					specVersion: "1",
					sessionId,
					userId: ownerId,
					outcome: "ok",
					triggerSource: "test",
					seed: "s",
					startedAt: new Date(),
					endedAt: new Date(),
					receipt: {
						nodes: [{ kind: "inlet", output: { via: "pick" } }]
					}
				} as any)
				.returning()
			return r!
		}
		const made = async (r: { id: number }, ids: number[]) => {
			let seq = 0
			for (const id of ids)
				await db
					.insert(schema.pipelineRunArtifacts)
					.values({
						runId: r.id,
						seq: seq++,
						kind: "message",
						entityId: id,
						action: "created"
					})
		}
		const row = (values: Record<string, unknown>) =>
			insertLegacy(
				db as any,
				{ sessionId, userId: ownerId, ...values } as any
			)
		const gm = await row({ role: "user", content: "We go in." })
		const R = await run("plan")
		const plan = await row({
			role: "assistant",
			channel: "sanctum",
			content: "The plan."
		})
		const roll = await row({ role: "assistant", content: "Roll for it." })
		await made(R, [plan.id, roll.id])
		const rDice = await run("dice")
		const dice = await row({
			role: "assistant",
			content: "A 14.",
			metadata: { answersForm: { messageId: roll.id } }
		})
		await made(rDice, [dice.id])
		const r1 = await run("brannoc")
		const brannoc = await row({
			role: "assistant",
			characterId: a!.id,
			content: "Brannoc.",
			metadata: { planRowId: plan.id }
		})
		await made(r1, [brannoc.id])
		const rook = await row({
			role: "user",
			content: "I hold the lamp.",
			metadata: { speaker: "player-seat:2" }
		})
		const r2 = await run("verity")
		const verity = await row({
			role: "assistant",
			characterId: b!.id,
			content: "Verity.",
			metadata: { planRowId: plan.id }
		})
		await made(r2, [verity.id])
		return { sessionId, gm, plan, roll, dice, brannoc, rook, verity }
	}

	it("Back takes all seven rows, Regenerate the five that are not a person's, and Forward brings Back's seven home", async () => {
		const t = await plannedTurn("planned")
		const { turnUnitOf, rewindTurn, forwardTurn } = await import(
			"$lib/server/sessions/rewind"
		)
		const back = await turnUnitOf(db as any, t.sessionId, {
			includePersonLines: true
		})
		expect(back.ok).toBe(true)
		if (!back.ok) return
		const all = [
			t.gm,
			t.plan,
			t.roll,
			t.dice,
			t.brannoc,
			t.rook,
			t.verity
		].map((r) => r.id)
		expect(back.unit.ids).toEqual(all)
		const regen = await turnUnitOf(db as any, t.sessionId, {
			includePersonLines: false
		})
		expect(regen.ok).toBe(true)
		if (!regen.ok) return
		expect(regen.unit.ids).toEqual(
			[t.plan, t.roll, t.dice, t.brannoc, t.verity].map((r) => r.id)
		)
		expect(regen.unit.planRowId).toBe(t.plan.id)
		expect(regen.unit.entry).not.toBeNull()
		expect(regen.unit.run?.specSlug).toBe("core:spec/lair-reply")

		const taken = await rewindTurn(db as any, {
			sessionId: t.sessionId,
			userId: ownerId
		})
		expect(taken).toMatchObject({ ok: true })
		const gone = await db
			.select({
				id: schema.sessionMessages.id,
				ordinal: schema.sessionMessages.rewindOrdinal
			})
			.from(schema.sessionMessages)
			.where(eq(schema.sessionMessages.sessionId, t.sessionId))
		expect(gone.every((r) => r.ordinal !== null)).toBe(true)
		const forward = await forwardTurn(db as any, {
			sessionId: t.sessionId,
			userId: ownerId
		})
		expect(forward).toMatchObject({ ok: true })
		const home = await db
			.select({
				id: schema.sessionMessages.id,
				ordinal: schema.sessionMessages.rewindOrdinal
			})
			.from(schema.sessionMessages)
			.where(eq(schema.sessionMessages.sessionId, t.sessionId))
			.orderBy(asc(schema.sessionMessages.id))
		expect(home.map((r) => r.id)).toEqual(all)
		expect(home.every((r) => r.ordinal === null)).toBe(true)
	}, 60_000)

	it("an updated-only run doesn't widen the unit", async () => {
		const [session] = await db
			.insert(schema.sessions)
			.values({
				userId: ownerId,
				isGroup: true,
				name: "updated-only"
			} as any)
			.returning()
		const sessionId = session!.id
		const { insertLegacy } = await import("$lib/server/messages/store")
		const row = (values: Record<string, unknown>) =>
			insertLegacy(
				db as any,
				{ sessionId, userId: ownerId, ...values } as any
			)
		const run = async (label: string) => {
			const [r] = await db
				.insert(schema.pipelineRuns)
				.values({
					runId: `r-updated-only-${label}`,
					specSlug: "core:spec/lair-reply",
					specVersion: "1",
					sessionId,
					userId: ownerId,
					outcome: "ok",
					triggerSource: "test",
					seed: "s",
					startedAt: new Date(),
					endedAt: new Date(),
					receipt: {
						nodes: [{ kind: "inlet", output: { via: "pick" } }]
					}
				} as any)
				.returning()
			return r!
		}
		const made = async (
			r: { id: number },
			ids: number[],
			action = "created"
		) => {
			const [{ n }] = (await db
				.select({ n: sql<number>`count(*)::int` })
				.from(schema.pipelineRunArtifacts)
				.where(eq(schema.pipelineRunArtifacts.runId, r.id))) as Array<{
				n: number
			}>
			let seq = n
			for (const id of ids)
				await db
					.insert(schema.pipelineRunArtifacts)
					.values({
						runId: r.id,
						seq: seq++,
						kind: "message",
						entityId: id,
						action
					})
		}
		await row({ role: "user", content: "First." })
		const a1 = await row({ role: "assistant", content: "Reply one." })
		const x1 = await row({
			role: "assistant",
			channel: "sanctum",
			content: "Aside."
		})
		const R0 = await run("R0")
		await made(R0, [a1.id, x1.id])
		const p2 = await row({ role: "user", content: "Second." })
		const a2 = await row({ role: "assistant", content: "Reply two." })
		const R1 = await run("R1")
		await made(R1, [a2.id])
		await made(R0, [a2.id], "updated")
		const { turnUnitOf } = await import("$lib/server/sessions/rewind")
		const back = await turnUnitOf(db as any, sessionId, {
			includePersonLines: true
		})
		expect(back.ok).toBe(true)
		if (!back.ok) return
		expect(back.unit.ids).toEqual([p2.id, a2.id])
		expect(back.unit.runs.map((r) => r.runId).sort()).toEqual(
			[R0.id, R1.id].sort()
		)
	}, 60_000)

	it("Regenerate: an older run that updated a row from before the exchange doesn't widen the unit", async () => {
		const [session] = await db
			.insert(schema.sessions)
			.values({
				userId: ownerId,
				isGroup: true,
				name: "updated-only-regen"
			} as any)
			.returning()
		const sessionId = session!.id
		const { insertLegacy } = await import("$lib/server/messages/store")
		const row = (values: Record<string, unknown>) =>
			insertLegacy(
				db as any,
				{ sessionId, userId: ownerId, ...values } as any
			)
		const run = async (label: string) => {
			const [r] = await db
				.insert(schema.pipelineRuns)
				.values({
					runId: `r-updated-only-regen-${label}`,
					specSlug: "core:spec/lair-reply",
					specVersion: "1",
					sessionId,
					userId: ownerId,
					outcome: "ok",
					triggerSource: "test",
					seed: "s",
					startedAt: new Date(),
					endedAt: new Date(),
					receipt: {
						nodes: [{ kind: "inlet", output: { via: "pick" } }]
					}
				} as any)
				.returning()
			return r!
		}
		const made = async (
			r: { id: number },
			ids: number[],
			action = "created"
		) => {
			const [{ n }] = (await db
				.select({ n: sql<number>`count(*)::int` })
				.from(schema.pipelineRunArtifacts)
				.where(eq(schema.pipelineRunArtifacts.runId, r.id))) as Array<{
				n: number
			}>
			let seq = n
			for (const id of ids)
				await db
					.insert(schema.pipelineRunArtifacts)
					.values({
						runId: r.id,
						seq: seq++,
						kind: "message",
						entityId: id,
						action
					})
		}
		await row({ role: "user", content: "First." })
		const a1 = await row({ role: "assistant", content: "Reply one." })
		const R0 = await run("R0")
		await made(R0, [a1.id])
		await row({ role: "user", content: "Second." })
		const a2 = await row({ role: "assistant", content: "Reply two." })
		const a3 = await row({ role: "assistant", content: "Reply three." })
		const R1 = await run("R1")
		await made(R1, [a2.id, a3.id])
		await made(R0, [a1.id, a2.id], "updated")
		const { turnUnitOf } = await import("$lib/server/sessions/rewind")
		const regen = await turnUnitOf(db as any, sessionId, {
			includePersonLines: false
		})
		expect(regen.ok).toBe(true)
		if (!regen.ok) return
		expect(regen.unit.ids).toEqual([a2.id, a3.id])
		expect(regen.unit.ids).not.toContain(a1.id)
		expect(regen.unit.runs.map((r) => r.runId).sort()).toEqual(
			[R0.id, R1.id].sort()
		)
	}, 60_000)
})

describe("🚧 backTakes, the shared half", () => {
	const takes = { count: 2, names: ["Ash", "Birch"], throughId: 10 }
	const served = (extra: Record<string, unknown> = {}) => ({
		rewind: {
			ahead: 0,
			back: null,
			forward: null,
			backTakes: takes,
			...extra
		}
	})

	it("reads it defensively: absent without it, junk dropped", () => {
		expect(
			"backTakes" in
				rewindStateOf({
					rewind: { ahead: 0, back: null, forward: null }
				})!
		).toBe(false)
		expect(
			"backTakes" in
				rewindStateOf({ rewind: { backTakes: { count: -1 } } })!
		).toBe(false)
		expect(
			"backTakes" in rewindStateOf({ rewind: { backTakes: "x" } })!
		).toBe(false)
		expect(rewindStateOf(served())?.backTakes).toEqual(takes)
	})

	it("is kept only while it is fresh and Back is open", () => {
		const msg = (
			id: number,
			channel: string,
			role = "assistant",
			metadata?: unknown
		) => ({ id, channel, role, metadata })
		expect(
			rewindStateWith(served(), [msg(9, "main", "user"), msg(10, "main")])
				?.backTakes
		).toEqual(takes)
		expect(
			rewindStateWith(served(), [msg(9, "main", "user"), msg(11, "main")])
				?.backTakes
		).toBeUndefined()
		expect(
			rewindStateWith(served(), [
				msg(9, "main", "user"),
				msg(10, "main"),
				msg(11, "parley:2")
			])?.backTakes
		).toEqual(takes)
		const forked = rewindStateWith(served(), [
			msg(9, "main", "user", { copyOf: 4 })
		])
		expect(forked?.back).toBe(REWIND_REFUSALS.fork)
		expect("backTakes" in forked!).toBe(false)
	})
})
