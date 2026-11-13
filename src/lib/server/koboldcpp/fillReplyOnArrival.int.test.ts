/**
 * The server fills Reply when a downloaded text model lands and Reply is
 * empty — never over a pair somebody chose, never with a model that cannot
 * reply. Real PGlite: the judge (`starRefusal`) and the write are database
 * behaviour.
 *
 * The race tests hold the fill at the entry of its write (`hold.beforeWrite`,
 * a one-shot wrapper around `setCapabilityDefault`): that is the moment after
 * "Reply is empty" was read, where a person's Use in Reply could land.
 */

import { beforeAll, describe, expect, it, vi } from "vitest"
import { createTestDb, type TestDb } from "$lib/server/utils/testDb"
import * as schema from "$lib/server/db/schema"
import {
	capabilityDefault,
	setCapabilityDefault
} from "$lib/server/connections/capabilityDefaults"
import { ensureManagedKoboldCppEndpoint } from "./managedEndpoint"
import { fillReplyIfEmpty } from "./fillReplyOnArrival"

const hold = vi.hoisted(() => ({
	beforeWrite: null as null | (() => Promise<void>)
}))
vi.mock(
	"$lib/server/connections/capabilityDefaults",
	async (importOriginal) => {
		const real =
			await importOriginal<
				typeof import("$lib/server/connections/capabilityDefaults")
			>()
		return {
			...real,
			setCapabilityDefault: async (
				...args: Parameters<typeof real.setCapabilityDefault>
			) => {
				const wait = hold.beforeWrite
				hold.beforeWrite = null
				if (wait) await wait()
				return real.setCapabilityDefault(...args)
			}
		}
	}
)

vi.mock("$lib/server/embedding", () => ({
	isModelReady: () => false,
	getLoadedModelId: () => null,
	embed: async () => [],
	batchEmbed: async () => []
}))

let db: TestDb
let endpointId: number

beforeAll(async () => {
	db = await createTestDb()
	endpointId = (
		await ensureManagedKoboldCppEndpoint(db, "http://localhost:5001")
	).id
}, 120_000)

async function model(filename: string, modality: string) {
	const [row] = await db
		.insert(schema.connectionModels)
		.values({
			connectionId: endpointId,
			model: filename,
			name: filename,
			modality
		} as InsertConnectionModel)
		.returning()
	return row
}

const reply = async () =>
	(await capabilityDefault(db, "text->text"))?.connectionId

describe("fillReplyIfEmpty", () => {
	it("fills an empty Reply with the arriving text model", async () => {
		const m = await model("gemma.gguf", "text-gen")
		const res = await fillReplyIfEmpty(db, "gemma.gguf")
		expect(res).toEqual({
			connectionId: endpointId,
			connectionModelId: m.id,
			name: "gemma.gguf"
		})
		const now = await capabilityDefault(db, "text->text")
		expect(now?.connectionId).toBe(endpointId)
		expect(now?.connectionModelId).toBe(m.id)
	}, 60_000)

	it("never overwrites a pair that is already set", async () => {
		const before = await capabilityDefault(db, "text->text")
		await model("qwen.gguf", "text-gen")
		expect(await fillReplyIfEmpty(db, "qwen.gguf")).toBeNull()
		const after = await capabilityDefault(db, "text->text")
		expect(after?.connectionModelId).toBe(before?.connectionModelId)
	}, 60_000)

	describe("with Reply empty again", () => {
		it("does not fill with an embeddings model", async () => {
			await setCapabilityDefault(db, "text->text", {
				connectionId: null,
				connectionModelId: null
			})
			await model("embed.gguf", "embeddings")
			expect(await fillReplyIfEmpty(db, "embed.gguf")).toBeNull()
			expect(await reply()).toBeNull()
		}, 60_000)

		it("does nothing for a file with no model row", async () => {
			expect(await fillReplyIfEmpty(db, "nothing.gguf")).toBeNull()
			expect(await reply()).toBeNull()
		}, 60_000)
	})

	describe("racing a person's choice", () => {
		const clearReply = () =>
			setCapabilityDefault(db, "text->text", {
				connectionId: null,
				connectionModelId: null
			})

		it("keeps a Use in Reply that lands between the read and the write", async () => {
			await clearReply()
			const arriving = await model("arriving.gguf", "text-gen")
			const chosen = await model("chosen.gguf", "text-gen")

			let reached!: () => void
			const atWrite = new Promise<void>((r) => (reached = r))
			let chose!: () => void
			const choiceDone = new Promise<void>((r) => (chose = r))
			// The fill pauses at its write until the choice is stored, or
			// briefly when the choice cannot be stored until the fill commits.
			hold.beforeWrite = async () => {
				reached()
				await Promise.race([
					choiceDone,
					new Promise((r) => setTimeout(r, 300))
				])
			}

			const fill = fillReplyIfEmpty(db, "arriving.gguf")
			await atWrite
			const choice = setCapabilityDefault(db, "text->text", {
				connectionId: endpointId,
				connectionModelId: chosen.id
			}).then(chose)
			await Promise.all([fill, choice])

			const now = await capabilityDefault(db, "text->text")
			expect(now?.connectionModelId).toBe(chosen.id)
			expect(now?.connectionModelId).not.toBe(arriving.id)
		}, 60_000)

		it("two fills fired at once set exactly one model", async () => {
			await clearReply()
			const a = await model("first.gguf", "text-gen")
			const b = await model("second.gguf", "text-gen")

			const results = await Promise.all([
				fillReplyIfEmpty(db, "first.gguf"),
				fillReplyIfEmpty(db, "second.gguf")
			])
			const filled = results.filter((r) => r != null)
			expect(filled).toHaveLength(1)
			expect([a.id, b.id]).toContain(filled[0]!.connectionModelId)
			const now = await capabilityDefault(db, "text->text")
			expect(now?.connectionModelId).toBe(filled[0]!.connectionModelId)
		}, 60_000)
	})
})
