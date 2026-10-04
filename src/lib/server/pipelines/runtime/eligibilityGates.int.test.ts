/**
 * **The eligibility gate's feeds, end to end** (plan C2, owner rulings R2 and
 * R4, built 2026-10-02).
 *
 * `core:task/eligibility@1` is pure and its rules are unit-tested in
 * `ranking/eligibility.test.ts`, handed presences, a moment and exclusion lists
 * already decided. What that file cannot see is whether the real producers
 * hand it the right ones. So this starts at rows in a database and ends at the
 * gate's verdicts, with the host and the bindings in between:
 *
 * 1. **`core:query/cast-presences@1`** answers the cast's presences on the
 *    session's LINE — its own spans plus each ancestor's that begin by the fork
 *    cut, never a sibling's — and `at`, the session's story clock. A member
 *    with no presences contributes no rows; no session, or no book, is nothing
 *    at the head and never a throw.
 * 2. **The keyword lanes' `exclusions`** (`exclusionsFrom`): an entry an
 *    author's own selective logic ruled out is absent from `main` and
 *    published as `{ source, id, reason }`.
 * 3. **The gate itself**, fed (1) and (2) for real: a copy of the excluded
 *    entry another mechanism brings in is marked with the exclusion's
 *    sentence; a cast member's lore whose member is out of the world at the
 *    session's moment is marked "<Name> is not in the world at <date>."; the
 *    same candidate on a line where she is present passes; a member with no
 *    presences is never gated.
 * 4. **Secrecy**: the relationship read for speaker A marks A's secret tie
 *    `secretOf: character:A`, and the gate rules it out for speaker B only.
 *
 * Bindings are invoked directly, each with a host scoped to the session it
 * reads, the way `secretAnnexField.int.test.ts` and
 * `sessions.channelEntries.int.test.ts` do.
 */

import { afterAll, beforeAll, describe, expect, it, vi } from "vitest"
import fs from "fs/promises"
import os from "os"
import path from "path"
import { isBandIntent, splitCandidates } from "@serene-pub/sdk"
import type { TestDb } from "$lib/server/utils/testDb"
import * as schema from "$lib/server/db/schema"
import { eq } from "drizzle-orm"
import {
	characterLoreValues,
	worldLoreValues
} from "$lib/server/pipelines/testing/fixtures"
import { coreBindings } from "$lib/server/pipelines/runtime/bindings"
import { createHost } from "$lib/server/pipelines/runtime/host"

// No embedding model: the keyword lanes need no network, and nothing here
// asserts on the semantic mechanism.
vi.mock("$lib/server/embedding", () => ({
	isModelReady: () => false,
	getLoadedModelId: () => null
}))

vi.mock("$lib/server/db", async () => {
	const { createTestDb } = await import("$lib/server/utils/testDb")
	const db = await createTestDb()
	return { db, getCryptoSecretKey: () => "eligibility-gates-secret" }
})

let db: TestDb
let dataDir: string

/** Main at Y12 M3 D4; the fork at Y7; a session with no book. */
const session = { main: 0, fork: 0, bare: 0 }
/** Background members (narrator-visible lore) and the two carded speakers. */
const member = { verity: 0, brask: 0, amara: 0, kiran: 0 }
const card = { amara: 0, kiran: 0 }
const branch = { elsewhere: 0, sibling: 0 }
const entry: Record<string, number> = {}

const MAIN_CLOCK = { year: 12, month: 3, day: 4 }
const FORK_CLOCK = { year: 7, month: null, day: null }

type Binding = (input: unknown, ctx: unknown) => Promise<any>
const bindings = coreBindings() as unknown as Record<string, Binding>

/** A query ctx whose reads go through a host scoped to `sessionId`. */
const ctxFor = (sessionId: number | undefined, definitionId: string) => {
	const host = createHost(
		db as any,
		sessionId === undefined ? {} : { sessionId }
	)
	const node = {
		key: "gate",
		definitionId,
		definitionVersion: 1,
		kind: "query"
	}
	return {
		signal: new AbortController().signal,
		progress: () => {},
		log: () => {},
		status: () => {},
		countTokens: (text: string) => Math.ceil(text.length / 4),
		read: (table: string, query: unknown) =>
			host.read!(table as any, query, node as any)
	}
}

/** Run one binding and answer its `ok` value. */
const invoke = async (
	definitionId: string,
	input: unknown,
	sessionId?: number
) => {
	const binding = bindings[definitionId]
	expect(binding, `${definitionId} is not bound`).toBeTypeOf("function")
	const out = await binding!(input, ctxFor(sessionId, definitionId))
	expect(out?.kind, JSON.stringify(out)?.slice(0, 400)).toBe("ok")
	return out.value
}

const presencesOf = (sessionId: number | undefined, scope?: object) =>
	invoke(
		"core:query/cast-presences@1",
		{ scope: scope ?? (sessionId === undefined ? {} : { sessionId }) },
		sessionId
	)

/** The narrator's scope: no voice, so background members' lore is readable. */
const narrator = (sessionId: number) => ({ sessionId, currentCharacterId: null })

const worldLore = (sessionId: number) =>
	invoke("core:query/world-lore@1", { scope: narrator(sessionId) }, sessionId)

const characterLore = (sessionId: number) =>
	invoke(
		"core:query/character-lore@1",
		{ scope: narrator(sessionId) },
		sessionId
	)

const items = (list: unknown) => splitCandidates<any>(list as any[]).items
const byPosition = (rows: any[]) =>
	[...rows].sort((a, b) => (a.position ?? 0) - (b.position ?? 0))

/**
 * A copy of the excluded entry as another mechanism (the vector search, say)
 * would bring it in — same `source:id`, its own signal.
 */
const vectorCopyOfAshguard = () => ({
	id: entry.ashguard,
	source: "worldLore",
	tokens: 8,
	signals: { semantic: 0.9 },
	payload: { id: entry.ashguard, name: "The Ashguard", foundBy: "vector" }
})

/** The gate fed the session's own presences and its world-lore lane's exclusions. */
const gateFor = async (sessionId: number, extra: unknown[] = []) => {
	const presences = await presencesOf(sessionId)
	const world = await worldLore(sessionId)
	const character = await characterLore(sessionId)
	return await invoke(
		"core:task/eligibility@1",
		{
			candidates: [...world.main, ...character.main, ...extra],
			exclusions: world.exclusions,
			speaker: null,
			presences: presences.main,
			at: presences.at
		},
		sessionId
	)
}

const named = (list: unknown, name: string) =>
	items(list).find((c) => c?.payload?.name === name)

beforeAll(async () => {
	dataDir = await fs.mkdtemp(
		path.join(os.tmpdir(), "serene-pub-eligibility-gates-")
	)
	process.env.SERENE_PUB_DATA_DIR = dataDir
	db = (await import("$lib/server/db")).db as unknown as TestDb
	await (await import("$lib/server/db/defaults")).sync()

	const [user] = await db
		.insert(schema.users)
		.values({ username: "eligibility-gates", isAdmin: false })
		.returning()
	const [book] = await db
		.insert(schema.lorebooks)
		.values({ name: "Ashfall", userId: user.id })
		.returning()

	// Elsewhere forks main at Y5 (main's spans that begin by then read
	// through); Sibling forks at NOW and must never reach main or Elsewhere.
	const fork = async (name: string, values: Record<string, unknown>) =>
		(
			await db
				.insert(schema.lorebookBranches)
				.values({ lorebookId: book.id, name, ...values } as any)
				.returning()
		)[0]!.id
	branch.elsewhere = await fork("Elsewhere", { forkYear: 5 })
	branch.sibling = await fork("Sibling", {})

	const seat = async (values: Record<string, unknown>) =>
		(
			await db
				.insert(schema.sessions)
				.values({ userId: user.id, isGroup: false, ...values } as any)
				.returning()
		)[0]!.id
	session.main = await seat({
		lorebookId: book.id,
		storyClockYear: MAIN_CLOCK.year,
		storyClockMonth: MAIN_CLOCK.month,
		storyClockDay: MAIN_CLOCK.day
	})
	session.fork = await seat({
		lorebookId: book.id,
		lorebookBranchId: branch.elsewhere,
		storyClockYear: FORK_CLOCK.year
	})
	session.bare = await seat({})

	const character = async (name: string) =>
		(
			await db
				.insert(schema.characters)
				.values({ userId: user.id, name, description: `${name}.` })
				.returning()
		)[0]!.id
	card.amara = await character("Amara")
	card.kiran = await character("Kiran")

	const [verity, brask, amara, kiran] = await db
		.insert(schema.lorebookBindings)
		.values([
			// Background members: no linked card, so the narrator reads their lore.
			{ lorebookId: book.id, binding: "{{char:1}}", name: "Verity" },
			{ lorebookId: book.id, binding: "{{char:2}}", name: "Brask" },
			// Carded members: the relationship read's speakers.
			{
				lorebookId: book.id,
				binding: "{{char:3}}",
				name: "Amara",
				characterId: card.amara
			},
			{
				lorebookId: book.id,
				binding: "{{char:4}}",
				name: "Kiran",
				characterId: card.kiran
			}
		])
		.returning()
	member.verity = verity!.id
	member.brask = brask!.id
	member.amara = amara!.id
	member.kiran = kiran!.id

	// Verity is dated on three lines; Brask on none.
	const presence = (
		branchId: number | null,
		personalPosition: number,
		fromYear: number,
		untilYear: number | null
	) => ({
		lorebookId: book.id,
		lorebookBindingId: member.verity,
		branchId,
		personalPosition,
		fromYear,
		untilYear
	})
	await db.insert(schema.castPresences).values([
		presence(null, 1, 1, 10), // main, read through by Elsewhere (begins by Y5)
		presence(branch.elsewhere, 2, 6, null), // Elsewhere's own
		presence(branch.sibling, 3, 2, null), // Sibling's own: never main's
		presence(null, 4, 8, 9) // main, after Elsewhere's fork cut
	])

	const world = await db
		.insert(schema.lorebookEntries)
		.values(
			worldLoreValues([
				{
					lorebookId: book.id,
					name: "The Lantern Road",
					keys: "ashguard",
					content: "The road the riders keep."
				},
				{
					// Primary key fires; its own condition says not here.
					lorebookId: book.id,
					name: "The Ashguard",
					keys: "ashguard",
					secondaryKeys: "wyrm",
					selectiveLogic: "andAny",
					content: "An order of oathbound riders."
				},
				{
					lorebookId: book.id,
					name: "The Dark Room",
					keys: "ashguard",
					content: "Switched off.",
					enabled: false
				},
				{
					lorebookId: book.id,
					name: "The Shelf",
					keys: "ashguard",
					content: "Shelved.",
					archived: true
				}
			] as any)
		)
		.returning({
			id: schema.lorebookEntries.id,
			title: schema.lorebookEntries.title
		})
	const worldKey: Record<string, string> = {
		"The Lantern Road": "road",
		"The Ashguard": "ashguard",
		"The Dark Room": "off",
		"The Shelf": "shelved"
	}
	for (const row of world) entry[worldKey[row.title!]!] = row.id

	const lore = await db
		.insert(schema.lorebookEntries)
		.values(
			characterLoreValues([
				{
					lorebookId: book.id,
					name: "Verity's secret",
					keys: "",
					content: "She has the key already.",
					constant: true,
					lorebookBindingId: member.verity
				},
				{
					lorebookId: book.id,
					name: "Brask's secret",
					keys: "",
					content: "He cannot swim.",
					constant: true,
					lorebookBindingId: member.brask
				}
			] as any)
		)
		.returning({
			id: schema.lorebookEntries.id,
			title: schema.lorebookEntries.title
		})
	for (const row of lore)
		entry[row.title === "Verity's secret" ? "verityLore" : "braskLore"] = row.id

	// Amara's own ties: one secret (to Kiran), one acknowledged (to Brask).
	await db.insert(schema.narrativeRelationships).values([
		{
			lorebookId: book.id,
			fromNodeId: member.amara,
			toNodeId: member.kiran,
			relationshipType: "suspects",
			visibility: "secret",
			status: "active",
			description: ""
		},
		{
			lorebookId: book.id,
			fromNodeId: member.amara,
			toNodeId: member.brask,
			relationshipType: "trusts",
			visibility: "acknowledged",
			status: "active",
			description: ""
		}
	] as any)

	await db.insert(schema.sessionMessages).values([
		{ sessionId: session.main, role: "user", content: "tell me about the ashguard" },
		{ sessionId: session.fork, role: "user", content: "tell me about the ashguard" }
	] as any)
}, 60_000)

afterAll(async () => {
	await fs.rm(dataDir, { recursive: true, force: true })
})

describe("core:query/cast-presences@1 — the cast's presences on the session's line", () => {
	it(
		"main reads main's spans only, never a fork's, at the session's own clock",
		async () => {
			const read = await presencesOf(session.main)
			expect(byPosition(read.main)).toEqual([
				{
					bindingId: member.verity,
					from: { year: 1 },
					until: { year: 10 },
					position: 1
				},
				{
					bindingId: member.verity,
					from: { year: 8 },
					until: { year: 9 },
					position: 4
				}
			])
			// The moment, with its spelling (the book declares no calendar,
			// so it is the free-form one).
			expect(read.at).toEqual({
				...MAIN_CLOCK,
				label: "Year 12, Mo. 3, Day 4"
			})
			expect(read.diagnostics).toEqual({ presences: 2 })
		},
		60_000
	)

	it(
		"a fork reads its own spans and main's that begin by its fork cut — never a sibling's",
		async () => {
			const read = await presencesOf(session.fork)
			expect(byPosition(read.main).map((r: any) => r.position)).toEqual([1, 2])
			expect(byPosition(read.main)[1]).toEqual({
				bindingId: member.verity,
				from: { year: 6 },
				until: null,
				position: 2
			})
			expect(read.at).toEqual({ ...FORK_CLOCK, label: "Year 7" })
		},
		60_000
	)

	it(
		"a member with no presences contributes no rows",
		async () => {
			for (const sessionId of [session.main, session.fork]) {
				const read = await presencesOf(sessionId)
				const members = new Set(read.main.map((r: any) => r.bindingId))
				expect([...members]).toEqual([member.verity])
			}
		},
		60_000
	)

	it(
		"the moment is spelled through the book's calendar, when it declares one",
		async () => {
			const [{ lorebookId }] = await db
				.select({ lorebookId: schema.sessions.lorebookId })
				.from(schema.sessions)
				.where(eq(schema.sessions.id, session.main))
			await db
				.update(schema.lorebooks)
				.set({
					storyCalendar: {
						months: [
							{ name: "Frost", days: 30 },
							{ name: "Thaw", days: 30 },
							{ name: "Bloom", days: 30 }
						]
					} as any
				})
				.where(eq(schema.lorebooks.id, lorebookId!))
			try {
				const read = await presencesOf(session.main)
				expect(read.at).toMatchObject(MAIN_CLOCK)
				expect(read.at.label).toContain("Bloom")
			} finally {
				await db
					.update(schema.lorebooks)
					.set({ storyCalendar: null } as any)
					.where(eq(schema.lorebooks.id, lorebookId!))
			}
		},
		60_000
	)

	it(
		"no book, or no session: nothing, at the head, and no throw",
		async () => {
			expect(await presencesOf(session.bare)).toMatchObject({
				main: [],
				at: null
			})
			expect(await presencesOf(undefined)).toMatchObject({
				main: [],
				at: null
			})
		},
		60_000
	)
})

describe("the keyword lanes' exclusions — what an author's own condition ruled out", () => {
	it(
		"an entry whose selective logic fails is absent from main and published with its reason",
		async () => {
			const world = await worldLore(session.main)
			const found = items(world.main).map((c) => c.id)
			expect(found).toContain(entry.road)
			expect(found).not.toContain(entry.ashguard)

			const ruledOut = (world.exclusions as any[]).find(
				(e) => e.id === entry.ashguard
			)
			expect(ruledOut).toEqual({
				source: "worldLore",
				id: entry.ashguard,
				reason:
					"Ruled out by its own condition: its keywords matched, but none of its secondary keywords were in the conversation (wyrm)."
			})
			// The same verdict is on `skipped`, as an exclusion and not a miss.
			expect(
				(world.skipped as any[]).find((s) => s.id === entry.ashguard)?.kind
			).toBe("excluded")
		},
		60_000
	)

	/**
	 * `bindings.ts`' `exclusionsFrom` docblock: "Disabled and shelved rows
	 * are not verdicts." The host's scan read keeps them on purpose (its
	 * docblock at `lorebook_entries`; `loreReading.int.test.ts` pins it) and
	 * the keyword scan skips them as `kind: "excluded"`, so `exclusionsFrom`
	 * leaves the two shelved reasons out (`SHELVED_SKIP_REASONS`, fixed
	 * 2026-10-02 after this test caught them published).
	 */
	it(
		"disabled and archived entries are not published as exclusions",
		async () => {
			const world = await worldLore(session.main)
			const ids = (world.exclusions as any[]).map((e) => e.id)
			expect(ids).not.toContain(entry.off)
			expect(ids).not.toContain(entry.shelved)
		},
		60_000
	)

	it(
		"disabled and archived entries never reach main",
		async () => {
			const found = items((await worldLore(session.main)).main).map(
				(c) => c.id
			)
			expect(found).not.toContain(entry.off)
			expect(found).not.toContain(entry.shelved)
		},
		60_000
	)
})

describe("core:task/eligibility@1, fed the real producers", () => {
	it(
		"marks the excluded entry's copy with the exclusion's sentence, and an absent member's lore with presence's",
		async () => {
			const gate = await gateFor(session.main, [vectorCopyOfAshguard()])

			const copy = items(gate.main).find(
				(c) => c.source === "worldLore" && c.id === entry.ashguard
			)
			expect(copy?.ineligible).toEqual({
				reason:
					"Ruled out by its own condition: its keywords matched, but none of its secondary keywords were in the conversation (wyrm)."
			})

			// Main at Y12: Verity's main spans [1,10) and [8,9) are both over —
			// and Sibling's open-ended span (from Y2) did not leak in to save her.
			const verity = named(gate.main, "Verity's secret")
			expect(verity?.payload?.lorebookBindingId).toBe(member.verity)
			expect(verity?.payload?.castMember).toBe("Verity")
			expect(verity?.ineligible).toEqual({
				reason: "Verity is not in the world at Year 12, Mo. 3, Day 4."
			})

			// Brask has no presences: always present, never gated.
			const brask = named(gate.main, "Brask's secret")
			expect(brask?.payload?.lorebookBindingId).toBe(member.brask)
			expect(brask).toBeTruthy()
			expect(brask.ineligible).toBeUndefined()

			const road = named(gate.main, "The Lantern Road")
			expect(road).toBeTruthy()
			expect(road.ineligible).toBeUndefined()

			expect(gate.diagnostics).toEqual({
				excluded: 1,
				secret: 0,
				absent: 1,
				alreadyIneligible: 0
			})
		},
		60_000
	)

	it(
		"keeps every candidate and band intent, intents first — it marks, never deletes",
		async () => {
			const world = await worldLore(session.main)
			const character = await characterLore(session.main)
			const gate = await gateFor(session.main, [vectorCopyOfAshguard()])
			const before = [
				...items(world.main),
				...items(character.main),
				vectorCopyOfAshguard()
			].map((c) => `${c.source}:${c.id}`)
			expect(items(gate.main).map((c) => `${c.source}:${c.id}`)).toEqual(
				before
			)
			const { intents } = splitCandidates(gate.main)
			expect(intents.map((i) => i.band).sort()).toEqual(
				["characterLore", "worldLore"].sort()
			)
			// Intents lead the list.
			const firstItem = (gate.main as any[]).findIndex(
				(c) => !isBandIntent(c)
			)
			expect(firstItem).toBe(intents.length)
			expect(gate.candidates).toEqual(gate.main)
		},
		60_000
	)

	it(
		"the same member is present on a line where she is in the world",
		async () => {
			// Elsewhere at Y7: its own span from Y6 holds (main's [1,10) does too).
			const gate = await gateFor(session.fork)
			const verity = named(gate.main, "Verity's secret")
			expect(verity).toBeTruthy()
			expect(verity.ineligible).toBeUndefined()
			expect(named(gate.main, "Brask's secret")?.ineligible).toBeUndefined()
			expect(gate.diagnostics.absent).toBe(0)
		},
		60_000
	)
})

describe("secrecy: a speaker's secret tie, gated for every other speaker", () => {
	const amarasTies = async () =>
		items(
			(
				await invoke(
					"core:query/relationship-search@1",
					{
						scope: {
							sessionId: session.main,
							currentCharacterId: card.amara
						}
					},
					session.main
				)
			).main
		)

	const gate = async (candidates: unknown[], speaker: string | null) =>
		await invoke(
			"core:task/eligibility@1",
			{ candidates, exclusions: [], speaker, presences: [], at: null },
			session.main
		)

	it(
		"the relationship read marks the speaker's secret tie as theirs, and only that one",
		async () => {
			const ties = await amarasTies()
			expect(ties.length).toBe(2)
			const secret = ties.find((t) => t.payload?.name === "Kiran")
			const open = ties.find((t) => t.payload?.name === "Brask")
			expect(secret?.payload?.secretOf).toBe(`character:${card.amara}`)
			expect(open).toBeTruthy()
			expect(open.payload.secretOf).toBeUndefined()
		},
		60_000
	)

	it(
		"rules the secret out for another speaker, and leaves it for its holder and for no speaker",
		async () => {
			const ties = await amarasTies()

			const forKiran = await gate(ties, `character:${card.kiran}`)
			expect(named(forKiran.main, "Kiran")?.ineligible).toEqual({
				reason: "A secret the speaker does not hold."
			})
			expect(named(forKiran.main, "Brask")?.ineligible).toBeUndefined()
			expect(forKiran.diagnostics.secret).toBe(1)

			const forAmara = await gate(ties, `character:${card.amara}`)
			expect(named(forAmara.main, "Kiran")?.ineligible).toBeUndefined()
			expect(forAmara.diagnostics.secret).toBe(0)

			// No speaker: the producer's scope already decided.
			const forNobody = await gate(ties, null)
			expect(named(forNobody.main, "Kiran")?.ineligible).toBeUndefined()
		},
		60_000
	)
})
