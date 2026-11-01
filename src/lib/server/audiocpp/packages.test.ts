import { afterAll, beforeAll, describe, expect, test } from "vitest"
import * as fs from "fs"
import * as http from "http"
import * as os from "os"
import * as path from "path"
import type { AddressInfo } from "net"
import { audiocppSettings } from "$lib/server/db/schema"
import { createTestDb, type TestDb } from "$lib/server/utils/testDb"
import { ensureAudioCppSettings } from "./settings"
import {
	confirmAudioCppFamily,
	enabledPackagesForConfig,
	FAMILY_SIDECAR,
	getAudioCppPackageDownloads,
	listAudioCppPackages,
	packageFilePaths,
	packageLeafDir,
	removeAudioCppPackage,
	resolveAudioModelsDir,
	setAudioCppPackageEnabled,
	startAudioCppPackageDownload,
	cancelAudioCppPackageDownload,
	type AudioLists
} from "./packages"
import type { AudioListEntry } from "$lib/server/audio/audioList"

const entry = (o: Record<string, unknown>) =>
	({
		revision: "main",
		name: "audio-cpp/audio.cpp-gguf",
		tags: [],
		recommendedVram: 0,
		details: { description: "" },
		...o
	}) as unknown as AudioListEntry

const KOKORO = entry({
	id: "kokoro_82m_q8_0",
	displayName: "Kokoro 82M (q8)",
	family: "kokoro_tts",
	task: "tts",
	files: ["Kokoro-82M-GGUF/kokoro-82m-q8_0.gguf"],
	targetDirectory: "Kokoro-82M-GGUF",
	stripPrefix: "Kokoro-82M-GGUF",
	sizeBytes: 1000
})
const QWEN = entry({
	id: "qwen3_tts_1_7b_customvoice_q8_0",
	displayName: "Qwen3-TTS 1.7B CustomVoice (q8)",
	family: "qwen3_tts",
	variant: "customvoice",
	task: "tts",
	files: ["Qwen3-GGUF/qwen3-cv-q8_0.gguf", "Qwen3-GGUF/codec.gguf"],
	targetDirectory: "Qwen3-GGUF",
	stripPrefix: "Qwen3-GGUF",
	recommendedVram: 6
})
const PARAKEET = entry({
	id: "parakeet_tdt_0_6b_v3_q8_0",
	displayName: "Parakeet TDT 0.6B v3 (q8)",
	family: "parakeet_tdt",
	task: "asr",
	files: ["Parakeet-GGUF/parakeet-q8_0.gguf"],
	targetDirectory: "Parakeet-GGUF",
	stripPrefix: "Parakeet-GGUF"
})
const KITTEN = entry({
	id: "kitten_tts2_q8_0",
	displayName: "Kitten TTS 2",
	family: "kitten_tts2",
	task: "tts",
	files: ["Kitten-GGUF/kitten.gguf"],
	targetDirectory: "Kitten-GGUF",
	stripPrefix: "Kitten-GGUF",
	recommendedVram: 4
})
const lists: AudioLists = { entries: [KOKORO, QWEN, PARAKEET, KITTEN], families: [] }

// Stand-in for W2's familyOf: matches on the path only.
const familyOf = (input: { file: { path: string } }) => {
	const p = input.file.path.toLowerCase()
	if (p.includes("whisperish"))
		return { task: "asr" as const, family: "whisper_like", confidence: "matched" as const }
	if (p.includes("maybe"))
		return { task: "tts" as const, family: "qwen3_tts", confidence: "guessed" as const }
	return null
}

let tmp: string
let root: string
let db: TestDb
let prevData: string | undefined

const touch = (rel: string, content = "x") => {
	const p = path.join(root, rel)
	fs.mkdirSync(path.dirname(p), { recursive: true })
	fs.writeFileSync(p, content)
	return p
}
const list = (backend: Parameters<typeof listAudioCppPackages>[1]["backend"] = null) =>
	listAudioCppPackages(db as never, { lists, backend, familyOf })
const opts = { lists, familyOf, backend: null }

beforeAll(async () => {
	tmp = fs.mkdtempSync(path.join(os.tmpdir(), "acpp-pkgs-"))
	root = path.join(tmp, "audio")
	db = await createTestDb()
	const s = await ensureAudioCppSettings(db as never)
	await db.update(audiocppSettings).set({ modelsDir: root })
	expect(s).toBeTruthy()
}, 60_000)

afterAll(async () => {
	await (db as unknown as { $client: { close(): Promise<void> } }).$client
		.close()
		.catch(() => {})
	fs.rmSync(tmp, { recursive: true, force: true })
})

describe("paths", () => {
	test("resolveAudioModelsDir prefers settings.modelsDir", () => {
		expect(resolveAudioModelsDir({ modelsDir: "/x/audio" })).toBe("/x/audio")
		expect(resolveAudioModelsDir({ modelsDir: null })).toMatch(
			/models[\\/]audio$/
		)
	})
	test("leaf and file paths follow the D3b layout; vdes lives under tts", () => {
		expect(
			packageLeafDir("/r", { task: "vdes", family: "qwen3_tts", targetDirectory: "T" })
		).toBe("/r/tts/qwen3_tts/T")
		expect(packageFilePaths("/r", QWEN)).toEqual([
			"/r/tts/qwen3_tts/Qwen3-GGUF/qwen3-cv-q8_0.gguf",
			"/r/tts/qwen3_tts/Qwen3-GGUF/codec.gguf"
		])
	})
	test("unsafe paths are refused with sentences", () => {
		for (const bad of ["../x", "/abs", "a//b", "a\\b", "C:/x", "a/../b"]) {
			expect(() =>
				packageFilePaths("/r", { ...KOKORO, files: [bad], stripPrefix: "" })
			).toThrow(/won't use it/)
		}
		expect(() =>
			packageLeafDir("/r", { task: "tts", family: "k", targetDirectory: "../up" })
		).toThrow(/won't use it/)
	})
})

describe("listing", () => {
	test("nothing on disk: all available, sorted, recommendation per backend", async () => {
		const cpu = await list("cpu")
		expect(cpu.map((p) => p.id)).toEqual([
			"kokoro_82m_q8_0",
			"kitten_tts2_q8_0",
			"qwen3_tts_1_7b_customvoice_q8_0",
			"parakeet_tdt_0_6b_v3_q8_0"
		])
		expect(cpu.every((p) => p.state === "available" && p.reason)).toBe(true)
		expect(cpu.filter((p) => p.recommended).map((p) => p.id)).toEqual([
			"kokoro_82m_q8_0",
			"parakeet_tdt_0_6b_v3_q8_0"
		])
		const gpu = await list("cuda")
		expect(gpu.filter((p) => p.recommended).map((p) => p.id)).toEqual([
			"qwen3_tts_1_7b_customvoice_q8_0",
			"parakeet_tdt_0_6b_v3_q8_0"
		])
		expect(gpu[0].id).toBe("qwen3_tts_1_7b_customvoice_q8_0")
		const unknown = await list(null)
		expect(unknown.find((p) => p.recommended && p.task === "tts")!.id).toBe(
			"kokoro_82m_q8_0"
		)
		expect(cpu.find((p) => p.id === "kitten_tts2_q8_0")!.recommended).toBe(false)
		expect(cpu.find((p) => p.id === "kitten_tts2_q8_0")!.reason).toMatch(/VRAM/)
	})

	test("listed on disk is downloaded; a .part keeps it available", async () => {
		touch("tts/kokoro_tts/Kokoro-82M-GGUF/kokoro-82m-q8_0.gguf")
		let k = (await list()).find((p) => p.id === KOKORO.id)!
		expect(k.state).toBe("downloaded")
		expect(k.localDir).toBe(path.join(root, "tts/kokoro_tts/Kokoro-82M-GGUF"))
		touch("tts/qwen3_tts/Qwen3-GGUF/qwen3-cv-q8_0.gguf")
		touch("tts/qwen3_tts/Qwen3-GGUF/codec.gguf.part")
		const q = (await list()).find((p) => p.id === QWEN.id)!
		expect(q.state).toBe("available")
		expect(q.localDir).toBeTruthy()
		// the on-disk listed package does not also appear as a local_ one
		expect((await list()).filter((p) => p.id.startsWith("local_"))).toEqual([])
	})

	test("tree walk: familyOf match, sidecar wins, unknown is guessed", async () => {
		touch("asr/whisper_like/Whisperish-GGUF/w.gguf")
		touch("tts/mystery/Some Model!/a.gguf")
		touch("tts/mystery/Maybe-Model/m.gguf")
		touch("tts/sidecar_fam/Hand Copy/h.gguf")
		fs.writeFileSync(
			path.join(root, "tts/sidecar_fam/Hand Copy", FAMILY_SIDECAR),
			JSON.stringify({ family: "kokoro_tts", task: "tts", confirmedAt: "now" })
		)
		const rows = await list()
		const by = (id: string) => rows.find((p) => p.id === id)!
		expect(by("local_whisper_like_whisperish_gguf")).toMatchObject({
			family: "whisper_like",
			task: "asr",
			confidence: "matched"
		})
		expect(by("local_sidecar_fam_hand_copy")).toMatchObject({
			family: "kokoro_tts",
			confidence: "matched"
		})
		expect(by("local_mystery_some_model")).toMatchObject({
			family: "unknown",
			task: "tts",
			confidence: "guessed",
			recommended: false
		})
		expect(by("local_mystery_some_model").reason).toMatch(/confirm it/)
		expect(by("local_mystery_maybe_model").confidence).toBe("guessed")
		expect(by("local_mystery_some_model").files).toEqual(["a.gguf"])
	})
})

describe("enable, confirm, remove", () => {
	test("enabling needs a download and a non-guessed family", async () => {
		await expect(
			setAudioCppPackageEnabled(db as never, PARAKEET.id, true, opts)
		).rejects.toThrow(/Download/)
		await expect(
			setAudioCppPackageEnabled(db as never, "local_mystery_some_model", true, opts)
		).rejects.toThrow(/Confirm which audio family/)
	})

	test("enable writes enabledPackageIds only, dedupes; state becomes enabled", async () => {
		const row = await setAudioCppPackageEnabled(db as never, KOKORO.id, true, opts)
		expect(row.state).toBe("enabled")
		await setAudioCppPackageEnabled(db as never, KOKORO.id, true, opts)
		await setAudioCppPackageEnabled(db as never, "local_sidecar_fam_hand_copy", true, opts)
		const s = await ensureAudioCppSettings(db as never)
		expect(s.enabledPackageIds).toEqual([KOKORO.id, "local_sidecar_fam_hand_copy"])
		const cfg = await enabledPackagesForConfig(db as never, lists)
		expect(cfg.map((c) => c.id)).toEqual([KOKORO.id, "local_sidecar_fam_hand_copy"])
		expect(cfg[0]).toMatchObject({ family: "kokoro_tts", task: "tts" })
		expect(path.isAbsolute(cfg[0].path)).toBe(true)
		expect(cfg[0].path.endsWith("kokoro-82m-q8_0.gguf")).toBe(true)
	}, 60_000)

	test("confirm writes the sidecar, guarded to the models root", async () => {
		const dir = path.join(root, "tts/mystery/Some Model!")
		const row = await confirmAudioCppFamily(
			db as never,
			{ localDir: dir, family: "qwen3_tts", task: "tts" },
			opts
		)
		expect(row).toMatchObject({ family: "qwen3_tts", confidence: "matched" })
		const side = JSON.parse(fs.readFileSync(path.join(dir, FAMILY_SIDECAR), "utf8"))
		expect(side).toMatchObject({ family: "qwen3_tts", task: "tts" })
		expect(typeof side.confirmedAt).toBe("string")
		await expect(
			confirmAudioCppFamily(
				db as never,
				{ localDir: tmp, family: "x", task: "tts" },
				opts
			)
		).rejects.toThrow(/isn't inside/)
		await expect(
			confirmAudioCppFamily(
				db as never,
				{ localDir: path.join(root, "../elsewhere"), family: "x", task: "tts" },
				opts
			)
		).rejects.toThrow(/isn't inside/)
	}, 60_000)

	test("an enabled id whose files vanished is skipped", async () => {
		await setAudioCppPackageEnabled(db as never, "local_sidecar_fam_hand_copy", false, opts)
		await db
			.update(audiocppSettings)
			.set({ enabledPackageIds: [KOKORO.id, "ghost"] })
		const cfg = await enabledPackagesForConfig(db as never, lists)
		expect(cfg.map((c) => c.id)).toEqual([KOKORO.id])
	}, 60_000)

	test("remove refuses a folder with something else in it, then removes cleanly", async () => {
		const extra = touch("tts/kokoro_tts/Kokoro-82M-GGUF/notes.txt")
		await expect(removeAudioCppPackage(db as never, KOKORO.id, opts)).rejects.toThrow(
			/also holds notes\.txt/
		)
		fs.rmSync(extra)
		await removeAudioCppPackage(db as never, KOKORO.id, opts)
		expect(fs.existsSync(path.join(root, "tts/kokoro_tts/Kokoro-82M-GGUF"))).toBe(false)
		const s = await ensureAudioCppSettings(db as never)
		expect(s.enabledPackageIds).toEqual(["ghost"])
		const k = (await list()).find((p) => p.id === KOKORO.id)!
		expect(k.state).toBe("available")
	}, 60_000)
})

describe("download against a local server", () => {
	const body = Buffer.alloc(150_000, 7)
	let server: http.Server
	let base: string
	beforeAll(async () => {
		server = http.createServer((req, res) => {
			if (req.url?.includes("slow")) {
				res.writeHead(200, { "content-length": 10 })
				return // never finishes: for the cancel test
			}
			const m = req.headers.range?.match(/bytes=(\d+)-(\d+)/)
			if (!m) {
				res.writeHead(200, { "content-length": body.length })
				return void res.end(body)
			}
			const s = Number(m[1])
			const e = Math.min(Number(m[2]), body.length - 1)
			res.writeHead(206, {
				"content-range": `bytes ${s}-${e}/${body.length}`,
				"content-length": e - s + 1
			})
			res.end(body.subarray(s, e + 1))
		})
		await new Promise<void>((r) => server.listen(0, "127.0.0.1", r))
		base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`
	})
	afterAll(async () => {
		server.closeAllConnections?.()
		await new Promise((r) => server.close(r))
	})

	test("downloads every file, renames from .part, ends downloaded", async () => {
		const { done } = await startAudioCppPackageDownload(db as never, QWEN.id, {
			...opts,
			urlFor: (_e, p) => `${base}/${p}`
		})
		await done
		const st = getAudioCppPackageDownloads()[QWEN.id]
		expect(st).toMatchObject({ status: "success", isDone: true, filesDone: 2, filesTotal: 2 })
		expect(st.downloaded).toBe(body.length * 2)
		const leaf = path.join(root, "tts/qwen3_tts/Qwen3-GGUF")
		expect(fs.readdirSync(leaf).sort()).toEqual(["codec.gguf", "qwen3-cv-q8_0.gguf"])
		expect((await list()).find((p) => p.id === QWEN.id)!.state).toBe("downloaded")
	}, 60_000)

	test("refuses unlisted ids, and cancel cleans up .part files", async () => {
		await expect(
			startAudioCppPackageDownload(db as never, "local_x", opts)
		).rejects.toThrow(/audio list/)
		const { done } = await startAudioCppPackageDownload(db as never, PARAKEET.id, {
			...opts,
			urlFor: (_e, p) => `${base}/slow/${p}`
		})
		// the resolve probe never answers; cancel must still settle it
		await new Promise((r) => setTimeout(r, 100))
		expect(cancelAudioCppPackageDownload(PARAKEET.id)).toBe(true)
		await done
		expect(getAudioCppPackageDownloads()[PARAKEET.id]).toMatchObject({
			status: "cancelled",
			isDone: true
		})
		expect(
			fs.existsSync(path.join(root, "asr/parakeet_tdt/Parakeet-GGUF/parakeet-q8_0.gguf.part"))
		).toBe(false)
	}, 60_000)
})

describe("KoboldCPP rows are invisible to audio.cpp", () => {
	const KCPP = entry({
		id: "kokoro_82m_q4_koboldcpp",
		runtime: "koboldcpp",
		displayName: "Kokoro 82M (Q4)",
		family: "kokoro_tts",
		task: "tts",
		precision: "q4",
		files: ["Kokoro_no_espeak_Q4.gguf"],
		targetDirectory: "",
		stripPrefix: "",
		sizeBytes: 5
	})
	const OUTE_FAMILY = {
		family: "outetts",
		tasks: ["tts"],
		runner: "koboldcpp",
		voices: "none",
		match: {
			repos: [],
			files: ["outetts"],
			ggufArchitectures: [],
			ggufFamilies: [],
			hfPipelineTags: [],
			hfTags: []
		}
	} as never
	const mixed: AudioLists = { entries: [KOKORO, KCPP], families: [OUTE_FAMILY] }

	test("the flat list holds audio.cpp rows only, even with the kcpp file on disk", async () => {
		touch("tts/kokoro_tts/Kokoro_no_espeak_Q4.gguf")
		const rows = await listAudioCppPackages(db as never, {
			lists: mixed,
			backend: null,
			familyOf
		})
		expect(rows.find((r) => r.id === KCPP.id)).toBeUndefined()
		expect(rows.find((r) => r.id === KOKORO.id)?.precision).toBeUndefined()
	})

	test("download refuses with the KoboldCPP sentence", async () => {
		await expect(
			startAudioCppPackageDownload(db as never, KCPP.id, { lists: mixed, familyOf, backend: null })
		).rejects.toThrow("That one is run by KoboldCPP; get it for KoboldCPP instead.")
	})

	test("enable, confirm and the server.json config never see a kcpp row or family", async () => {
		await expect(
			setAudioCppPackageEnabled(db as never, KCPP.id, true, { lists: mixed, familyOf, backend: null })
		).rejects.toThrow(/no audio package/)
		await expect(
			confirmAudioCppFamily(
				db as never,
				{ localDir: path.join(root, "tts", "outetts", "X"), family: "outetts", task: "tts" },
				{ lists: mixed, familyOf, backend: null }
			)
		).rejects.toThrow(/run by KoboldCPP/)
		const cfg = await enabledPackagesForConfig(db as never, mixed)
		expect(cfg.find((c) => c.id === KCPP.id)).toBeUndefined()
	})
})
