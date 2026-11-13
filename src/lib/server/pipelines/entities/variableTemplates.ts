/**
 * How a context variable is rendered, as a swappable entity.
 *
 * The same pattern as `prompts.ts` — the config stores a reference, this row
 * holds the content — with one deliberate difference that is worth stating
 * before anyone tidies it away.
 *
 * ## There is no spec check here, and there must not be
 *
 * `prompts.ts` refuses a prompt written for another pipeline, because a session
 * reply's wording has no business in a summarizer's picker. Copying that check
 * here would compile, pass review, and silently delete the entire reason this
 * table exists.
 *
 * A *rendering* is a statement about a variable, not about a pipeline. "Show me
 * my characters as prose" is true of characters wherever they appear, so a row
 * written while configuring the reply pipeline is selectable from the narrator
 * pipeline, from a plugin's pipeline, from anything that renders the same
 * variable id. Selection is checked against `variableId` and against nothing
 * else.
 *
 * ## The refusals that remain
 *
 * Both are the ones that keep a selection meaningful: a shipped row is never
 * edited or deleted in place (it is the floor other configurations fall back
 * to), and a referenced row is never deleted (a config holding the id of a
 * deleted row is a selection that stores cleanly and does nothing).
 */

import { and, asc, eq, inArray, isNull, ne } from "drizzle-orm"
import * as schema from "$lib/server/db/schema"
import { CORE_TEMPLATE_ENGINE } from "$lib/server/pipelines/prompt/renderers"
import { parseTemplate } from "$lib/shared/utils/templateValidation"
import {
	formatLayoutReference,
	layoutSlugOf,
	parseLayoutReference,
	variableMajorOf
} from "$lib/server/pipelines/entities/objectVariableLayouts"

// The pair (the SDK's grammar) and the slug helper live in
// `objectVariableLayouts.ts` (pure, so the data upgrade shares them) and are
// re-exported here, where the sockets look for them.
export { formatLayoutReference, layoutSlugOf, parseLayoutReference }

/** The template named nothing here — deleted since the list was loaded. */
export class VariableTemplateNotFoundError extends Error {}

/** The template exists but may not be used this way. Message is for a person. */
export class VariableTemplateNotUsableError extends Error {}

export interface VariableTemplateRecord {
	id: number
	variableId: string
	/**
	 * The language it is written in. Never null.
	 *
	 * It used to be nullable, meaning "core's default". That reading was the
	 * live coercion this table had and context templates only threatened:
	 * `renderVariable` passes this straight to `renderTemplate`, so a NULL was
	 * a layout rendered in whatever core happens to ship rather than in what it
	 * was written in. The column is NOT NULL now and a caller passing nothing
	 * is normalized on the way in, which is what the nullable column was always
	 * trying and failing to say.
	 */
	engine: string
	name: string
	source: string
	isImmutable: boolean
	/** 🚧 The layout reference a template names it by; null on a person's row until given one. */
	reference: string | null
	/** 🚧 Whether this row is the pub's layout for its variable. */
	pubDefault: boolean
}

const toRecord = (r: any): VariableTemplateRecord => ({
	id: r.id,
	variableId: r.variableId,
	engine: r.engine ?? CORE_TEMPLATE_ENGINE,
	name: r.name,
	source: r.source ?? "",
	isImmutable: !!r.isImmutable,
	reference: r.reference ?? null,
	pubDefault: !!r.pubDefault
})

// ── 🚧 the pub's layout, references, a preset's variable layouts ────────
// (PLAN variable-layouts 2026-11-10.) The read half every reader shares —
// the run's resolution (`config/world.ts`), the sockets and the data
// upgrade's tests — so the screen and the run agree on what a variable is
// written out with. Withdrawn rows (a disabled plugin's) never answer.

/** The pub's layout for a variable — the row marked `pub_default` — or null. */
export async function pubLayoutOf(
	db: Db,
	variableId: string
): Promise<number | null> {
	const [row] = await db
		.select({ id: schema.pipelineVariableTemplates.id })
		.from(schema.pipelineVariableTemplates)
		.where(
			and(
				eq(schema.pipelineVariableTemplates.variableId, variableId),
				eq(schema.pipelineVariableTemplates.pubDefault, true),
				isNull(schema.pipelineVariableTemplates.withdrawnAt)
			)
		)
		.limit(1)
	return row?.id ?? null
}

/** The row a layout reference names within its variable, or null (unknown, or withdrawn). */
export async function layoutByReference(
	db: Db,
	variableId: string,
	reference: string
): Promise<number | null> {
	const [row] = await db
		.select({ id: schema.pipelineVariableTemplates.id })
		.from(schema.pipelineVariableTemplates)
		.where(
			and(
				eq(schema.pipelineVariableTemplates.variableId, variableId),
				eq(schema.pipelineVariableTemplates.reference, reference),
				isNull(schema.pipelineVariableTemplates.withdrawnAt)
			)
		)
		.limit(1)
	return row?.id ?? null
}

/** A preset's variable layouts as stored — `{ [variableId]: reference }`, `{}` when none. */
export async function presetVariableLayoutsOf(
	db: Db,
	presetId: number
): Promise<Record<string, string>> {
	const [row] = await db
		.select({ variableLayouts: schema.sessionPresets.variableLayouts })
		.from(schema.sessionPresets)
		.where(eq(schema.sessionPresets.id, presetId))
		.limit(1)
	const v = row?.variableLayouts
	if (!v || typeof v !== "object" || Array.isArray(v)) return {}
	return Object.fromEntries(
		Object.entries(v).filter(([, ref]) => typeof ref === "string")
	) as Record<string, string>
}

/**
 * Every rendering available for one variable, shipped ones first.
 *
 * Scoped by variable and by nothing else — which is what makes a template
 * written in one pipeline appear in another's picker.
 */
export async function listVariableTemplates(
	db: Db,
	variableId: string
): Promise<VariableTemplateRecord[]> {
	const rows = await db
		.select()
		.from(schema.pipelineVariableTemplates)
		.where(eq(schema.pipelineVariableTemplates.variableId, variableId))
		.orderBy(asc(schema.pipelineVariableTemplates.id))

	return (rows as any[])
		.map(toRecord)
		.sort((a, b) => Number(b.isImmutable) - Number(a.isImmutable))
}

/**
 * Check that a template may be selected for a declaration, and say why not.
 *
 * The one rule: it has to render the variable the slot declares. A template
 * written for `core:var/personas@1` selected into the characters slot would
 * reference `personas` in its source, find nothing in scope, and render empty —
 * a prompt silently missing its cast, which looks like a model failure.
 */
export async function assertSelectable(
	db: Db,
	variableId: string,
	templateId: number
): Promise<VariableTemplateRecord> {
	const [row] = await db
		.select()
		.from(schema.pipelineVariableTemplates)
		.where(eq(schema.pipelineVariableTemplates.id, templateId))
		.limit(1)

	if (!row)
		throw new VariableTemplateNotFoundError(
			"That layout no longer exists. It may have been deleted since the " +
				"list was loaded."
		)

	if (row.variableId !== variableId)
		throw new VariableTemplateNotUsableError(
			`'${row.name}' lays out something else, so it has nothing to show here. ` +
				`A layout is written against one kind of value — pick one offered for ` +
				`this setting, or duplicate it and adapt the copy.`
		)

	return toRecord(row)
}

/**
 * Resolve a reference into the template a run actually renders.
 *
 * The dereference step, identical in shape to `resolvePromptFields` and
 * deliberately so: two swappable entities resolved two different ways are two
 * places for the same bug.
 *
 * Returns null rather than throwing on a dangling id. The caller falls back to
 * the in-code default, which still emits today's bytes — a missing row should
 * cost a customization, never a prompt.
 */
export async function resolveVariableTemplate(
	db: Db,
	templateId: number
): Promise<{
	variableId: string
	engine: string
	source: string
	name: string
	origin: "shipped" | "package" | "own"
} | null> {
	const [row] = await db
		.select()
		.from(schema.pipelineVariableTemplates)
		.where(eq(schema.pipelineVariableTemplates.id, templateId))
		.limit(1)
	if (!row) return null
	return {
		// What the row was written against — the caller compares it with what
		// the key renders, and drops a row written for some other variable.
		variableId: row.variableId,
		engine: row.engine ?? CORE_TEMPLATE_ENGINE,
		source: row.source ?? "",
		// For the receipt's per-key line (2026-10-13): which row, and whose.
		name: row.name,
		origin:
			row.ownerPluginId != null
				? "package"
				: row.seedKey != null || row.isImmutable
					? "shipped"
					: "own"
	}
}

/**
 * An engine id as the name of a language, for a message a person reads.
 *
 * Falls back to the raw id when the shape is unfamiliar — a plugin may publish
 * anything, and a confident wrong guess in a refusal is worse than an id.
 */
const languageOf = (engineId: string): string => {
	const name = engineId.split("/")[1]?.split("@")[0]
	if (!name) return engineId
	return name.charAt(0).toUpperCase() + name.slice(1)
}

/**
 * Refuse a layout that does not parse, in the engine the row declares.
 *
 * `renderVariable` hands this source straight to `renderTemplate`, so a stored
 * layout that does not parse is every prompt that renders that variable
 * failing — at generation time, far from the edit. The engine's own words are
 * passed through: they name the construct and point at the character.
 */
function refuseUnparsable(engine: string, source: string, name: string): void {
	const err = parseTemplate(engine, source)
	if (!err) return
	throw new VariableTemplateNotUsableError(
		`'${name}' is not valid ${languageOf(engine)}` +
			(err.line ? ` (line ${err.line})` : "") +
			`:\n${err.message}`
	)
}

/** The two halves of a layout reference a person types; the major is the variable's. */
export interface LayoutReferenceInput {
	/** `core`, or the plugin slug this pub's own layout is filed under. */
	ownerSlug: string
	/** kebab-case; unique among the variable's layouts. */
	slug: string
}

export interface CreateVariableTemplateInput {
	variableId: string
	name: string
	source: string
	engine?: string | null
	seedKey?: string
	isImmutable?: boolean
	/** 🚧 The layout reference to give the new row (W3). Absent: a row with none, as before. */
	reference?: LayoutReferenceInput | null
	/** 🚧 Make the new row the pub's layout in the same step ("use it everywhere"). */
	useEverywhere?: boolean
}

/**
 * The reference `{ ownerSlug, slug }` makes for a variable — its major is the
 * variable's own (`@1` unless the id says otherwise). Refuses, in words, a
 * malformed one.
 */
function referenceOf(
	variableId: string,
	input: LayoutReferenceInput,
	/** A person's row: not shipped, not a package's. The owner `core` is Serene Pub's own. */
	personsRow: boolean
): string {
	if (personsRow && String(input.ownerSlug).trim().toLowerCase() === "core")
		throw new VariableTemplateNotUsableError(
			"core is Serene Pub's own. Use an owner slug of your own."
		)
	const parts = {
		owner: input.ownerSlug,
		slug: input.slug,
		major: variableMajorOf(variableId) ?? 1
	}
	let ref: string | null = null
	try {
		ref = formatLayoutReference(parts)
	} catch {
		// The SDK throws on a part outside its grammar; said in words below.
	}
	if (ref === null || !parseLayoutReference(ref))
		throw new VariableTemplateNotUsableError(
			`'${parts.owner}/${parts.slug}@${parts.major}' is not a valid layout reference. It reads ` +
				`<owner>/<name>@<number> — the name in lower case with dashes, for example 'acme/prose@1'.`
		)
	return ref
}

/** A row a person made: no seed key, no plugin, not immutable. */
const isPersonsRow = (row: {
	seedKey: string | null
	ownerPluginId: number | null
	isImmutable: boolean
}): boolean => !row.seedKey && row.ownerPluginId == null && !row.isImmutable

/** Refuse a reference another layout of the variable already goes by. */
async function refuseTakenReference(
	db: Db,
	variableId: string,
	reference: string,
	exceptId: number | null
): Promise<void> {
	const [taken] = await db
		.select({
			id: schema.pipelineVariableTemplates.id,
			name: schema.pipelineVariableTemplates.name
		})
		.from(schema.pipelineVariableTemplates)
		.where(
			and(
				eq(schema.pipelineVariableTemplates.variableId, variableId),
				eq(schema.pipelineVariableTemplates.reference, reference),
				exceptId == null
					? undefined
					: ne(schema.pipelineVariableTemplates.id, exceptId)
			)
		)
		.limit(1)
	if (taken)
		throw new VariableTemplateNotUsableError(
			`'${taken.name}' already goes by '${reference}' for this variable. A layout's ` +
				`reference is its name in templates, so each one needs its own — pick another name.`
		)
}

export async function createVariableTemplate(
	db: Db,
	input: CreateVariableTemplateInput
): Promise<VariableTemplateRecord> {
	refuseUnparsable(
		input.engine ?? CORE_TEMPLATE_ENGINE,
		input.source,
		input.name
	)
	const reference = input.reference
		? referenceOf(
				input.variableId,
				input.reference,
				!input.seedKey && !input.isImmutable
			)
		: null
	const insert = async (conn: Db) => {
		if (reference)
			await refuseTakenReference(conn, input.variableId, reference, null)
		const [row] = await conn
			.insert(schema.pipelineVariableTemplates)
			.values({
				variableId: input.variableId,
				name: input.name,
				source: input.source,
				// `null` from a caller means "core's", which is what the nullable
				// column meant. Resolved before the insert so the stored row keeps
				// what it was authored in even if core's default moves later —
				// which is the argument the column's own note has always made.
				engine: input.engine ?? CORE_TEMPLATE_ENGINE,
				seedKey: input.seedKey ?? null,
				isImmutable: input.isImmutable ?? false,
				reference
			})
			.returning()
		return row
	}
	if (!input.useEverywhere) return toRecord(await insert(db))
	// One step: the row and its becoming the pub's layout land together or not at all.
	return await db.transaction(async (tx: Db) => {
		const row = await insert(tx)
		await setPubLayoutIn(tx, row.variableId, row.id)
		return toRecord({ ...row, pubDefault: true })
	})
}

/**
 * Make one row the pub's layout for its variable, or — `null` — hand the
 * variable back to the package's default. `tx` or the db, one writer of the
 * flag: clear the variable's rows, then set the one.
 */
async function setPubLayoutIn(
	conn: Db,
	variableId: string,
	templateId: number | null
): Promise<void> {
	if (templateId != null) {
		const [row] = await conn
			.select()
			.from(schema.pipelineVariableTemplates)
			.where(eq(schema.pipelineVariableTemplates.id, templateId))
			.limit(1)
		if (!row)
			throw new VariableTemplateNotFoundError(
				"That layout no longer exists."
			)
		if (row.variableId !== variableId)
			throw new VariableTemplateNotUsableError(
				`'${row.name}' lays out something else, so it cannot be the layout for this variable.`
			)
		if (row.withdrawnAt)
			throw new VariableTemplateNotUsableError(
				`'${row.name}' belongs to a package that is switched off, so it cannot be the ` +
					`pub's layout until the package is back on.`
			)
	}
	await conn
		.update(schema.pipelineVariableTemplates)
		.set({ pubDefault: false })
		.where(
			and(
				eq(schema.pipelineVariableTemplates.variableId, variableId),
				eq(schema.pipelineVariableTemplates.pubDefault, true)
			)
		)
	if (templateId != null)
		await conn
			.update(schema.pipelineVariableTemplates)
			.set({ pubDefault: true })
			.where(eq(schema.pipelineVariableTemplates.id, templateId))
}

/**
 * 🚧 Choose the pub's layout for a variable: `templateId` must be one of its
 * rows and not withdrawn; `null` goes back to the package's default. One
 * transaction, so a variable never has two or none mid-change.
 */
export async function setPubLayout(
	db: Db,
	variableId: string,
	templateId: number | null
): Promise<void> {
	await db.transaction(async (tx: Db) => {
		await setPubLayoutIn(tx, variableId, templateId)
	})
}

/**
 * 🚧 Give an older row — one a person wrote before references existed — the
 * reference `<ownerSlug>/<its name as a slug>@<the variable's major>`. Only a
 * row with none; one that is taken, or whose name makes no slug, is refused.
 */
export async function stampReference(
	db: Db,
	templateId: number,
	ownerSlug: string
): Promise<VariableTemplateRecord> {
	const [row] = await db
		.select()
		.from(schema.pipelineVariableTemplates)
		.where(eq(schema.pipelineVariableTemplates.id, templateId))
		.limit(1)
	if (!row)
		throw new VariableTemplateNotFoundError("That layout no longer exists.")
	if (row.reference)
		throw new VariableTemplateNotUsableError(
			`'${row.name}' already goes by '${row.reference}', and a reference is fixed once ` +
				`it is given — templates and presets that name it would stop finding it.`
		)
	const slug = layoutSlugOf(row.name)
	if (!slug)
		throw new VariableTemplateNotUsableError(
			`'${row.name}' has no letters or digits to make a reference from. Rename it first.`
		)
	const reference = referenceOf(row.variableId, { ownerSlug, slug }, isPersonsRow(row))
	await refuseTakenReference(db, row.variableId, reference, row.id)
	const [updated] = await db
		.update(schema.pipelineVariableTemplates)
		.set({ reference, updatedAt: new Date() })
		.where(eq(schema.pipelineVariableTemplates.id, templateId))
		.returning()
	return toRecord(updated)
}

/**
 * Copy a template so it can be edited.
 *
 * The shipped ones are immutable, so "customize" is "duplicate then edit" — and
 * the copy keeps the original's `variableId`, which is what puts it in the same
 * picker everywhere that variable is rendered.
 */
export async function duplicateVariableTemplate(
	db: Db,
	templateId: number,
	name: string
): Promise<VariableTemplateRecord> {
	const [row] = await db
		.select()
		.from(schema.pipelineVariableTemplates)
		.where(eq(schema.pipelineVariableTemplates.id, templateId))
		.limit(1)
	if (!row)
		throw new VariableTemplateNotFoundError("That layout no longer exists.")

	return await createVariableTemplate(db, {
		variableId: row.variableId,
		name,
		source: row.source ?? "",
		engine: row.engine ?? CORE_TEMPLATE_ENGINE
	})
}

export async function updateVariableTemplate(
	db: Db,
	templateId: number,
	patch: {
		name?: string
		source?: string
		engine?: string | null
		/** 🚧 Gives a row with no reference one; a row that has one keeps it (fixed once saved). */
		reference?: LayoutReferenceInput | null
	}
): Promise<void> {
	const [row] = await db
		.select()
		.from(schema.pipelineVariableTemplates)
		.where(eq(schema.pipelineVariableTemplates.id, templateId))
		.limit(1)
	if (!row)
		throw new VariableTemplateNotFoundError("That layout no longer exists.")
	if (row.isImmutable)
		throw new VariableTemplateNotUsableError(
			`'${row.name}' is one of the layouts Serene Pub ships, so it stays as it ` +
				`is. Duplicate it and edit the copy — everything already pointing at ` +
				`the original keeps working.`
		)

	const rowEngine = row.engine ?? CORE_TEMPLATE_ENGINE
	const nextEngine =
		patch.engine === undefined
			? rowEngine
			: (patch.engine ?? CORE_TEMPLATE_ENGINE)

	// Same rule as a context template: a language is chosen when the row is
	// created, because storing the text under a different engine id does not
	// translate it — it makes every tag in it literal output.
	if (nextEngine !== rowEngine && (row.source ?? "").trim())
		throw new VariableTemplateNotUsableError(
			`'${row.name}' is written in ${languageOf(rowEngine)}, and saving it as ` +
				`${languageOf(nextEngine)} would not translate a word of it — its markup ` +
				`would be sent to the model as ordinary text. Duplicate it and rewrite ` +
				`the copy in ${languageOf(nextEngine)}.`
		)

	if (patch.source !== undefined)
		refuseUnparsable(nextEngine, patch.source, patch.name ?? row.name)

	// A reference is how templates and presets name the row, so once saved it is
	// fixed; asking for the same one again is not a change.
	let nextReference: string | undefined
	if (patch.reference) {
		const wanted = referenceOf(row.variableId, patch.reference, isPersonsRow(row))
		if (row.reference && row.reference !== wanted)
			throw new VariableTemplateNotUsableError(
				`'${row.name}' already goes by '${row.reference}', and a reference is fixed once ` +
					`it is saved — templates and presets that name it would stop finding it. ` +
					`Duplicate the layout to have one under another name.`
			)
		if (!row.reference) {
			await refuseTakenReference(db, row.variableId, wanted, row.id)
			nextReference = wanted
		}
	}

	await db
		.update(schema.pipelineVariableTemplates)
		.set({
			...(nextReference ? { reference: nextReference } : {}),
			...(patch.name !== undefined ? { name: patch.name } : {}),
			...(patch.source !== undefined ? { source: patch.source } : {}),
			// Same normalization as create: the picker sends `null` for "core's
			// default", and the column no longer has a way to hold that.
			...(patch.engine !== undefined
				? { engine: patch.engine ?? CORE_TEMPLATE_ENGINE }
				: {}),
			updatedAt: new Date()
		})
		.where(eq(schema.pipelineVariableTemplates.id, templateId))
}

/**
 * Which slot names carry a variable reference, across every published pipeline.
 *
 * Read from the node registry's slot declarations (`kind === "variables"`) of
 * every active spec's nodes, rather than assumed to be `'variables'`: the row
 * stores the slot's *authored* name, and a plugin may call its slot anything.
 * Hard-coding the core name would let a plugin's reference go unseen, and an
 * unseen reference is a delete that succeeds and leaves a dangling pointer.
 */
export async function variableSlotNames(db: Db): Promise<string[]> {
	const specs = await db.select().from(schema.pipelineSpecs)
	const versionIds = specs
		.map((s) => s.activeVersionId)
		.filter((v): v is number => v != null)
	if (!versionIds.length) return []
	const nodes = await db
		.select({
			definitionId: schema.pipelineNodes.definitionId,
			definitionVersion: schema.pipelineNodes.definitionVersion
		})
		.from(schema.pipelineNodes)
		.where(inArray(schema.pipelineNodes.specVersionId, versionIds))
	const pins = new Set(
		nodes.map((n) => `${n.definitionId}@${n.definitionVersion}`)
	)
	const registry = await db.select().from(schema.pipelineDefinitionRegistry)
	const names = new Set<string>()
	for (const r of registry as any[]) {
		if (!pins.has(`${r.definitionId}@${r.version}`)) continue
		for (const [slot, decl] of Object.entries(
			(r.slots ?? {}) as Record<string, { kind?: string }>
		))
			if (decl?.kind === "variables") names.add(slot)
	}
	return [...names]
}

/**
 * Delete a template — with the two refusals that keep a selection meaningful.
 *
 * The reference check spans every pipeline, which is the cross-pipeline feature
 * seen from its other side: a row the reply pipeline stopped using may still be
 * the narrator's, and this is the only place that would notice.
 */
export async function deleteVariableTemplate(
	db: Db,
	templateId: number,
	opts: {
		/**
		 * Override rows that do **not** count as references.
		 *
		 * The caller's own selection of the row it is deleting: the Delete
		 * button sits beside the *selected* layout, and selecting is itself a
		 * reference, so without this the button is unreachable.
		 *
		 * Passed in rather than released before the call, which is how this
		 * started and which was wrong in a way only live use showed. Releasing
		 * first meant a *refused* delete — the common case here, since another
		 * pipeline holding the row is exactly what refuses — still cleared the
		 * caller's selection on the way to failing. The row survived, the
		 * choice did not, and the error message said nothing about it.
		 */
		ignoreOverrideIds?: Set<number>
		/**
		 * 🚧 Registration values that do not count (`refKeyOf`) — an
		 * administrator's own instance-wide selection, now a change on the
		 * genre's defaults (PLAN-layering D5).
		 */
		ignoreRegistrationRefs?: Set<string>
	} = {}
): Promise<void> {
	const [row] = await db
		.select()
		.from(schema.pipelineVariableTemplates)
		.where(eq(schema.pipelineVariableTemplates.id, templateId))
		.limit(1)
	if (!row)
		throw new VariableTemplateNotFoundError("That layout no longer exists.")
	if (row.isImmutable)
		throw new VariableTemplateNotUsableError(
			`'${row.name}' is one of the layouts Serene Pub ships, so it stays. It ` +
				`is the fallback other configurations rely on.`
		)

	// 🚧 The three things that keep a layout: it is the pub's layout; a preset
	// chose it for its sessions; a step still has it picked (a leftover pick).
	// The fourth, in the same block as the preset check: a context template names it by reference.
	if (row.pubDefault)
		throw new VariableTemplateNotUsableError(
			`'${row.name}' is the pub's layout for this variable — every prompt that writes it ` +
				`out uses it. Choose another layout for the variable (or the package's default) ` +
				`first, then delete this one.`
		)
	if (row.reference) {
		// The same rule the library's *Used by* and the variable page read, so a
		// refusal never names a use those pages do not show.
		const { layoutRowUses } = await import(
			"$lib/server/pipelines/config/variableLayoutsView"
		)
		const uses = (await layoutRowUses(db, [row])).get(row.id)!
		const chosenBy = uses.presets.map((p) => p.name)
		if (chosenBy.length)
			throw new VariableTemplateNotUsableError(
				`'${row.name}' is chosen by ${chosenBy.length === 1 ? "this preset" : "these presets"}: ` +
					`${chosenBy.map((n) => `'${n}'`).join(", ")}. Choose another layout there first, ` +
					`then delete this one.`
			)
		const named = uses.namedBy.map((t) => t.name)
		if (named.length)
			throw new VariableTemplateNotUsableError(
				`'${row.name}' is named by ${named.length === 1 ? "this context template" : "these context templates"}: ` +
					`${named
						.slice(0, 3)
						.map((n) => `'${n}'`)
						.join(", ")}${named.length > 3 ? ` and ${named.length - 3} more` : ""}. ` +
					`Edit ${named.length === 1 ? "it" : "them"} to name another layout first, ` +
					`then delete this one.`
			)
	}

	const slots = await variableSlotNames(db)
	let referenced = false
	if (slots.length) {
		// Values are arbitrary json, which Postgres will not compare with `=`, so
		// this filters in code. The rows are few and the comparison is exact.
		const overrides = await db
			.select()
			.from(schema.pipelineNodeOverrides)
			.where(inArray(schema.pipelineNodeOverrides.slot, slots))
		const ignored = opts.ignoreOverrideIds ?? new Set<number>()
		// 🚧 Configurations are retired (R50, 0110): their value rows hold nothing.
		referenced = (overrides as any[]).some(
			(o) => o.value === templateId && !ignored.has(o.id)
		)
		// 🚧 A selection carried into a registration (a preset's, a session's,
		// the genre's defaults') holds it too (R38).
		if (!referenced) {
			const { registrationValueRefs, refKeyOf } = await import(
				"$lib/server/pipelines/registrations/values"
			)
			const ignoredRefs = opts.ignoreRegistrationRefs ?? new Set<string>()
			referenced = (await registrationValueRefs(db, slots)).some(
				(r) => r.value === templateId && !ignoredRefs.has(refKeyOf(r))
			)
		}
	}

	if (referenced)
		throw new VariableTemplateNotUsableError(
			`'${row.name}' is still in use — a pipeline step has it picked (a leftover ` +
				`pick). Layouts are shared across pipelines, so this may be one you set ` +
				`up elsewhere. Point that step at the pub's layout first, then ` +
				`delete this one.`
		)

	await db
		.delete(schema.pipelineVariableTemplates)
		.where(eq(schema.pipelineVariableTemplates.id, templateId))
}
