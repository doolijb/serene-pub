/**
 * The IMPORT half of the card-bytes cache split (ruling 2026-09-09).
 *
 * "Image assets do NOT belong in temp and need to be saved to the persistent
 * Serene Pub users data directory. The exception are external search results."
 *
 * Bytes fetched in order to IMPORT a card are not a search result — they become
 * the character's or persona's avatar — so they land under the importing user's
 * own data directory instead of `os.tmpdir()`. The bug that forced the split was
 * observed on a real machine: `/tmp/serene-pub-card-cache` was keyed by
 * `source:ref` alone, so a second Serene Pub instance with its own data
 * directory read cards another instance had fetched, and showed them as its own.
 * These tests pin both halves of the fix — the location, and the per-user
 * isolation that makes the location mean something.
 */
import fs from "fs/promises"
import os from "os"
import path from "path"
import crypto from "crypto"
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest"

let dataDir: string
let tmpDir: string
let previousDataDir: string | undefined

/** Where a key SHOULD land, spelled out here rather than imported, so the test
 *  fails if the layout the ruling named ever changes silently. */
function expectedPath(userId: number, key: string): string {
	return path.join(
		dataDir,
		"data",
		"users",
		String(userId),
		"cache",
		"cards",
		`${crypto.createHash("sha256").update(key).digest("hex")}.png`
	)
}

async function listCards(userId: number): Promise<string[]> {
	return fs
		.readdir(
			path.join(
				dataDir,
				"data",
				"users",
				String(userId),
				"cache",
				"cards"
			)
		)
		.catch(() => [] as string[])
}

beforeEach(async () => {
	// A real directory per test: the module resolves its root through
	// `mediaRoot()` on every call, so pointing the env var at a throwaway tree
	// is enough — no module-level constant to spy around, unlike the browse
	// cache's `os.tmpdir()`-derived CACHE_DIR.
	dataDir = await fs.mkdtemp(
		path.join(os.tmpdir(), "serene-pub-import-cache-test-")
	)
	tmpDir = await fs.mkdtemp(
		path.join(os.tmpdir(), "serene-pub-import-cache-tmp-")
	)
	previousDataDir = process.env.SERENE_PUB_DATA_DIR
	process.env.SERENE_PUB_DATA_DIR = dataDir
	vi.resetModules()
})

afterEach(async () => {
	vi.restoreAllMocks()
	if (previousDataDir === undefined) delete process.env.SERENE_PUB_DATA_DIR
	else process.env.SERENE_PUB_DATA_DIR = previousDataDir
	await fs.rm(dataDir, { recursive: true, force: true })
	await fs.rm(tmpDir, { recursive: true, force: true })
})

describe("import cache — location", () => {
	test("writes the fetched bytes under the importing user's data directory, not the OS temp dir", async () => {
		const { getOrFetchImportedCardBytes } = await import("./importCache")
		const key = "charavault:folder/card.png"

		const bytes = await getOrFetchImportedCardBytes(7, key, async () =>
			Buffer.from("card-bytes")
		)

		expect(bytes.toString()).toBe("card-bytes")
		const written = await fs.readFile(expectedPath(7, key))
		expect(written.toString()).toBe("card-bytes")
	})

	test("resolves inside the data directory even for a key that looks like a traversal — the key is hashed, never a path segment", async () => {
		const { getOrFetchImportedCardBytes } = await import("./importCache")
		const key = "charavault:../../../../etc/passwd"

		await getOrFetchImportedCardBytes(7, key, async () =>
			Buffer.from("nice try")
		)

		const files = await listCards(7)
		expect(files).toEqual([
			`${crypto.createHash("sha256").update(key).digest("hex")}.png`
		])
	})

	test("a second read of the same user's key is served from disk without a second fetch", async () => {
		const { getOrFetchImportedCardBytes } = await import("./importCache")
		let fetches = 0
		const fetcher = async () => {
			fetches++
			return Buffer.from("once")
		}

		await getOrFetchImportedCardBytes(7, "k", fetcher)
		const second = await getOrFetchImportedCardBytes(7, "k", fetcher)

		expect(fetches).toBe(1)
		expect(second.toString()).toBe("once")
	})

	test("concurrent calls for the same user and key share one fetch", async () => {
		const { getOrFetchImportedCardBytes } = await import("./importCache")
		let fetches = 0
		const fetcher = async () => {
			fetches++
			await new Promise((r) => setTimeout(r, 10))
			return Buffer.from("shared")
		}

		const [a, b] = await Promise.all([
			getOrFetchImportedCardBytes(7, "dedup", fetcher),
			getOrFetchImportedCardBytes(7, "dedup", fetcher)
		])

		expect(fetches).toBe(1)
		expect(a.equals(b)).toBe(true)
	})
})

describe("import cache — per-user isolation", () => {
	test("a second user's import of the same ref does not read the first user's file", async () => {
		const { getOrFetchImportedCardBytes } = await import("./importCache")
		const key = "charavault:folder/card.png"

		const first = await getOrFetchImportedCardBytes(7, key, async () =>
			Buffer.from("user-7-bytes")
		)
		const second = await getOrFetchImportedCardBytes(8, key, async () =>
			Buffer.from("user-8-bytes")
		)

		expect(first.toString()).toBe("user-7-bytes")
		// The whole point of the split: same ref, different user, its own fetch
		// and its own file. Under the old shared temp cache this returned
		// "user-7-bytes".
		expect(second.toString()).toBe("user-8-bytes")
		expect((await fs.readFile(expectedPath(7, key))).toString()).toBe(
			"user-7-bytes"
		)
		expect((await fs.readFile(expectedPath(8, key))).toString()).toBe(
			"user-8-bytes"
		)
	})

	test("two users importing the same ref concurrently do not share one fetch", async () => {
		const { getOrFetchImportedCardBytes } = await import("./importCache")
		// Sharing the fetch would be harmless upstream but fatal on disk: the
		// shared body writes exactly one file, so one of the two users would end
		// up with no cached bytes and the other's row would be the only one on
		// disk — the same cross-owner leak, one level up.
		let fetches = 0
		const fetcher = async () => {
			fetches++
			await new Promise((r) => setTimeout(r, 10))
			return Buffer.from(`fetch-${fetches}`)
		}

		await Promise.all([
			getOrFetchImportedCardBytes(7, "same", fetcher),
			getOrFetchImportedCardBytes(8, "same", fetcher)
		])

		expect(fetches).toBe(2)
		expect(await listCards(7)).toHaveLength(1)
		expect(await listCards(8)).toHaveLength(1)
	})
})

describe("import cache — bounded size", () => {
	test("trims the oldest entries once a user's cache passes IMPORT_CACHE_MAX_FILES", async () => {
		const { getOrFetchImportedCardBytes, IMPORT_CACHE_MAX_FILES } =
			await import("./importCache")

		for (let i = 0; i < IMPORT_CACHE_MAX_FILES; i++) {
			await getOrFetchImportedCardBytes(7, `key-${i}`, async () =>
				Buffer.from(`bytes-${i}`)
			)
		}
		expect(await listCards(7)).toHaveLength(IMPORT_CACHE_MAX_FILES)

		// Backdate the first entry so "oldest" is unambiguous — mtime
		// granularity can be coarser than the loop above is fast.
		const oldest = expectedPath(7, "key-0")
		const backdated = new Date(Date.now() - 60 * 60_000)
		await fs.utimes(oldest, backdated, backdated)

		await getOrFetchImportedCardBytes(7, "one-too-many", async () =>
			Buffer.from("newest")
		)

		const remaining = await listCards(7)
		expect(remaining).toHaveLength(IMPORT_CACHE_MAX_FILES)
		expect(remaining).toContain(
			path.basename(expectedPath(7, "one-too-many"))
		)
		expect(remaining).not.toContain(path.basename(oldest))
	})
})

describe("browse cache — still the OS temp dir, under its own name", () => {
	test("external search results keep landing in the OS temp dir, in serene-pub-browse-cache", async () => {
		vi.spyOn(os, "tmpdir").mockReturnValue(tmpDir)
		vi.resetModules()
		const { setCachedCardBytes } = await import("./diskCache")

		await setCachedCardBytes("charavault:thumb", Buffer.from("thumbnail"))

		const files = await fs.readdir(
			path.join(tmpDir, "serene-pub-browse-cache")
		)
		expect(files).toHaveLength(1)
		// And nothing leaked into the user's data directory.
		expect(await listCards(7)).toHaveLength(0)
	})
})
