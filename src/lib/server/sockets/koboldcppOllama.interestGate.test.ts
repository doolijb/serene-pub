/**
 * The two local-model manager families through the real gate — phase 2.
 *
 * `koboldcpp:` and `ollama:` are both restricted interest (every handler in
 * either refuses a non-admin), and both end nearly every write by pushing a
 * view nobody asked for: the whole system-settings view after one number
 * changes, every endpoint with its models after a pull, the whole models
 * listing after a label is corrected. Each push is real work — the settings
 * view is five reads plus an embedding-target resolution, the models listing a
 * reachability probe plus a directory scan plus a header sniff per unmeasured
 * file — and until this slice all of it was paid whether or not any view was
 * open to receive it. The cascades are the thunk form now, so these tests assert
 * on the QUERIES rather than on the emits: skipping the emit alone would save
 * nothing.
 *
 * The progress pushes are the other half. `ollama:pullProgress` fires once per
 * chunk of a multi-gigabyte pull and used to be spelled `ollamaPullProgress` —
 * outside its own family, and so outside the prefix that makes the family
 * restricted. It carries the prefix now, and the cases below are what say the
 * gate reaches it.
 *
 * The gate applies to a handler's own reply exactly as it does to its cascades:
 * the client holds the reply's key before the request even goes out (the typed
 * emit flushes the interest sync first), so the own reply reaches the caller and
 * only the cascades nobody wants are skipped.
 *
 * Driven through the real `connectSockets`, the real `register` and the real
 * `interest:sync` handler. `GATED_EVENTS` is mocked to add the events this slice
 * converts — the architect adds them to the shared set once the client half has
 * landed too, and these tests are what say the server half is ready for that.
 *
 * `$lib/server/db` is a recording fake rather than PGlite: what is being pinned
 * here is which reads happen, and a fake that names each read is the only way to
 * assert that one did NOT. The gate itself is never stubbed — a test that
 * stubbed it would pass against a gate that had been deleted.
 *
 * ⚠ Harness gotcha (shared with the other interest-gate suites): mocking
 * `$lib/server/db` while importing `sockets/index` needs `getCryptoSecretKey`,
 * `schema` and `dbReady` in the factory — `auth/tokens` derives its secret at
 * import time and `connectSockets` reaches auth.
 */
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest"

const seam = vi.hoisted(() => {
	/** Every read, in the order it happened — the cost the gate exists to skip. */
	const queries: string[] = []

	/**
	 * The gated set, spelled inside the hoisted factory because the `vi.mock`
	 * below is hoisted above every module const.
	 */
	const gated = new Set<string>()

	const rows = {
		/**
		 * No models directory configured, which is the cheap shape for the
		 * listing: `modelsDirsToScan` answers with nothing, so the builder
		 * reaches its response without touching the filesystem. What is being
		 * pinned is whether it ran at all.
		 */
		koboldCppSettings: {
			koboldCppManagerBaseUrl: "http://localhost:5001",
			koboldCppManagerModelsDir: null,
			koboldCppImageModelsDir: null
		} as Record<string, unknown>,
		localModel: {
			filename: "aria-7b.gguf",
			kind: "unknown",
			kindSource: "assumed",
			status: "complete"
		} as Record<string, unknown> | undefined
	}

	/** A drizzle-ish builder: every method chains, awaiting it records the call. */
	function chain(label: string, result: any = []) {
		const self: any = {
			from: () => self,
			innerJoin: () => self,
			leftJoin: () => self,
			where: () => self,
			limit: () => self,
			orderBy: () => self,
			groupBy: () => self,
			set: () => self,
			values: () => self,
			onConflictDoNothing: () => self,
			onConflictDoUpdate: () => self,
			returning: () => self,
			then: (ok: any, err: any) => {
				queries.push(label)
				return Promise.resolve(result).then(ok, err)
			}
		}
		return self
	}

	const table = (name: string, first: () => any, many: () => any) => ({
		findFirst: async () => {
			queries.push(`${name}.findFirst`)
			return first()
		},
		findMany: async () => {
			queries.push(`${name}.findMany`)
			return many()
		}
	})

	const db: any = {
		query: {
			systemSettings: table(
				"systemSettings",
				() => ({ id: 1 }),
				() => []
			),
			ollamaSettings: table(
				"ollamaSettings",
				() => ({ ollamaManagerBaseUrl: "http://localhost:11434" }),
				() => []
			),
			koboldCppSettings: table(
				"koboldCppSettings",
				() => rows.koboldCppSettings,
				() => []
			),
			localModels: table(
				"localModels",
				() => rows.localModel,
				() => []
			),
			connections: table(
				"connections",
				() => undefined,
				() => []
			),
			users: table(
				"users",
				() => ({ id: 1, username: "owner", isAdmin: true }),
				() => []
			),
			userSettings: table(
				"userSettings",
				() => ({ userId: 1 }),
				() => []
			)
		},
		select: () => chain("select"),
		update: () => chain("update"),
		insert: () => chain("insert"),
		delete: () => chain("delete")
	}

	/** What the mocked Ollama client hands back, one frame per loop turn. */
	const pull = { chunks: [] as any[] }

	return { queries, gated, rows, db, pull }
})

vi.mock("$lib/shared/sockets/interest", async (importOriginal) => {
	const actual =
		await importOriginal<typeof import("$lib/shared/sockets/interest")>()
	for (const event of actual.GATED_EVENTS) seam.gated.add(event)
	// This slice's events, on top of the real set. `systemSettings:get` is
	// already in there — it is the cascade target these two families push most,
	// and it ships gated. Everything else — the scope table, the restricted
	// prefixes, the key helpers — stays exactly as it ships.
	for (const event of [
		"connections:list",
		"koboldcpp:binaryDownloadProgress",
		"koboldcpp:listModels",
		"koboldcpp:setModelKind",
		"koboldcpp:setModelTtl",
		"ollama:pullModel",
		"ollama:pullProgress"
	])
		seam.gated.add(event)
	return {
		...actual,
		GATED_EVENTS: seam.gated,
		isGatedEvent: (event: string) => seam.gated.has(event)
	}
})

vi.mock("$lib/server/db", async () => {
	const schema = await import("$lib/server/db/schema")
	return {
		db: seam.db,
		schema,
		dbReady: Promise.resolve(),
		getCryptoSecretKey: () => "koboldcpp-ollama-interest-gate-secret",
		closeDatabase: async () => {},
		reopenDatabase: async () => {}
	}
})

// The support question behind `systemSettings:get` attempts a real
// `@huggingface/transformers` import on its first call and caches the verdict.
// Which backend this machine can run is not what any case here is about.
vi.mock("$lib/server/embedding", async (importOriginal) => {
	const actual =
		await importOriginal<typeof import("$lib/server/embedding")>()
	return { ...actual, isLocalEmbeddingSupported: async () => false }
})

/**
 * The Ollama client, stopped at the one thing these cases are about: the frames
 * the pull hands back. `ollamaPullModelHandler` builds a progress push around
 * each of them, and capturing the loop is what puts that construction — not a
 * copy of it — under test.
 */
vi.mock("ollama", () => ({
	Ollama: class {
		constructor(_opts: unknown) {}
		async pull(_opts: unknown) {
			const chunks = seam.pull.chunks
			return {
				abort: () => {},
				async *[Symbol.asyncIterator]() {
					for (const chunk of chunks) yield chunk
				}
			}
		}
	}
}))

// A pulled model is a model every Ollama endpoint can serve, so the handler
// re-syncs their rows. That is a write with its own cost and its own tests; what
// these cases are about is the LIST that follows it.
vi.mock("$lib/server/connections/modelSync", async (importOriginal) => {
	const actual =
		await importOriginal<
			typeof import("$lib/server/connections/modelSync")
		>()
	return {
		...actual,
		syncManyConnectionModels: async () => {
			seam.queries.push("syncManyConnectionModels")
			return [] as any
		}
	}
})

vi.mock("$lib/server/auth/totp/service", () => ({
	getTotpState: async () => ({ enabled: false, recoveryCodesRemaining: 0 }),
	confirmEnrollment: async () => ({ recoveryCodes: [] }),
	beginEnrollment: async () => ({ secret: "s", otpauthUri: "otpauth://x" }),
	verifyForSession: async () => ({ ok: true }),
	regenerateRecoveryCodes: async () => [],
	clearTotp: async () => {},
	isMfaEnabled: async () => false,
	isMfaPending: async () => false
}))

vi.mock("$lib/server/pipelines/entities/sessionGenres", () => ({
	listSessionGenres: async () => [],
	STANDARD_GENRE_ID: "core:genre/chat"
}))

import { connectSockets } from "./index"
import * as binaryManager from "$lib/server/koboldcpp/binaryManager"

const ADMIN = { id: 1, username: "owner", isAdmin: true }
/** The same admin in a second tab — two sockets in one user room. */
const SECOND_TAB = { id: 1, username: "owner", isAdmin: true }

/** The same fake io the other interest-gate tests drive `connectSockets` with. */
function harness() {
	const rooms = new Map<string, Set<string>>()
	const registry = new Map<string, any>()
	const emits: Array<{ target: string; event: string; data: any }> = []
	let onConnect: ((socket: any) => void) | null = null

	const io: any = {
		on: (event: string, cb: (socket: any) => void) => {
			if (event === "connect") onConnect = cb
		},
		to: (target: string) => ({
			emit: (event: string, data: any) =>
				emits.push({ target, event, data })
		}),
		sockets: { adapter: { rooms }, sockets: registry }
	}

	connectSockets(io)

	const live: Array<() => void> = []

	function connect(id: string, user: typeof ADMIN) {
		// A multimap: several modules hook "disconnect" on the same socket.
		const listeners = new Map<string, Array<(msg?: any) => any>>()
		const socket: any = {
			id,
			user,
			pendingSetup: [],
			emit: () => {},
			disconnect: () => {},
			join: (room: string) => {
				const members = rooms.get(room) ?? new Set<string>()
				members.add(id)
				rooms.set(room, members)
			},
			on: (event: string, cb: (msg?: any) => any) => {
				listeners.set(event, [...(listeners.get(event) ?? []), cb])
			}
		}
		registry.set(id, socket)
		onConnect!(socket)

		const disconnect = () => {
			for (const cb of listeners.get("disconnect") ?? []) void cb()
			registry.delete(id)
			rooms.get(`user_${user.id}`)?.delete(id)
		}
		live.push(disconnect)

		return {
			socket,
			fire: (event: string, msg?: any) =>
				Promise.all((listeners.get(event) ?? []).map((cb) => cb(msg))),
			declare: (...keys: string[]) =>
				Promise.all(
					(listeners.get("interest:sync") ?? []).map((cb) =>
						cb({ keys })
					)
				),
			disconnect
		}
	}

	return {
		io,
		emits,
		connect,
		teardown: () => live.splice(0).forEach((f) => f())
	}
}

const harnesses: Array<{ teardown: () => void }> = []
function fresh() {
	const h = harness()
	harnesses.push(h)
	return h
}

beforeEach(() => {
	seam.queries.length = 0
	seam.rows.koboldCppSettings = {
		koboldCppManagerBaseUrl: "http://localhost:5001",
		koboldCppManagerModelsDir: null,
		koboldCppImageModelsDir: null
	}
	seam.rows.localModel = {
		filename: "aria-7b.gguf",
		kind: "unknown",
		kindSource: "assumed",
		status: "complete"
	}
	seam.pull.chunks = []
	// The listing asks the running koboldcpp what it is holding. Offline is the
	// branch it is written for, and it is the one that costs nothing.
	vi.stubGlobal("fetch", async () => {
		throw new Error("not reachable")
	})
})

afterEach(() => {
	harnesses.splice(0).forEach((h) => h.teardown())
	vi.unstubAllGlobals()
	vi.clearAllMocks()
})

type Emitted = { target: string; event: string; data: any }

const count = (q: string) => seam.queries.filter((x) => x === q).length
const events = (h: { emits: Emitted[] }) => h.emits.map((e) => e.event)
const of = (h: { emits: Emitted[] }, event: string) =>
	h.emits.filter((e) => e.event === event)

describe("koboldcpp:setModelTtl — the settings-view cascade", () => {
	test("writes the setting and re-reads nothing when nobody is showing it", async () => {
		const h = fresh()
		const admin = h.connect("s1", ADMIN)
		// The caller always holds its own reply's key before the request ships
		// (the typed emit flushes the interest sync first) — declared here, but
		// not the cascade's, so the cascade stays closed.
		await admin.declare("koboldcpp:setModelTtl")

		await admin.fire("koboldcpp:setModelTtl", { ttlSecs: 600 })

		// The command ran, and its own reply reached the caller, per socket.
		expect(seam.queries).toContain("update")
		expect(events(h)).toEqual(["koboldcpp:setModelTtl"])
		expect(h.emits[0].target).toBe("s1")
		// The five reads behind `systemSettings:get` did not happen at all.
		expect(count("systemSettings.findFirst")).toBe(0)
		expect(count("ollamaSettings.findFirst")).toBe(0)
		expect(count("koboldCppSettings.findFirst")).toBe(0)
	})

	test("builds the view once, for the tab that declared it and no other", async () => {
		const h = fresh()
		const watching = h.connect("s1", ADMIN)
		const idle = h.connect("s2", SECOND_TAB)
		await watching.declare("koboldcpp:setModelTtl", "systemSettings:get")
		// A second tab of the same user, in the same room, wanting the reply
		// but not the view.
		await idle.declare("koboldcpp:setModelTtl")

		await watching.fire("koboldcpp:setModelTtl", { ttlSecs: 600 })

		// Built once for the room, not once per interested socket.
		expect(count("systemSettings.findFirst")).toBe(1)
		const view = of(h, "systemSettings:get")
		expect(view.map((e) => e.target)).toEqual(["s1"])
		expect(view[0].data.systemSettings).toEqual({ id: 1 })
		// The reply precedes the cascade, as it always has, and reaches both
		// tabs because both declared it.
		expect(events(h)).toEqual([
			"koboldcpp:setModelTtl",
			"koboldcpp:setModelTtl",
			"systemSettings:get"
		])
	})
})

describe("koboldcpp:setModelKind — the models-listing cascade", () => {
	const RELABEL = { filename: "aria-7b.gguf", kind: "image" } as any

	test("records the label and scans nothing when no tab is showing the list", async () => {
		const h = fresh()
		const admin = h.connect("s1", ADMIN)
		await admin.declare("koboldcpp:setModelKind")

		await admin.fire("koboldcpp:setModelKind", RELABEL)

		// The write ran: the handler read the row and updated it.
		expect(count("localModels.findFirst")).toBe(1)
		expect(seam.queries).toContain("update")
		expect(events(h)).toEqual(["koboldcpp:setModelKind"])
		// `buildKoboldCppListModels` never started — no settings read, so no
		// reachability probe, no directory scan and no header sniff either.
		expect(count("koboldCppSettings.findFirst")).toBe(0)
		expect(count("localModels.findMany")).toBe(0)
	})

	test("builds the listing for a tab that declared its key", async () => {
		const h = fresh()
		const admin = h.connect("s1", ADMIN)
		await admin.declare("koboldcpp:setModelKind", "koboldcpp:listModels")

		await admin.fire("koboldcpp:setModelKind", RELABEL)

		expect(count("koboldCppSettings.findFirst")).toBe(1)
		expect(count("localModels.findMany")).toBe(1)
		const listing = of(h, "koboldcpp:listModels")
		expect(listing.map((e) => e.target)).toEqual(["s1"])
		// Nothing configured is not the same answer as an empty directory: the
		// listing says so rather than claiming a scan it never ran.
		expect(listing[0].data).toEqual({
			currentModel: null,
			availableModels: [],
			modelsDirSet: false
		})
	})
})

describe("ollama:pullModel — the progress pushes and the endpoint list", () => {
	const PULL = { modelName: "qwen3:8b" }

	test("pulls without pushing progress or rebuilding the list when nobody wants either", async () => {
		const h = fresh()
		const admin = h.connect("s1", ADMIN)
		seam.pull.chunks = [
			{ status: "pulling manifest" },
			{ status: "pulling aabbcc", total: 100, completed: 40 }
		]
		await admin.declare("ollama:pullModel")

		await admin.fire("ollama:pullModel", PULL)

		// The pull itself ran, and the sync behind it — those are the handler's
		// work, not its output.
		expect(seam.queries).toContain("ollamaSettings.findFirst")
		expect(seam.queries).toContain("syncManyConnectionModels")
		// Its own reply, and nothing else: three progress frames and the
		// endpoint list all stayed behind the gate.
		expect(events(h)).toEqual(["ollama:pullModel"])
		expect(count("connections.findMany")).toBe(0)
	})

	test("a progress frame reaches the tab that declared it and skips the one that did not", async () => {
		const h = fresh()
		const watching = h.connect("s1", ADMIN)
		const idle = h.connect("s2", SECOND_TAB)
		seam.pull.chunks = [
			{ status: "pulling manifest" },
			{ status: "pulling aabbcc", total: 100, completed: 40 }
		]
		await watching.declare("ollama:pullModel", "ollama:pullProgress")
		await idle.declare("ollama:pullModel")

		await watching.fire("ollama:pullModel", PULL)

		const progress = of(h, "ollama:pullProgress")
		// One per chunk plus the terminal frame, every one of them to s1.
		expect(progress).toHaveLength(3)
		expect(new Set(progress.map((e) => e.target))).toEqual(new Set(["s1"]))
		// The last frame is the whole map, with this pull finished in it —
		// which is what makes a reconnecting tab's view correct.
		expect(
			progress.at(-1)!.data.downloadingQuants["qwen3:8b"]
		).toMatchObject({ status: "success", isDone: true })
	})

	test("rebuilds the endpoint list once for a tab that declared it", async () => {
		const h = fresh()
		const admin = h.connect("s1", ADMIN)
		await admin.declare("ollama:pullModel", "connections:list")

		await admin.fire("ollama:pullModel", PULL)

		expect(count("connections.findMany")).toBe(1)
		const list = of(h, "connections:list")
		expect(list.map((e) => e.target)).toEqual(["s1"])
		expect(list[0].data).toEqual({ connectionsList: [] })
	})
})

describe("the stored progress emitters — one closure, the whole user room", () => {
	test("goes on reaching a second tab after the tab that registered it leaves", async () => {
		const spy = vi.spyOn(binaryManager, "registerEmitter")
		const h = fresh()
		const first = h.connect("s1", ADMIN)
		const second = h.connect("s2", SECOND_TAB)
		// Both tabs want it; only one of them is about to still be here.
		await first.declare("koboldcpp:binaryDownloadProgress")
		await second.declare("koboldcpp:binaryDownloadProgress")

		// The registry is keyed by userId under a connection refcount, so what
		// it holds for this user is the FIRST socket's closure — and that is
		// the one a running download actually calls.
		const stored = spy.mock.calls[0][1]
		first.disconnect()

		stored({ download: null })

		// It still lands, on the tab that declared it. The closure resolves its
		// recipients at emit time from `io` and the user id, never from the
		// socket that made it, which is what makes keeping the first one safe.
		expect(
			of(h, "koboldcpp:binaryDownloadProgress").map((e) => e.target)
		).toEqual(["s2"])
	})
})
