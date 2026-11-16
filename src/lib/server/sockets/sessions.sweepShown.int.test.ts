/**
 * 🚧 The sweep shows the model the entries its lines name and reads its answer
 * against them (lane lore-match), on a real Story turn with a scripted model
 * and the sweep due every turn: the brief carries *Already kept* with exactly
 * the named entries; a shown entry returned under its name is rewritten (a
 * held change for the attached lorebook, the lorebook's row untouched); an
 * entry the model was not shown takes the text as a new paragraph; nothing
 * named leaves the brief without the block.
 */
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest"
import fs from "fs/promises"
import os from "os"
import path from "path"
import { and, eq, sql } from "drizzle-orm"
import * as schema from "$lib/server/db/schema"
import { WORLD_LORE_TYPE_ID } from "$lib/shared/entries/types"
import type { TestDb } from "$lib/server/utils/testDb"

let db: TestDb
let dataDir: string

vi.mock("$lib/server/db", async () => {
	const { createTestDb } = await import("$lib/server/utils/testDb")
	const db = await createTestDb()
	return { db, getCryptoSecretKey: () => "sweep-shown-test-secret" }
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
vi.mock("$lib/server/sockets/utils/broadcastHelpers", () => ({
	emitToUserRedacted: async () => {},
	broadcastToSessionUsers: async () => {}
}))

const script = vi.hoisted(() => ({
	sweep: "" as string,
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
		script.prompts.push(JSON.stringify(p))
		return this
	}
	async generateText() {
		const asked = JSON.stringify(this.injected ?? {})
		const text = asked.includes("You keep the books of a story")
			? script.sweep
			: asked.includes("You keep the record of a story")
				? JSON.stringify({ deltas: [], clock: [], place: [] })
				: "They reach the mill at dusk."
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

beforeAll(async () => {
	dataDir = await fs.mkdtemp(
		path.join(os.tmpdir(), "serene-pub-vitest-sweep-shown-")
	)
	process.env.SERENE_PUB_DATA_DIR = dataDir
	db = (await import("$lib/server/db")).db as unknown as TestDb
	await (await import("$lib/server/db/defaults")).sync()
	const { bootstrapPipelines } = await import(
		"$lib/server/pipelines/boot/bootstrap"
	)
	await bootstrapPipelines(db)
	const { createTestUser } = await import("$lib/server/utils/testDb")
	ownerId = (await createTestUser(db, "sweep-shown-owner")).id
	const [textConn] = await db
		.insert(schema.connections)
		.values({ name: "Text", type: "openai", baseUrl: "http://text/v1" })
		.returning()
	const { ensureConnectionModel } = await import(
		"$lib/server/connections/models"
	)
	const modelId = (await ensureConnectionModel(db, textConn!.id, "sweep-7b"))!
		.id
	const [sampling] = await db
		.insert(schema.samplingConfigs)
		.values({
			name: "Sweep shown test sampling",
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
	;(await import("$lib/server/pipelines/routines/runs")).setRoutinesEnabled(
		true
	)
}, 180_000)

afterAll(async () => {
	;(await import("$lib/server/pipelines/routines/runs")).setRoutinesEnabled(
		false
	)
	await fs.rm(dataDir, { recursive: true, force: true }).catch(() => {})
})

async function presetId(seedKey: string) {
	const [p] = await db
		.select({ id: schema.sessionPresets.id })
		.from(schema.sessionPresets)
		.where(eq(schema.sessionPresets.seedKey, seedKey))
	return p!.id
}

async function sweptSession(
	name: string,
	bookId: number,
	tasks: Record<string, "full" | "review" | "off">
) {
	const [c] = await db
		.insert(schema.characters)
		.values({
			userId: ownerId,
			name: "Ash",
			description: "A miller's daughter.",
			isPersona: false
		})
		.returning()
	const { sessionsCreateHandler } = await import(
		"$lib/server/sockets/sessions"
	)
	const res: any = await sessionsCreateHandler.handler(
		fakeSocket(ownerId),
		{
			session: { name, presetId: await presetId("core-story-living") },
			characterIds: [c!.id],
			personaIds: [],
			characterPositions: {},
			tags: []
		} as any,
		emit
	)
	expect(res?.error, res?.error).toBeUndefined()
	await settle()
	const sessionId = res.session.id as number
	await db
		.update(schema.sessions)
		.set({ lorebookId: bookId })
		.where(eq(schema.sessions.id, sessionId))
	// The retired task choices, where they live now: the sweep's duties and its mode.
	const { applyLegacyTasks, setRoutineCadenceOptions } = await import(
		"$lib/server/utils/testDb"
	)
	await applyLegacyTasks(db, sessionId, {
		v: 1,
		tasks: Object.fromEntries(
			Object.entries(tasks).map(([k, mode]) => [k, { mode }])
		)
	})
	// The sweep every turn, so one exchange shows it — an administrator's
	// change of its cadence's options (R36), the registration unchanged (A8).
	const { STORY_SWEEP_SPEC_ID } = await import("@serene-pub/core-catalog")
	const { effectiveRegistrations } = await import(
		"$lib/server/pipelines/registrations/resolve"
	)
	const sweep = (await effectiveRegistrations(
		db as never,
		sessionId
	))!.effective.find((r) => r.pipeline === STORY_SWEEP_SPEC_ID)!
	await setRoutineCadenceOptions(db, sessionId, sweep.key, { n: 1 })
	return sessionId
}

async function turn(sessionId: number, content: string, sweep: unknown) {
	script.sweep = JSON.stringify(sweep)
	script.prompts.length = 0
	const { sessionMessagesSendPersonaMessageHandler } = await import(
		"./sessions"
	)
	const res: any = await sessionMessagesSendPersonaMessageHandler.handler(
		fakeSocket(ownerId),
		{ sessionId, personaId: null, content, channel: "main" } as any,
		emit
	)
	expect(res?.error, res?.error).toBeUndefined()
	await settle()
}

const answer = (over: Record<string, unknown> = {}) => ({
	lore: [],
	cast: [],
	worldState: [],
	relationships: [],
	scenes: [],
	goals: "",
	...over
})

let n = 0
async function book(name: string) {
	const [row] = await db
		.insert(schema.lorebooks)
		.values({ userId: ownerId, name })
		.returning()
	return row!.id
}
async function lore(lorebookId: number, title: string, content: string) {
	const [row] = await db
		.insert(schema.lorebookEntries)
		.values({
			lorebookId,
			typeId: WORLD_LORE_TYPE_ID,
			typeVersion: 1,
			position: ++n,
			title,
			content
		})
		.returning()
	return row!
}
const stored = async (id: number) =>
	(
		await db
			.select()
			.from(schema.lorebookEntries)
			.where(eq(schema.lorebookEntries.id, id))
	)[0]!
/** Every entry of that name, in any book: the lorebook's and the session's own. */
const named = async (title: string) =>
	(
		await db
			.select({ title: schema.lorebookEntries.title })
			.from(schema.lorebookEntries)
	).filter((e) => (e.title ?? "").toLowerCase().includes(title.toLowerCase()))
/** The entry as this session reads it: the stored row under the session's held changes. */
async function readBy(
	sessionId: number,
	entryId: number
): Promise<Record<string, any>> {
	const { sessionReadingOf } = await import("$lib/server/state/reading")
	const { entryOverlaysFor, entryAt } = await import(
		"$lib/server/state/entriesOnReading"
	)
	const { toEntryRow } = await import("$lib/server/utils/lorebookEntries")
	const row = await stored(entryId)
	const reading = (await sessionReadingOf(db as never, sessionId))!
	const overlays = await entryOverlaysFor(
		db as never,
		row.lorebookId,
		reading,
		[entryId]
	)
	return entryAt(toEntryRow(row), overlays, reading) as any
}
/** The sweep's prompts of the last turn; `says` reads one for a text as the model got it. */
const sweepPrompts = () =>
	script.prompts.filter((p) => p.includes("You keep the books of a story"))
const says = (prompt: string, text: string) =>
	prompt.includes(JSON.stringify(text).slice(1, -1))
const duties = {
	lore: "full",
	cast: "off",
	summary: "off",
	scenes: "off",
	goals: "off",
	"world-state": "off",
	relationships: "off"
} as const

describe("the sweep and what the story already keeps (lane lore-match)", () => {
	it("shows the entries the lines name, and rewrites the shown one it returns: in place in the lorebook, its name kept", async () => {
		const bookId = await book("Millbrook shown")
		const mill = await lore(bookId, "The Old Mill", "A ruin by the weir.")
		const ford = await lore(
			bookId,
			"Harrow Ford",
			"A shallow crossing north of town."
		)
		const sessionId = await sweptSession("sweep-shown", bookId, duties)
		await turn(
			sessionId,
			"We walk to the Old Mill.",
			answer({
				lore: [
					{
						name: "old mill",
						content: "A ruin by the weir. Its wheel turns again."
					}
				]
			})
		)

		const [prompt] = sweepPrompts()
		expect(prompt, "the sweep asked the model").toBeTruthy()
		expect(says(prompt!, "Already kept:")).toBe(true)
		expect(
			says(
				prompt!,
				'- (lore) {"name":"The Old Mill","content":"A ruin by the weir."}'
			)
		).toBe(true)
		expect(
			says(prompt!, "A shallow crossing north of town."),
			"an entry no line names is not shown"
		).toBe(false)

		// Under Full an undated session writes a change to an existing entry in place, imprinted.
		expect(
			(await stored(mill.id)).content,
			"the lorebook's row is rewritten in place"
		).toBe("A ruin by the weir. Its wheel turns again.")
		expect((await stored(mill.id)).title).toBe("The Old Mill")
		expect(
			(
				await db
					.select()
					.from(schema.loreImprints)
					.where(
						and(
							eq(schema.loreImprints.subjectKind, "entry"),
							eq(schema.loreImprints.subjectId, mill.id)
						)
					)
			).some((i) => i.field === "content" && i.status === "standing"),
			"the rewrite is imprinted"
		).toBe(true)
		const read = await readBy(sessionId, mill.id)
		expect(read.content).toBe("A ruin by the weir. Its wheel turns again.")
		expect(read.title ?? read.name).toBe("The Old Mill")
		expect(
			await named("Old Mill"),
			"no second entry of the name"
		).toHaveLength(1)
		expect((await stored(ford.id)).content).toBe(
			"A shallow crossing north of town."
		)
	}, 240_000)

	it("an entry the model was not shown takes the text as a new paragraph; with nothing named the brief has no block", async () => {
		const bookId = await book("Millbrook unshown")
		const ford = await lore(
			bookId,
			"Calder Ford",
			"A shallow crossing north of town."
		)
		const sessionId = await sweptSession("sweep-unshown", bookId, duties)
		await turn(
			sessionId,
			"We rest by the river.",
			answer({
				lore: [
					{ name: "Calder Ford", content: "It floods every spring." }
				]
			})
		)

		const [prompt] = sweepPrompts()
		expect(prompt, "the sweep asked the model").toBeTruthy()
		expect(says(prompt!, "Already kept:"), "nothing named, no block").toBe(
			false
		)
		expect((await readBy(sessionId, ford.id)).content).toBe(
			"A shallow crossing north of town.\n\nIt floods every spring."
		)
		expect(await named("Calder Ford")).toHaveLength(1)
	}, 240_000)
})
