/**
 * Retrieval recognises the whole lorebook's cast, not only the seated part —
 * from the stored binding row to what the scan came back with.
 *
 * ## The defect
 *
 * `annotations/loadVocabulary` builds a lorebook's recognition vocabulary from
 * **every** `lorebook_bindings` row, unioning `name`, `aliases` and
 * `absorbedAliases`. `runtime/bindings.ts` built retrieval's from
 * `session_cast`. Two subsystems, one book, two alphabets: a character the book
 * binds but this scene never seated was a name annotations resolved and
 * retrieval could not, and an identity a graph merge had absorbed reached
 * annotations while retrieval saw only whatever the sync helpers had last
 * written into `aliases`.
 *
 * It was invisible from every receipt, because the `gazetteer_hash` annotations
 * are filed under is computed from the annotation vocabulary. Nothing recorded
 * the *other* one at all.
 *
 * ## Why an integration test and not a unit one
 *
 * `castEntityRefs.test.ts` covers the vocabulary's membership and its
 * precedence directly, which is the half a unit test can see. It cannot see the
 * seam that actually broke: the names have to survive a host read, and the host
 * only selected `characterId`, `personaId` and `absorbedAliases` off the binding
 * table — the roster's `name` and `aliases` were never fetched at all. A test
 * that handed `castEntityRefs` a well-formed roster would pass against a host
 * that returns none. This starts at the row.
 *
 * ## What the fixture is built to isolate
 *
 * The gazetteer that `keywordQuery` compiles is `entityRefs` **plus every entry
 * title**, so a bound character who also has an entry named after her is
 * already in the vocabulary by the second route and this change would be
 * unobservable on her. The entries below are therefore titled after *places*,
 * and the only path from the conversation to `character:Ceyla` is the binding.
 *
 * The conversation names her by an **absorbed** alias, in lower case. Both
 * halves matter: absorbed, because that is the column the sync helpers never
 * touch and the one the schema note is about; lower case, because tier two only
 * ever sees capitalised runs, so *"the sluicekeeper"* is invisible to open
 * extraction and tier one is the only thing that can reach it.
 *
 * ⚠ The entries are **keyless**, so the keyword scan cannot admit them and the
 * gate has to. `admitThreshold` ships at 0 — the shipped default really does
 * make this change inert, which is a property worth having rather than a
 * limitation to work around — so the fixture turns it on and puts it back.
 */

import { describe, it, expect, beforeAll, vi } from "vitest"
import fs from "fs/promises"
import os from "os"
import path from "path"
import { and, eq } from "drizzle-orm"
import {
	setConfigValue,
	type TestDb
} from "$lib/server/utils/testDb"
import * as schema from "$lib/server/db/schema"
import { worldLoreValues } from "$lib/server/pipelines/testing/fixtures"
import { run, splitCandidates } from "@serene-pub/sdk"
import { coreBindings } from "$lib/server/pipelines/runtime/bindings"
import { createHost } from "$lib/server/pipelines/runtime/host"
import { buildWorld } from "$lib/server/pipelines/config/world"
import { bootstrapPipelines } from "$lib/server/pipelines/boot/bootstrap"
import { respondSpec, CHAT_RESPOND_SPEC_ID } from "$lib/server/pipelines/specs"

// No embedding model. The gazetteer is the half that carries name resolution
// and needs none (design §11) — that is the whole claim under test.
vi.mock("$lib/server/embedding", () => ({
	isModelReady: () => false,
	getLoadedModelId: () => null
}))

vi.mock("$lib/server/db", async () => {
	const { createTestDb } = await import("$lib/server/utils/testDb")
	const db = await createTestDb()
	return { db, getCryptoSecretKey: () => "lore-binding-vocabulary-secret" }
})

const WORLD_LORE_LANE = "gather.worldLore.read"

let db: TestDb
let sessionId: number
let userId: number
let lorebookId: number
let unseatedId: number
let respondSpecRow: { id: number }

beforeAll(async () => {
	process.env.SERENE_PUB_DATA_DIR = await fs.mkdtemp(
		path.join(os.tmpdir(), "serene-pub-lore-binding-vocab-")
	)
	db = (await import("$lib/server/db")).db as unknown as TestDb
	await (await import("$lib/server/db/defaults")).sync()
	await bootstrapPipelines(db)

	const [user] = await db
		.insert(schema.users)
		.values({ username: "vocab", isAdmin: false })
		.returning()
	userId = user.id

	const [lorebook] = await db
		.insert(schema.lorebooks)
		.values({ name: "Vocabulary", userId })
		.returning()
	lorebookId = lorebook.id

	const [session] = await db
		.insert(schema.sessions)
		.values({ userId, isGroup: false, lorebookId })
		.returning()
	sessionId = session.id

	// Two characters the book knows. Only the first is in the room, which is
	// what makes "absent from the session" a real condition rather than an
	// empty cast.
	const [seated] = await db
		.insert(schema.characters)
		.values({
			userId,
			name: "Vell",
			description: "Waiting on the bank."
		} as any)
		.returning()
	const [unseated] = await db
		.insert(schema.characters)
		.values({
			userId,
			name: "Ceyla",
			description: "Keeps the sluice."
		} as any)
		.returning()
	unseatedId = unseated.id

	await db.insert(schema.sessionCharacters).values({
		sessionId,
		characterId: seated.id,
		isActive: true,
		position: 0
	} as any)

	await db.insert(schema.lorebookBindings).values([
		{
			lorebookId,
			characterId: seated.id,
			binding: `{{char:${seated.id}}}`,
			name: "Vell",
			aliases: [],
			absorbedAliases: []
		},
		{
			lorebookId,
			characterId: unseated.id,
			binding: `{{char:${unseated.id}}}`,
			name: "Ceyla",
			// The one-directional sync target. Empty on purpose: if the union
			// were read from this column alone the absorbed name below would be
			// missing, which is the exact failure the schema note describes.
			aliases: [],
			// What `narrativeGraph:mergeNode` writes when a merge absorbs an
			// identity. Lower case, because that is how the town refers to her.
			absorbedAliases: ["the sluicekeeper"]
		} as any
	])

	/**
	 * Two keyless entries titled after places, so no entry title can put
	 * "Ceyla" or "the sluicekeeper" into the gazetteer by the back door.
	 *
	 * The first names her in its body and is the one a scene about her should
	 * bring in. The second is the control: also keyless, also nameless in the
	 * conversation, and about nobody.
	 */
	await db.insert(schema.lorebookEntries).values(
		worldLoreValues([
			{
				lorebookId,
				name: "The Sluice Gate",
				keys: "",
				content:
					"Iron doors under the wall that let the tide in and out. Ceyla holds the only keys and the winch wants two hands on it."
			},
			{
				lorebookId,
				name: "Feast of Lanterns",
				keys: "",
				content:
					"A midwinter festival. Households hang paper lanterns and the watch looks the other way for one night."
			}
		])
	)

	// ⚠ Neither "Ceyla" nor "sluice" is said. The only route from this
	// conversation to that entry is the absorbed alias resolving to the
	// character whose name the entry's body carries.
	for (const content of [
		"We waited on the bank most of the afternoon.",
		"Nobody would say when the doors were coming up.",
		"The sluicekeeper had the only set and would not be hurried.",
		"So we sat and watched the water come up over the stones.",
		"It was dark before anything moved at all."
	])
		await db.insert(schema.sessionMessages).values({
			sessionId,
			role: "user",
			content
		} as any)

	respondSpecRow = (
		await db
			.select({ id: schema.pipelineSpecs.id })
			.from(schema.pipelineSpecs)
			.where(eq(schema.pipelineSpecs.slug, CHAT_RESPOND_SPEC_ID))
			.limit(1)
	)[0]
}, 120_000)

/** Run the shipped reply spec the way a turn does, and report the lore lane. */
const worldLoreLane = async () => {
	const receipt = await run(respondSpec(), {
		input: {
			text: "It was dark before anything moved at all.",
			sessionId,
			characterId: null,
			sessionScope: { sessionId, currentCharacterId: null }
		},
		seed: "seed:vocab",
		bindings: coreBindings(),
		world: await buildWorld(db, {
			sessionId,
			specId: CHAT_RESPOND_SPEC_ID
		}),
		host: createHost(db, { sessionId, userId }),
		preview: true
	} as any)
	const node = (receipt.nodes as any[]).find(
		(n) => n.nodeKey === WORLD_LORE_LANE
	)
	return {
		// The items, past the lane's band intent at the head (R-7 P5).
		names: splitCandidates<any>(node?.output?.hits ?? []).items.map(
			(c) => c.payload?.name as string
		),
		diagnostics: (node?.output?.diagnostics ?? {}) as Record<string, any>
	}
}

/** See `loreAdmitThreshold.int.test.ts`: the *selected* config, not the shipped row. */
const setThreshold = async (value: number) => {
	const { resolveSelectedConfig } = await import(
		"$lib/server/pipelines/config/named"
	)
	const selected = await resolveSelectedConfig(
		db,
		respondSpecRow.id,
		CHAT_RESPOND_SPEC_ID,
		{ sessionId }
	)
	expect(selected, "the reply spec resolves to no configuration").toBeTruthy()
	// ⚠ An upsert, not the `UPDATE` this was. A config stores **deviations**
	// (ruled 2026-09-10), so at an untouched address there is no row to update
	// — the old form matched nothing and every case ran at the declared
	// threshold.
	await setConfigValue(
		db,
		selected!.configId,
		{ nodeKey: WORLD_LORE_LANE, slot: "params", path: "admitThreshold" },
		value
	)
}

describe("the host hands retrieval the book's roster, not just the room", () => {
	it("returns every binding's names, including the unseated one's", async () => {
		const cast = (await createHost(db, { sessionId, userId }).read!(
			"session_cast",
			{ sessionId },
			{ nodeKey: "test" } as any
		)) as any
		expect(
			cast.sessionCharacters.map((c: any) => c.character.name),
			"the seated cast is not what it was"
		).toEqual(["Vell"])
		expect(
			cast.lorebookBindings,
			"the host returned no roster, so retrieval has nothing to widen to"
		).toBeTruthy()
		// `name` and `aliases` are the columns the read did not select before,
		// and a roster of ids alone resolves nothing.
		expect(
			cast.lorebookBindings.find((b: any) => b.characterId === unseatedId)
		).toMatchObject({
			name: "Ceyla",
			aliases: [],
			absorbedAliases: ["the sluicekeeper"]
		})
	}, 60_000)

	it("keeps the roster off the prompt's cast", async () => {
		// The whole book's dramatis personae must not ride into the context
		// window on a node whose job is who is in the scene.
		const out = await coreBindings()["core:query/session-cast@1"]!(
			{ scope: { sessionId } } as any,
			{
				read: (t: string, q: unknown) =>
					createHost(db, { sessionId, userId }).read!(t, q, {
						nodeKey: "test"
					} as any)
			} as any
		)
		expect((out as any).value.main).not.toHaveProperty("lorebookBindings")
		expect((out as any).value.main.sessionCharacters).toHaveLength(1)
	}, 60_000)
})

describe("a bound character absent from the session reaches the scan", () => {
	it("resolves her absorbed alias and brings in the entry that names her", async () => {
		const off = await worldLoreLane()
		expect(
			off.names,
			"a keyless entry arrived with the gate off, so this fixture " +
				"cannot tell the vocabulary from the default"
		).toEqual([])

		await setThreshold(0.3)
		try {
			const on = await worldLoreLane()
			// ⚠ The assertion that fails without the widening. "the
			// sluicekeeper" is lower case, so open extraction cannot see it,
			// and it lives on `absorbedAliases` of a character who is not in
			// the room — every one of those three facts had to be handled.
			expect(
				on.diagnostics.entities,
				"the conversation named a bound character and the scan did not " +
					"recognise her"
			).toContain("The sluicekeeper")
			expect(on.names).toEqual(["The Sluice Gate"])
			expect(on.diagnostics.admittedByEvidence).toBe(1)
		} finally {
			await setThreshold(0)
		}
	}, 60_000)
})
