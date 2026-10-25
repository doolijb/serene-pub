/**
 * The post-history reminder's token trigger, as each core genre ships it.
 *
 * 0.5.3 seeded `post_history_token_trigger = 3000` on every prompt config: a
 * session shorter than that gets no reminder, because a reinforcement note two
 * messages after the system prompt is noise. The declaration's own default is
 * 0 ("always add it"), so the genre's number has to be said by the genre — on
 * its respond spec's default preset — and reach a fresh install's shipped
 * configuration at every step that assembles a prompt.
 *
 * Read at every assemble node rather than at a hardcoded one: a genre whose
 * turn assembles four prompts honours the trigger at each of them, and a
 * step that kept the declaration's 0 would add the reminder to a two-message
 * session with nothing to show for it but the block itself.
 */

import { afterAll, beforeAll, describe, expect, it, vi } from "vitest"
import fs from "fs/promises"
import os from "os"
import path from "path"
import { eq } from "drizzle-orm"
import { resolveConfigSources } from "@serene-pub/sdk"
import type { TestDb } from "$lib/server/utils/testDb"
import * as schema from "$lib/server/db/schema"

let db: TestDb
let dataDir: string

vi.mock("$lib/server/db", async () => {
	const { createTestDb } = await import("$lib/server/utils/testDb")
	const db = await createTestDb()
	return { db, getCryptoSecretKey: () => "post-history-trigger-test-secret" }
})

beforeAll(async () => {
	dataDir = await fs.mkdtemp(
		path.join(os.tmpdir(), "serene-pub-post-history-trigger-test-")
	)
	process.env.SERENE_PUB_DATA_DIR = dataDir

	const dbModule = await import("$lib/server/db")
	db = dbModule.db as unknown as TestDb
	await (await import("$lib/server/db/defaults")).sync()

	const { bootstrapPipelines } = await import(
		"$lib/server/pipelines/boot/bootstrap"
	)
	await bootstrapPipelines(db)
}, 180_000)

afterAll(async () => {
	await fs.rm(dataDir, { recursive: true, force: true })
})

/** The 0.5.3 seed value every core genre's respond pipeline ships. */
const SHIPPED_TRIGGER = 3000

const RESPOND_SPECS = [
	"core:spec/story-respond",
	"core:spec/guide-respond",
	"core:spec/lair-reply"
]

/**
 * The trigger a respond spec's author default says at each step, read off the
 * published spec's default preset — the genre's own words, never spelled
 * here. Most prose steps ship 0.5.3's 3000; a step whose reminder must land
 * from the first line ships 0 on purpose:
 * - 🚧 the Lair's Sanctum talk (lair fix 2, 2026-10-22): the Castellan's
 *   reminder (never narrate, never write for the party) — the talk that
 *   drifted into narrating was two messages long;
 * - 🚧 the Lair's voice (RF fix 2, 2026-10-23): a delver's reminder says whose
 *   turn it is — a party of one read nothing after the GM's line and answered
 *   as the GM, "*You materialize…*".
 *
 * The structured calls inside a reply (JSON out) would keep the declaration's
 * 0, as the structured actions below do. 🚧 Story's reckoning and sweep left
 * the reply on 2026-10-20 — routines of their own (PLAN-layering §4) — so no
 * reply carries one now.
 */
const authorTriggersOf = async (slug: string): Promise<Record<string, unknown>> => {
	const [spec] = await db
		.select()
		.from(schema.pipelineSpecs)
		.where(eq(schema.pipelineSpecs.slug, slug))
	const { loadDocument } = await import("$lib/server/pipelines/boot/store")
	const doc = await loadDocument(db, spec!.activeVersionId!)
	const preset = doc.presets.find((p) => p.default)
	expect(preset, `${slug} ships no default preset`).toBeTruthy()
	return Object.fromEntries(
		preset!.values
			.filter((v) => v.slot === "params")
			.map((v) => [v.nodeKey, (v.value as Record<string, unknown>)?.postHistoryTokenTrigger])
			.filter(([, trigger]) => trigger !== undefined)
	)
}

/** Every node in the spec's active version that declares the trigger. */
const triggerNodesOf = async (slug: string) => {
	const [spec] = await db
		.select()
		.from(schema.pipelineSpecs)
		.where(eq(schema.pipelineSpecs.slug, slug))
	expect(spec, `${slug} is not published`).toBeTruthy()
	const { declarations } = await import("$lib/server/pipelines/config/panel")
	return (await declarations(db, spec.activeVersionId!))
		.filter((d) => d.slot === "params" && d.path === "postHistoryTokenTrigger")
		.map((d) => d.nodeKey)
}

describe("a fresh install's post-history trigger", () => {
	it.each(RESPOND_SPECS)(
		"resolves to its genre's author default at every prose assemble step of %s",
		async (slug) => {
			const nodeKeys = await triggerNodesOf(slug)
			expect(nodeKeys.length).toBeGreaterThan(0)

			const { buildWorld } = await import("$lib/server/pipelines/config/world")
			const world = await buildWorld(db, { specId: slug })
			const sourced = resolveConfigSources(world as any, nodeKeys)
			const resolved = Object.fromEntries(
				nodeKeys.map((k) => [
					k,
					sourced[k]?.params?.postHistoryTokenTrigger?.value
				])
			)
			const authored = await authorTriggersOf(slug)
			// The genre says its number at every step that assembles a
			// prompt: none falls through to the declaration's 0 unsaid.
			expect(Object.keys(authored).sort()).toEqual([...nodeKeys].sort())
			// 0.5.3's 3000, or 0 where the reminder lands from the first line;
			// every respond spec ships the 3000 somewhere.
			for (const v of Object.values(authored)) expect([SHIPPED_TRIGGER, 0]).toContain(v)
			expect(Object.values(authored)).toContain(SHIPPED_TRIGGER)
			// …and what the author said is what a fresh install resolves.
			expect(resolved).toEqual(authored)
		},
		60_000
	)
})

describe("the prose actions ship the trigger; the structured calls do not", () => {
	const resolvedOf = async (slug: string) => {
		const nodeKeys = await triggerNodesOf(slug)
		expect(nodeKeys.length).toBeGreaterThan(0)
		const { buildWorld } = await import("$lib/server/pipelines/config/world")
		const world = await buildWorld(db, { specId: slug })
		const sourced = resolveConfigSources(world as any, nodeKeys)
		return nodeKeys.map((k) => sourced[k]?.params?.postHistoryTokenTrigger?.value)
	}

	it.each([
		"core:spec/story-side-character",
		"core:spec/story-look",
		"core:spec/lair-trap",
		"core:spec/lair-reveal"
	])("%s resolves 3000", async (slug) => {
		for (const v of await resolvedOf(slug)) expect(v).toBe(SHIPPED_TRIGGER)
	}, 60_000)

	it.each([
		// 0.5.3's narrator: the reminder carries the press's direction beside the seed.
		"core:spec/story-narrate",
		"core:spec/story-ask",
		"core:spec/story-rest",
		// retired with Adventure, 2026-10-19 (Adventure's Time passes; no
		// advance-time left declares the trigger)
		"core:spec/lair-build-room",
		"core:spec/lair-room-answer",
		"core:spec/lair-file-room",
		"core:spec/story-answer-form"
	])("%s keeps the declaration's 0", async (slug) => {
		for (const v of await resolvedOf(slug)) expect(v).toBe(0)
	}, 60_000)

	it("names Story's reply's shipped configuration Default", async () => {
		const [row] = await db
			.select()
			.from(schema.pipelineConfigs)
			.where(eq(schema.pipelineConfigs.seedKey, "pipeline-default:core:spec/story-respond"))
		expect(row?.name).toBe("Default")
	})
})
