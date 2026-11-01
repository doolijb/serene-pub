/**
 * Speech build, lane V3a: a character's timbre through the sockets. `characters:update`
 * (admin picks a voice from the voicebank; a member's `voice` is ignored),
 * `characters:create` (lead decision 1: a member's `timbre.voice` is NOT stored), and
 * the card round trip (export drops `voice`, import sanitises and ignores it).
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it, test, vi } from "vitest"
import fs from "fs/promises"
import os from "os"
import path from "path"
import { eq } from "drizzle-orm"
import * as schema from "$lib/server/db/schema"
import type { TestDb } from "$lib/server/utils/testDb"

// DB setup under load.
vi.setConfig({ testTimeout: 60_000, hookTimeout: 60_000 })

vi.mock("$lib/server/db", async () => {
	const { createTestDb } = await import("$lib/server/utils/testDb")
	const db = await createTestDb()
	return { db }
})

let db: TestDb
let dataDir: string

beforeAll(async () => {
	dataDir = await fs.mkdtemp(path.join(os.tmpdir(), "serene-pub-vitest-timbre-sockets-"))
	process.env.SERENE_PUB_DATA_DIR = dataDir
	db = (await import("$lib/server/db")).db as unknown as TestDb
}, 60_000)

afterAll(async () => {
	await fs.rm(dataDir, { recursive: true, force: true })
})

type Role = "admin" | "member"
async function actor(role: Role) {
	const { createTestUser } = await import("$lib/server/utils/testDb")
	const u = await createTestUser(db)
	return { id: u.id, isAdmin: role === "admin" }
}
const sock = (u: { id: number; isAdmin: boolean }) => ({ user: u, io: { to: () => ({ emit: () => {} }) } }) as never

async function voice(slug: string) {
	await db.insert(schema.voicebankVoices).values({ slug, name: slug, voiceId: `vid-${slug}` })
}

beforeEach(async () => {
	await db.delete(schema.voicebankVoices)
})

async function card(userId: number, timbre?: Record<string, unknown>, extra: Record<string, unknown> = {}) {
	const [c] = await db
		.insert(schema.characters)
		.values({
			userId,
			name: `T ${Math.random()}`,
			description: "",
			extensions: { ...extra, ...(timbre ? { serenepub: { timbre } } : {}) }
		} as never)
		.returning()
	return c!
}

const timbreOf = async (id: number) => {
	const [row] = await db.select({ e: schema.characters.extensions }).from(schema.characters).where(eq(schema.characters.id, id))
	return ((row!.e as any)?.serenepub?.timbre ?? null) as Record<string, any> | null
}

async function update(u: { id: number; isAdmin: boolean }, id: number, extensions: unknown) {
	const { charactersUpdate } = await import("./characters")
	const out: Array<{ event: string; data: any }> = []
	try {
		await charactersUpdate.handler(sock(u), { character: { id, extensions } } as never, (event: string, data: any) => void out.push({ event, data }))
		return { error: null as string | null, out }
	} catch {
		return { error: (out.find((o) => o.event === "characters:update:error")?.data?.error ?? "threw") as string, out }
	}
}

const withTimbre = (timbre: unknown, rest: Record<string, unknown> = {}) => ({ ...rest, serenepub: { timbre } })

describe("characters:update", () => {
	test("an admin sets a voice from the voicebank", async () => {
		const admin = await actor("admin")
		await voice("alice")
		const c = await card(admin.id)
		const r = await update(admin, c.id, withTimbre({ voice: "alice", description: "warm alto", language: "EN", settings: { speed: 1.5 } }))
		expect(r.error).toBeNull()
		expect(await timbreOf(c.id)).toEqual({ voice: "alice", description: "warm alto", language: "en", settings: { speed: 1.5 } })
	})

	test("an unknown slug is refused as characters:update:error with the exact sentence; nothing changes", async () => {
		const admin = await actor("admin")
		await voice("alice")
		const c = await card(admin.id, { voice: "alice" })
		const r = await update(admin, c.id, withTimbre({ voice: "ghost" }))
		expect(r.error).toBe('No voice named "ghost" in the voicebank.')
		expect(r.out.some((o) => o.event === "characters:update:error")).toBe(true)
		expect(await timbreOf(c.id)).toEqual({ voice: "alice" })
	})

	test("an empty string voice clears the voice and keeps the rest", async () => {
		const admin = await actor("admin")
		await voice("alice")
		const c = await card(admin.id, { voice: "alice", description: "kept" })
		expect((await update(admin, c.id, withTimbre({ voice: "", description: "kept" }))).error).toBeNull()
		expect(await timbreOf(c.id)).toEqual({ description: "kept" })
	})

	test("a timbre of null clears it for an admin; foreign extension keys survive", async () => {
		const admin = await actor("admin")
		await voice("alice")
		const c = await card(admin.id, { voice: "alice" }, { other_tool: { keep: 1 } })
		expect((await update(admin, c.id, withTimbre(null, { other_tool: { keep: 1 } }))).error).toBeNull()
		expect(await timbreOf(c.id)).toBeNull()
		const [row] = await db.select({ e: schema.characters.extensions }).from(schema.characters).where(eq(schema.characters.id, c.id))
		expect((row!.e as any).other_tool).toEqual({ keep: 1 })
	})

	test("a MEMBER's sent voice is ignored and the stored one kept; their other timbre fields save", async () => {
		const member = await actor("member")
		await voice("alice")
		await voice("bob")
		const c = await card(member.id, { voice: "alice", description: "old" })
		const r = await update(member, c.id, withTimbre({ voice: "bob", description: "new", language: "fr" }))
		expect(r.error).toBeNull()
		expect(await timbreOf(c.id)).toEqual({ voice: "alice", description: "new", language: "fr" })
		// Even an unknown slug from a member is not an error: it is not read.
		expect((await update(member, c.id, withTimbre({ voice: "ghost", description: "new" }))).error).toBeNull()
		expect((await timbreOf(c.id))!.voice).toBe("alice")
		// And clearing the whole timbre keeps the voice they cannot change.
		expect((await update(member, c.id, withTimbre(null))).error).toBeNull()
		expect(await timbreOf(c.id)).toEqual({ voice: "alice" })
	})

	test("narration voice: an admin sets it (unknown refused); a member's is ignored; a narrationDescription is dropped for both", async () => {
		const admin = await actor("admin")
		const member = await actor("member")
		await voice("nora")
		const c = await card(admin.id)
		expect((await update(admin, c.id, withTimbre({ narrationVoice: "ghost" }))).error).toBe('No voice named "ghost" in the voicebank.')
		expect((await update(admin, c.id, withTimbre({ narrationVoice: "nora", narrationDescription: "dry" }))).error).toBeNull()
		expect(await timbreOf(c.id)).toEqual({ narrationVoice: "nora" })
		const m = await card(member.id, { narrationVoice: "nora" })
		expect((await update(member, m.id, withTimbre({ narrationVoice: "ghost", narrationDescription: "wry" }))).error).toBeNull()
		expect(await timbreOf(m.id)).toEqual({ narrationVoice: "nora" })
		const m2 = await card(member.id)
		expect((await update(member, m2.id, withTimbre({ narrationVoice: "nora" }))).error).toBeNull()
		expect(await timbreOf(m2.id)).toBeNull()
	})

	test("a member cannot ADD a voice to a card that had none", async () => {
		const member = await actor("member")
		await voice("bob")
		const c = await card(member.id)
		expect((await update(member, c.id, withTimbre({ voice: "bob", description: "x" }))).error).toBeNull()
		expect(await timbreOf(c.id)).toEqual({ description: "x" })
	})

	test("an absent timbre keeps the stored one (a save of other extensions)", async () => {
		const admin = await actor("admin")
		await voice("alice")
		const c = await card(admin.id, { voice: "alice", description: "d" })
		expect((await update(admin, c.id, { depth_prompt: { prompt: "p", depth: 2 } })).error).toBeNull()
		expect(await timbreOf(c.id)).toEqual({ voice: "alice", description: "d" })
		expect((await update(admin, c.id, { serenepub: { likeness: { prompt: "tall" } } })).error).toBeNull()
		expect(await timbreOf(c.id)).toEqual({ voice: "alice", description: "d" })
	})

	test("a 2001-character description is refused; 2000 passes", async () => {
		const admin = await actor("admin")
		const c = await card(admin.id)
		const bad = await update(admin, c.id, withTimbre({ description: "x".repeat(2001) }))
		expect(bad.error).toBe("The timbre description is over 2000 characters.")
		expect(await timbreOf(c.id)).toBeNull()
		expect((await update(admin, c.id, withTimbre({ description: "x".repeat(2000) }))).error).toBeNull()
		expect((await timbreOf(c.id))!.description).toHaveLength(2000)
	})

	test("validation table over the socket: language eng refused, speed 0.24 / 4.01 refused, 0.25 / 4 pass", async () => {
		const admin = await actor("admin")
		const c = await card(admin.id)
		expect((await update(admin, c.id, withTimbre({ language: "eng" }))).error).toBe('"eng" is not a two-letter language code (like en or ja).')
		expect((await update(admin, c.id, withTimbre({ settings: { speed: 0.24 } }))).error).toBe("Timbre speed must be between 0.25 and 4.")
		expect((await update(admin, c.id, withTimbre({ settings: { speed: 4.01 } }))).error).toBe("Timbre speed must be between 0.25 and 4.")
		expect((await update(admin, c.id, withTimbre({ settings: { speed: 0.25 } }))).error).toBeNull()
		expect((await update(admin, c.id, withTimbre({ settings: { speed: 4 } }))).error).toBeNull()
		expect((await update(admin, c.id, withTimbre({ settings: { stability: 1.01 } }))).error).toBe("Timbre stability must be between 0 and 1.")
	})
})

describe("characters:create", () => {
	async function create(u: { id: number; isAdmin: boolean }, timbre: unknown) {
		const { charactersCreate } = await import("./characters")
		const res: any = await charactersCreate.handler(
			sock(u),
			{ character: { name: "Fresh", description: "", extensions: withTimbre(timbre) } } as never,
			() => {}
		)
		return res.character.id as number
	}

	// Lead decision 1 (CROSS-LANE-NOTES): create must block members from setting timbre.voice like update.
	it("characters:create guards timbre.voice like update — a member's voice is NOT stored", async () => {
		const member = await actor("member")
		await voice("alice")
		const id = await create(member, { voice: "alice", description: "d" })
		expect((await timbreOf(id))?.voice).toBeUndefined()
	})

	test("(as it stands) an admin's create stores the timbre as sent", async () => {
		const admin = await actor("admin")
		await voice("alice")
		const id = await create(admin, { voice: "alice", description: "d" })
		expect(await timbreOf(id)).toEqual({ voice: "alice", description: "d" })
	})
})

describe("card round trip", () => {
	const toB64 = (c: unknown) => Buffer.from(JSON.stringify(c), "utf-8").toString("base64")
	const v2 = (extensions: Record<string, unknown>) => ({
		spec: "chara_card_v2",
		spec_version: "2.0",
		data: {
			name: "Rt",
			description: "A character",
			personality: "",
			scenario: "",
			first_mes: "Hi",
			mes_example: "",
			creator_notes: "",
			system_prompt: "",
			post_history_instructions: "",
			alternate_greetings: [],
			tags: [],
			creator: "t",
			character_version: "",
			extensions
		}
	})

	test("export drops `voice` and keeps description / language / settings", async () => {
		const admin = await actor("admin")
		await voice("alice")
		const c = await card(admin.id, { voice: "alice", description: "warm", language: "ja", settings: { speed: 1.2 } })
		const { charactersExportCard } = await import("./characters")
		const exported: any = await charactersExportCard.handler(sock(admin), { id: c.id, format: "json" } as never, () => {})
		const json = JSON.parse(exported.blob.toString("utf-8"))
		expect(json.data.extensions.serenepub.timbre).toEqual({ description: "warm", language: "ja", settings: { speed: 1.2 } })
		expect(exported.blob.toString("utf-8")).not.toContain("alice")
	})

	test("import sanitises: voice ignored, language lowered, out-of-range setting dropped, over-long description cut", async () => {
		const admin = await actor("admin")
		await voice("alice")
		const { charactersImportCard } = await import("./characters")
		const res: any = await charactersImportCard.handler(
			sock(admin),
			{
				file: toB64(v2({ serenepub: { timbre: { voice: "alice", description: "d".repeat(2500), language: "EN", settings: { speed: 99, stability: 0.5, style: "x" } } } }))
			} as never,
			() => {}
		)
		expect(res.status).toBe("created")
		const t = (await timbreOf(res.character.id))!
		expect(t.voice).toBeUndefined()
		expect(t.language).toBe("en")
		expect(t.settings).toEqual({ stability: 0.5 })
		expect(t.description).toHaveLength(2000)
	})

	test("a malformed timbre still imports the card, with no timbre", async () => {
		const admin = await actor("admin")
		const { charactersImportCard } = await import("./characters")
		for (const bad of ["loud", [1, 2], 7, { language: 5, settings: "fast", description: {} }]) {
			const res: any = await charactersImportCard.handler(
				sock(admin),
				{ file: toB64({ ...v2({ serenepub: { timbre: bad } }), data: { ...v2({}).data, name: `Bad ${JSON.stringify(bad).slice(0, 8)}`, extensions: { serenepub: { timbre: bad } } } }) } as never,
				() => {}
			)
			expect(res.status, JSON.stringify(bad)).toBe("created")
			expect(await timbreOf(res.character.id)).toBeNull()
		}
	})

	test("export then import: the copy keeps the portable parts and no voice", async () => {
		const admin = await actor("admin")
		await voice("alice")
		const c = await card(admin.id, { voice: "alice", description: "warm", language: "de" })
		const { charactersExportCard, charactersImportCard } = await import("./characters")
		const exported: any = await charactersExportCard.handler(sock(admin), { id: c.id, format: "json" } as never, () => {})
		const edited = JSON.parse(exported.blob.toString("utf-8"))
		// Another user's library: the same card (same uuid) is a new card there.
		const other = await actor("member")
		const res: any = await charactersImportCard.handler(sock(other), { file: toB64(edited) } as never, () => {})
		expect(res.status).toBe("created")
		expect(await timbreOf(res.character.id)).toEqual({ description: "warm", language: "de" })
	})
})
