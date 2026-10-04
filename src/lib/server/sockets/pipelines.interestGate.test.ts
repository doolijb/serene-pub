/**
 * The `pipelines:*` cascades and pushes through the real gate — phase 2.
 *
 * Every write on the pipeline page answers with the WHOLE view: a fresh
 * `namespaceView` — every declaration, every configuration layer, an option
 * handle keyed off the instance secret for each control — re-read and pushed on
 * `pipelines:get`. Twenty-one handlers end that way, and until this slice all of
 * them paid for it whether or not a panel was open to receive it. The cascade is
 * now the thunk form, so these tests assert on the READ rather than on the emit:
 * skipping the emit alone would save nothing.
 *
 * Two shapes are pinned besides the plain cascade.
 *
 * **The view that rides along on an own reply.** `pipelines:createConfig` and
 * the five other create/clone verbs send the new row's id *with* the view, so
 * that payload is needed whatever the gate says about `pipelines:get` — they
 * build it eagerly and use it twice rather than reading it twice. The gate still
 * decides who is sent the `pipelines:get` copy.
 *
 * **The review gate's push transport.** It is the one `pipelines:` emitter with
 * no handler in scope — a run can park from any trigger — so it cannot go
 * through `emitToUser` and does its own redaction and its own delivery. It now
 * consults the gate the same way `broadcastHelpers` does, which is what keeps it
 * from being a second door the gate cannot see.
 *
 * Driven through the real `connectSockets`, the real `register` and the real
 * `interest:sync` handler. `GATED_EVENTS` is mocked to add the events this slice
 * converts — the architect adds them to the shared set once the client half has
 * landed too, and these tests are what say the server half is ready for that.
 * `SCOPED_EVENTS` is the real table, which is where `pipelines:progress` gets
 * its `sessionId` from.
 *
 * `$lib/server/db` is a recording fake rather than PGlite, and the two panel
 * entry points a write goes through are recorders too: what is being pinned is
 * which reads happen, and a fake that names each read is the only way to assert
 * that one did NOT. The gate itself is never stubbed — a test that stubbed it
 * would pass against a gate that had been deleted.
 */
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest"

const seam = vi.hoisted(() => {
	/** Every read, in the order it happened — the cost the gate exists to skip. */
	const queries: string[] = []
	/** The rows each table answers a `select` with, by its schema export name. */
	const rows: Record<string, any[]> = {}
	/** Filled by the db mock below, which is the first place `schema` exists. */
	let tableKey: (table: any) => string = () => "?"

	/**
	 * A drizzle-ish builder. `from` is what tells the reads apart: every one of
	 * them names a table, and the table is what a caller is actually asking for.
	 */
	function chain(label: string) {
		let table = "?"
		const self: any = {
			from: (t: any) => {
				table = tableKey(t)
				return self
			},
			where: () => self,
			limit: () => self,
			orderBy: () => self,
			set: () => self,
			values: () => self,
			returning: () => self,
			then: (ok: any, err: any) => {
				queries.push(`${label}(${table})`)
				return Promise.resolve(rows[table] ?? []).then(ok, err)
			}
		}
		return self
	}

	return {
		queries,
		rows,
		setTableKey: (fn: (table: any) => string) => {
			tableKey = fn
		},
		/** Each connected socket's own `emitToUser`, by socket id. */
		emitters: new Map<string, (event: string, data: any) => any>(),
		/** The review transport `registerPipelineHandlers` installed. */
		reviewPush: null as
			| ((userId: number, event: string, data: unknown) => void)
			| null,
		db: {
			select: () => chain("select"),
			update: () => chain("update"),
			insert: () => chain("insert"),
			delete: () => chain("delete")
		}
	}
})

vi.mock("$lib/shared/sockets/interest", async (importOriginal) => {
	const actual =
		await importOriginal<typeof import("$lib/shared/sockets/interest")>()
	// The real set, plus this slice's events — spelled here rather than in a
	// module const, because this factory is hoisted above every one of them.
	// `pipelines:reviewClosed` is deliberately LEFT OUT: it is the transport's
	// ungated case, and the test below uses it to pin that an ungated push
	// still takes the room emit it has always had.
	const gated = new Set([
		...actual.GATED_EVENTS,
		"pipelines:get",
		"pipelines:configNotices",
		"pipelines:createConfig",
		"pipelines:reviewRequested",
		"pipelines:progress"
	])
	return {
		...actual,
		GATED_EVENTS: gated,
		isGatedEvent: (event: string) => gated.has(event)
	}
})

// The db module is more than `db`: `auth/tokens` derives its secret from it at
// import time, and `connectSockets` reaches auth. Nothing here may import the
// real module — doing so opens PGlite — so the handful of exports the graph
// actually loads are stood in for. `getCryptoSecretKey` is one of them for a
// second reason as well: `pubSecret()` in `pipelines.ts` reads it before
// every view.
vi.mock("$lib/server/db", async () => {
	const schema = await import("$lib/server/db/schema")
	const { getTableName } = await import("drizzle-orm")
	// Drizzle answers with the SQL name (`pipeline_specs`); the tests read
	// better keyed by the export that names it, so the map is inverted once.
	const byExport = new Map<string, string>()
	for (const [key, value] of Object.entries(schema)) {
		try {
			const name = getTableName(value as any)
			if (typeof name === "string") byExport.set(name, key)
		} catch {
			/* not a table — relations, enums, types */
		}
	}
	seam.setTableKey((table: any) => {
		try {
			return byExport.get(getTableName(table)) ?? "?"
		} catch {
			return "?"
		}
	})
	return {
		db: seam.db,
		schema,
		dbReady: Promise.resolve(),
		getCryptoSecretKey: () => "pipelines-interest-gate-test-secret",
		closeDatabase: async () => {},
		reopenDatabase: async () => {}
	}
})

// The two panel entry points a write goes through. `namespaceView` is THE read
// the gate exists to skip, so it is a recorder; `writeOption` is the command in
// front of it, which must run whether or not anybody is listening (plan ruling
// 2: gate outputs, never commands). Everything else — the refusal classes the
// handlers match on with `instanceof`, the id helpers — stays as it ships.
vi.mock("$lib/server/pipelines/config/panel", async (importOriginal) => {
	const actual =
		await importOriginal<
			typeof import("$lib/server/pipelines/config/panel")
		>()
	return {
		...actual,
		writeOption: async () => {
			seam.queries.push("writeOption")
		},
		namespaceView: async () => {
			seam.queries.push("namespaceView")
			return { slug: "test:spec/panel", steps: [] } as any
		}
	}
})

// The named-config module, reached by dynamic import from the config verbs.
// `pendingNotices` is the read behind `pipelines:configNotices`, so it is the
// recorder there; `acknowledgeNotices` is that handler's command.
vi.mock("$lib/server/pipelines/config/named", () => ({
	acknowledgeNotices: async () => {
		seam.queries.push("acknowledgeNotices")
	},
	pendingNotices: async () => {
		seam.queries.push("pendingNotices")
		return []
	},
	createConfig: async () => {
		seam.queries.push("createConfig")
		return { id: 77 }
	},
	// Destructured beside `createConfig`, so it has to exist even on the path
	// that never calls it — a missing export on a mock throws at the property
	// read, inside the handler's try, and surfaces as a refusal instead.
	duplicateConfig: async () => ({ id: 78 }),
	// The two classes `configRefusal` matches a failure against.
	ConfigNotFoundError: class ConfigNotFoundError extends Error {},
	ConfigNotUsableError: class ConfigNotUsableError extends Error {}
}))

// The review gate, for the transport alone: `registerPipelineHandlers` installs
// one and nothing else in the application can call it, so catching it here is
// how a parked review's push is driven without parking a review.
vi.mock("$lib/server/pipelines/runtime/reviewGate", async (importOriginal) => {
	const actual =
		await importOriginal<
			typeof import("$lib/server/pipelines/runtime/reviewGate")
		>()
	return {
		...actual,
		setReviewTransport: (push: any) => {
			seam.reviewPush = push
		}
	}
})

// The smallest registration function in the application — one handler, no side
// effects — stood in for purely as a seam, the same way
// `index.interestGate.test.ts` uses it: it is the cheapest way to get hold of
// the per-connection `emitToUser` that the run pushes outside this file
// (`utils/runReply.ts`, `sockets/sessions.ts`) are handed.
vi.mock("./language", () => ({
	registerLanguageHandlers: (
		socket: any,
		emitToUser: (event: string, data: any) => any
	) => {
		seam.emitters.set(socket.id, emitToUser)
	}
}))

import { connectSockets } from "./index"

const ADMIN = { id: 1, username: "owner", isAdmin: true }
/** The same person in a second tab — two sockets in one user room. */
const SECOND_TAB = { id: 1, username: "owner", isAdmin: true }

const SLUG = "test:spec/panel"

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
			/** The real `emitToUser` this socket's handlers were handed. */
			emitToUser: seam.emitters.get(id)!,
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

/**
 * Let the transport install and its queued push drain.
 *
 * `registerPipelineHandlers` installs through a dynamic `import().then(…)`, and
 * a push is queued on `reviewPushes` rather than awaited by its caller — so
 * both need the macrotask queue to turn over, not just the microtask one.
 */
const flush = async () => {
	for (let i = 0; i < 3; i++)
		await new Promise((resolve) => setTimeout(resolve, 0))
}

beforeEach(async () => {
	// Drain any transport install still queued from the previous test's
	// connects BEFORE the capture is cleared. `registerPipelineHandlers`
	// installs through a dynamic `import().then(…)`, so the callback outlives
	// the test that connected the socket — and a transport left over from a
	// torn-down harness answers the gate against an empty room, which looks
	// exactly like "nobody is interested".
	await flush()
	seam.queries.length = 0
	seam.reviewPush = null
	seam.emitters.clear()
	// Everything `specForSlug`, `configInSpec` and the transport's redaction
	// read. A missing row is a refusal in each of them, which is not what any
	// of these tests is about.
	seam.rows.pipelineSpecs = [{ id: 1, slug: SLUG, name: "Panel" }]
	seam.rows.pipelineConfigs = [{ id: 10, specId: 1, name: "Editable" }]
	seam.rows.users = [{ isAdmin: true }]
})

afterEach(() => {
	harnesses.splice(0).forEach((h) => h.teardown())
	vi.clearAllMocks()
})

/** The one read that says the whole view was actually built. */
const viewsBuilt = () =>
	seam.queries.filter((q) => q === "namespaceView").length
const events = (h: { emits: Array<{ event: string }> }) =>
	h.emits.map((e) => e.event)

describe("pipelines:setOption — the view cascade", () => {
	test("writes, and builds no view when nobody wants one", async () => {
		const h = fresh()
		const owner = h.connect("s1", ADMIN)
		// Interest in the family, but not in the view: the panel is what holds
		// `pipelines:get`, and no panel is open.
		await owner.declare("pipelines:list")

		await owner.fire("pipelines:setOption", {
			slug: SLUG,
			optionId: "opt_x",
			value: 7
		})

		// The command ran — a write is never gated (plan ruling 2).
		expect(seam.queries).toContain("writeOption")
		// The answer did not: no interest, no thunk, no read, no emit.
		expect(viewsBuilt()).toBe(0)
		expect(h.emits).toEqual([])
	})

	test("builds it once for a socket that declared the key", async () => {
		const h = fresh()
		const owner = h.connect("s1", ADMIN)
		await owner.declare("pipelines:get")

		await owner.fire("pipelines:setOption", {
			slug: SLUG,
			optionId: "opt_x",
			value: 7
		})

		expect(viewsBuilt()).toBe(1)
		expect(events(h)).toEqual(["pipelines:get"])
		const view = h.emits[0]
		// Delivered per socket (ruling 5), carrying the payload rather than the
		// thunk that built it.
		expect(view.target).toBe("s1")
		expect(view.data.pipeline.slug).toBe(SLUG)
	})

	test("builds it ONCE for two interested tabs, and reaches both", async () => {
		const h = fresh()
		const one = h.connect("s1", ADMIN)
		const two = h.connect("s2", SECOND_TAB)
		await one.declare("pipelines:get")
		await two.declare("pipelines:get")

		await one.fire("pipelines:setOption", {
			slug: SLUG,
			optionId: "opt_x",
			value: 7
		})

		expect(viewsBuilt()).toBe(1)
		expect(h.emits.map((e) => e.target)).toEqual(["s1", "s2"])
	})
})

describe("pipelines:createConfig — the view that rides on an own reply", () => {
	test("answers the caller with the view even when nobody wants pipelines:get", async () => {
		const h = fresh()
		const owner = h.connect("s1", ADMIN)
		// The caller always holds its own reply's key before the request ships
		// (the typed emit flushes the interest sync first). It does NOT hold
		// `pipelines:get`, which is the whole difference this test pins.
		await owner.declare("pipelines:createConfig")

		await owner.fire("pipelines:createConfig", { slug: SLUG, name: "Mine" })

		// Built eagerly, because the own reply carries it — and built ONCE,
		// which is why the two answers cannot disagree.
		expect(viewsBuilt()).toBe(1)
		expect(events(h)).toEqual(["pipelines:createConfig"])
		expect(h.emits[0].target).toBe("s1")
		expect(h.emits[0].data.configId).toBe(77)
		expect(h.emits[0].data.pipeline.slug).toBe(SLUG)
	})

	test("sends the cascade as well to a socket holding the view's key", async () => {
		const h = fresh()
		const owner = h.connect("s1", ADMIN)
		await owner.declare("pipelines:createConfig", "pipelines:get")

		await owner.fire("pipelines:createConfig", { slug: SLUG, name: "Mine" })

		// Still one read for both emits, and in the order it has always sent
		// them: the refreshed view, then the id that names what was made.
		expect(viewsBuilt()).toBe(1)
		expect(events(h)).toEqual(["pipelines:get", "pipelines:createConfig"])
	})
})

describe("pipelines:acknowledgeConfigNotices — the notice re-read", () => {
	test("dismisses the notice and re-reads nothing when no banner is open", async () => {
		const h = fresh()
		const owner = h.connect("s1", ADMIN)
		await owner.declare("pipelines:list")

		await owner.fire("pipelines:acknowledgeConfigNotices", {
			slug: SLUG,
			configId: 10,
			noticeId: 3
		})

		expect(seam.queries).toContain("acknowledgeNotices")
		expect(seam.queries).not.toContain("pendingNotices")
		expect(h.emits).toEqual([])
	})

	test("re-reads them once for a socket that wants the list", async () => {
		const h = fresh()
		const owner = h.connect("s1", ADMIN)
		await owner.declare("pipelines:configNotices")

		await owner.fire("pipelines:acknowledgeConfigNotices", {
			slug: SLUG,
			configId: 10,
			noticeId: 3
		})

		expect(
			seam.queries.filter((q) => q === "pendingNotices")
		).toHaveLength(1)
		expect(events(h)).toEqual(["pipelines:configNotices"])
		expect(h.emits[0].target).toBe("s1")
		expect(h.emits[0].data).toEqual({ configId: 10, notices: [] })
	})
})

describe("the review gate's push transport", () => {
	test("delivers a gated push to the declaring socket, never to the room", async () => {
		const h = fresh()
		const one = h.connect("s1", ADMIN)
		h.connect("s2", SECOND_TAB)
		await flush()
		await one.declare("pipelines:reviewRequested")

		seam.reviewPush!(ADMIN.id, "pipelines:reviewRequested", {
			id: "rv-1",
			specId: "test:spec/panel",
			nodeKey: "gate"
		})
		await flush()

		expect(h.emits).toHaveLength(1)
		expect(h.emits[0].target).toBe("s1")
		expect(h.emits[0].event).toBe("pipelines:reviewRequested")
		expect(h.emits[0].data.id).toBe("rv-1")
		// The room emit is what the gate replaces here, so its absence is the
		// claim: the second tab is not sent a card it never asked for.
		expect(h.emits.map((e) => e.target)).not.toContain("user_1")
	})

	test("reads no recipient row when nobody wants the push", async () => {
		const h = fresh()
		const one = h.connect("s1", ADMIN)
		await flush()
		await one.declare("pipelines:list")

		seam.reviewPush!(ADMIN.id, "pipelines:reviewRequested", { id: "rv-2" })
		await flush()

		// The gate sits in front of the `users.isAdmin` read the redaction
		// needs, so a push nobody wants costs nothing at all.
		expect(seam.queries).not.toContain("select(users)")
		expect(h.emits).toEqual([])
	})

	test("an ungated push keeps the room emit it has always had", async () => {
		const h = fresh()
		const one = h.connect("s1", ADMIN)
		h.connect("s2", SECOND_TAB)
		await flush()
		await one.declare("pipelines:reviewRequested")

		// `pipelines:reviewClosed` is not in the gated set, so it must behave
		// exactly as before: one emit, to the whole user room, redacted against
		// a freshly read recipient row.
		seam.reviewPush!(ADMIN.id, "harness:ungated", { id: "rv-1" })
		await flush()

		expect(seam.queries).toContain("select(users)")
		expect(h.emits).toHaveLength(1)
		expect(h.emits[0].target).toBe("user_1")
		expect(h.emits[0].event).toBe("harness:ungated")
	})
})

describe("pipelines:progress — the scoped run push", () => {
	test("reaches the tab on that session and no other", async () => {
		// The push three sites outside this file send
		// (`utils/runReply.ts`, `sockets/sessions.ts`), through the
		// `emitToUser` a handler is handed. The scope comes from the real
		// `SCOPED_EVENTS` table: `payload.sessionId`.
		const h = fresh()
		const watching = h.connect("s1", ADMIN)
		const elsewhere = h.connect("s2", SECOND_TAB)
		await watching.declare("pipelines:progress#42")
		await elsewhere.declare("pipelines:progress#7")

		watching.emitToUser("pipelines:progress", {
			runId: "r-1",
			sessionId: 42,
			specId: 3,
			label: "respond"
		})

		expect(h.emits.map((e) => e.target)).toEqual(["s1"])
		expect(h.emits[0].data.runId).toBe("r-1")
	})

	test("reaches nobody when every tab is on another session", async () => {
		const h = fresh()
		const elsewhere = h.connect("s1", ADMIN)
		await elsewhere.declare("pipelines:progress#7")

		elsewhere.emitToUser("pipelines:progress", {
			runId: "r-1",
			sessionId: 42,
			done: true
		})

		expect(h.emits).toEqual([])
	})

	test("a bare declaration still hears every session's run", async () => {
		// The rule that keeps phase 3 from narrowing anybody silently: a client
		// that never asked for a scope asked for all of them.
		const h = fresh()
		const anyRun = h.connect("s1", ADMIN)
		await anyRun.declare("pipelines:progress")

		anyRun.emitToUser("pipelines:progress", { runId: "r-1", sessionId: 42 })

		expect(h.emits.map((e) => e.target)).toEqual(["s1"])
	})
})
