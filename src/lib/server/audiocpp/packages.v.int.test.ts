// Lane V (W3) — coverage fill for packages.ts against a REAL temp tree, a real
// GGUF header and the real familyOf (the lane B file stubs both).
import { afterAll, beforeAll, describe, expect, test, vi } from "vitest"
import * as fs from "fs"
import * as path from "path"
import { audiocppSettings } from "$lib/server/db/schema"
import { createTestDb, type TestDb } from "$lib/server/utils/testDb"
import { parseAudioFamiliesYaml, parseAudioYaml, resetAudioListsMemo } from "$lib/server/audio/audioList"
import audioText from "$lib/server/audio/snapshot/audio.yaml?raw"
import familiesText from "$lib/server/audio/snapshot/audio-families.yaml?raw"
import { listEnabledAudioCppPackages } from "$lib/server/connectionAdapters/audioCppReady"
import { ensureAudioCppSettings } from "./settings"
import {
	confirmAudioCppFamily,
	FAMILY_SIDECAR,
	listAudioCppPackages,
	removeAudioCppPackage,
	setAudioCppPackageEnabled
} from "./packages"

// DB setup under load
vi.setConfig({ testTimeout: 60_000 })

const SCRATCH =
	"/tmp/claude-1000/-home-jody-github-serene-pub/564efcec-663a-419e-8efc-7e445249445f/scratchpad/vacpp/w3"
const lists = {
	entries: parseAudioYaml(audioText),
	families: parseAudioFamiliesYaml(familiesText)
}
const opts = { lists, backend: null }

const gstr = (s: string) => {
	const b = Buffer.from(s, "utf8")
	const l = Buffer.alloc(8)
	l.writeBigUInt64LE(BigInt(b.length))
	return Buffer.concat([l, b])
}
const u32 = (n: number) => {
	const b = Buffer.alloc(4)
	b.writeUInt32LE(n)
	return b
}
const strKv = (k: string, v: string) => Buffer.concat([gstr(k), u32(8), gstr(v)])
/** A tiny real GGUF header carrying audio.cpp's model_spec.family. */
function audioGguf(family: string): Buffer {
	const kvs = [strKv("general.architecture", "audiocpp"), strKv("audiocpp.model_spec.family", family)]
	const n = Buffer.alloc(8)
	n.writeBigUInt64LE(BigInt(kvs.length))
	const t = Buffer.alloc(8)
	return Buffer.concat([Buffer.from("GGUF"), u32(3), t, n, ...kvs])
}

let tmp: string
let root: string
let db: TestDb

const put = (rel: string, content: Buffer | string = "x") => {
	const p = path.join(root, rel)
	fs.mkdirSync(path.dirname(p), { recursive: true })
	fs.writeFileSync(p, content)
	return p
}
const list = () => listAudioCppPackages(db as never, opts)

beforeAll(async () => {
	tmp = fs.mkdtempSync(path.join(SCRATCH, "pkgs-v-"))
	root = path.join(tmp, "audio")
	db = await createTestDb()
	await ensureAudioCppSettings(db as never)
	await db.update(audiocppSettings).set({ modelsDir: root })
}, 60_000)

afterAll(async () => {
	await (db as unknown as { $client: { close(): Promise<void> } }).$client.close().catch(() => {})
	fs.rmSync(tmp, { recursive: true, force: true })
})

describe("hand-copied leaves, real familyOf and a real GGUF header", () => {
	test("header family names the package whatever the folder and file are called", async () => {
		put("tts/whatever/zzz-unrelated/blob.gguf", audioGguf("kokoro_tts"))
		const row = (await list()).find((p) => p.id === "local_whatever_zzz_unrelated")!
		expect(row).toMatchObject({ family: "kokoro_tts", task: "tts", confidence: "matched" })
	})

	test("4 KB of random bytes named .gguf is unknown and guessed", async () => {
		put("tts/whatever/random-bytes/r.gguf", Buffer.alloc(4096, 7))
		const row = (await list()).find((p) => p.id === "local_whatever_random_bytes")!
		expect(row).toMatchObject({ family: "unknown", confidence: "guessed" })
		await expect(setAudioCppPackageEnabled(db as never, row.id, true, opts)).rejects.toThrow(/Confirm which audio family/)
	})

	test("files one level too shallow (audio/tts/<leaf>/x.gguf) are silently ignored", async () => {
		put("tts/shallow-leaf/x.gguf", audioGguf("kokoro_tts"))
		const rows = await list()
		expect(rows.some((p) => p.id === "local_shallow_leaf" || p.localDir?.includes("shallow-leaf"))).toBe(false)
		// ...and the same file one level deeper IS found (the layout is the rule).
		expect(rows.some((p) => p.id === "local_whatever_zzz_unrelated")).toBe(true)
	})

	test("the sidecar written by confirmFamily is honoured on the next walk", async () => {
		const dir = path.join(root, "tts/whatever/random-bytes")
		const row = await confirmAudioCppFamily(db as never, { localDir: dir, family: "kokoro_tts", task: "tts" }, opts)
		expect(row.confidence).toBe("matched")
		expect(fs.existsSync(path.join(dir, FAMILY_SIDECAR))).toBe(true)
		const again = (await list()).find((p) => p.id === "local_whatever_random_bytes")!
		expect(again).toMatchObject({ family: "kokoro_tts", confidence: "matched" })
		expect(again.files).toEqual(["r.gguf"]) // the sidecar is not a package file
	})
})

describe("confirmFamily validation (V-4, fixed by the lead 2026-10-29)", () => {
	test("a family id that is not in the families list is refused; a known one with the wrong task too", async () => {
		put("tts/whatever/made-up-fam/m.gguf", Buffer.alloc(4096, 1))
		const dir = path.join(root, "tts/whatever/made-up-fam")
		expect(lists.families.some((f) => f.family === "not_a_real_family")).toBe(false)
		await expect(
			confirmAudioCppFamily(db as never, { localDir: dir, family: "not_a_real_family", task: "tts" }, opts)
		).rejects.toThrow(/isn't a family this version knows/)
		await expect(
			confirmAudioCppFamily(db as never, { localDir: dir, family: "parakeet_tdt", task: "tts" }, opts)
		).rejects.toThrow(/does asr, not tts/)
		const row = await confirmAudioCppFamily(db as never, { localDir: dir, family: "kokoro_tts", task: "tts" }, opts)
		expect(row).toMatchObject({ family: "kokoro_tts", confidence: "matched" })
	})
	test("a malformed family id is refused", async () => {
		await expect(
			confirmAudioCppFamily(db as never, { localDir: path.join(root, "tts/whatever/made-up-fam"), family: "../x y", task: "tts" }, opts)
		).rejects.toThrow(/isn't a family name/)
	})
})

describe("same leaf name under different family dirs", () => {
	test("twin leaves get ids from their paths (local_kokoro_tts_dup, local_some_family_dup)", async () => {
		put("tts/kokoro_tts/dup/a.gguf", audioGguf("kokoro_tts"))
		put("tts/some_family/dup/b.gguf", audioGguf("kokoro_tts"))
		const dups = (await list()).filter((p) => p.name === "dup")
		expect(dups).toHaveLength(2)
		expect(new Set(dups.map((d) => d.id)).size).toBe(2)
		expect(dups.map((d) => d.id).sort()).toEqual(["local_kokoro_tts_dup", "local_some_family_dup"])
		expect(new Set(dups.map((d) => d.localDir)).size).toBe(2)
	})

	test("removePackage deletes only that leaf directory", async () => {
		const dups = (await list()).filter((p) => p.name === "dup")
		const victim = dups[0]
		const keep = dups[1]
		await removeAudioCppPackage(db as never, victim.id, opts)
		expect(fs.existsSync(victim.localDir!)).toBe(false)
		expect(fs.existsSync(keep.localDir!)).toBe(true)
		expect(fs.existsSync(path.join(root, "tts"))).toBe(true)
	})

	// V-3 (fixed by the lead 2026-10-29): ids come from the path, so removing
	// one twin never renumbers the survivor out of its enabled id.
	test("an enabled twin stays enabled after the OTHER twin is removed", async () => {
		fs.rmSync(path.join(root, "tts/kokoro_tts/dup"), { recursive: true, force: true })
		fs.rmSync(path.join(root, "tts/some_family/dup"), { recursive: true, force: true })
		put("tts/kokoro_tts/dup/a.gguf", audioGguf("kokoro_tts"))
		put("tts/some_family/dup/b.gguf", audioGguf("kokoro_tts"))
		const dups = (await list()).filter((p) => p.name === "dup")
		const second = dups.find((d) => d.id === "local_some_family_dup")!
		await setAudioCppPackageEnabled(db as never, second.id, true, opts)
		const first = dups.find((d) => d.id === "local_kokoro_tts_dup")!
		await removeAudioCppPackage(db as never, first.id, opts)
		const left = (await list()).find((p) => p.name === "dup")!
		expect(left.localDir).toBe(second.localDir)
		expect(left.state).toBe("enabled")
	})
})

describe("listEnabledAudioCppPackages against the real tree", () => {
	test("returns the enabled, downloaded, non-guessed packages with display names", async () => {
		resetAudioListsMemo()
		vi.stubGlobal("fetch", vi.fn(async () => { throw new Error("offline") }))
		const warn = vi.spyOn(console, "warn").mockImplementation(() => {})
		try {
			await db.update(audiocppSettings).set({ enabledPackageIds: [] })
			put("tts/whatever/lister/l.gguf", audioGguf("kokoro_tts"))
			put("tts/whatever/lister-guess/g.gguf", Buffer.alloc(64, 2))
			await db.update(audiocppSettings).set({ enabledPackageIds: ["local_whatever_lister", "local_whatever_lister_guess", "ghost"] })
			const got = await listEnabledAudioCppPackages(db as never)
			expect(got).toEqual([{ id: "local_whatever_lister", name: "lister", task: "tts", family: "kokoro_tts" }])
		} finally {
			vi.unstubAllGlobals()
			warn.mockRestore()
			resetAudioListsMemo()
		}
	})
})
