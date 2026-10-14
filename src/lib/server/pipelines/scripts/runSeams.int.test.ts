/**
 * What a run settles about its script seams before the first node
 * (PLAN-script-placement D4; the connection-guard tier fix, 2026-10-10).
 *
 * Pinned: an unplaced chain holding an enabled stop guard halts with a reason
 * naming the guard and the step; an unplaced chain of transforms is a note,
 * not a halt; and a step whose configuration names a connection gets THAT
 * connection's stop guards, not the instance default's.
 */

import { describe, it, expect, beforeAll } from "vitest"
import {
	getDefinition,
	seamsOf,
	type ConfigWorld,
	type SpecDocument
} from "@serene-pub/sdk"
import { createTestDb, type TestDb } from "$lib/server/utils/testDb"
import * as schema from "$lib/server/db/schema"
import {
	bootstrapPipelines,
	CHAT_RESPOND_SPEC_ID,
	loadPublished
} from "$lib/server/pipelines/boot/bootstrap"
import {
	attachConnectionScript,
	createScript
} from "$lib/server/pipelines/entities/scripts"
import { connectionSlotValue } from "$lib/shared/connections/slotRef"
import {
	stopGuardsByNode,
	unplacedAtStart
} from "$lib/server/pipelines/scripts/runSeams"

let db: TestDb
let doc: SpecDocument
/** A node of the respond spec whose definition has a seam accepting `text/stop`. */
let guarded: SpecDocument["nodes"][number]
/** The node whose `connection` slot the run's text comes from. */
let providerKey: string

const worldWith = (
	rows: Array<{ nodeKey: string; slot: string; path: string; value: unknown }>
): ConfigWorld => ({
	overrides: rows.map((r) => ({ ...r, scopeKind: "config", scopeId: 1 })),
	samplingConfigs: [],
	connections: [],
	activeConnection: {}
})

beforeAll(async () => {
	db = await createTestDb()
	await bootstrapPipelines(db)
	doc = (await loadPublished(db, CHAT_RESPOND_SPEC_ID))!
	guarded = doc.nodes.find((n) => {
		const def = getDefinition(`${n.definitionId}@${n.definitionVersion}`) as any
		return (
			!!def &&
			seamsOf(def).some((s) => s.accepts.includes("core:script:text/stop@1"))
		)
	})!
	expect(guarded).toBeTruthy()
	// Whose Model row decides the guards: the run's text provider — the node
	// the budget pairs its connection with, else the first spine oracle.
	const budget = doc.nodes.find(
		(n) => n.definitionId === "core:task/context-budget"
	) as any
	const ref = budget?.config?.connection
	providerKey =
		ref?.__ref === "slot" && typeof ref.ofNode === "string"
			? ref.ofNode
			: doc.nodes
					.filter((n: any) => n.kind === "oracle" && !n.clauseId)
					.sort((a: any, b: any) => a.position - b.position)[0]!.key
}, 60_000)

describe("an unplaced chain at run start", () => {
	it("halts for an enabled stop guard, naming the guard and the step", async () => {
		const guard = await createScript(db, {
			typeId: "core:script:text/stop@1",
			name: "Lost guard"
		})
		const out = await unplacedAtStart(
			db,
			doc,
			worldWith([
				{
					nodeKey: guarded.key,
					slot: "scripts",
					path: "a-point-that-is-gone",
					value: [guard.id]
				}
			])
		)
		expect(out.halt?.nodeKey).toBe(guarded.key)
		expect(out.halt?.reason).toMatch(
			/^stop guard "Lost guard" has no place to run on step .+$/
		)
		// The reason names the step by its label, never the node key.
		expect(out.halt?.reason.endsWith(` ${guarded.key}`)).toBe(false)
	}, 60_000)

	it("skips a chain of transforms with one note, and does not halt", async () => {
		const t = await createScript(db, {
			typeId: "core:script:text/transform@1",
			name: "Lost transform"
		})
		const out = await unplacedAtStart(
			db,
			doc,
			worldWith([
				{
					nodeKey: guarded.key,
					slot: "scripts",
					path: "a-point-that-is-gone",
					value: [t.id]
				}
			])
		)
		expect(out.halt).toBeUndefined()
		expect(out.notes).toHaveLength(1)
		expect(out.notes[0]).toMatch(
			/^scripts at scripts\/a-point-that-is-gone on .+: no longer here, skipped$/
		)
	}, 60_000)

	it("does not halt for a disabled guard, and ignores declared seams", async () => {
		const off = await createScript(db, {
			typeId: "core:script:text/stop@1",
			name: "Switched-off guard"
		})
		await db
			.update(schema.pipelineScripts)
			.set({ enabled: false })
			.where((await import("drizzle-orm")).eq(schema.pipelineScripts.id, off.id))
		const declared = seamsOf(
			getDefinition(`${guarded.definitionId}@${guarded.definitionVersion}`) as any
		)[0]!
		const out = await unplacedAtStart(
			db,
			doc,
			worldWith([
				{
					nodeKey: guarded.key,
					slot: "scripts",
					path: "a-point-that-is-gone",
					value: [off.id]
				},
				// A chain at a DECLARED seam is the executor's, never unplaced.
				{
					nodeKey: guarded.key,
					slot: declared.kind === "point" ? "scripts" : declared.slot!,
					path: declared.kind === "point" ? declared.at : "",
					value: [off.id]
				}
			])
		)
		expect(out.halt).toBeUndefined()
		expect(out.notes).toHaveLength(1)
	}, 60_000)
})

describe("which connection's stop guards a step gets", () => {
	it("is the connection the step's configuration names, not the default", async () => {
		const { ensureConnectionModel } = await import(
			"$lib/server/connections/models"
		)
		const { setCapabilityDefault } = await import(
			"$lib/server/connections/capabilityDefaults"
		)
		const [def] = await db
			.insert(schema.connections)
			.values({ name: "Default Kobold", type: "koboldcpp" })
			.returning()
		const [other] = await db
			.insert(schema.connections)
			.values({ name: "Configured Kobold", type: "koboldcpp" })
			.returning()
		const defModel = await ensureConnectionModel(db, def.id, "def-7b")
		const otherModel = await ensureConnectionModel(db, other.id, "other-7b")
		await setCapabilityDefault(db, "text->text", {
			connectionId: def.id,
			connectionModelId: defModel!.id
		})
		const defGuard = await createScript(db, {
			typeId: "core:script:text/stop@1",
			name: "Default's guard"
		})
		const otherGuard = await createScript(db, {
			typeId: "core:script:text/stop@1",
			name: "Configured's guard"
		})
		await attachConnectionScript(db, def.id, defGuard.id)
		await attachConnectionScript(db, other.id, otherGuard.id)

		// No configured connection: the instance default's guards.
		const plain = await stopGuardsByNode(db, doc, worldWith([]))
		expect(plain[guarded.key]?.connectionName).toBe("Default Kobold")

		// The configuration names the other pair for the step that writes the
		// reply's text: ITS guards join the write-side stop seam.
		const configured = await stopGuardsByNode(
			db,
			doc,
			worldWith([
				{
					nodeKey: providerKey,
					slot: "connection",
					path: "",
					value: connectionSlotValue(other.id, otherModel!.id)
				}
			])
		)
		expect(configured[guarded.key]?.connectionName).toBe("Configured Kobold")
		expect(configured[guarded.key]?.rows.map((r) => r.name)).toEqual([
			"Configured's guard"
		])
	}, 60_000)
})
