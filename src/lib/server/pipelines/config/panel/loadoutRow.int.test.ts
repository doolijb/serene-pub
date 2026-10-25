/**
 * The Loadout row of a model call's settings group (I12; DESIGN-image-
 * generation §14 item 4): the picker leads the group; its rows are the
 * step's transform's loadouts with consequence words (never a grade); the
 * selected one carries its resolved chain; the slots beneath say where their
 * value came from — *Set here* · *From the Reply loadout* · *From the
 * default*; a session never sees the row.
 */

import { afterAll, beforeAll, describe, expect, it } from "vitest"
import { and, eq } from "drizzle-orm"
import { createTestDb, replyStepKeys, type TestDb } from "$lib/server/utils/testDb"
import * as schema from "$lib/server/db/schema"
import {
	namespaceView,
	optionId,
	type ConfigOption,
	type NamespaceView
} from "$lib/server/pipelines/config/panel"
import { STORY_RESPOND_SPEC_ID } from "$lib/server/pipelines/boot/bootstrap"
import { seedCoreLoadouts } from "$lib/server/loadouts/seed"
import { findLoadout } from "$lib/server/loadouts"
import { capabilityLabel } from "@serene-pub/sdk"

const SECRET = "test-instance-secret"
/**
 * A reply with a JSON step — the Lair's planner (its state keeper until the
 * Lair rewrite made the keeper a routine, 2026-10-21; Adventure's until
 * 2026-10-19).
 */
const LAIR = "core:spec/lair-reply"
const KEEPER_WRITE = "via.turn.channel.story.pick.planned.planWrite"
const SUMMARIZE = "core:spec/summarize-scene"

let db: TestDb
let adminId: number
let userId: number
let sessionId: number
let pairName: string
/** Story's reply call, by the address its document gives it (in its `reply` junction). */
let GENERATE: string

const id = (nodeKey: string, slot: string, path = "") => optionId(SECRET, nodeKey, slot, path)
const asAdmin = (slug: string, over: object = {}) =>
	namespaceView(db, SECRET, slug, { userId: adminId, isAdmin: true, ...over }) as Promise<NamespaceView>
const all = (v: NamespaceView): ConfigOption[] =>
	v.groups.flatMap((g) => [...g.front, ...g.advanced.flatMap((s) => s.options)])
const opt = (v: NamespaceView, optionKey: string) => all(v).find((o) => o.id === optionKey)!

/**
 * Write one value where a global edit lands — the genre's defaults'
 * registration of the pipeline (PLAN-layering D5); `undefined` clears it.
 */
async function setConfigValue(slug: string, nodeKey: string, slot: string, value: unknown) {
	const { setPipelineValue } = await import("$lib/server/utils/testDb")
	await setPipelineValue(db, slug, { nodeKey, slot, path: "" }, value)
}

beforeAll(async () => {
	db = await createTestDb()
	for (const seedKey of ["sampling-default", "sampling-extraction", "sampling-image-default"])
		await db
			.insert(schema.samplingConfigs)
			.values({
				seedKey,
				name: seedKey === "sampling-extraction" ? "Extraction" : seedKey,
				shape: seedKey.includes("image") ? "core:shape/image-gen@1" : "core:shape/text-gen@1"
			} as any)
			.onConflictDoNothing()
	const { bootstrapPipelines } = await import("$lib/server/pipelines/boot/bootstrap")
	await bootstrapPipelines(db)
	await seedCoreLoadouts(db as any)

	const [c] = await db
		.insert(schema.connections)
		.values({ name: "Kobold", type: "openai", baseUrl: "http://x" } as any)
		.returning()
	const [m] = await db
		.insert(schema.connectionModels)
		.values({ connectionId: c!.id, model: "nemo", name: "Nemo" } as any)
		.returning()
	pairName = "Kobold · Nemo"
	// Reply filled, and the text default — what everything falls back to.
	const reply = (await findLoadout(db as any, "core:loadout/reply@1"))!
	await db
		.update(schema.loadouts)
		.set({
			connectionId: c!.id,
			connectionModelId: m!.id,
			defaultForInput: "text",
			defaultForOutput: "text"
		})
		.where(eq(schema.loadouts.id, reply.id))

	const [admin] = await db
		.insert(schema.users)
		.values({ username: "loadout-admin", isAdmin: true })
		.returning()
	adminId = admin!.id
	const [user] = await db
		.insert(schema.users)
		.values({ username: "loadout-user", isAdmin: false })
		.returning()
	userId = user!.id
	const [session] = await db
		.insert(schema.sessions)
		.values({ userId: adminId, isGroup: false })
		.returning()
	sessionId = session!.id
	GENERATE = (await replyStepKeys(db, STORY_RESPOND_SPEC_ID)).generate
}, 60_000)

afterAll(async () => {
	await (db as any).$client?.close?.()
})

describe("the Loadout picker", () => {
	it("leads each model call's group, offering only the step's transform's loadouts", async () => {
		const v = await asAdmin(LAIR)
		for (const g of v.groups.filter((x) => x.kind === "model-call"))
			expect(g.front[0]!.control).toBe("loadout-ref")
		const keeper = opt(v, id(KEEPER_WRITE, "loadout"))
		const names = keeper.choices!.map((c) => c.label)
		expect(names).toEqual(expect.arrayContaining(["Reply", "Extraction"]))
		expect(names).not.toContain("Images")
		expect(keeper.choices!.every((c) => typeof c.loadoutId === "string")).toBe(true)
	})

	it("says each row's consequences for this step — never a grade", async () => {
		const v = await asAdmin(LAIR)
		const keeper = opt(v, id(KEEPER_WRITE, "loadout"))
		const extraction = keeper.choices!.find((c) => c.label === "Extraction")!
		expect(extraction.description).toContain("Unfilled — falls back to Reply")
		// The planner answers with JSON; an untested pair has no schema door.
		expect(extraction.description).toContain("JSON by instruction (no schema door)")
		for (const c of keeper.choices!)
			expect(`${c.label} ${c.description ?? ""}`).not.toMatch(/\b(fits|partly|won't)\b/i)
		expect(keeper.loadout?.needs).toEqual([capabilityLabel("text->text"), "a structured answer"])
	})

	it("carries Best with from the definition's prefers", async () => {
		const v = await asAdmin(SUMMARIZE)
		const rows = all(v).filter((o) => o.control === "loadout-ref")
		expect(rows.length).toBeGreaterThan(0)
		expect(rows.some((o) => o.loadout?.bestWith?.includes("Extraction sampling"))).toBe(true)
	})

	it("shows the selected loadout's title and resolved chain", async () => {
		await setConfigValue(STORY_RESPOND_SPEC_ID, GENERATE, "loadout", {
			id: "core:loadout/extraction@1"
		})
		const v = await asAdmin(STORY_RESPOND_SPEC_ID)
		const row = opt(v, id(GENERATE, "loadout"))
		expect(row.loadout?.selected?.name).toBe("Extraction")
		expect(row.loadout?.selected?.chain).toBe("Extraction → Reply (unfilled fallback)")
		expect(row.valueLabel).toBe("Extraction")
	})
})

describe("the slots beneath it", () => {
	it("read From the <fallback> loadout (unfilled fallback) when the named one is unfilled", async () => {
		await setConfigValue(STORY_RESPOND_SPEC_ID, GENERATE, "loadout", {
			id: "core:loadout/extraction@1"
		})
		await setConfigValue(STORY_RESPOND_SPEC_ID, GENERATE, "connection", undefined)
		const v = await asAdmin(STORY_RESPOND_SPEC_ID)
		const conn = opt(v, id(GENERATE, "connection"))
		expect(conn.provenance).toEqual({
			source: "loadout",
			label: "From the Reply loadout (unfilled fallback)"
		})
		expect(conn.valueLabel).toBe(pairName)
	})

	it("read From the Reply loadout when the named one is filled", async () => {
		await setConfigValue(STORY_RESPOND_SPEC_ID, GENERATE, "loadout", { id: "core:loadout/reply@1" })
		const v = await asAdmin(STORY_RESPOND_SPEC_ID)
		const conn = opt(v, id(GENERATE, "connection"))
		expect(conn.provenance?.label).toBe("From the Reply loadout")
		expect(conn.inherits?.label).toBe(`From the Reply loadout — ${pairName}`)
		expect(conn.useLoadout).toBeUndefined()
	})

	it("read Set here for an explicit pick, offering Use loadout's", async () => {
		await setConfigValue(STORY_RESPOND_SPEC_ID, GENERATE, "loadout", { id: "core:loadout/reply@1" })
		const [conn] = await db.select().from(schema.connections).limit(1)
		await setConfigValue(STORY_RESPOND_SPEC_ID, GENERATE, "connection", {
			id: String(conn!.id),
			modelId: null
		})
		const v = await asAdmin(STORY_RESPOND_SPEC_ID)
		const row = opt(v, id(GENERATE, "connection"))
		expect(row.provenance).toEqual({ source: "config", label: "Set here" })
		expect(row.useLoadout).toBe("Reply")
		await setConfigValue(STORY_RESPOND_SPEC_ID, GENERATE, "connection", undefined)
	})

	it("read From the Reply loadout when the step names no loadout", async () => {
		await setConfigValue(STORY_RESPOND_SPEC_ID, GENERATE, "loadout", null)
		const v = await asAdmin(STORY_RESPOND_SPEC_ID)
		const row = opt(v, id(GENERATE, "connection"))
		expect(row.provenance).toEqual({ source: "pub", label: "From the Reply loadout" })
		expect(row.valueLabel).toBe(pairName)
		expect(opt(v, id(GENERATE, "loadout")).loadout?.selected).toBeUndefined()
	})
})

describe("sessions never pick a loadout", () => {
	it("sends no Loadout row in a session's view, an admin's included, nor to a member", async () => {
		const inSession = await asAdmin(STORY_RESPOND_SPEC_ID, { sessionId })
		expect(all(inSession).some((o) => o.control === "loadout-ref")).toBe(false)
		const member = (await namespaceView(db, SECRET, STORY_RESPOND_SPEC_ID, {
			userId,
			isAdmin: false
		})) as NamespaceView
		expect(all(member).some((o) => o.control === "loadout-ref")).toBe(false)
	})
})
