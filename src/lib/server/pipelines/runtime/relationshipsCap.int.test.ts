/**
 * "Most relationships", from the stored row to the graph read — through the
 * executor.
 *
 * ⚠ This exists because nothing could see the defect it covers. `maxEntries` is
 * a declared parameter of `core:query/relationships-perspectives@1` and
 * `core:query/relationships-known@1`: the panel rendered it, validated it, saved
 * it, and `reconcileConfigs` back-filled the declared `12` into
 * `pipeline_config_values` on every install. It reached nothing — no shipped
 * spec named the `params` slot on either node, and `resolveInput` resolves only
 * the slots a node's config already names, so `bindings.ts` called
 * `capRelationships(section, undefined)` on every turn and that function reads
 * `undefined` as *no ceiling* and returns the section whole.
 *
 * A test that starts at the binding's arguments cannot cover this: it would have
 * to fake the very thing that was missing. So this starts where a person's edit
 * starts — a row in the database — and ends at how many relationships the query
 * actually returned. The executor is in the middle on purpose.
 *
 * Same lesson, same shape as `sessionHistoryLimit.int.test.ts`, which was
 * written for this defect's twin on the history node one migration earlier.
 *
 * ## Both lanes, separately
 *
 * `relationshipsPerspectives` (what the speaker thinks of everyone) and
 * `relationshipsKnown` (what everyone thinks of the speaker) are two nodes with
 * two rows and one shared implementation. They are asserted independently
 * because a fix applied to one document and not the other is exactly what this
 * subsystem has shipped three times before — and because each one's ceiling must
 * NOT reach the other, which is the failure wearing the opposite sign.
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
import { respondSpec, CHAT_RESPOND_SPEC_ID } from "$lib/server/pipelines/specs"

// No embedding model: the retrieval mechanisms beside the graph stay on the
// keyword path, which needs no network. Nothing here asserts on them — this is
// only so the run reaches the end of the gather block.
vi.mock("$lib/server/embedding", () => ({
	isModelReady: () => false,
	getLoadedModelId: () => null
}))

// The db module is mocked so `defaults.sync()` and `bootstrapPipelines` run
// against the test database, in the order `db/index.ts` guarantees at boot.
vi.mock("$lib/server/db", async () => {
	const { createTestDb } = await import("$lib/server/utils/testDb")
	const db = await createTestDb()
	return { db, getCryptoSecretKey: () => "relationships-cap-secret" }
})

let db: TestDb
let sessionId: number
let userId: number
let speakerCharacterId: number
let specRow: { id: number }

/**
 * Four others, one relationship each way apiece.
 *
 * Four rather than two so a narrowed ceiling is distinguishable from an off
 * switch and from an off-by-one: 4 back is "the control did nothing", 2 back is
 * "it was read", 0 back would be `capRelationships`'s zero branch, and anything
 * else is a third bug. `capRelationships` counts RELATIONSHIPS rather than
 * names, so one relationship per other character makes the two counts the same
 * number and keeps the assertion about the ceiling instead of about grouping.
 */
const OTHERS = ["Kiran", "Vell", "Sable", "Idris"] as const
const NARROWED = 2

/** Where each lane's control lives in the shipped reply document. */
const PERSPECTIVES = "gather.relationshipsPerspectives.read"
const KNOWN = "gather.relationshipsKnown.read"

beforeAll(async () => {
	process.env.SERENE_PUB_DATA_DIR = await fs.mkdtemp(
		path.join(os.tmpdir(), "serene-pub-relationships-cap-")
	)
	db = (await import("$lib/server/db")).db as unknown as TestDb
	await (await import("$lib/server/db/defaults")).sync()
	await bootstrapPipelines(db)

	const [user] = await db
		.insert(schema.users)
		.values({ username: "ceiling", isAdmin: false })
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

	for (const name of OTHERS) {
		const other = await character(name)
		const otherNode = await binding(name, other.id)
		// Layer 2 is scoped to session PARTICIPANTS, so the inverse direction
		// only exists for characters actually in the session.
		await db
			.insert(schema.sessionCharacters)
			.values({ sessionId, characterId: other.id } as any)

		// The speaker's own view of them — layer 1, any visibility.
		await db.insert(schema.narrativeRelationships).values({
			lorebookId: lorebook.id,
			fromNodeId: speakerNode.id,
			toNodeId: otherNode.id,
			relationshipType: "admires",
			visibility: "secret" as any,
			status: "active",
			description: ""
		})
		// Their view of the speaker — layer 2, which reads only the two
		// visibilities that are not private to the holder.
		await db.insert(schema.narrativeRelationships).values({
			lorebookId: lorebook.id,
			fromNodeId: otherNode.id,
			toNodeId: speakerNode.id,
			relationshipType: "distrusts",
			visibility: "public" as any,
			status: "active",
			description: ""
		})
	}

	await db.insert(schema.sessionMessages).values({
		sessionId,
		role: "user",
		content: "who is with us?"
	} as any)

	specRow = (
		await db
			.select({ id: schema.pipelineSpecs.id })
			.from(schema.pipelineSpecs)
			.where(eq(schema.pipelineSpecs.slug, CHAT_RESPOND_SPEC_ID))
			.limit(1)
	)[0]
}, 120_000)

/**
 * Run the shipped reply spec the way a turn does — real config, real world, real
 * executor — and report how many relationships each lane returned.
 *
 * `preview` stops before the provider, which needs a connection this test has no
 * business supplying; both nodes under test run upstream of it.
 */
const relationshipCounts = async (): Promise<{
	perspectives: number
	known: number
}> => {
	const receipt = await run(respondSpec(), {
		input: {
			text: "who is with us?",
			sessionId,
			characterId: speakerCharacterId,
			sessionScope: { sessionId, currentCharacterId: speakerCharacterId }
		},
		seed: "seed:ceiling",
		bindings: coreBindings(),
		world: await buildWorld(db, { sessionId, specId: CHAT_RESPOND_SPEC_ID }),
		host: createHost(db, { sessionId, userId }),
		preview: true
	} as any)

	const nodeOut = (key: string) => {
		const node = (receipt.nodes as any[]).find((n) => n.nodeKey === key)
		expect(node, `${key} is not in the receipt`).toBeTruthy()
		return node.output
	}

	// Counted in relationships rather than in names, because that is what
	// `capRelationships` counts and what reaches the prompt: one character the
	// speaker has three ties to is three.
	const count = (section: Record<string, unknown[]> | null | undefined) =>
		section
			? Object.values(section).reduce((n, rels) => n + rels.length, 0)
			: 0

	return {
		perspectives: count(nodeOut(PERSPECTIVES)?.relationshipsPerspectives),
		// The known lane wraps its section — `legendaryFigures` rides the same
		// port — so the ceiling applies one level in.
		known: count(nodeOut(KNOWN)?.relationshipsKnown?.howOthersRegardYou)
	}
}

/**
 * The config a run on this session actually resolves to.
 *
 * ⚠ Not the `pipeline-default:` row. A run resolves through the session's
 * selection chain, which may name a mutable configuration rather than the
 * shipped one, so a fixture writing to the immutable original could change
 * nothing and prove nothing.
 */
const selectedConfigId = async () => {
	const { resolveSelectedConfig } = await import(
		"$lib/server/pipelines/config/named"
	)
	const selected = await resolveSelectedConfig(
		db,
		specRow.id,
		CHAT_RESPOND_SPEC_ID,
		{
			sessionId
		}
	)
	expect(
		selected,
		`${CHAT_RESPOND_SPEC_ID} resolves to no configuration`
	).toBeTruthy()
	return selected!.configId
}

/**
 * Write, or clear, one lane's ceiling.
 *
 * ⚠ An INSERT, not an UPDATE — which is the shape of the ruling. The corrected
 * declaration carries no default, so `reconcileConfigs` back-fills no row and
 * there is nothing to update: an untouched install has no value at this address
 * at all, which is what "uncapped" IS.
 */
const setCap = async (nodeKey: string, value: number | null) => {
	const configId = await selectedConfigId()
	const where = and(
		eq(schema.pipelineConfigValues.configId, configId),
		eq(schema.pipelineConfigValues.nodeKey, nodeKey),
		eq(schema.pipelineConfigValues.slot, "params"),
		eq(schema.pipelineConfigValues.path, "maxEntries")
	)
	await db.delete(schema.pipelineConfigValues).where(where)
	if (value === null) return
	await db.insert(schema.pipelineConfigValues).values({
		configId,
		nodeKey,
		slot: "params",
		path: "maxEntries",
		value: value as any
	})
}

describe("the relationship ceiling reaches the graph read", () => {
	// A liveness check, not the wiring guard — say so, because an unwired node
	// returns all four here too. The next test is the one that fails.
	it("returns every relationship when nothing is stored", async () => {
		// ⚠ And this is the D-8 assertion, not only a fixture warm-up: the
		// shipped state stores no ceiling and must remain uncapped, because
		// uncapped is what every run has always been. A declared default of any
		// number would show up here as a smaller count.
		expect(await relationshipCounts()).toEqual({
			perspectives: OTHERS.length,
			known: OTHERS.length
		})
	}, 60_000)

	it("a stored ceiling narrows the speaker's own view, and only it", async () => {
		// The assertion the defect could not fail: the slot carrying the number
		// was never resolved, so this came back as all four whatever was stored.
		await setCap(PERSPECTIVES, NARROWED)
		try {
			expect(await relationshipCounts()).toEqual({
				perspectives: NARROWED,
				// Each lane owns its own row. One node's number reaching the
				// other would be the same defect wearing the opposite sign.
				known: OTHERS.length
			})
		} finally {
			await setCap(PERSPECTIVES, null)
		}
	}, 60_000)

	it("a stored ceiling narrows how others regard them, and only it", async () => {
		await setCap(KNOWN, 1)
		try {
			expect(await relationshipCounts()).toEqual({
				perspectives: OTHERS.length,
				known: 1
			})
		} finally {
			await setCap(KNOWN, null)
		}
	}, 60_000)

	it("zero leaves the section out altogether, which is not the same as uncapped", async () => {
		// The distinction the declaration rests on. `capRelationships` returns
		// `null` for a ceiling of 0 and the whole section for `undefined`, so 0
		// could never have stood in for "no ceiling" — which is why the default
		// was removed rather than raised.
		await setCap(PERSPECTIVES, 0)
		try {
			expect(await relationshipCounts()).toEqual({
				perspectives: 0,
				known: OTHERS.length
			})
		} finally {
			await setCap(PERSPECTIVES, null)
		}
	}, 60_000)
})
