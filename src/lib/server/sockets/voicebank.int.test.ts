/**
 * Speech build, lane V3a: the `voicebank:*` sockets. Handlers are driven
 * directly with a fake socket (admin vs member), as `cardState.int.test.ts`
 * does; the interest gate is driven through the real `connectSockets` and the
 * real `GATED_EVENTS`.
 */
import { afterAll, beforeAll, beforeEach, describe, expect, test, vi } from "vitest"
import fs from "fs/promises"
import os from "os"
import path from "path"
import { eq } from "drizzle-orm"
import * as schema from "$lib/server/db/schema"
import { CONNECTION_TYPE } from "$lib/shared/constants/ConnectionTypes"
import { GATED_EVENTS, isGatedEvent } from "$lib/shared/sockets/interest"
import type { TestDb } from "$lib/server/utils/testDb"

// DB setup under load.
vi.setConfig({ testTimeout: 60_000, hookTimeout: 60_000 })

vi.mock("$lib/server/db", async () => {
	const { createTestDb } = await import("$lib/server/utils/testDb")
	const db = await createTestDb()
	return { db, dbReady: Promise.resolve(), getCryptoSecretKey: () => "voicebank-sockets-test-secret" }
})

let db: TestDb
let dataDir: string

beforeAll(async () => {
	dataDir = await fs.mkdtemp(path.join(os.tmpdir(), "serene-pub-vitest-voicebank-sockets-"))
	process.env.SERENE_PUB_DATA_DIR = dataDir
	db = (await import("$lib/server/db")).db as unknown as TestDb
}, 60_000)

afterAll(async () => {
	await fs.rm(dataDir, { recursive: true, force: true })
})

const ADMIN = { id: 1, username: "owner", isAdmin: true }
const MEMBER = { id: 2, username: "reader", isAdmin: false }

type Emitted = { event: string; data: any }
const EVENTS = ["list", "create", "update", "delete", "pickable"] as const
const HANDLER = {
	list: "voicebankList",
	create: "voicebankCreate",
	update: "voicebankUpdate",
	delete: "voicebankDelete",
	pickable: "voicebankPickable"
} as const

async function call(
	ev: (typeof EVENTS)[number],
	user: { id: number; username: string; isAdmin: boolean } | null,
	params: Record<string, unknown> = {}
) {
	const mod = await import("./voicebank")
	const handler = mod[HANDLER[ev]] as { event: string; handler: (s: any, p: any, e: any) => Promise<any> }
	const out: Emitted[] = []
	const socket = { user, io: { to: () => ({ emit: () => {} }) } } as any
	try {
		const res = await handler.handler(socket, params, (event: string, data: any) => {
			out.push({ event, data })
		})
		return { res, out, error: null as string | null }
	} catch (e) {
		const refusal = out.find((o) => o.event === `${handler.event}:error`)
		return { res: null, out, error: (refusal?.data?.error ?? (e as Error).message) as string }
	}
}

const speechFacts = (voices: Array<{ id: string; previewUrl?: string }>) => ({
	speech: {
		voices: voices.map((v) => ({ id: v.id, name: v.id, kind: "preset", ...(v.previewUrl ? { previewUrl: v.previewUrl } : {}) })),
		voicesFrom: "catalogue",
		controls: {},
		streams: false,
		formats: ["mp3"]
	}
})

let n = 0
async function model(facts: unknown = {}) {
	const [c] = await db
		.insert(schema.connections)
		.values({ name: `tts ${++n}`, type: CONNECTION_TYPE.OLLAMA, baseUrl: "http://localhost:1", modality: "text-gen" })
		.returning()
	const [m] = await db
		.insert(schema.connectionModels)
		.values({ connectionId: c!.id, model: `kokoro-${n}`, name: `kokoro-${n}`, facts: facts as never })
		.returning()
	return { connection: c!, model: m! }
}

async function narration(facts: unknown = speechFacts([{ id: "af_a", previewUrl: "https://x/a.mp3" }, { id: "af_b" }])) {
	const mm = await model(facts)
	const [l] = await db.insert(schema.loadouts).values({
		seedKey: "core:loadout/tts@1",
		slug: "tts",
		name: "Narration",
		owner: "core",
		transform: "text->audio",
		connectionId: mm.connection.id,
		connectionModelId: mm.model.id
	} as never).returning()
	return { ...mm.model, loadoutId: l!.id }
}

/** Another `text->audio` loadout (filled with its own model, or not). */
async function speechLoadout(name: string, opts: { facts?: unknown; unfilled?: boolean; transform?: string } = {}) {
	const mm = opts.unfilled ? null : await model(opts.facts ?? speechFacts([{ id: "other-1" }]))
	const [l] = await db.insert(schema.loadouts).values({
		slug: name.toLowerCase(),
		name,
		owner: "pub",
		transform: opts.transform ?? "text->audio",
		connectionId: mm?.connection.id ?? null,
		connectionModelId: mm?.model.id ?? null
	} as never).returning()
	return { loadoutId: l!.id, model: mm?.model ?? null }
}

async function row(over: Partial<typeof schema.voicebankVoices.$inferInsert> & { slug: string }) {
	const [r] = await db
		.insert(schema.voicebankVoices)
		.values({ name: over.slug, voiceId: `vid-${over.slug}`, ...over })
		.returning()
	return r!
}

const all = () => db.select().from(schema.voicebankVoices).orderBy(schema.voicebankVoices.id)

beforeEach(async () => {
	await db.delete(schema.voicebankVoices)
	await db.delete(schema.loadouts)
	await db.delete(schema.connections)
})

describe("gating (GATED_EVENTS)", () => {
	test("all voicebank events are gated", () => {
		for (const e of EVENTS) {
			expect(GATED_EVENTS.has(`voicebank:${e}`), e).toBe(true)
			expect(isGatedEvent(`voicebank:${e}`)).toBe(true)
		}
	})
})

describe("who may call", () => {
	test("a member is refused on list / create / update / delete as <event>:error; pickable is open", async () => {
		const m = await narration()
		const r = await row({ slug: "x", loadoutId: m.loadoutId })
		const params: Record<string, Record<string, unknown>> = {
			list: {},
			create: { voice: { name: "N", voiceId: "v", loadoutId: m.loadoutId } },
			update: { id: r.id, voice: { name: "Hacked" } },
			delete: { id: r.id }
		}
		for (const ev of ["list", "create", "update", "delete"] as const) {
			const res = await call(ev, MEMBER, params[ev])
			expect(res.error, ev).toBe("Only administrators can manage voices.")
			expect(res.out.some((o) => o.event === `voicebank:${ev}:error`), ev).toBe(true)
		}
		// Nothing moved.
		const rows = await all()
		expect(rows).toHaveLength(1)
		expect(rows[0]).toMatchObject({ name: "x" })
		const ok = await call("pickable", MEMBER)
		expect(ok.error).toBeNull()
	})

	test("pickable with no signed-in user is refused", async () => {
		expect((await call("pickable", null)).error).toBe("Sign in to see voices.")
	})
})

describe("voicebank:list", () => {
	test("lazy-seeds the Narrator default on first list; pairModelId set; pushes voicebank:list", async () => {
		const m = await narration()
		expect(await all()).toHaveLength(0)
		const { res, out } = await call("list", ADMIN)
		expect(res.pairModelId).toBe(m.id)
		expect(res.voices).toHaveLength(1)
		expect(res.voices[0]).toMatchObject({ name: "Narrator", slug: "narrator", voiceId: "af_a", owner: "pub", unusableReason: null, loadoutId: m.loadoutId, loadoutName: "Narration", connectionModelId: m.id })
		expect(res.loadouts.map((o: any) => o.id)).toEqual([m.loadoutId])
		// The seed is the Narration loadout's voice, not a star.
		expect(res.loadouts[0]).toMatchObject({ defaultVoiceId: res.voices[0].id, otherSpeakersVoiceId: null })
		expect(out.map((o) => o.event)).toContain("voicebank:list")
		// A second list does not seed again.
		expect((await call("list", ADMIN)).res.voices).toHaveLength(1)
	})

	test("no Narration model -> empty list, pairModelId null", async () => {
		const { res } = await call("list", ADMIN)
		expect(res).toEqual({ voices: [], pairModelId: null, loadouts: [] })
	})
})

describe("voicebank:create", () => {
	test("creates a pub row, derives the slug, re-pushes the list", async () => {
		const m = await narration()
		const { res, out, error } = await call("create", ADMIN, {
			voice: { name: "Old Sailor", voiceId: "af_b", loadoutId: m.loadoutId, language: "en", settings: { speed: 1.1 }, labels: { gender: "male", junk: "  " }, description: "  gruff " }
		})
		expect(error).toBeNull()
		expect(res.voice).toMatchObject({ slug: "old-sailor", owner: "pub", enabled: true, language: "en", settings: { speed: 1.1 }, labels: { gender: "male" }, description: "gruff", unusableReason: null })
		expect(out.map((o) => o.event)).toEqual(expect.arrayContaining(["voicebank:create", "voicebank:list"]))
		// Same name again suffixes the derived slug.
		const again = await call("create", ADMIN, { voice: { name: "Old Sailor", voiceId: "af_b", loadoutId: m.loadoutId } })
		expect(again.res.voice.slug).toBe("old-sailor-2")
	})

	test("a voice may be on any filled text->audio loadout (A7 retired); unfilled, missing and wrong-transform loadouts are refused", async () => {
		const m = await narration()
		const other = await speechLoadout("Other")
		const ok = await call("create", ADMIN, { voice: { name: "Elsewhere", voiceId: "other-1", loadoutId: other.loadoutId } })
		expect(ok.error).toBeNull()
		expect(ok.res.voice).toMatchObject({ loadoutId: other.loadoutId, loadoutName: "Other", connectionModelId: other.model!.id, unusableReason: null })
		const blank = await speechLoadout("Blank", { unfilled: true })
		expect((await call("create", ADMIN, { voice: { name: "N", voiceId: "v", loadoutId: blank.loadoutId } })).error).toBe(
			"Blank has no model yet. Choose a model for it in Loadouts first."
		)
		const reply = await speechLoadout("Reply", { transform: "text->text" })
		expect((await call("create", ADMIN, { voice: { name: "N", voiceId: "v", loadoutId: reply.loadoutId } })).error).toBe(
			"Reply does not speak; choose a text-to-audio loadout."
		)
		expect((await call("create", ADMIN, { voice: { name: "N", voiceId: "v", loadoutId: 987654 } })).error).toBe("That loadout no longer exists.")
		expect((await all()).map((r) => r.loadoutId).filter((id) => id !== m.loadoutId)).toEqual([other.loadoutId])
	})

	test("a voice-designing model needs no voice id", async () => {
		const d = await speechLoadout("Designer", { facts: { speech: { voices: [], voicesFrom: "catalogue", controls: { designsVoice: true }, streams: false, formats: ["wav"] } } })
		const res = await call("create", ADMIN, { voice: { name: "Designed", voiceId: "", loadoutId: d.loadoutId } })
		expect(res.error).toBeNull()
		expect(res.res.voice.voiceId).toBe("")
	})

	test("validation sentences", async () => {
		const m = await narration()
		const base = { name: "N", voiceId: "v", loadoutId: m.loadoutId }
		const bad: Array<[Record<string, unknown>, string]> = [
			[{ ...base, name: "  " }, "Name is required."],
			[{ ...base, voiceId: "" }, "Voice is required."],
			[{ ...base, loadoutId: undefined }, "Choose the loadout this voice speaks through."],
			[{ ...base, settings: { speed: 5 } }, "Speed must be a number from 0.25 to 4."],
			[{ ...base, settings: { stability: 1.5 } }, "Stability must be a number from 0 to 1."],
			[{ ...base, settings: { speakerBoost: "yes" } }, "Speaker boost must be on or off."],
			[{ ...base, settings: [1] }, "Voice settings must be an object."],
			[{ ...base, language: "english" }, "Language must be a two-letter ISO 639-1 code, such as en."]
		]
		for (const [voice, msg] of bad) expect((await call("create", ADMIN, { voice })).error, msg).toBe(msg)
		expect(await all()).toHaveLength(0)
	})

	test("an explicit duplicate slug is refused", async () => {
		const m = await narration()
		await call("create", ADMIN, { voice: { name: "A", slug: "dupe", voiceId: "v", loadoutId: m.loadoutId } })
		const res = await call("create", ADMIN, { voice: { name: "B", slug: "dupe", voiceId: "v2", loadoutId: m.loadoutId } })
		expect(res.error).toBe("A voice with that slug already exists.")
		expect(await all()).toHaveLength(1)
	})
})

describe("voicebank:update", () => {
	test("a pub row edits fields, bumps updatedAt, and refuses a clashing slug", async () => {
		const m = await narration()
		const a = await row({ slug: "a", name: "A", loadoutId: m.loadoutId })
		await row({ slug: "b", loadoutId: m.loadoutId })
		await new Promise((r) => setTimeout(r, 15))
		const { res, out } = await call("update", ADMIN, { id: a.id, voice: { name: "Alpha", language: "ja", enabled: false, settings: { speed: 2 } } })
		expect(res.voice).toMatchObject({ name: "Alpha", language: "ja", enabled: false, settings: { speed: 2 } })
		expect(new Date(res.voice.updatedAt).getTime()).toBeGreaterThan(a.updatedAt.getTime())
		expect(out.map((o) => o.event)).toContain("voicebank:list")
		const clash = await call("update", ADMIN, { id: a.id, voice: { slug: "b" } })
		expect(clash.error).toBe("A voice with that slug already exists.")
		expect((await call("update", ADMIN, { id: 99999, voice: {} })).error).toBe("Voice not found.")
	})

	test("a plugin-owned row changes `enabled` only, and still bumps updatedAt", async () => {
		const m = await narration()
		const p = await row({ slug: "plug", name: "Plug", owner: "acme.plugin", seedKey: "acme.plugin:voice/plug@1", voiceId: "vp", loadoutId: m.loadoutId })
		await new Promise((r) => setTimeout(r, 15))
		const { res, error } = await call("update", ADMIN, { id: p.id, voice: { name: "Renamed", voiceId: "other", slug: "z", language: "fr", settings: { speed: 3 }, enabled: false } })
		expect(error).toBeNull()
		expect(res.voice).toMatchObject({ name: "Plug", voiceId: "vp", slug: "plug", language: null, settings: {}, enabled: false })
		const [stored] = await db.select().from(schema.voicebankVoices).where(eq(schema.voicebankVoices.id, p.id))
		expect(stored!.updatedAt.getTime()).toBeGreaterThan(p.updatedAt.getTime())
	})
})

describe("the loadout voice follows its entries", () => {
	const voiceOf = async (loadoutId: number) =>
		(await db.select().from(schema.loadouts).where(eq(schema.loadouts.id, loadoutId)))[0]!

	test("moving an entry to another loadout clears the old loadout's pointers to it", async () => {
		const m = await narration()
		const other = await speechLoadout("Other")
		const a = await row({ slug: "a", loadoutId: m.loadoutId })
		const b = await row({ slug: "b", loadoutId: m.loadoutId })
		await db.update(schema.loadouts).set({ defaultVoiceId: a.id, otherSpeakersVoiceId: a.id }).where(eq(schema.loadouts.id, m.loadoutId))
		const { error } = await call("update", ADMIN, { id: a.id, voice: { loadoutId: other.loadoutId, voiceId: "other-1" } })
		expect(error).toBeNull()
		const l = await voiceOf(m.loadoutId)
		// The other-speakers pick falls to Auto; the voice is refilled with the loadout's next entry.
		expect(l.otherSpeakersVoiceId).toBeNull()
		expect(l.defaultVoiceId).toBe(b.id)
	}, 60_000)

	test("turning the loadout voice off clears it and refills from the next enabled entry", async () => {
		const m = await narration()
		const a = await row({ slug: "a", loadoutId: m.loadoutId })
		const b = await row({ slug: "b", loadoutId: m.loadoutId })
		await db.update(schema.loadouts).set({ defaultVoiceId: a.id }).where(eq(schema.loadouts.id, m.loadoutId))
		await call("update", ADMIN, { id: a.id, voice: { enabled: false } })
		expect((await voiceOf(m.loadoutId)).defaultVoiceId).toBe(b.id)
	}, 60_000)

	test("create fills a null loadout voice with the first entry; deleting the voice refills it", async () => {
		const m = await narration()
		const first = await row({ slug: "first", loadoutId: m.loadoutId })
		const second = await row({ slug: "second", loadoutId: m.loadoutId })
		await db.update(schema.loadouts).set({ defaultVoiceId: second.id }).where(eq(schema.loadouts.id, m.loadoutId))
		const del = await call("delete", ADMIN, { id: second.id })
		expect(del.error).toBeNull()
		expect((await voiceOf(m.loadoutId)).defaultVoiceId).toBe(first.id)
	}, 60_000)

	test("the star events are gone", async () => {
		const mod = (await import("./voicebank")) as Record<string, unknown>
		expect(mod.voicebankSetDefault).toBeUndefined()
		expect(mod.voicebankSetNarrationDefault).toBeUndefined()
		expect(GATED_EVENTS.has("voicebank:setDefault")).toBe(false)
	})
})

describe("voicebank:delete", () => {
	test("deletes, pushes the list; an unknown id is refused", async () => {
		const m = await narration()
		const a = await row({ slug: "a", loadoutId: m.loadoutId })
		await row({ slug: "keep", loadoutId: m.loadoutId })
		const { res, out } = await call("delete", ADMIN, { id: a.id })
		expect(res).toEqual({ id: a.id })
		expect(out.map((o) => o.event)).toEqual(expect.arrayContaining(["voicebank:delete", "voicebank:list"]))
		expect((await all()).map((r) => r.slug)).toEqual(["keep"])
		expect((await call("delete", ADMIN, { id: a.id })).error).toBe("Voice not found.")
	})

	test("behaviour to know: deleting the LAST row re-seeds the Narrator default in the very list the delete pushes (lane C's documented empty-table rule)", async () => {
		const m = await narration()
		const only = await row({ slug: "only", loadoutId: m.loadoutId })
		const { out } = await call("delete", ADMIN, { id: only.id })
		const pushed = out.find((o) => o.event === "voicebank:list")!
		expect(pushed.data.voices.map((v: any) => v.slug)).toEqual(["narrator"])
		expect((await all()).map((r) => r.slug)).toEqual(["narrator"])
	})
})

describe("voicebank:pickable", () => {
	test("excludes disabled, unassigned and no-model rows; each voice carries its own model's controls; members never see the loadout", async () => {
		const m = await narration()
		const designer = await speechLoadout("Designer", { facts: { speech: { voices: [{ id: "d1", name: "d1", kind: "preset", previewUrl: "https://x/d1.mp3" }], voicesFrom: "catalogue", controls: { designsVoice: true, instruction: "prose", settings: ["stability"], speed: { min: 0.5, max: 2 }, language: ["en"] }, streams: false, formats: ["mp3"] } } })
		const blank = await speechLoadout("Blank", { unfilled: true })
		await row({ slug: "good", name: "Good", voiceId: "af_a", loadoutId: m.loadoutId, language: "en", labels: { gender: "f" }, settings: { speed: 2 }, description: "secret" })
		await row({ slug: "nopreview", name: "No preview", voiceId: "af_b", loadoutId: m.loadoutId })
		await row({ slug: "off", loadoutId: m.loadoutId, enabled: false })
		await row({ slug: "nomodel", loadoutId: blank.loadoutId })
		await row({ slug: "orphan", loadoutId: null })
		await row({ slug: "designed", name: "Designed", voiceId: "d1", loadoutId: designer.loadoutId })
		const { res } = await call("pickable", MEMBER)
		expect(res.voices.map((v: any) => v.slug)).toEqual(["good", "nopreview", "designed"])
		expect(res.voices[0]).toEqual({ name: "Good", slug: "good", language: "en", labels: { gender: "f" }, previewUrl: "https://x/a.mp3", controls: {} })
		expect(res.voices[1]).not.toHaveProperty("previewUrl")
		expect(res.voices[2]).toMatchObject({
			previewUrl: "https://x/d1.mp3",
			controls: { designsVoice: true, instruction: "prose", settings: ["stability"], speed: { min: 0.5, max: 2 }, language: ["en"] }
		})
		for (const v of res.voices) {
			expect(v).not.toHaveProperty("loadoutId")
			expect(v).not.toHaveProperty("loadoutName")
		}
		// The top-level controls stay the speaking loadout's model's.
		expect(res.controls).toEqual({})
	})

	test("an administrator also gets each voice's loadout id and name", async () => {
		const m = await narration()
		const other = await speechLoadout("Other")
		await row({ slug: "a", voiceId: "af_a", loadoutId: m.loadoutId })
		await row({ slug: "b", voiceId: "other-1", loadoutId: other.loadoutId })
		const { res } = await call("pickable", ADMIN)
		expect(res.voices.map((v: any) => [v.slug, v.loadoutId, v.loadoutName])).toEqual([
			["a", m.loadoutId, "Narration"],
			["b", other.loadoutId, "Other"]
		])
	})

	test("lazy-seeds the default on first pickable", async () => {
		await narration()
		expect(await all()).toHaveLength(0)
		const { res } = await call("pickable", MEMBER)
		expect(res.voices.map((v: any) => v.slug)).toEqual(["narrator"])
		expect(await all()).toHaveLength(1)
	})
})

describe("interest gate, through the real connectSockets", () => {
	function harness() {
		const rooms = new Map<string, Set<string>>()
		const registry = new Map<string, any>()
		const emits: Array<{ target: string; event: string; data: any }> = []
		let onConnect: ((socket: any) => void) | null = null
		const io: any = {
			on: (event: string, cb: (socket: any) => void) => {
				if (event === "connect") onConnect = cb
			},
			to: (target: string) => ({ emit: (event: string, data: any) => emits.push({ target, event, data }) }),
			sockets: { adapter: { rooms }, sockets: registry }
		}
		return { io, emits, rooms, registry, connect: () => onConnect! }
	}

	async function connected(user: typeof ADMIN) {
		const { connectSockets } = await import("./index")
		const h = harness()
		connectSockets(h.io)
		const listeners = new Map<string, Array<(msg?: any) => any>>()
		const socket: any = {
			id: "s1",
			user,
			pendingSetup: [],
			emit: () => {},
			disconnect: () => {},
			join: (room: string) => {
				const members = h.rooms.get(room) ?? new Set<string>()
				members.add("s1")
				h.rooms.set(room, members)
			},
			on: (event: string, cb: (msg?: any) => any) => {
				listeners.set(event, [...(listeners.get(event) ?? []), cb])
			}
		}
		h.registry.set("s1", socket)
		h.connect()(socket)
		return {
			h,
			fire: (event: string, msg?: any) => Promise.all((listeners.get(event) ?? []).map((cb) => cb(msg))),
			declare: (...keys: string[]) => Promise.all((listeners.get("interest:sync") ?? []).map((cb) => cb({ keys })))
		}
	}

	test("voicebank:pickable is delivered only to a socket that declared the key", async () => {
		await narration()
		const t = await connected(MEMBER)
		await t.fire("voicebank:pickable", {}).catch(() => {})
		expect(t.h.emits.filter((e) => e.event === "voicebank:pickable")).toEqual([])
		await t.declare("voicebank:pickable")
		await t.fire("voicebank:pickable", {})
		const got = t.h.emits.filter((e) => e.event === "voicebank:pickable")
		expect(got).toHaveLength(1)
		expect(got[0]!.target).toBe("s1")
		expect(got[0]!.data.voices.length).toBeGreaterThan(0)
	})

	test("an admin's mutation re-pushes voicebank:list only with the list key declared", async () => {
		const m = await narration()
		const a = await row({ slug: "a", loadoutId: m.loadoutId })
		const t = await connected(ADMIN)
		await t.fire("voicebank:update", { id: a.id, voice: { name: "A1" } })
		expect(t.h.emits.filter((e) => e.event === "voicebank:list")).toEqual([])
		await t.declare("voicebank:list")
		await t.fire("voicebank:update", { id: a.id, voice: { name: "A2" } })
		expect(t.h.emits.filter((e) => e.event === "voicebank:list")).toHaveLength(1)
	})
})
