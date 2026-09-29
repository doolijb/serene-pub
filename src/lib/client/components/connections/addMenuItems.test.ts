import { describe, expect, test } from "vitest"
import { addMenuItemKeys, canRunLocalRuntimes } from "./addMenuItems"

describe("the Add menu's items", () => {
	test("offer both local runtimes where this instance can run them", () => {
		expect(
			addMenuItemKeys({ canAddByName: true, canRunLocalRuntimes: true })
		).toEqual(["connection", "koboldcpp", "ollama", "model", "by-name"])
	})

	test("hide KoboldCPP and Ollama in the Android app, as the wizard does", () => {
		const keys = addMenuItemKeys({
			canAddByName: true,
			canRunLocalRuntimes: canRunLocalRuntimes({ isAndroidWrapper: true })
		})
		expect(keys).not.toContain("koboldcpp")
		expect(keys).not.toContain("ollama")
		expect(keys).toEqual(["connection", "model", "by-name"])
	})

	test("drop A model by name when no connection accepts one", () => {
		expect(
			addMenuItemKeys({ canAddByName: false, canRunLocalRuntimes: true })
		).not.toContain("by-name")
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
