/**
 * 🚧 The knowledge filter on the remaining reads (`knownToSpeaker`, on by
 * default): lorebook-entries (the place listing and its ways), lorebook-triggers
 * (and its recursion), vector-search, entity-search, entity-link,
 * relationship-search (the hop) and entries-named — through the real bindings
 * and the host's `lorebook_entries` read — and the standing-place exception.
 * The reads a stand-in answers (the vector index, the entity index) are the
 * ones whose rows the host does not own.
 */
import { afterAll, beforeAll, describe, expect, test, vi } from "vitest"
import fs from "fs/promises"
import os from "os"
import path from "path"
import * as schema from "$lib/server/db/schema"
import { defineAttributeSheet } from "@serene-pub/sdk"
import type { TestDb } from "$lib/server/utils/testDb"
import { releaseDataDir } from "$lib/server/utils/testDb"
import { genreKeeping } from "$lib/server/utils/testGenre"
import { insertCastMember } from "$lib/server/characters/versions"
import { entryInsert } from "$lib/server/utils/lorebookEntries"
import { createHost } from "$lib/server/pipelines/runtime/host"
import {
	CHARACTER_LORE_TYPE_ID,
	LOCATION_TYPE_ID,
	WORLD_LORE_TYPE_ID
} from "$lib/shared/entries/types"
import {
	loadEntryKnowledge,
	setEntryCommonKnowledge
} from "$lib/server/lorebooks/entryKnowledge"

vi.setConfig({ testTimeout: 60_000, hookTimeout: 60_000 })

let testDb: TestDb
let dataDir: string

vi.mock("$lib/server/db", async () => {
	const { createTestDb } = await import("$lib/server/utils/testDb")
	const db = await createTestDb()
	return { db, getCryptoSecretKey: () => "bindings-entry-knowledge-reads" }
})
vi.mock("$lib/server/embedding", () => ({
	isModelReady: () => false,
	getLoadedModelId: () => null,
	embed: async () => [],
	batchEmbed: async () => []
}))
vi.mock("$lib/server/embedding/vectorizationQueue", () => ({
	ensureSessionMessageEmbedded: async () => {},
	autoEnqueueSession: async () => {},
	autoEnqueueLorebook: async () => {}
}))
vi.mock("$lib/server/sockets/utils/broadcastHelpers", () => ({
	emitToUserRedacted: async () => {},
	broadcastToSessionUsers: async () => {}
}))

beforeAll(async () => {
	dataDir = await fs.mkdtemp(
		path.join(os.tmpdir(), "serene-pub-vitest-bindings-entry-knowledge-reads-")
	)
	process.env.SERENE_PUB_DATA_DIR = dataDir
	testDb = (await import("$lib/server/db")).db as unknown as TestDb
}, 120_000)

afterAll(async () => {
	await releaseDataDir(dataDir)
	await fs.rm(dataDir, { recursive: true, force: true }).catch(() => {})
})

const LOCATION_SLOT = "core:slot/location@1"
/** A genre whose sheet keeps the location on the world and on each cast member. */
const WALKERS = "test:genre/entry-knowledge-walkers"
genreKeeping(WALKERS, {
	name: { en: "Walkers" },
	family: "test",
	sheets: [
		defineAttributeSheet("test:sheet/entry-knowledge-walkers@1", {
			label: { en: "Walkers" },
			slots: [{ id: LOCATION_SLOT, appliesTo: ["world", "cast"] }]
		})
	],
	events: {}
})

const db = () => testDb as unknown as Db
let n = 0
let positions = 0

async function world() {
	const suffix = ++n
	const { createTestUser } = await import("$lib/server/utils/testDb")
	const user = await createTestUser(testDb, `bekr-${suffix}`)
	const [book] = await testDb
		.insert(schema.lorebooks)
		.values({ userId: user.id, name: `Book ${suffix}` } as never)
		.returning()
	const [card] = await testDb
		.insert(schema.characters)
		.values({ userId: user.id, name: "Mira", description: "…" } as never)
		.returning()
	const member = (
		await insertCastMember(testDb, {
			lorebookId: book!.id,
			binding: `{{char:Mira${suffix}}}`,
			characterId: card!.id,
			name: "Mira"
		})
	).member!.id
	const cardless = (
		await insertCastMember(testDb, {
			lorebookId: book!.id,
			binding: `{{char:Ola${suffix}}}`,
			name: "Ola"
		})
	).member!.id
	const [session] = await testDb
		.insert(schema.sessions)
		.values({
			userId: user.id,
			isGroup: true,
			name: `Run ${suffix}`,
			lorebookId: book!.id,
			genreId: WALKERS
		} as never)
		.returning()
	const sessionId = session!.id
	await testDb.insert(schema.sessionCharacters).values([
		{
			sessionId,
			characterId: card!.id,
			castMemberId: member,
			position: 0,
			seatedByUserId: user.id,
			isActive: true
		},
		{
			sessionId,
			characterId: null,
			castMemberId: cardless,
			position: 1,
			seatedByUserId: user.id,
			isActive: true
		}
	] as never)
	const entry = async (
		typeId: string,
		name: string,
		extra: Record<string, unknown> = {}
	) =>
		(
			await testDb
				.insert(schema.lorebookEntries)
				.values(
					entryInsert({
						typeId,
						lorebookId: book!.id,
						name,
						content: `About ${name}.`,
						position: ++positions,
						...extra
					} as never)
				)
				.returning()
		)[0]!.id
	const mark = (entryId: number) =>
		setEntryCommonKnowledge(db(), {
			userId: user.id,
			entryId,
			notCommonKnowledge: true
		})
	const link = (fromEntryId: number, toEntryId: number) =>
		testDb.insert(schema.narrativeRelationships).values({
			lorebookId: book!.id,
			fromNodeId: null,
			toNodeId: null,
			fromEntryId,
			toEntryId,
			relationshipType: "leads to",
			visibility: "acknowledged",
			status: "active"
		} as never)
	const say = (content: string) =>
		testDb
			.insert(schema.sessionMessages)
			.values({ sessionId, role: "user", content } as never)
	return {
		sessionId,
		member,
		cardless,
		cardId: card!.id,
		userId: user.id,
		entry,
		mark,
		link,
		say
	}
}
type World = Awaited<ReturnType<typeof world>>

const scopes = {
	mira: (w: World) => ({ sessionId: w.sessionId, currentCharacterId: w.cardId }),
	cardless: (w: World) => ({
		sessionId: w.sessionId,
		currentCharacterId: null,
		currentCastMemberId: w.cardless
	}),
	nobody: (w: World) => ({ sessionId: w.sessionId, currentCharacterId: null })
}

let coreBindings: typeof import("$lib/server/pipelines/runtime/bindings").coreBindings
beforeAll(async () => {
	coreBindings = (await import("$lib/server/pipelines/runtime/bindings"))
		.coreBindings
})

/** One node through the real bindings and one host; `stub` answers the reads the host does not own. */
function runner(
	w: World,
	scope: Record<string, unknown>,
	stub: Record<string, (q: any) => unknown> = {}
) {
	const host = createHost(db(), { sessionId: w.sessionId })
	const bindings = coreBindings()
	const reads: Array<{ table: string; query: any }> = []
	return async (
		node: string,
		input: Record<string, unknown> = {}
	): Promise<{ value: any; log: ReturnType<typeof vi.fn>; reads: typeof reads }> => {
		const log = vi.fn()
		const bind: any = bindings[node]
		const run = typeof bind === "function" ? bind : bind.run
		const r = (await run(
			{ scope, ...input } as never,
			{
				log,
				status: () => {},
				countTokens: (t: string) => Math.ceil(t.length / 4),
				read: async (name: string, q: any) => {
					reads.push({ table: name, query: q })
					if (stub[name]) return stub[name]!(q)
					return host.read!(name as never, q as never, {
						key: "n",
						definitionId: node,
						definitionVersion: 1,
						kind: "query"
					} as never)
				}
			} as never
		)) as any
		expect(r.kind).toBe("ok")
		return { value: r.value, log, reads }
	}
}

const notes = (log: ReturnType<typeof vi.fn>) => log.mock.calls.map((c) => c[1])
const idsOf = (rows: any[]) =>
	rows.map((c) => c.id).filter((id) => typeof id === "number")

describe("lorebook-entries (the place listing and its ways)", () => {
	const NODE = "core:query/lorebook-entries@1"
	const setup = async () => {
		const w = await world()
		const hall = await w.entry(LOCATION_TYPE_ID, "Hall")
		const vault = await w.entry(LOCATION_TYPE_ID, "Vault")
		const yard = await w.entry(LOCATION_TYPE_ID, "Yard")
		await w.link(hall, vault)
		await w.link(hall, yard)
		await w.mark(vault)
		return { w, hall, vault, yard }
	}
	const params = (extra: Record<string, unknown> = {}) => ({
		params: { entryTypes: [LOCATION_TYPE_ID], withLinks: true, ...extra }
	})

	test("an unknown room is not listed and no listed room's ways name it", async () => {
		const { w, hall, vault, yard } = await setup()
		const r = await runner(w, scopes.mira(w))(NODE, params())
		const rows = r.value.main as any[]
		expect(idsOf(rows).sort()).toEqual([hall, yard].sort())
		const ways = rows.flatMap((row) => row.links ?? [])
		expect(JSON.stringify(ways)).not.toContain("Vault")
		expect(JSON.stringify(ways)).toContain("Yard")
		expect(idsOf(rows)).not.toContain(vault)
		expect(notes(r.log)).toContain("1 entry left out: not known by Mira")
	})

	test("listed, and named in the ways, with knownToSpeaker off", async () => {
		const { w, vault } = await setup()
		const r = await runner(w, scopes.mira(w))(
			NODE,
			params({ knownToSpeaker: false })
		)
		const rows = r.value.main as any[]
		expect(idsOf(rows)).toContain(vault)
		expect(JSON.stringify(rows.flatMap((row) => row.links ?? []))).toContain(
			"Vault"
		)
		expect(notes(r.log).join("\n")).not.toMatch(/left out/)
	})

	test("listed for a run that speaks as nobody", async () => {
		const { w, vault } = await setup()
		const r = await runner(w, scopes.nobody(w))(NODE, params())
		expect(idsOf(r.value.main)).toContain(vault)
		expect(notes(r.log)).toContain(
			"Reads everything: not one cast member's turn"
		)
	})

	test("a card-less seat is judged as itself", async () => {
		const { w, vault } = await setup()
		const r = await runner(w, scopes.cardless(w))(NODE, params())
		expect(idsOf(r.value.main)).not.toContain(vault)
		expect(JSON.stringify(r.value.main.flatMap((row: any) => row.links ?? []))).not.toContain(
			"Vault"
		)
	})
})

describe("lorebook-triggers", () => {
	const NODE = "core:query/lorebook-triggers@1"
	/** Alpha fires on the line; its text names Beta's key; Beta's text names Gamma's key. */
	const setup = async () => {
		const w = await world()
		const alpha = await w.entry(WORLD_LORE_TYPE_ID, "Alpha", {
			keys: ["alpha"],
			content: "Alpha speaks of beta."
		})
		const beta = await w.entry(WORLD_LORE_TYPE_ID, "Beta", {
			keys: ["beta"],
			content: "Beta speaks of gamma."
		})
		const gamma = await w.entry(WORLD_LORE_TYPE_ID, "Gamma", {
			keys: ["gamma"],
			content: "Gamma."
		})
		await w.mark(beta)
		await w.say("alpha")
		return { w, alpha, beta, gamma }
	}
	const params = (extra: Record<string, unknown> = {}) => ({
		params: { maxRecursionDepth: 2, ...extra }
	})

	test("an unknown entry neither triggers nor is scanned: its own text reaches nothing", async () => {
		const { w, alpha, beta, gamma } = await setup()
		const r = await runner(w, scopes.mira(w))(NODE, params())
		const ids = idsOf(r.value.main)
		expect(ids).toContain(alpha)
		expect(ids).not.toContain(beta)
		expect(ids).not.toContain(gamma)
		expect(notes(r.log)).toContain("1 entry left out: not known by Mira")
	})

	test("both are admitted with knownToSpeaker off", async () => {
		const { w, beta, gamma } = await setup()
		const r = await runner(w, scopes.mira(w))(
			NODE,
			params({ knownToSpeaker: false })
		)
		const ids = idsOf(r.value.main)
		expect(ids).toContain(beta)
		expect(ids).toContain(gamma)
	})

	test("admitted for a run that speaks as nobody", async () => {
		const { w, beta, gamma } = await setup()
		const r = await runner(w, scopes.nobody(w))(NODE, params())
		expect(idsOf(r.value.main)).toEqual(expect.arrayContaining([beta, gamma]))
	})

	test("a card-less seat's recursion never scans an unknown entry", async () => {
		const { w, beta, gamma } = await setup()
		const r = await runner(w, scopes.cardless(w))(NODE, params())
		const ids = idsOf(r.value.main)
		expect(ids).not.toContain(beta)
		expect(ids).not.toContain(gamma)
	})
})

describe("vector-search and entity-search", () => {
	const setup = async () => {
		const w = await world()
		const known = {
			world: await w.entry(WORLD_LORE_TYPE_ID, "KnownWorld"),
			character: await w.entry(CHARACTER_LORE_TYPE_ID, "KnownSelf", {
				lorebookBindingId: w.member
			})
		}
		const hidden = {
			world: await w.entry(WORLD_LORE_TYPE_ID, "HiddenWorld"),
			character: await w.entry(CHARACTER_LORE_TYPE_ID, "HiddenSelf", {
				lorebookBindingId: w.member
			}),
			history: await w.entry("core:entry/history", "HiddenHistory")
		}
		for (const id of Object.values(hidden)) await w.mark(id)
		const hits = [
			{ id: known.world, source: "worldLore", score: 0.9 },
			{ id: known.character, source: "characterLore", score: 0.8 },
			{ id: hidden.world, source: "worldLore", score: 0.7 },
			{ id: hidden.character, source: "characterLore", score: 0.6 },
			{ id: hidden.history, source: "historyEntry", score: 0.5 }
		]
		return { w, known, hidden, hits }
	}
	const embedded = {
		embedding_status: () => ({ available: true, model: "m" })
	}

	test("vector-search publishes no hit of any lore source whose entry was dropped", async () => {
		const { w, known, hidden, hits } = await setup()
		const stub = {
			...embedded,
			vector_search: () => ({
				lists: [hits],
				candidates: hits,
				similarity: hits.map(() => hits.map(() => 0)),
				truncated: []
			})
		}
		const node = "core:query/vector-search@1"
		const input = {
			vectors: [[1, 0]],
			params: { maxEntries: 10 }
		}
		const r = await runner(w, scopes.mira(w), stub)(node, input)
		const ids = idsOf(r.value.hits)
		expect(ids).toEqual(expect.arrayContaining([known.world, known.character]))
		for (const id of Object.values(hidden)) expect(ids).not.toContain(id)
		expect(notes(r.log)).toContain("3 entries left out: not known by Mira")

		const off = await runner(w, scopes.mira(w), stub)(node, {
			...input,
			params: { ...input.params, knownToSpeaker: false }
		})
		for (const id of Object.values(hidden))
			expect(idsOf(off.value.hits)).toContain(id)
		const nobody = await runner(w, scopes.nobody(w), stub)(node, input)
		expect(idsOf(nobody.value.hits)).toContain(hidden.world)
	})

	test("entity-search's pool, and so what it asks the entity index about, holds no dropped entry", async () => {
		const { w, known, hidden } = await setup()
		const asked: number[][] = []
		const stub = {
			entity_annotations: (q: any) => {
				asked.push(q.entryIds)
				return { entries: [], entities: [], messages: [] }
			}
		}
		const node = "core:query/entity-search@1"
		await runner(w, scopes.mira(w), stub)(node, { params: {} })
		expect(asked[0]).toEqual(expect.arrayContaining([known.world]))
		for (const id of Object.values(hidden)) expect(asked[0]).not.toContain(id)
		await runner(w, scopes.mira(w), stub)(node, {
			params: { knownToSpeaker: false }
		})
		for (const id of Object.values(hidden)) expect(asked[1]).toContain(id)
		await runner(w, scopes.nobody(w), stub)(node, { params: {} })
		expect(asked[2]).toEqual(
			expect.arrayContaining([hidden.world, hidden.history])
		)
	})
})

describe("entity-link", () => {
	const NODE = "core:query/entity-link@1"
	const setup = async () => {
		const w = await world()
		const open = await w.entry(WORLD_LORE_TYPE_ID, "Open")
		const secret = await w.entry(WORLD_LORE_TYPE_ID, "Secret")
		await w.mark(secret)
		const pool = [open, secret].map((id) => ({
			id,
			source: "worldLore",
			signals: {}
		}))
		return { w, open, secret, pool }
	}
	const stub = (asked: number[][]) => ({
		embedding_status: () => ({ available: true, model: "m" }),
		entity_link: (q: any) => {
			asked.push(q.entryIds)
			return { hits: [], diagnostics: {} }
		}
	})
	const input = (pool: unknown[], extra: Record<string, unknown> = {}) => ({
		candidates: pool,
		mentions: [{ text: "the thing", position: 0 }],
		vectors: [[1, 0]],
		params: { maxLinks: 3, ...extra }
	})

	test("with no speaker wired, a pool candidate the scope's speaker does not know is not linked", async () => {
		const { w, open, secret, pool } = await setup()
		const asked: number[][] = []
		const r = await runner(w, scopes.mira(w), stub(asked))(NODE, input(pool))
		expect(asked[0]).toEqual([open])
		expect(asked[0]).not.toContain(secret)
		expect(notes(r.log)).toContain("1 entry left out: not known by Mira")
	})

	test("with knownToSpeaker off and no speaker wired it reads nothing and links the whole pool", async () => {
		const { w, open, secret, pool } = await setup()
		const asked: number[][] = []
		const r = await runner(w, scopes.mira(w), stub(asked))(
			NODE,
			input(pool, { knownToSpeaker: false })
		)
		expect(asked[0]).toEqual([open, secret])
		expect(r.reads.map((x) => x.table)).not.toContain("lorebook_entries")
	})

	test("a run that speaks as nobody links the whole pool", async () => {
		const { w, open, secret, pool } = await setup()
		const asked: number[][] = []
		await runner(w, scopes.nobody(w), stub(asked))(NODE, input(pool))
		expect(asked[0]).toEqual([open, secret])
	})

	test("a card-less seat's turn is judged as that seat", async () => {
		const { w, open, pool } = await setup()
		const asked: number[][] = []
		await runner(w, scopes.cardless(w), stub(asked))(NODE, input(pool))
		expect(asked[0]).toEqual([open])
	})
})

describe("relationship-search (the hop)", () => {
	const NODE = "core:query/relationship-search@1"
	const setup = async () => {
		const w = await world()
		const umber = await w.entry(LOCATION_TYPE_ID, "Umber Room", {
			keys: ["umber room"]
		})
		const tunnel = await w.entry(LOCATION_TYPE_ID, "Salt Tunnel")
		const cache = await w.entry(LOCATION_TYPE_ID, "Secret Cache")
		await w.link(umber, tunnel)
		await w.link(umber, cache)
		await w.mark(cache)
		await w.say("we open the umber room")
		return { w, tunnel, cache }
	}
	const hopNames = (r: { value: any }) =>
		(r.value.main as any[])
			.filter((c) => c?.payload?.via === "link")
			.map((c) => c.payload.name)
	const params = (extra: Record<string, unknown> = {}) => ({
		params: { share: 0.1, ...extra }
	})

	test("never arrives at an unknown entry", async () => {
		const { w } = await setup()
		const r = await runner(w, scopes.mira(w))(NODE, params())
		expect(hopNames(r)).toEqual(["Salt Tunnel"])
		expect(notes(r.log)).toContain("1 entry left out: not known by Mira")
	})

	test("arrives at it with knownToSpeaker off", async () => {
		const { w } = await setup()
		const r = await runner(w, scopes.mira(w))(
			NODE,
			params({ knownToSpeaker: false })
		)
		expect(hopNames(r).sort()).toEqual(["Salt Tunnel", "Secret Cache"])
	})

	test("arrives at it for a run that speaks as nobody", async () => {
		const { w } = await setup()
		const r = await runner(w, scopes.nobody(w))(NODE, params())
		expect(hopNames(r).sort()).toEqual(["Salt Tunnel", "Secret Cache"])
	})

	test("a card-less seat's hop is judged as the seat, not as nobody", async () => {
		const { w } = await setup()
		const r = await runner(w, scopes.cardless(w))(NODE, params())
		expect(hopNames(r)).toEqual(["Salt Tunnel"])
		const entriesRead = r.reads.find((x) => x.table === "lorebook_entries")
		expect(entriesRead?.query.currentCastMemberId).toBe(w.cardless)
	})
})

describe("entries-named", () => {
	const NODE = "core:query/entries-named@1"
	const setup = async () => {
		const w = await world()
		const open = await w.entry(WORLD_LORE_TYPE_ID, "Cinder")
		const secret = await w.entry(WORLD_LORE_TYPE_ID, "Ember")
		await w.mark(secret)
		return { w, open, secret }
	}
	const input = (extra: Record<string, unknown> = {}) => ({
		messages: [{ id: 1, content: "Cinder and Ember came back." }],
		params: { ...extra }
	})
	const named = (r: { value: any }) =>
		(r.value.main as any[]).map((x) => x.entryId)

	test("a marked entry the speaker is not tied to is not returned, and the note counts it", async () => {
		const { w, open, secret } = await setup()
		const r = await runner(w, scopes.mira(w))(NODE, input())
		expect(named(r)).toEqual([open])
		expect(named(r)).not.toContain(secret)
		expect(r.value.ids).toEqual([open])
		expect(notes(r.log)).toContain("1 entry left out: not known by Mira")
	})

	test("returned with knownToSpeaker off", async () => {
		const { w, open, secret } = await setup()
		const r = await runner(w, scopes.mira(w))(
			NODE,
			input({ knownToSpeaker: false })
		)
		expect(named(r).sort()).toEqual([open, secret].sort())
	})

	test("returned for a run that speaks as nobody", async () => {
		const { w, open, secret } = await setup()
		const r = await runner(w, scopes.nobody(w))(NODE, input())
		expect(named(r).sort()).toEqual([open, secret].sort())
		expect(notes(r.log)).toContain(
			"Reads everything: not one cast member's turn"
		)
	})

	test("a card-less seat is judged as itself; the note counts only what the lines named", async () => {
		const { w, open } = await setup()
		await w.mark(await w.entry(WORLD_LORE_TYPE_ID, "Never Named"))
		const r = await runner(w, scopes.cardless(w))(NODE, input())
		expect(named(r)).toEqual([open])
		expect(notes(r.log)).toContain("1 entry left out: not known by Ola")
	})
})

describe("the standing place counts as known", () => {
	const setup = async () => {
		const w = await world()
		const vault = await w.entry(LOCATION_TYPE_ID, "Vault")
		const cellar = await w.entry(LOCATION_TYPE_ID, "Cellar")
		await w.mark(vault)
		await w.mark(cellar)
		return { w, vault, cellar }
	}
	const stand = async (
		w: World,
		owner: { kind: "seated_member" | "session"; id: number },
		value: unknown
	) => {
		const { applyChange } = await import("$lib/server/state/write")
		await applyChange(
			db(),
			{ sessionId: w.sessionId, updatedBy: "user" },
			{ owner, slotId: LOCATION_SLOT, value } as never
		)
	}
	const judged = async (w: World, speaker: string) => {
		const k = await loadEntryKnowledge(db(), {
			sessionId: w.sessionId,
			speaker
		})
		expect(k.kind).toBe("judged")
		return k as Extract<typeof k, { kind: "judged" }>
	}

	test("a stored name: the room the member stands in is listed; a second marked room stays out", async () => {
		const { w, vault, cellar } = await setup()
		await stand(w, { kind: "seated_member", id: w.member }, "Vault")
		const k = await judged(w, `character:${w.cardId}`)
		expect(k.leftOut.map((l) => l.entryId)).toEqual([cellar])
		expect(k.notKnown).toBe(1)
		const r = await runner(w, scopes.mira(w))("core:query/lorebook-entries@1", {
			params: { entryTypes: [LOCATION_TYPE_ID] }
		})
		expect(idsOf(r.value.main)).toEqual([vault])
		expect(notes(r.log)).toContain("1 entry left out: not known by Mira")
	})

	test("an entry reference, stored on the cast member, counts even against a kept-from tie", async () => {
		const { w, vault, cellar } = await setup()
		await stand(w, { kind: "seated_member", id: w.member }, { entryId: vault })
		const { writeKnowledgeTie } = await import("$lib/server/lorebooks/entryKnowledge")
		await writeKnowledgeTie(db(), {
			userId: w.userId,
			lorebookId: (
				await testDb.query.sessions.findFirst({
					where: (s, { eq }) => eq(s.id, w.sessionId)
				})
			)!.lorebookId!,
			castMemberId: w.member,
			entryId: vault,
			kind: "kept_from"
		})
		const k = await judged(w, `character:${w.cardId}`)
		expect(k.leftOut.map((l) => l.entryId)).toEqual([cellar])
		expect(k.keptFrom).toBe(0)
	})

	test("the world's place is the fallback when the member has none", async () => {
		const { w, vault, cellar } = await setup()
		await stand(w, { kind: "session", id: w.sessionId }, "Cellar")
		const k = await judged(w, `character:${w.cardId}`)
		expect(k.leftOut.map((l) => l.entryId)).toEqual([vault])
		expect(cellar).toBeGreaterThan(0)
	})

	test("a place that is not a left-out entry changes nothing", async () => {
		const { w, vault, cellar } = await setup()
		await stand(w, { kind: "seated_member", id: w.member }, "the old mill")
		const k = await judged(w, `character:${w.cardId}`)
		expect(k.leftOut.map((l) => l.entryId).sort()).toEqual([vault, cellar].sort())
	})

	test("only a place entry is stood in: a marked lore entry with the place's name stays out of a lore lane", async () => {
		const { w } = await setup()
		const crypt = await w.entry(WORLD_LORE_TYPE_ID, "Crypt", { constant: true })
		const tomb = await w.entry(WORLD_LORE_TYPE_ID, "Tomb", { constant: true })
		await w.mark(crypt)
		await w.mark(tomb)
		await stand(w, { kind: "seated_member", id: w.member }, "Crypt")
		const r = await runner(w, scopes.mira(w))("core:query/world-lore@1")
		const ids = idsOf(r.value.main)
		expect(ids).not.toContain(crypt)
		expect(ids).not.toContain(tomb)
	})
})
