/**
 * The `connections:` and `connectionDefaults:` families through the real gate.
 *
 * Both families are the administrator's inventory, and both are re-sent after
 * every write: `connections:list` alone cascades from ten handlers in
 * `connections.ts` and from two more in `koboldcpp.ts`/`ollama.ts`. Each of
 * those pushes is TWO queries — every endpoint, then every model on the
 * instance — paid until now whether or not a view was open to receive them.
 * They are the thunk form now, so these tests assert on the QUERIES rather than
 * on the emits: skipping the emit alone would save nothing, the queries are the
 * cost.
 *
 * The gate applies to a handler's own reply exactly as it does to its cascades:
 * the client holds the reply's key before the request even goes out (the typed
 * emit flushes the interest sync first), so the own reply reaches the caller and
 * only the cascades nobody wants are skipped.
 *
 * Driven through the real `connectSockets`, the real `register` and the real
 * `interest:sync` handler. `GATED_EVENTS` is mocked to add the events this
 * slice converts — the architect adds them to the shared set once the client
 * half has landed too, and these tests are what say the server half is ready
 * for that.
 *
 * `$lib/server/db` is a recording fake rather than PGlite: what is being pinned
 * here is which reads happen, and a fake that names each read is the only way
 * to assert that one did NOT. The gate itself is never stubbed — a test that
 * stubbed it would pass against a gate that had been deleted.
 */
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest"

const seam = vi.hoisted(() => {
	/** Every read, in the order it happened — the cost the gate exists to skip. */
	const queries: string[] = []

	/**
	 * The table a `.from()` was handed, by the name drizzle itself keeps on it.
	 * Read through the symbol rather than a hand-written map so a renamed table
	 * renames its label with it — and so this factory, which is hoisted above
	 * every import, needs no module of its own.
	 */
	const DRIZZLE_NAME = Symbol.for("drizzle:Name")
	const nameOf = (table: any) => table?.[DRIZZLE_NAME] ?? "?"

	/**
	 * A drizzle-ish builder: every method chains, awaiting it records the call
	 * under the table it was pointed at. A chain that is never awaited records
	 * nothing, which is right — it is a fragment of one query, not a query.
	 */
	function chain(verb: string, result: () => any = () => []) {
		let label = verb
		const self: any = {
			from: (table: any) => {
				label = `${verb}:${nameOf(table)}`
				return self
			},
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
				return Promise.resolve(result()).then(ok, err)
			}
		}
		return self
	}

	const rows = {
		/** What `connections:list` finds. One endpoint, no models. */
		endpoints: [
			{
				id: 7,
				name: "Rig",
				type: "openai",
				baseUrl: "http://localhost:1234",
				modality: "text",
				preset: null,
				notes: null,
				modelsSyncedAt: null,
				modelsSyncError: null
			}
		] as any[]
	}

	const db: any = {
		query: {
			connections: {
				findMany: async () => {
					queries.push("connections.findMany")
					return rows.endpoints
				},
				findFirst: async () => {
					queries.push("connections.findFirst")
					return rows.endpoints[0]
				}
			},
			// Recorded but never expected: `systemSettings:get` is gated too,
			// and no socket here declares it. A label showing up in `queries`
			// is the gate having let a cascade through.
			systemSettings: {
				findFirst: async () => {
					queries.push("systemSettings.findFirst")
					return {}
				}
			},
			ollamaSettings: {
				findFirst: async () => {
					queries.push("ollamaSettings.findFirst")
					return {}
				}
			},
			koboldCppSettings: {
				findFirst: async () => {
					queries.push("koboldCppSettings.findFirst")
					return {}
				}
			}
		},
		// `select` is labelled at its `.from()`; the three writers name their
		// table straight away.
		select: () => chain("select"),
		update: (t: any) => chain(`update:${nameOf(t)}`),
		insert: (t: any) => chain(`insert:${nameOf(t)}`),
		delete: (t: any) => chain(`delete:${nameOf(t)}`),
		transaction: async (fn: any) => fn(db)
	}

	return { queries, rows, db }
})

vi.mock("$lib/shared/sockets/interest", async (importOriginal) => {
	const actual =
		await importOriginal<typeof import("$lib/shared/sockets/interest")>()
	// The real set, plus this batch's — spelled here rather than in a module
	// const, because this factory is hoisted above every one of them.
	// `systemSettings:get` already ships gated and is listed for the reader:
	// these tests turn on whether the connections writes cascade into it.
	// Everything else — the scope table, the restricted prefixes, the key
	// helpers — stays exactly as it ships.
	const gated = new Set([
		...actual.GATED_EVENTS,
		"connections:list",
		"connections:get",
		"connectionDefaults:list",
		"systemSettings:get"
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
// actually loads are stood in for.
vi.mock("$lib/server/db", async () => {
	const schema = await import("$lib/server/db/schema")
	return {
		db: seam.db,
		schema,
		dbReady: Promise.resolve(),
		getCryptoSecretKey: () => "connections-interest-gate-secret",
		closeDatabase: async () => {},
		reopenDatabase: async () => {}
	}
})

import { connectSockets } from "./index"

const ADMIN = { id: 1, username: "owner", isAdmin: true }
/** The same person in a second tab — two sockets in one user room. */
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

/**
 * Let any transport install queued by a previous connect drain.
 *
 * `registerPipelineHandlers` installs through a dynamic `import().then(…)`, so
 * its callback outlives the test that connected the socket — and a stray
 * install landing mid-test would write into the capture these tests read.
 */
const flush = async () => {
	for (let i = 0; i < 3; i++)
		await new Promise((resolve) => setTimeout(resolve, 0))
}

beforeEach(async () => {
	await flush()
	seam.queries.length = 0
})

afterEach(() => {
	harnesses.splice(0).forEach((h) => h.teardown())
	vi.restoreAllMocks()
})

/** The one read that says the endpoint list was actually built. */
const listsBuilt = () =>
	seam.queries.filter((q) => q === "connections.findMany").length
const events = (h: { emits: Array<{ event: string }> }) =>
	h.emits.map((e) => e.event)

describe("connections:delete — the list and settings cascades", () => {
	const DELETE = { id: 7 } as any

	test("deletes and scans nothing when nobody wants the list", async () => {
		const h = fresh()
		const owner = h.connect("s1", ADMIN)
		// The caller always holds its own reply's key before the request ships
		// (the typed emit flushes the interest sync first) — declared here,
		// but neither cascade's key, so both stay closed.
		await owner.declare("connections:delete")

		await owner.fire("connections:delete", DELETE)

		// The write ran and the caller's own reply went out.
		expect(seam.queries).toContain("delete:connections")
		expect(events(h)).toContain("connections:delete")
		// Neither cascade did: no interest, no thunk, no scan, no emit.
		expect(listsBuilt()).toBe(0)
		expect(events(h)).not.toContain("connections:list")
		expect(seam.queries).not.toContain("select:connection_models")
		// The star rides on `systemSettings:get`, which is gated the same way.
		expect(events(h)).not.toContain("systemSettings:get")
		expect(seam.queries).not.toContain("systemSettings.findFirst")
	})

	test("builds the list once for a socket that declared its key", async () => {
		const h = fresh()
		const owner = h.connect("s1", ADMIN)
		await owner.declare("connections:delete", "connections:list")

		await owner.fire("connections:delete", DELETE)

		// One endpoint scan and one model scan — the two reads behind the list.
		expect(listsBuilt()).toBe(1)
		expect(seam.queries).toContain("select:connection_models")
		// The cascade first, in the order this handler has always sent it,
		// then the reply. The settings cascade is still closed.
		expect(events(h)).toEqual(["connections:list", "connections:delete"])
		const list = h.emits.find((e) => e.event === "connections:list")!
		// Delivered per socket (ruling 5), carrying the payload rather than the
		// thunk that built it.
		expect(list.target).toBe("s1")
		expect(list.data.connectionsList).toHaveLength(1)
		expect(list.data.connectionsList[0].id).toBe(7)
	})

	test("lands on the interested socket only", async () => {
		const h = fresh()
		const one = h.connect("s1", ADMIN)
		const two = h.connect("s2", SECOND_TAB)
		await one.declare("connections:list")
		// The second tab is in the same user room and wants nothing gated.
		await two.declare()

		await one.fire("connections:delete", DELETE)

		expect(listsBuilt()).toBe(1)
		expect(
			h.emits
				.filter((e) => e.event === "connections:list")
				.map((e) => e.target)
		).toEqual(["s1"])
	})

	test("builds the list ONCE for two interested tabs, and reaches both", async () => {
		const h = fresh()
		const one = h.connect("s1", ADMIN)
		const two = h.connect("s2", SECOND_TAB)
		await one.declare("connections:list")
		await two.declare("connections:list")

		await one.fire("connections:delete", DELETE)

		expect(listsBuilt()).toBe(1)
		expect(
			h.emits
				.filter((e) => e.event === "connections:list")
				.map((e) => e.target)
				.sort()
		).toEqual(["s1", "s2"])
	})
})

describe("the own replies", () => {
	test("connections:list reaches the socket holding its key, and only it", async () => {
		const h = fresh()
		const one = h.connect("s1", ADMIN)
		const two = h.connect("s2", SECOND_TAB)
		await one.declare("connections:list")
		await two.declare()

		await one.fire("connections:list", {})

		expect(listsBuilt()).toBe(1)
		expect(h.emits.map((e) => e.target)).toEqual(["s1"])
		expect(h.emits[0].event).toBe("connections:list")
		expect(h.emits[0].data.connectionsList[0].name).toBe("Rig")
	})

	test("connectionDefaults:list reaches the socket holding its key", async () => {
		const h = fresh()
		const one = h.connect("s1", ADMIN)
		const two = h.connect("s2", SECOND_TAB)
		await one.declare("connectionDefaults:list")
		await two.declare()

		await one.fire("connectionDefaults:list", {})

		// The matrix was built — the registry scan is its first read — and it
		// went to the one socket that asked for it.
		expect(seam.queries).toContain("select:pipeline_definition_registry")
		expect(h.emits.map((e) => e.target)).toEqual(["s1"])
		expect(h.emits[0].event).toBe("connectionDefaults:list")
	})

	test("a socket that declared nothing is sent no reply at all", async () => {
		const h = fresh()
		const one = h.connect("s1", ADMIN)
		await one.declare()

		await one.fire("connectionDefaults:list", {})

		// An own reply is built EAGERLY — the caller holds its key before the
		// request ships, so there is nothing to defer. What the gate decides is
		// delivery, and a socket that declared nothing is not a recipient.
		expect(seam.queries).toContain("select:pipeline_definition_registry")
		expect(h.emits).toEqual([])
	})
})
