import { describe, it, expect, beforeEach, afterEach } from "vitest"
import fs from "fs"
import os from "os"
import path from "path"
import { createRequire } from "module"
import { permissionKey, rowQuotaFor, STORAGE_HOST_SOURCE } from "./storageHost"

/**
 * The storage host, evaluated exactly as a worker evaluates it — and above all
 * the transaction, because that is what makes a forced kill safe. The claims
 * under test are the ones an author and an admin each rely on: a call sees its
 * own uncommitted writes, an un-committed call leaves the directory
 * byte-identical, and the quota is answered against what the call *will* hold
 * rather than what the disk currently does.
 */

interface Usage {
	quotaBytes: number
	usedBytes: number
	availableBytes: number
	rowBytes: number
	fileBytes: number
}
type Res<T> = { kind: "ok"; value: T } | { kind: "err"; reason: string }
interface Receipt {
	deltaBytes: number
	usage: Usage
}
interface FileEntry {
	path: string
	bytes: number
	updatedAt: string
}
interface StorageApi {
	// The SDK's ExtensionStorage (sdk/src/storage.ts), in its pre-adapter form:
	// synchronous, and with file bytes as base64. The prelude's `__wrapStorage`
	// is what turns this into the promise-returning, Uint8Array-carrying object
	// a hook actually holds.
	usage(): Usage
	get(key: string): unknown
	keys(prefix?: string): string[]
	query(q?: Record<string, unknown>): {
		rows: {
			key: string
			value: unknown
			bytes: number
			updatedAt: string
		}[]
		nextCursor?: string
	}
	put(key: string, value: unknown): Res<Receipt>
	delete(key: string): Res<Receipt>
	deleteAll(prefix?: string): Res<{ removed: number; usage: Usage }>
	files: {
		list(prefix?: string): FileEntry[]
		stat(rel: string): FileEntry | null
		read(rel: string): Res<string>
		write(rel: string, b64: string): Res<Receipt>
		delete(rel: string): Res<Receipt>
		deleteAll(prefix?: string): Res<{ removed: number; usage: Usage }>
	}
	// The older spelling, unchanged.
	read(rel: string): string | null
	write(rel: string, data: unknown): boolean
	exists(rel: string): boolean
	remove(rel: string): boolean
	list(rel?: string): string[]
	size(): number
}
type RowChange =
	| {
			op: "put"
			key: string
			value: unknown
			bytes: number
			updatedAt: string
	  }
	| { op: "delete"; key: string }
interface StorageTx {
	api: StorageApi
	commit(): RowChange[]
	discard(): void
}
interface RowSeed {
	key: string
	value: unknown
	bytes: number
	updatedAt: string
}

/** Evaluate the embedded source exactly as a worker would, and hand back the factory. */
function loadMakeStorageHost() {
	const req = createRequire(import.meta.url)
	const shim: { exports: unknown } = { exports: null }
	new Function(
		"require",
		"module",
		STORAGE_HOST_SOURCE + "\nmodule.exports = makeStorageHost;"
	)(req, shim)
	return shim.exports as (
		config: {
			storageDir: string
			quotaBytes: number
			rowQuotaBytes?: number
		},
		rows?: RowSeed[],
		nowMs?: number
	) => StorageTx
}

const makeStorageHost = loadMakeStorageHost()

let dir: string
beforeEach(() => {
	dir = fs.mkdtempSync(path.join(os.tmpdir(), "sp-storage-host-"))
})
afterEach(() => {
	fs.rmSync(dir, { recursive: true, force: true })
})

/** A fresh transaction over the shared temp dir — one per simulated call. */
function open(quotaBytes = 1000): StorageTx {
	return makeStorageHost({ storageDir: dir, quotaBytes })
}

/** The call's pinned clock, so a row's updatedAt is a fact a test can assert. */
const NOW = Date.parse("2026-01-02T03:04:05.000Z")
const NOW_ISO = "2026-01-02T03:04:05.000Z"

/** A transaction seeded with rows, as the host hands them in. */
function openRows(
	rows: RowSeed[] = [],
	cfg: { quotaBytes?: number; rowQuotaBytes?: number } = {}
): StorageTx {
	return makeStorageHost(
		{
			storageDir: dir,
			quotaBytes: cfg.quotaBytes ?? 100_000,
			rowQuotaBytes: cfg.rowQuotaBytes ?? 10_000
		},
		rows,
		NOW
	)
}

/** A row as the host would have loaded it. `bytes` is recomputed in the store,
 *  so the seeded number is deliberately wrong here and never believed. */
function seed(
	key: string,
	value: unknown,
	updatedAt = "2020-01-01T00:00:00.000Z"
): RowSeed {
	return { key, value, bytes: 999, updatedAt }
}

/** Every byte under a directory, so "byte-identical" is a thing a test can assert. */
function tree(root: string): Record<string, string> {
	const out: Record<string, string> = {}
	const walk = (d: string, prefix: string) => {
		if (!fs.existsSync(d)) return
		for (const e of fs.readdirSync(d, { withFileTypes: true })) {
			const rel = prefix ? prefix + "/" + e.name : e.name
			if (e.isDirectory()) walk(path.join(d, e.name), rel)
			else out[rel] = fs.readFileSync(path.join(d, e.name), "utf8")
		}
	}
	walk(root, "")
	return out
}

describe("storage host", () => {
	it("write → read round-trips, missing → null", () => {
		const { api } = open()
		expect(api.read("a.json")).toBeNull()
		api.write("a.json", '{"x":1}')
		expect(api.read("a.json")).toBe('{"x":1}')
	})

	it("commits nested dirs and leaves no stray temp file", () => {
		const tx = open()
		tx.api.write("nested/deep/b.txt", "hi")
		expect(tx.api.read("nested/deep/b.txt")).toBe("hi")
		tx.commit()
		expect(
			fs.readFileSync(path.join(dir, "nested/deep/b.txt"), "utf8")
		).toBe("hi")
		expect(Object.keys(tree(dir))).toEqual(["nested/deep/b.txt"])
	})

	it("list, exists, remove, size", () => {
		const tx = open()
		tx.api.write("a.json", "xx")
		expect(tx.api.exists("a.json")).toBe(true)
		expect(tx.api.list()).toContain("a.json")
		expect(tx.api.size()).toBe(2)
		tx.api.remove("a.json")
		expect(tx.api.exists("a.json")).toBe(false)
		expect(tx.api.size()).toBe(0)
	})

	it("jails traversal, absolute paths, and empty paths", () => {
		const { api } = open()
		expect(() => api.read("../escape.txt")).toThrow(/escape/)
		expect(() => api.write("../../etc/passwd", "x")).toThrow(/escape/)
		expect(() => api.read(path.resolve(dir, "..", "x"))).toThrow(/escape/)
		expect(() => api.read("")).toThrow(/path is required/)
	})

	it("enforces the quota", () => {
		const tx = open()
		const big = "x".repeat(2000) // > 1000-byte quota
		expect(() => tx.api.write("big.txt", big)).toThrow(/quota/)
		// a within-quota write still works
		tx.api.write("ok.txt", "x".repeat(100))
		expect(tx.api.read("ok.txt")).toHaveLength(100)
	})
})

describe("storage transaction", () => {
	it("touches nothing on disk until it commits — not even the root dir", () => {
		fs.rmSync(dir, { recursive: true, force: true })
		const tx = open()
		tx.api.write("a.txt", "1")
		tx.api.write("sub/b.txt", "2")
		// The grant dir is created by the commit, never by a call that is about
		// to be killed: "byte-identical" has to include "did not appear".
		expect(fs.existsSync(dir)).toBe(false)
		tx.commit()
		expect(tree(dir)).toEqual({ "a.txt": "1", "sub/b.txt": "2" })
	})

	it("a discarded call leaves the directory byte-identical", () => {
		const seed = open()
		seed.api.write("keep.txt", "original")
		seed.api.write("sub/also.txt", "kept")
		seed.commit()
		const before = tree(dir)

		const killed = open()
		killed.api.write("keep.txt", "clobbered")
		killed.api.write("new.txt", "should never exist")
		killed.api.remove("sub")
		// Everything the doomed call believes, and none of it on disk.
		expect(killed.api.read("keep.txt")).toBe("clobbered")
		expect(killed.api.exists("sub/also.txt")).toBe(false)
		expect(tree(dir)).toEqual(before)

		killed.discard()
		expect(tree(dir)).toEqual(before)
	})

	it("commits writes and removes together", () => {
		const seed = open()
		seed.api.write("gone.txt", "x")
		seed.api.write("stays.txt", "y")
		seed.commit()

		const tx = open()
		tx.api.remove("gone.txt")
		tx.api.write("added.txt", "z")
		tx.commit()
		expect(tree(dir)).toEqual({ "stays.txt": "y", "added.txt": "z" })
	})

	it("resolves write-then-remove and remove-then-write by order", () => {
		const seed = open()
		seed.api.write("d/a.txt", "a")
		seed.api.write("d/b.txt", "b")
		seed.commit()

		// remove of a directory, then a write back into it: the write survives,
		// its siblings do not.
		const tx = open()
		tx.api.remove("d")
		tx.api.write("d/b.txt", "reborn")
		expect(tx.api.exists("d/a.txt")).toBe(false)
		expect(tx.api.list("d")).toEqual(["b.txt"])
		tx.commit()
		expect(tree(dir)).toEqual({ "d/b.txt": "reborn" })

		// the other order: the remove came last, so it wins
		const tx2 = open()
		tx2.api.write("d/c.txt", "c")
		tx2.api.remove("d")
		expect(tx2.api.exists("d/c.txt")).toBe(false)
		tx2.commit()
		expect(tree(dir)).toEqual({})
	})

	it("wipes the store without eating its own staged bytes", () => {
		const seed = open()
		seed.api.write("old.txt", "old")
		seed.commit()

		const tx = open()
		tx.api.remove(".") // the whole root
		tx.api.write("fresh.txt", "new")
		tx.commit()
		expect(tree(dir)).toEqual({ "fresh.txt": "new" })
	})

	it("charges the quota against the buffer, at the write that overruns it", () => {
		const tx = open(1000)
		tx.api.write("a.txt", "x".repeat(600))
		// On-disk this directory is empty; the quota is answered against what
		// the call will hold, so this fails HERE rather than at a commit where
		// the hook is gone and nothing can be done about it.
		expect(() => tx.api.write("b.txt", "y".repeat(600))).toThrow(/quota/)
		expect(tree(dir)).toEqual({})
		tx.commit()
		expect(Object.keys(tree(dir))).toEqual(["a.txt"])
	})

	it("counts a buffered overwrite once, not twice", () => {
		const seed = open(1000)
		seed.api.write("a.txt", "x".repeat(900))
		seed.commit()
		const tx = open(1000)
		// Replacing 900 bytes with 900 bytes is not 1800 bytes.
		expect(() => tx.api.write("a.txt", "y".repeat(900))).not.toThrow()
		expect(tx.api.size()).toBe(900)
	})

	it("frees the removed bytes in the same call", () => {
		const seed = open(1000)
		seed.api.write("fat.txt", "x".repeat(900))
		seed.commit()
		const tx = open(1000)
		expect(() => tx.api.write("next.txt", "y".repeat(900))).toThrow(/quota/)
		tx.api.remove("fat.txt")
		expect(tx.api.write("next.txt", "y".repeat(900))).toBe(true)
		tx.commit()
		expect(tree(dir)).toEqual({ "next.txt": "y".repeat(900) })
	})

	it("keeps two concurrent transactions' buffers apart", () => {
		const a = open()
		const b = open()
		a.api.write("shared.txt", "from-a")
		b.api.write("shared.txt", "from-b")
		b.api.write("only-b.txt", "b")
		// Neither call can observe the other's uncommitted state — the buffer is
		// per call, and the disk is the only thing they share.
		expect(a.api.read("shared.txt")).toBe("from-a")
		expect(b.api.read("shared.txt")).toBe("from-b")
		expect(a.api.exists("only-b.txt")).toBe(false)

		a.commit()
		expect(tree(dir)).toEqual({ "shared.txt": "from-a" })
		// b was still holding its own copy, and commits it over a's.
		b.commit()
		expect(tree(dir)).toEqual({ "shared.txt": "from-b", "only-b.txt": "b" })
	})

	it("does not hand the guest a way to end its own transaction", () => {
		const tx = open()
		// commit/discard live on the handle the sandbox keeps; only `api` is
		// endowed or bridged into the sandbox.
		expect(Object.keys(tx.api).sort()).toEqual([
			"delete",
			"deleteAll",
			"exists",
			"files",
			"get",
			"keys",
			"list",
			"put",
			"query",
			"read",
			"remove",
			"size",
			"usage",
			"write"
		])
		expect(Object.keys(tx.api.files).sort()).toEqual([
			"delete",
			"deleteAll",
			"list",
			"read",
			"stat",
			"write"
		])
	})

	it("refuses writes once the transaction has ended", () => {
		const tx = open()
		tx.api.write("a.txt", "1")
		tx.commit()
		expect(() => tx.api.write("b.txt", "2")).toThrow(/the call has ended/)
		expect(() => tx.api.remove("a.txt")).toThrow(/the call has ended/)
		expect(tree(dir)).toEqual({ "a.txt": "1" })
	})
})

describe("permissionKey", () => {
	it("treats an allowlist as a set, not a sequence", () => {
		// Reordering the same hosts is not a grant change, and must not churn a
		// loaded plugin; adding one is, and must.
		expect(permissionKey({ networkHosts: ["a.com", "b.com"] })).toBe(
			permissionKey({ networkHosts: ["b.com", "a.com"] })
		)
		expect(permissionKey({ networkHosts: ["a.com"] })).not.toBe(
			permissionKey({ networkHosts: ["a.com", "b.com"] })
		)
	})

	it("separates an absent grant from an empty one and from a narrowed quota", () => {
		expect(permissionKey(undefined)).toBe("")
		expect(permissionKey({})).not.toBe("")
		expect(permissionKey({ quotaBytes: 1024 })).not.toBe(
			permissionKey({ quotaBytes: 8_000_000 })
		)
	})
})

/**
 * The row half — the store the SDK has declared since before any of it existed.
 *
 * The claims worth a test are the ones a plugin author and an admin each rely
 * on: a call reads its own uncommitted rows, an un-committed call yields no diff
 * at all, the row budget refuses at the WRITE rather than at a commit where
 * nothing can be done about it, and `usage()` splits rows from files honestly
 * because that split is the only way an author can tell which half to prune.
 */
describe("storage rows", () => {
	it("reads the snapshot the host loaded, and its own writes over it", () => {
		const { api } = openRows([seed("a", { n: 1 })])
		expect(api.get("a")).toEqual({ n: 1 })
		expect(api.get("b")).toBeUndefined()

		const r = api.put("b", { hi: "there" })
		expect(r.kind).toBe("ok")
		// Read-your-writes: the transaction is invisible until a kill matters.
		expect(api.get("b")).toEqual({ hi: "there" })
		expect(api.keys().sort()).toEqual(["a", "b"])
	})

	it("a value is copied in, so mutating it afterwards changes nothing", () => {
		// On SES the argument is a live guest object the hook still holds.
		const { api, commit } = openRows()
		const live: Record<string, unknown> = { n: 1 }
		api.put("k", live)
		live.n = 999
		expect(api.get("k")).toEqual({ n: 1 })
		expect(commit()).toEqual([
			{
				op: "put",
				key: "k",
				value: { n: 1 },
				bytes: 8,
				updatedAt: NOW_ISO
			}
		])
	})

	it("delete and deleteAll are visible immediately and collapse to one op", () => {
		const { api, commit } = openRows([
			seed("p/1", 1),
			seed("p/2", 2),
			seed("q/1", 3)
		])
		expect(api.deleteAll("p/").kind).toBe("ok")
		expect(api.keys()).toEqual(["q/1"])
		// Rewriting a key many times owes the database one upsert, not many.
		api.put("q/1", "a")
		api.put("q/1", "b")
		api.put("q/1", "c")
		const ops = commit()
		expect(ops.filter((o) => o.op === "put")).toEqual([
			{ op: "put", key: "q/1", value: "c", bytes: 6, updatedAt: NOW_ISO }
		])
		expect(
			ops
				.filter((o) => o.op === "delete")
				.map((o) => o.key)
				.sort()
		).toEqual(["p/1", "p/2"])
	})

	it("a key created and deleted in the same call emits nothing", () => {
		// It was never in the database, so a DELETE for it is a statement about
		// a row that does not exist.
		const { api, commit } = openRows()
		api.put("scratch", 1)
		api.delete("scratch")
		expect(commit()).toEqual([])
	})

	it("an un-committed call yields no diff at all", () => {
		const tx = openRows([seed("a", 1)])
		tx.api.put("b", 2)
		tx.api.delete("a")
		tx.discard()
		// Nothing to apply, and nothing a later commit could resurrect.
		expect(tx.commit()).toEqual([])
	})

	it("refuses a write past the row budget at the write, not at the commit", () => {
		const { api, commit } = openRows([], { rowQuotaBytes: 100 })
		const r = api.put("k", "x".repeat(500))
		expect(r.kind).toBe("err")
		expect(r.kind === "err" && r.reason).toMatch(/row budget/)
		// Refused means refused: nothing buffered, nothing to commit, and the
		// key is still absent so the hook can prune and retry.
		expect(api.get("k")).toBeUndefined()
		expect(commit()).toEqual([])
	})

	it("refuses a row that fits the row budget but not the shared quota", () => {
		// One quota over both halves is the SDK's rule; the row sub-cap sits
		// inside it rather than beside it.
		const { api } = openRows([], { quotaBytes: 60, rowQuotaBytes: 10_000 })
		api.write("f.txt", "x".repeat(40))
		const r = api.put("k", "y".repeat(40))
		expect(r.kind).toBe("err")
		expect(r.kind === "err" && r.reason).toMatch(/quota exceeded/)
	})

	it("charges a row for its key as well as its value", () => {
		const short = openRows().api.put("k", 1)
		const long = openRows().api.put("k".repeat(100), 1)
		expect(short.kind === "ok" && short.value.deltaBytes).toBe(2)
		expect(long.kind === "ok" && long.value.deltaBytes).toBe(101)
	})

	it("rejects a key that is empty, non-string or oversized", () => {
		const { api } = openRows()
		expect(() => api.put("", 1)).toThrow(/row key is required/)
		expect(() => api.put(undefined as unknown as string, 1)).toThrow(
			/row key is required/
		)
		expect(() => api.put("k".repeat(513), 1)).toThrow(/512/)
	})

	it("rejects a value JSON cannot carry, before anything is buffered", () => {
		const { api, commit } = openRows()
		const circular: Record<string, unknown> = {}
		circular.self = circular
		expect(() => api.put("k", circular)).toThrow(/JSON-serializable/)
		expect(commit()).toEqual([])
	})

	it("stores null as a value distinct from a missing key", () => {
		const { api } = openRows([seed("n", null)])
		expect(api.get("n")).toBeNull()
		expect(api.get("gone")).toBeUndefined()
		expect(api.keys()).toEqual(["n"])
	})
})

describe("storage query", () => {
	const rows = () => [
		seed("log/1", "a", "2026-01-01T00:00:00.000Z"),
		seed("log/2", "b", "2026-01-02T00:00:00.000Z"),
		seed("log/3", "c", "2026-01-03T00:00:00.000Z"),
		seed("other", "z", "2026-01-04T00:00:00.000Z")
	]

	it("filters by prefix and orders newest-first by default", () => {
		const { api } = openRows(rows())
		expect(api.query({ prefix: "log/" }).rows.map((r) => r.key)).toEqual([
			"log/3",
			"log/2",
			"log/1"
		])
		expect(
			api
				.query({ prefix: "log/", order: "oldest" })
				.rows.map((r) => r.key)
		).toEqual(["log/1", "log/2", "log/3"])
		expect(api.query({ order: "key" }).rows.map((r) => r.key)).toEqual([
			"log/1",
			"log/2",
			"log/3",
			"other"
		])
	})

	it("windows on since/until, half-open at the top", () => {
		const { api } = openRows(rows())
		const page = api.query({
			since: "2026-01-02T00:00:00.000Z",
			until: "2026-01-03T00:00:00.000Z",
			order: "key"
		})
		expect(page.rows.map((r) => r.key)).toEqual(["log/2"])
	})

	it("pages with a cursor and stops without one", () => {
		const { api } = openRows(rows())
		const first = api.query({ limit: 2, order: "key" })
		expect(first.rows.map((r) => r.key)).toEqual(["log/1", "log/2"])
		expect(first.nextCursor).toBeTruthy()
		const second = api.query({
			limit: 2,
			order: "key",
			cursor: first.nextCursor
		})
		expect(second.rows.map((r) => r.key)).toEqual(["log/3", "other"])
		expect(second.nextCursor).toBeUndefined()
	})

	it("throws on a cursor it did not issue rather than restarting at zero", () => {
		// Silently starting over is how a pager becomes an infinite loop.
		const { api } = openRows(rows())
		expect(() => api.query({ cursor: "nonsense" })).toThrow(/cursor/)
	})

	it("clamps the page size rather than honouring an unbounded ask", () => {
		const many = Array.from({ length: 250 }, (_, i) =>
			seed("k" + String(i).padStart(3, "0"), i)
		)
		const { api } = openRows(many, { rowQuotaBytes: 100_000 })
		expect(api.query({ limit: 10_000, order: "key" }).rows).toHaveLength(
			200
		)
	})

	it("sees rows written in this call, and not rows deleted in it", () => {
		const { api } = openRows(rows())
		api.put("log/4", "d")
		api.delete("log/1")
		expect(
			api.query({ prefix: "log/", order: "key" }).rows.map((r) => r.key)
		).toEqual(["log/2", "log/3", "log/4"])
	})
})

describe("storage usage", () => {
	it("reports the two halves separately and their sum", () => {
		const { api } = openRows([seed("a", "12345")], { quotaBytes: 1000 })
		api.write("f.txt", "0123456789")
		const u = api.usage()
		// "a" + "\"12345\"" = 1 + 7; the file is its ten bytes.
		expect(u.rowBytes).toBe(8)
		expect(u.fileBytes).toBe(10)
		expect(u.usedBytes).toBe(18)
		expect(u.quotaBytes).toBe(1000)
		expect(u.availableBytes).toBe(982)
	})

	it("answers from the projection, so a hook can budget before it commits", () => {
		const tx = openRows([], { quotaBytes: 1000 })
		expect(tx.api.usage().usedBytes).toBe(0)
		tx.api.put("k", "x".repeat(20))
		expect(tx.api.usage().rowBytes).toBeGreaterThan(20)
		tx.discard()
		// A fresh call over the same directory sees nothing of it.
		expect(openRows([], { quotaBytes: 1000 }).api.usage().usedBytes).toBe(0)
	})

	it("floors availableBytes rather than going negative", () => {
		const { api } = openRows([seed("a", "x".repeat(200))], {
			quotaBytes: 50
		})
		expect(api.usage().availableBytes).toBe(0)
	})
})

describe("storage files (the SDK spelling)", () => {
	const b64 = (bytes: number[]) => Buffer.from(bytes).toString("base64")

	it("round-trips arbitrary bytes, which the text spelling cannot", () => {
		const tx = openRows()
		const bytes = [0, 1, 2, 254, 255]
		expect(tx.api.files.write("bin/x.dat", b64(bytes)).kind).toBe("ok")
		const read = tx.api.files.read("bin/x.dat")
		expect(read.kind === "ok" && read.value).toBe(b64(bytes))
		tx.commit()
		expect([...fs.readFileSync(path.join(dir, "bin/x.dat"))]).toEqual(bytes)
	})

	it("shares one buffer with the older spelling", () => {
		const { api } = openRows()
		api.write("a.txt", "hello")
		expect(api.files.stat("a.txt")).toMatchObject({
			path: "a.txt",
			bytes: 5
		})
		expect(api.files.read("a.txt")).toEqual({
			kind: "ok",
			value: Buffer.from("hello", "utf8").toString("base64")
		})
	})

	it("lists recursively, relative, and never the staging temps", () => {
		const tx = openRows()
		tx.api.write("a.txt", "1")
		tx.api.write("deep/b/c.txt", "22")
		expect(tx.api.files.list().map((f) => f.path)).toEqual([
			"a.txt",
			"deep/b/c.txt"
		])
		expect(tx.api.files.list("deep/").map((f) => f.path)).toEqual([
			"deep/b/c.txt"
		])
		tx.commit()
		// A crashed commit can leave a temp behind; it is scratch, not content,
		// and its name carries the host pid.
		fs.writeFileSync(path.join(dir, ".sptmp-999-1"), "junk")
		expect(
			openRows()
				.api.files.list()
				.map((f) => f.path)
		).toEqual(["a.txt", "deep/b/c.txt"])
	})

	it("stat answers null for a missing path and for a directory", () => {
		const tx = openRows()
		tx.api.write("d/x.txt", "1")
		expect(tx.api.files.stat("nope.txt")).toBeNull()
		expect(tx.api.files.stat("d")).toBeNull()
	})

	it("read reports a miss as err rather than throwing", () => {
		const { api } = openRows()
		expect(api.files.read("nope.bin")).toEqual({
			kind: "err",
			reason: "storage: not found"
		})
	})

	it("write reports the quota as err, where the older spelling throws", () => {
		// The SDK is explicit: a write past the quota returns err and does not
		// throw. The older `write` keeps throwing, because hooks rely on it.
		const { api } = openRows([], { quotaBytes: 20 })
		const r = api.files.write("big.bin", b64(Array(40).fill(7)))
		expect(r.kind).toBe("err")
		expect(() => api.write("big.txt", "x".repeat(40))).toThrow(
			/quota exceeded/
		)
	})

	it("delete frees the bytes it reports, and deleteAll sweeps a prefix", () => {
		const tx = openRows()
		tx.api.write("cache/a", "1234")
		tx.api.write("cache/b", "5678")
		tx.api.write("keep", "9")
		const d = tx.api.files.delete("cache/a")
		expect(d.kind === "ok" && d.value.deltaBytes).toBe(-4)
		const all = tx.api.files.deleteAll("cache")
		expect(all.kind === "ok" && all.value.removed).toBe(1)
		expect(tx.api.files.list().map((f) => f.path)).toEqual(["keep"])
		tx.commit()
		expect(tree(dir)).toEqual({ keep: "9" })
	})

	it("refuses a prefix that tries to climb out", () => {
		const { api } = openRows()
		expect(() => api.files.list("../")).toThrow(/escapes/)
		expect(() => api.files.deleteAll("../")).toThrow(/escapes/)
		expect(() => api.files.stat("../escape")).toThrow(/escapes/)
	})

	it("refuses to mutate once the transaction has ended", () => {
		const tx = openRows()
		tx.commit()
		expect(() => tx.api.files.write("a", "AA==")).toThrow(
			/the call has ended/
		)
		expect(() => tx.api.put("k", 1)).toThrow(/the call has ended/)
	})
})

describe("rowQuotaFor", () => {
	it("agrees with the expression the store actually enforces", () => {
		// Two copies of one formula is a quota a plugin cannot predict, so the
		// TypeScript half and the embedded source are compared directly.
		for (const q of [1024, 100_000, 5 * 1024 * 1024, 256 * 1024 * 1024]) {
			const enforced = makeStorageHost({ storageDir: dir, quotaBytes: q })
			// The store has no getter for it; put a row one byte past the cap
			// and confirm the refusal lands exactly where rowQuotaFor says.
			const cap = rowQuotaFor(q)
			expect(cap).toBeLessThanOrEqual(q)
			const key = "k"
			const fits = enforced.api.put(key, "x".repeat(Math.max(0, cap - 4)))
			expect(fits.kind).toBe("ok")
			const over = enforced.api.put("k2", "x".repeat(cap))
			expect(over.kind).toBe("err")
			enforced.discard()
		}
	})

	it("is a fraction of the grant, floored and capped", () => {
		expect(rowQuotaFor(512)).toBe(512)
		expect(rowQuotaFor(100 * 1024)).toBe(64 * 1024)
		expect(rowQuotaFor(5 * 1024 * 1024)).toBe(640 * 1024)
		expect(rowQuotaFor(256 * 1024 * 1024)).toBe(1024 * 1024)
		expect(rowQuotaFor(0)).toBe(64 * 1024)
	})
})
