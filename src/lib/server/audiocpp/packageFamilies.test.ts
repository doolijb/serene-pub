import * as fs from "fs"
import * as os from "os"
import * as path from "path"
import { afterAll, describe, expect, test } from "vitest"
import type { AudioListEntry } from "$lib/server/audio/audioList"
import {
	buildPackageFamilies,
	groupPackageRows,
	nameWithoutPrecision
} from "./packageFamilies"

type Row = Sockets.AudioCpp.PackageRow

const row = (o: Partial<Row> & { id: string }): Row => ({
	name: `Model (${o.id})`,
	task: "tts",
	family: "qwen3_tts",
	files: [],
	tags: [],
	confidence: "listed",
	state: "available",
	recommended: false,
	...o
})

const kobold = (o: Record<string, unknown>) =>
	({
		name: "koboldcpp/tts",
		revision: "main",
		runtime: "koboldcpp",
		family: "kokoro_tts",
		task: "tts",
		tags: [],
		recommendedVram: 0,
		details: { description: "" },
		targetDirectory: "",
		stripPrefix: "",
		...o
	}) as unknown as AudioListEntry

describe("grouping", () => {
	test("q8_0 + bf16 of one family+variant are one group; q8_0 is pre-selected and first", () => {
		const g = groupPackageRows([
			row({ id: "b", name: "Qwen3-TTS 1.7B Base (BF16)", variant: "base", precision: "bf16" }),
			row({ id: "q", name: "Qwen3-TTS 1.7B Base (Q8_0)", variant: "base", precision: "q8_0" }),
			row({ id: "cv", name: "Qwen3-TTS 1.7B CustomVoice (Q8_0)", variant: "customvoice", precision: "q8_0" })
		])
		expect(g).toHaveLength(2)
		expect(g[0]).toMatchObject({
			key: "audiocpp:qwen3_tts:base:qwen3_tts_1_7b_base",
			variant: "base",
			runtime: "audiocpp",
			displayName: "Qwen3-TTS 1.7B Base",
			recommendedId: "q"
		})
		expect(g[0].precisions.map((p) => p.id)).toEqual(["q", "b"])
	})

	test("a recommended row wins the pre-selection", () => {
		const [g] = groupPackageRows([
			row({ id: "q", precision: "q8_0" }),
			row({ id: "b", precision: "bf16", recommended: true })
		])
		expect(g.recommendedId).toBe("b")
	})

	test("no q8_0: the first by order; f16 after bf16 after q8_0, others last", () => {
		const [g] = groupPackageRows([
			row({ id: "o", precision: "orig" }),
			row({ id: "f", precision: "f16" }),
			row({ id: "b", precision: "bf16" })
		])
		expect(g.precisions.map((p) => p.id)).toEqual(["b", "f", "o"])
		expect(g.recommendedId).toBe("b")
	})

	test("a guessed (unlisted) package groups by family+variant with a null variant", () => {
		const g = groupPackageRows([
			row({ id: "local_x", name: "my-folder", family: "kokoro_tts", confidence: "guessed" })
		])
		expect(g).toEqual([
			expect.objectContaining({
				key: "audiocpp:kokoro_tts::my_folder",
				variant: null,
				displayName: "my-folder",
				recommendedId: "local_x"
			})
		])
	})

	test("the same family under two runtimes stays two groups", () => {
		const g = groupPackageRows([
			row({ id: "a", family: "kokoro_tts" }),
			row({ id: "k", family: "kokoro_tts", runtime: "koboldcpp" })
		])
		expect(g.map((x) => x.key)).toEqual(["audiocpp:kokoro_tts::model", "koboldcpp:kokoro_tts::model"])
	})

	test("two sizes of one family+variant are two groups: 1.7B Base no longer hides behind 0.6B Base (MV)", () => {
		const g = groupPackageRows([
			row({ id: "a", name: "Qwen3-TTS 1.7B Base (Q8_0)", variant: "base", precision: "q8_0" }),
			row({ id: "b", name: "Qwen3-TTS 0.6B Base (Q8_0)", variant: "base", precision: "q8_0" }),
			row({ id: "c", name: "Qwen3-TTS 1.7B Base (BF16)", variant: "base", precision: "bf16" }),
			row({ id: "d", name: "Qwen3-TTS 0.6B Base (BF16)", variant: "base", precision: "bf16" })
		])
		expect(g.map((x) => [x.displayName, x.precisions.map((p) => p.id)])).toEqual([
			["Qwen3-TTS 1.7B Base", ["a", "c"]],
			["Qwen3-TTS 0.6B Base", ["b", "d"]]
		])
	})

	test("nameWithoutPrecision strips only a trailing parenthetical", () => {
		expect(nameWithoutPrecision("Kokoro 82M (Q8_0)")).toBe("Kokoro 82M")
		expect(nameWithoutPrecision("Plain")).toBe("Plain")
	})
})

describe("KoboldCPP rows", () => {
	const dirs: string[] = []
	const tmp = () => {
		const d = fs.mkdtempSync(path.join(os.tmpdir(), "acpp-kfam-"))
		dirs.push(d)
		return d
	}
	afterAll(() => dirs.forEach((d) => fs.rmSync(d, { recursive: true, force: true })))

	const Q8 = kobold({
		id: "qwen_q8_koboldcpp",
		displayName: "Qwen3-TTS 1.7B Base (Q8_0)",
		family: "qwen3_tts",
		variant: "base",
		precision: "q8_0",
		files: ["Qwen3-TTS-12Hz-1.7B-Base-q8_0.gguf", "qwen3-tts-tokenizer-q8_0.gguf"],
		sizeBytes: 30
	})
	const F16 = kobold({
		id: "qwen_f16_koboldcpp",
		displayName: "Qwen3-TTS 1.7B Base (F16)",
		family: "qwen3_tts",
		variant: "base",
		precision: "f16",
		files: ["Qwen3-TTS-12Hz-1.7B-Base-f16.gguf", "qwen3-tts-tokenizer-f16.gguf"],
		sizeBytes: 40
	})

	test("one group per model; state needs every file at the folder root; urls per file", async () => {
		const dir = tmp()
		fs.writeFileSync(path.join(dir, "Qwen3-TTS-12Hz-1.7B-Base-q8_0.gguf"), "x")
		fs.writeFileSync(path.join(dir, "qwen3-tts-tokenizer-q8_0.gguf"), "x")
		fs.writeFileSync(path.join(dir, "Qwen3-TTS-12Hz-1.7B-Base-f16.gguf"), "x") // codec missing
		const audioRow = row({ id: "ac", variant: "base", precision: "q8_0", name: "Qwen3-TTS 1.7B Base (Q8_0)" })
		const g = await buildPackageFamilies([audioRow], [Q8, F16], dir)
		expect(g.map((x) => x.key)).toEqual([
			"audiocpp:qwen3_tts:base:qwen3_tts_1_7b_base",
			"koboldcpp:qwen3_tts:base:qwen3_tts_1_7b_base"
		])
		const k = g[1]
		expect(k.runtime).toBe("koboldcpp")
		expect(k.displayName).toBe("Qwen3-TTS 1.7B Base")
		expect(k.recommendedId).toBe("qwen_q8_koboldcpp")
		expect(k.precisions.map((p) => [p.precision, p.state, p.recommended])).toEqual([
			["q8_0", "downloaded", false],
			["f16", "available", false]
		])
		expect(k.precisions[0].koboldCppFiles).toEqual([
			{
				filename: "Qwen3-TTS-12Hz-1.7B-Base-q8_0.gguf",
				downloadUrl:
					"https://huggingface.co/koboldcpp/tts/resolve/main/Qwen3-TTS-12Hz-1.7B-Base-q8_0.gguf"
			},
			{
				filename: "qwen3-tts-tokenizer-q8_0.gguf",
				downloadUrl: "https://huggingface.co/koboldcpp/tts/resolve/main/qwen3-tts-tokenizer-q8_0.gguf"
			}
		])
	})

	test("no models folder or a missing one: available, never a throw", async () => {
		for (const d of [null, "/definitely/not/here"]) {
			const g = await buildPackageFamilies([], [Q8], d)
			expect(g[0].precisions[0].state).toBe("available")
		}
	})
})
