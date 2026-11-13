/**
 * The app creates one row of each local ONNX type, never fills a loadout with
 * it, folds hand-made extras into the kept one (the one a loadout names, else
 * the oldest), and a settled install writes nothing.
 */
import { beforeEach, describe, expect, it, vi } from "vitest"
import { eq } from "drizzle-orm"
import {
	createTestDb,
	setConfigValue,
	type TestDb
} from "$lib/server/utils/testDb"
import * as schema from "$lib/server/db/schema"
import { CONNECTION_TYPE } from "$lib/shared/constants/ConnectionTypes"
import { defaultLoadoutRow } from "$lib/server/loadouts/testing"

const availability = vi.hoisted(() => ({ available: true }))
vi.mock("$lib/server/localModels/onnxRuntime", () => ({
	localOnnxAvailability: async () =>
		availability.available
			? { available: true }
			: { available: false, reason: "test" }
}))

let db: TestDb

beforeEach(async () => {
	availability.available = true
	db = await createTestDb()
}, 60_000)

const ensure = async () => {
	const { ensureLocalOnnxConnections } = await import(
		"./localOnnxConnections"
	)
	return ensureLocalOnnxConnections(db as any)
}

const EMB = CONNECTION_TYPE.LOCAL_ONNX_EMBEDDINGS
const NER = CONNECTION_TYPE.LOCAL_ONNX_NER

const ofType = (type: string) =>
	db
		.select()
		.from(schema.connections)
		.where(eq(schema.connections.type, type))
const allConnections = () =>
	db.select().from(schema.connections).orderBy(schema.connections.id)

async function handMade(type: string, name: string) {
	const [row] = await db
		.insert(schema.connections)
		.values({
			name,
			type,
			modality: type === EMB ? "embeddings" : "ner",
			baseUrl: "",
			extraJson: {},
			capabilities: {}
		} as any)
		.returning()
	return row
}

async function model(connectionId: number, identifier: string) {
	const [row] = await db
		.insert(schema.connectionModels)
		.values({
			connectionId,
			model: identifier,
			name: identifier,
			enabled: true
		})
		.returning()
	return row
}

describe("ensureLocalOnnxConnections", () => {
	it("a fresh install gets exactly the two named rows and fills nothing", async () => {
		expect(await ensure()).toEqual({ created: 2, folded: 0, renamed: 0 })
		const [e] = await ofType(EMB)
		const [n] = await ofType(NER)
		expect(await ofType(EMB)).toHaveLength(1)
		expect(await ofType(NER)).toHaveLength(1)
		expect(e).toMatchObject({
			name: "Local embeddings",
			modality: "embeddings"
		})
		expect(n).toMatchObject({
			name: "Local named entities",
			modality: "ner"
		})
		expect(
			Object.keys((e.capabilities as any).resolved).length
		).toBeGreaterThan(0)
		expect(
			Object.keys((n.capabilities as any).resolved).length
		).toBeGreaterThan(0)

		const loadouts = await db.select().from(schema.loadouts)
		expect(
			loadouts.filter((l) =>
				[e.id, n.id].includes(l.connectionId as number)
			)
		).toEqual([])
		const defaults = await db.select().from(schema.connectionDefaults)
		expect(
			defaults.filter((d) =>
				Object.values(d).some((v) => v === e.id || v === n.id)
			)
		).toEqual([])
	})

	it("a second call changes nothing", async () => {
		await ensure()
		const before = await allConnections()
		expect(await ensure()).toEqual({ created: 0, folded: 0, renamed: 0 })
		expect(await allConnections()).toEqual(before)
	})

	it("an unavailable machine gets no rows", async () => {
		availability.available = false
		expect(await ensure()).toEqual({ created: 0, folded: 0, renamed: 0 })
		expect(await ofType(EMB)).toEqual([])
		expect(await ofType(NER)).toEqual([])
	})

	it("an existing hand-made row is adopted and renamed", async () => {
		const mine = await handMade(EMB, "My embeddings")
		expect(await ensure()).toEqual({ created: 1, folded: 0, renamed: 1 })
		const rows = await ofType(EMB)
		expect(rows).toHaveLength(1)
		expect(rows[0]).toMatchObject({ id: mine.id, name: "Local embeddings" })
	})

	it("two hand-made rows fold into the one a loadout names", async () => {
		const older = await handMade(EMB, "older")
		const newer = await handMade(EMB, "newer")
		const olderOnly = await model(older.id, "only-older")
		const olderShared = await model(older.id, "shared")
		const newerShared = await model(newer.id, "shared")
		await db.insert(schema.loadouts).values(
			defaultLoadoutRow({
				input: "text",
				output: "embeddings",
				connectionId: newer.id,
				connectionModelId: newerShared.id
			})
		)
		const [spec] = await db
			.insert(schema.pipelineSpecs)
			.values({ slug: `test:spec/${Math.random()}`, name: "spec" })
			.returning()
		const [config] = await db
			.insert(schema.pipelineConfigs)
			.values({ specId: spec.id, name: "config" })
			.returning()
		await setConfigValue(
			db,
			config.id,
			{ nodeKey: "embed", slot: "connection" },
			{ ref: older.id, modelId: olderShared.id }
		)

		expect(await ensure()).toEqual({ created: 1, folded: 1, renamed: 1 })

		const rows = await ofType(EMB)
		expect(rows.map((r) => r.id)).toEqual([newer.id])
		expect(rows[0].name).toBe("Local embeddings")
		const [slot] = await db
			.select()
			.from(schema.pipelineConfigValues)
			.where(eq(schema.pipelineConfigValues.slot, "connection"))
		expect(slot.value).toEqual({ ref: newer.id, modelId: newerShared.id })
		const [l] = await db.select().from(schema.loadouts)
		expect(l).toMatchObject({
			connectionId: newer.id,
			connectionModelId: newerShared.id
		})
		const models = await db
			.select()
			.from(schema.connectionModels)
			.where(eq(schema.connectionModels.connectionId, newer.id))
		expect(models.map((m) => m.model).sort()).toEqual([
			"only-older",
			"shared"
		])
		expect(models.find((m) => m.model === "only-older")!.id).toBe(
			olderOnly.id
		)
	})

	it("with no loadout naming either, the oldest is kept", async () => {
		const older = await handMade(NER, "older")
		await handMade(NER, "newer")
		await ensure()
		const rows = await ofType(NER)
		expect(rows.map((r) => r.id)).toEqual([older.id])
	})
})
