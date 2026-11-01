import { describe, expect, it } from "vitest"
import { frameAssetsBaseOf } from "./frameOwner"
import { initMessage } from "./framePort"

describe("frameAssetsBaseOf", () => {
	it("reads the versioned plugin src", () => {
		expect(frameAssetsBaseOf("/plugin-ui/acme.x/ui/index.html?v=1.0.0")).toBe("/plugin-assets/acme.x/1.0.0/")
	})
	it("is undefined without a version", () => {
		expect(frameAssetsBaseOf("/plugin-ui/acme.x/ui/index.html")).toBeUndefined()
	})
	it("is undefined for core", () => {
		expect(frameAssetsBaseOf("/plugin-ui/core/ui/index.html?v=1.0.0")).toBeUndefined()
	})
	it("keeps an encoded version encoded", () => {
		expect(frameAssetsBaseOf("/plugin-ui/acme.x/ui/i.html?v=1.0.0-pr.1%2Bb2")).toBe("/plugin-assets/acme.x/1.0.0-pr.1%2Bb2/")
	})
})

describe("initMessage", () => {
	it("carries assetsBase when given", () => {
		expect(initMessage("page", "/plugin-assets/a/1/").assetsBase).toBe("/plugin-assets/a/1/")
	})
	it("has no assetsBase key otherwise", () => {
		expect("assetsBase" in initMessage("page")).toBe(false)
	})
})
