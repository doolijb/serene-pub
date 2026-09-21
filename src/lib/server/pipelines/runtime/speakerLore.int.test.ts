/**
 * **Per-speaker lore scope** (W1, ruled 2026-09-17) — the `speaker` half of the
 * host's `lorebook_entries` read.
 *
 * ## The defect
 *
 * Character-lore visibility is decided at the host read against ONE subject,
 * and that subject was the run's `scope.currentCharacterId`. A multi-agent turn
 * gathers ONCE and then speaks as several people, so every voice of an
 * Adventure or Lair turn was handed every cast member's private
 * self-knowledge — and Whodunit, whose whole premise is that the suspects do
 * not know each other's secrets, wired no character-lore lane at all rather
 * than leak them.
 *
 * `core:query/character-lore@1` and `core:query/lorebook-triggers@1` declare a
 * `speaker` in-port for it: a participant reference (`character:<id>`) a spec
 * wires INSIDE the repeating clause, which the host resolves and applies
 * `isCharacterLoreEntryVisible` for in place of the scope's subject.
 *
 * ## What is pinned here
 *
 * 1. **Two speakers, one host, disjoint pools.** The reads are made from ONE
 *    `createHost` with ONE scope, which is exactly the shape a turn has: the
 *    run is one run and the speaker is a property of the iteration.
 * 2. **A wired speaker never widens the gate.** Unwired, the scope decides as
 *    it always did. Wired and naming nobody the host can resolve to a cast row
 *    — an envoy, a role, a free-form side character, a bare name — the subject
 *    is one no binding can carry, so the voice reads no private lore at all.
 *    `null` would have meant the omniscient narrator, which is the leak.
 * 3. **W3** (ruled the same day): an **unbound** character-lore entry — one
 *    with no `lorebookBindingId` — is the narrator's and the listing's, and
 *    invisible to every specific speaker. A private entry nobody was bound to
 *    is the world's knowledge, not a secret.
 *
 * ⚠ Written against the **host read** rather than through a run, on
 * `lorebookListing.int.test.ts`'s terms: the binding is plumbing over this and
 * the rules are all here. The graph half — that a spec can wire the port inside
 * an `each` at all, and that two voices carry two subjects — is
 * `serene-pub-sdk/sdk-tests/speakerLore.test.ts` and the Lair suite.
 */

import { describe, it, expect, beforeAll, vi } from "vitest"
import fs from "fs/promises"
import os from "os"
import path from "path"
import { type TestDb } from "$lib/server/utils/testDb"
import * as schema from "$lib/server/db/schema"
import {
	worldLoreValues,
	characterLoreValues
} from "$lib/server/pipelines/testing/fixtures"
import { createHost } from "$lib/server/pipelines/runtime/host"

vi.mock("$lib/server/db", async () => {
	const { createTestDb } = await import("$lib/server/utils/testDb")
	const db = await createTestDb()
	return { db, getCryptoSecretKey: () => "speaker-lore-secret" }
})

let db: TestDb
let sessionId: number
/** The two cast members whose private lore must not meet. */
let verity: number
let brask: number

/** What a query node looks like to `assertScoped`. */
const node = {
	key: "lore",
	definitionId: "core:query/character-lore@1",
	definitionVersion: 1,
	kind: "query"
}

/**
 * ONE host, one scope — the run — read several times with different speakers,
 * which is what a `each` over voices does.
 */
let host: ReturnType<typeof createHost>

const read = async (query: Record<string, unknown>): Promise<any[]> => {
	if (!host.read) throw new Error("this host answers no reads")
	return (await host.read(
		"lorebook_entries",
		{ sessionId, ...query },
		node as any
	)) as any[]
}

/** The character-lore rows a read admitted, by name. */
const loreFor = async (query: Record<string, unknown>) =>
	(await read(query))
		.filter((r) => r.source === "characterLore")
		.map((r) => r.name)
		.sort()

beforeAll(async () => {
	process.env.SERENE_PUB_DATA_DIR = await fs.mkdtemp(
		path.join(os.tmpdir(), "serene-pub-speaker-lore-")
	)
	db = (await import("$lib/server/db")).db as unknown as TestDb
	await (await import("$lib/server/db/defaults")).sync()

	const [user] = await db
		.insert(schema.users)
		.values({ username: "speaker-lore", isAdmin: false })
		.returning()

	const [book] = await db
		.insert(schema.lorebooks)
		.values({ name: "The dungeon", userId: user.id })
		.returning()

	const [session] = await db
		.insert(schema.sessions)
		.values({ userId: user.id, isGroup: false, lorebookId: book.id })
		.returning()
	sessionId = session.id

	const [v] = await db
		.insert(schema.characters)
		.values({ userId: user.id, name: "Verity", description: "Lies for a living." })
		.returning()
	const [b] = await db
		.insert(schema.characters)
		.values({ userId: user.id, name: "Brask", description: "Carries the lamp." })
		.returning()
	verity = v.id
	brask = b.id

	// Two character bindings — the private-self-knowledge rule's subject — and
	// one NPC binding, which names nobody and is therefore the narrator's.
	const bindings = await db
		.insert(schema.lorebookBindings)
		.values([
			{
				lorebookId: book.id,
				binding: "{{char:1}}",
				name: "Verity",
				characterId: verity
			},
			{
				lorebookId: book.id,
				binding: "{{char:2}}",
				name: "Brask",
				characterId: brask
			},
			{ lorebookId: book.id, binding: "{{char:3}}", name: "The Ashguard" }
		])
		.returning()
	const [vBinding, bBinding, npcBinding] = bindings

	await db.insert(schema.lorebookEntries).values([
		...worldLoreValues([
			{
				lorebookId: book.id,
				name: "The Old Well",
				keys: "",
				content: "Everybody can see the well."
			}
		]),
		...characterLoreValues([
			{
				lorebookId: book.id,
				name: "Verity's secret",
				keys: "",
				content: "She has the key already.",
				lorebookBindingId: vBinding.id
			},
			{
				lorebookId: book.id,
				name: "Brask's secret",
				keys: "",
				content: "He cannot swim.",
				lorebookBindingId: bBinding.id
			},
			{
				lorebookId: book.id,
				name: "The Ashguard's orders",
				keys: "",
				content: "Nobody in the party knows this.",
				lorebookBindingId: npcBinding.id
			},
			// W3: bound to nothing at all.
			{
				lorebookId: book.id,
				name: "An orphan note",
				keys: "",
				content: "Written before anyone was bound to it."
			}
		])
	])

	host = createHost(db as any, { sessionId, currentCharacterId: null })
}, 60_000)

describe("two voices in one run", () => {
	it(
		"read disjoint private lore — each voice sees only its own",
		async () => {
			const one = await loreFor({ speaker: `character:${verity}` })
			const two = await loreFor({ speaker: `character:${brask}` })

			expect(one).toEqual(["Verity's secret"])
			expect(two).toEqual(["Brask's secret"])
			// The claim, stated as the disjointness it is — and made from ONE
			// host with ONE scope, because that is the shape a turn has.
			expect(one.filter((n) => two.includes(n))).toEqual([])
		},
		60_000
	)

	it(
		"still share everything that is not private",
		async () => {
			const world = async (speaker: string) =>
				(await read({ speaker }))
					.filter((r) => r.source === "worldLore")
					.map((r) => r.name)

			expect(await world(`character:${verity}`)).toEqual(["The Old Well"])
			expect(await world(`character:${brask}`)).toEqual(["The Old Well"])
		},
		60_000
	)

	it(
		"never see the NPC binding's lore, which is the narrator's",
		async () => {
			for (const who of [verity, brask])
				expect(await loreFor({ speaker: `character:${who}` })).not.toContain(
					"The Ashguard's orders"
				)
		},
		60_000
	)
})

describe("an unwired speaker changes nothing (W1)", () => {
	it(
		"the scope decides, exactly as it did before the port existed",
		async () => {
			// The narrator's read: the NPC binding and the unbound row, and
			// neither cast member's private lore.
			expect(await loreFor({ currentCharacterId: null })).toEqual([
				"An orphan note",
				"The Ashguard's orders"
			])
			expect(await loreFor({ currentCharacterId: verity })).toEqual([
				"Verity's secret"
			])
		},
		60_000
	)

	it(
		"an empty or null speaker is unwired, not a speaker named nobody",
		async () => {
			for (const speaker of [null, "", undefined])
				expect(await loreFor({ speaker, currentCharacterId: verity })).toEqual([
					"Verity's secret"
				])
		},
		60_000
	)

	it(
		"a wired speaker wins over the scope's subject",
		async () => {
			expect(
				await loreFor({
					speaker: `character:${brask}`,
					currentCharacterId: verity
				})
			).toEqual(["Brask's secret"])
		},
		60_000
	)
})

describe("a speaker the host cannot resolve to a cast row", () => {
	it(
		"reads NO private lore — never the narrator's omniscience",
		async () => {
			// A free-form side character (the planner named a shopkeeper), an
			// envoy, a role, a bare name, and an id belonging to nobody. Each
			// is somebody who is nobody, and nobody's private knowledge is
			// nobody's — the read must not fall back to `null`.
			for (const speaker of [
				"envoy:narrator",
				"owner",
				"participant",
				"Verity",
				"character:999999",
				"character:0",
				"user:1",
				42
			])
				expect(
					await loreFor({ speaker, currentCharacterId: null })
				).toEqual([])
		},
		60_000
	)
})

describe("an unbound character-lore entry (W3)", () => {
	it(
		"is the narrator's, and no speaker's",
		async () => {
			expect(await loreFor({ currentCharacterId: null })).toContain(
				"An orphan note"
			)
			for (const who of [verity, brask])
				expect(
					await loreFor({ speaker: `character:${who}` })
				).not.toContain("An orphan note")
		},
		60_000
	)
})
