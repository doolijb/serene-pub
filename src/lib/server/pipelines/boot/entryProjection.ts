/**
 * A declared schema becomes a database constraint (design Part 1).
 *
 * **This is the condition on which the generic entry table was chosen at all.**
 * `world_lore_entries.name` is `NOT NULL` in Postgres today. Under one typed
 * table, "history requires a year" would otherwise be enforced only by a schema
 * the SDK owns — which makes the SDK load-bearing for *data integrity*, and a
 * local-first app has many write paths: sync, import, undo, migration replay,
 * scripts. The projection means a declared schema **becomes** a database
 * constraint rather than replacing one, which is strictly better than the status
 * quo where DB constraints and SDK declarations are unrelated and can silently
 * disagree.
 *
 * ## What projects, and what deliberately does not
 *
 * Only the **T1 declarative subset**: `required`, `type`, `min`/`max`, and an
 * `enum`'s options. **T2 predicates — `showIf`, `requiredWhen`, `visibleWhen`,
 * `enabledWhen` — must not project.** They are UI-level and depend on state the
 * row does not carry: "required when the connection is local" is a fact about a
 * form's other answers, and a CHECK constraint sees one row. A predicate turned
 * into a constraint would reject writes that are correct.
 *
 * Indexes fall out of the *same* pass, from the `queryable` / `sortable` flags —
 * one reconciler reading one declaration. **The declaration says `queryable`;
 * the projection picks the strategy.** Leak "this is a column" into the
 * declaration and storage layout becomes a public contract.
 *
 * ## NOT VALID, then validate separately
 *
 * A constraint that failed at boot against a user's existing data would be
 * catastrophic for a local-first app — the app would simply stop starting, over
 * a declaration. So a constraint is added `NOT VALID`: **enforced for every new
 * write immediately, not applied retroactively.** The audit then says exactly
 * which rows violate it, and `VALIDATE CONSTRAINT` runs only once there are
 * none. New writes protected immediately; existing rows never destroyed by a
 * declaration change. This is the same principle as attribute config validity —
 * a declaration change governs new writes and never invalidates what was
 * legitimate when it was written.
 *
 * The audit ships in the same step as the constraints, and not as a follow-up:
 * a constraint with no way to see what violates it is worse than no constraint.
 *
 * ## Names are addresses
 *
 * `entry_fields__core_entry_history__v1` — prefix, type, version. The version is
 * in the name because a version bump is how a schema changes at all
 * (`config_schema` is inside `typeContentHash`, so `syncTypeRegistry` refuses to
 * republish a changed schema at the same version). A bump therefore appears as a
 * *new* name, and the reconciler below drops the old one because it is no longer
 * in the desired set. Other types' constraints are untouched by construction.
 *
 * ⚠ **Residue:** a constraint whose name is already correct is left alone. That
 * is safe for a schema change, which cannot happen without a version bump, but
 * it means fixing a bug *in this projector* does not re-derive existing
 * constraints — that needs a hand-written `ALTER TABLE … DROP CONSTRAINT` in a
 * migration, the same residue the config reconciler leaves (precedent: 0175,
 * 0180).
 *
 * ## Where it runs
 *
 * The boot chain, after `syncTypeRegistry`, and reading **rows rather than the
 * in-process declaration map** — the rows are the system of record (F3), and a
 * `transport: 'process'` type has no descriptor in this process at all (F6).
 */

import { createHash } from "node:crypto"
import { sql } from "drizzle-orm"
import { rawRows } from "$lib/server/db/rawRows"

/** The table everything here projects onto. */
const TABLE = "lorebook_entries"
/** Prefix for a projected CHECK. Disjoint from the index prefix below. */
const CHECK_PREFIX = "entry_fields__"
/** Prefix for a projected index. */
const INDEX_PREFIX = "entry_field__"
/**
 * The composite reference the migration added `NOT VALID`, because migrations
 * run before `syncTypeRegistry` and the registry rows the backfilled entries
 * point at did not exist yet. Same cycle as a CHECK: validate once clean.
 */
const TYPE_FK = "lorebook_entries_type_fk"

export interface EntryConstraintViolation {
	/** The constraint the rows would fail. */
	constraint: string
	typeId: string
	typeVersion: number
	/** How many rows violate it. */
	count: number
	/** The first few offenders, so a repair screen has somewhere to start. */
	entryIds: number[]
}

export interface EntryProjectionReport {
	constraints: {
		added: string[]
		dropped: string[]
		validated: string[]
		/** Added but still `NOT VALID` — existing rows violate them. */
		pending: string[]
	}
	indexes: { added: string[]; dropped: string[] }
	violations: EntryConstraintViolation[]
	/** Entries whose `(type_id, type_version)` names no registry row. */
	danglingTypeRefs: number
	/** Whether `lorebook_entries_type_fk` is validated after this run. */
	typeFkValidated: boolean
	/**
	 * Anything that went wrong, collected rather than thrown. Nothing in here
	 * may take the boot down: the whole point of `NOT VALID` is that a
	 * declaration cannot stop the application starting.
	 */
	errors: string[]
}

// ── Declaration → SQL ───────────────────────────────────────────────────────

/** A single-quoted SQL literal. Doubling is the whole escape rule for these. */
const lit = (s: string) => `'${s.replace(/'/g, "''")}'`

/**
 * Postgres silently truncates an identifier past 63 bytes, which would let two
 * long type ids collapse onto one name — and a reconciler that drops by name
 * would then drop the wrong thing. Hash the overflow instead.
 */
const capName = (name: string): string =>
	name.length <= 63
		? name
		: `${name.slice(0, 50)}_${createHash("sha1").update(name).digest("hex").slice(0, 12)}`

/** `core:entry/history` → `core_entry_history`. */
const slugOf = (typeId: string) =>
	typeId.replace(/[^A-Za-z0-9]+/g, "_").replace(/^_+|_+$/g, "")

export const entryConstraintName = (typeId: string, version: number) =>
	capName(`${CHECK_PREFIX}${slugOf(typeId)}__v${version}`)

export const entryIndexName = (
	typeId: string,
	version: number,
	field: string
) => capName(`${INDEX_PREFIX}${slugOf(typeId)}__${field}__v${version}`)

/**
 * What `jsonb_typeof` must return for a declared field type.
 *
 * `integer` and `number` share `'number'`: jsonb has one numeric type, and
 * asserting integrality would need a cast whose evaluation order Postgres does
 * not promise outside a `CASE`. Range is projected; whole-ness is not, and that
 * is the honest T1 subset rather than an oversight.
 */
const JSON_TYPE_OF: Record<string, string> = {
	string: "string",
	text: "string",
	secret: "string",
	enum: "string",
	media: "string",
	number: "number",
	integer: "number",
	boolean: "boolean",
	"string[]": "array",
	share: "object",
	perMember: "object",
	strengths: "object"
}

const SAFE_FIELD = /^[A-Za-z0-9_]+$/
const isFiniteNumber = (v: unknown): v is number =>
	typeof v === "number" && Number.isFinite(v)

/** An `enum`'s allowed values, from `of` or from `members`' keys. */
const enumOptions = (decl: any): string[] | null => {
	const from =
		(Array.isArray(decl?.of) && decl.of) ||
		(Array.isArray(decl?.members) && decl.members.map((m: any) => m?.key))
	if (!from) return null
	const opts = from.filter((v: unknown) => typeof v === "string") as string[]
	return opts.length ? opts : null
}

/**
 * The CHECK body for one type, or `null` when its declaration constrains
 * nothing.
 *
 * Guarded on the discriminator first, so the constraint is inert for every row
 * of every other type — which is what lets one table carry one constraint per
 * type without them interfering.
 *
 * Every conjunct past `required` is wrapped in a `CASE`, and that is
 * load-bearing rather than stylistic: Postgres does not promise the evaluation
 * order of `AND`/`OR` operands, so `jsonb_typeof(x) = 'number' AND x::numeric >=
 * 1` may attempt the cast on a string and raise instead of returning false.
 * `CASE` does promise it.
 */
export function entryCheckExpression(
	typeId: string,
	version: number,
	configSchema: Record<string, any> | null | undefined
): string | null {
	if (!configSchema || typeof configSchema !== "object") return null

	const conjuncts: string[] = []
	for (const [field, raw] of Object.entries(configSchema)) {
		const decl = raw as any
		if (!decl || typeof decl !== "object") continue
		if (!SAFE_FIELD.test(field)) continue
		const k = lit(field)
		const get = `"fields"->${k}`
		const present = `("fields" ? ${k} AND jsonb_typeof(${get}) <> 'null')`

		// `required` — and note what it must NOT read: `requiredWhen` is a T2
		// predicate over a form's other answers, and a row cannot see them.
		if (decl.required === true) conjuncts.push(present)

		const jsonType = JSON_TYPE_OF[decl.type]
		if (jsonType)
			conjuncts.push(
				`(CASE WHEN ${present} THEN jsonb_typeof(${get}) = ${lit(jsonType)} ELSE true END)`
			)

		// Range, on the two types where a range means anything. A `min` on a
		// string is a length in some systems and a value in others; the SDK
		// does not say, so it does not project.
		if (decl.type === "number" || decl.type === "integer") {
			const numeric = `(${get})::numeric`
			const guard = `jsonb_typeof(${get}) = 'number'`
			if (isFiniteNumber(decl.min))
				conjuncts.push(
					`(CASE WHEN ${guard} THEN ${numeric} >= ${decl.min} ELSE true END)`
				)
			if (isFiniteNumber(decl.max))
				conjuncts.push(
					`(CASE WHEN ${guard} THEN ${numeric} <= ${decl.max} ELSE true END)`
				)
		}

		if (decl.type === "enum") {
			const opts = enumOptions(decl)
			if (opts)
				conjuncts.push(
					`(CASE WHEN jsonb_typeof(${get}) = 'string' THEN "fields"->>${k} IN (${opts
						.map(lit)
						.join(", ")}) ELSE true END)`
				)
		}
	}

	if (!conjuncts.length) return null
	return (
		`"type_id" <> ${lit(typeId)} OR "type_version" <> ${version} OR (` +
		conjuncts.join(" AND ") +
		`)`
	)
}

/**
 * The fields that earn an index — `queryable` for a predicate, `sortable` for an
 * ordering.
 */
export function entryIndexFields(
	configSchema: Record<string, any> | null | undefined
): string[] {
	if (!configSchema || typeof configSchema !== "object") return []
	return Object.entries(configSchema)
		.filter(
			([field, decl]) =>
				SAFE_FIELD.test(field) &&
				decl &&
				typeof decl === "object" &&
				((decl as any).queryable === true ||
					(decl as any).sortable === true)
		)
		.map(([field]) => field)
}

/**
 * The index for one declared field.
 *
 * On the **jsonb value**, not on a cast of its text form. A cast in an index
 * expression raises at build time on the first row that does not fit — and this
 * runs at boot, against rows a `NOT VALID` constraint has deliberately not
 * vetted, so a cast would reintroduce exactly the brick the NOT VALID cycle
 * exists to prevent. jsonb's own btree ordering sorts numbers numerically, so
 * nothing is lost by staying in the type.
 *
 * Partial on the discriminator: an index covers its own type's rows only, so it
 * stays small and a version bump's drop-and-re-add means something.
 */
const indexDdl = (
	name: string,
	typeId: string,
	version: number,
	field: string
) =>
	`CREATE INDEX ${JSON.stringify(name)} ON ${JSON.stringify(TABLE)} ` +
	`USING btree (("fields"->${lit(field)})) ` +
	`WHERE "type_id" = ${lit(typeId)} AND "type_version" = ${version}`

// ── Reading the registry ────────────────────────────────────────────────────

export interface ProjectedEntryType {
	typeId: string
	version: number
	constraint: string
	/** `null` when the type declares nothing a row can be checked against. */
	expression: string | null
	indexes: Array<{ name: string; field: string; ddl: string }>
}

/**
 * The entry types this instance actually has, as rows.
 *
 * Not `allEntryTypes()`: install-time truth is the table, and an older type
 * version left in place for the rows still carrying it is exactly the case a
 * code-side list cannot see.
 */
export async function readProjectedEntryTypes(
	db: Db,
	/**
	 * Rows this reader refused, pushed here rather than dropped.
	 *
	 * A declared constraint that silently fails to project is the exact class of
	 * failure this design keeps naming; the caller turns these into
	 * `report.errors`, where somebody can see them.
	 */
	skipped?: string[]
): Promise<ProjectedEntryType[]> {
	const res = await db.execute(
		sql.raw(
			`SELECT "type_id", "version", "config_schema" FROM "pipeline_type_registry" ` +
				`WHERE "kind" = 'entry' ORDER BY "type_id", "version"`
		)
	)
	const out: ProjectedEntryType[] = []
	for (const row of rawRows<{
		type_id: string
		version: number | string
		config_schema: string | Record<string, any> | null
	}>(res)) {
		const typeId = String(row.type_id)
		const version = Number(row.version)
		if (!Number.isInteger(version)) {
			skipped?.push(`${typeId}@${row.version}: version is not an integer`)
			continue
		}
		// The id reaches SQL as a literal below. The SDK's entry-id grammar
		// permits none of these, so a row carrying one was hand-written and is
		// corrupt rather than exotic — refused rather than quoted around,
		// because `slugOf` has to fold it into an identifier, and two folded
		// ids could collide onto one constraint name.
		if (/[\s'\\]/.test(typeId)) {
			skipped?.push(
				`${typeId}@${version}: the type id contains a character the ` +
					`entry-id grammar forbids, so nothing was projected for it`
			)
			continue
		}
		const schema =
			typeof row.config_schema === "string"
				? safeParse(row.config_schema)
				: row.config_schema
		out.push({
			typeId,
			version,
			constraint: entryConstraintName(typeId, version),
			expression: entryCheckExpression(typeId, version, schema),
			indexes: entryIndexFields(schema).map((field) => {
				const name = entryIndexName(typeId, version, field)
				return {
					name,
					field,
					ddl: indexDdl(name, typeId, version, field)
				}
			})
		})
	}
	return out
}

const safeParse = (s: string): Record<string, any> | null => {
	try {
		return JSON.parse(s)
	} catch {
		return null
	}
}

// ── The audit ───────────────────────────────────────────────────────────────

/** How many offending ids a violation carries. Enough to act on, bounded. */
const VIOLATION_SAMPLE = 50

/**
 * Which rows a projected constraint would reject.
 *
 * `WHERE NOT (<expr>)` is exactly the constraint's own semantics inverted: a
 * CHECK admits a row whose expression is true *or* null, and `NOT null` is null,
 * so a null-valued expression is admitted by both.
 *
 * Runs against the derived expression rather than against the installed
 * constraint, so it answers before one is added as readily as after.
 */
export async function auditEntryConstraints(
	db: Db,
	types?: ProjectedEntryType[]
): Promise<EntryConstraintViolation[]> {
	if (!(await tableExists(db))) return []
	const all = types ?? (await readProjectedEntryTypes(db))
	const violations: EntryConstraintViolation[] = []
	for (const t of all) {
		if (!t.expression) continue
		const where = `WHERE NOT (${t.expression})`
		// Counted exactly and sampled separately, rather than counting the
		// sample: "3 rows" and "3 of 40,000 rows" call for different answers,
		// and a report carrying every id of the second is one nothing can
		// render.
		const counted = await db.execute(
			sql.raw(
				`SELECT COUNT(*)::int AS n FROM ${JSON.stringify(TABLE)} ${where}`
			)
		)
		const count = Number(rawRows<{ n: number }>(counted)[0]?.n ?? 0)
		if (!count) continue
		const sample = await db.execute(
			sql.raw(
				`SELECT "id" FROM ${JSON.stringify(TABLE)} ${where} ` +
					`ORDER BY "id" LIMIT ${VIOLATION_SAMPLE}`
			)
		)
		violations.push({
			constraint: t.constraint,
			typeId: t.typeId,
			typeVersion: t.version,
			count,
			entryIds: rawRows<{ id: number }>(sample).map((r) => Number(r.id))
		})
	}
	return violations
}

// ── The boot step ───────────────────────────────────────────────────────────

const tableExists = async (db: Db): Promise<boolean> => {
	const res = await db.execute(
		sql.raw(`SELECT to_regclass('public.${TABLE}') IS NOT NULL AS present`)
	)
	return !!rawRows<{ present: boolean }>(res)[0]?.present
}

/**
 * Bring `lorebook_entries`' constraints and indexes in line with the registry.
 *
 * Idempotent: same rows, same DDL, no writes on the second run — which is what
 * lets it ride the unconditional boot chain rather than sit behind a "have we
 * projected yet" flag, and a flag like that eventually lies.
 *
 * **Never throws.** Every step collects its failure into `report.errors`,
 * because the whole `NOT VALID` discipline is pointless if the projector itself
 * can stop the application starting.
 */
export async function projectEntryConstraints(
	db: Db
): Promise<EntryProjectionReport> {
	const report: EntryProjectionReport = {
		constraints: { added: [], dropped: [], validated: [], pending: [] },
		indexes: { added: [], dropped: [] },
		violations: [],
		danglingTypeRefs: 0,
		typeFkValidated: false,
		errors: []
	}

	const run = async (label: string, ddl: string): Promise<boolean> => {
		try {
			await db.execute(sql.raw(ddl))
			return true
		} catch (err) {
			report.errors.push(
				`${label}: ${err instanceof Error ? err.message : String(err)}`
			)
			return false
		}
	}

	if (!(await tableExists(db))) return report

	let types: ProjectedEntryType[]
	const skipped: string[] = []
	try {
		types = await readProjectedEntryTypes(db, skipped)
	} catch (err) {
		report.errors.push(
			`read registry: ${err instanceof Error ? err.message : String(err)}`
		)
		return report
	}
	report.errors.push(...skipped)

	// ── CHECK constraints ────────────────────────────────────────────────
	const constrained = types.filter((t) => t.expression)
	const wanted = new Map(constrained.map((t) => [t.constraint, t]))
	// Two types folding onto one name would make the reconciler below drop one
	// of them on the next boot — a constraint disappearing with nobody told.
	// Cheap to detect here; the alternative is finding out from the data.
	if (wanted.size !== constrained.length)
		report.errors.push(
			`two entry types project onto one constraint name: ` +
				`${constrained.map((t) => `${t.typeId}@${t.version}`).join(", ")}`
		)
	const existing = new Map<string, boolean>()
	try {
		const res = await db.execute(
			sql.raw(
				`SELECT "conname", "convalidated" FROM "pg_constraint" ` +
					`WHERE "conrelid" = ${lit(TABLE)}::regclass AND "contype" = 'c' ` +
					`AND starts_with("conname", ${lit(CHECK_PREFIX)})`
			)
		)
		for (const r of rawRows<{
			conname: string
			convalidated: boolean
		}>(res))
			existing.set(String(r.conname), !!r.convalidated)
	} catch (err) {
		report.errors.push(
			`read constraints: ${err instanceof Error ? err.message : String(err)}`
		)
		return report
	}

	// Superseded first — a version bump is a new name, so the old one is
	// simply no longer wanted. Other types' constraints are untouched because
	// they are still in the desired set.
	for (const name of existing.keys()) {
		if (wanted.has(name)) continue
		if (
			await run(
				`drop ${name}`,
				`ALTER TABLE ${JSON.stringify(TABLE)} DROP CONSTRAINT ${JSON.stringify(name)}`
			)
		)
			report.constraints.dropped.push(name)
	}

	for (const [name, t] of wanted) {
		if (existing.has(name)) continue
		if (
			await run(
				`add ${name}`,
				`ALTER TABLE ${JSON.stringify(TABLE)} ADD CONSTRAINT ${JSON.stringify(name)} ` +
					`CHECK (${t.expression}) NOT VALID`
			)
		)
			report.constraints.added.push(name)
	}

	// ── Indexes ──────────────────────────────────────────────────────────
	const wantedIdx = new Map(
		types.flatMap((t) => t.indexes.map((i) => [i.name, i] as const))
	)
	try {
		const res = await db.execute(
			sql.raw(
				`SELECT "indexname" FROM "pg_indexes" WHERE "tablename" = ${lit(TABLE)} ` +
					`AND starts_with("indexname", ${lit(INDEX_PREFIX)})`
			)
		)
		const present = new Set(
			rawRows<{ indexname: string }>(res).map((r) =>
				String(r.indexname)
			)
		)
		for (const name of present) {
			if (wantedIdx.has(name)) continue
			if (
				await run(
					`drop index ${name}`,
					`DROP INDEX ${JSON.stringify(name)}`
				)
			)
				report.indexes.dropped.push(name)
		}
		for (const [name, i] of wantedIdx) {
			if (present.has(name)) continue
			if (await run(`add index ${name}`, i.ddl))
				report.indexes.added.push(name)
		}
	} catch (err) {
		report.errors.push(
			`read indexes: ${err instanceof Error ? err.message : String(err)}`
		)
	}

	// ── Audit, then validate what is clean ───────────────────────────────
	try {
		report.violations = await auditEntryConstraints(db, types)
	} catch (err) {
		report.errors.push(
			`audit: ${err instanceof Error ? err.message : String(err)}`
		)
		return report
	}
	const violating = new Set(report.violations.map((v) => v.constraint))

	// Re-read, so a constraint added a moment ago is considered too.
	const unvalidated = new Set<string>()
	try {
		const res = await db.execute(
			sql.raw(
				`SELECT "conname" FROM "pg_constraint" ` +
					`WHERE "conrelid" = ${lit(TABLE)}::regclass AND "contype" = 'c' ` +
					`AND starts_with("conname", ${lit(CHECK_PREFIX)}) AND NOT "convalidated"`
			)
		)
		for (const r of rawRows<{ conname: string }>(res))
			unvalidated.add(String(r.conname))
	} catch (err) {
		report.errors.push(
			`read validation state: ${err instanceof Error ? err.message : String(err)}`
		)
	}

	for (const name of unvalidated) {
		if (!wanted.has(name)) continue
		if (violating.has(name)) {
			report.constraints.pending.push(name)
			continue
		}
		if (
			await run(
				`validate ${name}`,
				`ALTER TABLE ${JSON.stringify(TABLE)} VALIDATE CONSTRAINT ${JSON.stringify(name)}`
			)
		)
			report.constraints.validated.push(name)
		else report.constraints.pending.push(name)
	}

	// ── The type reference, on the same cycle ────────────────────────────
	try {
		const res = await db.execute(
			sql.raw(
				`SELECT COUNT(*)::int AS n FROM ${JSON.stringify(TABLE)} e ` +
					`LEFT JOIN "pipeline_type_registry" r ` +
					`ON r."type_id" = e."type_id" AND r."version" = e."type_version" ` +
					`WHERE r."id" IS NULL`
			)
		)
		report.danglingTypeRefs = Number(
			rawRows<{ n: number }>(res)[0]?.n ?? 0
		)

		const fk = await db.execute(
			sql.raw(
				`SELECT "convalidated" FROM "pg_constraint" ` +
					`WHERE "conrelid" = ${lit(TABLE)}::regclass AND "conname" = ${lit(TYPE_FK)}`
			)
		)
		const row = rawRows<{ convalidated: boolean }>(fk)[0]
		report.typeFkValidated = !!row?.convalidated
		if (row && !row.convalidated && report.danglingTypeRefs === 0) {
			if (
				await run(
					`validate ${TYPE_FK}`,
					`ALTER TABLE ${JSON.stringify(TABLE)} VALIDATE CONSTRAINT ${JSON.stringify(TYPE_FK)}`
				)
			)
				report.typeFkValidated = true
		}
	} catch (err) {
		report.errors.push(
			`type reference: ${err instanceof Error ? err.message : String(err)}`
		)
	}

	return report
}

/**
 * One line per problem, for the boot log.
 *
 * Separate from the projection so the report stays data and the caller decides
 * whether anyone is listening.
 */
export function describeEntryProjection(
	report: EntryProjectionReport
): string[] {
	const lines: string[] = []
	for (const v of report.violations) {
		const one = v.count === 1
		lines.push(
			`${v.count} ${v.typeId}@${v.typeVersion} entr${one ? "y" : "ies"} ` +
				`violate${one ? "s" : ""} ${v.constraint} — id${one ? "" : "s"} ` +
				`${v.entryIds.join(", ")}${v.count > v.entryIds.length ? ", …" : ""}. ` +
				`The constraint is enforced for new writes and left NOT VALID until these are repaired.`
		)
	}
	if (report.danglingTypeRefs > 0)
		lines.push(
			`${report.danglingTypeRefs} entr${report.danglingTypeRefs === 1 ? "y names a type" : "ies name types"} ` +
				`that is not in the registry, so ${TYPE_FK} stays NOT VALID.`
		)
	for (const e of report.errors) lines.push(e)
	return lines
}
