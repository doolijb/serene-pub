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
	await bootstrapPipelines(db)
}, 120_000)

describe("missingRequirements", () => {
	test("published specs and genres satisfy; the absent refuse by name", async () => {
		const { missingRequirements } = await import("./requirements")
		expect(
			await missingRequirements(db, [
				"core:spec/story-respond",
				"core:genre/story",
				"core:spec/story-create"
			])
		).toEqual([])
		expect(
			await missingRequirements(db, [
				"core:genre/story",
				"acme.dice:spec/roll",
				"acme.dice:genre/board"
			])
		).toEqual(["acme.dice:spec/roll", "acme.dice:genre/board"])
	}, 60_000)

	test("a core event is checked against this build's own events", async () => {
		const { missingRequirements, missingRequirementsMessage } = await import(
			"./requirements"
		)
		const missing = await missingRequirements(db, [
			"core:event/message-respond@1",
			"core:event/session-created@1",
			"core:event/time-travel@1",
			"core:event/message-respond@2",
			"acme.dice:spec/roll"
		])
		expect(missing).toEqual([
			"core:event/time-travel@1",
			"core:event/message-respond@2",
			"acme.dice:spec/roll"
		])
		expect(missingRequirementsMessage("'acme.lab'", missing)).toBe(
			"'core:event/time-travel@1' is an event this version of Serene Pub does not have; the package needs a newer Serene Pub. " +
				"'core:event/message-respond@2' is an event this version of Serene Pub does not have; the package needs a newer Serene Pub. " +
				"'acme.lab' requires acme.dice:spec/roll — not installed on this pub. Install what it builds on first."
		)
	}, 60_000)

	test("requirementsOf reads the manifest field defensively", async () => {
		const { requirementsOf } = await import("./requirements")
		expect(requirementsOf({ requires: ["a", 1, "b"] })).toEqual(["a", "b"])
		expect(requirementsOf({})).toEqual([])
		expect(requirementsOf(null)).toEqual([])
	})
})
