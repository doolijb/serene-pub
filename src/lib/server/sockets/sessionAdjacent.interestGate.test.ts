/**
 * The session-adjacent families through the real gate — phase 2.
 *
 * Three different shapes of output are pinned here, because this batch has all
 * three:
 *
 *   1. **Cascades.** `scenes:create` re-sends the session's scene list and its
 *      scened message ids; `narrativeGraph:applyProposal` re-sends the whole
 *      graph list. Every one of those is a query — a scene scan, the graph
 *      list's counting reads — paid until now whether or not any view was open to receive it.
 *      They are the thunk form now, so these tests assert on the QUERIES
 *      rather than on the emits: skipping the emit alone would save nothing.
 *   2. **The two bypasses.** `taskQueue:update` and `activity:update` leave
 *      the server through a stored per-socket closure — a raw `socket.emit`
 *      that `sockets/index.ts` never sees and therefore cannot gate. Each
 *      closure now asks the gate itself, and these tests drive the closure
 *      the store actually holds, not a copy of it.
 *   3. **Scope fields.** `scenes:compile:progress` and
 *      `narrativeGraph:buildLog` gained the id their interest scope is
 *      derived from — neither the summarizer nor the graph builder knows it,
 *      so the socket layer adds it at the emit. Both are driven through the
 *      real handler with the collaborator stopped at the callback, so what is
 *      asserted is the payload production builds rather than a copy of it.
 *
 * The gate applies to a handler's own reply exactly as it does to its
 * cascades: the client holds the reply's key before the request even goes out
 * (the typed emit flushes the interest sync first), so the own reply reaches
 * the caller and only the cascades nobody wants are skipped.
 *
 * Driven through the real `connectSockets`, the real `register` and the real
 * `interest:sync` handler. `GATED_EVENTS` is mocked to add the events this
 * slice converts — the architect adds them to the shared set once the client
 * half has landed too, and these tests are what say the server half is ready
 * for that.
 *
 * `$lib/server/db` is a recording fake rather than PGlite: what is being
 * pinned here is which reads happen, and a fake that names each read is the
 * only way to assert that one did NOT. The gate itself is never stubbed — a
 * test that stubbed it would pass against a gate that had been deleted.
 */
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest"

const seam = vi.hoisted(() => {
	/** Every read, in the order it happened — the cost the gate exists to skip. */
	const queries: string[] = []

	/**
	 * A drizzle-ish builder: every method chains, awaiting it records the
	 * call. A chain that is never awaited — the `notExists` subqueries inside
	 * the graph list's count scans — records nothing, which is right: it is a
	 * fragment of one query, not a query.
	 */
	function chain(label: string, result: any = []) {
		let read = label
		const self: any = {
			// A select names its table (`select:scenes`), so a test can count
			// one kind of scan — the graph list's per-line counts read scenes
			// and history entries this way — without counting every select.
			from: (table: any) => {
				const name = table?.[Symbol.for("drizzle:Name")]
				if (typeof name === "string") read = `${label}:${name}`
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
				queries.push(read)
				return Promise.resolve(result).then(ok, err)
			}
		}
		return self
	}

	const rows = {
		/** The book every write here belongs to, owned by user 1. */
		lorebook: { id: 1, userId: 1, name: "Ambervale" },
		/** The session the scene is written into, owned by the same user. */
		session: { id: 1, userId: 1 },
		/** What `db.select(...)` answers with — the history entry's book. */
		select: [{ lorebookId: 1 }] as any[],
		/** What a scene scan finds. Empty everywhere but the compile test. */
		scenes: [] as any[]
	}

	const db: any = {
		query: {
			lorebooks: {
				findFirst: async () => {
					queries.push("lorebooks.findFirst")
					return rows.lorebook
				}
			},
			sessions: {
				// Told apart by shape: `columns: { userId }` is
				// `checkSessionAccess`, anything else the create handler's own
				// ownership read.
				findFirst: async (config: any) => {
					queries.push(
						config?.columns
							? "sessions.findFirst(access)"
							: "sessions.findFirst(owner)"
					)
					return rows.session
				}
			},
			sessionGuests: {
				findFirst: async () => {
					queries.push("sessionGuests.findFirst")
					return undefined
				}
			},
			scenes: {
				findMany: async () => {
					queries.push("scenes.findMany")
					return rows.scenes
				}
			},
			lorebookBindings: {
				findMany: async () => {
					queries.push("lorebookBindings.findMany")
					return []
				}
			},
			narrativeRelationships: {
				findMany: async () => {
					queries.push("narrativeRelationships.findMany")
					return []
				}
			}
		},
		select: () => chain("select", rows.select),
		update: () => chain("update"),
		insert: () =>
			chain("insert", [{ id: 10, sessionId: 1, lorebookId: 1 }]),
		delete: () => chain("delete"),
		execute: async () => {
			queries.push("execute")
			return { rows: [] }
		},
		transaction: async (fn: any) => fn(db)
	}

	return { queries, rows, db }
})

vi.mock("$lib/shared/sockets/interest", async (importOriginal) => {
	const actual =
		await importOriginal<typeof import("$lib/shared/sockets/interest")>()
	// The real set, plus this batch's five — spelled here rather than in a
	// module const, because this factory is hoisted above every one of them.
	// Everything else — the scope table, the restricted prefixes, the key
	// helpers — stays exactly as it ships.
	const gated = new Set([
		...actual.GATED_EVENTS,
		"scenes:create",
		"scenes:list",
		"scenes:scenedMessageIds",
		"narrativeGraph:list",
		"taskQueue:update",
		"activity:update"
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
		getCryptoSecretKey: () => "session-adjacent-interest-gate-secret",
		closeDatabase: async () => {},
		reopenDatabase: async () => {}
	}
})

/**
 * The summarizer, stopped at the one thing this file is about: the progress
 * frame it hands back. `sceneCompileHandler` builds the payload around it, and
 * capturing the call is what puts that construction — not a copy of it — under
 * test.
 */
const compileSeam = vi.hoisted(() => ({
	progress: {
		phase: "drafting" as const,
		batch: 1,
		totalBatches: 3,
		partial: {}
	}
}))

vi.mock("$lib/server/utils/summarizer", async (importOriginal) => {
	const actual =
		await importOriginal<typeof import("$lib/server/utils/summarizer")>()
	return {
		...actual,
		compileScenesForEntry: async (opts: any) => {
			opts.onProgress(compileSeam.progress)
			return { content: "a compiled summary", raw: "raw" }
		}
	}
})

vi.mock("$lib/server/pipelines/config/stepConfig", async (importOriginal) => {
	const actual =
		await importOriginal<
			typeof import("$lib/server/pipelines/config/stepConfig")
		>()
	return { ...actual, resolveStepConfigs: async () => ({}) }
})

vi.mock("$lib/server/connections/capabilityTarget", async (importOriginal) => {
	const actual =
		await importOriginal<
			typeof import("$lib/server/connections/capabilityTarget")
		>()
	return {
		...actual,
		resolveCapabilityTarget: async () => ({
			ok: true,
			connection: { id: 1, name: "Rig" },
			sampling: { id: 1, name: "Sampling" }
		})
	}
})

vi.mock("$lib/server/pipelines/runtime/receipts", async (importOriginal) => {
	const actual =
		await importOriginal<
			typeof import("$lib/server/pipelines/runtime/receipts")
		>()
	return { ...actual, saveReceipt: async () => {} }
})

/**
 * The graph builder, stopped at the one thing this file is about: the trace
 * entry it hands `onLlmCall`. The socket layer wraps that entry, and capturing
 * the call is what puts the wrapping — not a copy of it — under test.
 */
const buildSeam = vi.hoisted(() => ({
	entry: {
		label: "Character Extraction · Year 1",
		system: "sys",
		user: "usr",
		response: "{}"
	}
}))

vi.mock("$lib/server/utils/graphBuilder", async (importOriginal) => {
	const actual =
		await importOriginal<typeof import("$lib/server/utils/graphBuilder")>()
	return {
		...actual,
		buildGraphFromScenes: async (opts: any) => {
			opts.onLlmCall?.(buildSeam.entry)
			return {
				proposal: { nodes: [], relationships: [] },
				resolvedSceneCast: [],
				sceneLabels: [],
				seedTempIdMap: {},
				seedNodeNames: {}
			}
		}
	}
})

vi.mock("$lib/server/pipelines/config/graphSteps", async (importOriginal) => {
	const actual =
		await importOriginal<
			typeof import("$lib/server/pipelines/config/graphSteps")
		>()
	// One step, chosen for nothing in particular: `perspective` is the one the
	// handler reads the build-wide connection off, and it falls through to the
	// capability default mocked above.
	return {
		...actual,
		resolveGraphStepConfigs: async () => ({ perspective: {} }) as any
	}
})

// The duplicate scan is a cascade of its own with its own cost; what these
// tests are about is the graph LIST, so the scan is stubbed to a recorded
// no-op rather than being run against the fake.
vi.mock(
	"$lib/server/utils/duplicateBindingDetection",
	async (importOriginal) => {
		const actual =
			await importOriginal<
				typeof import("$lib/server/utils/duplicateBindingDetection")
			>()
		return {
			...actual,
			findDuplicateCandidates: async () => {
				seam.queries.push("findDuplicateCandidates")
				return []
			}
		}
	}
)

import { connectSockets } from "./index"
import { interestKey } from "$lib/shared/sockets/interest"
import { taskQueue } from "$lib/server/utils/taskQueue"
import { activityError, activityStore } from "$lib/server/utils/activityStore"

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
		/** What the RAW `socket.emit` bypasses put on this socket's wire. */
		const raw: Array<{ event: string; data: any }> = []
		const socket: any = {
			id,
			user,
			pendingSetup: [],
			emit: (event: string, data: any) => raw.push({ event, data }),
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
			raw,
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

/** Activity rows are a module singleton — each test cleans up after itself. */
const startedActivities: string[] = []

beforeEach(() => {
	seam.queries.length = 0
	seam.rows.select = [{ lorebookId: 1 }]
	seam.rows.scenes = []
})

afterEach(() => {
	harnesses.splice(0).forEach((h) => h.teardown())
	for (const id of startedActivities.splice(0)) activityStore.remove(id)
	vi.restoreAllMocks()
})

/** The one read that says a scene list or an id list was actually built. */
const sceneScans = () =>
	seam.queries.filter((q) => q === "scenes.findMany").length
/** How many times one labelled read ran (`select:scenes`, `update`, …). */
const reads = (label: string) => seam.queries.filter((q) => q === label).length
const events = (h: { emits: Array<{ event: string }> }) =>
	h.emits.map((e) => e.event)

const NEW_SCENE = {
	scene: { lorebookId: 1, sessionId: 1, historyEntryId: 7 }
} as any

describe("scenes:create — the two session cascades", () => {
	test("delivers the caller's own reply and scans nothing when nobody wants the lists", async () => {
		const h = fresh()
		const owner = h.connect("s1", ADMIN)
		// The caller always holds its own reply's key before the request ships
		// (the typed emit flushes the interest sync first) — declared here,
		// but neither cascade's key, so both stay closed.
		await owner.declare("scenes:create")

		await owner.fire("scenes:create", NEW_SCENE)

		// The write ran and the caller's own reply reached it, per socket.
		expect(seam.queries).toContain("insert")
		expect(events(h)).toEqual(["scenes:create"])
		expect(h.emits[0].target).toBe("s1")
		// The cascades did not: no interest, no thunk, no scan, no emit.
		expect(sceneScans()).toBe(0)
	})

	test("builds each list once for a socket that declared its key", async () => {
		const h = fresh()
		const owner = h.connect("s1", ADMIN)
		await owner.declare(
			"scenes:create",
			"scenes:list",
			"scenes:scenedMessageIds"
		)

		await owner.fire("scenes:create", NEW_SCENE)

		// One scan each — the list, then the captured message ids.
		expect(sceneScans()).toBe(2)
		// The cascades first, in the order this handler has always sent them,
		// then the reply.
		expect(events(h)).toEqual([
			"scenes:list",
			"scenes:scenedMessageIds",
			"scenes:create"
		])
		const ids = h.emits.find((e) => e.event === "scenes:scenedMessageIds")!
		// Delivered per socket (ruling 5), carrying the payload rather than
		// the thunk that built it — and ONCE, where this used to send the
		// same payload twice.
		expect(ids.target).toBe("s1")
		expect(ids.data).toEqual({ sessionId: 1, scenedMessageIds: [] })
	})

	test("both list payloads name the session they are about", async () => {
		const h = fresh()
		const owner = h.connect("s1", ADMIN)
		await owner.declare("scenes:list", "scenes:scenedMessageIds")

		await owner.fire("scenes:create", NEW_SCENE)

		// Neither list is ABOUT a row that names its session — one is scenes,
		// the other bare message ids — so the id is put on the payload for the
		// scope to be read off, and it is the same builder that answers the
		// handler's own reply.
		const list = h.emits.find((e) => e.event === "scenes:list")!
		const ids = h.emits.find((e) => e.event === "scenes:scenedMessageIds")!
		expect(list.data.sessionId).toBe(1)
		expect(ids.data.sessionId).toBe(1)

		h.emits.length = 0
		await owner.fire("scenes:list", { sessionId: 1 })
		expect(h.emits[0].data.sessionId).toBe(1)

		h.emits.length = 0
		await owner.fire("scenes:scenedMessageIds", { sessionId: 1 })
		expect(h.emits[0].data.sessionId).toBe(1)
	})

	test("wants one list and not the other: only that one is scanned", async () => {
		const h = fresh()
		const owner = h.connect("s1", ADMIN)
		await owner.declare("scenes:create", "scenes:list")

		await owner.fire("scenes:create", NEW_SCENE)

		expect(sceneScans()).toBe(1)
		expect(events(h)).toEqual(["scenes:list", "scenes:create"])
	})

	test("builds each list ONCE for two interested tabs, and reaches both", async () => {
		const h = fresh()
		const one = h.connect("s1", ADMIN)
		const two = h.connect("s2", SECOND_TAB)
		await one.declare("scenes:list")
		await two.declare("scenes:list")

		await one.fire("scenes:create", NEW_SCENE)

		expect(sceneScans()).toBe(1)
		expect(
			h.emits
				.filter((e) => e.event === "scenes:list")
				.map((e) => e.target)
				.sort()
		).toEqual(["s1", "s2"])
	})
})

describe("scenes:listByLorebook — the reply a lorebook view asks for", () => {
	// Every lorebook view declares this event SCOPED to its book, so a reply
	// whose payload does not name the book resolves to no scope and is sent to
	// nobody. It shipped that way — `{ sceneList }` alone — and every
	// lorebook-side scene list went silent. Asserted on the payload the real
	// handler emits through the real gate, not on a copy of its shape.
	test("reaches the socket holding the book's key, naming the book", async () => {
		const h = fresh()
		const owner = h.connect("s1", ADMIN)
		await owner.declare(interestKey("scenes:listByLorebook", 1))

		await owner.fire("scenes:listByLorebook", { lorebookId: 1 })

		const sent = h.emits.find((e) => e.event === "scenes:listByLorebook")
		expect(sent?.target).toBe("s1")
		expect(sent?.data.lorebookId).toBe(1)
	})

	test("does not reach a socket reading another book", async () => {
		const h = fresh()
		const other = h.connect("s1", ADMIN)
		await other.declare(interestKey("scenes:listByLorebook", 2))

		await other.fire("scenes:listByLorebook", { lorebookId: 1 })

		expect(events(h)).not.toContain("scenes:listByLorebook")
	})
})

describe("narrativeGraph:applyProposal — the graph list cascade", () => {
	/** An empty build parked at review, and the apply that answers it. */
	const EMPTY_PROPOSAL = () => {
		const proposal = { nodes: [], relationships: [] }
		const activityId = activityStore.start({
			userId: ADMIN.id,
			lorebookId: 1,
			lorebookLabel: "Ambervale",
			mode: "extend"
		})
		startedActivities.push(activityId)
		activityStore.update(activityId, {
			status: "review",
			proposal,
			// One scene read, so the apply stamps it graphed — an update.
			processedSceneIds: [1],
			processedHistoryEntryIds: []
		})
		return { lorebookId: 1, activityId, proposal } as any
	}

	test("does not re-count the book when nobody wants the list", async () => {
		const h = fresh()
		const owner = h.connect("s1", ADMIN)
		await owner.declare("narrativeGraph:applyProposal")

		await owner.fire("narrativeGraph:applyProposal", EMPTY_PROPOSAL())

		// The apply itself ran, and its own reply — an ungated event in this
		// slice — went out as the room emit it has always been.
		expect(seam.queries).toContain("update")
		expect(events(h)).toContain("narrativeGraph:applyProposal")
		// The counting reads behind the list did not happen at all: no scene
		// read, and only the apply's own world-lore screen read entries.
		expect(reads("select:scenes")).toBe(0)
		expect(reads("select:lorebook_entries")).toBe(1)
		expect(sceneScans()).toBe(0)
		expect(events(h)).not.toContain("narrativeGraph:list")
	})

	test("counts once, and delivers the list, for a socket that declared it", async () => {
		const h = fresh()
		const owner = h.connect("s1", ADMIN)
		await owner.declare(
			"narrativeGraph:list",
			"narrativeGraph:applyProposal"
		)

		await owner.fire("narrativeGraph:applyProposal", EMPTY_PROPOSAL())

		// The list's two counting reads, once each — every scene's line and
		// flags, and every line's direct history entries (`buildGraphList`,
		// per-line counts) — beside the apply's own world-lore screen.
		expect(reads("select:scenes")).toBe(1)
		expect(reads("select:lorebook_entries")).toBe(2)
		const list = h.emits.find((e) => e.event === "narrativeGraph:list")!
		expect(list.target).toBe("s1")
		expect(list.data.nodes).toEqual([])
		expect(list.data.ungraphedSceneCount).toBe(0)
		// The list precedes the reply, as it always has.
		expect(events(h).indexOf("narrativeGraph:list")).toBeLessThan(
			events(h).indexOf("narrativeGraph:applyProposal")
		)
	})
})

describe("taskQueue:update — the stored per-socket emitter", () => {
	/** The closure the queue actually holds for one socket. */
	function storedEmitter(spy: ReturnType<typeof vi.spyOn>, at: number) {
		return spy.mock.calls[at][0] as (event: string, data: any) => void
	}

	test("reaches only the tab that declared it, and skips the one that did not", async () => {
		const spy = vi.spyOn(taskQueue, "registerEmitter")
		const h = fresh()
		const watching = h.connect("s1", ADMIN)
		const idle = h.connect("s2", SECOND_TAB)
		await watching.declare("taskQueue:update")
		await idle.declare("activity:update")

		const payload = { tasks: [] }
		storedEmitter(spy, 0)("taskQueue:update", payload)
		storedEmitter(spy, 1)("taskQueue:update", payload)

		expect(watching.raw).toContainEqual({
			event: "taskQueue:update",
			data: payload
		})
		expect(idle.raw).toEqual([])
	})

	test("an ungated event keeps today's behaviour — both tabs, no declaration", async () => {
		const spy = vi.spyOn(taskQueue, "registerEmitter")
		const h = fresh()
		const one = h.connect("s1", ADMIN)
		const two = h.connect("s2", SECOND_TAB)

		storedEmitter(spy, 0)("taskQueue:somethingUngated", { tasks: [] })
		storedEmitter(spy, 1)("taskQueue:somethingUngated", { tasks: [] })

		expect(one.raw).toHaveLength(1)
		expect(two.raw).toHaveLength(1)
	})

	test("the connect-time snapshot is skipped, and `taskQueue:get` answers a socket that asked", async () => {
		const h = fresh()
		const admin = h.connect("s1", ADMIN)
		// Nothing has been synced at connect — the interest set is empty, so
		// the unsolicited snapshot is not sent. The panel's own request, which
		// travels behind its interest, is what fills it.
		expect(admin.raw).toEqual([])

		await admin.declare("taskQueue:update")
		await admin.fire("taskQueue:get")

		expect(admin.raw.map((e) => e.event)).toEqual(["taskQueue:update"])
	})
})

describe("activity:update — the stored per-socket send", () => {
	function startScene(userId: number) {
		const id = activityStore.startScene({
			userId,
			sceneId: 1234,
			lorebookId: 99,
			lorebookLabel: "Ambervale"
		})
		startedActivities.push(id)
		return id
	}

	test("a store push reaches only the tab that declared it", async () => {
		const h = fresh()
		const watching = h.connect("s1", ADMIN)
		const idle = h.connect("s2", SECOND_TAB)
		await watching.declare("activity:update")
		await idle.declare("taskQueue:update")

		startScene(ADMIN.id)

		expect(watching.raw.map((e) => e.event)).toContain("activity:update")
		expect(idle.raw).toEqual([])
	})

	test("the redaction still runs on everything that gets through", async () => {
		const h = fresh()
		const member = h.connect("s1", { id: 2, username: "m", isAdmin: false })
		await member.declare("activity:update")

		const id = startScene(2)
		activityStore.updateScene(id, {
			status: "error",
			...activityError(
				new Error("KoboldCPP API error at http://192.168.1.5:5001")
			)
		})

		const pushed = member.raw
			.filter((e) => e.event === "activity:update")
			.at(-1)!
		const card = pushed.data.activities.find((a: any) => a.id === id)
		// The store's own row names the connection; what left the server does
		// not — the gate narrowed WHO receives, never WHAT they receive.
		expect(activityStore.getById(id)).toHaveProperty("connection")
		expect(card).not.toHaveProperty("connection")
	})
})

describe("the scope fields the gate reads", () => {
	test("a compile progress frame names the history entry it is about", async () => {
		const h = fresh()
		const owner = h.connect("s1", ADMIN)
		await owner.declare(
			"scenes:compile:progress",
			"scenes:compile:complete"
		)
		// The compile reads the entry and its book in one joined row, then the
		// scenes filed under it.
		seam.rows.select = [
			{
				entry: {
					id: 42,
					lorebookId: 1,
					typeId: "core:entry/history",
					title: "Year 1",
					keys: [],
					secondaryKeys: [],
					fields: { year: 1 },
					createdAt: new Date("2026-01-01T00:00:00.000Z"),
					updatedAt: new Date("2026-01-01T00:00:00.000Z")
				},
				lorebook: seam.rows.lorebook
			}
		]
		seam.rows.scenes = [
			{ id: 3, lorebookId: 1, historyEntryId: 42, summary: "s" }
		]

		await owner.fire("scenes:compile", { historyEntryId: 42 })

		const frame = h.emits.find(
			(e) => e.event === "scenes:compile:progress"
		)!
		// The summarizer's own frame said nothing about which entry it was
		// compiling; the handler puts the id the request named on it, which is
		// what a per-entry interest key is matched against.
		expect(compileSeam.progress).not.toHaveProperty("historyEntryId")
		expect(frame.data).toEqual({
			historyEntryId: 42,
			// The reading it was asked at (main, now): one entry compiled on
			// two lines is two runs, and a modal hears only its own.
			branchId: null,
			moment: null,
			phase: "drafting",
			batch: 1,
			totalBatches: 3,
			partial: {}
		})
		// The terminal frame has always carried it; now both do.
		const done = h.emits.find((e) => e.event === "scenes:compile:complete")!
		expect(done.data.historyEntryId).toBe(42)
	})

	test("a build log entry names the book the build was asked for", async () => {
		const h = fresh()
		const owner = h.connect("s1", ADMIN)
		await owner.declare("narrativeGraph:buildLog")
		seam.rows.scenes = [
			{
				id: 3,
				lorebookId: 1,
				summary: "Aria met Bram.",
				graphed: false,
				selectedMessageIds: [],
				historyEntry: { id: 42, fields: { year: 1 } }
			}
		]

		await owner.fire("narrativeGraph:build", {
			lorebookId: 1,
			mode: "extend"
		})

		const logged = h.emits.find(
			(e) => e.event === "narrativeGraph:buildLog"
		)!
		// `buildGraphFromScenes` hands `onLlmCall` the call it just made and
		// nothing else — it has no idea which book started it — so the socket
		// layer adds the book, which is the shape the gate reads.
		expect(buildSeam.entry).not.toHaveProperty("lorebookId")
		expect(logged.data).toEqual({ ...buildSeam.entry, lorebookId: 1 })
	})
})
