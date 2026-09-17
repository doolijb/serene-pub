/**
 * The cast families through the real gate — phase 2, `characters:`/
 * `characterFolders:`/`tags:`/`cardSources:`. (`personas:` was one of them
 * until 0133 folded it into `characters:`.)
 *
 * Every write in these four files finishes by pushing something nobody asked
 * for: the whole character list after a create, the whole tag list after a tag
 * is minted, the character again after its avatar changed. Each push is a
 * query — `characters:list` is a findMany over every character with its avatar
 * row and its tag joins — and until this slice all of it was paid whether or
 * not any view was open to receive it. The cascades are now the thunk form, so
 * these tests assert on the QUERIES rather than on the emits: skipping the emit
 * alone would save nothing.
 *
 * The gate applies to a handler's OWN reply exactly as it does to its cascades
 * (ruled 2026-09-14): the client holds the reply's key before the request even
 * goes out — the typed emit flushes the interest sync first — so the own reply
 * reaches the caller and only the cascades nobody wants are skipped. That is
 * why the injected set below includes the three request events as well as the
 * five cascade events: with the own replies ungated, "delivered to the caller
 * that declared it" would be true of a caller that declared nothing.
 *
 * Driven through the real `connectSockets`, the real `register` and the real
 * `interest:sync` handler. `GATED_EVENTS` is mocked to add this slice's events,
 * and `SCOPED_EVENTS` to add the two `:get` extractors — the architect adds
 * both to the shared module once the client half has landed, and these tests
 * are what say the server half is ready for it. The gate itself is never
 * stubbed: a test that stubbed it would pass against a gate that had been
 * deleted.
 *
 * `$lib/server/db` is a recording fake rather than PGlite: what is being pinned
 * here is which reads happen, and a fake that names each read is the only way
 * to assert that one did NOT. (The db module is more than `db` —
 * `auth/tokens` derives its secret from it at import time and `connectSockets`
 * reaches auth — so the handful of exports the graph actually loads are stood
 * in for.)
 */
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest"

/** Drizzle's table name, for telling one `insert()` from another. */
const TABLE_NAME = Symbol.for("drizzle:Name")

const seam = vi.hoisted(() => {
	/** Every read, in the order it happened — the cost the gate exists to skip. */
	const queries: string[] = []

	/**
	 * The character as `buildCharacterGet` asks for it — the tag join and the
	 * owner included, because that read shapes its answer out of both.
	 */
	const character = {
		id: 1,
		userId: 1,
		name: "Ada",
		avatarMediaId: null as number | null,
		characterTags: [] as { tag: { name: string } }[],
		user: { username: "owner", displayName: null as string | null }
	}

	const rows = {
		/** Character 1, owned by user 1. Null is the character that is not there. */
		character: { ...character } as typeof character | null,
		/** The gallery file `setAvatar` points at. */
		file: { id: 7, characterId: 1 } as {
			id: number
			characterId: number
		} | null,
		/** An existing case-insensitive tag match, for `tagsCreate`'s adopt path. */
		tag: null as { id: number; userId: number; name: string } | null
	}

	/**
	 * A drizzle-ish builder: every method chains, awaiting it records the write
	 * and resolves to whatever the statement should have returned.
	 */
	function chain(label: string, result: any = []) {
		const self: any = {
			from: () => self,
			where: () => self,
			limit: () => self,
			orderBy: () => self,
			set: () => self,
			values: () => self,
			onConflictDoNothing: () => self,
			returning: () => self,
			then: (ok: any, err: any) => {
				queries.push(label)
				return Promise.resolve(result).then(ok, err)
			}
		}
		return self
	}

	const nameOf = (table: any) => String(table?.[TABLE_NAME] ?? "unknown")

	return {
		queries,
		rows,
		db: {
			query: {
				characters: {
					// The three reads are told apart by their shape, which is
					// what tells the ownership check (no relations) from the
					// broadcast re-read (`with: { avatarMedia }`) from the
					// panel's own read (`columns` AND `with`).
					findFirst: async (config: any) => {
						queries.push(
							config?.columns && config?.with
								? "characters.findFirst(get)"
								: config?.with
									? "characters.findFirst(broadcast)"
									: "characters.findFirst(owned)"
						)
						return rows.character ?? undefined
					},
					findMany: async () => {
						queries.push("characters.findMany")
						return []
					}
				},
				characterTags: {
					findMany: async () => {
						queries.push("characterTags.findMany")
						return []
					}
				},
				characterFolders: {
					findFirst: async () => {
						queries.push("characterFolders.findFirst")
						return undefined
					},
					findMany: async () => {
						queries.push("characterFolders.findMany")
						return []
					}
				},
				tags: {
					findFirst: async () => {
						queries.push("tags.findFirst")
						return rows.tag ?? undefined
					},
					findMany: async () => {
						queries.push("tags.findMany")
						return []
					}
				},
				files: {
					findFirst: async () => {
						queries.push("files.findFirst")
						return rows.file ?? undefined
					}
				}
			},
			select: () => chain("select"),
			update: (table: any) =>
				chain(`update:${nameOf(table)}`, [
					{ ...rows.character, avatarMediaId: 7 }
				]),
			insert: (table: any) => {
				const name = nameOf(table)
				return chain(
					`insert:${name}`,
					name === "tags"
						? [{ id: 3, userId: 1, name: "brave" }]
						: [rows.character]
				)
			},
			delete: () => chain("delete")
		}
	}
})

vi.mock("$lib/shared/sockets/interest", async (importOriginal) => {
	const actual =
		await importOriginal<typeof import("$lib/shared/sockets/interest")>()
	// The real set plus this slice's events, spelled here rather than in a
	// module const because this factory is hoisted above every one of them.
	// The three request events are in it for the reason the header gives.
	const gated = new Set([
		...actual.GATED_EVENTS,
		"characters:create",
		"characters:get",
		"characters:list",
		"characters:setAvatar",
		"characters:update",
		"characterFolders:list",
		"tags:create",
		"tags:list"
	])
	// The `:get` scope, the `sessions:get` treatment: the id is normally on the
	// row, and a NOT-FOUND reply carries the requested id beside the null
	// (`characterId`) so the payload still has a scope.
	const scoped = new Map(actual.SCOPED_EVENTS)
	scoped.set(
		"characters:get",
		(payload: any) => payload?.character?.id ?? payload?.characterId
	)
	return {
		...actual,
		GATED_EVENTS: gated,
		isGatedEvent: (event: string) => gated.has(event),
		SCOPED_EVENTS: scoped,
		isScopedEvent: (event: string) => scoped.has(event),
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

vi.mock("$lib/server/db", async () => {
	const schema = await import("$lib/server/db/schema")
	return {
		db: seam.db,
		schema,
		dbReady: Promise.resolve(),
		getCryptoSecretKey: () => "cast-interest-gate-test-secret",
		closeDatabase: async () => {},
		reopenDatabase: async () => {}
	}
})

// The embedding queue, silenced: `charactersCreate` fires it and forgets it, so
// letting the real one run would add reads to `queries` that belong to nobody's
// assertion — and its failure is swallowed either way.
vi.mock("$lib/server/embedding/vectorizationQueue", async (importOriginal) => ({
	...(await importOriginal<any>()),
	autoEnqueueCharacter: async () => {},
	autoEnqueuePersona: async () => {}
}))

// The genre registry, stubbed to the two things the session list builder reads
// off it — nothing in these paths depends on a real genre.
vi.mock("$lib/server/pipelines/entities/sessionGenres", () => ({
	listSessionGenres: async () => [],
	STANDARD_GENRE_ID: "core:genre/chat"
}))

import { connectSockets } from "./index"

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
	seam.rows.character = {
		id: 1,
		userId: 1,
		name: "Ada",
		avatarMediaId: null,
		characterTags: [],
		user: { username: "owner", displayName: null }
	}
	seam.rows.file = { id: 7, characterId: 1 }
	seam.rows.tag = null
})

afterEach(() => {
	harnesses.splice(0).forEach((h) => h.teardown())
	vi.clearAllMocks()
})

/** The one read that says the character list was actually built. */
const listBuilt = () =>
	seam.queries.filter((q) => q === "characters.findMany").length
/** The one read that says the tag list was actually built. */
const tagListBuilt = () =>
	seam.queries.filter((q) => q === "tags.findMany").length
/** The one read that says a character was re-read for the panel. */
const characterReread = () =>
	seam.queries.filter((q) => q === "characters.findFirst(get)").length
const events = (h: { emits: Array<{ event: string }> }) =>
	h.emits.map((e) => e.event)

describe("characters:create — the character list cascade", () => {
	test("delivers the caller's own reply and builds no list when nobody wants the list", async () => {
		const h = fresh()
		const owner = h.connect("s1", OWNER)
		// The caller always holds its own reply's key before the request ships
		// (the typed emit flushes the interest sync first) — declared here, but
		// not `characters:list`, so the cascade stays closed.
		await owner.declare("characters:create")

		await owner.fire("characters:create", {
			character: { name: "Ada", description: "" }
		})

		// The command ran and the caller's own reply reached it.
		expect(seam.queries).toContain("insert:characters")
		expect(events(h)).toEqual(["characters:create"])
		// The cascade did not: no interest in the list, no thunk, no query,
		// no emit.
		expect(listBuilt()).toBe(0)
	})

	test("builds it once for a socket that declared the key", async () => {
		const h = fresh()
		const owner = h.connect("s1", OWNER)
		await owner.declare("characters:create", "characters:list")

		await owner.fire("characters:create", {
			character: { name: "Ada", description: "" }
		})

		expect(listBuilt()).toBe(1)
		// The refreshed list, then the reply — the order this handler has
		// always sent them in.
		expect(events(h)).toEqual(["characters:list", "characters:create"])
		const list = h.emits.find((e) => e.event === "characters:list")!
		// Delivered per socket (ruling 5), carrying the payload rather than
		// the thunk that built it.
		expect(list.target).toBe("s1")
		expect(list.data.characterList).toEqual([])
	})

	test("builds it ONCE for two interested tabs, and reaches both", async () => {
		const h = fresh()
		const one = h.connect("s1", OWNER)
		const two = h.connect("s2", SECOND_TAB)
		await one.declare("characters:list")
		await two.declare("characters:list")

		await one.fire("characters:create", {
			character: { name: "Ada", description: "" }
		})

		expect(listBuilt()).toBe(1)
		expect(
			h.emits
				.filter((e) => e.event === "characters:list")
				.map((e) => e.target)
		).toEqual(["s1", "s2"])
	})
})

describe("tags:create — the tag list cascade", () => {
	test("mints the tag and builds no list when nobody wants one", async () => {
		const h = fresh()
		const owner = h.connect("s1", OWNER)
		await owner.declare("tags:create")

		await owner.fire("tags:create", { tag: { name: "brave" } })

		// The adopt-on-collision lookup still runs — it is part of the write,
		// not of the push.
		expect(seam.queries).toContain("tags.findFirst")
		expect(seam.queries).toContain("insert:tags")
		expect(events(h)).toEqual(["tags:create"])
		expect(tagListBuilt()).toBe(0)
	})

	test("builds it once for a socket that declared the key", async () => {
		const h = fresh()
		const owner = h.connect("s1", OWNER)
		await owner.declare("tags:create", "tags:list")

		await owner.fire("tags:create", { tag: { name: "brave" } })

		expect(tagListBuilt()).toBe(1)
		// The reply first, then the refreshed list — this handler's order.
		expect(events(h)).toEqual(["tags:create", "tags:list"])
		const list = h.emits.find((e) => e.event === "tags:list")!
		expect(list.target).toBe("s1")
		expect(list.data.tagsList).toEqual([])
	})
})

describe("characters:setAvatar — the session views' `characters:update`", () => {
	test("sets the avatar and pushes nothing when no view holds either key", async () => {
		const h = fresh()
		const owner = h.connect("s1", OWNER)
		await owner.declare("characters:setAvatar")

		await owner.fire("characters:setAvatar", {
			characterId: 1,
			mediaId: 7
		})

		// The write and the two ownership checks in front of it still ran.
		expect(seam.queries).toContain("files.findFirst")
		expect(seam.queries).toContain("update:characters")
		// Only the own reply. No `characters:update` for the session views —
		// nobody is showing this face — and no panel re-read either.
		expect(events(h)).toEqual(["characters:setAvatar"])
		expect(characterReread()).toBe(0)
	})

	test("pushes the update and re-reads the panel for the sockets that want them", async () => {
		const h = fresh()
		const owner = h.connect("s1", OWNER)
		const sessionTab = h.connect("s2", SECOND_TAB)
		await owner.declare("characters:setAvatar", "characters:get")
		await sessionTab.declare("characters:update")

		await owner.fire("characters:setAvatar", {
			characterId: 1,
			mediaId: 7
		})

		expect(events(h)).toEqual([
			"characters:setAvatar",
			"characters:update",
			"characters:get"
		])
		// Each one only to the socket that asked for it (ruling 5).
		const byEvent = (event: string) =>
			h.emits.filter((e) => e.event === event).map((e) => e.target)
		expect(byEvent("characters:setAvatar")).toEqual(["s1"])
		expect(byEvent("characters:update")).toEqual(["s2"])
		expect(byEvent("characters:get")).toEqual(["s1"])
		// The panel's re-read is the one that costs a query, and it was paid
		// exactly once.
		expect(characterReread()).toBe(1)
	})
})

describe("characters:get — the not-found reply still carries a scope", () => {
	test("reaches the tab that asked for that id, and nobody else's", async () => {
		const h = fresh()
		seam.rows.character = null
		const asking = h.connect("s1", OWNER)
		const elsewhere = h.connect("s2", SECOND_TAB)
		await asking.declare("characters:get#999")
		await elsewhere.declare("characters:get#1")

		await asking.fire("characters:get", { id: 999 })

		const got = h.emits.filter((e) => e.event === "characters:get")
		expect(got.map((e) => e.target)).toEqual(["s1"])
		// The id beside the null is what let the scope be derived at all — a
		// payload with only `character: null` would have matched a bare key
		// and, with it, every other character's reply.
		expect(got[0].data).toEqual({ character: null, characterId: 999 })
	})
})
