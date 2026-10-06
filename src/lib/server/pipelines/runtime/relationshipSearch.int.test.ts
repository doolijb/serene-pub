/**
 * The narrative graph as ranked candidates, from the rows to the decisions.
 *
 * ⚠ **The ordering is the claim, and only a real turn can make it.** Presence,
 * speaker and recency are three facts assembled from three different places —
 * the session's cast, the speaker's own node, and a column on the relationship
 * row — and the unit test for `rankRelationships` is handed all three already
 * decided. What it cannot see is the half in between: whether the traversal
 * actually reports a character who is *not* in the chat as absent, whether the
 * order survives `concat-candidates` and reaches `select` as a score, and
 * whether the `relationships` band exists at the ranker at all. Each of those
 * has been a silent nothing in this subsystem before.
 *
 * So this starts at rows in a database and ends at `rank`'s decisions, with the
 * shipped reply spec, the real executor and the real host in between — the same
 * shape as `relationshipsCap.int.test.ts` next door, which is what proved the
 * ceiling reaches the graph read.
 *
 * ## The fixture is a crossing, not a happy path
 *
 * Two ties, both the speaker's own, and the one to the character who is **not**
 * in the chat is the one changed most recently. Under any scoring where recency
 * can outvote presence, that one wins — which is the failure the ruling's word
 * "first" exists to forbid, and the only fixture that can tell the two apart.
 */

import { describe, it, expect, beforeAll, vi } from "vitest"
import fs from "fs/promises"
import os from "os"
import path from "path"
import { eq } from "drizzle-orm"
import type { TestDb } from "$lib/server/utils/testDb"
import * as schema from "$lib/server/db/schema"
import { run, splitCandidates } from "@serene-pub/sdk"
import { coreBindings } from "$lib/server/pipelines/runtime/bindings"
import { createHost } from "$lib/server/pipelines/runtime/host"
import { buildWorld } from "$lib/server/pipelines/config/world"
import { bootstrapPipelines } from "$lib/server/pipelines/boot/bootstrap"
import { respondSpec, CHAT_RESPOND_SPEC_ID } from "$lib/server/pipelines/specs"

// No embedding model: the other retrieval mechanisms stay on the keyword path,
// which needs no network. Nothing here asserts on them.
vi.mock("$lib/server/embedding", () => ({
	isModelReady: () => false,
	getLoadedModelId: () => null
}))

vi.mock("$lib/server/db", async () => {
	const { createTestDb } = await import("$lib/server/utils/testDb")
	const db = await createTestDb()
	return { db, getCryptoSecretKey: () => "relationship-search-secret" }
})

let db: TestDb
let sessionId: number
let userId: number
let speakerCharacterId: number

/** Who is in the chat, and who is only in the lorebook. */
const PRESENT = "Kiran"
const ABSENT = "Wraith"

/** Its node in the shipped reply document. */
const GRAPH = "gather.relationships.read"
const PERSPECTIVES = "gather.relationshipsPerspectives.read"

const HOUR = 3_600_000
const NOW = Date.now()

beforeAll(async () => {
	process.env.SERENE_PUB_DATA_DIR = await fs.mkdtemp(
		path.join(os.tmpdir(), "serene-pub-relationship-search-")
	)
	db = (await import("$lib/server/db")).db as unknown as TestDb
	await (await import("$lib/server/db/defaults")).sync()
	await bootstrapPipelines(db)

	const [user] = await db
		.insert(schema.users)
		.values({ username: "arm", isAdmin: false })
		.returning()
	userId = user.id

	const [lorebook] = await db
		.insert(schema.lorebooks)
		.values({ userId, name: "Ties" })
		.returning()

	const [session] = await db
		.insert(schema.sessions)
		.values({ userId, isGroup: true, lorebookId: lorebook.id })
		.returning()
	sessionId = session.id

	const character = async (name: string) =>
		(
			await db
				.insert(schema.characters)
				.values({ userId, name, description: "" })
				.returning()
		)[0]
	const binding = async (name: string, characterId: number) =>
		(
			await db
				.insert(schema.lorebookBindings)
				.values({
					lorebookId: lorebook.id,
					name,
					binding: `{{char:${characterId}}}`,
					characterId
				})
				.returning()
		)[0]

	const speaker = await character("Amara")
	speakerCharacterId = speaker.id
	const speakerNode = await binding("Amara", speaker.id)
	await db
		.insert(schema.sessionCharacters)
		.values({ sessionId, characterId: speaker.id } as any)

	const present = await character(PRESENT)
	const presentNode = await binding(PRESENT, present.id)
	await db
		.insert(schema.sessionCharacters)
		.values({ sessionId, characterId: present.id } as any)

	// ⚠ Bound into the lorebook and deliberately NOT in the session. This is
	// the whole fixture: the traversal reaches them (layer 1 walks every
	// outbound edge from the speaker, whoever it points at), and the read has to
	// report them as absent rather than as unreachable.
	const absent = await character(ABSENT)
	const absentNode = await binding(ABSENT, absent.id)

	const tie = async (toNodeId: number, type: string, updatedAt: Date) =>
		await db.insert(schema.narrativeRelationships).values({
			lorebookId: lorebook.id,
			fromNodeId: speakerNode.id,
			toNodeId,
			relationshipType: type,
			visibility: "acknowledged" as any,
			status: "active",
			description: "",
			updatedAt
		} as any)

	// The crossing: the absent one is the newer of the two.
	await tie(presentNode.id, "trusts", new Date(NOW - 48 * HOUR))
	await tie(absentNode.id, "fears", new Date(NOW))

	await db.insert(schema.sessionMessages).values({
		sessionId,
		role: "user",
		content: "who is with us?"
	} as any)
}, 120_000)

/** One turn of the shipped reply spec, stopped before the model. */
const turn = async () =>
	await run(respondSpec(), {
		input: {
			text: "who is with us?",
			sessionId,
			characterId: speakerCharacterId,
			sessionScope: { sessionId, currentCharacterId: speakerCharacterId }
		},
		seed: "seed:relationship-search",
		bindings: coreBindings(),
		world: await buildWorld(db, { sessionId, specId: CHAT_RESPOND_SPEC_ID }),
		host: createHost(db, { sessionId, userId }),
		preview: true
	} as any)

let receipt: any
beforeAll(async () => {
	receipt = await turn()
}, 120_000)

const nodeOut = (key: string) => {
	const node = (receipt.nodes as any[]).find((n) => n.nodeKey === key)
	expect(node, `${key} is not in the receipt`).toBeTruthy()
	return node.output
}

/** Its candidates, in the order it published them — past the band intent it leads with (R-7 P5). */
const ranked = (): any[] => splitCandidates<any>(nodeOut(GRAPH)?.main ?? []).items

const nameOf = (c: any) => c?.payload?.name

describe("the graph reaches the ranker as ranked candidates", () => {
	it("publishes one candidate per tie, in the relationships band", () => {
		const candidates = ranked()
		expect(candidates.length).toBe(2)
		for (const c of candidates) {
			expect(c.source).toBe("relationships")
			expect(c.payload.foundBy).toBe("relationships")
			expect(typeof c.tokens).toBe("number")
		}
	}, 60_000)

	it("puts the tie the scene is present for first, though it is the older one", () => {
		// ⚠ The claim. Both ties are the speaker's own; the absent one is 48
		// hours newer. Presence decides, or the ruling's ordering does not hold.
		expect(ranked().map(nameOf)).toEqual([PRESENT, ABSENT])
	}, 60_000)

	it("says why, per tie, rather than only how much", () => {
		const [first, second] = ranked()
		expect(first.payload.rank).toMatchObject({
			present: true,
			touchesSpeaker: true,
			of: 2
		})
		expect(second.payload.rank).toMatchObject({
			present: false,
			touchesSpeaker: true,
			of: 2
		})
		// The absent tie is the more recent of the two, and the receipt says so
		// even though it lost — which is what makes the ordering readable
		// rather than merely asserted.
		expect(second.payload.rank.recencyRank).toBe(1)
		expect(first.payload.rank.recencyRank).toBe(2)
	}, 60_000)

	it("scores the present tie above the absent one at the ranker", () => {
		const decisions: any[] = nodeOut("rank")?.decisions ?? []
		const ties = decisions.filter(
			(d) => d?.candidate?.source === "relationships"
		)
		expect(
			ties.length,
			"no relationship reached the ranker — the graph read is not wired into it"
		).toBe(2)
		const scoreOf = (name: string) =>
			ties.find((d) => nameOf(d.candidate) === name)?.score
		expect(scoreOf(PRESENT)).toBeGreaterThan(scoreOf(ABSENT)!)
	}, 60_000)

	/**
	 * The shipped default, stated: `share.relationships` is 0, so the band is
	 * off and every tie is excluded with the reason that names the control.
	 * This is what makes it behaviour-preserving on an upgrade — and the
	 * assertion that would fail the day somebody changed that default without
	 * meaning to.
	 */
	it("spends nothing until somebody gives the band a share", () => {
		const decisions: any[] = nodeOut("rank")?.decisions ?? []
		const ties = decisions.filter(
			(d) => d?.candidate?.source === "relationships"
		)
		expect(ties.map((d) => d.included)).toEqual([false, false])
		for (const d of ties) expect(d.reason).toBe("excluded_group_disabled")
	}, 60_000)

	/**
	 * It is additive. The two nodes that hand the graph to the template are
	 * untouched, and a run that gained a third read must still render the same
	 * sections it always did.
	 */
	it("leaves the dump path exactly where it was", () => {
		const section = nodeOut(PERSPECTIVES)?.relationshipsPerspectives
		expect(Object.keys(section ?? {}).sort()).toEqual(
			[PRESENT, ABSENT].sort()
		)
	}, 60_000)
})
