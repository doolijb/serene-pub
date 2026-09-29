/**
 * An authored component's artifact round-trips (C6, P3): core's Stats cloned
 * as it starts (its `source.json`, unedited), compiled by the app's compile
 * service, filed in the component cache and read back, mounts in the SDK's
 * component harness under its own authored owner — not `core` — and draws
 * what core's shipped Stats draws in the same context.
 */
import { afterAll, expect, test } from "vitest"
import { mkdir, mkdtemp, readFile, rm, symlink, writeFile } from "node:fs/promises"
import { realpathSync } from "node:fs"
import { join, resolve } from "node:path"
import { mountComponent, type MountedComponent } from "@serene-pub/cli/testing"
import { compileComponent } from "./compile"
import { readArtifact, writeArtifact } from "./cache"
import { authoredOwnerId, newAuthoredId } from "$lib/shared/widgets/authoredOwner"

const CORE_CATALOG = realpathSync(resolve("node_modules/@serene-pub/core-catalog"))
const dirs: string[] = []
const views: MountedComponent[] = []
afterAll(async () => {
	for (const v of views) await v.unmount().catch(() => {})
	for (const d of dirs) await rm(d, { recursive: true, force: true })
})

const context = {
	session: { id: 7, name: "Proof" },
	settings: {},
	viewer: { userId: 1, isAdmin: false, isGuest: false }
}

/** What a box drew, as text, whitespace folded. */
const drawn = (v: MountedComponent) => (v.root.textContent ?? "").replace(/\s+/g, " ").trim()

test("core's Stats, compiled by the service from its source.json and read back from the cache, mounts as an authored owner and draws what core's draws", async () => {
	const doc = JSON.parse(await readFile(join(CORE_CATALOG, "dist/components/stats.source.json"), "utf8")) as {
		files: Record<string, string>
		entry: string
		framework: "svelte"
	}
	const built = await compileComponent({ files: doc.files, entry: doc.entry, framework: doc.framework })
	expect(built.errors).toEqual([])

	const id = newAuthoredId()
	await writeArtifact(id, built.hash, built.code)
	const code = await readArtifact(id, built.hash)
	expect(code).toBe(built.code)

	// The harness mounts a module from a package directory; the artifact is self-contained.
	const base = resolve("node_modules/.cache")
	await mkdir(base, { recursive: true })
	const dir = await mkdtemp(join(base, "sp-c6-authored-"))
	dirs.push(dir)
	await writeFile(join(dir, "package.json"), JSON.stringify({ name: "c6-authored-fixture", type: "module" }))
	await symlink(resolve("node_modules"), join(dir, "node_modules"))
	await writeFile(join(dir, "stats.mjs"), code!)

	// Its reviewed scope, as the page grants it: a box not granted `session:state`
	// now draws "not granted" rather than loading (the scope signal).
	const clone = await mountComponent({ root: dir, entry: "stats.mjs", owner: authoredOwnerId(id), grants: ["session:state"], timeoutMs: 60_000, context })
	views.push(clone)
	const core = await mountComponent({ root: CORE_CATALOG, entry: "dist/components/stats.js", owner: "core", timeoutMs: 60_000, context })
	views.push(core)
	await clone.settle()
	await core.settle()

	expect(clone.errors).toEqual([])
	expect(clone.refused).toEqual([])
	expect(drawn(clone)).not.toBe("")
	expect(clone.root.querySelector("[data-state-widget='stats']")).not.toBeNull()
	expect(drawn(clone)).toBe(drawn(core))
}, 180_000)
