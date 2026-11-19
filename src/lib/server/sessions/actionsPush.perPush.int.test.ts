/**
 * The actions push reads what does not depend on the member once per push
 * (the session's offered functions, the Back/Forward strip's state), and
 * hands the same value to every member's build.
 *
 * What is pinned, with an owner and a guest (a real `session_guests` row)
 * both watching:
 *
 *  1. **What differs per member still differs**: `canAct`, what is visible
 *     per venue, the "new" mark, `deleteRefusedThrough`; `rewind` is the
 *     same for both. Frozen literals, taken from the code before the shared
 *     reads moved.
 *  2. **A two-member push issues fewer statements** than the two one-member
 *     pushes together.
 *  3. **A push nobody is watching issues no statement**, and one whose only
 *     watcher is no member builds nothing.
 *  4. **Nothing is kept across pushes**: a write between two pushes is seen
 *     by the second.
 */
import { afterAll, beforeAll, describe, expect, test, vi } from "vitest"
import fs from "fs/promises"
import os from "os"
import path from "path"
import { eq } from "drizzle-orm"
import * as schema from "$lib/server/db/schema"
import type { TestDb } from "$lib/server/utils/testDb"
import type { SpecDocument } from "@serene-pub/sdk"

vi.setConfig({ testTimeout: 60_000, hookTimeout: 60_000 })

let db: TestDb
let dataDir: string

vi.mock("$lib/server/db", async () => {
	const { createTestDb } = await import("$lib/server/utils/testDb")
	const db = await createTestDb()
	return { db, getCryptoSecretKey: () => "per-push-test-secret" }
})
vi.mock("$lib/server/embedding", () => ({
	isModelReady: () => false,
	getLoadedModelId: () => null,
	embed: async () => [],
	batchEmbed: async () => []
}))
vi.mock("$lib/server/embedding/vectorizationQueue", () => ({
	ensureSessionMessageEmbedded: async () => {},
	autoEnqueueSession: async () => {}
}))

/** A Planner that answers a flat plan, and a Narrator that answers one line. */
let plans = 0
const planFor = (n: number) => ({
	deltas: [],
	world: {
		rooms: [{ id: `room-${n}`, name: `Room ${n}`, description: "Stone.", exits: [] }],
		npcs: [], leads: [`Lead ${n}`], goalProgress: "none", notes: ""
	},
	clock: { minutes: 10 },
	narratorBrief: `Brief ${n}.`,
	roundSummary: `Summary ${n}.`,
	secrets: []
})
class FakeAdapter {
	injected: any
	responseFormat: any
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
		const prompt = JSON.stringify(this.injected ?? "")
		return {
			compiledPrompt: this.injected ?? { prompt: "p", messages: undefined, meta: {} },
			isAborted: false,
			completionResult: async (onContent: (c: string) => void) => {
				if (prompt.includes("keep the books out of sight")) return onContent(JSON.stringify(planFor(++plans)))
				onContent("The Narrator speaks.")
			}
		}
	}
}
vi.mock("$lib/server/utils/getConnectionAdapter", () => ({
	getConnectionAdapter: async () => ({ Adapter: FakeAdapter })
}))

const STORY = "core:genre/story"
const ROLL = "acme:spec/perpush-roll#roll"
const NUDGE = "core:spec/perpush-nudge#nudge"

beforeAll(async () => {
	dataDir = await fs.mkdtemp(path.join(os.tmpdir(), "serene-pub-vitest-per-push-"))
	process.env.SERENE_PUB_DATA_DIR = dataDir
	db = (await import("$lib/server/db")).db as unknown as TestDb
	await (await import("$lib/server/db/defaults")).sync()
	const { bootstrapPipelines } = await import("$lib/server/pipelines/boot/bootstrap")
	await bootstrapPipelines(db as any)
	const [textConn] = await db
		.insert(schema.connections)
		.values({ name: "Text", type: "koboldcpp", baseUrl: "http://text" })
		.returning()
	const { ensureConnectionModel } = await import("$lib/server/connections/models")
	const modelId = (await ensureConnectionModel(db, textConn!.id, "per-push-7b"))!.id
	const [sampling] = await db
		.insert(schema.samplingConfigs)
		.values({
			name: "Per-push test sampling",
			isImmutable: false,
			values: { contextTokens: 8192, responseTokens: 200, temperature: 0.2 },
			enabled: ["contextTokens", "responseTokens", "temperature"]
		} as any)
		.returning()
	const { setCapabilityDefault } = await import("$lib/server/connections/capabilityDefaults")
	await setCapabilityDefault(db, "text->text", {
		connectionId: textConn!.id,
		connectionModelId: modelId,
		samplingConfigId: sampling!.id
	})
}, 120_000)

afterAll(async () => {
	await fs.rm(dataDir, { recursive: true, force: true })
})

async function settle() {
	await (await import("$lib/server/pipelines/runtime/sessionEvents")).settleSessionEvents()
}

let tag = 0
async function makeUser(name: string, isAdmin = false) {
	const { createTestUser } = await import("$lib/server/utils/testDb")
	const u = await createTestUser(db, `per-push-${name}-${++tag}`)
	if (isAdmin)
		await db.update(schema.users).set({ isAdmin: true }).where(eq(schema.users.id, u.id))
	return u
}

const fakeSocket = (userId: number, isAdmin = false) =>
	({ user: { id: userId, isAdmin }, io: { to: () => ({ emit: () => {} }) } }) as any
const noopEmit = () => {}

/** The half of a Socket.IO server the interest gate and the emit read: one socket per watcher. */
function recordingIo(userIds: number[], sessionId: number) {
	const emitted: Array<{ room: string; event: string; payload: any }> = []
	const sockets = new Map(
		userIds.map((id) => [
			`socket-${id}`,
			{ id: `socket-${id}`, user: { id, isAdmin: false }, interest: new Set([`sessions:actions#${sessionId}`]) }
		])
	)
	const io = {
		sockets: {
			adapter: {
				rooms: {
					get: (room: string) => {
						const m = /^user_(\d+)$/.exec(room)
						return m && sockets.has(`socket-${m[1]}`) ? new Set([`socket-${m[1]}`]) : undefined
					}
				}
			},
			sockets: { get: (id: string) => sockets.get(id), values: () => sockets.values() }
		},
		to: (room: string) => ({
			emit: (event: string, payload: any) => emitted.push({ room, event, payload })
		})
	}
	return { io: io as any, emitted }
}

/** Statements the test database ran while `fn` ran. */
async function counting<T>(fn: () => Promise<T>) {
	const client = (db as any).$client
	const orig = client.query
	let n = 0
	client.query = function (...a: any[]) {
		n++
		return orig.apply(this, a)
	}
	try {
		return { value: await fn(), statements: n }
	} finally {
		client.query = orig
	}
}

async function push(io: any, sessionId: number) {
	const { pushSessionActions } = await import("$lib/server/sessions/actionsPush")
	await pushSessionActions(io, sessionId)
}

/** One action spec published as rows, the way a plugin's would be. */
async function publishAction(id: string, declaration: Record<string, unknown>) {
	const { spec, compile } = await import("@serene-pub/sdk")
	const C = await import("@serene-pub/contracts")
	const { storyGenre } = await import("@serene-pub/core-catalog")
	const key = String(declaration.key)
	const doc: SpecDocument = compile(
		spec(id, {
			version: "1.0.0",
			taxonomy: { role: "action" },
			contributes: {
				actions: [
					{
						venue: { kind: "composer" },
						label: { en: key },
						description: { en: `Test action ${key}.` },
						...declaration
					} as any
				]
			}
		})
			.inlet("input", C.userMessage.v1(), {
				genre: storyGenre,
				event: "core:event/session-action@1"
			})
			.outlet("save", ($: any) => C.createMessage.v1({ text: $.input.text }))
			.build()
	)
	const { saveDocument } = await import("$lib/server/pipelines/boot/store")
	await saveDocument(db as any, doc, { publish: true })
	// A companion (core's namespace) is on by default once the genre registers it.
	if (id.startsWith("core:")) {
		const { actionRegistration, rowOfDecl } = await import("$lib/server/pipelines/registrations/rows")
		const { upsertRow } = await import("$lib/server/pipelines/registrations/write")
		await upsertRow(
			db as any,
			rowOfDecl(actionRegistration(`${id}#${key}`), { kind: "genre", genreId: storyGenre.id }, "admin")
		)
	}
}

/** A Story session with an owner and a guest, and two contributed actions: one an attachment (new to a person who has not met it). */
async function storyWorld() {
	const owner = await makeUser("owner")
	const guest = await makeUser("guest")
	const admin = await makeUser("admin", true)
	const [session] = await db
		.insert(schema.sessions)
		.values({ userId: owner.id, isGroup: false, genreId: STORY })
		.returning()
	await db.insert(schema.sessionGuests).values({ sessionId: session!.id, userId: guest.id })
	// The guest sees both and may act on neither.
	await publishAction("acme:spec/perpush-roll", { key: "roll", audience: { see: ["participant"], act: ["owner"] } })
	await publishAction("core:spec/perpush-nudge", { key: "nudge", audience: { see: ["participant"], act: ["owner"] } })
	const { setSessionFunction } = await import("$lib/server/pipelines/entities/sessionGenres")
	const set = await setSessionFunction(db as any, session!.id, STORY, "roll", true, {
		userId: admin.id,
		isAdmin: true
	})
	expect(set.ok).toBe(true)
	// The owner has met the roll action; the guest has not.
	const { sessionsActionsSeenHandler } = await import("$lib/server/sockets/sessions")
	const seen = await sessionsActionsSeenHandler.handler(
		fakeSocket(owner.id),
		{ sessionId: session!.id, keys: [ROLL] },
		noopEmit
	)
	expect(seen.seen).toBe(1)
	return { owner, guest, admin, sessionId: session!.id as number }
}

/** What differs between members, as a person-readable projection of one push. */
function project(payload: any) {
	const venues: Record<string, string[]> = {}
	const cannotAct: string[] = []
	const fresh: string[] = []
	for (const [kind, v] of Object.entries<any>(payload.venues)) {
		const list = [...v.primary, ...v.overflow]
		venues[kind] = list.map((a) => (a.specSlug ? `${a.specSlug}#${a.key}` : a.key)).sort()
		for (const a of list) {
			const id = a.specSlug ? `${a.specSlug}#${a.key}` : a.key
			if (a.canAct === false) cannotAct.push(`${kind}:${id}`)
			if (a.isNew) fresh.push(`${kind}:${id}`)
		}
	}
	return {
		venues,
		cannotAct: cannotAct.sort(),
		fresh: fresh.sort(),
		deleteRefusedThrough: payload.deleteRefusedThrough ?? null,
		rewind: payload.rewind ?? null
	}
}

const withoutEmptyVenues = (p: ReturnType<typeof project>) => ({
	...p,
	venues: Object.fromEntries(Object.entries(p.venues).filter(([, v]) => v.length))
})

const lastTo = (emitted: Array<{ room: string; payload: any }>, userId: number) =>
	emitted.filter((e) => e.room === `socket-${userId}`).pop()!.payload

/**
 * What each member was sent, taken from the code before the shared reads
 * moved (ids are the fixture's, created in a fixed order): the guest sees
 * what the owner may press and may press none of it; only the owner has
 * met the roll action; the owner's Delete floor is the older turn, the
 * guest's the latest turn; the strip is one for both.
 */
const FROZEN = {
	story: {
		owner: {"venues": {"composer": ["acme:spec/perpush-roll#roll", "core:spec/perpush-nudge#nudge", "core:spec/story-advance-time#advance-time", "core:spec/story-look#look", "core:spec/story-narrate#narrate", "core:spec/story-rest#rest", "core:spec/story-side-character#narrate-character"], "message": ["core#branch", "core#edit", "core#extend", "core#hide", "core#retry", "core#stop", "core#swipe"], "extra": ["core#advance", "core#pick", "core#retry"], "widget": ["core:annex#retake-quietly", "core:annex#story-goals"]}, "cannotAct": [], "fresh": ["composer:core:spec/perpush-nudge#nudge", "composer:core:spec/story-advance-time#advance-time", "composer:core:spec/story-look#look", "composer:core:spec/story-narrate#narrate", "composer:core:spec/story-rest#rest", "composer:core:spec/story-side-character#narrate-character", "widget:core:annex#retake-quietly", "widget:core:annex#story-goals"], "deleteRefusedThrough": null, "rewind": {"ahead": 0, "back": "There is nothing to go back to yet.", "forward": "There is nothing ahead to bring back.", "regenerate": "Nothing has been written yet, so there is no turn to regenerate.", "step": "message"}},
		guest: {"venues": {"composer": ["acme:spec/perpush-roll#roll", "core:spec/perpush-nudge#nudge", "core:spec/story-advance-time#advance-time", "core:spec/story-look#look", "core:spec/story-narrate#narrate", "core:spec/story-rest#rest", "core:spec/story-side-character#narrate-character"], "message": ["core#branch", "core#edit", "core#extend", "core#hide", "core#retry", "core#stop", "core#swipe"], "extra": ["core#advance", "core#pick", "core#retry"]}, "cannotAct": ["composer:acme:spec/perpush-roll#roll", "composer:core:spec/perpush-nudge#nudge", "composer:core:spec/story-advance-time#advance-time", "composer:core:spec/story-look#look", "composer:core:spec/story-narrate#narrate", "composer:core:spec/story-rest#rest", "composer:core:spec/story-side-character#narrate-character", "message:core#branch"], "fresh": ["composer:acme:spec/perpush-roll#roll", "composer:core:spec/perpush-nudge#nudge", "composer:core:spec/story-advance-time#advance-time", "composer:core:spec/story-look#look", "composer:core:spec/story-narrate#narrate", "composer:core:spec/story-rest#rest", "composer:core:spec/story-side-character#narrate-character"], "deleteRefusedThrough": null, "rewind": {"ahead": 0, "back": "There is nothing to go back to yet.", "forward": "There is nothing ahead to bring back.", "regenerate": "Nothing has been written yet, so there is no turn to regenerate.", "step": "message"}}
	},
	crawler: {
		owner: {"venues": {"composer": ["core:spec/dungeon-crawler-reveal#reveal", "core:spec/rules-action#rest"], "message": ["core#branch", "core#delete", "core#edit", "core#extend", "core#hide", "core#retry", "core#stop", "core#swipe"], "extra": ["core#advance", "core#retake"], "widget": ["core:annex#retake-quietly"]}, "cannotAct": [], "fresh": ["composer:core:spec/dungeon-crawler-reveal#reveal", "composer:core:spec/rules-action#rest", "widget:core:annex#retake-quietly"], "deleteRefusedThrough": {"channels": ["main", "travelogue", "table"], "messageId": 5}, "rewind": {"ahead": 0, "back": null, "forward": "There is nothing ahead to bring back.", "regenerate": null, "backTakes": {"count": 1, "names": ["Narrator"], "throughId": 16}, "step": "turn"}},
		guest: {"venues": {"composer": ["core:spec/rules-action#rest"], "message": ["core#branch", "core#delete", "core#edit", "core#extend", "core#hide", "core#retry", "core#stop", "core#swipe"], "extra": ["core#advance", "core#retake"]}, "cannotAct": ["composer:core:spec/rules-action#rest", "extra:core#retake", "message:core#branch"], "fresh": ["composer:core:spec/rules-action#rest"], "deleteRefusedThrough": {"channels": ["main", "travelogue", "table"], "messageId": 16}, "rewind": {"ahead": 0, "back": null, "forward": "There is nothing ahead to bring back.", "regenerate": null, "backTakes": {"count": 1, "names": ["Narrator"], "throughId": 16}, "step": "turn"}}
	}
}

/** A Dungeon Crawler table: the owner's seat and a playing guest's. */
async function crawlerWorld() {
	const owner = await makeUser("dc-owner")
	const guest = await makeUser("dc-guest")
	const { sessionsCreateHandler } = await import("$lib/server/sockets/sessions")
	const [preset] = await db
		.select({ id: schema.sessionPresets.id })
		.from(schema.sessionPresets)
		.where(eq(schema.sessionPresets.seedKey, "core-dungeon-crawler-default"))
	const res: any = await sessionsCreateHandler.handler(
		fakeSocket(owner.id),
		{
			session: { name: "Per-push table", presetId: preset!.id, primaryRuleset: "core:ruleset/vis-itineris@1", rigour: "scripts" },
			characterIds: [],
			personaIds: [],
			characterPositions: {},
			tags: []
		} as any,
		noopEmit
	)
	expect(res?.error, res?.error).toBeUndefined()
	await settle()
	const sessionId = res.session.id as number
	await db.update(schema.sessions).set({ composerStates: {} }).where(eq(schema.sessions.id, sessionId))
	await db.insert(schema.sessionPersonas).values({ sessionId, userId: owner.id, seatName: "Ann", position: 0 } as any)
	await db.insert(schema.sessionGuests).values({ sessionId, userId: guest.id, isPlayer: true } as any)
	await db.insert(schema.sessionPersonas).values({ sessionId, userId: guest.id, seatName: "Bo", position: 1 } as any)
	await db
		.insert(schema.channelLanes)
		.values([
			{ sessionId, slug: "parley", lane: 1, userId: owner.id },
			{ sessionId, slug: "parley", lane: 2, userId: guest.id }
		] as any)
		.onConflictDoNothing()
	const { registerTestDeletion } = await import("$lib/server/utils/testDb")
	await registerTestDeletion(db, sessionId)
	return { owner, guest, sessionId }
}

async function say(userId: number, sessionId: number, content: string) {
	const { sessionMessagesSendPersonaMessageHandler } = await import("$lib/server/sockets/sessions")
	const res: any = await sessionMessagesSendPersonaMessageHandler.handler(
		fakeSocket(userId),
		{ sessionId, content, channel: "main" } as any,
		noopEmit
	)
	expect(res?.error, res?.error).toBeUndefined()
	await settle()
}

/** Two rounds: the first is an older turn, so Keep every turn has something to tell the owner apart. */
async function twoRounds(w: { owner: { id: number }; guest: { id: number }; sessionId: number }) {
	for (const n of [1, 2]) {
		await say(w.owner.id, w.sessionId, `Ann acts ${n}.`)
		await say(w.guest.id, w.sessionId, `Bo acts ${n}.`)
	}
}

describe("a push reads the offer once", () => {
	test("each member's list keeps its own audience, new mark and seen set", async () => {
		const w = await storyWorld()
		const both = recordingIo([w.owner.id, w.guest.id], w.sessionId)
		await push(both.io, w.sessionId)
		const owner = project(lastTo(both.emitted, w.owner.id))
		const guest = project(lastTo(both.emitted, w.guest.id))
		expect(withoutEmptyVenues(owner)).toEqual(FROZEN.story.owner)
		expect(withoutEmptyVenues(guest)).toEqual(FROZEN.story.guest)
	})

	test("two members cost fewer statements than the two one-member pushes together; nobody watching costs none", async () => {
		const w = await storyWorld()
		const { __actionsPushBuildsForTests } = await import("$lib/server/sessions/actionsPush")
		const { getSessionUserIds } = await import("$lib/server/sockets/utils/broadcastHelpers")
		// Warm every lazy import so the counts see queries only.
		await push(recordingIo([w.owner.id, w.guest.id], w.sessionId).io, w.sessionId)
		const one = await counting(() => push(recordingIo([w.owner.id], w.sessionId).io, w.sessionId))
		const other = await counting(() => push(recordingIo([w.guest.id], w.sessionId).io, w.sessionId))
		const two = await counting(() => push(recordingIo([w.owner.id, w.guest.id], w.sessionId).io, w.sessionId))
		const roster = await counting(() => getSessionUserIds(w.sessionId))
		// The roster is read once per push either way, so the second member must
		// cost less than a member alone (a member alone = roster + offer + own
		// reads). Without the per-push sharing the offer is read again for the
		// second member and this difference is a whole member, which fails.
		expect(two.statements - one.statements).toBeLessThan(other.statements - roster.statements)

		// Nobody holds this session's scope: no roster, no list, no statement.
		const before = __actionsPushBuildsForTests()
		const quiet = await counting(() => push(recordingIo([], w.sessionId).io, w.sessionId))
		expect(quiet.statements).toBe(0)
		// A watcher who is no member: the roster is read, and nothing is built or sent.
		const stranger = await makeUser("stranger")
		const watched = recordingIo([stranger.id], w.sessionId)
		const idle = await counting(() => push(watched.io, w.sessionId))
		expect(idle.statements).toBe(roster.statements)
		expect(watched.emitted).toEqual([])
		expect(__actionsPushBuildsForTests()).toBe(before)
	})

	test("nothing is kept across pushes: a function switched off between two is gone from the second", async () => {
		const w = await storyWorld()
		const { setSessionFunction } = await import("$lib/server/pipelines/entities/sessionGenres")
		const watching = recordingIo([w.owner.id, w.guest.id], w.sessionId)
		await push(watching.io, w.sessionId)
		expect(project(lastTo(watching.emitted, w.owner.id)).venues.composer).toContain(ROLL)
		expect(project(lastTo(watching.emitted, w.guest.id)).venues.composer).toContain(ROLL)
		const off = await setSessionFunction(db as any, w.sessionId, STORY, "roll", false, {
			userId: w.admin.id,
			isAdmin: true
		})
		expect(off.ok).toBe(true)
		await push(watching.io, w.sessionId)
		expect(project(lastTo(watching.emitted, w.owner.id)).venues.composer).not.toContain(ROLL)
		expect(project(lastTo(watching.emitted, w.guest.id)).venues.composer).not.toContain(ROLL)
	})
})

describe("a push reads the strip's state once", () => {
	test("a kept turn tells the owner and the guest apart; the strip is the same for both, and a reply between pushes is seen", async () => {
		const w = await crawlerWorld()
		const watching = recordingIo([w.owner.id, w.guest.id], w.sessionId)
		await push(watching.io, w.sessionId)
		const emptyStrip = lastTo(watching.emitted, w.owner.id).rewind
		expect(emptyStrip.ahead).toBe(0)

		await twoRounds(w)
		await db.update(schema.sessions).set({ genreFields: { keepEveryTurn: false } } as any).where(eq(schema.sessions.id, w.sessionId))
		const mark = watching.emitted.length
		await push(watching.io, w.sessionId)
		const owner = project(lastTo(watching.emitted, w.owner.id))
		const guest = project(lastTo(watching.emitted, w.guest.id))

		const { rewindStateOf } = await import("$lib/server/sessions/rewind")
		const fresh = JSON.parse(JSON.stringify(await rewindStateOf(db as any, w.sessionId)))
		expect(withoutEmptyVenues(owner)).toEqual(FROZEN.crawler.owner)
		expect(withoutEmptyVenues(guest)).toEqual(FROZEN.crawler.guest)
		expect(owner.rewind).toEqual(fresh)
		expect(guest.rewind).toEqual(fresh)
		expect(owner.rewind).not.toEqual(emptyStrip)
		// Keep every turn is off: the owner's floor is the older turns', the guest's is the latest turn's.
		expect(owner.deleteRefusedThrough).not.toBeNull()
		expect(guest.deleteRefusedThrough!.messageId).toBeGreaterThan(owner.deleteRefusedThrough!.messageId)
	})
})
