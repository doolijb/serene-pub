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
 * The page renders script *types* from `pipeline_definition_registry` (kind =
 * 'script'), the same F6 posture as the panel: a `transport: 'process'`
 * plugin's type has no in-process descriptor to consult, and a page that read
 * core's from the SDK and a plugin's from rows would be two pages.
 */

import { AMBIENT_SCRIPT_EXTRAS } from "@serene-pub/sdk"
import { and, asc, eq, inArray } from "drizzle-orm"
import * as schema from "$lib/server/db/schema"
import {
	i18nText,
	parseScriptKindId,
	seamsOf,
	type I18n,
	type ScriptPointDecl
} from "@serene-pub/sdk"
import {
	chainKey,
	declaredChainAddresses,
	isChainAddress
} from "$lib/server/pipelines/config/chainAddresses"
import {
	pipelineScriptSeams,
	type PipelineScriptSeams
} from "$lib/server/pipelines/config/library"
import { optionId, stepKeyFor } from "$lib/server/pipelines/config/panel/ids"

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
	/**
	 * Where a link of this type executes. `node` — core's own script, run
	 * in-process by the Scripts sandbox. `process` — an extension's hook, run
	 * out-of-process by the plugin runtime. Written from ownership in the
	 * registry (`registrySync`), never from a manifest's claim, so a plugin
	 * cannot ask to run in-process. The chain applier reads this to route each
	 * link to the same value-fold law through one of two executors — the single
	 * dispatch interface for core and extension hooks alike.
	 */
	transport: "node" | "process"
	/**
	 * The installed plugin that owns this type (`plugins.id`), or null for a
	 * core type. Present exactly when `transport === "process"`; the applier
	 * hands it, with the type id, to the plugin-dispatch port to resolve the
	 * runtime hook.
	 */
	ownerPluginId: number | null
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
	/**
	 * What holds it, as words: pipeline labels (name · genre) and
	 * `connection: <name>` — the projection of `use`.
	 */
	usedBy: string[]
	/** Where it is attached, one row per chain or connection. */
	use: ScriptUseRow[]
	/** Where it could go: the seams accepting its kind. */
	fits: ScriptFits
}

export interface ScriptsView {
	/** Every registered script type, including the ones with no rows yet. */
	types: ScriptTypeInfo[]
	scripts: ScriptRecord[]
	/** Pipeline slug → label, for the fits filters' words. */
	pipelineLabels: Record<string, string>
}

/** Display text in `en` through the SDK's one resolver (R-20); blank for a value publish never let in. */
const en = (v: unknown): string => i18nText(v as I18n | undefined) ?? ""

/** Registry rows for script types, live ones only, in registration order. */
async function scriptTypeRows(db: Db): Promise<any[]> {
	const rows = await db
		.select()
		.from(schema.pipelineDefinitionRegistry)
		.where(eq(schema.pipelineDefinitionRegistry.kind, "script"))
		.orderBy(asc(schema.pipelineDefinitionRegistry.id))
	return (rows as any[]).filter((r) => r.status === "live")
}

function typeInfo(row: any, extras: string[]): ScriptTypeInfo {
	const pinned = `${row.definitionId}@${row.version}`
	const parsed = parseScriptKindId(pinned)
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
		extras,
		transport: row.transport === "process" ? "process" : "node",
		ownerPluginId:
			typeof row.ownerPluginId === "number" ? row.ownerPluginId : null
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
	const rows = await db.select().from(schema.pipelineDefinitionRegistry)
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

/**
 * Every registered script type, resolved for display and validation.
 *
 * A type's readable extras are its hooks' own plus the ambient set
 * (`AMBIENT_SCRIPT_EXTRAS`, R32): the executor hands `session` to every
 * script site — a slot's port hook and an interior point alike — so every
 * type may read it, whether or not a slot lists it (no slot does since the
 * modder pass) and whether it attaches at a slot or at a point.
 */
export async function scriptTypeInfos(db: Db): Promise<ScriptTypeInfo[]> {
	const extras = await hookExtras(db)
	return (await scriptTypeRows(db)).map((row) =>
		typeInfo(row, [
			...new Set([
				...(extras.get(`${row.definitionId}@${row.version}`) ?? []),
				...AMBIENT_SCRIPT_EXTRAS
			])
		].sort())
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
 * Where a script is attached — a chain on a pipeline's step, or a
 * connection's stop list. `usedBy` is the words this projects to.
 */
export type ScriptUseRow =
	| {
			kind: "pipeline"
			pipelineSlug: string
			pipelineLabel: string
			nodeKey: string
			stepLabel: string
			/**
			 * The seam address (`in:<port>` · `out:<port>` · `<pointKey>`).
			 * For an unplaced chain, the address it is stored at: the point
			 * key, or the slot name for a slot the step does not declare.
			 */
			at: string
			/** The step's opaque handle (`stepKeyFor`) — `?step=` on the workspace. */
			stepKey: string
			/** The chain option's handle (`optionId`) — the panel's `data-option-id`. */
			optionId: string
			/** The step declares no seam at this address (D4). */
			unplaced: boolean
	  }
	| { kind: "connection"; connectionId: number; connectionName: string }

/** The seams across installed pipelines whose `accepts` names a script's kind. */
export interface ScriptFits {
	seams: number
	/** Pipeline slugs. */
	pipelines: string[]
	/** Step labels. */
	steps: string[]
	/** Seam addresses. */
	at: string[]
	/** Genre names, through the presets that bind those pipelines. */
	genres: string[]
}

/** The words a use row reads as in the `usedBy` column. */
const useWords = (u: ScriptUseRow): string =>
	u.kind === "pipeline" ? u.pipelineLabel : `connection: ${u.connectionName}`

/**
 * Where every script is attached.
 *
 * Chains are ordered ref lists stored at a **chain address** in the two config
 * tables (18 §2): a `scripts`-kind slot's whole value, or an interior point
 * under the `scripts` facet (`chainAddresses.ts`). Every such address counts —
 * not only the slot named `scripts`, which missed extract-cast's
 * `castScripts` and let a script attached only there be deleted
 * (PLAN-script-placement D5). Whether an address is a chain's is a question
 * for the node's own definition, so each row is joined config → spec →
 * active version → node → registry row. A reference is an *array containing*
 * the id, scanned in code the way `deletePrompt` does: the values are
 * arbitrary json and the tables are small.
 *
 * A chain at an address its step does not declare is still a use, marked
 * `unplaced` (D4): it is kept, so deleting its script would strand it.
 *
 * `secret` keys the step and option handles; without one (the delete
 * guard, which needs only the holders) they are empty.
 */
async function scriptUsageIndex(
	db: Db,
	secret: string | null = null,
	pipelines?: PipelineScriptSeams[]
): Promise<Map<number, ScriptUseRow[]>> {
	const out = new Map<number, ScriptUseRow[]>()
	const seen = new Set<string>()
	const add = (scriptId: number, row: ScriptUseRow, key: string) => {
		if (seen.has(`${scriptId}\u0000${key}`)) return
		seen.add(`${scriptId}\u0000${key}`)
		const list = out.get(scriptId) ?? []
		list.push(row)
		out.set(scriptId, list)
	}

	const bySpec = new Map<number, PipelineScriptSeams>(
		(pipelines ?? (await pipelineScriptSeams(db))).map((p) => [p.specId, p])
	)

	const note = (
		v: { nodeKey: string; slot: string; path: string; value: unknown },
		specId: number | null | undefined
	) => {
		const ids = Array.isArray(v.value)
			? v.value
			: typeof v.value === "number"
				? [v.value]
				: []
		if (!ids.length || specId == null) return
		const pipeline = bySpec.get(specId)
		if (!pipeline) return
		const node = pipeline.nodes.get(v.nodeKey)
		const row = node?.row ?? null
		if (!isChainAddress(row, v.slot, v.path ?? "")) return
		const path = v.path ?? ""
		const declared = declaredChainAddresses(row)
		const seam = row
			? seamsOf({
					slots: (row.slots ?? {}) as Record<string, unknown>,
					scriptPoints: (row.scriptPoints ?? []) as ScriptPointDecl[]
				}).find((s) =>
					v.slot === "scripts" && s.kind === "point"
						? s.at === path
						: s.kind !== "point" && s.slot === v.slot && path === ""
				)
			: undefined
		const use: ScriptUseRow = {
			kind: "pipeline",
			pipelineSlug: pipeline.slug,
			pipelineLabel: pipeline.label,
			nodeKey: v.nodeKey,
			stepLabel: node?.stepLabel ?? v.nodeKey,
			at: seam?.at ?? (v.slot === "scripts" ? path : v.slot),
			stepKey: secret ? stepKeyFor(secret, v.nodeKey) : "",
			optionId: secret ? optionId(secret, v.nodeKey, v.slot, path) : "",
			unplaced: !declared.has(chainKey(v.slot, path))
		}
		for (const id of ids)
			if (typeof id === "number")
				add(id, use, `${pipeline.slug}\u0000${v.nodeKey}\u0000${v.slot}\u0000${path}`)
	}

	// Configurations are retired (R50, 0110): their value rows hold nothing.
	for (const o of (await db.select().from(schema.pipelineNodeOverrides)) as any[])
		note(o, o.specId)
	// 🚧 R50: a pipeline's instance values attach chains too.
	for (const p of bySpec.values()) {
		const { instanceStoredValues } = await import("$lib/server/pipelines/registrations/instanceValues")
		for (const v of await instanceStoredValues(db, p.slug)) note(v, p.specId)
	}

	// 🚧 And every registration's values (R38, PLAN-layering D5): a chain a
	// preset, the genre's defaults or a session attached by registration is a
	// use like a configuration's was. A change row names its pipeline by the
	// registration it changes.
	{
		const regRows = (await db.select().from(schema.registrations)) as any[]
		const { baseKeyOf } = await import("$lib/server/pipelines/registrations/rows")
		const slugOfKey = new Map<string, string>()
		for (const r of regRows) if (r.specSlug && !slugOfKey.has(r.key)) slugOfKey.set(r.key, r.specSlug)
		const specIdOfSlug = new Map<string, number>(
			[...bySpec.values()].map((p) => [p.slug, p.specId] as const)
		)
		for (const r of regRows) {
			if (!r.values || typeof r.values !== "object") continue
			const slug = r.specSlug ?? slugOfKey.get(baseKeyOf(r.key))
			const specId = slug ? specIdOfSlug.get(slug) : undefined
			if (specId == null) continue
			for (const [nodeKey, slots] of Object.entries(r.values as Record<string, Record<string, unknown>>))
				for (const [slot, value] of Object.entries(slots ?? {})) {
					if (Array.isArray(value) || typeof value === "number") {
						note({ nodeKey, slot, path: "", value }, specId)
						continue
					}
					if (value && typeof value === "object")
						for (const [path, v] of Object.entries(value as Record<string, unknown>))
							note({ nodeKey, slot, path, value: v }, specId)
				}
		}
	}

	// Connection attachments count too (18 §4b): a stop guard riding a
	// connection is a reference like any chain's, and a delete that stranded
	// one would be an attachment that stores cleanly and does nothing.
	const attachments = await db
		.select({
			scriptId: schema.connectionScripts.scriptId,
			connectionId: schema.connections.id,
			connectionName: schema.connections.name
		})
		.from(schema.connectionScripts)
		.innerJoin(
			schema.connections,
			eq(schema.connectionScripts.connectionId, schema.connections.id)
		)
	for (const a of attachments as any[])
		add(
			a.scriptId,
			{
				kind: "connection",
				connectionId: a.connectionId,
				connectionName: a.connectionName
			},
			`connection\u0000${a.connectionId}`
		)

	return out
}

/** The seams a script of `typeId` fits, across enabled pipelines. */
function fitsOf(typeId: string, pipelines: PipelineScriptSeams[]): ScriptFits {
	let seams = 0
	const slugs = new Set<string>()
	const steps = new Set<string>()
	const at = new Set<string>()
	const genres = new Set<string>()
	for (const p of pipelines) {
		if (p.disabled) continue
		let fits = false
		for (const seam of p.seams) {
			if (!seam.accepts.includes(typeId)) continue
			seams++
			fits = true
			steps.add(seam.stepLabel)
			at.add(seam.at)
		}
		if (!fits) continue
		slugs.add(p.slug)
		for (const g of p.genres) genres.add(g.name)
	}
	const sorted = (s: Set<string>) => [...s].sort((a, b) => a.localeCompare(b))
	return {
		seams,
		pipelines: [...slugs],
		steps: sorted(steps),
		at: sorted(at),
		genres: sorted(genres)
	}
}

const NO_FITS: ScriptFits = { seams: 0, pipelines: [], steps: [], at: [], genres: [] }

const record = (
	r: any,
	use: ScriptUseRow[] | undefined,
	fits: ScriptFits = NO_FITS
): ScriptRecord => ({
	id: r.id,
	typeId: r.typeId,
	name: r.name,
	isImmutable: !!r.isImmutable,
	enabled: !!r.enabled,
	source: r.source ?? "",
	varsIn: (r.varsIn ?? []) as string[],
	varsOut: (r.varsOut ?? []) as string[],
	usedBy: [...new Set((use ?? []).map(useWords))].sort(),
	use: use ?? [],
	fits
})

/**
 * The management page's one read: every type, every row, what holds it and
 * where it could go. `secret` keys the step and option handles the
 * *Where used* links carry; without it they are empty.
 */
export async function scriptsView(
	db: Db,
	opts: { secret?: string } = {}
): Promise<ScriptsView> {
	// A disabled plugin's script types, and the scripts written for them, are
	// not listed (R67); they come back when it is turned on.
	const { disabledPlugins } = await import("$lib/server/plugins/disabledPlugins")
	const off = await disabledPlugins(db)
	const types = (await scriptTypeInfos(db)).filter((t) => !off.ownsId(t.typeId))
	const pipelines = await pipelineScriptSeams(db)
	const use = await scriptUsageIndex(db, opts.secret ?? null, pipelines)
	const fitsByType = new Map<string, ScriptFits>()
	const fitsFor = (typeId: string) => {
		let f = fitsByType.get(typeId)
		if (!f) fitsByType.set(typeId, (f = fitsOf(typeId, pipelines)))
		return f
	}
	const scripts = (
		(await db
			.select()
			.from(schema.pipelineScripts)
			.orderBy(asc(schema.pipelineScripts.id))) as any[]
	)
		.filter((r) => !off.ownsId(r.typeId))
		.map((r) => record(r, use.get(r.id), fitsFor(r.typeId)))
	const pipelineLabels: Record<string, string> = {}
	for (const p of pipelines) pipelineLabels[p.slug] = p.label
	return { types, scripts, pipelineLabels }
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
	const holders = new Set((use.get(scriptId) ?? []).map(useWords))
	if (holders.size)
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
