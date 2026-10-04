/**
 * The runtime file (CONTRACT §C2): its shape, an atomic 0600 write, and a
 * removal that only ever deletes this process's own file.
 */
import fs from "node:fs"
import os from "node:os"
import path from "node:path"
import { afterEach, beforeEach, describe, expect, test } from "vitest"
import {
	buildRuntimeRecord,
	controlHostFor,
	processIdentity,
	removeRuntimeFileIfOwn,
	RUNTIME_FILE_NAME,
	writeRuntimeFile
} from "./runtimeFile"

let dir: string
beforeEach(() => {
	dir = fs.mkdtempSync(path.join(os.tmpdir(), "sp-runtime-"))
})
afterEach(() => {
	fs.rmSync(dir, { recursive: true, force: true })
})

const identity = { token: "f".repeat(64), startedAt: "2026-10-01T12:00:00.000Z" }

describe("buildRuntimeRecord", () => {
	test("carries every §C2 key", () => {
		const record = buildRuntimeRecord({
			pid: 12345,
			port: 3000,
			host: "0.0.0.0",
			version: "0.6.1",
			isPrerelease: false,
			dataDir: dir,
			identity,
			env: {
				SERENE_PUB_INSTALL_ROOT: "/opt/serene-pub",
				SERENE_PUB_LAUNCHER_VERSION: "0.6.1",
				SERENE_PUB_UPDATE_CHANNEL: "portable"
			}
		})
		expect(record).toEqual({
			schema: 1,
			pid: 12345,
			port: 3000,
			host: "0.0.0.0",
			controlUrl: "http://127.0.0.1:3000",
			openUrl: "http://localhost:3000",
			version: "0.6.1",
			isPrerelease: false,
			token: identity.token,
			startedAt: identity.startedAt,
			dataDir: path.resolve(dir),
			installRoot: path.resolve("/opt/serene-pub"),
			launcherVersion: "0.6.1",
			channel: "portable"
		})
	})

	test("a bare start has null launcher fields", () => {
		const record = buildRuntimeRecord({
			pid: 1,
			port: 3000,
			host: undefined,
			version: "0.6.1",
			isPrerelease: false,
			dataDir: dir,
			identity,
			env: {}
		})
		expect(record.installRoot).toBeNull()
		expect(record.launcherVersion).toBeNull()
		expect(record.channel).toBeNull()
		expect(record.host).toBe("0.0.0.0")
	})

	test("the token is 64 lowercase hex and stable for the process", () => {
		const a = processIdentity()
		expect(a.token).toMatch(/^[0-9a-f]{64}$/)
		expect(processIdentity()).toBe(a)
	})
})

describe("controlHostFor", () => {
	test.each([
		[undefined, "127.0.0.1"],
		["", "127.0.0.1"],
		["0.0.0.0", "127.0.0.1"],
		["::", "127.0.0.1"],
		["127.0.0.5", "127.0.0.1"],
		["::1", "127.0.0.1"],
		["localhost", "127.0.0.1"],
		["192.168.1.5", "192.168.1.5"],
		["fd00::5", "[fd00::5]"]
	])("%j → %s", (bound, expected) => {
		expect(controlHostFor(bound)).toBe(expected)
	})
})

describe("writeRuntimeFile", () => {
	const record = () =>
		buildRuntimeRecord({
			pid: 4242,
			port: 3000,
			host: "0.0.0.0",
			version: "0.6.1",
			isPrerelease: false,
			dataDir: dir,
			identity,
			env: {}
		})

	test("writes atomically, mode 0600, leaving no temp file", () => {
		const file = writeRuntimeFile(dir, record())
		expect(file).toBe(path.join(dir, RUNTIME_FILE_NAME))
		expect(JSON.parse(fs.readFileSync(file, "utf8")).pid).toBe(4242)
		if (process.platform !== "win32") expect(fs.statSync(file).mode & 0o777).toBe(0o600)
		expect(fs.readdirSync(dir)).toEqual([RUNTIME_FILE_NAME])
	})

	test("overwrites a stale file, and tightens a stale temp file's mode", () => {
		fs.writeFileSync(path.join(dir, RUNTIME_FILE_NAME), JSON.stringify({ pid: 1 }), { mode: 0o644 })
		fs.writeFileSync(path.join(dir, `${RUNTIME_FILE_NAME}.4242.tmp`), "junk", { mode: 0o666 })
		const file = writeRuntimeFile(dir, record())
		expect(JSON.parse(fs.readFileSync(file, "utf8")).pid).toBe(4242)
		if (process.platform !== "win32") expect(fs.statSync(file).mode & 0o777).toBe(0o600)
	})

	test("creates the data directory when it is missing", () => {
		const nested = path.join(dir, "a", "b")
		writeRuntimeFile(nested, record())
		expect(fs.existsSync(path.join(nested, RUNTIME_FILE_NAME))).toBe(true)
	})
})

describe("removeRuntimeFileIfOwn", () => {
	test("removes the file only when it names this pid", () => {
		const file = path.join(dir, RUNTIME_FILE_NAME)
		fs.writeFileSync(file, JSON.stringify({ pid: 999 }))
		expect(removeRuntimeFileIfOwn(dir, 4242)).toBe(false)
		expect(fs.existsSync(file)).toBe(true)
		expect(removeRuntimeFileIfOwn(dir, 999)).toBe(true)
		expect(fs.existsSync(file)).toBe(false)
	})

	test("a missing or unreadable file is left alone", () => {
		expect(removeRuntimeFileIfOwn(dir, 1)).toBe(false)
		fs.writeFileSync(path.join(dir, RUNTIME_FILE_NAME), "{not json")
		expect(removeRuntimeFileIfOwn(dir, 1)).toBe(false)
	})
})
