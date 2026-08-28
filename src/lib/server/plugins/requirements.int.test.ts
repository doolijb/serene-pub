/**
 * Install-time requirement enforcement (24 §10, T7b): the instance is the
 * authority on whether a package's `requires` exist — published specs
 * satisfy spec references, a published create pipeline's input lock
 * satisfies its genre's reference, and anything else refuses by name.
 */
import { beforeAll, describe, expect, test, vi } from "vitest"
import { createTestDb, type TestDb } from "$lib/server/utils/testDb"

vi.mock("$lib/server/embedding", () => ({
	isModelReady: () => false,
	getLoadedModelId: () => null,
	embed: async () => [],
	batchEmbed: async () => []
}))

let db: TestDb

beforeAll(async () => {
	db = await createTestDb()
	const { bootstrapPipelines } = await import(
		"$lib/server/pipelines/boot/bootstrap"
	)
	await bootstrapPipelines(db as any)
}, 120_000)

describe("missingRequirements", () => {
	test("published specs and genres satisfy; the absent refuse by name", async () => {
		const { missingRequirements } = await import("./requirements")
		expect(
			await missingRequirements(db as any, [
				"core:spec/respond",
				"core:genre/chat",
				"core:spec/create-chat"
			])
		).toEqual([])
		expect(
			await missingRequirements(db as any, [
				"core:genre/chat",
				"acme.dice:spec/roll",
				"acme.dice:genre/board"
			])
		).toEqual(["acme.dice:spec/roll", "acme.dice:genre/board"])
	}, 60_000)

	test("requirementsOf reads the manifest field defensively", async () => {
		const { requirementsOf } = await import("./requirements")
		expect(requirementsOf({ requires: ["a", 1, "b"] })).toEqual(["a", "b"])
		expect(requirementsOf({})).toEqual([])
		expect(requirementsOf(null)).toEqual([])
	})
})
