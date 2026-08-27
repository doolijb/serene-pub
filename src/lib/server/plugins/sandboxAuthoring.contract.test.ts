/**
 * Contract test: the sandbox authoring surface now lives in `@serene-pub/cli`
 * (sandbox = the manifest compiler, sandbox-bundle = the esbuild preset). This
 * pins that the SDK's authoring output is exactly what the app runtime reads and
 * runs — the manifest shape `permissions.ts` interprets, and a bundle both
 * backends can load.
 */
import { describe, it, expect, afterEach } from "vitest"
import { compileManifest } from "@serene-pub/cli/sandbox"
import { bundlePlugin } from "@serene-pub/cli/sandbox-bundle"
import { QuickJsRuntime } from "./QuickJsRuntime"
import { SesWorkerRuntime } from "./SesWorkerRuntime"
import type { PluginRuntime } from "./types"

describe("manifest compiler", () => {
	it("compiles and normalizes a valid declaration", () => {
		const m = compileManifest({
			id: "acme/hello",
			name: "  Hello  ",
			version: "1.2.3",
			hooks: ["onStart", "onStart", "onMessage"], // dedups
			permissions: {
				storage: { quotaBytes: 4096 },
				network: { hosts: ["api.example.com", "api.example.com"] }
			}
		})
		expect(m.name).toBe("Hello")
		expect(m.hooks).toEqual(["onStart", "onMessage"])
		expect(m.permissions.storage?.quotaBytes).toBe(4096)
		expect(m.permissions.network?.hosts).toEqual(["api.example.com"])
		expect(m.sequential).toBe(false)
	})

	it("accepts wildcard network hosts and rejects malformed ones", () => {
		const m = compileManifest({
			id: "acme/scraper",
			name: "Scraper",
			version: "1.0.0",
			permissions: { network: { hosts: ["*.example.com", "*", "api.example.com:8443"] } }
		})
		expect(m.permissions.network?.hosts).toEqual([
			"*.example.com",
			"*",
			"api.example.com:8443"
		])
		for (const bad of ["*.*", "**", "a b.com", "*.", "http://x.com"])
			expect(() =>
				compileManifest({
					id: "a/b",
					name: "x",
					version: "1.0.0",
					permissions: { network: { hosts: [bad] } }
				})
			).toThrow(/host/)
	})

	it("rejects bad id / version / hook / empty network / bad quota", () => {
		expect(() => compileManifest({ id: "NoSlash", name: "x", version: "1.0.0" })).toThrow(/id/)
		expect(() => compileManifest({ id: "a/b", name: "x", version: "1" })).toThrow(/version/)
		expect(() =>
			compileManifest({ id: "a/b", name: "x", version: "1.0.0", hooks: ["1bad"] })
		).toThrow(/identifier/)
		expect(() =>
			compileManifest({
				id: "a/b",
				name: "x",
				version: "1.0.0",
				permissions: { network: { hosts: [] } }
			})
		).toThrow(/hosts/)
		expect(() =>
			compileManifest({
				id: "a/b",
				name: "x",
				version: "1.0.0",
				permissions: { storage: { quotaBytes: 1 } }
			})
		).toThrow(/quota/)
	})
})

const rts: PluginRuntime[] = []
afterEach(async () => {
	await Promise.all(rts.splice(0).map((r) => r.dispose()))
})

describe("bundler", () => {
	it("bundles a plugin the runtime can run — on both backends", async () => {
		// The local helper stands in for a bundled pure-JS dependency.
		const source = `
			function greet(name) { return "hi " + name; }
			module.exports = { hooks: { g: function (input) { return greet(input.name); } } };
		`
		const bundle = await bundlePlugin({ source })
		for (const make of [
			() => new QuickJsRuntime(),
			() => new SesWorkerRuntime()
		]) {
			const rt = make()
			rts.push(rt)
			await rt.load("p", bundle, "h")
			const r = await rt.invoke(
				{ pluginId: "p", hookName: "g" },
				{ input: { name: "Ada" }, timeoutMs: 2000, seedLabel: "s", nowMs: 1 }
			)
			expect(r.ok && r.value).toBe("hi Ada")
		}
	}, 15_000)

	it("refuses a forbidden capability import at build time", async () => {
		await expect(
			bundlePlugin({
				source: `const fs = require("fs"); module.exports = { hooks: {} };`
			})
		).rejects.toThrow(/not available/)
	})
})
