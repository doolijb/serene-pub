import { afterEach, describe, expect, test, vi } from "vitest"
import fs from "node:fs"
import os from "node:os"
import path from "node:path"

vi.mock("$lib/server/db", () => ({ db: {} }))

import { pluginStorageBytes } from "./gather"
import { storageSegment } from "$lib/server/plugins/SandboxManager"

let dir: string | null = null
afterEach(() => {
	if (dir) fs.rmSync(dir, { recursive: true, force: true })
	dir = null
})

describe("pluginStorageBytes", () => {
	test("sums the files under the plugin's storage folder, recursively", () => {
		dir = fs.mkdtempSync(path.join(os.tmpdir(), "sp-plugin-storage-"))
		const root = path.join(dir, "extensions_data", storageSegment("acme.dice"))
		fs.mkdirSync(path.join(root, "sub"), { recursive: true })
		fs.writeFileSync(path.join(root, "a.bin"), Buffer.alloc(10))
		fs.writeFileSync(path.join(root, "sub", "b.bin"), Buffer.alloc(5))
		expect(pluginStorageBytes(dir, "acme.dice")).toBe(15)
	})

	test("a missing folder is null", () => {
		dir = fs.mkdtempSync(path.join(os.tmpdir(), "sp-plugin-storage-"))
		expect(pluginStorageBytes(dir, "acme.none")).toBeNull()
	})
})
