/**
 * The content families through the real gate — phase 2, the `lorebooks:*`,
 * `entries:*` and `bindingSuggestions:*` cascades.
 *
 * Every write in these three files finishes by pushing a list nobody asked
 * for: the whole lorebook list after a create, the cast after a binding, one
 * type's entries after every entry write, the suggestion list after a
 * decision. Each push is a query — the lorebook list is every book with its
 * entry ids, its binding ids and its tags; the cast is a three-way join; the
 * suggestion list is a derive-reconcile-read pass over the annotation tables —
 * and until this slice all of it was paid whether or not any view was open to
 * receive it. The cascades are the thunk form now, so these tests assert on
 * the QUERIES rather than on the emits: skipping the emit alone would save
 * nothing.
 *
 * Two of them also assert a COUNT rather than a presence, and that is the
 * point of those two: `lorebooks:create` and `lorebooks:createBinding` used to
 * send their refreshed list TWICE — once from the list handler they called,
 * once from an `emitToUser` of the value it returned. One emit is the fix, and
 * "at most once" is what says it stayed fixed.
 *
 * The gate applies to a handler's own reply exactly as it does to its
 * cascades: the client holds the reply's key before the request even goes out
 * (the typed emit flushes the interest sync first), so the own reply reaches
 * the caller and only the cascades nobody wants are skipped.
 *
 * Driven through the real `connectSockets`, the real `register` and the real
 * `interest:sync` handler. `GATED_EVENTS` is mocked to add the five events this
 * slice converts — the architect adds them to the shared set once the client
 * half has landed too, and these tests are what say the server half is ready
 * for that. `lorebooks:get` is given a scope extractor in the same factory,
 * because the reply these tests pin is the one with no lorebook in it to read
 * an id off.
 *
 * `$lib/server/db` is a recording fake rather than PGlite: what is being
 * pinned here is which reads happen, and a fake that names each read is the
 * only way to assert that one did NOT. The gate itself is never stubbed — a
 * test that stubbed it would pass against a gate that had been deleted.
 *
 * ⚠ Mocking `$lib/server/db` while importing `sockets/index` needs
 * `getCryptoSecretKey`, `schema` and `dbReady` in the factory: `auth/tokens`
 * derives its secret from that module at import time.
 */
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest"

const seam = vi.hoisted(() => {
	/** Every read and write, in order — the cost the gate exists to skip. */
	const queries: string[] = []

	/** The drizzle table name, off the table object rather than an import. */
	const nameOf = (table: any) =>
		table?.[Symbol.for("drizzle:Name")] ?? "unknown"

	const rows = {
		/** The book every request below names. Null is the one that is not there. */
		book: { id: 3, name: "Book", userId: 1 } as {
			id: number
			name: string
			userId: number
		} | null,
		/** What the next INSERT ... RETURNING answers with. */
		inserted: {} as any
	}

	/**
	 * A drizzle-ish builder: every method chains, awaiting it records the
	 * statement against the table it named.
	 */
	function chain(kind: string, table: any, result: () => any) {
		let label = `${kind}(${nameOf(table)})`
		const self: any = {
			from: (t: any) => {
				label = `${kind}(${nameOf(t)})`
				return self
			},
			innerJoin: () => self,
			where: () => self,
			limit: () => self,
			orderBy: () => self,
			groupBy: () => self,
			set: () => self,
			values: () => self,
			onConflictDoNothing: () => self,
			returning: () => self,
			then: (ok: any, err: any) => {
				queries.push(label)
				return Promise.resolve(result()).then(ok, err)
			}
		}
		return self
	}

	const handle = {
		query: {
			lorebooks: {
				findMany: async () => {
					queries.push("lorebooks.findMany")
					return []
				},
				// The three reads are told apart by their shape, because that
				// is what tells an ownership check from the cast read a
				// cascade pays for.
				findFirst: async (config: any) => {
					queries.push(
						config?.with
							? "lorebooks.findFirst(bindings)"
							: "lorebooks.findFirst(columns)"
					)
					if (!rows.book) return undefined
					return config?.with
						? { ...rows.book, lorebookBindings: [] }
						: rows.book
				}
			},
			lorebookBindings: {
				findFirst: async () => {
					queries.push("lorebookBindings.findFirst")
					return undefined
				}
			},
			lorebookEntries: {
				findFirst: async () => {
					queries.push("lorebookEntries.findFirst")
					return undefined
				}
			}
		},
		execute: async () => {
			queries.push("execute")
			return []
		},
		// `select()` with no projection is the whole row, which is what a LIST
		// read is; a projection is a lookup. Told apart because both touch
		// `lorebook_entries` and only one of them is a cascade's cost.
		select: (cols?: any) =>
			chain(
				cols === undefined ? "selectAll" : "select",
				undefined,
				() => []
			),
		update: (table: any) => chain("update", table, () => []),
		insert: (table: any) => chain("insert", table, () => [rows.inserted]),
		delete: (table: any) => chain("delete", table, () => []),
		transaction: async (cb: any) => cb(handle)
	}

	return { queries, rows, db: handle }
})

vi.mock("$lib/shared/sockets/interest", async (importOriginal) => {
	const actual =
		await importOriginal<typeof import("$lib/shared/sockets/interest")>()
	// The real set, plus this slice's five — spelled here rather than in a
	// module const, because this factory is hoisted above every one of them.
	const gated = new Set([
		...actual.GATED_EVENTS,
		"lorebooks:list",
		"lorebooks:get",
		"lorebooks:bindingList",
		"entries:list",
		"bindingSuggestions:list"
	])
	// `lorebooks:get` keys off the book it answers with, falling back to the
	// `lorebookId` the NOT-FOUND reply carries in place of one. The list
	// events are left unscoped here: a bare declaration matches every scope,
	// so these tests say the same thing either way.
	const scoped = new Map(actual.SCOPED_EVENTS)
	scoped.set(
		"lorebooks:get",
		(payload: any) => payload?.lorebook?.id ?? payload?.lorebookId
	)
	return {
		...actual,
		GATED_EVENTS: gated,
		isGatedEvent: (event: string) => gated.has(event),
		SCOPED_EVENTS: scoped,
		scopeOfPayload: (event: string, payload: unknown) => {
			const extract = scoped.get(event)
			if (!extract) return null
			const raw = extract(payload)
			if (typeof raw === "number")
				return Number.isFinite(raw) ? String(raw) : null
			if (typeof raw === "string") return raw === "" ? null : raw
			return null
		}
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
		getCryptoSecretKey: () => "content-interest-gate-test-secret",
		closeDatabase: async () => {},
		reopenDatabase: async () => {}
	}
})

// The genre registry, stubbed to the two things the session list builder reads
// off it — `connectSockets` registers that family too.
vi.mock("$lib/server/pipelines/entities/sessionGenres", () => ({
	listSessionGenres: async () => [],
	STANDARD_GENRE_ID: "core:genre/chat"
}))

// The two background lanes an entry write wakes. Neither is what these tests
// are about, and both would otherwise reach the real queue modules.
vi.mock("$lib/server/annotations/queue", () => ({
	enqueueLorebookAnnotation: () => {},
	annotationLane: { stop: () => {} }
}))
// Partial: `sockets/vectorization.ts` registers a progress emitter off the
// same module, so only the enqueue an entry write makes is stood in for.
vi.mock("$lib/server/embedding/vectorizationQueue", async (importOriginal) => {
	const actual =
		await importOriginal<
			typeof import("$lib/server/embedding/vectorizationQueue")
		>()
	return { ...actual, autoEnqueueLorebook: async () => {} }
})

// The token is claimed inside the binding insert's transaction with an
// UPDATE ... RETURNING this fake has no row for. What it derives is not what
// is under test.
vi.mock("$lib/server/utils/lorebookBindingToken", () => ({
	deriveNextBindingToken: async () => "{{char:1}}"
}))

// The binding-token rescan an entry write triggers. Real here would be several
// statements of its own between the write and the cascades the gate is being
// asked about; `relistBindings` and the handlers stay REAL (spread from the
// actual module), which is the half that matters.
vi.mock("./lorebooks", async (importOriginal) => {
	const actual = await importOriginal<typeof import("./lorebooks")>()
	return { ...actual, syncLorebookBindings: async () => {} }
})

// The suggestion tables, stood in for so `bindingSuggestions:ignore` can be
// driven at all. `refreshSuggestions` is the derive-reconcile-read pass the
// gate exists to skip, so it records itself like a query.
vi.mock("$lib/server/bindingSuggestions", () => ({
	findOwnedSuggestion: async () => ({
		id: 5,
		lorebookId: 3,
		status: "pending",
		surface: "Emberfall",
		entityKey: "open:emberfall"
	}),
	isUnscanned: () => false,
	outstandingSources: () => 0,
	takenNames: async () => new Set<string>(),
	OPEN_TIER_PREFIX: "open:",
	refreshSuggestions: async () => {
		seam.queries.push("refreshSuggestions")
		return {
			suggestions: [],
			coverage: {
				entries: { annotated: 0, total: 0 },
				messages: { annotated: 0, total: 0 }
			}
		}
	}
}))

import { connectSockets } from "./index"
import { WORLD_LORE_TYPE_ID } from "$lib/server/utils/lorebookEntries"

const OWNER = { id: 1, username: "owner", isAdmin: true }
/** The same owner in a second tab — two sockets in one user room. */
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

	function connect(id: string, user: typeof OWNER) {
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
	seam.rows.book = { id: 3, name: "Book", userId: 1 }
	seam.rows.inserted = {}
})

afterEach(() => {
	harnesses.splice(0).forEach((h) => h.teardown())
	vi.clearAllMocks()
})

const count = (q: string) => seam.queries.filter((x) => x === q).length
const events = (h: { emits: Array<{ event: string }> }) =>
	h.emits.map((e) => e.event)
const emitted = (
	h: { emits: Array<{ target: string; event: string; data: any }> },
	event: string
) => h.emits.filter((e) => e.event === event)

describe("lorebooks:create — the lorebook list cascade", () => {
	beforeEach(() => {
		seam.rows.inserted = { id: 7, name: "New book", userId: 1 }
	})

	test("creates the book and builds no list when nobody wants the list", async () => {
		const h = fresh()
		const owner = h.connect("s1", OWNER)
		// The caller always holds its own reply's key before the request ships
		// (the typed emit flushes the interest sync first) — declared here, but
		// not `lorebooks:list`, so the cascade stays closed.
		await owner.declare("lorebooks:create")

		await owner.fire("lorebooks:create", { name: "New book" })

		expect(seam.queries).toContain("insert(lorebooks)")
		expect(events(h)).toEqual(["lorebooks:create"])
		expect(count("lorebooks.findMany")).toBe(0)
	})

	test("builds it ONCE, and sends it ONCE, for a socket that declared the key", async () => {
		// The duplicate-emit regression, pinned: this handler used to send the
		// refreshed list twice — once from the list handler it called, once
		// from an `emitToUser` of that call's return value.
		const h = fresh()
		const owner = h.connect("s1", OWNER)
		await owner.declare("lorebooks:create", "lorebooks:list")

		await owner.fire("lorebooks:create", { name: "New book" })

		expect(count("lorebooks.findMany")).toBe(1)
		expect(emitted(h, "lorebooks:list")).toHaveLength(1)
		// The refreshed list first, then the reply — the order this handler
		// has always sent them in.
		expect(events(h)).toEqual(["lorebooks:list", "lorebooks:create"])
		expect(emitted(h, "lorebooks:list")[0].data.lorebookList).toEqual([])
	})
})

describe("lorebooks:createBinding — the cast cascade", () => {
	const params = {
		lorebookBinding: {
			lorebookId: 3,
			characterId: null,
			personaId: null,
			binding: "",
			name: "Ashguard"
		}
	}

	beforeEach(() => {
		seam.rows.inserted = {
			id: 12,
			lorebookId: 3,
			binding: "{{char:1}}",
			name: "Ashguard"
		}
	})

	test("mints the binding and reads no cast when nobody wants it", async () => {
		const h = fresh()
		const owner = h.connect("s1", OWNER)
		await owner.declare("lorebooks:createBinding")

		await owner.fire("lorebooks:createBinding", params)

		expect(seam.queries).toContain("insert(lorebook_bindings)")
		expect(events(h)).toEqual(["lorebooks:createBinding"])
		// The ownership read still ran; the three-way join behind the cast
		// did not.
		expect(count("lorebooks.findFirst(columns)")).toBe(1)
		expect(count("lorebooks.findFirst(bindings)")).toBe(0)
	})

	test("reads it ONCE, and sends it ONCE, for a socket that declared the key", async () => {
		const h = fresh()
		const owner = h.connect("s1", OWNER)
		await owner.declare("lorebooks:createBinding", "lorebooks:bindingList")

		await owner.fire("lorebooks:createBinding", params)

		expect(count("lorebooks.findFirst(bindings)")).toBe(1)
		expect(emitted(h, "lorebooks:bindingList")).toHaveLength(1)
		expect(events(h)).toEqual([
			"lorebooks:bindingList",
			"lorebooks:createBinding"
		])
		const list = emitted(h, "lorebooks:bindingList")[0]
		// Delivered per socket (ruling 5), carrying the payload rather than
		// the thunk that built it.
		expect(list.target).toBe("s1")
		expect(list.data.lorebookId).toBe(3)
	})

	test("reads it ONCE for two interested tabs, and reaches both", async () => {
		const h = fresh()
		const one = h.connect("s1", OWNER)
		const two = h.connect("s2", SECOND_TAB)
		await one.declare("lorebooks:bindingList")
		await two.declare("lorebooks:bindingList")

		await one.fire("lorebooks:createBinding", params)

		expect(count("lorebooks.findFirst(bindings)")).toBe(1)
		expect(
			emitted(h, "lorebooks:bindingList").map((e) => e.target)
		).toEqual(["s1", "s2"])
	})
})

describe("entries:create — the two cascades behind every entry write", () => {
	const params = {
		entry: {
			lorebookId: 3,
			typeId: WORLD_LORE_TYPE_ID,
			name: "Emberfall",
			content: "A city on the cliffs.",
			keys: "emberfall"
		}
	}

	beforeEach(() => {
		seam.rows.inserted = {
			id: 21,
			lorebookId: 3,
			typeId: WORLD_LORE_TYPE_ID,
			position: 1,
			title: "Emberfall",
			content: "A city on the cliffs.",
			keys: ["emberfall"],
			fields: {},
			// `toEntryRow` renders both as ISO strings.
			createdAt: new Date(0),
			updatedAt: new Date(0)
		}
	})

	test("writes the row and builds neither list when nobody wants one", async () => {
		const h = fresh()
		const owner = h.connect("s1", OWNER)
		await owner.declare("entries:create")

		await owner.fire("entries:create", params)

		expect(seam.queries).toContain("insert(lorebook_entries)")
		expect(events(h)).toEqual(["entries:create"])
		// Neither the cast re-read nor the entry list read.
		expect(count("lorebooks.findFirst(bindings)")).toBe(0)
		expect(count("selectAll(lorebook_entries)")).toBe(0)
	})

	test("never emits the legacy un-namespaced `lorebookBindingList`", async () => {
		// Deleted with this slice: it was a second copy of the canonical
		// payload under a name no client has ever listened for. Asserted with
		// BOTH keys declared, because a client that wants everything is the
		// one case where a stray emit could hide.
		const h = fresh()
		const owner = h.connect("s1", OWNER)
		await owner.declare(
			"entries:create",
			"entries:list",
			"lorebooks:bindingList"
		)

		await owner.fire("entries:create", params)

		expect(events(h)).not.toContain("lorebookBindingList")
		expect(emitted(h, "lorebooks:bindingList")).toHaveLength(1)
		expect(emitted(h, "entries:list")).toHaveLength(1)
	})

	test("builds only the list that was asked for", async () => {
		// The two cascades are gated independently: a workspace showing the
		// entries of one type has no reason to pay for the cast as well.
		const h = fresh()
		const owner = h.connect("s1", OWNER)
		await owner.declare("entries:create", "entries:list")

		await owner.fire("entries:create", params)

		expect(count("selectAll(lorebook_entries)")).toBe(1)
		expect(count("lorebooks.findFirst(bindings)")).toBe(0)
		const list = emitted(h, "entries:list")[0]
		expect(list.target).toBe("s1")
		expect(list.data.lorebookId).toBe(3)
		expect(list.data.typeId).toBe(WORLD_LORE_TYPE_ID)
	})
})

describe("bindingSuggestions:ignore — the relist behind a decision", () => {
	test("writes the decision and derives nothing when nobody wants the list", async () => {
		const h = fresh()
		const owner = h.connect("s1", OWNER)
		await owner.declare("bindingSuggestions:ignore")

		await owner.fire("bindingSuggestions:ignore", { id: 5 })

		expect(seam.queries).toContain("update(binding_suggestions)")
		// The derive-reconcile-read pass is the whole cost of this push.
		expect(count("refreshSuggestions")).toBe(0)
		expect(events(h)).toEqual([])
	})

	test("derives it once for a socket that declared the key", async () => {
		const h = fresh()
		const owner = h.connect("s1", OWNER)
		await owner.declare("bindingSuggestions:list")

		await owner.fire("bindingSuggestions:ignore", { id: 5 })

		expect(count("refreshSuggestions")).toBe(1)
		const list = emitted(h, "bindingSuggestions:list")
		expect(list).toHaveLength(1)
		expect(list[0].target).toBe("s1")
		// The row that was decided rides along with the refreshed list.
		expect(list[0].data.ignoredId).toBe(5)
	})
})

describe("lorebooks:get — the not-found reply still has a scope", () => {
	/**
	 * The reply with no lorebook in it, which is the one payload with no
	 * `lorebook.id` to be scoped by. The server puts the requested id on
	 * `lorebookId` so the scope survives. Without it this reply reaches only a
	 * BARE `lorebooks:get` key, and a bare key matches every OTHER book's
	 * reply too — so every view with a not-found branch would have to hold
	 * one, and the gate would pass for every lorebook id while any of them was
	 * open.
	 */
	test("delivers it to the socket watching that very id", async () => {
		const h = fresh()
		const owner = h.connect("s1", OWNER)
		seam.rows.book = null
		await owner.declare("lorebooks:get#999")

		await owner.fire("lorebooks:get", { id: 999 })

		const got = emitted(h, "lorebooks:get")
		expect(got.map((e) => e.target)).toEqual(["s1"])
		expect(got[0].data.lorebook).toBeNull()
		expect(got[0].data.lorebookId).toBe(999)
	})

	test("does not deliver it to a socket watching another book", async () => {
		const h = fresh()
		const owner = h.connect("s1", OWNER)
		const elsewhere = h.connect("s2", SECOND_TAB)
		seam.rows.book = null
		await owner.declare("lorebooks:get#999")
		await elsewhere.declare("lorebooks:get#3")

		await owner.fire("lorebooks:get", { id: 999 })

		expect(emitted(h, "lorebooks:get").map((e) => e.target)).toEqual(["s1"])
	})

	test("returns without throwing when no socket wants it", async () => {
		const h = fresh()
		const owner = h.connect("s1", OWNER)
		seam.rows.book = null

		// No declare at all. The gate finds nobody, emits nothing, and the
		// handler still completes — a throw here would reach `register`'s
		// catch and push a generic `lorebooks:get:error` at a client that
		// asked for a book which simply is not there.
		await expect(
			owner.fire("lorebooks:get", { id: 999 })
		).resolves.toBeDefined()

		expect(events(h)).toEqual([])
	})
})
