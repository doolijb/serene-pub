/**
 * Speech build, lane V3a: the F1 fresh-database check and the boot seed.
 *
 * A fresh database plus the app's own `defaults.sync()`: only the Narration
 * loadout (`core:loadout/tts@1`) is filled with a model, and Loadouts → Defaults
 * (the `text->audio` default) is never touched. The voicebank must still find
 * its pair (lead's F1 fix in `speakingLoadout`) and seed a Narrator row.
 * Then the boot half: `sync()` seeds the default itself, and survives a throw
 * inside `ensureLoadoutVoice`.
 */
import { afterAll, beforeAll, describe, expect, test, vi } from "vitest"
import fs from "fs/promises"
import os from "os"
import path from "path"
import { eq } from "drizzle-orm"
import * as schema from "$lib/server/db/schema"
import { CONNECTION_TYPE } from "$lib/shared/constants/ConnectionTypes"
import type { TestDb } from "$lib/server/utils/testDb"

// DB setup under load.
vi.setConfig({ testTimeout: 60_000, hookTimeout: 180_000 })

// ⚠ No `vi.mock("$lib/server/db")` here, on purpose: this file is about the app's own
// boot. The mock's factory builds a test db, whose helpers import `db/defaults`, which
// imports `$lib/server/db` back — and the real module (PGlite in the temp data dir below,
// `migrate()` + `sync()` at import) is what `sync()` then writes to, not the mock.
// So the REAL module runs against a scratch data dir, which is a fresh boot.

let db: TestDb
let dataDir: string

beforeAll(async () => {
	dataDir = await fs.mkdtemp(path.join(os.tmpdir(), "serene-pub-vitest-voicebank-fresh-"))
	process.env.SERENE_PUB_DATA_DIR = dataDir
	const dbModule = await import("$lib/server/db")
	await dbModule.dbReady
	db = dbModule.db as unknown as TestDb
	// A second sync on top of the module's own boot sync: idempotent, as every boot is.
	await (await import("$lib/server/db/defaults")).sync()
}, 180_000)

afterAll(async () => {
	const { releaseDataDir } = await import("$lib/server/utils/testDb")
	await releaseDataDir(dataDir)
})

const ADMIN = { id: 1, username: "owner", isAdmin: true }

async function listAsAdmin() {
	const { voicebankList } = await import("$lib/server/sockets/voicebank")
	const out: Array<{ event: string; data: any }> = []
	const res = await voicebankList.handler({ user: ADMIN } as never, {} as never, (event: string, data: any) => {
		out.push({ event, data })
	})
	return { res, out }
}

async function narrationRow() {
	const [l] = await db.select().from(schema.loadouts).where(eq(schema.loadouts.seedKey, "core:loadout/tts@1"))
	return l!
}

describe("boot, before anything is filled", () => {
	test("sync() seeded the Narration loadout unfilled, starred it as the text->audio default (V-1, 2026-10-29), and seeded no voice", async () => {
		const l = await narrationRow()
		expect(l).toMatchObject({ connectionId: null, connectionModelId: null, transform: "text->audio" })
		const { defaultLoadoutFor } = await import("$lib/server/loadouts")
		// Boot stars the shipped Narration loadout (still unfilled) so Read aloud
		// never reads "Unavailable" for want of a star.
		expect(await defaultLoadoutFor(db as never, "text->audio")).toMatchObject({
			seedKey: "core:loadout/tts@1",
			connectionId: null
		})
		expect(await db.select().from(schema.voicebankVoices)).toHaveLength(0)
		// And an unfilled pair seeds nothing even when asked.
		const { ensureLoadoutVoice } = await import("$lib/server/speech/voicebank")
		expect(await ensureLoadoutVoice(db as never)).toBeNull()
		const { res } = await listAsAdmin()
		expect(res).toMatchObject({ voices: [], pairModelId: null })
		// The picker still lists Narration, greyed (no model yet).
		expect(res.loadouts.find((o) => o.id === l.id)).toMatchObject({ filled: false, isDefault: true })
	})
})

describe("F1: a fresh pub that fills only Narration", () => {
	test("voicebank:list finds the pair and seeds a Narrator; speakingLoadout returns the Narration loadout", async () => {
		const [c] = await db
			.insert(schema.connections)
			.values({ name: "KCPP tts", type: CONNECTION_TYPE.OLLAMA, baseUrl: "http://localhost:5001", modality: "text-gen" })
			.returning()
		const [m] = await db
			.insert(schema.connectionModels)
			.values({
				connectionId: c!.id,
				model: "kokoro",
				name: "kokoro",
				facts: { speech: { voices: [{ id: "af_heart", name: "Heart", kind: "preset" }, { id: "af_sky", name: "Sky", kind: "preset" }], voicesFrom: "catalogue", controls: {}, streams: false, formats: ["wav"] } } as never
			})
			.returning()
		const l = await narrationRow()
		// Only the Narration loadout is filled. Defaults are NOT touched.
		await db.update(schema.loadouts).set({ connectionId: c!.id, connectionModelId: m!.id }).where(eq(schema.loadouts.id, l.id))
		const { defaultLoadoutFor } = await import("$lib/server/loadouts")
		// Boot stars the shipped Narration loadout (still unfilled) so Read aloud
		// never reads "Unavailable" for want of a star.
		expect(await defaultLoadoutFor(db as never, "text->audio")).toMatchObject({
			seedKey: "core:loadout/tts@1"
		})

		const { speakingLoadout } = await import("$lib/server/speech/voicebank")
		expect(await speakingLoadout(db as never)).toMatchObject({ loadoutId: l.id, connectionModelId: m!.id })

		const { res } = await listAsAdmin()
		expect(res.pairModelId).toBe(m!.id)
		expect(res.voices).toHaveLength(1)
		expect(res.voices[0]).toMatchObject({ name: "Narrator", voiceId: "af_heart", owner: "pub", unusableReason: null, loadoutId: l.id, loadoutName: l.name, connectionModelId: m!.id })

		// The resolver finds the pair too, with no default touched.
		const { resolveVoice } = await import("$lib/server/speech/resolveVoice")
		expect(await resolveVoice({ speakerRef: null, sessionId: null }, db as never)).toMatchObject({
			ok: true,
			connectionModelId: m!.id,
			from: "loadout-voice",
			voiceId: "af_heart"
		})
	})
})

describe("boot seed (defaults.sync)", () => {
	test("an empty voicebank plus a Narration model: sync() seeds Narrator; a non-empty one is left alone", async () => {
		const { sync } = await import("$lib/server/db/defaults")
		await db.delete(schema.voicebankVoices)
		await sync()
		const rows = await db.select().from(schema.voicebankVoices)
		expect(rows.map((r) => [r.slug, r.name, r.owner, r.voiceId])).toEqual([["narrator", "Narrator", "pub", "af_heart"]])
		await sync()
		expect(await db.select().from(schema.voicebankVoices)).toHaveLength(1)
	})

	test("no Narration model: sync() seeds nothing", async () => {
		const { sync } = await import("$lib/server/db/defaults")
		const l = await narrationRow()
		await db.update(schema.loadouts).set({ connectionId: null, connectionModelId: null }).where(eq(schema.loadouts.id, l.id))
		await db.delete(schema.voicebankVoices)
		await sync()
		expect(await db.select().from(schema.voicebankVoices)).toHaveLength(0)
	})

	test("a throw inside ensureLoadoutVoice does not fail boot: sync() resolves and warns", async () => {
		// No source edit to inject a throw: take the table away, so the seed's first query fails.
		const { sync } = await import("$lib/server/db/defaults")
		await db.execute("ALTER TABLE voicebank_voices RENAME TO voicebank_voices_away")
		const warn = vi.spyOn(console, "warn").mockImplementation(() => {})
		try {
			await expect(sync()).resolves.not.toThrow()
			expect(warn.mock.calls.some((c) => String(c[0]).includes("[boot] voicebank default not seeded:"))).toBe(true)
			// The rest of the boot ran: the shipped loadouts are still there.
			expect((await narrationRow()).seedKey).toBe("core:loadout/tts@1")
		} finally {
			warn.mockRestore()
			await db.execute("ALTER TABLE voicebank_voices_away RENAME TO voicebank_voices")
		}
	})
})
