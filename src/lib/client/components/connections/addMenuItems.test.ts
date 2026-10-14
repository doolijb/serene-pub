import { describe, expect, test } from "vitest"
import { addMenuItemKeys, canRunLocalRuntimes } from "./addMenuItems"

describe("the Add menu's items", () => {
	test("offer both local runtimes where this instance can run them", () => {
		expect(addMenuItemKeys({ canRunLocalRuntimes: true })).toEqual([
			"connection",
			"koboldcpp",
			"ollama"
		])
	})

	test("hide KoboldCPP and Ollama in the Android app, as the wizard does", () => {
		const keys = addMenuItemKeys({
			canRunLocalRuntimes: canRunLocalRuntimes({ isAndroidWrapper: true })
		})
		expect(keys).toEqual(["connection"])
	})

	test("add connections only — models are got in the Models view", () => {
		const keys: string[] = addMenuItemKeys({ canRunLocalRuntimes: true })
		expect(keys).not.toContain("model")
		expect(keys).not.toContain("by-name")
	})
})

describe("canRunLocalRuntimes", () => {
	test("is false only for the Android app", () => {
		expect(canRunLocalRuntimes({ isAndroidWrapper: true })).toBe(false)
		expect(canRunLocalRuntimes({ isAndroidWrapper: false })).toBe(true)
	})

	test("reads settings not yet arrived as true, as the wizard does", () => {
		expect(canRunLocalRuntimes(undefined)).toBe(true)
		expect(canRunLocalRuntimes(null)).toBe(true)
		expect(canRunLocalRuntimes({})).toBe(true)
	})
})
