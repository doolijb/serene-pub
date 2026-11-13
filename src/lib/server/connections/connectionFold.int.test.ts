/**
 * The connection fold drops a row that would break a unique key the target
 * already holds, then repoints the rest. The target's row wins.
 */
import { beforeEach, describe, expect, it, vi } from "vitest"
import { eq, sql } from "drizzle-orm"
import { integer, pgTable, text, uniqueIndex } from "drizzle-orm/pg-core"
import { createTestDb, type TestDb } from "$lib/server/utils/testDb"
import * as schema from "$lib/server/db/schema"
import { CONNECTION_TYPE } from "$lib/shared/constants/ConnectionTypes"
import { defaultLoadoutRow } from "$lib/server/loadouts/testing"
import { foldConnectionInto, uniqueKeysWith } from "./connectionFold"

let db: TestDb

beforeEach(async () => {
	db = await createTestDb()
}, 60_000)

async function connection() {
	const [row] = await db
		.insert(schema.connections)
		.values({
			name: `fixture ${Math.random()}`,
			type: CONNECTION_TYPE.KOBOLDCPP_MANAGED,
			baseUrl: "http://localhost:5001",
			extraJson: {},
			capabilities: {}
		} as any)
		.returning()
	return row
}

const bias = (
	connectionId: number,
	tokenizedText: string,
	tokenIds: number[]
) =>
	db.insert(schema.logitBiasTokens).values({
		connectionId,
		model: "m",
		tokenizerFingerprint: "fp",
		tokenizedText,
		tokenIds
	})

async function script(name: string) {
	const [row] = await db
		.insert(schema.pipelineScripts)
		.values({ typeId: "core:script:text/stop@1", name })
		.returning()
	return row
}

const names = (columns: { name: string }[]) => columns.map((c) => c.name)

describe("foldConnectionInto drops colliding rows by unique key", () => {
	it("keeps the target's logit bias row and moves the rest", async () => {
		const source = await connection()
		const target = await connection()
		await bias(source.id, " hello", [1])
		await bias(source.id, " only-source", [2])
		await bias(target.id, " hello", [9, 9])

		const deletes: string[] = []
		await db.transaction(async (tx) => {
			const del = tx.delete.bind(tx)
			;(tx as any).delete = (table: unknown) => {
				const builder = (del as any)(table)
				const where = builder.where.bind(builder)
				builder.where = (condition: unknown) => {
					const query = where(condition)
					deletes.push(query.toSQL().sql)
					return query
				}
				return builder
			}
			await foldConnectionInto(tx as any, source, target)
		})

		const rows = await db.select().from(schema.logitBiasTokens)
		expect(rows).toHaveLength(2)
		expect(rows.every((r) => r.connectionId === target.id)).toBe(true)
		expect(
			rows.find((r) => r.tokenizedText === " hello")?.tokenIds
		).toEqual([9, 9])
		expect(
			rows.find((r) => r.tokenizedText === " only-source")?.tokenIds
		).toEqual([2])
		expect(
			await db
				.select()
				.from(schema.connections)
				.where(eq(schema.connections.id, source.id))
		).toEqual([])

		// Outer columns are qualified by the table, inner ones by the alias.
		const collision = deletes.find((q) =>
			q.includes('delete from "logit_bias_tokens"')
		)
		expect(collision).toContain('"fold_kept"."connection_id" = $')
		expect(collision).toContain(
			'"fold_kept"."tokenized_text" = "logit_bias_tokens"."tokenized_text"'
		)
	}, 60_000)

	it("keeps one connection_scripts row per script", async () => {
		const source = await connection()
		const target = await connection()
		const shared = await script("shared")
		const other = await script("other")
		await db.insert(schema.connectionScripts).values([
			{ connectionId: source.id, scriptId: shared.id },
			{ connectionId: source.id, scriptId: other.id },
			{ connectionId: target.id, scriptId: shared.id }
		])

		await db.transaction(async (tx) =>
			foldConnectionInto(tx as any, source, target)
		)

		const rows = await db.select().from(schema.connectionScripts)
		expect(rows.map((r) => [r.connectionId, r.scriptId]).sort()).toEqual(
			[
				[target.id, shared.id],
				[target.id, other.id]
			].sort()
		)
	}, 60_000)

	it("repoints a row whose table has no unique key on the column", async () => {
		const source = await connection()
		const target = await connection()
		await db.insert(schema.loadouts).values(
			defaultLoadoutRow({
				input: "text",
				output: "text",
				connectionId: source.id
			})
		)

		await db.transaction(async (tx) =>
			foldConnectionInto(tx as any, source, target)
		)

		const rows = await db.select().from(schema.loadouts)
		expect(rows).toHaveLength(1)
		expect(rows[0].connectionId).toBe(target.id)
	}, 60_000)
})

describe("uniqueKeysWith", () => {
	it("reads the real schema's unique keys", () => {
		const bias = uniqueKeysWith(
			schema.logitBiasTokens,
			schema.logitBiasTokens.connectionId
		)
		expect(bias).toHaveLength(1)
		expect(names(bias[0].others).sort()).toEqual([
			"model",
			"tokenized_text",
			"tokenizer_fingerprint"
		])
		expect(bias[0].nullsNotDistinct).toBe(false)

		const scripts = uniqueKeysWith(
			schema.connectionScripts,
			schema.connectionScripts.connectionId
		)
		expect(scripts.map((k) => names(k.others))).toEqual([["script_id"]])

		expect(
			uniqueKeysWith(schema.loadouts, schema.loadouts.connectionId)
		).toEqual([])
	})

	it("skips, and warns about, an expression index and a partial index", () => {
		const warn = vi.spyOn(console, "warn").mockImplementation(() => {})
		try {
			const expression = pgTable(
				"fake_expression",
				{
					connectionId: integer("connection_id"),
					label: text("label")
				},
				(t) => [
					uniqueIndex("fake_expr").on(
						sql`lower(${t.label})`,
						t.connectionId
					)
				]
			)
			expect(uniqueKeysWith(expression, expression.connectionId)).toEqual(
				[]
			)
			expect(warn).toHaveBeenCalledTimes(1)
			expect(String(warn.mock.calls[0][0])).toContain("fake_expression")

			warn.mockClear()
			const partial = pgTable(
				"fake_partial_table",
				{
					connectionId: integer("connection_id"),
					label: text("label")
				},
				(t) => [
					uniqueIndex("fake_partial")
						.on(t.connectionId, t.label)
						.where(sql`${t.label} is not null`)
				]
			)
			expect(uniqueKeysWith(partial, partial.connectionId)).toEqual([])
			expect(warn).toHaveBeenCalledTimes(1)
			expect(String(warn.mock.calls[0][0])).toContain(
				"fake_partial_table"
			)
		} finally {
			warn.mockRestore()
		}
	})
})
