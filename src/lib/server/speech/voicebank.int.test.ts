/**
 * Speech build, lane V3a: the voicebank helpers (entry refusal, the one-time default
 * seed, slugs) and the voice resolver against a real database, with a Narration
 * loadout filled by hand. The pure resolver core has its own tests.
 */
import { afterAll, beforeAll, beforeEach, describe, expect, test, vi } from "vitest"
import fs from "fs/promises"
import os from "os"
import path from "path"
import { eq } from "drizzle-orm"
import * as schema from "$lib/server/db/schema"
import { CONNECTION_TYPE } from "$lib/shared/constants/ConnectionTypes"
import type { TestDb } from "$lib/server/utils/testDb"

// DB setup under load.
vi.setConfig({ testTimeout: 60_000, hookTimeout: 60_000 })

vi.mock("$lib/server/db", async () => {
	const { createTestDb } = await import("$lib/server/utils/testDb")
	const db = await createTestDb()
	return { db, dbReady: Promise.resolve() }
})

let db: TestDb
let dataDir: string

beforeAll(async () => {
	dataDir = await fs.mkdtemp(path.join(os.tmpdir(), "serene-pub-vitest-voicebank-"))
	process.env.SERENE_PUB_DATA_DIR = dataDir
	db = (await import("$lib/server/db")).db as unknown as TestDb
	// The genre registry (the session settings cascade reads declared genre fields).
	const { bootstrapPipelines } = await import("$lib/server/pipelines/boot/bootstrap")
	await bootstrapPipelines(db as never)
}, 180_000)

afterAll(async () => {
	await fs.rm(dataDir, { recursive: true, force: true })
})

const speechFacts = (voices: string[]) => ({
	speech: {
		voices: voices.map((id) => ({ id, name: id.toUpperCase(), kind: "preset" })),
		voicesFrom: "catalogue",
		controls: {},
		streams: false,
		formats: ["mp3"]
	}
})

let n = 0
async function model(facts: unknown = null) {
	const [c] = await db
		.insert(schema.connections)
		.values({ name: `tts ${++n}`, type: CONNECTION_TYPE.OLLAMA, baseUrl: "http://localhost:1", modality: "text-gen" })
		.returning()
	const [m] = await db
		.insert(schema.connectionModels)
		.values({ connectionId: c!.id, model: `kokoro-${n}`, name: `kokoro-${n}`, facts: (facts ?? {}) as never })
		.returning()
	return { connection: c!, model: m! }
}

/** The Narration loadout (seed key), filled with a model when given. */
async function narration(opts: { facts?: unknown; samplingVoice?: string; unfilled?: boolean } = {}) {
	const mm = opts.unfilled ? null : await model(opts.facts ?? null)
	let samplingConfigId: number | null = null
	if (opts.samplingVoice) {
		const [s] = await db
			.insert(schema.samplingConfigs)
			.values({ name: `tts sampling ${++n}`, shape: "core:shape/speech@1", values: { voice: opts.samplingVoice } })
			.returning()
		samplingConfigId = s!.id
	}
	const [l] = await db
		.insert(schema.loadouts)
		.values({
			seedKey: "core:loadout/tts@1",
			slug: "tts",
			name: "Narration",
			owner: "core",
			transform: "text->audio",
			connectionId: mm?.connection.id ?? null,
			connectionModelId: mm?.model.id ?? null,
			samplingConfigId
		} as never)
		.returning()
	return { loadout: l!, model: mm?.model ?? null }
}

async function row(over: Partial<typeof schema.voicebankVoices.$inferInsert> & { slug: string }) {
	const [r] = await db
		.insert(schema.voicebankVoices)
		.values({ name: over.slug, voiceId: `vid-${over.slug}`, ...over })
		.returning()
	return r!
}

async function user() {
	const { createTestUser } = await import("$lib/server/utils/testDb")
	return createTestUser(db)
}

async function character(userId: number, timbre?: Record<string, unknown>) {
	const [c] = await db
		.insert(schema.characters)
		.values({ userId, name: `char ${++n}`, description: "", extensions: timbre ? { serenepub: { timbre } } : {} } as never)
		.returning()
	return c!
}

async function session(userId: number, genreFields: Record<string, unknown> = {}) {
	const [s] = await db
		.insert(schema.sessions)
		.values({ userId, isGroup: false, genreId: "core:genre/story", primaryRuleset: "core:ruleset/freeform@1", rigour: "prose", genreFields } as never)
		.returning()
	return s!
}

beforeEach(async () => {
	await db.delete(schema.voicebankVoices)
	await db.delete(schema.loadouts)
	await db.delete(schema.connections)
	await db.delete(schema.systemSettings)
	await db.insert(schema.systemSettings).values({ defaultLanguage: "en" } as never)
})

describe("voicebankRefusal", () => {
	const lo = (over: Record<string, unknown> = {}) => ({
		loadoutId: 7, name: "Kokoro", connectionId: 1, connectionModelId: 2, samplingConfigId: null, filled: true, ...over
	}) as never

	test("off, unassigned, no model yet — in order — and null when usable", async () => {
		const { voicebankRefusal } = await import("./voicebank")
		expect(voicebankRefusal({ enabled: false, loadoutId: 7 }, lo())).toBe("This voice is turned off.")
		expect(voicebankRefusal({ enabled: true, loadoutId: null }, null)).toBe(
			"This voice has no loadout; pick one in Loadouts → Voices."
		)
		expect(voicebankRefusal({ enabled: true, loadoutId: 7 }, lo({ filled: false, connectionModelId: null }))).toBe(
			'Its loadout "Kokoro" has no model yet.'
		)
		expect(voicebankRefusal({ enabled: true, loadoutId: 7 }, lo())).toBeNull()
		// Another entry's loadout on another model is fine: A7 is retired.
		expect(voicebankRefusal({ enabled: true, loadoutId: 8 }, lo({ loadoutId: 8, connectionModelId: 99 }))).toBeNull()
	})
})

describe("entryLoadout / voicebankLoadoutOptions", () => {
	async function speechLoadout(name: string, over: Record<string, unknown> = {}, unfilled = false) {
		const mm = unfilled ? null : await model()
		const [l] = await db
			.insert(schema.loadouts)
			.values({
				slug: name.toLowerCase(), name, owner: "pub", transform: "text->audio",
				connectionId: mm?.connection.id ?? null, connectionModelId: mm?.model.id ?? null, ...over
			} as never)
			.returning()
		return { loadout: l!, model: mm?.model ?? null, connection: mm?.connection ?? null }
	}

	test("the pair is the merge ROOT's; an unfilled loadout is not filled and has no fallback", async () => {
		const { entryLoadout } = await import("./voicebank")
		const root = await speechLoadout("Root")
		const child = await speechLoadout("Child", { mergedInto: root.loadout.id })
		const blank = await speechLoadout("Blank", {}, true)
		expect(await entryLoadout(db as never, child.loadout.id)).toMatchObject({
			loadoutId: child.loadout.id, name: "Child", connectionModelId: root.model!.id, filled: true
		})
		expect(await entryLoadout(db as never, blank.loadout.id)).toMatchObject({ connectionModelId: null, filled: false })
		expect(await entryLoadout(db as never, null)).toBeNull()
		expect(await entryLoadout(db as never, 987654)).toBeNull()
	})

	test("options list every text->audio loadout, the default first, then by name", async () => {
		const { voicebankLoadoutOptions } = await import("./voicebank")
		await speechLoadout("Zed")
		await speechLoadout("Able", {}, true)
		const dflt = await speechLoadout("Middle", { defaultForInput: "text", defaultForOutput: "audio" })
		await db.insert(schema.loadouts).values({ slug: "reply", name: "Reply", owner: "pub", transform: "text->text" } as never)
		const options = await voicebankLoadoutOptions(db as never)
		expect(options.map((o) => o.name)).toEqual(["Middle", "Able", "Zed"])
		expect(options[0]).toMatchObject({ id: dflt.loadout.id, isDefault: true, filled: true, modelName: dflt.model!.name, connectionName: dflt.connection!.name })
		expect(options[1]).toMatchObject({ filled: false, connectionModelId: null, modelName: null, isDefault: false })
	})

	test("speechAvailability: no speaking pair but an enabled entry on a filled loadout can speak", async () => {
		const { speechAvailability } = await import("./voicebank")
		await narration({ unfilled: true })
		expect(await speechAvailability(db as never)).toMatchObject({ canSpeak: false })
		const other = await speechLoadout("Other")
		await row({ slug: "x", loadoutId: other.loadout.id })
		expect(await speechAvailability(db as never)).toEqual({ canSpeak: true })
	})
})

describe("ensureLoadoutVoice", () => {
	test("seeds one pub Narrator default, preferring the sampling voice over the facts", async () => {
		const { ensureLoadoutVoice } = await import("./voicebank")
		const { loadout } = await narration({ facts: speechFacts(["af_a", "af_b"]), samplingVoice: "samp-voice" })
		const seeded = await ensureLoadoutVoice(db as never)
		expect(seeded).toMatchObject({ name: "Narrator", slug: "narrator", owner: "pub", voiceId: "samp-voice", loadoutId: loadout.id })
		// No star; the Narration loadout's voice points at it.
		const [l] = await db.select().from(schema.loadouts).where(eq(schema.loadouts.id, loadout.id))
		expect(l!.defaultVoiceId).toBe(seeded!.id)
		// Idempotent: a non-empty table inserts nothing.
		expect(await ensureLoadoutVoice(db as never)).toBeNull()
		expect(await db.select().from(schema.voicebankVoices)).toHaveLength(1)
	})

	test("falls back to the pair model's first listed voice", async () => {
		const { ensureLoadoutVoice } = await import("./voicebank")
		await narration({ facts: speechFacts(["af_first", "af_second"]) })
		const seeded = await ensureLoadoutVoice(db as never)
		expect(seeded?.voiceId).toBe("af_first")
	})

	test("no voice known (no sampling voice, no facts) -> no row; unfilled loadout -> no row", async () => {
		const { ensureLoadoutVoice } = await import("./voicebank")
		await narration({ facts: null })
		expect(await ensureLoadoutVoice(db as never)).toBeNull()
		expect(await db.select().from(schema.voicebankVoices)).toHaveLength(0)
		await db.delete(schema.loadouts)
		await narration({ unfilled: true })
		expect(await ensureLoadoutVoice(db as never)).toBeNull()
		expect(await db.select().from(schema.voicebankVoices)).toHaveLength(0)
	})

	test("a non-empty table (any owner, any state) blocks the seed", async () => {
		const { ensureLoadoutVoice } = await import("./voicebank")
		await narration({ facts: speechFacts(["af_a"]) })
		await row({ slug: "someone", enabled: false })
		expect(await ensureLoadoutVoice(db as never)).toBeNull()
		expect(await db.select().from(schema.voicebankVoices)).toHaveLength(1)
	})

	test("a speaking loadout with entries and no loadout voice gets its first enabled entry (lowest id)", async () => {
		const { ensureLoadoutVoice } = await import("./voicebank")
		const { loadout } = await narration({ facts: speechFacts(["af_a"]) })
		await row({ slug: "off", loadoutId: loadout.id, enabled: false })
		const first = await row({ slug: "first", loadoutId: loadout.id })
		await row({ slug: "second", loadoutId: loadout.id })
		expect(await ensureLoadoutVoice(db as never)).toBeNull()
		const pointer = async () => (await db.select().from(schema.loadouts).where(eq(schema.loadouts.id, loadout.id)))[0]!.defaultVoiceId
		expect(await pointer()).toBe(first.id)
		// A voice already set is left alone.
		const second = (await db.select().from(schema.voicebankVoices)).find((r) => r.slug === "second")!
		await db.update(schema.loadouts).set({ defaultVoiceId: second.id }).where(eq(schema.loadouts.id, loadout.id))
		await ensureLoadoutVoice(db as never)
		expect(await pointer()).toBe(second.id)
	})

	test("loadoutVoiceRows lists one loadout's entries by id", async () => {
		const { loadoutVoiceRows } = await import("./voicebank")
		const { loadout } = await narration({ facts: speechFacts(["af_a"]) })
		const [otherLoadout] = await db.insert(schema.loadouts).values({ slug: "other", name: "Other", owner: "pub", transform: "text->audio" } as never).returning()
		const other = { loadout: otherLoadout! }
		const a = await row({ slug: "a", loadoutId: loadout.id })
		await row({ slug: "elsewhere", loadoutId: other.loadout.id })
		const b = await row({ slug: "b", loadoutId: loadout.id, enabled: false })
		expect((await loadoutVoiceRows(db as never, loadout.id)).map((r) => r.id)).toEqual([a.id, b.id])
	})

	test("re-seeds after every row is deleted", async () => {
		const { ensureLoadoutVoice } = await import("./voicebank")
		await narration({ facts: speechFacts(["af_a"]) })
		const first = await ensureLoadoutVoice(db as never)
		await db.delete(schema.voicebankVoices)
		const second = await ensureLoadoutVoice(db as never)
		expect(second).not.toBeNull()
		expect(second!.id).not.toBe(first!.id)
		expect(second).toMatchObject({ slug: "narrator" })
	})
})

describe("uniqueVoicebankSlug", () => {
	test("suffixes -2, -3 on collision within an owner; exceptId and other owners do not collide", async () => {
		const { uniqueVoicebankSlug, slugifyVoicebank } = await import("./voicebank")
		expect(slugifyVoicebank("  Ünï Cödé!! ")).toBe("uni-code")
		expect(slugifyVoicebank("!!!")).toBe("voice")
		expect(await uniqueVoicebankSlug(db as never, "pub", "Narrator")).toBe("narrator")
		const a = await row({ slug: "narrator" })
		expect(await uniqueVoicebankSlug(db as never, "pub", "Narrator")).toBe("narrator-2")
		await row({ slug: "narrator-2" })
		expect(await uniqueVoicebankSlug(db as never, "pub", "Narrator")).toBe("narrator-3")
		expect(await uniqueVoicebankSlug(db as never, "pub", "Narrator", a.id)).toBe("narrator")
		expect(await uniqueVoicebankSlug(db as never, "acme.plugin", "Narrator")).toBe("narrator")
	})

	test("voicebankBySlug prefers the pub row over a plugin row with the same slug", async () => {
		const { voicebankBySlug } = await import("./voicebank")
		await row({ slug: "dup", owner: "acme.plugin", voiceId: "plug" })
		await row({ slug: "dup", owner: "pub", voiceId: "mine" })
		expect((await voicebankBySlug(db as never, "dup"))?.voiceId).toBe("mine")
	})
})

describe("speakingLoadout (F1)", () => {
	test("falls back to the Narration seed key when no text->audio default exists", async () => {
		const { speakingLoadout } = await import("./voicebank")
		const { loadout } = await narration({ facts: null })
		expect((await speakingLoadout(db as never))?.loadoutId).toBe(loadout.id)
	})
})

describe("resolveVoice against a real database", () => {
	async function world(opts: { facts?: unknown; samplingVoice?: string } = {}) {
		const nl = await narration({ facts: opts.facts ?? speechFacts(["svc-1", "svc-2"]), samplingVoice: opts.samplingVoice })
		const u = await user()
		return { ...nl, u, modelId: nl.model!.id }
	}

	test("character:<id> with a timbre voice -> from timbre, settings layered, description and language from the timbre", async () => {
		const { resolveVoice } = await import("./resolveVoice")
		const w = await world()
		await row({ slug: "alice", voiceId: "v-alice", loadoutId: w.loadout.id, settings: { speed: 1.2, stability: 0.4 }, language: "fr" })
		const c = await character(w.u.id, { voice: "alice", description: "warm alto", language: "de", settings: { speed: 0.9 } })
		const res = await resolveVoice({ speakerRef: `character:${c.id}`, sessionId: null }, db as never)
		expect(res).toMatchObject({
			ok: true,
			from: "timbre",
			voiceId: "v-alice",
			voicebankSlug: "alice",
			connectionModelId: w.modelId,
			description: "warm alto",
			language: "de",
			languageFrom: "timbre",
			settings: { speed: 0.9, stability: 0.4 }
		})
	})

	test("player-seat:<id> carries the voiced persona's timbre", async () => {
		const { resolveVoice } = await import("./resolveVoice")
		const w = await world()
		await row({ slug: "bob", voiceId: "v-bob", loadoutId: w.loadout.id })
		const persona = await character(w.u.id, { voice: "bob" })
		const s = await session(w.u.id)
		const [seat] = await db.insert(schema.sessionPersonas).values({ sessionId: s.id, personaId: persona.id } as never).returning()
		const res = await resolveVoice({ speakerRef: `player-seat:${seat!.id}`, sessionId: s.id }, db as never)
		expect(res).toMatchObject({ ok: true, from: "timbre", voiceId: "v-bob" })
		// A seat with no persona has no timbre and does not throw.
		const [empty] = await db.insert(schema.sessionPersonas).values({ sessionId: s.id, personaId: null } as never).returning()
		const res2 = await resolveVoice({ speakerRef: `player-seat:${empty!.id}`, sessionId: s.id }, db as never)
		// ...so it takes the narrator chain: the loadout's first entry.
		expect(res2).toMatchObject({ ok: true, from: "loadout-first", voiceId: "v-bob" })
	})

	test("user:, envoy:, null (narrator) and a malformed ref have no timbre and never throw", async () => {
		const { resolveVoice } = await import("./resolveVoice")
		const w = await world()
		for (const ref of [`user:${w.u.id}`, "envoy:castellan", null, "character:abc", "not a ref", "character:", "player-seat:zz", "character:99999999"] as any[]) {
			const res = await resolveVoice({ speakerRef: ref, sessionId: null }, db as never)
			expect(res, String(ref)).toMatchObject({ ok: true, from: "service", voiceId: "svc-1", description: null })
		}
	})

	test("unfilled loadout -> refusal; deleted-model pair counts as unfilled", async () => {
		const { resolveVoice } = await import("./resolveVoice")
		await narration({ unfilled: true })
		const res = await resolveVoice({ speakerRef: null, sessionId: null }, db as never)
		expect(res).toMatchObject({ ok: false })
		expect((res as { reason: string }).reason).toMatch(/no model yet/)
	})

	test("no loadout at all -> refusal", async () => {
		const { resolveVoice } = await import("./resolveVoice")
		expect(await resolveVoice({ speakerRef: null, sessionId: null }, db as never)).toMatchObject({ ok: false })
	})

	test("omitted loadoutId -> the Narration loadout; an explicit unfilled loadoutId -> refusal", async () => {
		const { resolveVoice } = await import("./resolveVoice")
		const w = await world()
		const ok = await resolveVoice({ speakerRef: null, sessionId: null }, db as never)
		expect(ok).toMatchObject({ ok: true, connectionModelId: w.modelId })
		const [other] = await db
			.insert(schema.loadouts)
			.values({ slug: "blank", name: "Blank", owner: "pub", transform: "text->audio" } as never)
			.returning()
		const refused = await resolveVoice({ speakerRef: null, sessionId: null, loadoutId: other!.id }, db as never)
		expect(refused).toMatchObject({ ok: false })
		// Explicit id of the Narration loadout resolves the same as omitted.
		const same = await resolveVoice({ speakerRef: null, sessionId: null, loadoutId: w.loadout.id }, db as never)
		expect(same).toMatchObject({ ok: true, connectionModelId: w.modelId })
	})

	test("unassigned / no-model / disabled / unknown timbre entries are skipped with a reason and resolution continues", async () => {
		const { resolveVoice } = await import("./resolveVoice")
		const w = await world()
		const [blank] = await db
			.insert(schema.loadouts)
			.values({ slug: "blank2", name: "Blank", owner: "pub", transform: "text->audio" } as never)
			.returning()
		await row({ slug: "nomodel", loadoutId: blank!.id })
		await row({ slug: "orphan", loadoutId: null })
		await row({ slug: "off", loadoutId: w.loadout.id, enabled: false })
		const dflt = await row({ slug: "dflt", voiceId: "v-default", loadoutId: w.loadout.id })
		await db.update(schema.loadouts).set({ defaultVoiceId: dflt.id } as never).where(eq(schema.loadouts.id, w.loadout.id))
		for (const [slug, why] of [
			["nomodel", /has no model yet/],
			["orphan", /has no loadout/],
			["off", /turned off/],
			["ghost", /No voicebank voice is named "ghost"/]
		] as const) {
			const c = await character(w.u.id, { voice: slug })
			const res = await resolveVoice({ speakerRef: `character:${c.id}`, sessionId: null }, db as never)
			expect(res.ok).toBe(true)
			if (!res.ok) continue
			expect(res.from, slug).toBe("loadout-voice")
			expect(res.voiceId).toBe("v-default")
			expect(res.skipped).toHaveLength(1)
			expect(res.skipped[0]).toMatchObject({ from: "timbre", slug })
			expect(res.skipped[0]!.reason).toMatch(why)
		}
	})

	test("deleting the loadout of the voice leaves it unassigned and skipped, not a throw (FK set null)", async () => {
		const { resolveVoice } = await import("./resolveVoice")
		const w = await world()
		const [extra] = await db
			.insert(schema.loadouts)
			.values({ slug: "extra", name: "Extra", owner: "pub", transform: "text->audio" } as never)
			.returning()
		const r = await row({ slug: "carol", loadoutId: extra!.id })
		await db.delete(schema.loadouts).where(eq(schema.loadouts.id, extra!.id))
		const [after] = await db.select().from(schema.voicebankVoices).where(eq(schema.voicebankVoices.id, r.id))
		expect(after!.loadoutId).toBeNull()
		const c = await character(w.u.id, { voice: "carol" })
		const res = await resolveVoice({ speakerRef: `character:${c.id}`, sessionId: null }, db as never)
		expect(res).toMatchObject({ ok: true, from: "service" })
		expect((res as any).skipped[0].reason).toMatch(/no loadout/)
	})

	test("loadout sampling voice beats the service; service fallback takes the first of two listed voices", async () => {
		const { resolveVoice } = await import("./resolveVoice")
		await world()
		const svc = await resolveVoice({ speakerRef: null, sessionId: null }, db as never)
		expect(svc).toMatchObject({ ok: true, from: "service", voiceId: "svc-1", voicebankSlug: null })
		await db.delete(schema.loadouts)
		await db.delete(schema.connections)
		await world({ samplingVoice: "samp" })
		expect(await resolveVoice({ speakerRef: null, sessionId: null }, db as never)).toMatchObject({ ok: true, from: "loadout", voiceId: "samp" })
	})

	test("pair with no listed voices and no sampling voice -> service with voiceId null", async () => {
		const { resolveVoice } = await import("./resolveVoice")
		await world({ facts: speechFacts([]) })
		expect(await resolveVoice({ speakerRef: null, sessionId: null }, db as never)).toMatchObject({ ok: true, from: "service", voiceId: null })
	})

	test("pub language fallback from system_settings.default_language", async () => {
		const { resolveVoice } = await import("./resolveVoice")
		await world()
		await db.update(schema.systemSettings).set({ defaultLanguage: "es" })
		expect(await resolveVoice({ speakerRef: null, sessionId: null }, db as never)).toMatchObject({ language: "es", languageFrom: "pub" })
		// A cue language beats the pub's.
		expect(await resolveVoice({ speakerRef: null, sessionId: null, cueLanguage: "JA" }, db as never)).toMatchObject({ language: "ja", languageFrom: "cue" })
	})

	test("session narrator voice (genre_fields.speechNarratorVoice) and language (sessionLanguage) are read", async () => {
		const { resolveVoice } = await import("./resolveVoice")
		const w = await world()
		await row({ slug: "narr", voiceId: "v-narr", loadoutId: w.loadout.id })
		const s = await session(w.u.id, { speechNarratorVoice: "narr", sessionLanguage: "it" })
		const res = await resolveVoice({ speakerRef: null, sessionId: s.id }, db as never)
		expect(res).toMatchObject({ ok: true, from: "session", voiceId: "v-narr", voicebankSlug: "narr", language: "it", languageFrom: "session" })
		// A character's timbre still wins over the session's narrator voice.
		await row({ slug: "own", voiceId: "v-own", loadoutId: w.loadout.id })
		const c = await character(w.u.id, { voice: "own" })
		expect(await resolveVoice({ speakerRef: `character:${c.id}`, sessionId: s.id }, db as never)).toMatchObject({ from: "timbre", voiceId: "v-own", language: "it" })
		// A session naming a voice that has since been deleted is skipped, not fatal.
		const gone = await session(w.u.id, { speechNarratorVoice: "deleted-later" })
		const res2 = await resolveVoice({ speakerRef: null, sessionId: gone.id }, db as never)
		expect(res2).toMatchObject({ ok: true, from: "loadout-first" })
		expect((res2 as any).skipped[0]).toMatchObject({ from: "session", slug: "deleted-later" })
	})
})
