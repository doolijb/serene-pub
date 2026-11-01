import { describe, expect, test } from "vitest"
import {
	arrivingLabel,
	audioFamilyLabel,
	groupPackages,
	getMoreFinder,
	precisionLabel,
	rowActions,
	servedRows,
	vramHint
} from "./audiocppPackages"

const row = (o: Partial<Sockets.AudioCpp.PackageRow>): Sockets.AudioCpp.PackageRow => ({
	id: "x",
	name: "X",
	task: "tts",
	family: "kokoro_tts",
	files: [],
	tags: [],
	confidence: "listed",
	state: "available",
	recommended: false,
	...o
})

describe("audioFamilyLabel", () => {
	test("names the plan's families and falls back readably", () => {
		expect(audioFamilyLabel("kitten_tts2")).toBe("Kitten TTS 2")
		expect(audioFamilyLabel("whisper_cpp")).toBe("Whisper Cpp")
		expect(audioFamilyLabel("")).toBe("Unknown family")
	})
})

describe("vramHint", () => {
	test("CPU-fine, wants n, absent", () => {
		expect(vramHint({ recommendedVram: 0 })).toBe("CPU-fine")
		expect(vramHint({ recommendedVram: 6 })).toBe("Wants 6 GB VRAM")
		expect(vramHint({})).toBe(null)
	})
})

describe("groupPackages", () => {
	test("Speech before Transcription, recommended first, unknown family last", () => {
		const groups = groupPackages([
			row({ id: "a", name: "A", task: "asr", family: "parakeet_tdt" }),
			row({ id: "u", name: "U", family: "" }),
			row({ id: "b", name: "B", state: "downloaded" }),
			row({ id: "c", name: "C", recommended: true }),
			row({ id: "v", name: "V", task: "vdes", family: "qwen3_tts" })
		])
		expect(groups.map((g) => g.label)).toEqual(["Speech", "Transcription"])
		const speech = groups[0].families
		expect(speech.map((f) => f.label)).toEqual(["Kokoro", "Qwen3-TTS", "Unknown family"])
		expect(speech[0].rows.map((r) => r.id)).toEqual(["c", "b"])
	})

	test("the family holding the recommended package leads its group", () => {
		const groups = groupPackages([
			row({ id: "k2", name: "Kitten", family: "kitten_tts2" }),
			row({ id: "q", name: "Qwen", family: "qwen3_tts" }),
			row({ id: "ko", name: "Kokoro", family: "kokoro_tts", recommended: true })
		])
		expect(groups[0].families.map((f) => f.label)).toEqual([
			"Kokoro",
			"Kitten TTS 2",
			"Qwen3-TTS"
		])
	})
})

describe("rowActions", () => {
	test("by state and confidence", () => {
		expect(rowActions(row({})).primary?.label).toBe("Get")
		const arriving = rowActions(row({ state: "downloading" }))
		expect(arriving.primary?.label).toBe("Arriving")
		expect(arriving.canCancel).toBe(true)
		const dl = rowActions(row({ state: "downloaded" }))
		expect(dl.primary?.label).toBe("Enable")
		expect(dl.canRemove).toBe(true)
		expect(rowActions(row({ state: "enabled" })).primary?.label).toBe("Disable")
		const g = rowActions(row({ state: "downloaded", confidence: "guessed" }))
		expect(g.primary?.label).toBe("Confirm family")
		const u = rowActions(row({ state: "downloaded", family: "" }))
		expect(u.primary?.label).toBe("Confirm family")
		expect(u.note === null).toBe(false)
		// Lane B's shape for an unmatched folder: family "unknown", guessed.
		const unk = rowActions(
			row({ state: "downloaded", family: "unknown", confidence: "guessed" })
		)
		expect(unk.primary?.label).toBe("Confirm family")
	})
})

describe("arrivingLabel", () => {
	test("bytes", () => {
		expect(arrivingLabel({ downloaded: 120_000_000, total: 1_200_000_000 })).toBe("120 MB of 1.2 GB")
		expect(arrivingLabel(undefined)).toBe(null)
	})
})

describe("servedRows", () => {
	test("keeps what is on disk or arriving, drops catalogue-only and KoboldCPP rows", () => {
		const rows = [
			row({ id: "a", state: "available" }),
			row({ id: "b", state: "downloaded" }),
			row({ id: "c", state: "enabled" }),
			row({ id: "d", state: "downloading" }),
			row({ id: "e", state: "downloaded", runtime: "koboldcpp" }),
			row({ id: "f", state: "available" })
		]
		expect(servedRows(rows).map((r) => r.id)).toEqual(["b", "c", "d"])
		expect(servedRows(rows, new Set(["f"])).map((r) => r.id)).toEqual(["b", "c", "d", "f"])
	})
	test("precision label and the door's finder scope", () => {
		expect(precisionLabel(row({ precision: "q8_0" }))).toBe("Q8_0")
		expect(precisionLabel(row({}))).toBe(null)
		expect(getMoreFinder(9)).toEqual({ connectionId: 9, capability: "text->audio" })
		expect(getMoreFinder(undefined)).toEqual({ capability: "text->audio" })
	})
})
