/**
 * User-authored scripts, as rows behind the scripts page (18 §4d).
 *
 * The same entity discipline as prompts — the row holds the text, anything
 * selecting it stores the id, and the two refusals below keep a selection
 * meaningful — with the one deliberate difference 18 §2 names: **keyed by the
 * script type, not by a spec.** A slop filter is a statement about text, not
 * about which pipeline runs it, so grouping and name-uniqueness follow the
 * type, and any hook accepting `core:script:text/transform@1` may attach any
 * row of that type.
 *
 * ## What this module does not do
 *
 * Execute anything. The sandbox host (18 §7, U-S2) and chain application
 * (U-S3/U-S4) are separate units; this file is the storage and the workspace
 * read behind the management page, built first so the paradigm's artifacts
 * exist to attach when the hooks arrive.
 *
 * ## Types come from rows, not from the SDK map
 *
 * The page renders script *types* from `pipeline_type_registry` (kind =
 * 'script'), the same F6 posture as the panel: a `transport: 'process'`
 * plugin's type has no in-process descriptor to consult, and a page that read
 * core's from the SDK and a plugin's from rows would be two pages.
 */

import { and, asc, eq, inArray } from "drizzle-orm"
import * as schema from "$lib/server/db/schema"
import { parseScriptTypeId } from "@serene-pub/sdk"

type Db = {
	select: any
	insert: any
	update: any
	delete: any
}

/** The script named nothing here. */
export class ScriptNotFoundError extends Error {}

/** The script exists but the write is refused. Message is for a person. */
export class ScriptNotUsableError extends Error {}

export interface ScriptTypeInfo {
	/** Pinned id — `core:script:text/transform@1`. */
	typeId: string
	/** `text`, `messages`, `candidates`, `context`, … */
	content: string
	/** `transform`, `stop`, `inject`, … */
	operation: string
	/** `transform` folds into the variable bag; `verdict` is consumed (18 §5). */
	semantics: "transform" | "verdict"
	name: string
	description: string
	/** The panel badge — what a script of this type is able to do (18 §3). */
	blastRadius: string
	/** The variable space, from the type's declared ports. */
	varsIn: string[]
	varsOut: string[]
	/**
	 * Read-only context some hook supplies beyond the ports — the union of
	 * `extras` across every hook accepting this type, read from the registry's
	 * slot declarations. In-only by construction (18 §6a), and part of the
	 * *fixed* choice set the editor offers: a declared read is either a port or
	 * an extra some hook actually provides, never a name typed on faith.
	 */
	extras: string[]
}

export interface ScriptRecord {
	id: number
	typeId: string
	name: string
	isImmutable: boolean
	enabled: boolean
	source: string
	varsIn: string[]
	varsOut: string[]
	/** Pipelines whose chains currently include it, by display name. */
	usedBy: string[]
}

export interface ScriptsView {
	/** Every registered script type, including the ones with no rows yet. */
	types: ScriptTypeInfo[]
	scripts: ScriptRecord[]
}

const en = (v: unknown): string =>
	typeof v === "string" ? v : ((v as any)?.en ?? "")

/** Registry rows for script types, live ones only, in registration order. */
async function scriptTypeRows(db: Db): Promise<any[]> {
	const rows = await db
		.select()
		.from(schema.pipelineTypeRegistry)
		.where(eq(schema.pipelineTypeRegistry.kind, "script"))
		.orderBy(asc(schema.pipelineTypeRegistry.id))
	return (rows as any[]).filter((r) => r.status === "live")
}

function typeInfo(row: any, extras: string[]): ScriptTypeInfo {
	const pinned = `${row.typeId}@${row.version}`
	const parsed = parseScriptTypeId(pinned)
	const i18n = (row.i18n ?? {}) as Record<string, any>
	return {
		typeId: pinned,
		content: parsed.content,
		operation: parsed.operation,
		semantics: row.semantics === "verdict" ? "verdict" : "transform",
		name: en(i18n.name) || `${parsed.content}/${parsed.operation}`,
		description: en(i18n.description),
		blastRadius: en(i18n.blastRadius),
		varsIn: Object.keys((row.ports as any)?.in ?? {}),
		varsOut: Object.keys((row.ports as any)?.out ?? {}),
		extras
	}
}

/**
 * `type id → the extras of every hook accepting it`, from the registry.
 *
 * Read from the node rows' slot declarations, not from a list here: a plugin
 * node declaring a hook with its own extras widens a type's readable space the
 * moment its row lands, with no core change — the same F6 posture as the rest
 * of the panel.
 */
async function hookExtras(db: Db): Promise<Map<string, Set<string>>> {
	const out = new Map<string, Set<string>>()
	const rows = await db.select().from(schema.pipelineTypeRegistry)
	for (const row of rows as any[]) {
		const slots = (row.slots ?? {}) as Record<string, any>
		for (const decl of Object.values(slots)) {
			if (!decl || decl.kind !== "scripts") continue
			const extras = Array.isArray(decl.extras) ? decl.extras : []
			for (const typeId of decl.accepts ?? []) {
				const set = out.get(typeId) ?? new Set<string>()
				for (const e of extras) if (typeof e === "string") set.add(e)
				out.set(typeId, set)
			}
		}
	}
	return out
}

/** Every registered script type, resolved for display and validation. */
export async function scriptTypeInfos(db: Db): Promise<ScriptTypeInfo[]> {
	const extras = await hookExtras(db)
	return (await scriptTypeRows(db)).map((row) =>
		typeInfo(
			row,
			[...(extras.get(`${row.typeId}@${row.version}`) ?? [])].sort()
		)
	)
}

export async function scriptType(
	db: Db,
	typeId: string
): Promise<ScriptTypeInfo | null> {
	const hit = (await scriptTypeInfos(db)).find((t) => t.typeId === typeId)
	return hit ?? null
}

/**
 * Which pipelines' chains include a given script.
 *
 * Chains are ordered ref lists stored at the `scripts` slot path in the two
 * config tables (18 §2) — so a reference is an *array containing* the id, not
 * an equal value, and this scans in code the way `deletePrompt` does, for the
 * same reason: the values are arbitrary json and the tables are small. Nothing
 * writes such rows until the hooks land (U-S3); until then every set is empty,
 * and the page and the delete refusal are already wired for the day one isn't.
 */
async function scriptUsageIndex(db: Db): Promise<Map<number, Set<string>>> {
	const out = new Map<number, Set<string>>()

	const specs = await db.select().from(schema.pipelineSpecs)
	const nameById = new Map<number, string>(
		(specs as any[]).map((s) => [s.id, s.name ?? s.slug])
	)
	const configs = await db.select().from(schema.pipelineConfigs)
	const specOfConfig = new Map<number, number>(
		(configs as any[]).map((c) => [c.id, c.specId])
	)

	const note = (value: unknown, specId: number | null | undefined) => {
		const ids = Array.isArray(value)
			? value
			: typeof value === "number"
				? [value]
				: []
		if (!ids.length) return
		const label = specId != null ? nameById.get(specId) : undefined
		if (!label) return
		for (const id of ids) {
			if (typeof id !== "number") continue
			const set = out.get(id) ?? new Set<string>()
			set.add(label)
			out.set(id, set)
		}
	}

	for (const v of (await db
		.select()
		.from(schema.pipelineConfigValues)
		.where(eq(schema.pipelineConfigValues.slot, "scripts"))) as any[])
		note(v.value, specOfConfig.get(v.configId))

	for (const o of (await db
		.select()
		.from(schema.pipelineNodeOverrides)
		.where(eq(schema.pipelineNodeOverrides.slot, "scripts"))) as any[])
		note(o.value, o.specId)

	// Connection attachments count too (18 §4b): a stop guard riding a
	// connection is a reference like any chain's, and a delete that stranded
	// one would be an attachment that stores cleanly and does nothing.
	const attachments = await db
		.select({
			scriptId: schema.connectionScripts.scriptId,
			connectionName: schema.connections.name
		})
		.from(schema.connectionScripts)
		.innerJoin(
			schema.connections,
			eq(schema.connectionScripts.connectionId, schema.connections.id)
		)
	for (const a of attachments as any[]) {
		const set = out.get(a.scriptId) ?? new Set<string>()
		set.add(`connection: ${a.connectionName}`)
		out.set(a.scriptId, set)
	}

	return out
}

const record = (r: any, usedBy: Set<string> | undefined): ScriptRecord => ({
	id: r.id,
	typeId: r.typeId,
	name: r.name,
	isImmutable: !!r.isImmutable,
	enabled: !!r.enabled,
	source: r.source ?? "",
	varsIn: (r.varsIn ?? []) as string[],
	varsOut: (r.varsOut ?? []) as string[],
	usedBy: [...(usedBy ?? [])].sort()
})

/** The management page's one read: every type, every row, and what holds it. */
export async function scriptsView(db: Db): Promise<ScriptsView> {
	const types = await scriptTypeInfos(db)
	const use = await scriptUsageIndex(db)
	const scripts = (
		(await db
			.select()
			.from(schema.pipelineScripts)
			.orderBy(asc(schema.pipelineScripts.id))) as any[]
	).map((r) => record(r, use.get(r.id)))
	return { types, scripts }
}

/** Normalize a declared variable list: strings, trimmed, deduped, empties dropped. */
const cleanVars = (vars: unknown): string[] => [
	...new Set(
		(Array.isArray(vars) ? vars : [])
			.filter((v): v is string => typeof v === "string")
			.map((v) => v.trim())
			.filter(Boolean)
	)
]

/**
 * The declared I/O must fit the type's **fixed** variable space (18 §6a) —
 * ruled 2026-08-23: the choices are the type's ports plus the extras some hook
 * actually supplies, never a freeform name. A name outside the space is a
 * declaration nothing will ever satisfy — the executor would serialize nothing
 * in for it and merge nothing out — which is the "stores cleanly and does
 * nothing" shape, refused here with the name and the legal set.
 *
 * A verdict type's outs are empty *by definition*, not by convention: its
 * return is consumed by the hook and never merges downstream (18 §5).
 */
function assertVarsFitType(
	type: ScriptTypeInfo,
	varsIn: string[],
	varsOut: string[]
): void {
	const readable = new Set([...type.varsIn, ...type.extras])
	const unknownIn = varsIn.filter((v) => !readable.has(v))
	if (unknownIn.length)
		throw new ScriptNotUsableError(
			`'${type.name}' scripts cannot read ${unknownIn
				.map((v) => `'${v}'`)
				.join(", ")} — nothing supplies ${
				unknownIn.length > 1 ? "them" : "it"
			}. What can be read here: ${[...readable].join(", ")}.`
		)

	if (type.semantics === "verdict") {
		if (varsOut.length)
			throw new ScriptNotUsableError(
				`'${type.name}' scripts return a verdict the hook consumes — a stop ` +
					`index, not a rewrite — so they cannot declare out-variables. ` +
					`Clear the out list, or use a transform type.`
			)
		return
	}

	const writable = new Set(type.varsOut)
	const unknownOut = varsOut.filter((v) => !writable.has(v))
	if (unknownOut.length)
		throw new ScriptNotUsableError(
			`'${type.name}' scripts cannot rewrite ${unknownOut
				.map((v) => `'${v}'`)
				.join(", ")}. What can be rewritten here: ${
				[...writable].join(", ") || "nothing"
			}. Extras are read-only by construction.`
		)
}

/** "Name", then "Name (2)" — unique within the type's own pool. */
export async function scriptCopyName(
	db: Db,
	typeId: string,
	base: string
): Promise<string> {
	const rows = await db
		.select({ name: schema.pipelineScripts.name })
		.from(schema.pipelineScripts)
		.where(eq(schema.pipelineScripts.typeId, typeId))
	const taken = new Set((rows as any[]).map((r) => r.name))
	let candidate = base
	for (let n = 2; taken.has(candidate); n++) candidate = `${base} (${n})`
	return candidate
}

/**
 * A starter body that runs as a no-op, so the first save can never break a
 * chain: transforms pass their subject through, verdicts decline to stop.
 */
function starterSource(type: ScriptTypeInfo): string {
	if (type.semantics === "verdict")
		return (
			"// Return the character index where generation should stop,\n" +
			"// or return nothing to let it run.\n"
		)
	const subject = type.varsIn[0] ?? "text"
	return (
		"// The box holds a function body. Return nothing to pass through\n" +
		`// unchanged.\nreturn ${subject}\n`
	)
}

export interface CreateScriptInput {
	typeId: string
	name?: string
	source?: string
	varsIn?: string[]
	varsOut?: string[]
	seedKey?: string
	isImmutable?: boolean
}

export async function createScript(
	db: Db,
	input: CreateScriptInput
): Promise<ScriptRecord> {
	const type = await scriptType(db, input.typeId)
	if (!type)
		throw new ScriptNotUsableError(
			`'${input.typeId}' is not a script type this build registers, so a ` +
				`script of it could never be attached anywhere. If it came from a ` +
				`plugin, enable the plugin first.`
		)

	const varsIn = input.varsIn ? cleanVars(input.varsIn) : type.varsIn
	const varsOut = input.varsOut
		? cleanVars(input.varsOut)
		: type.semantics === "verdict"
			? []
			: type.varsOut
	assertVarsFitType(type, varsIn, varsOut)

	const name = await scriptCopyName(
		db,
		input.typeId,
		(input.name ?? "").trim() || `New ${type.name.toLowerCase()}`
	)

	const [row] = await db
		.insert(schema.pipelineScripts)
		.values({
			typeId: input.typeId,
			name,
			source: input.source ?? starterSource(type),
			varsIn,
			varsOut,
			seedKey: input.seedKey ?? null,
			isImmutable: input.isImmutable ?? false
		})
		.returning()
	return record(row, undefined)
}

export async function duplicateScript(
	db: Db,
	scriptId: number,
	name?: string
): Promise<ScriptRecord> {
	const [row] = await db
		.select()
		.from(schema.pipelineScripts)
		.where(eq(schema.pipelineScripts.id, scriptId))
		.limit(1)
	if (!row) throw new ScriptNotFoundError("That script no longer exists.")

	const copyName = await scriptCopyName(
		db,
		row.typeId,
		(name ?? "").trim() || `${row.name} (copy)`
	)
	const [copy] = await db
		.insert(schema.pipelineScripts)
		.values({
			typeId: row.typeId,
			name: copyName,
			source: row.source ?? "",
			varsIn: (row.varsIn ?? []) as string[],
			varsOut: (row.varsOut ?? []) as string[]
		})
		.returning()
	return record(copy, undefined)
}

export async function updateScript(
	db: Db,
	scriptId: number,
	patch: {
		name?: string
		source?: string
		enabled?: boolean
		varsIn?: string[]
		varsOut?: string[]
	}
): Promise<void> {
	const [row] = await db
		.select()
		.from(schema.pipelineScripts)
		.where(eq(schema.pipelineScripts.id, scriptId))
		.limit(1)
	if (!row) throw new ScriptNotFoundError("That script no longer exists.")
	if (row.isImmutable)
		throw new ScriptNotUsableError(
			`'${row.name}' is one of the scripts Serene Pub ships, so it stays as ` +
				`it is. Duplicate it and edit the copy — everything already pointing ` +
				`at the original keeps working.`
		)

	const varsIn =
		patch.varsIn !== undefined ? cleanVars(patch.varsIn) : undefined
	const varsOut =
		patch.varsOut !== undefined ? cleanVars(patch.varsOut) : undefined
	if (varsIn !== undefined || varsOut !== undefined) {
		const type = await scriptType(db, row.typeId)
		// A row whose type is absent from this build is still editable — the
		// unknown-type rule refuses *attachment*, not authorship — so the
		// space check simply has nothing to say without a type to consult.
		if (type)
			assertVarsFitType(
				type,
				varsIn ?? ((row.varsIn ?? []) as string[]),
				varsOut ?? ((row.varsOut ?? []) as string[])
			)
	}

	const name = patch.name?.trim()
	await db
		.update(schema.pipelineScripts)
		.set({
			...(name ? { name } : {}),
			...(patch.source !== undefined ? { source: patch.source } : {}),
			...(patch.enabled !== undefined ? { enabled: patch.enabled } : {}),
			...(varsIn !== undefined ? { varsIn } : {}),
			...(varsOut !== undefined ? { varsOut } : {}),
			updatedAt: new Date()
		})
		.where(eq(schema.pipelineScripts.id, scriptId))
}

/**
 * Delete a script — with the same two refusals as prompts, for the same
 * reason: a chain holding the id of a deleted row is an attachment that stores
 * cleanly and does nothing. Deleting means: first take it out of every chain,
 * then delete. The `usedBy` list on the page says *where*, before they try.
 */
export async function deleteScript(db: Db, scriptId: number): Promise<void> {
	const [row] = await db
		.select()
		.from(schema.pipelineScripts)
		.where(eq(schema.pipelineScripts.id, scriptId))
		.limit(1)
	if (!row) throw new ScriptNotFoundError("That script no longer exists.")
	if (row.isImmutable)
		throw new ScriptNotUsableError(
			`'${row.name}' is one of the scripts Serene Pub ships, so it stays.`
		)

	const use = await scriptUsageIndex(db)
	const holders = use.get(scriptId)
	if (holders?.size)
		throw new ScriptNotUsableError(
			`'${row.name}' is still in a chain — ${[...holders]
				.sort()
				.join(", ")} ${
				holders.size > 1 ? "are" : "is"
			} pointing at it. Remove it there first, then delete it here.`
		)

	await db
		.delete(schema.pipelineScripts)
		.where(eq(schema.pipelineScripts.id, scriptId))
}

/* --- connection attachment (18 §4b) ---------------------------------- */

export const STOP_TYPE_ID = "core:script:text/stop@1"

/** A connection's attached stop scripts, hydrated, in display order. */
export async function listConnectionScripts(
	db: Db,
	connectionId: number
): Promise<ScriptRecord[]> {
	const rows = await db
		.select({
			attachment: schema.connectionScripts,
			script: schema.pipelineScripts
		})
		.from(schema.connectionScripts)
		.innerJoin(
			schema.pipelineScripts,
			eq(schema.connectionScripts.scriptId, schema.pipelineScripts.id)
		)
		.where(eq(schema.connectionScripts.connectionId, connectionId))
	return (rows as any[])
		.sort(
			(a, b) =>
				a.attachment.position - b.attachment.position ||
				a.attachment.id - b.attachment.id
		)
		.map((r) => record(r.script, undefined))
}

/**
 * Attach a stop script to a connection — with the scope guard as a refusal.
 *
 * Entity attachment is limited to operations whose content actually flows
 * through the entity (18 §4b): for a connection that is the completion stream,
 * so `text/stop` and nothing else. Letting any type attach would turn every
 * row into a place behavior hides — the exact drift the guard exists to stop.
 */
export async function attachConnectionScript(
	db: Db,
	connectionId: number,
	scriptId: number
): Promise<void> {
	const [conn] = await db
		.select()
		.from(schema.connections)
		.where(eq(schema.connections.id, connectionId))
		.limit(1)
	if (!conn)
		throw new ScriptNotFoundError("That connection no longer exists.")

	const [row] = await db
		.select()
		.from(schema.pipelineScripts)
		.where(eq(schema.pipelineScripts.id, scriptId))
		.limit(1)
	if (!row) throw new ScriptNotFoundError("That script no longer exists.")
	if (row.typeId !== STOP_TYPE_ID)
		throw new ScriptNotUsableError(
			`'${row.name}' is not a stop script. A connection carries only ` +
				`stop guards — the completion stream is what flows through it — ` +
				`and other scripts attach on pipeline steps instead.`
		)

	const existing = await listConnectionScripts(db, connectionId)
	if (existing.some((s) => s.id === scriptId))
		throw new ScriptNotUsableError(
			`'${row.name}' is already attached to '${conn.name}'.`
		)

	await db.insert(schema.connectionScripts).values({
		connectionId,
		scriptId,
		position: existing.length
	})
}

export async function detachConnectionScript(
	db: Db,
	connectionId: number,
	scriptId: number
): Promise<void> {
	await db
		.delete(schema.connectionScripts)
		.where(
			and(
				eq(schema.connectionScripts.connectionId, connectionId),
				eq(schema.connectionScripts.scriptId, scriptId)
			)
		)
}

/* --- sharing (18 §2, U-S7) -------------------------------------------- */

export interface ScriptArtifactEntry {
	type: string
	name: string
	source: string
	in: string[]
	out: string[]
}

/**
 * The export artifact (18 §2): the declared I/O travels with the text, so an
 * importer can see what a script reads and rewrites before running it. A bare
 * entry is legal — that is the shape the doc pins — and the envelope is what a
 * *pack* wears: several scripts, one file, the fix-pack unit that circulates.
 */
export interface ScriptArtifact {
	serenePub: "scripts@1"
	scripts: ScriptArtifactEntry[]
}

export async function exportScriptArtifact(
	db: Db,
	ids: number[]
): Promise<ScriptArtifact> {
	const rows = await db
		.select()
		.from(schema.pipelineScripts)
		.where(inArray(schema.pipelineScripts.id, ids))
	const byId = new Map<number, any>((rows as any[]).map((r) => [r.id, r]))
	const scripts: ScriptArtifactEntry[] = []
	for (const id of ids) {
		const row = byId.get(id)
		if (!row)
			throw new ScriptNotFoundError(
				"One of those scripts no longer exists."
			)
		scripts.push({
			type: row.typeId,
			name: row.name,
			source: row.source ?? "",
			in: (row.varsIn ?? []) as string[],
			out: (row.varsOut ?? []) as string[]
		})
	}
	return { serenePub: "scripts@1", scripts }
}

/**
 * Parse whatever arrived into the envelope — a pack, or the doc's bare entry
 * wrapped as a pack of one. Malformed input refuses naming what was expected,
 * because a half-parsed artifact imported "best effort" is how a fix pack
 * turns into three scripts and a mystery.
 */
export function parseScriptArtifact(raw: unknown): ScriptArtifact {
	const entry = (v: unknown): ScriptArtifactEntry | null => {
		const e = v as Partial<ScriptArtifactEntry> | null
		if (
			!e ||
			typeof e !== "object" ||
			typeof e.type !== "string" ||
			typeof e.name !== "string" ||
			typeof e.source !== "string"
		)
			return null
		return {
			type: e.type,
			name: e.name,
			source: e.source,
			in: Array.isArray(e.in)
				? e.in.filter((x): x is string => typeof x === "string")
				: [],
			out: Array.isArray(e.out)
				? e.out.filter((x): x is string => typeof x === "string")
				: []
		}
	}

	const one = entry(raw)
	if (one) return { serenePub: "scripts@1", scripts: [one] }

	const env = raw as { serenePub?: unknown; scripts?: unknown } | null
	if (env && env.serenePub === "scripts@1" && Array.isArray(env.scripts)) {
		const scripts = env.scripts.map(entry)
		if (scripts.every((e): e is ScriptArtifactEntry => e !== null))
			return { serenePub: "scripts@1", scripts }
	}
	throw new ScriptNotUsableError(
		"That is not a script artifact. Expected a single " +
			"{type, name, source, in, out} entry, or a pack: " +
			'{serenePub: "scripts@1", scripts: [...]}.'
	)
}

export interface ScriptImportReport {
	imported: Array<{ name: string; renamed?: string }>
	skipped: Array<{ name: string; reason: string }>
}

/**
 * Import, with the migration-report idiom (U-S7): every entry lands or is
 * reported with a reason — an unknown type, a declaration the local space
 * refuses — and a name collision imports as a copy rather than overwriting
 * anyone's work. `accept` is the per-script opt-in the review screen ratified:
 * indexes into the pack; absent means all of it.
 */
export async function importScriptArtifact(
	db: Db,
	artifact: ScriptArtifact,
	accept?: number[]
): Promise<ScriptImportReport> {
	const chosen = new Set(accept ?? artifact.scripts.map((_, index) => index))
	const report: ScriptImportReport = { imported: [], skipped: [] }
	for (let index = 0; index < artifact.scripts.length; index++) {
		const item = artifact.scripts[index]!
		if (!chosen.has(index)) {
			report.skipped.push({ name: item.name, reason: "not selected" })
			continue
		}
		try {
			const created = await createScript(db, {
				typeId: item.type,
				name: item.name,
				source: item.source,
				varsIn: item.in,
				varsOut: item.out
			})
			report.imported.push({
				name: item.name,
				...(created.name !== item.name ? { renamed: created.name } : {})
			})
		} catch (err) {
			report.skipped.push({
				name: item.name,
				reason:
					err instanceof ScriptNotUsableError ||
					err instanceof ScriptNotFoundError
						? err.message
						: "could not be imported — the server log has the details"
			})
		}
	}
	return report
}
