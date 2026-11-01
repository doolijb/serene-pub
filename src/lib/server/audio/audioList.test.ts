import fs from "node:fs"
import path from "node:path"
import { afterAll, beforeAll, beforeEach, describe, expect, test, vi } from "vitest"
import { systemSettings } from "$lib/server/db/schema"
import { createTestDb, type TestDb } from "$lib/server/utils/testDb"
import { AUDIO_FAMILIES_SNAPSHOT } from "$lib/shared/audio/audioFamilies"
import {
	derivePrecision,
	getAudioLists,
	parseAudioFamiliesYaml,
	parseAudioYaml,
	refreshAudioLists,
	resetAudioListsMemo
} from "./audioList"
import audioText from "./snapshot/audio.yaml?raw"
import familiesText from "./snapshot/audio-families.yaml?raw"

let db: TestDb
beforeAll(async () => {
	db = await createTestDb()
}, 60_000)
afterAll(async () => {
	await (db as unknown as { $client: { close(): Promise<void> } }).$client
		.close()
		.catch(() => {})
})
beforeEach(() => resetAudioListsMemo())

const asDb = () => db as never

describe("the shipped snapshot", () => {
	test("audio.yaml parses to 20 entries with real sizes", () => {
		const e = parseAudioYaml(audioText)
		expect(e).toHaveLength(20)
		expect(e.every((x) => x.sizeBytes > 0 && x.files.length > 0)).toBe(true)
		const vd = e.find((x) => x.variant === "voicedesign")
		expect(vd?.task).toBe("vdes")
		expect(e.find((x) => x.family === "kitten_tts2")?.tags).toContain("opt-in-notice")
		expect(new Set(e.map((x) => x.id)).size).toBe(20)
	})
	test("every entry has a precision; bf16 rows sit beside their q8_0 sibling", () => {
		const e = parseAudioYaml(audioText)
		expect(e.every((x) => !!x.precision)).toBe(true)
		const ids = e.filter((x) => x.precision === "bf16").map((x) => x.id)
		expect(ids).toEqual([
			"kokoro_82m_bf16",
			"qwen3_tts_1_7b_customvoice_bf16",
			"qwen3_tts_1_7b_base_bf16",
			"qwen3_tts_1_7b_voicedesign_bf16",
			"qwen3_tts_0_6b_base_bf16"
		])
		const q = e.find((x) => x.id === "qwen3_tts_1_7b_base_q8_0")!
		const b = e.find((x) => x.id === "qwen3_tts_1_7b_base_bf16")!
		expect(b.variant).toBe(q.variant)
		expect(b.recommendedVram).toBeGreaterThan(q.recommendedVram)
	})
	test("koboldcpp rows: bare files incl. the codec, flat, size = sum of files", () => {
		const k = parseAudioYaml(audioText).filter((x) => x.runtime === "koboldcpp")
		expect(k).toHaveLength(7)
		for (const x of k) {
			expect(x.files.every((f) => !f.includes("/"))).toBe(true)
			expect(x.targetDirectory).toBe("")
			expect(x.stripPrefix).toBe("")
		}
		const q = k.find((x) => x.id === "qwen3_tts_1_7b_customvoice_f16_koboldcpp")!
		expect(q.files).toEqual([
			"Qwen3-TTS-12Hz-1.7B-CustomVoice-F16.gguf",
			"qwen3-tts-tokenizer-f16.gguf"
		])
		expect(q.sizeBytes).toBe(3839589632 + 341157120)
		expect(k.find((x) => x.family === "kokoro_tts")?.files).toHaveLength(1)
		expect(parseAudioYaml(audioText).filter((x) => x.runtime === "audiocpp")).toHaveLength(13)
	})
	test("every listed family has a rule", () => {
		const fams = new Set(parseAudioFamiliesYaml(familiesText).map((f) => f.family))
		for (const e of parseAudioYaml(audioText)) expect(fams.has(e.family)).toBe(true)
	})
	test("audio-families.yaml parses to 5 families", () => {
		expect(parseAudioFamiliesYaml(familiesText)).toHaveLength(5)
	})
	test("AUDIO_FAMILIES_SNAPSHOT equals the parsed snapshot", () => {
		expect(AUDIO_FAMILIES_SNAPSHOT).toEqual(parseAudioFamiliesYaml(familiesText))
	})
	const repo = path.resolve(process.cwd(), "../serene-pub-gguf-list")
	test.skipIf(!fs.existsSync(repo))("snapshot files are byte-equal to the list repo", () => {
		for (const f of ["audio.yaml", "audio-families.yaml"])
			expect(fs.readFileSync(path.join(repo, f), "utf8")).toBe(
				fs.readFileSync(path.join(__dirname, "snapshot", f), "utf8")
			)
	})
})

describe("parsing is forgiving", () => {
	test("bad entries are dropped, bad numbers read as 0", () => {
		const warn = vi.spyOn(console, "warn").mockImplementation(() => {})
		const e = parseAudioYaml(`models:
  - id: ok
    family: kokoro_tts
    task: tts
    files: [a.gguf]
    size_bytes: lots
    recommended_vram: .nan
  - id: bad-task
    family: x
    task: video
    files: [a]
  - just a string
  - id: ok
    family: x
    task: asr
    files: [a]
`)
		expect(e).toHaveLength(1)
		expect(e[0].sizeBytes).toBe(0)
		expect(e[0].recommendedVram).toBe(0)
		expect(warn).toHaveBeenCalled()
		warn.mockRestore()
	})
	test("garbage text yields an empty list, never a throw", () => {
		const warn = vi.spyOn(console, "warn").mockImplementation(() => {})
		expect(parseAudioYaml("::: [")).toEqual([])
		expect(parseAudioFamiliesYaml("families: 4")).toEqual([])
		warn.mockRestore()
	})
})

describe("precision and runtime fields", () => {
	test("derivePrecision reads the file or id suffix", () => {
		expect(derivePrecision("A/kokoro-82m-bf16.gguf")).toBe("bf16")
		expect(derivePrecision("x-q8_0_v2.gguf")).toBe("q8_0")
		expect(derivePrecision("Kokoro_no_espeak_Q4.gguf")).toBe("q4")
		expect(derivePrecision("m-Q4_K_M.gguf")).toBe("q4_k_m")
		expect(derivePrecision("model.gguf", "thing")).toBeUndefined()
	})
	test("an absent precision is derived; an explicit one wins; runtime defaults to audiocpp", () => {
		const e = parseAudioYaml(`models:
  - id: a_bf16
    family: f
    task: tts
    files: [D/a-bf16.gguf]
  - id: b
    family: f
    task: tts
    precision: Q8_0
    files: [D/b-bf16.gguf]
  - id: c
    family: f
    task: tts
    files: [D/c.gguf]
`)
		expect(e.map((x) => x.precision)).toEqual(["bf16", "q8_0", undefined])
		expect(e.every((x) => x.runtime === "audiocpp")).toBe(true)
	})
	test("koboldcpp rows must name bare files and drop the directory fields; unknown runtimes are dropped", () => {
		const warn = vi.spyOn(console, "warn").mockImplementation(() => {})
		const e = parseAudioYaml(`models:
  - id: k_ok
    runtime: koboldcpp
    family: f
    task: tts
    files: [M-Q4.gguf, WavTokenizer.gguf]
    target_directory: "ignored"
    strip_prefix: "ignored"
  - id: k_nested
    runtime: koboldcpp
    family: f
    task: tts
    files: [dir/M-Q4.gguf]
  - id: k_alien
    runtime: llamafile
    family: f
    task: tts
    files: [M.gguf]
`)
		expect(e.map((x) => x.id)).toEqual(["k_ok"])
		expect(e[0].targetDirectory).toBe("")
		expect(e[0].stripPrefix).toBe("")
		warn.mockRestore()
	})
})

describe("getAudioLists fallback chain", () => {
	const okFetch = (async (url: string) => {
		const body = String(url).endsWith("audio-families.yaml") ? familiesText : audioText
		return new Response(body, { status: 200 })
	}) as unknown as typeof fetch
	const badFetch = (async () => {
		throw new Error("offline")
	}) as unknown as typeof fetch

	test("no settings row: fetched, nothing cached, then snapshot offline", async () => {
		await db.delete(systemSettings)
		const warn = vi.spyOn(console, "warn").mockImplementation(() => {})
		const a = await getAudioLists(asDb(), { fetch: okFetch })
		expect(a.source).toBe("fetched")
		expect(a.entries).toHaveLength(20)
		const b = await getAudioLists(asDb(), { fetch: badFetch, force: true })
		expect(b.source).toBe("snapshot")
		expect(b.families).toHaveLength(5)
		warn.mockRestore()
	}, 60_000)

	test("fetched caches, then offline reads the cache, memo holds", async () => {
		await db.delete(systemSettings)
		await db.insert(systemSettings).values({})
		const warn = vi.spyOn(console, "warn").mockImplementation(() => {})
		const fetchSpy = vi.fn(okFetch)
		const a = await getAudioLists(asDb(), { fetch: fetchSpy as never })
		expect(a.source).toBe("fetched")
		expect(fetchSpy).toHaveBeenCalledTimes(2)
		const again = await getAudioLists(asDb(), { fetch: fetchSpy as never })
		expect(again).toBe(a)
		expect(fetchSpy).toHaveBeenCalledTimes(2)
		const [row] = await db.select().from(systemSettings)
		expect(Object.keys(row.ggufListCache).sort()).toEqual(["audio-families.yaml", "audio.yaml"])
		const c = await refreshAudioLists(asDb(), { fetch: badFetch })
		expect(c.source).toBe("cached")
		expect(c.entries).toHaveLength(20)
		warn.mockRestore()
	}, 60_000)

	test("a non-ok response falls back", async () => {
		const warn = vi.spyOn(console, "warn").mockImplementation(() => {})
		const f = (async () => new Response("no", { status: 404 })) as unknown as typeof fetch
		const r = await getAudioLists(asDb(), { fetch: f })
		expect(["cached", "snapshot"]).toContain(r.source)
		warn.mockRestore()
	}, 60_000)
})
