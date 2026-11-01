import { describe, expect, test, vi } from "vitest"
import {
	MAX_PRESENCE_QUERIES,
	modelPresence,
	normaliseOllamaTag,
	type PresenceDb,
	type PresenceDeps
} from "./modelPresence"

function fakeDb(
	connections: any[],
	settings: any = {
		koboldCppManagerModelsDir: "/m/text",
		koboldCppImageModelsDir: "/m/image"
	}
): PresenceDb {
	return {
		query: {
			connections: { findMany: async () => connections },
			koboldCppSettings: { findFirst: async () => settings }
		}
	}
}

const conns = [
	{ id: 1, name: "KoboldCPP", type: "koboldcpp_managed" },
	{ id: 2, name: "KoboldCPP images", type: "koboldcpp_managed_image" },
	{ id: 3, name: "Ollama", type: "ollama", baseUrl: "http://a:11434/" },
	{ id: 4, name: "Far Ollama", type: "ollama", baseUrl: "http://down:11434" },
	{ id: 5, name: "Embedder", type: "local-onnx" },
	{ id: 6, name: "Speech", type: "audiocpp_managed" }
]

const deps = (over: Partial<PresenceDeps> = {}): Partial<PresenceDeps> => ({
	listDir: async (dir) =>
		dir === "/m/text"
			? [
					{ name: "a.gguf", size: 100 },
					{ name: "b.gguf", size: 5 }
				]
			: dir === "/m/image"
				? [{ name: "sd.safetensors", size: 7 }]
				: [],
	ollamaTags: async (url) =>
		url === "http://a:11434"
			? ["llama3:latest", "hf.co/Foo/Bar-GGUF:Q4_K_M"]
			: null,
	audioPackageIds: async () => ["kokoro-q8"],
	onnxLanes: async (repo, dtype) =>
		repo === "Xenova/x" && (!dtype || dtype === "q8") ? ["embeddings"] : [],
	...over
})

describe("modelPresence", () => {
	test("KoboldCPP: filename, size mismatch, image dir", async () => {
		const r = await modelPresence(
			fakeDb(conns),
			[
				{ key: "hit", file: "a.gguf", bytes: 100 },
				{ key: "nobytes", file: "a.gguf" },
				{ key: "wrongsize", file: "a.gguf", bytes: 99 },
				{ key: "img", file: "sd.safetensors" },
				{ key: "nope", file: "zzz.gguf" }
			],
			deps()
		)
		const by = Object.fromEntries(r.map((x) => [x.key, x.holders]))
		expect(by.hit).toEqual([
			{ runtime: "koboldcpp", connectionId: 1, where: "text", match: "a.gguf" }
		])
		expect(by.nobytes).toHaveLength(1)
		expect(by.wrongsize).toEqual([])
		expect(by.img[0]).toMatchObject({ where: "image", connectionId: 2 })
		expect(by.nope).toEqual([])
	})

	test("image dir equal to the text dir is scanned once", async () => {
		const r = await modelPresence(
			fakeDb(conns, {
				koboldCppManagerModelsDir: "/m/text",
				koboldCppImageModelsDir: "/m/text"
			}),
			[{ key: "k", file: "a.gguf" }],
			deps()
		)
		expect(r[0].holders).toHaveLength(1)
	})

	test("Ollama: tag, bare name, hf.co repo+file, unreachable host", async () => {
		const r = await modelPresence(
			fakeDb(conns),
			[
				{ key: "t", tag: "LLAMA3:latest" },
				{ key: "bare", tag: "llama3" },
				{ key: "hf", repo: "foo/bar-gguf", file: "Bar-Q4_K_M.gguf" },
				{ key: "hfno", repo: "foo/bar-gguf", file: "Bar-Q8_0.gguf" },
				{ key: "none", tag: "mistral" }
			],
			deps()
		)
		const by = Object.fromEntries(r.map((x) => [x.key, x.holders]))
		expect(by.t).toEqual([
			{ runtime: "ollama", connectionId: 3, where: "Ollama", match: "llama3:latest" }
		])
		expect(by.bare).toHaveLength(1)
		expect(by.hf[0]).toMatchObject({ runtime: "ollama", match: "hf.co/Foo/Bar-GGUF:Q4_K_M" })
		expect(by.hfno.filter((h) => h.runtime === "ollama")).toEqual([])
		expect(by.none).toEqual([])
	})

	test("ONNX: repo and dtype; audio.cpp: package id", async () => {
		const r = await modelPresence(
			fakeDb(conns),
			[
				{ key: "hit", repo: "Xenova/x" },
				{ key: "q8", repo: "Xenova/x", dtype: "q8" },
				{ key: "q4", repo: "Xenova/x", dtype: "q4" },
				{ key: "miss", repo: "Xenova/y" },
				{ key: "a", packageId: "kokoro-q8" },
				{ key: "b", packageId: "other" }
			],
			deps()
		)
		const by = Object.fromEntries(r.map((x) => [x.key, x.holders]))
		expect(by.hit).toEqual([
			{ runtime: "onnx", connectionId: 5, where: "embeddings", match: "Xenova/x" }
		])
		expect(by.q8).toHaveLength(1)
		expect(by.q4).toEqual([])
		expect(by.miss).toEqual([])
		expect(by.a).toEqual([
			{ runtime: "audiocpp", connectionId: 6, where: null, match: "kokoro-q8" }
		])
		expect(by.b).toEqual([])
	})

	test("lists each source once per request, however many queries", async () => {
		const listDir = vi.fn(deps().listDir!)
		const ollamaTags = vi.fn(deps().ollamaTags!)
		const audioPackageIds = vi.fn(deps().audioPackageIds!)
		const queries = Array.from({ length: 50 }, (_, i) => ({
			key: String(i),
			file: "a.gguf",
			tag: "llama3",
			packageId: "kokoro-q8"
		}))
		await modelPresence(fakeDb(conns), queries, deps({ listDir, ollamaTags, audioPackageIds }))
		expect(listDir).toHaveBeenCalledTimes(2)
		expect(ollamaTags).toHaveBeenCalledTimes(2)
		expect(audioPackageIds).toHaveBeenCalledTimes(1)
	})

	test("a throwing source contributes nothing; every query gets a result", async () => {
		const r = await modelPresence(
			fakeDb(conns),
			[{ key: "k", file: "a.gguf", tag: "llama3", packageId: "p" }],
			deps({
				listDir: async () => {
					throw new Error("boom")
				},
				ollamaTags: async () => {
					throw new Error("boom")
				},
				audioPackageIds: async () => {
					throw new Error("boom")
				}
			})
		)
		expect(r).toEqual([{ key: "k", holders: [] }])
	})

	test("refuses more than the cap", async () => {
		const q = Array.from({ length: MAX_PRESENCE_QUERIES + 1 }, (_, i) => ({ key: String(i) }))
		await expect(modelPresence(fakeDb(conns), q, deps())).rejects.toThrow(/at most/)
	})

	test("normaliseOllamaTag", () => {
		expect(normaliseOllamaTag("Foo")).toBe("foo:latest")
		expect(normaliseOllamaTag("Foo:Q4")).toBe("foo:q4")
	})
})
