/**
 * Managed KoboldCPP image connections fold into THE managed endpoint.
 *
 * The property that matters is that nothing which named the image row is
 * lost: the image default, a pipeline's Connection slot and the image
 * settings all name the managed endpoint afterwards — and the
 * image model still refuses to chat.
 */
import { beforeEach, describe, expect, it } from "vitest"
import { eq } from "drizzle-orm"
import { createTestDb, setConfigValue, type TestDb } from "$lib/server/utils/testDb"
import * as schema from "$lib/server/db/schema"
import { CONNECTION_TYPE } from "$lib/shared/constants/ConnectionTypes"
import { mergeEndpointModel } from "./models"
import { capabilityRefusal } from "$lib/server/pipelines/runtime/capabilityGuard"

let db: TestDb

beforeEach(async () => {
	db = await createTestDb()
}, 60_000)

async function connection(values: Record<string, unknown>) {
	const [row] = await db
		.insert(schema.connections)
		.values({
			name: `fixture ${Math.random()}`,
			baseUrl: "http://localhost:5001",
			extraJson: {},
			capabilities: {},
			...values
		} as any)
		.returning()
	return row
}

async function model(connectionId: number, identifier: string) {
	const [row] = await db
		.insert(schema.connectionModels)
		.values({ connectionId, model: identifier, name: identifier, enabled: true })
		.returning()
	return row
}

const image = () =>
	connection({ type: CONNECTION_TYPE.KOBOLDCPP_MANAGED_IMAGE, modality: "image-gen" })
const managed = () =>
	connection({ type: CONNECTION_TYPE.KOBOLDCPP_MANAGED, modality: "text-gen" })

const connectionsOfType = (type: string) =>
	db.select().from(schema.connections).where(eq(schema.connections.type, type))

const modelsOf = (connectionId: number) =>
	db
		.select()
		.from(schema.connectionModels)
		.where(eq(schema.connectionModels.connectionId, connectionId))

const imageDefault = async () =>
	(
		await db
			.select()
			.from(schema.connectionDefaults)
			.where(eq(schema.connectionDefaults.output, "image"))
	)[0]

async function fold() {
	const { foldKoboldCppManagedImage } = await import("./koboldCppManagedFold")
	return foldKoboldCppManagedImage(db as any)
}

describe("folding managed image connections into the managed endpoint", () => {
	it("with no managed endpoint yet, the image row BECOMES it, in place", async () => {
		const s = await image()
		const sd = await model(s.id, "sdxl.gguf")
		await db.insert(schema.connectionDefaults).values({
			input: "text",
			output: "image",
			connectionId: s.id,
			connectionModelId: sd.id
		})

		expect(await fold()).toEqual({ folded: 0, renamed: 1 })

		const [row] = await connectionsOfType(CONNECTION_TYPE.KOBOLDCPP_MANAGED)
		expect(row.id).toBe(s.id)
		expect(await connectionsOfType(CONNECTION_TYPE.KOBOLDCPP_MANAGED_IMAGE)).toEqual([])
		const [m] = await modelsOf(s.id)
		expect(m.modality).toBe("image-gen")
		expect(await imageDefault()).toMatchObject({
			connectionId: s.id,
			connectionModelId: sd.id
		})
	})

	it("into an existing endpoint, every reference is repointed before the row goes", async () => {
		const t = await managed()
		const tChat = await model(t.id, "chat.gguf")
		const tShared = await model(t.id, "shared.gguf")
		const s = await image()
		const sd = await model(s.id, "sdxl.gguf")
		const sShared = await model(s.id, "shared.gguf")
		await db
			.update(schema.connections)
			.set({ extraJson: { profile: { sdQuant: "1" } } })
			.where(eq(schema.connections.id, s.id))

		// The image default names the image row's own model.
		await db.insert(schema.connectionDefaults).values({
			input: "text",
			output: "image",
			connectionId: s.id,
			connectionModelId: sd.id
		})
		// A pipeline slot naming the image row and the DUPLICATE model.
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
			{ nodeKey: "draw", slot: "connection" },
			{ ref: s.id, modelId: sShared.id }
		)
		// And a legacy bare-id spelling on another node.
		await setConfigValue(db, config.id, { nodeKey: "draw2", slot: "connection" }, s.id)
		// An unrelated number in another slot must not be touched.
		await setConfigValue(db, config.id, { nodeKey: "draw", slot: "params", path: "steps" }, s.id)

		expect(await fold()).toEqual({ folded: 1, renamed: 0 })

		expect(await connectionsOfType(CONNECTION_TYPE.KOBOLDCPP_MANAGED_IMAGE)).toEqual([])
		const models = await modelsOf(t.id)
		expect(
			Object.fromEntries(models.map((m) => [m.model, [m.id, m.modality]]))
		).toEqual({
			"chat.gguf": [tChat.id, null],
			"shared.gguf": [tShared.id, null],
			"sdxl.gguf": [sd.id, "image-gen"]
		})
		expect(await imageDefault()).toMatchObject({
			connectionId: t.id,
			connectionModelId: sd.id
		})
		const values = await db
			.select()
			.from(schema.pipelineConfigValues)
			.where(eq(schema.pipelineConfigValues.configId, config.id))
		const at = (nodeKey: string, slot: string) =>
			values.find((v) => v.nodeKey === nodeKey && v.slot === slot)?.value
		expect(at("draw", "connection")).toEqual({ ref: t.id, modelId: tShared.id })
		expect(at("draw2", "connection")).toBe(t.id)
		expect(at("draw", "params")).toBe(s.id)
		const [tAfter] = await db
			.select()
			.from(schema.connections)
			.where(eq(schema.connections.id, t.id))
		expect((tAfter.extraJson as any).profile).toEqual({ sdQuant: "1" })
	})

	it("the folded image model still refuses to chat on the endpoint that chats", async () => {
		const t = await managed()
		await db
			.update(schema.connections)
			.set({ capabilities: { resolved: { "text->text": 2, "text->image": 1 } } })
			.where(eq(schema.connections.id, t.id))
		const s = await image()
		const sd = await model(s.id, "sdxl.gguf")
		await fold()
		const [tRow] = await db
			.select()
			.from(schema.connections)
			.where(eq(schema.connections.id, t.id))
		const [sdRow] = await db
			.select()
			.from(schema.connectionModels)
			.where(eq(schema.connectionModels.id, sd.id))
		const pair = mergeEndpointModel(tRow as any, sdRow as any)
		expect(capabilityRefusal(pair, "text->text")).not.toBeNull()
		expect(capabilityRefusal(pair, "text->image")).toBeNull()
	})

	it("a second managed row folds into the oldest, its models keeping their modality", async () => {
		const t = await managed()
		const u = await managed()
		const chat = await model(u.id, "other-chat.gguf")
		await db
			.update(schema.connectionModels)
			.set({ modality: "text-gen" })
			.where(eq(schema.connectionModels.id, chat.id))
		await db.insert(schema.connectionDefaults).values({
			input: "text",
			output: "text",
			connectionId: u.id,
			connectionModelId: chat.id
		})

		expect(await fold()).toEqual({ folded: 1, renamed: 0 })

		const rows = await connectionsOfType(CONNECTION_TYPE.KOBOLDCPP_MANAGED)
		expect(rows.map((r) => r.id)).toEqual([t.id])
		const [moved] = await modelsOf(t.id)
		expect([moved.id, moved.modality]).toEqual([chat.id, "text-gen"])
		const [textDefault] = await db
			.select()
			.from(schema.connectionDefaults)
			.where(eq(schema.connectionDefaults.output, "text"))
		expect(textDefault).toMatchObject({ connectionId: t.id, connectionModelId: chat.id })
	})

	it("a settled install does nothing", async () => {
		await managed()
		expect(await fold()).toEqual({ folded: 0, renamed: 0 })
	})
})
