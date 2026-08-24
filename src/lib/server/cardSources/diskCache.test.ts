/**
 * Round-15 audit fix: diskCache.ts's fs operations (the hourly sweep's
 * fan-out over the whole cache directory, and per-thumbnail reads/writes)
 * were uncapped, able to fire far more concurrent fs calls than Node's
 * libuv thread pool has threads for — real OS-level disk contention that a
 * synchronous PGlite query can get stuck behind, per this session's
 * investigation. fsLimit() bounds this subsystem's own concurrency to a
 * small fixed ceiling (FS_CONCURRENCY_LIMIT = 2). These tests intercept the
 * real fs.* calls with controllable gates so concurrency can be observed
 * precisely, rather than inferred from timing on a real (fast) filesystem.
 */
import fs from "fs/promises"
import os from "os"
import path from "path"
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest"

function deferred<T>() {
	let resolve!: (value: T) => void
	const promise = new Promise<T>((res) => {
		resolve = res
	})
	return { promise, resolve }
}

describe("diskCache — fs concurrency limit", () => {
	afterEach(() => {
		vi.restoreAllMocks()
		vi.resetModules()
	})

	test("caps concurrent fs operations at FS_CONCURRENCY_LIMIT (2), admitting a queued one only once an active one finishes", async () => {
		const pendingResolvers: Array<() => void> = []
		const statSpy = vi.spyOn(fs, "stat").mockImplementation(
			() =>
				new Promise((resolve) => {
					pendingResolvers.push(() => resolve({ mtimeMs: 0 } as any))
				})
		)

		const { getCachedCardBytes } = await import("./diskCache")

		// Fire 4 concurrent calls — each starts with fs.stat, and (since
		// mtimeMs: 0 makes every one look expired) returns null without
		// ever reaching fs.readFile.
		const promises = [1, 2, 3, 4].map((i) =>
			getCachedCardBytes(`concurrency-key-${i}`)
		)

		await vi.waitFor(() =>
			expect(pendingResolvers.length).toBeGreaterThan(0)
		)
		// Give any (incorrect) extra admissions a moment to happen before
		// asserting the cap held.
		await new Promise((r) => setTimeout(r, 20))
		expect(pendingResolvers.length).toBe(2)

		// Release one — a third should now be admitted.
		pendingResolvers[0]()
		await vi.waitFor(() => expect(pendingResolvers.length).toBe(3))

		// Release the rest so the test doesn't leave anything hanging.
		pendingResolvers[1]()
		pendingResolvers[2]()
		await vi.waitFor(() => expect(pendingResolvers.length).toBe(4))
		pendingResolvers[3]()

		const results = await Promise.all(promises)
		expect(results).toEqual([null, null, null, null])
		expect(statSpy).toHaveBeenCalledTimes(4)
	})

	test("getCachedCardBytes and setCachedCardBytes share ONE combined limit, not separate ones per function", async () => {
		const pendingResolvers: Array<() => void> = []
		const gate = () =>
			new Promise<any>((resolve) => {
				pendingResolvers.push(() => resolve({ mtimeMs: 0 } as any))
			})
		vi.spyOn(fs, "stat").mockImplementation(gate)
		vi.spyOn(fs, "mkdir").mockImplementation(gate as any)
		vi.spyOn(fs, "writeFile").mockImplementation(gate as any)

		const { getCachedCardBytes, setCachedCardBytes } = await import(
			"./diskCache"
		)

		// 2 getCachedCardBytes calls (fs.stat) + 1 setCachedCardBytes call
		// (fs.mkdir then fs.writeFile) — 3 requests against a limit of 2,
		// mixing two different exported entry points.
		const p1 = getCachedCardBytes("mixed-key-1")
		const p2 = getCachedCardBytes("mixed-key-2")
		const p3 = setCachedCardBytes("mixed-key-3", Buffer.from("x"))

		await vi.waitFor(() =>
			expect(pendingResolvers.length).toBeGreaterThan(0)
		)
		await new Promise((r) => setTimeout(r, 20))
		expect(pendingResolvers.length).toBe(2) // combined cap, not 2-per-function

		// Release the first getCachedCardBytes's stat (index 0) — it
		// completes (stale mtimeMs -> null, no readFile reached), freeing a
		// slot. The third request (setCachedCardBytes, a DIFFERENT function)
		// should now be admitted and start its own fs.mkdir call — proving
		// the two functions draw from one shared limit, not one each.
		pendingResolvers[0]()
		await vi.waitFor(() => expect(pendingResolvers.length).toBe(3))

		// Release the second getCachedCardBytes's stat (index 1) — it also
		// completes. Nothing is left queued at this point (setCachedCardBytes
		// is already active), so no new gate appears yet.
		pendingResolvers[1]()
		await p1
		await p2
		expect(pendingResolvers.length).toBe(3)

		// Release setCachedCardBytes's mkdir (index 2) — its body proceeds
		// to fs.writeFile, creating a fourth gate.
		pendingResolvers[2]()
		await vi.waitFor(() => expect(pendingResolvers.length).toBe(4))

		// Release the final writeFile gate — setCachedCardBytes completes.
		pendingResolvers[3]()
		await p3
	})
})

describe("diskCache — behavior preserved through the concurrency-limiter refactor (real fs, no mocking)", () => {
	let dataDir: string

	beforeEach(async () => {
		// CACHE_DIR is a module-level constant computed once from
		// os.tmpdir() — without isolating it per test, every run of this
		// suite would read/write the SAME real, persistent directory on
		// disk (confirmed the hard way: an earlier version of this file
		// leaked real files there across repeated runs this session,
		// causing later runs to see "stale" cache hits from minutes
		// earlier). Spying on os.tmpdir() before a fresh import forces
		// diskCache.ts's own CACHE_DIR computation to land inside a
		// throwaway per-test directory instead.
		dataDir = await fs.mkdtemp(
			path.join(os.tmpdir(), "serene-pub-diskcache-behavior-test-")
		)
		vi.spyOn(os, "tmpdir").mockReturnValue(dataDir)
		vi.resetModules()
	})

	afterEach(async () => {
		vi.restoreAllMocks()
		vi.useRealTimers()
		await fs.rm(dataDir, { recursive: true, force: true })
	})

	test("cache miss returns null, a write followed by a read round-trips the same bytes", async () => {
		const { getCachedCardBytes, setCachedCardBytes } = await import(
			"./diskCache"
		)
		const key = "round-trip-key"

		expect(await getCachedCardBytes(key)).toBeNull()

		const data = Buffer.from("hello disk cache")
		await setCachedCardBytes(key, data)

		const read = await getCachedCardBytes(key)
		expect(read).not.toBeNull()
		expect(read!.equals(data)).toBe(true)
	})

	test("an entry older than ttlMs is treated as a miss", async () => {
		const { getCachedCardBytes, setCachedCardBytes } = await import(
			"./diskCache"
		)
		const key = "stale-key"
		await setCachedCardBytes(key, Buffer.from("data"))

		// ttlMs: 0 (or any value close to the actual elapsed time) is too
		// tight a margin — filesystem mtime granularity can be coarser than
		// Date.now()'s millisecond precision, making "elapsed > ttlMs" land
		// right on the boundary and flake depending on system load/timing.
		// A real, generous wait plus a ttlMs well under it removes any
		// ambiguity.
		await new Promise((r) => setTimeout(r, 50))
		expect(await getCachedCardBytes(key, 5)).toBeNull()
		// The same entry is still fresh under a normal TTL.
		expect(await getCachedCardBytes(key, 24 * 60 * 60_000)).not.toBeNull()
	})

	test("concurrent getOrFetchCardBytes calls for the same not-yet-cached key share one fetcher call", async () => {
		const { getOrFetchCardBytes } = await import("./diskCache")
		let fetchCount = 0
		const fetcher = async () => {
			fetchCount++
			await new Promise((r) => setTimeout(r, 10))
			return Buffer.from("shared-fetch-result")
		}

		const [a, b] = await Promise.all([
			getOrFetchCardBytes("dedup-key", fetcher),
			getOrFetchCardBytes("dedup-key", fetcher)
		])

		expect(fetchCount).toBe(1)
		expect(a.equals(b)).toBe(true)
	})

	test("hourly sweep uses IMAGE_TTL_MS (the longest active TTL), not the shorter DEFAULT_TTL_MS — an entry past the default but within the image TTL survives a sweep pass", async () => {
		// The image-proxy route reads with IMAGE_TTL_MS (30 days), well past
		// the general-purpose DEFAULT_TTL_MS (24h) every other caller uses.
		// If the sweep still compared against DEFAULT_TTL_MS, it would
		// physically delete a 25-hour-old image cache file from disk even
		// though a read for it would still consider it fresh — silently
		// undermining the longer TTL. Enable fake timers before importing so
		// the setInterval(..., SWEEP_INTERVAL_MS) registered at module load
		// is the one this test controls.
		vi.useFakeTimers()
		const { setCachedCardBytes, IMAGE_TTL_MS } = await import("./diskCache")

		const survivorKey = "past-default-ttl-within-image-ttl"
		const evictedKey = "past-image-ttl"
		await setCachedCardBytes(survivorKey, Buffer.from("survivor"))
		await setCachedCardBytes(evictedKey, Buffer.from("evicted"))

		const cacheDir = path.join(dataDir, "serene-pub-card-cache")
		const files = await fs.readdir(cacheDir)
		expect(files.length).toBe(2)

		// Backdate mtimes directly rather than waiting or faking Date.now()
		// — the sweep compares real Date.now() against each file's real
		// mtime, so this is the precise, non-flaky way to simulate age.
		const now = Date.now()
		const pastDefaultOnly = new Date(now - 25 * 60 * 60_000) // 25h: past DEFAULT_TTL_MS (24h), well within IMAGE_TTL_MS (30d)
		const pastImageTtl = new Date(now - (IMAGE_TTL_MS + 60 * 60_000)) // 30d + 1h: past IMAGE_TTL_MS

		for (const name of files) {
			const filePath = path.join(cacheDir, name)
			const content = await fs.readFile(filePath, "utf8")
			const targetTime =
				content === "survivor" ? pastDefaultOnly : pastImageTtl
			await fs.utimes(filePath, targetTime, targetTime)
		}

		// SWEEP_INTERVAL_MS is 60 * 60_000 (1h), not exported — matching how
		// the "entry older than ttlMs" test above also hardcodes
		// DEFAULT_TTL_MS's value rather than importing it.
		await vi.advanceTimersByTimeAsync(60 * 60_000 + 1000)

		// The setInterval callback fires sweepStaleCacheFiles() without
		// awaiting it (fire-and-forget, so a slow sweep never blocks the
		// timer), so advanceTimersByTimeAsync's own microtask-flush loop
		// isn't guaranteed to wait for that detached promise chain (several
		// fs calls deep, through fsLimit's queue) to fully settle. Switch to
		// real timers and poll for the expected end state instead of
		// asserting immediately.
		vi.useRealTimers()
		await vi.waitFor(async () => {
			const remaining = await fs.readdir(cacheDir)
			expect(remaining.length).toBe(1)
		})

		const remaining = await fs.readdir(cacheDir)
		const remainingContent = await fs.readFile(
			path.join(cacheDir, remaining[0]),
			"utf8"
		)
		expect(remainingContent).toBe("survivor")
	})
})
