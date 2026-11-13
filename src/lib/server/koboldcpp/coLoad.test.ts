import { describe, expect, test } from "vitest"
import { decideCoLoad, textNeedGib, CO_LOAD_HEADROOM_GIB } from "./coLoad"

const base = { kind: "image" as const, residentOther: "chat.gguf", enabled: true, freeGib: 9.4, needGib: 4 }

describe("decideCoLoad — by measurement, never by guess", () => {
	test("room enough: keeps the other model, and says the figures", () => {
		const a = decideCoLoad(base)
		expect(a.keep).toBe(true)
		expect(a.reason).toBe("Kept the text model loaded: 9.4 GiB free, the image model needs about 4 GiB.")
	})

	test("the headroom counts: need plus one GiB must fit", () => {
		expect(decideCoLoad({ ...base, freeGib: 4 + CO_LOAD_HEADROOM_GIB }).keep).toBe(true)
		const no = decideCoLoad({ ...base, freeGib: 4.9 })
		expect(no.keep).toBe(false)
		expect(no.reason).toMatch(/^Unloaded the text model first: 4.9 GiB free/)
	})

	test("no other model resident: nothing to keep", () => {
		expect(decideCoLoad({ ...base, residentOther: null })).toEqual({ keep: false, reason: "No text model is loaded." })
	})

	test("the admin's switch off: one slot, said so", () => {
		expect(decideCoLoad({ ...base, enabled: false }).reason).toMatch(/switched off/)
	})

	test("no measurement, or no figure for the need: no room, never a guess", () => {
		expect(decideCoLoad({ ...base, freeGib: null }).keep).toBe(false)
		expect(decideCoLoad({ ...base, freeGib: null }).reason).toMatch(/No measure of free graphics memory/)
		expect(decideCoLoad({ ...base, needGib: null }).keep).toBe(false)
		expect(decideCoLoad({ ...base, needGib: null }).reason).toMatch(/No figure for what the image model needs/)
	})

	test("the text direction names the image model as the other", () => {
		const a = decideCoLoad({ kind: "text", residentOther: "sdxl.gguf", enabled: true, freeGib: 12, needGib: 6.5 })
		expect(a).toEqual({ keep: true, reason: "Kept the image model loaded: 12 GiB free, the text model needs about 6.5 GiB." })
	})
})

describe("textNeedGib — weights plus working memory", () => {
	test("a 5 GiB file needs about 6.5 GiB; no size, no figure", () => {
		expect(textNeedGib(5 * 1024 ** 3)).toBe(6.5)
		expect(textNeedGib(null)).toBeNull()
		expect(textNeedGib(0)).toBeNull()
	})
})
