import { afterEach, describe, expect, test, vi } from "vitest"
import {
	DEFAULT_MODELS_GROUP_BY,
	MODELS_GROUP_BY,
	MODELS_GROUP_BY_KEY,
	parseModelsGroupBy,
	readModelsGroupBy,
	writeModelsGroupBy
} from "./modelsGroupBy"

afterEach(() => vi.unstubAllGlobals())

describe("parseModelsGroupBy", () => {
	test("each value parses to itself", () => {
		for (const g of MODELS_GROUP_BY)
			expect(parseModelsGroupBy(g.value)).toBe(g.value)
	})
	test("junk, empty and null fall back to the default", () => {
		expect(parseModelsGroupBy("sideways")).toBe(DEFAULT_MODELS_GROUP_BY)
		expect(parseModelsGroupBy("")).toBe(DEFAULT_MODELS_GROUP_BY)
		expect(parseModelsGroupBy(null)).toBe(DEFAULT_MODELS_GROUP_BY)
		expect(parseModelsGroupBy(undefined)).toBe(DEFAULT_MODELS_GROUP_BY)
	})
	test("the default is Where it lives", () => {
		expect(DEFAULT_MODELS_GROUP_BY).toBe("where")
	})
})

describe("readModelsGroupBy / writeModelsGroupBy", () => {
	test("reads the stored value", () => {
		const getItem = vi.fn(() => "can-do")
		vi.stubGlobal("localStorage", { getItem, setItem: vi.fn() })
		expect(readModelsGroupBy()).toBe("can-do")
		expect(getItem).toHaveBeenCalledWith(MODELS_GROUP_BY_KEY)
	})
	test("a stored non-value reads as the default", () => {
		vi.stubGlobal("localStorage", { getItem: () => "x", setItem: vi.fn() })
		expect(readModelsGroupBy()).toBe(DEFAULT_MODELS_GROUP_BY)
	})
	test("storage that throws reads as the default", () => {
		vi.stubGlobal("localStorage", {
			getItem: () => {
				throw new Error("blocked")
			}
		})
		expect(readModelsGroupBy()).toBe(DEFAULT_MODELS_GROUP_BY)
	})
	test("no storage at all reads as the default", () => {
		vi.stubGlobal("localStorage", undefined)
		expect(readModelsGroupBy()).toBe(DEFAULT_MODELS_GROUP_BY)
	})
	test("writes under the key", () => {
		const setItem = vi.fn()
		vi.stubGlobal("localStorage", { getItem: vi.fn(), setItem })
		writeModelsGroupBy("connection")
		expect(setItem).toHaveBeenCalledWith(MODELS_GROUP_BY_KEY, "connection")
	})
	test("a write that throws is swallowed", () => {
		vi.stubGlobal("localStorage", {
			setItem: () => {
				throw new Error("blocked")
			}
		})
		expect(() => writeModelsGroupBy("where")).not.toThrow()
	})
})
