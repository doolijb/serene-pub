/**
 * A Lair turn, run from the document the STORE hands back (lair pass F2 / B2).
 *
 * The Lair is the one core spec with clauses inside clauses: since R8 the
 * lead delver (`…planned.door.play.lead`, a junction inside the `door`
 * junction's `play` branch, inside `pick`, inside `channel`, inside `via`)
 * and the keeper's propose-or-apply (`keep.played.commit`). The store once dropped a nested
 * clause's chain, so the loaded document ran planner → scene → keeper and
 * nothing else — no voice spoke and no change was proposed or applied, with
 * no error anywhere. This runs the loaded document and asserts both happen.
 *
 * The model is stubbed at the binding and answers one document for every
 * step, as `adventure.int.test.ts` does and for the same reason.
 */

import { afterAll, beforeAll, describe, expect, it, vi } from "vitest"
import fs from "fs/promises"
import os from "os"
import path from "path"
import { eq } from "drizzle-orm"
import { ok, run } from "@serene-pub/sdk"
import {
	CORE_SPECS,
	LAIR_GENRE_ID,
	LAIR_RESPOND_SPEC_ID
} from "@serene-pub/core-catalog"
import * as schema from "$lib/server/db/schema"
import { loadDocument, saveDocument } from "$lib/server/pipelines/boot/store"
import { createHost } from "$lib/server/pipelines/runtime/host"
import { coreBindings } from "$lib/server/pipelines/runtime/bindings"
import { stateFor } from "$lib/server/state/resolve"
import { CORE_TEMPLATE_ENGINE } from "$lib/server/pipelines/prompt/renderers"
import { SHIPPED_CONTEXT_TEMPLATE } from "$lib/server/pipelines/entities/contextTemplateDefaults"
import type { TestDb } from "$lib/server/utils/testDb"

let db: TestDb
let dataDir: string

/** `set-state` reaches the database through a dynamic import — see `adventure.int.test.ts`. */
vi.mock("$lib/server/db", async () => {
	const { createTestDb } = await import("$lib/server/utils/testDb")
	const db = await createTestDb()
	return { db }
})

beforeAll(async () => {
	dataDir = await fs.mkdtemp(path.join(os.tmpdir(), "serene-pub-vitest-lair-"))
	process.env.SERENE_PUB_DATA_DIR = dataDir
	const dbModule = await import("$lib/server/db")
	db = dbModule.db as unknown as TestDb
	// The genres, so a session knows its declared channels: the turn posts
	// its beats on the Lair's Sanctum (R8), and a write to an undeclared
	// channel is refused.
	await (await import("$lib/server/db/defaults")).sync()
	const { bootstrapPipelines } = await import("$lib/server/pipelines/boot/bootstrap")
	await bootstrapPipelines(db as any)
}, 180_000)

afterAll(async () => {
	await fs.rm(dataDir, { recursive: true, force: true })
})

/** One answer for every step: the planner's speakers and the keeper's lists. */
const ANSWER = JSON.stringify({
	beats: ["The torch gutters.", "Something scrapes behind the door."],
	speakers: [{ name: "Brannoc", intent: "check the door" }],
	worldHints: {},
	needsLookup: false,
	values: [{ owner: "Brannoc", slot: "hp", value: "8" }],
	inventory: []
})

const stubbed = () => {
	const parsed = JSON.parse(ANSWER) as Record<string, unknown>
	return {
		...coreBindings(),
		"core:oracle/generate-text@1": async () =>
			ok({ main: ANSWER, text: ANSWER, connection: { type: "stub" } }),
		"core:oracle/generate-json@1": async (input: any) => {
			const path =
				typeof input?.params?.path === "string" ? input.params.path : ""
			const items = path
				.split(",")
				.map((p: string) => p.trim())
				.filter(Boolean)
				.flatMap((p: string) => {
					const value = parsed[p]
					return Array.isArray(value) ? value : value == null ? [] : [value]
				})
			return ok({
				main: parsed,
				json: parsed,
				value: items,
				items,
				text: ANSWER,
				connection: { type: "stub" },
				structured: { mode: "schema", capability: "json_schema" }
			})
		}
	}
}

const template = {
	template: { source: SHIPPED_CONTEXT_TEMPLATE, engine: CORE_TEMPLATE_ENGINE }
}
const window = { sampling: { contextTokens: 8192, responseTokens: 512 } }

/** The author preset's values, supplied directly — see `adventure.int.test.ts`. */
const WORLD: any = {
	overrides: [],
	samplingConfigs: [],
	connections: [],
	activeConnection: {},
	authorDefaults: {
		"via.turn.channel.story.pick.planned.planPrompt": { ...template },
		"via.turn.channel.story.pick.planned.door.play.lead.speaks.prompt": { ...template },
		"via.turn.channel.story.pick.planned.door.play.voices.item.prompt": { ...template },
		"keep.played.keeperPrompt": { ...template },
		"via.turn.channel.story.pick.planned.door.play.speaking": { params: { path: "speakers" } },
		"via.turn.channel.story.pick.planned.door.play.beats": { params: { path: "beats" } },
		"keep.played.keeperWrite": { params: { path: "values,inventory" } },
		"keep.played.commit.trusted.apply": { params: { mode: "apply" } },
		"via.turn.channel.story.pick.planned.door.play.lead.speaks.say": { ...window }
	}
}

let n = 0

/** A Lair session: a dungeon, one delver, and a line to answer. */
async function lair(fields: Record<string, unknown>) {
	const suffix = `${++n}`
	const { createTestUser } = await import("$lib/server/utils/testDb")
	const user = await createTestUser(db, `lair-${suffix}`)
	const [brannoc] = await db
		.insert(schema.characters)
		.values({ userId: user.id, name: "Brannoc", description: "A delver." })
		.returning()
	const [lorebook] = await db
		.insert(schema.lorebooks)
		.values({ userId: user.id, name: `The lair ${suffix}` })
		.returning()
	const [session] = await db
		.insert(schema.sessions)
		.values({
			userId: user.id,
			isGroup: true,
			name: `Lair ${suffix}`,
			genreId: LAIR_GENRE_ID,
			lorebookId: lorebook.id,
			genreFields: fields
		})
		.returning()
	await db
		.insert(schema.sessionCharacters)
		.values({ sessionId: session.id, characterId: brannoc.id })
	const [message] = await db
		.insert(schema.sessionMessages)
		.values({ sessionId: session.id, role: "user", content: "Open the door." })
		.returning()
	await db
		.insert(schema.messages)
		.values({ id: message.id, sessionId: session.id, role: "user" })
	return { user, brannoc, session }
}

/** Publish the spec and run the document the store hands back — never the in-code one. */
async function loaded() {
	const entry = CORE_SPECS.find((s) => s.slug === LAIR_RESPOND_SPEC_ID)!
	const saved = await saveDocument(db, entry.build(), { publish: true })
	return loadDocument(db, saved.specVersionId)
}

async function turn(fields: Record<string, unknown>) {
	const w = await lair(fields)
	const receipt = await run(await loaded(), {
		input: {
			text: "Open the door.",
			sessionScope: { sessionId: w.session.id },
			fields
		},
		seed: "seed:lair",
		triggerSource: "event",
		compactHaltReceipts: false,
		world: WORLD,
		bindings: stubbed(),
		host: createHost(db, { sessionId: w.session.id, userId: w.user.id })
	})
	expect(
		`${receipt.outcome} ${receipt.haltReason ?? ""} ${(receipt as any).haltNodeKey ?? ""}`.trim()
	).toBe("ok")
	return { w, receipt }
}

const ran = (receipt: any, key: string) =>
	receipt.nodes.filter((node: any) => node.nodeKey === key)

describe("a Lair turn loaded from the store", () => {
	it("a turn voices the delver the planner named (the lead, R8), and the keeper's changes are proposed", async () => {
		const { w, receipt } = await turn({ trustNarrator: false })

		expect(ran(receipt, "via.turn.channel.story.pick.planned.door.play.lead.speaks.say")).toHaveLength(1)

		const proposed = ran(receipt, "keep.played.commit.reviewed.propose")
		expect(proposed).toHaveLength(1)
		expect((proposed[0]!.output as any).proposed.length).toBeGreaterThan(0)
		const proposals = await db
			.select()
			.from(schema.stateProposals)
			.where(eq(schema.stateProposals.sessionId, w.session.id))
		expect(proposals.length).toBeGreaterThan(0)
	}, 60_000)

	it("with Trust the narrator on, the keeper's changes are applied", async () => {
		const { w, receipt } = await turn({ trustNarrator: true })

		const applied = ran(receipt, "keep.played.commit.trusted.apply")
		expect(applied).toHaveLength(1)
		expect((applied[0]!.output as any).applied.length).toBeGreaterThan(0)
		const state = await stateFor(db, w.session.id)
		const brannoc = Object.values(state.cast).find(
			(c: any) => c && typeof c === "object" && c.hp !== undefined
		) as any
		expect(brannoc?.hp).toBe(8)
	}, 60_000)

	// R12 (2026-09-28): the Lair is cast only; a stored turn style is inert.
	it("a stored turnStyle 'narrator' still voices the delver, and keeps state", async () => {
		const { receipt } = await turn({ turnStyle: "narrator", trustNarrator: false })
		expect(ran(receipt, "via.turn.channel.story.pick.planned.door.play.lead.speaks.say")).toHaveLength(1)
		expect(ran(receipt, "keep.played.commit.reviewed.propose")).toHaveLength(1)
	}, 60_000)
})
