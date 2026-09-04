/**
 * What a pipeline says can be configured — read from rows, not from code.
 *
 * 12 §2 puts slot declarations in the type descriptor *"so a plugin Provider's
 * prompt fields render next to core's automatically, with no UI work"*, and F6
 * says core reads a plugin without executing it. Both are only true if the form
 * is generated from `pipeline_type_registry.slots` rather than from an
 * in-process descriptor map — which exists for core types, does not exist for a
 * `transport: 'process'` type, and is the exact thing F6 forbids reaching for.
 *
 * So everything here goes through the registry table. `declarations()` is the
 * entry point: a slug in, one `Decl` per configurable path out.
 */

import { asc, eq } from "drizzle-orm"
import * as schema from "$lib/server/db/schema"
import { poolKeyFor } from "$lib/server/pipelines/entities/contextTemplateDefaults"
import {
	WRITE_MATRIX,
	getVariable,
	BLOCK_MODE_DECL,
	type ParamDecl,
	type SlotDecl
} from "@serene-pub/sdk"
import { type Db, type Decl } from "$lib/server/pipelines/config/panel/types"

const KIND_TO_MATRIX_SLOT: Record<string, string> = {
	connection: "connection",
	sampling: "sampling",
	prompts: "prompts",
	template: "template",
	parameters: "params",
	// A wire format comes from the connection's adapter metadata and is an
	// admin's decision for the same reason the template is.
	wire: "template",
	variables: "variables",
	scripts: "scripts"
}

const PARAM_CONTROL: Record<string, string> = {
	number: "number",
	integer: "integer",
	string: "string",
	boolean: "boolean",
	enum: "enum",
	"string[]": "string[]",
	secret: "secret",
	// One control per shape of value, not per setting. The bar knows nothing
	// about retrieval — it renders whatever bands the declaration names, which
	// is what lets a plugin's own share parameter render without touching it.
	share: "share",
	perMember: "per-member"
}

/** `postHistoryInstructions` becomes `Post History Instructions`. */
function humanizeCamel(key: string): string {
	return key
		.replace(/([a-z0-9])([A-Z])/g, "$1 $2")
		.replace(/[_-]+/g, " ")
		.replace(/\s+/g, " ")
		.trim()
		.split(" ")
		.map((w) => w.charAt(0).toUpperCase() + w.slice(1))
		.join(" ")
}

/** `core:query/session-history@1` becomes `Session history` — from the row, not from code. */
export function humanizeTypeId(typeId: string): string {
	const tail = typeId.replace(/@\d+$/, "").split("/").pop() ?? typeId
	const words = tail.split(/[-_]/).join(" ")
	return words.charAt(0).toUpperCase() + words.slice(1)
}

/**
 * The English of an `I18n`, or undefined.
 *
 * Exported because `read.ts` resolves facet headings the same way, and a second
 * copy of "how display text is read out of a declaration" is the kind of
 * duplication this layer keeps finding at the point where the two disagree.
 */
export const i18nText = (v: unknown): string | undefined => {
	if (typeof v === "string") return v
	if (v && typeof v === "object") {
		const en = (v as { en?: unknown }).en
		if (typeof en === "string") return en
	}
	return undefined
}

/**
 * Expand one slot declaration into its addressable settings.
 *
 * A `prompts` or `parameters` slot is many settings, one per declared field, and
 * that granularity is what makes per-path resolution meaningful: a user
 * overriding `system` must not pin `postHistory` along with it (F20). The other
 * kinds are one value each and address the whole slot with an empty path —
 * which is what the `path` column's `''` default is for.
 */
function declsForSlot(
	nodeKey: string,
	slotName: string,
	decl: SlotDecl,
	typeLabel: string,
	typeId: string,
	nodeKind: string
): Decl[] {
	const matrixSlot = WRITE_MATRIX[slotName]
		? slotName
		: (KIND_TO_MATRIX_SLOT[decl.kind] ?? slotName)
	const facet = decl.facet ?? slotName
	const base = {
		nodeKey,
		slot: slotName,
		matrixSlot,
		facet,
		typeLabel,
		nodeKind,
		...((decl as { quick?: boolean }).quick ? { quick: true } : {}),
		...(decl.engine ? { engine: decl.engine } : {})
	}

	// One option, not one per declared field. A prompt is a **swappable entity**
	// (12 §2, and the `pipeline_prompts` note): the config holds a reference and
	// the text is edited in the prompt itself. Expanding the fields here would
	// put the same text in two editable places and make "which one wins" a
	// question the user has to hold in their head.
	//
	// The declared fields are still what a prompt is checked against on
	// selection — they are the schema, this is the pointer to the value.
	const slotDescription = i18nText(
		(decl as { description?: unknown }).description
	)

	if (decl.kind === "prompts")
		return [
			{
				...base,
				path: "",
				// The pool's first half — the second is `slot`, which every
				// Decl already carries. Together they are the whole selection
				// rule for a prompt, and the reason one crosses pipeline
				// boundaries: an action reusing this node is offered these same
				// rows, because the node does the same job wherever it runs.
				// Version stripped, for the reason `poolKeyFor` gives.
				nodeTypeId: poolKeyFor(typeId),
				promptFields: Object.keys(decl.fields ?? {}),
				label: humanizeCamel(slotName),
				...(slotDescription ? { description: slotDescription } : {}),
				// `prompts-ref`, not `prompt-ref`. The respond spec has a node
				// keyed `prompt`, and 05 §0a's scan reads `prompt-ref` as that
				// node key with a word boundary after it. Naming the control for
				// the *slot* — which is `prompts` — is both the correct name and
				// the one that does not trip a check worth keeping strict.
				control: "prompts-ref"
			}
		]

	// One option per key the slot renders, each pointing at a swappable layout
	// row. Expanded here rather than addressed as one slot value because the
	// keys are independent decisions — someone rendering characters as prose
	// has said nothing about their personas, and per-path resolution is what
	// keeps those separate (F20).
	if (decl.kind === "variables")
		return Object.entries(decl.renders ?? {}).map(([key, variableId]) => {
			// The registry is a fact about the running build; the declaration
			// came from a row. A variable whose plugin is disabled is therefore
			// normal, not an error — it falls back to the humanized key rather
			// than showing a raw id or vanishing from a panel that still has a
			// stored value for it.
			const v = getVariable(variableId as string)
			const description =
				i18nText(v?.description) ??
				i18nText(v?.i18n?.description) ??
				slotDescription
			return {
				...base,
				path: key,
				variableId: variableId as string,
				label: i18nText(v?.i18n?.name) ?? humanizeCamel(key),
				...(description ? { description } : {}),
				control: "variable-template-ref"
			}
		})

	if (decl.kind === "parameters")
		return Object.entries(decl.schema ?? {}).map(([param, raw]) => {
			const p = raw as ParamDecl
			const paramDescription = i18nText(p?.description)
			return {
				...base,
				path: param,
				label: i18nText(p?.i18n) ?? humanizeCamel(param),
				...(paramDescription ? { description: paramDescription } : {}),
				...(p?.quick ? { quick: true } : {}),
				control: PARAM_CONTROL[p?.type] ?? "string",
				...(p?.min != null ? { min: p.min } : {}),
				...(p?.max != null ? { max: p.max } : {}),
				// `of` from `members` when a labelled enum declared its
				// choices that way: the client still gets the value list it
				// has always read, and gets names beside it.
				...(p?.of
					? { of: p.of }
					: p?.type === "enum" && p?.members
						? { of: p.members.map((m) => m.key) }
						: {}),
				// Display text resolved here, like every other label the panel
				// sends — the client renders strings, it does not pick them.
				...(p?.members
					? {
							members: p.members.map((m) => ({
								key: m.key,
								label: i18nText(m.i18n) ?? humanizeCamel(m.key),
								...(i18nText(m.description)
									? { description: i18nText(m.description)! }
									: {}),
								...(m.tone != null ? { tone: m.tone } : {})
							}))
						}
					: {}),
				...(p?.default !== undefined
					? { authorDefault: p.default }
					: {})
			}
		})

	// A scripts slot is one option: the chain, addressed whole. The links are
	// an *ordered list* — splitting them into per-path settings would make the
	// order a fact spread across rows, and reordering a chain a multi-write.
	// The accepted types are the attachment rule (18 §4a): the picker offers
	// rows of these types and the write refuses everything else.
	if (decl.kind === "scripts")
		return [
			{
				...base,
				path: "",
				label: humanizeCamel(slotName),
				...(slotDescription ? { description: slotDescription } : {}),
				control: "scripts-chain",
				accepts: ((decl as { accepts?: string[] }).accepts ??
					[]) as string[]
			}
		]

	// A template slot holds a **reference**, the same way prompts and layouts
	// do. It used to hold the literal source, projected out of
	// `context_configs` by `world.ts`; that made the story string the one part
	// of a pipeline's configuration that lived outside the config layer, with
	// its own selection mechanism and no per-session scope. The row is the value
	// now, and `pipeline_context_templates` is where it lives.
	if (decl.kind === "template")
		return [
			{
				...base,
				path: "",
				nodeTypeId: poolKeyFor(typeId),
				label: humanizeCamel(slotName),
				...(slotDescription ? { description: slotDescription } : {}),
				control: "context-template-ref"
			}
		]

	const control =
		decl.kind === "connection"
			? "connection-ref"
			: decl.kind === "sampling"
				? "sampling-ref"
				: "string"

	return [
		{
			...base,
			path: "",
			label: humanizeCamel(slotName),
			...(slotDescription ? { description: slotDescription } : {}),
			control,
			// The modality this slot speaks, carried through so the picker can
			// offer only what fits (F17). Without it every connection and every
			// sampling config is a candidate for every slot, and the first thing
			// an image node would be offered is a text connection.
			...(decl.shape ? { shape: decl.shape } : {}),
			// What the connection must be able to do, and what the binding will
			// use if it is there. `requires` supersedes `shape` — it asks about a
			// transform rather than asserting a modality — so a slot declaring
			// both is narrowed by this and the shape is left as the older answer
			// for anything still reading it.
			...(decl.requires?.length ? { requires: decl.requires } : {}),
			...(decl.optional?.length ? { optional: decl.optional } : {}),
			...(decl.kind === "wire" && decl.format
				? { authorDefault: decl.format }
				: {})
		}
	]
}

/**
 * Qualify a label only where it would otherwise be ambiguous.
 *
 * The panel groups options by step, and the step heading is the type name — so
 * two nodes both declaring a `budget` are already told apart by where they sit.
 * What the heading cannot separate is two *slots on the same node* declaring
 * the same field name; those get the slot’s own name in front. Rare by
 * construction, but a panel showing "Budget" twice under one heading would be
 * exactly the two-boxes-one-meaning confusion this layer keeps closing.
 */
function disambiguate(decls: Decl[]): Decl[] {
	const seen = new Map<string, number>()
	for (const d of decls) {
		const k = `${d.nodeKey}\u0000${d.label}`
		seen.set(k, (seen.get(k) ?? 0) + 1)
	}
	return decls.map((d) =>
		(seen.get(`${d.nodeKey}\u0000${d.label}`) ?? 0) > 1
			? { ...d, label: `${humanizeCamel(d.slot)} - ${d.label}` }
			: d
	)
}

/**
 * Step headings, disambiguated by occurrence: a pipeline with two
 * `generate-text` nodes shows "Generate text" and "Generate text 2". The
 * counter is order-of-appearance, which is node position — stable for a
 * published version, because the rows are.
 */
export function stepLabels(
	nodeKeys: string[],
	typeLabelOf: Map<string, string>
): Map<string, string> {
	const totals = new Map<string, number>()
	for (const k of nodeKeys) {
		const t = typeLabelOf.get(k) ?? k
		totals.set(t, (totals.get(t) ?? 0) + 1)
	}
	const seen = new Map<string, number>()
	const out = new Map<string, string>()
	for (const k of nodeKeys) {
		const t = typeLabelOf.get(k) ?? k
		const n = (seen.get(t) ?? 0) + 1
		seen.set(t, n)
		out.set(k, (totals.get(t) ?? 0) > 1 && n > 1 ? `${t} ${n}` : t)
	}
	return out
}

export interface Published {
	specId: number
	specVersionId: number
	slug: string
	name: string
	semver: string
	/** Catalogue claims (23 §2), or null = unclassified. */
	taxonomy: { zone?: string; role?: string; mode?: string } | null
}

export async function published(
	db: Db,
	slug: string
): Promise<Published | null> {
	const [spec] = await db
		.select()
		.from(schema.pipelineSpecs)
		.where(eq(schema.pipelineSpecs.slug, slug))
		.limit(1)
	if (!spec?.activeVersionId) return null

	const [version] = await db
		.select()
		.from(schema.pipelineSpecVersions)
		.where(eq(schema.pipelineSpecVersions.id, spec.activeVersionId))
		.limit(1)
	if (!version) return null

	return {
		specId: spec.id,
		specVersionId: version.id,
		slug: spec.slug,
		name: spec.name,
		semver: version.semver,
		taxonomy: (version.taxonomy as any) ?? null
	}
}

/** What the spec subscribes to, and whether that subscription is live. */
export async function subscription(db: Db, specVersionId: number) {
	const [row] = await db
		.select()
		.from(schema.pipelineEventSubscriptions)
		.where(
			eq(schema.pipelineEventSubscriptions.specVersionId, specVersionId)
		)
		.orderBy(asc(schema.pipelineEventSubscriptions.id))
		.limit(1)
	return {
		event: (row?.eventRef as string | undefined) ?? null,
		enabled: row ? !!row.enabled : true
	}
}

/**
 * Every addressable setting in a published version, in a stable order.
 *
 * Exported because the config reconciler asks the same question when a new
 * version publishes — *what can be tuned here now* — and two answers to that
 * would mean the panel and the upgrade disagree about which of a user's values
 * still means something.
 *
 * Node position then declaration order, so an option's place in the panel does
 * not move between reads — and so the first writable option a keyboard user
 * lands on is the same one twice running.
 */
export async function declarations(
	db: Db,
	specVersionId: number
): Promise<Decl[]> {
	const nodes = await db
		.select()
		.from(schema.pipelineNodes)
		.where(eq(schema.pipelineNodes.specVersionId, specVersionId))
		.orderBy(asc(schema.pipelineNodes.position))

	const registry = await db.select().from(schema.pipelineTypeRegistry)
	const byPin = new Map<string, any>(
		(registry as any[]).map((r) => [`${r.typeId}@${r.version}`, r])
	)

	const out: Decl[] = []
	for (const node of nodes as any[]) {
		const row = byPin.get(`${node.typeId}@${node.typeVersion}`)
		if (!row) continue
		// The name the type declares, and only then a name made up from its id.
		// The row is already in hand here — it was being read for `slots` while
		// the label beside it was invented, so the panel called a node one
		// thing and the pipeline map called it another.
		const typeLabel =
			i18nText(row.i18n?.name) ?? humanizeTypeId(node.typeId)
		const slots = (row.slots ?? {}) as Record<string, SlotDecl>
		for (const [slotName, decl] of Object.entries(slots)) {
			// A slot the spec wired as a *reference to another node's* is not
			// this node's to configure: the owner's option is the one that
			// exists, and offering a second box for the same authored text is
			// the three-System-boxes defect (13 §12 finding i). The wiring
			// lives in the node's stored config — a `slot` ref with `ofNode`.
			const wired = (node.config ?? {})[slotName]
			if (
				wired &&
				typeof wired === "object" &&
				(wired as any).__ref === "slot" &&
				(wired as any).ofNode &&
				(wired as any).ofNode !== node.nodeKey
			)
				continue
			out.push(
				...declsForSlot(
					node.nodeKey,
					slotName,
					decl,
					typeLabel,
					node.typeId,
					String(row.kind ?? "")
				)
			)
		}

		// Every gated node offers its review position (01 §7) — synthesized
		// from the row's declared effects rather than authored per type,
		// because the gate itself keys on effects and a node the gate applies
		// to that the panel cannot configure would make F14's "an author
		// cannot forbid review" true in the executor and false on screen.
		// The executor reads it at `settings.review`; writing it here is what
		// parks the run and generates a form from the payload.
		// Only a node whose contract says an empty result is fine may be
		// switched off — `optional`, read from the row rather than from an
		// in-process descriptor that does not exist for a plugin type (F6).
		// Offering the control anywhere else would let somebody turn off a node
		// whose output the next one requires, and find out at the consumer.
		if (row.optional)
			out.push({
				nodeKey: node.nodeKey,
				slot: "settings",
				matrixSlot: "settings",
				path: "enabled",
				facet: "settings",
				quick: true,
				label: "Use this source",
				description:
					"Off skips the step entirely rather than fetching and discarding it — cheaper than starving it with a zero share.",
				control: "boolean",
				authorDefault: true,
				typeLabel,
				nodeKind: String(row.kind ?? "")
			})

		// Interior script points (18 §4e): one chain option per declared point,
		// addressed as slot `scripts` at the point's own path — which is where
		// the executor's `ctx.scripts.applyText` reads it, so what the panel
		// writes is what the broker runs. Read from the row like everything
		// else (F6); v1 points are text-transform only, matching the broker.
		for (const point of (row.scriptPoints ?? []) as Array<{
			key: string
			i18n?: unknown
			description?: unknown
		}>) {
			const description = i18nText(point.description)
			out.push({
				nodeKey: node.nodeKey,
				slot: "scripts",
				matrixSlot: "scripts",
				path: point.key,
				facet: "scripts",
				label: i18nText(point.i18n) ?? humanizeCamel(point.key),
				...(description ? { description } : {}),
				control: "scripts-chain",
				accepts: ["core:script:text/transform@1"],
				typeLabel,
				nodeKind: String(row.kind ?? "")
			})
		}

		if (row.effects === "write" || row.effects === "external")
			out.push({
				nodeKey: node.nodeKey,
				slot: "settings",
				matrixSlot: "settings",
				path: "review",
				facet: "review",
				label: "Review",
				description:
					"Pause this step for approval before it takes effect.",
				control: "enum",
				of: ["off", "on"],
				authorDefault: "off",
				typeLabel,
				nodeKind: String(row.kind ?? "")
			})
	}

	/**
	 * One option per block: does this group run together or in turn?
	 *
	 * Addressed by the block's id in the same `settings` slot a node's review
	 * uses, because that is how the executor reads it — blocks are passed to
	 * `resolveConfig` alongside nodes, so `settings.mode` on a block id
	 * resolves exactly like `settings.review` on a node key.
	 *
	 * The wording comes from `BLOCK_MODE_DECL` in the SDK rather than from
	 * here. A block is not a node type and has no descriptor to carry its
	 * label, which is precisely how a string ends up invented by whichever
	 * screen drew it.
	 */
	const blocks = await db
		.select()
		.from(schema.pipelineBlocks)
		.where(eq(schema.pipelineBlocks.specVersionId, specVersionId))
		.orderBy(asc(schema.pipelineBlocks.position))

	for (const block of blocks as any[]) {
		// `map` and `loop` have a mode too, but theirs is a property of what
		// they iterate rather than a choice about concurrency — offering it
		// would be a control whose effect nobody can predict from its label.
		if (block.kind !== "async") continue
		out.push({
			nodeKey: block.blockId,
			slot: "settings",
			matrixSlot: "settings",
			path: BLOCK_MODE_DECL.path,
			facet: "settings",
			label: i18nText(BLOCK_MODE_DECL.i18n) ?? "Run",
			...(i18nText(BLOCK_MODE_DECL.description)
				? { description: i18nText(BLOCK_MODE_DECL.description)! }
				: {}),
			control: "enum",
			of: BLOCK_MODE_DECL.of,
			authorDefault: block.mode ?? "parallel",
			typeLabel: humanizeCamel(block.blockId),
			nodeKind: "block"
		})
	}

	return disambiguate(out)
}
