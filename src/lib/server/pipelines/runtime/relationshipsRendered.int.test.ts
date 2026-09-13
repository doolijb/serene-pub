/**
 * What the prompt actually SAYS about the graph, once the band is switched on.
 *
 * ⚠ **The gap this closes is between two things that both already worked.**
 * `core:query/relationship-search@1` ranked the graph, `select` budgeted it and
 * the receipt reported it — and `prompt/assemble.ts` laid out world lore,
 * character lore, history and the date, so the band it had just allocated
 * reached the model nowhere. Every assertion here is about the rendered prompt
 * rather than about a decision, because a decision was never the part that was
 * missing.
 *
 * ## The fixture is the same crossing `relationshipSearch.int.test.ts` uses
 *
 * Two ties, both the speaker's own; the one to the character who is **not** in
 * the chat is the newer. Presence has to win, or the ruling's ordering does not
 * hold. What is added here is the insertion ORDER: the absent one is written
 * first, so the graph dump — which is keyed in whatever order the rows came
 * back — leads with the character ranking puts second. The two paths therefore
 * produce different prompts, which is the only way an assertion can say which
 * one rendered.
 */

import { describe, it, expect, beforeAll, vi } from "vitest"
import fs from "fs/promises"
import os from "os"
import path from "path"
import { and, eq } from "drizzle-orm"
import type { TestDb } from "$lib/server/utils/testDb"
import * as schema from "$lib/server/db/schema"
import { run } from "@serene-pub/sdk"
import { coreBindings } from "$lib/server/pipelines/runtime/bindings"
import { createHost } from "$lib/server/pipelines/runtime/host"
import { buildWorld } from "$lib/server/pipelines/config/world"
import { bootstrapPipelines } from "$lib/server/pipelines/boot/bootstrap"
import { respondSpec, RESPOND_SPEC_ID } from "$lib/server/pipelines/specs"

// No embedding model: the other retrieval mechanisms stay on the keyword path,
// which needs no network. Nothing here asserts on them.
vi.mock("$lib/server/embedding", () => ({
	isModelReady: () => false,
	getLoadedModelId: () => null
}))

vi.mock("$lib/server/db", async () => {
	const { createTestDb } = await import("$lib/server/utils/testDb")
	const db = await createTestDb()
	return { db, getCryptoSecretKey: () => "relationships-rendered-secret" }
})

let db: TestDb
let sessionId: number
let userId: number
let speakerCharacterId: number
let specRow: { id: number }

/** Who is in the chat, and who is only in the lorebook. */
const PRESENT = "Kiran"
const ABSENT = "Wraith"

/** The ranker's node in the shipped reply document. */
const RANK = "rank"

const HOUR = 3_600_000
const NOW = Date.now()

beforeAll(async () => {
	process.env.SERENE_PUB_DATA_DIR = await fs.mkdtemp(
		path.join(os.tmpdir(), "serene-pub-relationships-rendered-")
	)
	db = (await import("$lib/server/db")).db as unknown as TestDb
	await (await import("$lib/server/db/defaults")).sync()
	await bootstrapPipelines(db)

	const [user] = await db
		.insert(schema.users)
		.values({ username: "rendered", isAdmin: false })
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

	// Bound into the lorebook and deliberately NOT in the session: the
	// traversal reaches them, and ranking has to put them second for it.
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

	// ⚠ The absent one FIRST, and it is also the newer. The dump keys sections
	// in row order, so it leads there; ranking puts it last. One fixture, two
	// distinguishable prompts.
	await tie(absentNode.id, "fears", new Date(NOW))
	await tie(presentNode.id, "trusts", new Date(NOW - 48 * HOUR))

	await db.insert(schema.sessionMessages).values({
		sessionId,
		role: "user",
		content: "who is with us?"
	} as any)

	specRow = (
		await db
			.select({ id: schema.pipelineSpecs.id })
			.from(schema.pipelineSpecs)
			.where(eq(schema.pipelineSpecs.slug, RESPOND_SPEC_ID))
			.limit(1)
	)[0]
}, 120_000)

/**
 * The config a run on this session actually resolves to.
 *
 * Not the `pipeline-default:` row — `migrateContextTemplates` duplicates the
 * shipped config into a mutable copy and selects that, so a fixture writing to
 * the immutable original would change nothing and prove nothing.
 */
const selectedConfigId = async () => {
	const { resolveSelectedConfig } = await import(
		"$lib/server/pipelines/config/named"
	)
	const selected = await resolveSelectedConfig(
		db,
		specRow.id,
		RESPOND_SPEC_ID,
		{ sessionId }
	)
	expect(
		selected,
		`${RESPOND_SPEC_ID} resolves to no configuration`
	).toBeTruthy()
	return selected!.configId
}

/**
 * Write one of the ranker's per-band maps, or clear it back to the shipped
 * default.
 *
 * Whole maps rather than one member: `rankingParamsFrom` passes the stored
 * object through and `withDefaults` merges it one level deep, so a partial
 * `share` would silently replace the other four bands with nothing.
 */
const setBandParam = async (
	path: "share" | "maxEntries",
	value: Record<string, number> | null
) => {
	const configId = await selectedConfigId()
	const where = and(
		eq(schema.pipelineConfigValues.configId, configId),
		eq(schema.pipelineConfigValues.nodeKey, RANK),
		eq(schema.pipelineConfigValues.slot, "params"),
		eq(schema.pipelineConfigValues.path, path)
	)
	await db.delete(schema.pipelineConfigValues).where(where)
	if (value === null) return
	await db.insert(schema.pipelineConfigValues).values({
		configId,
		nodeKey: RANK,
		slot: "params",
		path,
		value: value as any
	})
}

/** The band, on, with room for both ties. */
const SHARE_ON = {
	messages: 0.4,
	worldLore: 0.1,
	characterLore: 0.1,
	history: 0.1,
	relationships: 0.3
}
const CAPS = {
	messages: 50,
	worldLore: 20,
	characterLore: 15,
	history: 10,
	relationships: 10
}

/** One turn of the shipped reply spec, stopped before the model. */
const turn = async () =>
	await run(respondSpec(), {
		input: {
			text: "who is with us?",
			sessionId,
			characterId: speakerCharacterId,
			sessionScope: { sessionId, currentCharacterId: speakerCharacterId }
		},
		seed: "seed:relationships-rendered",
		bindings: coreBindings(),
		world: await buildWorld(db, { sessionId, specId: RESPOND_SPEC_ID }),
		host: createHost(db, { sessionId, userId }),
		preview: true
	} as any)

const nodeOut = (receipt: any, key: string) => {
	const node = (receipt.nodes as any[]).find((n) => n.nodeKey === key)
	expect(node, `${key} is not in the receipt`).toBeTruthy()
	return node.output
}

/**
 * The prompt as it would go out.
 *
 * Off `main`, where the allocation and the render are spread together — the
 * node publishes no bare `rendered` of its own.
 */
const promptOf = (receipt: any): string => {
	const rendered = nodeOut(receipt, "prompt")?.main?.rendered
	expect(
		typeof rendered,
		"the assemble node produced no rendered prompt"
	).toBe("string")
	return rendered as string
}

/**
 * Just the relationships section, so an ordering assertion is about the graph
 * and not about where a cast member's name happens to appear.
 *
 * The heading is the shipped `relationshipsPerspectives` wrapper's, and the
 * block ends at the fence that closes it.
 */
const relationshipsBlock = (prompt: string): string => {
	const at = prompt.indexOf("Your relationships:")
	expect(at, "the prompt has no relationships section").toBeGreaterThan(-1)
	const opened = prompt.indexOf("```", at)
	const closed = prompt.indexOf("```", opened + 3)
	return prompt.slice(at, closed === -1 ? undefined : closed)
}

describe("the allocated relationships band is what the prompt renders", () => {
	it("renders the graph dump while the band has no share", async () => {
		// The shipped state, and the parity claim: nothing is allocated, so the
		// two graph reads are still what the template sees — both ties, exactly
		// as before the mechanism existed.
		const prompt = promptOf(await turn())
		expect(prompt).toContain(PRESENT)
		expect(prompt).toContain(ABSENT)
	}, 60_000)

	it("renders the band in rank order once the share is raised", async () => {
		await setBandParam("share", SHARE_ON)
		await setBandParam("maxEntries", CAPS)
		try {
			const block = relationshipsBlock(promptOf(await turn()))
			// Presence first. The dump leads with the absent one — it is the
			// row that was written first — so this ordering can only come from
			// the ranker.
			expect(block.indexOf(PRESENT)).toBeLessThan(block.indexOf(ABSENT))
			expect(block).toContain(ABSENT)
		} finally {
			await setBandParam("share", null)
			await setBandParam("maxEntries", null)
		}
	}, 60_000)

	it("leaves out the tie the band's ceiling excluded", async () => {
		await setBandParam("share", SHARE_ON)
		await setBandParam("maxEntries", { ...CAPS, relationships: 1 })
		try {
			const receipt = await turn()
			const prompt = promptOf(receipt)
			// One entry fits, and it is the present one. The dump would render
			// both whatever the ceiling said, which is the whole difference
			// between a source that competes for the window and one that does
			// not.
			expect(prompt).toContain(PRESENT)
			expect(prompt).not.toContain(ABSENT)
		} finally {
			await setBandParam("share", null)
			await setBandParam("maxEntries", null)
		}
	}, 60_000)

	it("shows both ties on the retrieval explanation as selected", async () => {
		await setBandParam("share", SHARE_ON)
		await setBandParam("maxEntries", CAPS)
		try {
			const receipt = await turn()
			const { explainRetrieval } = await import(
				"$lib/server/sockets/pipelines"
			)
			const explanation = explainRetrieval(receipt, new Map() as any)
			const ties = explanation.rows.filter(
				(r: any) => r.source === "relationships"
			)
			expect(
				ties.length,
				"no relationship reached the retrieval explanation"
			).toBe(2)
			expect(ties.map((r: any) => r.title)).toEqual([PRESENT, ABSENT])
			for (const row of ties) expect(row.outcome).toBe("included")
		} finally {
			await setBandParam("share", null)
			await setBandParam("maxEntries", null)
		}
	}, 60_000)
})
