/**
 * 🚧 `speakerInCast` over the real reply road (`runReply` → shipped
 * `story-respond`, real handlers, real DB); only the model is faked and every
 * assembled prompt is kept.
 *
 * One world: Mira (the speaker) and Bren, seated. Scene A (cast Mira and Bren)
 * and scene B (cast Bren) are compiled into one History day whose own text
 * differs from both summaries; scene C (cast Bren), earlier and not compiled,
 * has lost its lines from the prompt, so its summary shows under *Earlier in
 * the story*. Mira's reply with the param on reads the day as A's summary and
 * never B's or C's; with it off (declared in Story respond's default preset)
 * it reads the day's own text and C's summary; a narrator turn reads the same
 * either way. Nothing else in the prompt differs.
 */
import { appendFileSync } from "node:fs"
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest"
import { createHash } from "crypto"
import fs from "fs/promises"
import os from "os"
import path from "path"
import { and, eq } from "drizzle-orm"
import * as schema from "$lib/server/db/schema"
import type { TestDb } from "$lib/server/utils/testDb"
import { releaseDataDir } from "$lib/server/utils/testDb"
import { insertCastMember } from "$lib/server/characters/versions"
import { insertLegacy, insertLegacyMany } from "$lib/server/messages/store"
import { HISTORY_TYPE_ID } from "$lib/shared/entries/types"

vi.setConfig({ testTimeout: 60_000, hookTimeout: 60_000 })

let db: TestDb
let dataDir: string

vi.mock("$lib/server/db", async () => {
	const { createTestDb } = await import("$lib/server/utils/testDb")
	const db = await createTestDb()
	return { db }
})
/**
 * Embeddings off (the default) or on. On: a model is "loaded", embedding answers a
 * fixed vector, and the host's vector read is stubbed to return `emb.hit` (the
 * half-missed day, in the stored text) so search by meaning hands the day to the run.
 */
const emb = vi.hoisted(() => ({ on: false, hit: null as Record<string, unknown> | null }))
vi.mock("$lib/server/embedding", () => ({
	isModelReady: () => emb.on,
	getLoadedModelId: () => (emb.on ? "fake-embedding" : null),
	embed: async () => (emb.on ? [0.1, 0.2, 0.3] : []),
	batchEmbed: async (texts: string[]) => (emb.on ? texts.map(() => [0.1, 0.2, 0.3]) : [])
}))
vi.mock("$lib/server/pipelines/runtime/host.read.retrieval", async (importOriginal) => {
	const actual = await importOriginal<Record<string, unknown>>()
	return {
		...actual,
		readVectorSearch: async (args: unknown) =>
			emb.on && emb.hit
				? { lists: [[emb.hit]], similarity: [[1]], candidates: [emb.hit], truncated: [] }
				: (actual.readVectorSearch as (a: unknown) => Promise<unknown>)(args)
	}
})
vi.mock("$lib/server/embedding/vectorizationQueue", () => ({
	ensureSessionMessageEmbedded: async () => {},
	autoEnqueueSession: async () => {}
}))
vi.mock("$lib/server/sockets/utils/broadcastHelpers", () => ({
	emitToUserRedacted: async () => {},
	broadcastToSessionUsers: async () => {}
}))

/** Every prompt the fake model was sent, whole. */
const prompts: string[] = []

class FakeAdapter {
	injected: unknown
	constructor(_p: unknown) {}
	abort() {}
	async preflight() {}
	withStops() {
		return this
	}
	withCompiledPrompt(p: unknown) {
		this.injected = p
		return this
	}
	withStreaming() {
		return this
	}
	async generateText() {
		const { prompt, messages } = (this.injected ?? {}) as {
			prompt?: unknown
			messages?: unknown
		}
		prompts.push(JSON.stringify({ prompt, messages }))
		return {
			compiledPrompt: this.injected,
			isAborted: false,
			completionResult: async (onContent: (c: string) => void) => {
				onContent("A voice answers.")
			}
		}
	}
}
vi.mock("$lib/server/utils/getConnectionAdapter", () => ({
	getConnectionAdapter: async () => ({ Adapter: FakeAdapter })
}))

const DAY_TEXT =
	"The day of the ford crossing, as the chronicler wrote it down."
const SUMMARY_A = "Mira and Bren scouted the ford together."
const SUMMARY_B = "Bren alone mended the ferry rope."
const SUMMARY_C = "Bren alone sorted the lantern oil."
const LINE = "Where did the ferry rope go?"

let userId: number
let n = 0

/** The prompt of each reply the file made, by name, for the comparisons. */
const made: Record<string, string> = {}

type Variant = "default" | "two-of-three" | "cut" | "empty-cast"

/**
 * The day's scenes by variant. default: A (Mira, Bren) and B (Bren). two-of-three:
 * two Mira scenes whose summaries together are longer than the day's own text but
 * within twice it, and B. cut: three Mira scenes that do not all fit twice the day.
 * empty-cast: A (Mira, Bren), a scene resolved with no cast at all, and D (Bren).
 */
const A2 = "Mira then watched the far bank for riders."
const A3 = "Together they marked the safest stones for the crossing."
const A4 = "At dusk Mira waded across while Bren held the line steady."
const EMPTY = "The resolved scene whose cast holds nobody at all."
const SUMMARY_D = "Bren alone counted the barrels on the dock."

async function world(variant: Variant = "default", opts: { searchOnly?: boolean } = {}) {
	const tag = ++n
	const [minimal] = await db
		.select({ id: schema.sessionPresets.id })
		.from(schema.sessionPresets)
		.where(eq(schema.sessionPresets.seedKey, "core-story-minimal"))
	const [book] = await db
		.insert(schema.lorebooks)
		.values({ userId, name: `Book ${tag}` } as never)
		.returning()
	const cards: Record<string, { id: number; member: number }> = {}
	for (const name of ["Mira", "Bren"]) {
		const [card] = await db
			.insert(schema.characters)
			.values({
				userId,
				name,
				description: `${name} is a scout.`
			} as never)
			.returning()
		const member = (
			await insertCastMember(db, {
				lorebookId: book!.id,
				binding: `{{char:${name}}}`,
				characterId: card!.id,
				name
			})
		).member!.id
		cards[name] = { id: card!.id, member }
	}
	const [session] = await db
		.insert(schema.sessions)
		.values({
			userId,
			isGroup: true,
			name: "Session",
			presetId: minimal!.id,
			lorebookId: book!.id
		} as never)
		.returning()
	const sessionId = session!.id
	await db.insert(schema.sessionCharacters).values(
		["Mira", "Bren"].map((name, position) => ({
			sessionId,
			characterId: cards[name]!.id,
			castMemberId: cards[name]!.member,
			position,
			isActive: true
		})) as never
	)
	const [day] = await db
		.insert(schema.lorebookEntries)
		.values({
			lorebookId: book!.id,
			typeId: HISTORY_TYPE_ID,
			typeVersion: 1,
			title: "The ford",
			content: DAY_TEXT,
			// searchOnly: nothing but a search by meaning can bring the day in.
			keys: opts.searchOnly ? [] : ["ford"],
			constant: !opts.searchOnly,
			position: 1,
			fields: { year: 412, month: 3, day: 5 }
		} as never)
		.returning()
	const say = async (who: string | null, content: string) =>
		(
			await insertLegacy(
				db as unknown as Db,
				{
					sessionId,
					role: who ? "assistant" : "user",
					content,
					...(who ? { castMemberId: cards[who]!.member } : { userId })
				} as never
			)
		).id
	const scene = async (
		first: number,
		last: number,
		summary: string,
		cast: string[],
		entryId: number | null
	) => {
		const [row] = await db
			.insert(schema.scenes)
			.values({
				sessionId,
				lorebookId: book!.id,
				channel: "main",
				openedAtMessageId: first,
				closedAtMessageId: last,
				summary,
				summaryStatus: "done",
				castResolvedAt: new Date(),
				historyEntryId: entryId
			} as never)
			.returning()
		if (cast.length)
			await db.insert(schema.sceneCharacters).values(
				cast.map((name, ordinal) => ({
					sceneId: row!.id,
					bindingId: cards[name]!.member,
					role: "participant",
					ordinal
				})) as never
			)
	}
	// C, then A and B, then enough talk that all three leave the prompt.
	const c1 = await say("Bren", "Oil for the lanterns, sorted by the bell.")
	const c2 = await say("Bren", "Wicks trimmed.")
	const a1 = await say("Mira", "The ford is low today.")
	const a2 = await say("Bren", "Then we cross at dusk.")
	const b1 = await say("Bren", "The ferry rope is frayed.")
	const b2 = await say("Bren", "Mended it with a splice.")
	await scene(c1, c2, SUMMARY_C, ["Bren"], null)
	await scene(a1, a2, SUMMARY_A, ["Mira", "Bren"], day!.id)
	if (variant === "default") await scene(b1, b2, SUMMARY_B, ["Bren"], day!.id)
	else {
		const e1 = await say("Mira", "The far bank is clear.")
		const e2 = await say("Mira", "Riders none.")
		if (variant === "two-of-three") {
			await scene(e1, e2, A2, ["Mira"], day!.id)
			await scene(b1, b2, SUMMARY_B, ["Bren"], day!.id)
		} else if (variant === "cut") {
			await scene(e1, e2, A2, ["Mira"], day!.id)
			const f1 = await say("Mira", "Stones marked.")
			const f2 = await say("Bren", "Line held.")
			await scene(f1, f2, A3, ["Mira", "Bren"], day!.id)
			const g1 = await say("Mira", "Dusk comes.")
			const g2 = await say("Mira", "Across she goes.")
			await scene(g1, g2, A4, ["Mira"], day!.id)
			await scene(b1, b2, SUMMARY_B, ["Bren"], day!.id)
		} else {
			// Resolved with no participant row at all, then a scene Mira missed.
			await scene(e1, e2, EMPTY, [], day!.id)
			await scene(b1, b2, SUMMARY_D, ["Bren"], day!.id)
		}
	}
	const filler = "The road bends and the wind keeps on. ".repeat(24)
	await insertLegacyMany(
		db as unknown as Db,
		Array.from({ length: 60 }, (_, i) => ({
			sessionId,
			role: "user",
			userId,
			content: `${i}: ${filler}`
		})) as never
	)
	await say(null, LINE)
	return { tag, sessionId, cards, dayId: day!.id }
}
type World = Awaited<ReturnType<typeof world>>

const fakeSocket = (uid: number) => ({ user: { id: uid }, io: {} }) as never

async function reply(w: World, turn: Record<string, unknown>) {
	const { runReply } = await import("$lib/server/utils/runReply")
	prompts.length = 0
	const out = await runReply({
		socket: fakeSocket(userId),
		emitToUser: () => {},
		sessionId: w.sessionId,
		userId,
		turn: turn as never
	})
	expect(out.ok, out.error).toBe(true)
	expect(prompts.length).toBe(1)
	return prompts[0]!
}

/** Where two prompts first part, with the words around it. */
const firstDifference = (a: string, b: string) => {
	if (a === b) return "identical"
	let i = 0
	while (a[i] === b[i]) i++
	return `at ${i}: ${JSON.stringify(a.slice(i - 60, i + 80))} vs ${JSON.stringify(b.slice(i - 60, i + 80))}`
}

/** 🚧 The prompt of Mira's reply with the param on (the default), and with it off; first pinned 2026-11-17 (wt-1b). */
const ON_SHA =
	"ff1ea3ec2d101704d0aee37b0cc805c3f13d14a35125ea8f25492faed8699816"
const OFF_SHA =
	"c03c1b907deab1b52b93d86e2dc7895802cb3c1ac2c3177ce43fd53c2a8dcd25"

const asMira = (w: World) => ({
	kind: "respond",
	characterId: w.cards.Mira!.id
})

/** A side character who is also seated: the real `story-side-character` pipeline, judged as Mira. */
const asSideMira = (w: World) => ({
	kind: "narrate-character",
	speaker: { name: "Mira", characterId: w.cards.Mira!.id, known: true, character: null }
})

const sha = (s: string) => createHash("sha256").update(s).digest("hex")
const note = (line: string) => {
	console.info(line)
	if (process.env.KN2_SHA_LOG)
		appendFileSync(process.env.KN2_SHA_LOG, line + "\n")
}

beforeAll(async () => {
	dataDir = await fs.mkdtemp(
		path.join(os.tmpdir(), "serene-pub-vitest-speaker-in-cast-reply-")
	)
	process.env.SERENE_PUB_DATA_DIR = dataDir
	db = (await import("$lib/server/db")).db as unknown as TestDb
	const { bootstrapPipelines } = await import(
		"$lib/server/pipelines/boot/bootstrap"
	)
	await bootstrapPipelines(db)
	const { createTestUser } = await import("$lib/server/utils/testDb")
	userId = (await createTestUser(db, "speaker-in-cast-reply")).id

	const [textConn] = await db
		.insert(schema.connections)
		.values({ name: "Text", type: "koboldcpp", baseUrl: "http://text" })
		.returning()
	const { ensureConnectionModel } = await import(
		"$lib/server/connections/models"
	)
	const modelId = (await ensureConnectionModel(
		db,
		textConn!.id,
		"default-7b"
	))!.id
	const [sampling] = await db
		.insert(schema.samplingConfigs)
		.values({
			name: "default",
			isImmutable: false,
			values: {
				contextTokens: 8192,
				responseTokens: 200,
				temperature: 0.1
			},
			enabled: ["contextTokens", "responseTokens", "temperature"]
		} as never)
		.returning()
	const { setCapabilityDefault } = await import(
		"$lib/server/connections/capabilityDefaults"
	)
	await setCapabilityDefault(db, "text->text", {
		connectionId: textConn!.id,
		connectionModelId: modelId,
		samplingConfigId: sampling!.id
	})
})

afterAll(async () => {
	await releaseDataDir(dataDir)
})

/** Write `speakerInCast: false` into Story respond's default preset for its two history reads. */
async function declareOff() {
	const [spec] = await db
		.select()
		.from(schema.pipelineSpecs)
		.where(eq(schema.pipelineSpecs.slug, "core:spec/story-respond"))
	const [version] = await db
		.select()
		.from(schema.pipelineSpecVersions)
		.where(eq(schema.pipelineSpecVersions.id, spec!.activeVersionId!))
	const nodes = (await db
		.select()
		.from(schema.pipelineNodes)
		.where(eq(schema.pipelineNodes.specVersionId, version!.id))) as any[]
	const reads = nodes.filter((x) =>
		/^core:query\/(earlier-scenes|history-entries)(@\d+)?$/.test(
			x.definitionId
		)
	)
	expect(reads.length, "the two history reads on the active version").toBe(2)
	const [preset] = await db
		.select()
		.from(schema.pipelinePresets)
		.where(
			and(
				eq(schema.pipelinePresets.specVersionId, version!.id),
				eq(schema.pipelinePresets.isDefault, true)
			)
		)
	expect(preset, "story-respond has no default preset").toBeTruthy()
	for (const node of reads) {
		const where = and(
			eq(schema.pipelinePresetValues.presetId, preset!.id),
			eq(schema.pipelinePresetValues.nodeKey, node.nodeKey),
			eq(schema.pipelinePresetValues.slot, "params")
		)
		const [existing] = await db
			.select()
			.from(schema.pipelinePresetValues)
			.where(where)
		if (existing)
			await db
				.update(schema.pipelinePresetValues)
				.set({
					value: {
						...(existing.value as object),
						speakerInCast: false
					}
				})
				.where(where)
		else
			await db.insert(schema.pipelinePresetValues).values({
				presetId: preset!.id,
				nodeKey: node.nodeKey,
				slot: "params",
				value: { speakerInCast: false }
			} as never)
	}
}


/**
 * 🚧 Search by meaning on, for one reply: a model "loaded", `searchByMeaning: on`
 * in the spec's default preset, and the vector read returning the day (in the stored
 * text, whole). Always switched back after.
 */
async function withSearch<T>(specSlug: string, w: World, body: () => Promise<T>): Promise<T> {
	await setPresetParams(specSlug, /^core:task\/query-windows(@\d+)?$/, { searchByMeaning: "on" })
	emb.on = true
	emb.hit = { id: w.dayId, source: "historyEntry", score: 0.9, priority: 1, content: DAY_TEXT }
	try {
		return await body()
	} finally {
		emb.on = false
		emb.hit = null
	}
}

/** Write `patch` into a spec's default preset, `params` slot, for every node of the matching definitions. */
async function setPresetParams(specSlug: string, definition: RegExp, patch: Record<string, unknown>) {
	const [spec] = await db.select().from(schema.pipelineSpecs).where(eq(schema.pipelineSpecs.slug, specSlug))
	const versionId = spec!.activeVersionId!
	const nodes = (await db
		.select()
		.from(schema.pipelineNodes)
		.where(eq(schema.pipelineNodes.specVersionId, versionId))) as any[]
	const reads = nodes.filter((x) => definition.test(x.definitionId))
	expect(reads.length, `${specSlug}: nodes of ${definition}`).toBeGreaterThan(0)
	const [preset] = await db
		.select()
		.from(schema.pipelinePresets)
		.where(and(eq(schema.pipelinePresets.specVersionId, versionId), eq(schema.pipelinePresets.isDefault, true)))
	expect(preset, `${specSlug} has no default preset`).toBeTruthy()
	for (const node of reads) {
		const where = and(
			eq(schema.pipelinePresetValues.presetId, preset!.id),
			eq(schema.pipelinePresetValues.nodeKey, node.nodeKey),
			eq(schema.pipelinePresetValues.slot, "params")
		)
		const [existing] = await db.select().from(schema.pipelinePresetValues).where(where)
		if (existing)
			await db
				.update(schema.pipelinePresetValues)
				.set({ value: { ...(existing.value as object), ...patch } })
				.where(where)
		else
			await db.insert(schema.pipelinePresetValues).values({
				presetId: preset!.id,
				nodeKey: node.nodeKey,
				slot: "params",
				value: patch
			} as never)
	}
}

/**
 * The administrator's one switch, *Only scenes the speaker was in*, turned off through the
 * panel's own write: it reaches every read of the pipeline that declares the param.
 */
async function switchOffThroughPanel(specSlug: string) {
	const panel = await import("$lib/server/pipelines/config/panel")
	const { GANGED_PSEUDO_NODE } = await import("$lib/server/pipelines/config/panel/ganged")
	const { groupOptions } = await import("$lib/server/pipelines/config/panel/groups")
	const { createTestUser } = await import("$lib/server/utils/testDb")
	const admin = await createTestUser(db, `speaker-in-cast-admin-${++n}`)
	await db.update(schema.users).set({ isAdmin: true } as never).where(eq(schema.users.id, admin.id))
	const viewer = { userId: admin.id, isAdmin: true }
	const SECRET = "speaker-in-cast-secret"
	const view = (await panel.namespaceView(db, SECRET, specSlug, viewer)) as any
	const option = (groupOptions(view.groups) as any[]).filter((o) => o.label === "Only scenes the speaker was in")
	expect(option, `${specSlug}: one switch`).toHaveLength(1)
	expect(JSON.stringify(option[0])).not.toContain(GANGED_PSEUDO_NODE)
	await panel.writeOption(db, SECRET, specSlug, viewer, option[0].id, false)
}

// Before the "off" case: it writes the param off into the shared default preset.
describe("speakerInCast in the host's lore read, over the reply road", () => {
	it("two of three scenes: Mira reads both summaries, together longer than the day's own text", async () => {
		const w = await world("two-of-three")
		const p = await reply(w, asMira(w))
		expect(p).toContain(SUMMARY_A)
		expect(p).toContain(A2)
		expect(p).not.toContain(SUMMARY_B)
		expect(p).not.toContain(DAY_TEXT)
		expect(`${SUMMARY_A}\n\n${A2}`.length).toBeGreaterThan(DAY_TEXT.length)
	})

	it("the cut keeps the start: the first summaries stay, the last is dropped", async () => {
		const w = await world("cut")
		const p = await reply(w, asMira(w))
		expect(p).toContain(SUMMARY_A)
		expect(p).toContain(A2)
		expect(p).not.toContain(A3)
		expect(p).not.toContain(A4)
		expect(`${SUMMARY_A}\n\n${A2}`.length).toBeLessThanOrEqual(
			2 * DAY_TEXT.length
		)
		expect(`${SUMMARY_A}\n\n${A2}\n\n${A3}`.length).toBeGreaterThan(
			2 * DAY_TEXT.length
		)
	})

	it("a scene resolved with an empty cast is kept", async () => {
		const w = await world("empty-cast")
		const p = await reply(w, asMira(w))
		expect(p).toContain(SUMMARY_A)
		expect(p).toContain(EMPTY)
		expect(p).not.toContain(SUMMARY_D)
		expect(p).not.toContain(DAY_TEXT)
	})
})


// Search by meaning on, the switch on (the default): the half-missed day, handed to the run
// by the vector read, arrives as the speaker's scenes only. Before the "off" case below.
describe("speakerInCast with search by meaning returning the day", () => {
	it("Story's reply: the day arrives as A's summary; the day's own text, B's and C's appear nowhere", async () => {
		const w = await world()
		const p = await withSearch("core:spec/story-respond", w, () => reply(w, asMira(w)))
		expect(p).toContain(SUMMARY_A)
		expect(p).not.toContain(DAY_TEXT)
		expect(p).not.toContain(SUMMARY_B)
		expect(p).not.toContain(SUMMARY_C)
		made.onSearched = p
	})

	it("Story's reply, the day reachable only by search: still A's summary, never the day's own text or B's", async () => {
		const w = await world("default", { searchOnly: true })
		const p = await withSearch("core:spec/story-respond", w, () => reply(w, asMira(w)))
		expect(p).toContain(SUMMARY_A)
		expect(p).not.toContain(DAY_TEXT)
		expect(p).not.toContain(SUMMARY_B)
	})

	it("the real story-side-character pipeline: the same, for the side character Mira", async () => {
		const w = await world("default", { searchOnly: true })
		const p = await withSearch("core:spec/story-side-character", w, () =>
			reply(w, asSideMira(w))
		)
		expect(p).toContain(SUMMARY_A)
		expect(p).not.toContain(DAY_TEXT)
		expect(p).not.toContain(SUMMARY_B)
	})
})

describe("speakerInCast over the reply road", () => {
	it("on (the default): Mira reads the day as A's summary, and neither B's nor C's", async () => {
		const w = await world()
		made.on = await reply(w, asMira(w))
		expect(made.on).toContain(SUMMARY_A)
		expect(made.on).not.toContain(DAY_TEXT)
		expect(made.on).not.toContain(SUMMARY_B)
		expect(made.on).not.toContain(SUMMARY_C)
	})

	it("on: a narrator turn reads the day's own text and C's summary", async () => {
		const w = await world()
		made.narratorOn = await reply(w, { kind: "respond" })
		expect(made.narratorOn).toContain(DAY_TEXT)
		expect(made.narratorOn).toContain(SUMMARY_C)
		expect(made.narratorOn).not.toContain(SUMMARY_A)
	})

	it("off, declared in the pipeline's defaults: the day's own text and C's summary", async () => {
		await declareOff()
		const w = await world()
		made.off = await reply(w, asMira(w))
		expect(made.off).toContain(DAY_TEXT)
		expect(made.off).toContain(SUMMARY_C)
		expect(made.off).not.toContain(SUMMARY_A)
		expect(made.off).not.toContain(SUMMARY_B)
		const w2 = await world()
		made.narratorOff = await reply(w2, { kind: "respond" })
		expect(made.narratorOn).toBe(made.narratorOff)
		note(`[speaker-in-cast on] sha256=${sha(made.on)}`)
		note(`[speaker-in-cast off] sha256=${sha(made.off)}`)
		// The only differences: the day block (the day's own text against A's summary)
		// and the Earlier in the story block (C's summary).
		const sameButTwoBlocks = made.off
			.replace(DAY_TEXT, SUMMARY_A)
			.replace(/\\nEarlier in the story:\\n```json\\n\[.*?\]\\n```/, "")
		expect(firstDifference(made.on, sameButTwoBlocks)).toBe("identical")
		// Pinned: a change to either prompt is deliberate, so re-pin it here and say why.
		expect(sha(made.on)).toBe(ON_SHA)
		expect(sha(made.off)).toBe(OFF_SHA)
	})
})

// After the "off" case above. The switch is turned off once more through the panel, which
// writes every read of the pipeline that declares it: with search by meaning handing the
// run the day, the prompt is what it was before lane wt-1b.
describe("the one switch off is off for every read of the run", () => {
	it("Story's reply: with search by meaning returning the day, the prompt is the pre-wt-1b prompt", async () => {
		await switchOffThroughPanel("core:spec/story-respond")
		const w = await world()
		const p = await withSearch("core:spec/story-respond", w, () => reply(w, asMira(w)))
		expect(p).toContain(DAY_TEXT)
		expect(p).toContain(SUMMARY_C)
		expect(p).not.toContain(SUMMARY_A)
		expect(p).not.toContain(SUMMARY_B)
		// What search by meaning adds, with the switch off and the rule absent, is the day
		// once more, whole, as its own entry (a separate candidate from the lane's copy).
		// With that one copy taken out the prompt is byte-identical to the off prompt of the
		// first fixture (`OFF_SHA`), which equals the prompt before lane wt-1b.
		const searchCopy = `,{\\"date\\":\\"\\",\\"content\\":\\"${DAY_TEXT}\\"}`
		expect(p.split(searchCopy).length - 1, "search by meaning handed over the day once").toBe(1)
		const withoutSearchCopy = p.replace(searchCopy, "")
		expect(firstDifference(withoutSearchCopy, made.off)).toBe("identical")
		expect(sha(withoutSearchCopy)).toBe(OFF_SHA)
	})

	it("the day reachable only by search arrives whole, and the side character reads it whole", async () => {
		const w = await world("default", { searchOnly: true })
		const p = await withSearch("core:spec/story-respond", w, () => reply(w, asMira(w)))
		expect(p).toContain(DAY_TEXT)
		expect(p).not.toContain(SUMMARY_A)
		await switchOffThroughPanel("core:spec/story-side-character")
		const w2 = await world("default", { searchOnly: true })
		const q = await withSearch("core:spec/story-side-character", w2, () => reply(w2, asSideMira(w2)))
		expect(q).toContain(DAY_TEXT)
		expect(q).not.toContain(SUMMARY_A)
		expect(q).not.toContain(SUMMARY_B)
	})
})
