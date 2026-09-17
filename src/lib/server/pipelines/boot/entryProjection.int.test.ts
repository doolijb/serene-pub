/**
 * A declared schema becoming a database constraint (Part 1).
 *
 * The claim under test is the one the generic entry table was accepted on: that
 * "history requires a year" is enforced by **Postgres**, not by the SDK. So the
 * central test writes straight to the table with `db.execute` — no socket
 * handler, no validator, no application layer of any kind — because a constraint
 * that only holds when the app is well-behaved is not a constraint, and a
 * local-first app has many write paths: sync, import, undo, migration replay,
 * scripts.
 *
 * The other half is the discipline around it. A constraint is added `NOT VALID`
 * and validated separately, so that boot against rows a new declaration would
 * reject **succeeds** and reports them, rather than refusing to start.
 */
import { beforeAll, describe, expect, it } from "vitest"
import { sql, eq, and } from "drizzle-orm"
import * as schema from "$lib/server/db/schema"
import {
	createTestDb,
	createTestUser,
	type TestDb
} from "$lib/server/utils/testDb"
import { syncDefinitionRegistry } from "$lib/server/pipelines/boot/registrySync"
import {
	auditEntryConstraints,
	entryCheckExpression,
	entryConstraintName,
	entryIndexFields,
	entryIndexName,
	projectEntryConstraints,
	readProjectedEntryTypes
} from "$lib/server/pipelines/boot/entryProjection"
import { allEntryTypes } from "@serene-pub/sdk"
import "@serene-pub/core-catalog"

const HISTORY = "core:entry/history"
const WORLD = "core:entry/world-lore"
const HISTORY_CHECK = entryConstraintName(HISTORY, 1)

let db: TestDb
let lorebookId: number

/** The row the audit has to find, and the reason boot must not refuse. */
let violatingId: number

const rowsOf = (res: any): any[] => res?.rows ?? res ?? []

const constraints = async (): Promise<Map<string, boolean>> => {
	const res = await db.execute(sql`
		SELECT "conname", "convalidated" FROM "pg_constraint"
		WHERE "conrelid" = 'lorebook_entries'::regclass AND "contype" = 'c'
		ORDER BY "conname"`)
	return new Map(
		rowsOf(res).map((r) => [String(r.conname), !!r.convalidated])
	)
}

const indexes = async (): Promise<string[]> => {
	const res = await db.execute(sql`
		SELECT "indexname" FROM "pg_indexes"
		WHERE "tablename" = 'lorebook_entries' ORDER BY "indexname"`)
	return rowsOf(res).map((r) => String(r.indexname))
}

beforeAll(async () => {
	db = await createTestDb()
	const user = await createTestUser(db)
	const [book] = await db
		.insert(schema.lorebooks)
		.values({ name: "Ashguard", userId: user.id })
		.returning()
	lorebookId = book.id

	// The boot chain's own order: the registry first, the projection after it.
	await syncDefinitionRegistry(db, allEntryTypes(), { release: "0.6.0" })

	// A history entry with no year, written *before* the constraint exists —
	// which is exactly the situation NOT VALID is for: a real install may
	// already hold rows a newly-declared schema rejects.
	const [bad] = await db
		.insert(schema.lorebookEntries)
		.values({
			lorebookId,
			typeId: HISTORY,
			typeVersion: 1,
			position: 1,
			content: "Undated.",
			fields: { graphed: false }
		})
		.returning()
	violatingId = bad.id
}, 60_000)

// ── The pure derivation ─────────────────────────────────────────────────────

describe("what a declaration projects", () => {
	it("projects required, type, range and enum — the T1 declarative subset", () => {
		const expr = entryCheckExpression("x:entry/t", 1, {
			year: { type: "integer", required: true, min: 1, max: 9999 },
			mood: { type: "enum", of: ["calm", "wary"] },
			note: { type: "string" }
		})!
		expect(expr).toContain(`"type_id" <> 'x:entry/t'`)
		expect(expr).toContain(`"type_version" <> 1`)
		expect(expr).toContain(`"fields" ? 'year'`)
		expect(expr).toContain(`jsonb_typeof("fields"->'year') = 'number'`)
		expect(expr).toContain(`>= 1`)
		expect(expr).toContain(`<= 9999`)
		expect(expr).toContain(`IN ('calm', 'wary')`)
		expect(expr).toContain(`jsonb_typeof("fields"->'note') = 'string'`)
	})

	it("does NOT project T2 predicates — they depend on state a row cannot see", () => {
		// `requiredWhen` is a fact about a *form's other answers*, and a CHECK
		// constraint sees one row. Projecting it would reject writes that are
		// correct.
		const expr = entryCheckExpression("x:entry/t", 1, {
			mode: { type: "enum", of: ["a", "b"] },
			detail: {
				type: "string",
				showIf: { field: "mode", equals: "a" },
				requiredWhen: { field: "mode", equals: "a" },
				visibleWhen: { field: "mode", equals: "a" },
				enabledWhen: { field: "mode", equals: "a" }
			}
		} as any)!
		expect(expr).not.toMatch(/showIf|requiredWhen|visibleWhen|enabledWhen/)
		// The exact claim, stated as an identity: the same declaration with the
		// four predicates stripped projects the *same* SQL. So they contribute
		// nothing — not a weakened constraint, not a constraint at all.
		expect(expr).toBe(
			entryCheckExpression("x:entry/t", 1, {
				mode: { type: "enum", of: ["a", "b"] },
				detail: { type: "string" }
			} as any)
		)
		// `detail` still gets its *type* checked — the T1 half of the same
		// declaration is unaffected by the T2 half being ignored.
		expect(expr).toContain(`jsonb_typeof("fields"->'detail') = 'string'`)
	})

	it("returns null when a declaration constrains nothing", () => {
		expect(entryCheckExpression("x:entry/t", 1, {})).toBeNull()
		expect(entryCheckExpression("x:entry/t", 1, null)).toBeNull()
		// Flags alone are for the index projection, not the constraint one.
		expect(
			entryCheckExpression("x:entry/t", 1, {
				k: { queryable: true, sortable: true }
			} as any)
		).toBeNull()
	})

	it("guards every range and enum test with CASE, not AND", () => {
		// Postgres does not promise the evaluation order of AND operands, so
		// `jsonb_typeof(x)='number' AND x::numeric >= 1` may attempt the cast on
		// a string and raise instead of returning false. CASE does promise it.
		const expr = entryCheckExpression("x:entry/t", 1, {
			n: { type: "integer", min: 0 }
		})!
		expect(expr).toContain("CASE WHEN")
	})

	it("indexes what is queryable or sortable, and nothing else", () => {
		expect(
			entryIndexFields({
				a: { type: "string", queryable: true },
				b: { type: "integer", sortable: true },
				c: { type: "boolean", queryable: false, sortable: false },
				d: { type: "string" }
			} as any)
		).toEqual(["a", "b"])
	})

	it("names a constraint by type and version, so a bump is a new name", () => {
		expect(entryConstraintName(HISTORY, 1)).toBe(
			"entry_fields__core_entry_history__v1"
		)
		expect(entryConstraintName(HISTORY, 2)).toBe(
			"entry_fields__core_entry_history__v2"
		)
		expect(entryIndexName(HISTORY, 1, "year")).toBe(
			"entry_field__core_entry_history__year__v1"
		)
	})

	it("keeps a name inside Postgres' 63-byte identifier limit", () => {
		// Past 63 bytes Postgres truncates silently, which would let two long
		// type ids collapse onto one name — and the reconciler drops by name.
		const long = `core:entry/${"x".repeat(120)}`
		const a = entryConstraintName(long, 1)
		const b = entryConstraintName(`${long}y`, 1)
		expect(a.length).toBeLessThanOrEqual(63)
		expect(b.length).toBeLessThanOrEqual(63)
		expect(a).not.toBe(b)
	})
})

// ── The boot step ───────────────────────────────────────────────────────────

describe("projecting core's three types", () => {
	it("boots against a violating row rather than refusing, and lists it", async () => {
		const report = await projectEntryConstraints(db)
		expect(report.errors).toEqual([])
		expect(report.constraints.added).toContain(HISTORY_CHECK)

		// The audit is what makes the constraint actionable — a constraint with
		// no way to see what violates it is worse than none.
		const v = report.violations.find((x) => x.constraint === HISTORY_CHECK)
		expect(v).toBeTruthy()
		expect(v!.typeId).toBe(HISTORY)
		expect(v!.entryIds).toContain(violatingId)

		// Added, but deliberately not validated: existing rows are never
		// destroyed by a declaration change.
		expect(report.constraints.pending).toContain(HISTORY_CHECK)
		expect(report.constraints.validated).not.toContain(HISTORY_CHECK)
		expect((await constraints()).get(HISTORY_CHECK)).toBe(false)
	})

	it("validates the constraints nothing violates", async () => {
		// World lore declares an optional category and a 1–3 priority; no row
		// here breaks either, so its constraint is validated on the same pass.
		const world = entryConstraintName(WORLD, 1)
		expect((await constraints()).get(world)).toBe(true)
	})

	it("projects an index for every queryable or sortable field", async () => {
		const present = await indexes()
		// history: year, month, day and graphed are queryable; isCompleted is
		// declared queryable: false and must not appear.
		for (const f of ["year", "month", "day", "graphed"])
			expect(present).toContain(entryIndexName(HISTORY, 1, f))
		expect(present).not.toContain(entryIndexName(HISTORY, 1, "isCompleted"))
		// world lore: category and priority.
		expect(present).toContain(entryIndexName(WORLD, 1, "category"))
		expect(present).toContain(entryIndexName(WORLD, 1, "priority"))
	})

	it("is idempotent, so it rides the unconditional boot chain", async () => {
		const before = await constraints()
		const report = await projectEntryConstraints(db)
		expect(report.errors).toEqual([])
		expect(report.constraints.added).toEqual([])
		expect(report.constraints.dropped).toEqual([])
		expect(report.indexes.added).toEqual([])
		expect(report.indexes.dropped).toEqual([])
		expect(await constraints()).toEqual(before)
	})

	it("validates the type reference once the registry is in step", async () => {
		// The migration left it NOT VALID because migrations run *before*
		// `syncDefinitionRegistry`; this is the other end of that cycle.
		const res = await db.execute(sql`
			SELECT "convalidated" FROM "pg_constraint"
			WHERE "conrelid" = 'lorebook_entries'::regclass
			  AND "conname" = 'lorebook_entries_type_fk'`)
		expect(rowsOf(res)[0].convalidated).toBe(true)
	})
})

describe("the constraint against a direct write", () => {
	it("rejects a missing required field on an insert that bypasses every application layer", async () => {
		// The entire point. No socket handler, no validator — raw SQL.
		await expect(
			db.execute(sql`
				INSERT INTO "lorebook_entries"
					("lorebook_id","type_id","type_version","position","fields")
				VALUES (${lorebookId}, ${HISTORY}, 1, 500, '{"graphed": false}'::jsonb)`)
		).rejects.toThrow(/entry_fields__core_entry_history__v1/)
	})

	it("rejects a wrongly-typed field", async () => {
		await expect(
			db.execute(sql`
				INSERT INTO "lorebook_entries"
					("lorebook_id","type_id","type_version","position","fields")
				VALUES (${lorebookId}, ${HISTORY}, 1, 501, '{"year": "410"}'::jsonb)`)
		).rejects.toThrow(/entry_fields__core_entry_history__v1/)
	})

	it("rejects an out-of-range value", async () => {
		await expect(
			db.execute(sql`
				INSERT INTO "lorebook_entries"
					("lorebook_id","type_id","type_version","position","fields")
				VALUES (${lorebookId}, ${HISTORY}, 1, 502, '{"year": 1, "month": 13}'::jsonb)`)
		).rejects.toThrow(/entry_fields__core_entry_history__v1/)
	})

	it("accepts a row that satisfies the declaration", async () => {
		await db.execute(sql`
			INSERT INTO "lorebook_entries"
				("lorebook_id","type_id","type_version","position","fields")
			VALUES (${lorebookId}, ${HISTORY}, 1, 503, '{"year": 410, "month": 6}'::jsonb)`)
		const [row] = await db
			.select()
			.from(schema.lorebookEntries)
			.where(
				and(
					eq(schema.lorebookEntries.lorebookId, lorebookId),
					eq(schema.lorebookEntries.position, 503)
				)
			)
		expect(row.fields).toEqual({ year: 410, month: 6 })
		await db
			.delete(schema.lorebookEntries)
			.where(eq(schema.lorebookEntries.id, row.id))
	})

	it("leaves another type's rows alone — the guard is on the discriminator", async () => {
		// World lore has no `year` and must not acquire one by living in the
		// same table.
		await db.execute(sql`
			INSERT INTO "lorebook_entries"
				("lorebook_id","type_id","type_version","position","fields")
			VALUES (${lorebookId}, ${WORLD}, 1, 504, '{}'::jsonb)`)
		const [row] = await db
			.select()
			.from(schema.lorebookEntries)
			.where(
				and(
					eq(schema.lorebookEntries.lorebookId, lorebookId),
					eq(schema.lorebookEntries.position, 504)
				)
			)
		expect(row).toBeTruthy()
		await db
			.delete(schema.lorebookEntries)
			.where(eq(schema.lorebookEntries.id, row.id))
	})
})

describe("repairing what the audit found", () => {
	it("validates on the next boot once the violating row is fixed", async () => {
		expect((await constraints()).get(HISTORY_CHECK)).toBe(false)
		expect(await auditEntryConstraints(db)).not.toEqual([])

		// ⚠ Merge, never replace. `graphed` is machine-written and this write is
		// a repair of a different key on the same row.
		await db.execute(sql`
			UPDATE "lorebook_entries" SET "fields" = "fields" || '{"year": 1}'::jsonb
			WHERE "id" = ${violatingId}`)

		expect(await auditEntryConstraints(db)).toEqual([])
		const report = await projectEntryConstraints(db)
		expect(report.errors).toEqual([])
		expect(report.violations).toEqual([])
		expect(report.constraints.validated).toContain(HISTORY_CHECK)
		expect((await constraints()).get(HISTORY_CHECK)).toBe(true)

		// And the merge kept the other writer's value.
		const [row] = await db
			.select()
			.from(schema.lorebookEntries)
			.where(eq(schema.lorebookEntries.id, violatingId))
		expect(row.fields).toEqual({ year: 1, graphed: false })
	})
})

describe("a version bump", () => {
	// A synthetic type, so the bump can be exercised without republishing one
	// of core's — `syncDefinitionRegistry` freezes those by design, and this is about
	// the projection rather than about the freeze rule.
	const SYNTH = "core:entry/synthetic-probe"

	it("adds the new version's constraint and leaves the others untouched", async () => {
		await db.insert(schema.pipelineDefinitionRegistry).values({
			definitionId: SYNTH,
			version: 1,
			kind: "entry",
			configSchema: {
				alpha: { type: "integer", required: true, queryable: true }
			}
		})
		const report = await projectEntryConstraints(db)
		expect(report.errors).toEqual([])
		expect(report.constraints.added).toEqual([
			entryConstraintName(SYNTH, 1)
		])
		expect(report.indexes.added).toEqual([
			entryIndexName(SYNTH, 1, "alpha")
		])
		// Core's stay exactly as they were.
		expect((await constraints()).get(HISTORY_CHECK)).toBe(true)

		await db.insert(schema.pipelineDefinitionRegistry).values({
			definitionId: SYNTH,
			version: 2,
			kind: "entry",
			configSchema: {
				alpha: { type: "integer", required: true, queryable: true },
				// T2: required only when another answer says so. A row cannot
				// see that answer, so nothing about it may reach the database.
				gamma: {
					type: "string",
					requiredWhen: { field: "alpha", equals: 1 }
				}
			}
		})
		const bumped = await projectEntryConstraints(db)
		expect(bumped.constraints.added).toEqual([
			entryConstraintName(SYNTH, 2)
		])
		expect(bumped.constraints.dropped).toEqual([])
		// Both live: an older version stays in place for the rows still
		// carrying it.
		const now = await constraints()
		expect(now.has(entryConstraintName(SYNTH, 1))).toBe(true)
		expect(now.has(entryConstraintName(SYNTH, 2))).toBe(true)
		expect(now.get(HISTORY_CHECK)).toBe(true)
	})

	it("does not make a requiredWhen field required in the database", async () => {
		// The T2 exclusion, proved where it matters: a direct insert omitting
		// `gamma` is accepted, and one omitting the genuinely-required `alpha`
		// is not.
		await db.execute(sql`
			INSERT INTO "lorebook_entries"
				("lorebook_id","type_id","type_version","position","fields")
			VALUES (${lorebookId}, ${SYNTH}, 2, 600, '{"alpha": 1}'::jsonb)`)
		await expect(
			db.execute(sql`
				INSERT INTO "lorebook_entries"
					("lorebook_id","type_id","type_version","position","fields")
				VALUES (${lorebookId}, ${SYNTH}, 2, 601, '{"gamma": "x"}'::jsonb)`)
		).rejects.toThrow(new RegExp(entryConstraintName(SYNTH, 2)))

		// Cleared before the registry rows go, or the type reference blocks
		// their deletion — which is itself the constraint doing its job.
		await db
			.delete(schema.lorebookEntries)
			.where(eq(schema.lorebookEntries.typeId, SYNTH))
	})

	it("drops a constraint whose type version is gone, and only that one", async () => {
		await db
			.delete(schema.pipelineDefinitionRegistry)
			.where(
				and(
					eq(schema.pipelineDefinitionRegistry.definitionId, SYNTH),
					eq(schema.pipelineDefinitionRegistry.version, 1)
				)
			)
		const report = await projectEntryConstraints(db)
		expect(report.constraints.dropped).toEqual([
			entryConstraintName(SYNTH, 1)
		])
		expect(report.indexes.dropped).toEqual([
			entryIndexName(SYNTH, 1, "alpha")
		])
		const now = await constraints()
		expect(now.has(entryConstraintName(SYNTH, 1))).toBe(false)
		expect(now.has(entryConstraintName(SYNTH, 2))).toBe(true)
		// Core's three are exactly where they were.
		expect(now.get(HISTORY_CHECK)).toBe(true)
		expect(now.get(entryConstraintName(WORLD, 1))).toBe(true)
	})

	it("reports a row it cannot project rather than skipping it quietly", async () => {
		// A declared constraint that silently fails to project is the failure
		// mode this whole design keeps naming. The id below cannot come out of
		// `describeEntryType` — it is what a hand-edited row looks like — and
		// the point is that it is *said*, not that it is handled.
		await db.insert(schema.pipelineDefinitionRegistry).values({
			definitionId: "core:entry/has a space",
			version: 1,
			kind: "entry",
			configSchema: { alpha: { type: "integer", required: true } }
		})
		const report = await projectEntryConstraints(db)
		expect(report.errors.join("\n")).toMatch(
			/core:entry\/has a space@1.*grammar forbids/
		)
		// …and it projected nothing for it, rather than a constraint under a
		// name another type could fold onto.
		expect(report.constraints.added).toEqual([])
		await db
			.delete(schema.pipelineDefinitionRegistry)
			.where(
				eq(schema.pipelineDefinitionRegistry.definitionId, "core:entry/has a space")
			)
	})

	it("reads the registry rows, not the in-process declaration map", async () => {
		// The synthetic type exists only as a row — it was never declared to the
		// SDK — and the projection found it. That is F6: the rows are the system
		// of record, and a `transport: 'process'` type has no descriptor here.
		const types = await readProjectedEntryTypes(db)
		expect(types.map((t) => `${t.typeId}@${t.version}`)).toContain(
			`${SYNTH}@2`
		)
		expect(allEntryTypes().map((t) => t.id)).not.toContain(SYNTH)

		// Clean up, so nothing after this file reads a doctored registry.
		await db
			.delete(schema.pipelineDefinitionRegistry)
			.where(eq(schema.pipelineDefinitionRegistry.definitionId, SYNTH))
		await projectEntryConstraints(db)
	})
})

/**
 * The position rule — plain, and enforced at every instant.
 *
 * An earlier lane made `lorebook_entries_position_uq` `DEFERRABLE INITIALLY
 * DEFERRED` from *here*, because a renumber is a permutation and Drizzle's
 * builder cannot say `DEFERRABLE`. That was rejected: `schema.ts` would have
 * described a table that was not the table, every `db:generate` would have kept
 * emitting the plain form, and this projector would have kept patching it
 * forever. The need was removed instead — every renumber parks its rows in a
 * free range and places them afterwards (`parkingFloor`).
 *
 * So these two pin the *absence* of the workaround: the constraint is plain,
 * and the naive single-statement shift it existed to permit is refused. If
 * somebody reinstates deferrability, the first fails; if somebody "simplifies"
 * a renumber back to a straight rewrite, the second is the reason it cannot.
 */
describe("the position constraint", () => {
	// Explicit rather than inherited from an earlier test in this file: the
	// claim is about the state *the projector* leaves behind, so it runs here.
	beforeAll(async () => {
		await projectEntryConstraints(db)
	})

	const deferrable = async () => {
		const res: any = await db.execute(
			sql`SELECT "condeferrable", "condeferred" FROM "pg_constraint"
				WHERE "conrelid" = 'lorebook_entries'::regclass
				  AND "conname" = 'lorebook_entries_position_uq'`
		)
		return (res.rows ?? res)[0]
	}

	it("is left non-deferrable by the projector", async () => {
		const row = await deferrable()
		expect(row, "the constraint should exist").toBeTruthy()
		expect(row.condeferrable).toBe(false)
		expect(row.condeferred).toBe(false)
	})

	it("rejects a straight `position + 1` over a run, mid-statement", async () => {
		const mk = async (position: number) => {
			const [row] = await db
				.insert(schema.lorebookEntries)
				.values({
					lorebookId,
					typeId: WORLD,
					typeVersion: 1,
					position,
					content: `renumber-${position}`,
					fields: {}
				})
				.returning()
			return row
		}
		const a = await mk(9001)
		const b = await mk(9002)

		// The whole reason a renumber has to be staged. The finished state
		// (9002, 9003) is perfectly unique; the statement still cannot get
		// there, because a is written onto b's slot before b vacates it.
		await expect(
			db.transaction(async (tx) => {
				await tx
					.update(schema.lorebookEntries)
					.set({
						position: sql`${schema.lorebookEntries.position} + 1`
					})
					.where(
						and(
							eq(schema.lorebookEntries.lorebookId, lorebookId),
							eq(schema.lorebookEntries.typeId, WORLD),
							sql`${schema.lorebookEntries.position} >= 9001`
						)
					)
			})
		).rejects.toThrow(/lorebook_entries_position_uq|duplicate key/i)

		// Unchanged: the transaction rolled back, it did not half-apply.
		const after = await db
			.select()
			.from(schema.lorebookEntries)
			.where(sql`${schema.lorebookEntries.position} >= 9001`)
		const byId = new Map(after.map((r) => [r.id, r.position]))
		expect(byId.get(a.id)).toBe(9001)
		expect(byId.get(b.id)).toBe(9002)

		await db
			.delete(schema.lorebookEntries)
			.where(sql`${schema.lorebookEntries.position} >= 9001`)
	})
})
