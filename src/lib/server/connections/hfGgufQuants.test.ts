import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import {
	clearHfSiblingsCache,
	fetchHfRepoCard,
	fetchHfRepoSiblings,
	hfRepoCardFrom,
	hfRepoReadCached,
	ggufQuantOptions,
	ollamaQuantRows,
	withSiblingSizes
} from "./hfGgufQuants"

const sib = (rfilename: string, size?: number) => ({ rfilename, size })

describe("ggufQuantOptions", () => {
	it("maps quant-labelled ggufs, keeps sizes, drops the rest", () => {
		const out = ggufQuantOptions("a/b", [
			sib("README.md"),
			sib("b-Q4_K_M.gguf", 10),
			sib("b-IQ3_XS.gguf"),
			sib("b-notaquant.gguf")
		])
		expect(out.map((o) => o.label)).toEqual(["Q4_K_M", "IQ3_XS"])
		expect(out[0]).toEqual({
			label: "Q4_K_M",
			filename: "b-Q4_K_M.gguf",
			downloadUrl:
				"https://huggingface.co/a/b/resolve/main/b-Q4_K_M.gguf",
			sizeBytes: 10
		})
		expect(out[1].sizeBytes).toBeUndefined()
	})

	it("never lists a vision projector as a quant (MV)", () => {
		const out = ggufQuantOptions("a/b", [
			sib("b-Q4_K_M.gguf"),
			sib("mmproj-F16.gguf"),
			sib("mmproj-b-Q8_0.gguf"),
			sib("sub/b-mmproj-BF16.gguf")
		])
		expect(out.map((o) => o.filename)).toEqual(["b-Q4_K_M.gguf"])
	})

	it("never lists a speculative-decoding drafter as a quant (MV V2)", () => {
		const out = ggufQuantOptions("unsloth/gemma-4-E4B-it-GGUF", [
			sib("MTP/mtp-gemma-4-E4B-it-BF16.gguf"),
			sib("MTP/mtp-gemma-4-E4B-it-Q8_0.gguf"),
			sib("gemma-4-E4B-it-Q8_0.gguf"),
			sib("smtp-model-Q4_K_M.gguf")
		])
		expect(out.map((o) => o.filename)).toEqual([
			"gemma-4-E4B-it-Q8_0.gguf",
			"smtp-model-Q4_K_M.gguf"
		])
	})
})

describe("withSiblingSizes (MV)", () => {
	it("fills a missing size by file name and keeps a known one", () => {
		const opts = [
			{ label: "Q4_K_M", filename: "b-Q4_K_M.gguf", downloadUrl: "u1" },
			{
				label: "Q8_0",
				filename: "b-Q8_0.gguf",
				downloadUrl: "u2",
				sizeBytes: 5
			},
			{ label: "F16", filename: "b-F16.gguf", downloadUrl: "u3" }
		]
		const out = withSiblingSizes(opts, [
			sib("b-Q4_K_M.gguf", 100),
			sib("b-Q8_0.gguf", 200),
			sib("b-F16.gguf")
		])
		expect(out.map((o) => o.sizeBytes)).toEqual([100, 5, undefined])
	})

	it("leaves the options alone when the repo read failed", () => {
		const opts = [{ label: "Q4_K_M", filename: "x.gguf", downloadUrl: "u" }]
		expect(withSiblingSizes(opts, null)).toBe(opts)
	})
})

describe("ollamaQuantRows", () => {
	it("marks the yaml quant, case-insensitively, and excludes split/mmproj", () => {
		const rows = ollamaQuantRows(
			"g/m-qat-q4_0-gguf",
			[
				sib("m-q4_0.gguf", 5),
				sib("m-Q8_0.gguf", 9),
				sib("mmproj-F16.gguf"),
				sib("m-Q6_K-00001-of-00002.gguf")
			],
			"Q4_0"
		)
		expect(rows.map((r) => r.tag)).toEqual([
			"hf.co/g/m-qat-q4_0-gguf:q4_0",
			"hf.co/g/m-qat-q4_0-gguf:Q8_0"
		])
		expect(rows.map((r) => r.recommended)).toEqual([true, false])
	})
	it("keeps the UD- prefix so the yaml tag round-trips", () => {
		const rows = ollamaQuantRows(
			"u/g-GGUF",
			[sib("g-UD-Q4_K_M.gguf"), sib("g-Q4_K_M.gguf")],
			"UD-Q4_K_M"
		)
		expect(rows.find((r) => r.recommended)?.tag).toBe(
			"hf.co/u/g-GGUF:UD-Q4_K_M"
		)
		expect(rows.filter((r) => r.recommended)).toHaveLength(1)
		// The recommended row IS the UD file, not an appended fallback (MV pin).
		expect(rows.map((r) => [r.label, r.filename])).toEqual([
			["UD-Q4_K_M", "g-UD-Q4_K_M.gguf"],
			["Q4_K_M", "g-Q4_K_M.gguf"]
		])
	})
	it("appends the yaml tag when no file matches", () => {
		const rows = ollamaQuantRows("u/g", [sib("g-Q8_0.gguf")], "Q4_K_M")
		expect(rows.map((r) => [r.label, r.recommended])).toEqual([
			["Q8_0", false],
			["Q4_K_M", true]
		])
	})
})

describe("fetchHfRepoSiblings", () => {
	beforeEach(() => clearHfSiblingsCache())
	afterEach(() => vi.unstubAllGlobals())
	it("returns siblings, caches, and nulls on failure or gating", async () => {
		const f = vi.fn(async (url: string) =>
			url.includes("/ok")
				? {
						ok: true,
						json: async () => ({ siblings: [sib("x-Q4_K_M.gguf")] })
					}
				: url.includes("/gated")
					? {
							ok: true,
							json: async () => ({ gated: "auto", siblings: [] })
						}
					: { ok: false }
		)
		vi.stubGlobal("fetch", f)
		expect(await fetchHfRepoSiblings("a/ok")).toHaveLength(1)
		await fetchHfRepoSiblings("a/ok")
		expect(f).toHaveBeenCalledTimes(1)
		expect(await fetchHfRepoSiblings("a/gated")).toBeNull()
		expect(await fetchHfRepoSiblings("a/bad")).toBeNull()
		vi.stubGlobal("fetch", async () => {
			throw new Error("down")
		})
		expect(await fetchHfRepoSiblings("a/boom")).toBeNull()
	})
})

describe("hfRepoCardFrom", () => {
	it("reads each field", () => {
		expect(
			hfRepoCardFrom({
				cardData: {
					license: "apache-2.0",
					language: ["en", "", "fr"],
					base_model: "a/base"
				},
				gguf: { context_length: 8192 },
				downloads: 5,
				lastModified: "2026-01-01T00:00:00.000Z"
			})
		).toEqual({
			license: "apache-2.0",
			languages: ["en", "fr"],
			contextLength: 8192,
			baseModel: "a/base",
			downloads: 5,
			lastModified: "2026-01-01T00:00:00.000Z"
		})
	})
	it("takes the string and array forms", () => {
		const c = hfRepoCardFrom({
			cardData: {
				license: ["mit", "other"],
				language: "en",
				base_model: ["x/y", "z/w"]
			}
		})
		expect(c.license).toBe("mit, other")
		expect(c.languages).toEqual(["en"])
		expect(c.baseModel).toBe("x/y")
	})
	it("omits unknowns and falls back to the licence tag", () => {
		expect(hfRepoCardFrom({})).toEqual({})
		expect(
			hfRepoCardFrom({
				cardData: { language: [], base_model: [] },
				gguf: { context_length: 0 },
				downloads: -1,
				lastModified: "",
				tags: ["gguf", "license:llama3", "license:mit"]
			})
		).toEqual({ license: "llama3" })
		expect(hfRepoCardFrom(null)).toEqual({})
	})
})

describe("fetchHfRepoCard", () => {
	const body = {
		siblings: [sib("x-Q4_K_M.gguf", 9)],
		downloads: 3,
		cardData: { license: "mit" }
	}
	const stub = (json: any = body) => {
		const f = vi.fn(async () => ({ ok: true, json: async () => json }))
		vi.stubGlobal("fetch", f)
		return f
	}
	beforeEach(() => {
		clearHfSiblingsCache()
		vi.useFakeTimers()
		vi.setSystemTime(new Date("2026-01-01T00:00:00Z"))
	})
	afterEach(() => {
		vi.useRealTimers()
		vi.unstubAllGlobals()
	})

	it("one fetch fills both caches", async () => {
		const f = stub()
		expect(hfRepoReadCached("a/b")).toBe(false)
		const r = await fetchHfRepoCard("a/b")
		expect(r.card).toEqual({ license: "mit", downloads: 3 })
		expect(r.siblings).toHaveLength(1)
		expect(hfRepoReadCached("a/b")).toBe(true)
		expect(await fetchHfRepoSiblings("a/b")).toHaveLength(1)
		await fetchHfRepoCard("a/b")
		expect(f).toHaveBeenCalledTimes(1)
	})

	it("a siblings read first also fills the card", async () => {
		const f = stub()
		await fetchHfRepoSiblings("a/b")
		expect((await fetchHfRepoCard("a/b")).card?.license).toBe("mit")
		expect(f).toHaveBeenCalledTimes(1)
	})

	it("the card outlives the siblings TTL; stale siblings refetch once", async () => {
		const f = stub()
		await fetchHfRepoCard("a/b")
		vi.setSystemTime(Date.now() + 11 * 60 * 1000)
		expect(hfRepoReadCached("a/b")).toBe(false)
		await fetchHfRepoCard("a/b")
		await fetchHfRepoCard("a/b")
		expect(f).toHaveBeenCalledTimes(2)
		vi.setSystemTime(Date.now() + 25 * 60 * 60 * 1000)
		expect(hfRepoReadCached("a/b")).toBe(false)
		await fetchHfRepoCard("a/b")
		expect(f).toHaveBeenCalledTimes(3)
	})

	it("a cached failure answers without HTTP", async () => {
		const f = vi.fn(async () => ({ ok: false }))
		vi.stubGlobal("fetch", f)
		expect(await fetchHfRepoCard("a/bad")).toEqual({
			card: null,
			siblings: null
		})
		expect(hfRepoReadCached("a/bad")).toBe(true)
		await fetchHfRepoCard("a/bad")
		expect(f).toHaveBeenCalledTimes(1)
	})

	it("gated and private repos store no card", async () => {
		for (const extra of [
			{ gated: "auto" },
			{ gated: true },
			{ private: true }
		]) {
			clearHfSiblingsCache()
			stub({ ...body, ...extra })
			expect(await fetchHfRepoCard("a/g")).toEqual({
				card: null,
				siblings: null
			})
			expect(hfRepoReadCached("a/g")).toBe(true)
		}
	})
})
