import { describe, expect, it } from "vitest"
import { strToU8, zipSync } from "fflate"
import { readPackageManifest } from "./packageManifest"

const manifest = JSON.stringify({ slug: "acme-lab", permissions: ["storage"] })
const blob = (files: Record<string, Uint8Array>, level?: 0 | 6) =>
	new Blob([zipSync(files, level === undefined ? {} : { level }) as BlobPart])

describe("readPackageManifest", () => {
	it("reads a deflated root manifest", async () => {
		const big = JSON.stringify({ slug: "acme-lab", pad: "x".repeat(5000) })
		const r = await readPackageManifest(
			blob({ "dist/plugin/manifest.json": strToU8(big) })
		)
		expect(r.ok && r.manifest.slug).toBe("acme-lab")
	})

	it("reads a stored root manifest", async () => {
		const r = await readPackageManifest(
			blob({ "dist/plugin/manifest.json": strToU8(manifest) }, 0)
		)
		expect(r.ok && r.manifest.slug).toBe("acme-lab")
	})

	it("reads a manifest wrapped in one folder", async () => {
		const r = await readPackageManifest(
			blob({
				"acme-lab/dist/plugin/manifest.json": strToU8(manifest),
				"acme-lab/README.md": strToU8("hi")
			})
		)
		expect(r.ok && r.manifest.slug).toBe("acme-lab")
	})

	it("finds none under two top-level folders", async () => {
		const r = await readPackageManifest(
			blob({
				"a/dist/plugin/manifest.json": strToU8(manifest),
				"b/readme.txt": strToU8("hi")
			})
		)
		expect(r).toEqual({
			ok: false,
			problem: "There's no dist/plugin/manifest.json in this zip."
		})
	})

	it("reports a missing manifest", async () => {
		const r = await readPackageManifest(
			blob({ "readme.txt": strToU8("hi") })
		)
		expect(r).toEqual({
			ok: false,
			problem: "There's no dist/plugin/manifest.json in this zip."
		})
	})

	it("reports invalid JSON", async () => {
		const r = await readPackageManifest(
			blob({ "dist/plugin/manifest.json": strToU8("{nope") })
		)
		expect(r).toEqual({
			ok: false,
			problem: "The manifest in this zip isn't valid JSON."
		})
	})

	it("reports a non-object manifest", async () => {
		const r = await readPackageManifest(
			blob({ "dist/plugin/manifest.json": strToU8("[1]") })
		)
		expect(r.ok).toBe(false)
	})

	it("reports random bytes as not a zip", async () => {
		const bytes = new Uint8Array(2000).map((_, i) => (i * 37) % 251)
		const r = await readPackageManifest(new Blob([bytes]))
		expect(r).toEqual({
			ok: false,
			problem: "That file isn't a readable zip."
		})
	})
})
