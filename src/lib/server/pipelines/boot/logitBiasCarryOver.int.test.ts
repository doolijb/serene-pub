/**
 * Stored legacy `logitBias` values become logit bias entries at boot — only
 * that key, only when it reads, and a second boot changes nothing.
 */
import { beforeAll, describe, expect, it } from "vitest"
import { eq } from "drizzle-orm"
import * as schema from "$lib/server/db/schema"
import { createTestDb, type TestDb } from "$lib/server/utils/testDb"
import { carryOverLogitBiasEntries } from "./logitBiasCarryOver"

const T = 60_000

let db: TestDb
const ids: Record<string, number> = {}

const valuesOf = async (name: string) =>
	(
		await db
			.select()
			.from(schema.samplingConfigs)
			.where(eq(schema.samplingConfigs.id, ids[name]))
	)[0]

beforeAll(async () => {
	db = await createTestDb()
	const rows: (typeof schema.samplingConfigs.$inferInsert)[] = [
		{
			name: "legacy object",
			values: { temperature: 0.7, logitBias: { "123": 5, "456": -100 } },
			enabled: ["temperature", "logitBias"]
		},
		{
			name: "legacy string",
			values: { logitBias: '{"7": 1.5}' },
			enabled: []
		},
		{ name: "old default", values: { logitBias: {} }, enabled: [] },
		{
			name: "entries",
			values: { logitBias: [{ text: "hmm", value: -2 }] },
			enabled: ["logitBias"]
		},
		{
			name: "unreadable",
			values: { logitBias: "not json {" },
			enabled: []
		},
		{ name: "none", values: { temperature: 1 }, enabled: [] }
	]
	for (const row of rows) {
		const [inserted] = await db
			.insert(schema.samplingConfigs)
			.values(row)
			.returning()
		ids[row.name] = inserted.id
	}
}, T)

describe("carryOverLogitBiasEntries", () => {
	it(
		"rewrites legacy values into entries and touches nothing else",
		async () => {
			const before = await valuesOf("entries")
			expect(await carryOverLogitBiasEntries(db as unknown as Db)).toBe(3)

			const legacy = await valuesOf("legacy object")
			expect(legacy.values).toEqual({
				temperature: 0.7,
				logitBias: [
					{ text: "[123]", value: 5 },
					{ text: "[456]", value: -100 }
				]
			})
			expect(legacy.enabled).toEqual(["temperature", "logitBias"])
			expect((await valuesOf("legacy string")).values).toEqual({
				logitBias: [{ text: "[7]", value: 1.5 }]
			})
			// The person's stored empty object, never the shipped default list.
			expect((await valuesOf("old default")).values).toEqual({
				logitBias: []
			})
			expect(await valuesOf("entries")).toEqual(before)
			expect((await valuesOf("unreadable")).values).toEqual({
				logitBias: "not json {"
			})
			expect((await valuesOf("none")).values).toEqual({ temperature: 1 })
		},
		T
	)

	it(
		"a second boot changes nothing",
		async () => {
			const snapshot = await db.select().from(schema.samplingConfigs)
			expect(await carryOverLogitBiasEntries(db as unknown as Db)).toBe(0)
			expect(await db.select().from(schema.samplingConfigs)).toEqual(
				snapshot
			)
		},
		T
	)
})
