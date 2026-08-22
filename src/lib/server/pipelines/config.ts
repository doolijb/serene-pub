/**
 * The configuration layer, as a read model and four writes (12 §2).
 *
 * Everything the pipeline view knows comes from here, and everything here comes
 * from **rows**. That is not a style preference: 12 §2 says slot declarations
 * live in the type descriptor *"so a plugin Provider's prompt fields render next
 * to core's automatically, with no UI work"*, and F6 says core reads a plugin
 * without executing it. Both are only true if the form is generated from
 * `pipeline_type_registry.slots` rather than from an in-process descriptor map —
 * which exists for core types, does not exist for a `transport: 'process'` type,
 * and is the exact thing F6 forbids reaching for.
 *
 * ## What an option is
 *
 * A `(nodeKey, slot, path)` address, resolved through the five layers, presented
 * as an opaque id and a label. 05 §0a puts structural editing behind a system
 * setting, so the payload carries **no topology** — not the node key, not the
 * count, not the order. The id is an HMAC over the address keyed on the instance
 * secret, which buys two things at once: it is not an encoding anyone can read
 * back, and a handle lifted from another install names nothing here.
 *
 * Resolving an id is therefore a *search* — mint every address's id and look for
 * a match — and that is deliberate. The alternative, a reversible encoding, is
 * the same leak the payload rule exists to prevent, one base64 decode away.
 *
 * ## Why the search runs over every option, including hidden ones
 *
 * An id naming a slot the asker may not write must fail as `OptionNotWritable`,
 * not as `OptionNotFound`. The two say different things to the person reading
 * them — *"connections are the administrator's"* versus *"that setting does not
 * exist"* — and only the first is true.
 *
 * ## Reset deletes
 *
 * `clearOption` removes the row rather than writing the inherited value into it.
 * The difference is invisible until the day an admin moves the instance value:
 * a deleted row inherits the new one, a pinned copy does not. That is the whole
 * point of resolving per path rather than per slot (F20).
 */

import { createHmac } from "node:crypto"
import { and, asc, eq } from "drizzle-orm"
import * as schema from "$lib/server/db/schema"
import { poolKeyFor } from "./contextTemplateDefaults"
import {
	WRITE_MATRIX,
	mayWrite,
	getVariable,
	type ScopeKind,
	type SlotDecl,
	type ParamDecl
} from "@serene-pub/sdk"

/** Loose on purpose — callers pass the app db and the test db interchangeably. */
type Db = {
	select: any
	insert: any
	update: any
	delete: any
}

/** Who is asking, and from where. `chatId` is set only for a chat they own. */
export interface Viewer {
	userId: number
	isAdmin: boolean
	chatId?: number
}

/** Where a value won. `author` means nothing overrode the declared default. */
export type OptionSource = "chat" | "user" | "preset" | "instance" | "author"

/** The scopes a person writes at. `preset` and `author` are not writable here. */
export type WriteScope = "chat" | "user" | "instance"

export interface ConfigOption {
	id: string
	label: string
	description?: string
	control: string
	min?: number
	max?: number
	of?: readonly string[]
	/**
	 * For a `*-ref` control: what this option may be pointed at.
	 *
	 * Sent with the option rather than fetched separately, because the list is
	 * *scoped by the declaration* — a prompts slot may only offer prompts from
	 * this namespace, and a connection slot only connections of the shape the
	 * node declared. A panel that fetched "all prompts" would have to re-derive
	 * both rules on the client, where the second copy eventually disagrees.
	 */
	choices?: Array<{ id: number; label: string; description?: string }>
	/**
	 * For a `prompts-ref` option: the row the resolved value points at, in
	 * full. The dropdown alone would leave "what does this prompt actually
	 * say" one fetch away, which in practice means a modal nobody opens —
	 * carrying the fields here is what makes clone-and-edit an inline
	 * gesture. `readOnly` mirrors the row's immutability: shipped prompts
	 * are cloned, never edited in place.
	 */
	prompt?: {
		id: number
		name: string
		fields: Record<string, string>
		readOnly: boolean
	}
	/**
	 * For a `variable-template-ref` option: the selected layout, in full, for
	 * the same reason `prompt` travels — a picker of names cannot answer "what
	 * does this actually produce", and the answer is the thing being chosen.
	 *
	 * The variable id is deliberately **not** here. It is a node-shaped string
	 * (`core:var/history@1`), and the payload is scanned for node keys; sending
	 * it would leak topology through a field nobody reads. The client never
	 * needs it — every write is addressed by the option's own handle.
	 */
	variableTemplate?: {
		id: number
		name: string
		source: string
		readOnly: boolean
	}
	/**
	 * For a `context-template-ref` option: the selected story string, in full.
	 *
	 * Same ride-along as `prompt` and `variableTemplate`, and here it matters
	 * most — a context template is the largest authored thing in the product,
	 * and a picker showing "Default" says nothing at all about what the prompt
	 * will look like.
	 *
	 * `nodeTypeId` is deliberately **not** here, for the reason the variable id
	 * is not: it is a node-shaped string the payload scan reads as topology,
	 * and the client never needs it — every write is addressed by the option's
	 * own handle.
	 */
	contextTemplate?: {
		id: number
		name: string
		source: string
		readOnly: boolean
		/** Which group it fell into, so the editor can say where it came from. */
		group?: string
		/** The pipeline it was written in, when that is not this one. */
		origin?: string
	}
	authorDefault?: unknown
	value: unknown
	source: OptionSource
	writable: boolean
	/**
	 * Set when this option's edits land somewhere other than the viewer's
	 * default scope — an admin's non-prompt options write at `instance`,
	 * because those *are* the application's configuration. The client sends
	 * it back with every set/clear so panel and write agree on the target.
	 */
	writeAt?: WriteScope
	/** True when a row exists at the scope this option's edits land at. */
	overriddenHere: boolean
}

/**
 * One node's worth of settings, in pipeline order.
 *
 * The panel groups by step because that is how a person thinks about a
 * pipeline — "the summarizing step's prompt", not "the prompts facet's third
 * box". This deliberately reveals the step count and order, which 05 §0a
 * originally withheld; the user ratified the trade for 0.6 (see DECOMPOSITION
 * §26). The `key` is still opaque — an index, never the node key — so the
 * payload names no addressable topology.
 *
 * `advanced` carries the tuning parameters (weights, budgets, thresholds):
 * present, but collapsed by default, because the person who came to change a
 * prompt should not have to scroll past nine numbers to find it.
 */
export interface ConfigStep {
	key: string
	label: string
	options: ConfigOption[]
	advanced: ConfigOption[]
}

/**
 * A named configuration the panel can offer — the shipped immutable default
 * plus any copies a person has made. One mechanism, not two: this is the same
 * `pipeline_configs` row the runtime resolves against in `world.ts`, so what
 * the picker shows is what the run uses.
 */
export interface NamedConfigSummary {
	id: number
	name: string
	isDefault: boolean
	readOnly: boolean
}

export interface NamespaceSummary {
	slug: string
	name: string
	version: string
	event: string | null
	enabled: boolean
}

export interface NamespaceView extends NamespaceSummary {
	configs: NamedConfigSummary[]
	selectedConfig: { id: number; name: string; source: string } | null
	steps: ConfigStep[]
	writeScope: WriteScope
}

/** The id named nothing here — a stale handle, or one minted on another install. */
export class OptionNotFoundError extends Error {}

/** The scope may not write that slot. The message is written for a person (15 §1.3). */
export class OptionNotWritableError extends Error {}

/* ------------------------------------------------------------------ *
 * Handles
 * ------------------------------------------------------------------ */

/**
 * The opaque handle for an address.
 *
 * Keyed on the instance secret so it is stable for this install and meaningless
 * on any other. Hex, and only hex: the payload is scanned for node keys, and an
 * id that could spell one would be a leak wearing a hash's clothes.
 */
export function optionId(
	secret: string,
	nodeKey: string,
	slot: string,
	path: string
): string {
	return createHmac("sha256", secret)
		.update(`${nodeKey}\u0000${slot}\u0000${path}`)
		.digest("hex")
		.slice(0, 32)
}

/* ------------------------------------------------------------------ *
 * Declarations
 * ------------------------------------------------------------------ */

/**
 * One addressable setting, before resolution.
 *
 * `matrixSlot` is separate from `slot` because the row stores the slot's
 * *authored name* — a plugin may call its parameters slot anything — while the
 * write matrix is keyed on the six names 12 §2 closes over. Collapsing the two
 * would either rewrite a plugin's slot name on the way into the database or
 * leave its options with no rule at all.
 */
export interface Decl {
	nodeKey: string
	slot: string
	matrixSlot: string
	path: string
	facet: string
	label: string
	/**
	 * Author-provided help text, when the descriptor carried one. Display
	 * only — it is stripped from the type content hash for the same reason
	 * `i18n` is, so copyediting an explanation never bumps a type version.
	 */
	description?: string
	control: string
	min?: number
	max?: number
	of?: readonly string[]
	authorDefault?: unknown
	/**
	 * For a template slot: which language its source is written in, as a
	 * registered engine id. Carried through so a stored value keeps its engine
	 * rather than inheriting whatever core happens to render with today.
	 */
	engine?: string
	/**
	 * For a prompts slot: the text fields the node declares.
	 *
	 * Carried through because a prompt is now selected rather than typed here,
	 * and this is the set a candidate prompt has to satisfy. It is the schema;
	 * the prompt row is the value.
	 */
	promptFields?: string[]
	/**
	 * For a variables slot: which registered context variable this key renders.
	 *
	 * The whole selection rule for a variable template, and the reason a layout
	 * crosses pipeline boundaries: candidates are narrowed by this and by
	 * nothing else. Server-side only — see `ConfigOption.variableTemplate`.
	 */
	variableId?: string
	/**
	 * For `context-template-ref`: the node type whose context the template
	 * renders, version stripped. The pool key — a picker offers rows matching
	 * it, and selection refuses across it.
	 */
	nodeTypeId?: string
	/** The type this came from — used only to disambiguate a repeated label. */
	typeLabel: string
}

const KIND_TO_MATRIX_SLOT: Record<string, string> = {
	connection: "connection",
	sampling: "sampling",
	prompts: "prompts",
	template: "template",
	parameters: "params",
	// A wire format comes from the connection's adapter metadata and is an
	// admin's decision for the same reason the template is.
	wire: "template",
	variables: "variables"
}

const PARAM_CONTROL: Record<string, string> = {
	number: "number",
	integer: "integer",
	string: "string",
	boolean: "boolean",
	enum: "enum",
	"string[]": "string[]",
	secret: "secret"
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

/** `core:query/chat-history@1` becomes `Chat history` — from the row, not from code. */
export function humanizeTypeId(typeId: string): string {
	const tail = typeId.replace(/@\d+$/, "").split("/").pop() ?? typeId
	const words = tail.split(/[-_]/).join(" ")
	return words.charAt(0).toUpperCase() + words.slice(1)
}

const i18nText = (v: unknown): string | undefined => {
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
	typeId: string
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
				control: PARAM_CONTROL[p?.type] ?? "string",
				...(p?.min != null ? { min: p.min } : {}),
				...(p?.max != null ? { max: p.max } : {}),
				...(p?.of ? { of: p.of } : {}),
				...(p?.default !== undefined
					? { authorDefault: p.default }
					: {})
			}
		})

	// A template slot holds a **reference**, the same way prompts and layouts
	// do. It used to hold the literal source, projected out of
	// `context_configs` by `world.ts`; that made the story string the one part
	// of a pipeline's configuration that lived outside the config layer, with
	// its own selection mechanism and no per-chat scope. The row is the value
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
function stepLabels(
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

/* ------------------------------------------------------------------ *
 * Loading
 * ------------------------------------------------------------------ */

interface Published {
	specId: number
	specVersionId: number
	slug: string
	name: string
	semver: string
}

async function published(db: Db, slug: string): Promise<Published | null> {
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
		semver: version.semver
	}
}

/** What the spec subscribes to, and whether that subscription is live. */
async function subscription(db: Db, specVersionId: number) {
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
		const typeLabel = humanizeTypeId(node.typeId)
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
					node.typeId
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
		if (row.effects === "write" || row.effects === "external")
			out.push({
				nodeKey: node.nodeKey,
				slot: "settings",
				matrixSlot: "settings",
				path: "review",
				facet: "review",
				label: "Review",
				description:
					"Pause this step for approval before it takes effect. " +
					"'sync' holds the run until someone decides; 'async' " +
					"records the request and continues.",
				control: "enum",
				of: ["off", "async", "sync"],
				authorDefault: "off",
				typeLabel
			})
	}
	return disambiguate(out)
}

/**
 * The address, as a map key.
 *
 * Joined on NUL rather than on a space, for the reason the SDK's resolver was
 * just fixed for: a space is a character a declared path may contain, so joining
 * on one lets two different addresses collide on the same key. No core path has
 * a space; nothing stops a plugin's from having one.
 */
const addr = (nodeKey: string, slot: string, path: string) =>
	`${nodeKey}\u0000${slot}\u0000${path}`

/**
 * The five layers, as lookups.
 *
 * Preset values are projected in at `preset` rather than stored beside the other
 * scopes — they live in a different table on purpose (see the schema note on
 * `pipelineNodeOverrides`), and the resolver is what puts the five back into one
 * ordered walk.
 */
async function layers(db: Db, at: Published, viewer: Viewer) {
	const overrides = await db
		.select()
		.from(schema.pipelineNodeOverrides)
		.where(eq(schema.pipelineNodeOverrides.specId, at.specId))

	const scoped = (kind: string, id: number) => {
		const m = new Map<string, unknown>()
		for (const o of overrides as any[])
			if (o.scopeKind === kind && o.scopeId === id)
				m.set(addr(o.nodeKey, o.slot, o.path ?? ""), o.value)
		return m
	}

	// The selected *named config*, resolved by the same function the runtime
	// uses (`world.ts applyPipelineLayer` → `resolveSelectedConfig`). One
	// mechanism on purpose: a panel that read a different table than the run
	// would agree with the user while the model did something else — the worst
	// class of bug in this area, because there is nothing to see.
	const { resolveSelectedConfig } = await import("./configs")
	const selectedConfig = await resolveSelectedConfig(db, at.specId, at.slug, {
		userId: viewer.userId,
		chatId: viewer.chatId ?? undefined
	})

	const preset = new Map<string, unknown>()
	if (selectedConfig) {
		const values = await db
			.select()
			.from(schema.pipelineConfigValues)
			.where(
				eq(
					schema.pipelineConfigValues.configId,
					selectedConfig.configId
				)
			)
		for (const v of values as any[])
			preset.set(addr(v.nodeKey, v.slot, v.path ?? ""), v.value)
	}

	return {
		chat: viewer.chatId != null ? scoped("chat", viewer.chatId) : null,
		user: scoped("user", viewer.userId),
		preset,
		instance: scoped("instance", 0),
		selectedConfig
	}
}

/* ------------------------------------------------------------------ *
 * What a reference may point at
 * ------------------------------------------------------------------ */

type ChoiceList = Array<{ id: number; label: string; description?: string }>

/**
 * Everything a `*-ref` option in this pipeline may be pointed at.
 *
 * Loaded once per view rather than per option: a spec with five provider nodes
 * asks the same three questions five times, and the answers cannot differ
 * between nodes of the same slot kind except by declared shape, which is
 * applied below.
 */
async function choiceSets(db: Db, specId: number) {
	const prompts = await db
		.select()
		.from(schema.pipelinePrompts)
		.where(eq(schema.pipelinePrompts.specId, specId))
		.orderBy(asc(schema.pipelinePrompts.id))

	const connections = await db
		.select()
		.from(schema.connections)
		.orderBy(asc(schema.connections.id))

	const sampling = await db
		.select()
		.from(schema.samplingConfigs)
		.orderBy(asc(schema.samplingConfigs.id))

	// Every context template on the instance, pooled by node type rather than
	// by spec — the same rule layouts follow, for the same reason: chat reply
	// and the narrator run the same assemble node, so one story string serves
	// both and always has. Narrowed per option by `nodeTypeId` below, and
	// grouped so the pipeline being configured comes first.
	const contextTemplateRows = await db
		.select()
		.from(schema.pipelineContextTemplates)
		.orderBy(asc(schema.pipelineContextTemplates.id))

	const specRows = await db.select().from(schema.pipelineSpecs)
	// The display name, not the slug: `from core:spec/respond` is the id a
	// developer reads and `from Chat reply` is the thing a user recognises,
	// and this string is a subtitle in a picker.
	const nameById = new Map<number, string>(
		(specRows as any[]).map((r) => [r.id, r.name ?? r.slug])
	)

	const contextTemplatesBy = new Map<string, ChoiceList>()
	const CT_ORDER = { usedHere: 0, shipped: 1, alsoFits: 2 } as const
	for (const t of contextTemplateRows as any[]) {
		const group: keyof typeof CT_ORDER =
			t.createdForSpecId === specId
				? "usedHere"
				: t.isImmutable
					? "shipped"
					: "alsoFits"
		const list = contextTemplatesBy.get(t.nodeTypeId) ?? []
		list.push({
			id: t.id,
			label: t.name,
			// The subtitle answers the question the grouping raises — "then
			// where is this one from" — for exactly the rows where it is not
			// already obvious.
			...(group === "alsoFits" && t.createdForSpecId != null
				? { description: `from ${nameById.get(t.createdForSpecId)}` }
				: {}),
			group
		} as any)
		contextTemplatesBy.set(t.nodeTypeId, list)
	}
	for (const [, list] of contextTemplatesBy)
		list.sort(
			(a: any, b: any) =>
				CT_ORDER[a.group as keyof typeof CT_ORDER] -
					CT_ORDER[b.group as keyof typeof CT_ORDER] ||
				a.label.localeCompare(b.label)
		)

	// Every layout on the instance, not this spec's — a layout is keyed by the
	// variable it renders, so one written while configuring replies belongs in
	// the narrator's picker too. Narrowed per option by `variableId` below.
	const variableTemplates = await db
		.select()
		.from(schema.pipelineVariableTemplates)
		.orderBy(asc(schema.pipelineVariableTemplates.id))

	const byVariable = new Map<string, ChoiceList>()
	for (const t of variableTemplates as any[]) {
		const list = byVariable.get(t.variableId) ?? []
		list.push({ id: t.id, label: t.name })
		byVariable.set(t.variableId, list)
	}
	// Shipped first, matching `listVariableTemplates` — the picker's order is
	// part of what "the default" means.
	for (const [, list] of byVariable)
		list.sort((a, b) => {
			const rowA = (variableTemplates as any[]).find((t) => t.id === a.id)
			const rowB = (variableTemplates as any[]).find((t) => t.id === b.id)
			return Number(!!rowB?.isImmutable) - Number(!!rowA?.isImmutable)
		})

	return {
		prompts: (prompts as any[]).map((p) => ({
			id: p.id,
			label: p.name
		})) as ChoiceList,
		// The full rows, for the inline editor: a prompts-ref option carries
		// the selected row's text so editing does not need a second fetch.
		promptRows: new Map<number, any>(
			(prompts as any[]).map((p) => [p.id, p])
		),
		// The model is the thing a person actually recognises a connection by —
		// two rows both called "Ollama" are otherwise indistinguishable in a
		// picker, which is the situation an admin with a local and a remote box
		// is in every day.
		connections: (connections as any[]).map((c) => ({
			id: c.id,
			label: c.name,
			...(c.model ? { description: c.model } : {})
		})) as ChoiceList,
		sampling: (sampling as any[]).map((s) => ({
			id: s.id,
			label: s.name
		})) as ChoiceList,
		contextTemplatesBy,
		/** The full rows, for the inline editor — same reason as `promptRows`. */
		contextTemplateRows: new Map<number, any>(
			(contextTemplateRows as any[]).map((t) => [t.id, t])
		),
		variableTemplatesBy: byVariable,
		/** The full rows, for the inline editor — same reason as `promptRows`. */
		variableTemplateRows: new Map<number, any>(
			(variableTemplates as any[]).map((t) => [t.id, t])
		)
	}
}

/**
 * Takes the whole declaration rather than just its control, because one of the
 * four is narrowed by something only the declaration knows: a variables option
 * offers the layouts for **its** variable, and a picker showing every layout on
 * the instance would offer a personas rendering for characters.
 */
const choicesFor = (
	d: Decl,
	sets: Awaited<ReturnType<typeof choiceSets>>
): ChoiceList | undefined => {
	if (d.control === "prompts-ref") return sets.prompts
	if (d.control === "connection-ref") return sets.connections
	if (d.control === "sampling-ref") return sets.sampling
	if (d.control === "variable-template-ref")
		return d.variableId
			? (sets.variableTemplatesBy.get(d.variableId) ?? [])
			: []
	if (d.control === "context-template-ref")
		return d.nodeTypeId
			? (sets.contextTemplatesBy.get(d.nodeTypeId) ?? [])
			: []
	return undefined
}

/* ------------------------------------------------------------------ *
 * Reads
 * ------------------------------------------------------------------ */

/**
 * Which scope this viewer's edits land at.
 *
 * A fact, not a question. 05 §0a: configuring from inside a chat you own writes
 * at chat scope, everywhere else at your own. The panel shows this rather than
 * offering a picker, because a picker asks the user to understand the
 * resolution chain before they can change a prompt.
 */
export const writeScopeFor = (viewer: Viewer): WriteScope =>
	viewer.chatId != null ? "chat" : "user"

/**
 * Is this slot any of this person's business?
 *
 * Absent, not disabled — a greyed control invites the question it cannot
 * answer. The 0.6 line (user-ratified, DECOMPOSITION §26): a non-admin sees
 * **prompts and nothing else**. To them the pipeline is how the application
 * works, not a thing they operate — weights, sampling, review gates and
 * connections are the instance's configuration, and offering them at user
 * scope invited edits that change behaviour nobody else can see or debug.
 * Prompts stay personal because wording is the one thing that is genuinely
 * theirs: an override on top of whatever the admin configured.
 *
 * Narrower than the SDK write matrix on purpose. The matrix says what a scope
 * *may* store (params at user scope is a legal row); this says what this
 * application offers, and `resolveWriteScope` enforces the same line so a
 * minted id cannot reach what the panel does not show.
 */
const visibleTo = (matrixSlot: string, viewer: Viewer): boolean =>
	viewer.isAdmin || matrixSlot === "prompts"

export async function listNamespaces(db: Db): Promise<NamespaceSummary[]> {
	const specs = await db
		.select()
		.from(schema.pipelineSpecs)
		.orderBy(asc(schema.pipelineSpecs.id))

	const out: NamespaceSummary[] = []
	for (const spec of specs as any[]) {
		if (!spec.activeVersionId) continue
		const [version] = await db
			.select()
			.from(schema.pipelineSpecVersions)
			.where(eq(schema.pipelineSpecVersions.id, spec.activeVersionId))
			.limit(1)
		if (!version) continue
		const sub = await subscription(db, version.id)
		out.push({
			slug: spec.slug,
			name: spec.name,
			version: version.semver,
			event: sub.event,
			enabled: sub.enabled
		})
	}
	return out
}

export async function namespaceView(
	db: Db,
	secret: string,
	slug: string,
	viewer: Viewer
): Promise<NamespaceView | null> {
	const at = await published(db, slug)
	if (!at) return null

	const decls = await declarations(db, at.specVersionId)
	const chain = await layers(db, at, viewer)
	const sets = await choiceSets(db, at.specId)
	const scope = writeScopeFor(viewer)
	const here = scope === "chat" ? chain.chat : chain.user

	// Group by node, in declaration order — which is node position, because
	// that is how `declarations` walks. `advanced` splits the tuning
	// parameters out so a step leads with its prompt and references.
	const byNode = new Map<
		string,
		{ options: ConfigOption[]; advanced: ConfigOption[] }
	>()
	for (const d of decls) {
		if (!visibleTo(d.matrixSlot, viewer)) continue

		const key = addr(d.nodeKey, d.slot, d.path)
		// The same order the runtime resolves in (SDK SCOPE_ORDER): overrides
		// beat the selected config, most specific scope first. The two walks
		// must agree or the panel shows a value the run does not use.
		let value: unknown = d.authorDefault
		let source: OptionSource = "author"
		if (chain.chat?.has(key)) {
			value = chain.chat.get(key)
			source = "chat"
		} else if (chain.user.has(key)) {
			value = chain.user.get(key)
			source = "user"
		} else if (chain.instance.has(key)) {
			value = chain.instance.get(key)
			source = "instance"
		} else if (chain.preset.has(key)) {
			value = chain.preset.get(key)
			source = "preset"
		}

		// The selected prompt row rides along on a prompts-ref, so the
		// panel can show and edit the text inline. The resolved value is
		// the row id; a value that names no row (deleted since) simply
		// carries no `prompt`, and the dropdown shows the dangle.
		const promptRow =
			d.control === "prompts-ref" && typeof value === "number"
				? sets.promptRows.get(value)
				: undefined

		// The same ride-along, for the same reason: a name in a dropdown does
		// not answer "what does this produce", and the source is the thing
		// being chosen.
		const variableTemplateRow =
			d.control === "variable-template-ref" && typeof value === "number"
				? sets.variableTemplateRows.get(value)
				: undefined

		const contextTemplateRow =
			d.control === "context-template-ref" && typeof value === "number"
				? sets.contextTemplateRows.get(value)
				: undefined

		// Where this option's edits land. Prompts are personal — chat or user
		// scope, an override on the admin's configuration. Everything else an
		// admin edits *is* the instance's configuration, so those write at
		// instance scope: an admin tuning a weight at user scope would change
		// only their own runs while believing they configured the application,
		// which is the on-screen lie this whole layer exists to prevent.
		const effScope: WriteScope =
			viewer.isAdmin && d.matrixSlot !== "prompts" ? "instance" : scope

		const option: ConfigOption = {
			id: optionId(secret, d.nodeKey, d.slot, d.path),
			label: d.label,
			...(d.description ? { description: d.description } : {}),
			control: d.control,
			...(d.min != null ? { min: d.min } : {}),
			...(d.max != null ? { max: d.max } : {}),
			...(d.of ? { of: d.of } : {}),
			...((c) => (c ? { choices: c } : {}))(choicesFor(d, sets)),
			...(variableTemplateRow
				? {
						variableTemplate: {
							id: variableTemplateRow.id,
							name: variableTemplateRow.name,
							source: (variableTemplateRow.source ??
								"") as string,
							readOnly: !!variableTemplateRow.isImmutable
						}
					}
				: {}),
			...(contextTemplateRow
				? {
						contextTemplate: {
							id: contextTemplateRow.id,
							name: contextTemplateRow.name,
							source: (contextTemplateRow.source ?? "") as string,
							readOnly: !!contextTemplateRow.isImmutable,
							// Read back off the choice the picker already
							// computed rather than re-deriving it here — two
							// places deciding "which group is this in" is two
							// places to disagree, and the editor's caption and
							// the list would be the ones disagreeing.
							...((c) =>
								c
									? {
											group: c.group,
											...(c.description
												? { origin: c.description }
												: {})
										}
									: {})(
								(
									sets.contextTemplatesBy.get(
										contextTemplateRow.nodeTypeId
									) as any[] | undefined
								)?.find((c) => c.id === contextTemplateRow.id)
							)
						}
					}
				: {}),
			...(promptRow
				? {
						prompt: {
							id: promptRow.id,
							name: promptRow.name,
							fields: (promptRow.fields ?? {}) as Record<
								string,
								string
							>,
							readOnly: !!promptRow.isImmutable
						}
					}
				: {}),
			...(d.authorDefault !== undefined && d.control !== "secret"
				? { authorDefault: d.authorDefault }
				: {}),
			// A secret is write-only in the UI and redacted by type (13 §6) —
			// enforceable precisely because the declaration says it is one.
			value: d.control === "secret" ? null : value,
			source,
			writable: mayWrite(d.matrixSlot, effScope as ScopeKind),
			...(effScope !== scope ? { writeAt: effScope } : {}),
			overriddenHere:
				effScope === "instance"
					? chain.instance.has(key)
					: !!here?.has(key)
		}

		let group = byNode.get(d.nodeKey)
		if (!group) {
			group = { options: [], advanced: [] }
			byNode.set(d.nodeKey, group)
		}
		// "Advanced" is the tuning surface — weights, budgets, thresholds —
		// plus the raw templates. A template is the *rendering* of a step
		// rather than a decision about it, it is empty until someone
		// deliberately replaces the built-in wording, and an empty box
		// labelled "Template" above the prompt is the panel's most confusing
		// square inch. The step then leads with what people came for: its
		// prompt, its connection, its review gate.
		//
		// Variable layouts go here too, on the same argument one level down: how
		// characters are laid out is the *rendering* of a step rather than a
		// decision about it. The other reason is arithmetic — the context step
		// declares eight of them, and eight pickers above the prompt would bury
		// the one thing most people opened the panel to change.
		if (
			d.matrixSlot === "params" ||
			d.matrixSlot === "template" ||
			d.matrixSlot === "variables"
		)
			group.advanced.push(option)
		else group.options.push(option)
	}

	const nodeKeys = [...byNode.keys()]
	const typeLabelOf = new Map<string, string>()
	for (const d of decls)
		if (!typeLabelOf.has(d.nodeKey)) typeLabelOf.set(d.nodeKey, d.typeLabel)
	const labels = stepLabels(nodeKeys, typeLabelOf)

	// `key` is the step's ordinal, not the node key — the id scheme for
	// writes stays the HMAC per option, and the payload still never names a
	// node (see `ConfigStep`).
	const steps: ConfigStep[] = nodeKeys.map((nodeKey, i) => ({
		key: `s${i}`,
		label: labels.get(nodeKey) ?? nodeKey,
		options: byNode.get(nodeKey)!.options,
		advanced: byNode.get(nodeKey)!.advanced
	}))

	const configRows = await db
		.select()
		.from(schema.pipelineConfigs)
		.where(eq(schema.pipelineConfigs.specId, at.specId))
		.orderBy(asc(schema.pipelineConfigs.id))

	const sub = await subscription(db, at.specVersionId)

	return {
		slug: at.slug,
		name: at.name,
		version: at.semver,
		event: sub.event,
		enabled: sub.enabled,
		configs: (configRows as any[]).map((c) => ({
			id: c.id,
			name: c.name,
			isDefault: !!c.isDefault,
			// The shipped default is immutable (one per pipeline, always
			// present) — copies a person made are theirs to edit.
			readOnly: !!c.isImmutable
		})),
		selectedConfig: chain.selectedConfig
			? {
					id: chain.selectedConfig.configId,
					name: chain.selectedConfig.name,
					source: chain.selectedConfig.source
				}
			: null,
		steps,
		writeScope: scope
	}
}

/* ------------------------------------------------------------------ *
 * Writes
 * ------------------------------------------------------------------ */

/**
 * Resolve a handle back to its address.
 *
 * Over every declaration, not just the visible ones — see the header. A miss is
 * a handle from another install, or from a version that no longer declares the
 * setting, and both deserve the same sentence.
 */
async function locate(
	db: Db,
	secret: string,
	slug: string,
	id: string
): Promise<{ at: Published; decl: Decl }> {
	const at = await published(db, slug)
	if (!at)
		throw new OptionNotFoundError(
			`There is no published pipeline called '${slug}'.`
		)
	const decls = await declarations(db, at.specVersionId)
	const decl = decls.find(
		(d) => optionId(secret, d.nodeKey, d.slot, d.path) === id
	)
	if (!decl)
		throw new OptionNotFoundError(
			"That setting is not part of this pipeline. A newer version may have " +
				"removed it, or the link was made on a different install."
		)
	return { at, decl }
}

/**
 * Decide where a write lands, and refuse in a sentence if it may not.
 *
 * Both refusals name the reason rather than the rule: the reader is someone who
 * used a control that was offered to them, and "scope 'user' may not write slot
 * 'connection'" tells them nothing they can act on (15 §1.3).
 */
function resolveWriteScope(
	viewer: Viewer,
	requested: WriteScope | undefined,
	matrixSlot: string
): { scope: WriteScope; scopeId: number } {
	const scope: WriteScope = requested ?? writeScopeFor(viewer)

	if (scope === "instance" && !viewer.isAdmin)
		throw new OptionNotWritableError(
			"Only an administrator sets a value for everyone on this instance. " +
				"Nothing was saved — change it for yourself instead, or ask an " +
				"administrator."
		)

	// The 0.6 line, enforced where writes arrive and not only where the panel
	// renders (`visibleTo`): a non-admin changes prompts and nothing else.
	// The ids are HMAC handles rather than secrets a viewer was granted, so
	// hiding an option is not what protects it — this refusal is.
	if (!viewer.isAdmin && matrixSlot !== "prompts")
		throw new OptionNotWritableError(
			"That setting is part of how this application is configured, so it " +
				"stays with the administrator. Prompts are yours to change."
		)

	if (!mayWrite(matrixSlot, scope as ScopeKind)) {
		const allowed = WRITE_MATRIX[matrixSlot] ?? []
		throw new OptionNotWritableError(
			matrixSlot === "connection"
				? "Connections stay with the administrator, so credentials and " +
					"compute stay under their control."
				: "That setting is not yours to change here. It is set " +
					(allowed.length
						? `at ${allowed.join(" or ")} level`
						: "elsewhere") +
					" by an administrator."
		)
	}

	return {
		scope,
		scopeId:
			scope === "instance"
				? 0
				: scope === "chat"
					? viewer.chatId!
					: viewer.userId
	}
}

/**
 * The gate every variable-layout mutation passes first.
 *
 * Deliberately **not** the shape `promptInSpec` takes. A prompt mutation is
 * gated on the prompt belonging to the pipeline whose panel is open, and the
 * same check here would undo the feature: a layout is shared across pipelines
 * on purpose, so "does this row belong to this spec" has no true answer.
 *
 * What is checked instead is that the caller is operating a control this
 * pipeline actually offers them — the option handle resolves to one of this
 * spec's declarations, that declaration is a layout reference, and the viewer
 * may write it. The returned `variableId` is then what the caller matches the
 * target row against, which is the real rule: you may edit a layout through the
 * setting that renders it.
 */
export async function variableOptionGate(
	db: Db,
	secret: string,
	slug: string,
	viewer: Viewer,
	id: string
): Promise<{ variableId: string }> {
	const { decl } = await locate(db, secret, slug, id)
	if (decl.control !== "variable-template-ref" || !decl.variableId)
		throw new OptionNotFoundError(
			"That setting does not choose a layout, so there is nothing here to " +
				"edit."
		)
	// Same refusal the write path uses, rather than a second copy of the rule.
	// `instance` for an admin because that is where their layout edits land
	// (see `effScope` in `namespaceView`) — passing the viewer's default scope
	// would refuse an administrator on the grounds that layouts are set at
	// instance level, which is where this very call is trying to set one.
	resolveWriteScope(
		viewer,
		viewer.isAdmin ? "instance" : undefined,
		decl.matrixSlot
	)
	return { variableId: decl.variableId }
}

/**
 * The gate every context-template mutation passes first.
 *
 * Same shape as `variableOptionGate`, and not the shape `promptInSpec` takes,
 * for the same reason: a template is shared across pipelines on purpose, so
 * "does this row belong to this spec" has no true answer. What is checked is
 * that the caller is operating a control this pipeline actually offers them —
 * the option handle resolves to one of this spec's declarations, that
 * declaration is a template reference, and the viewer may write it. The
 * returned `nodeTypeId` is then what the caller matches the target row against,
 * which is the real rule: you may edit a template through the setting that
 * renders it.
 */
export async function contextTemplateOptionGate(
	db: Db,
	secret: string,
	slug: string,
	viewer: Viewer,
	id: string
): Promise<{ nodeTypeId: string; specId: number }> {
	const { at, decl } = await locate(db, secret, slug, id)
	if (decl.control !== "context-template-ref" || !decl.nodeTypeId)
		throw new OptionNotFoundError(
			"That setting does not choose a context template, so there is " +
				"nothing here to edit."
		)
	// Same refusal the write path uses, rather than a second copy of the rule.
	resolveWriteScope(
		viewer,
		viewer.isAdmin ? "instance" : undefined,
		decl.matrixSlot
	)
	return { nodeTypeId: decl.nodeTypeId, specId: at.specId }
}

export async function writeOption(
	db: Db,
	secret: string,
	slug: string,
	viewer: Viewer,
	id: string,
	value: unknown,
	scope?: WriteScope
): Promise<void> {
	const { at, decl } = await locate(db, secret, slug, id)
	const target = resolveWriteScope(viewer, scope, decl.matrixSlot)
	const now = new Date()

	await db
		.insert(schema.pipelineNodeOverrides)
		.values({
			specId: at.specId,
			scopeKind: target.scope,
			scopeId: target.scopeId,
			nodeKey: decl.nodeKey,
			slot: decl.slot,
			path: decl.path,
			value,
			updatedBy: viewer.userId,
			updatedAt: now
		})
		.onConflictDoUpdate({
			target: [
				schema.pipelineNodeOverrides.specId,
				schema.pipelineNodeOverrides.scopeKind,
				schema.pipelineNodeOverrides.scopeId,
				schema.pipelineNodeOverrides.nodeKey,
				schema.pipelineNodeOverrides.slot,
				schema.pipelineNodeOverrides.path
			],
			set: { value, updatedBy: viewer.userId, updatedAt: now }
		})
}

/**
 * Reset — a delete, never a write of the inherited value.
 *
 * Deleting is what keeps an admin's later change reaching this person. Pinning a
 * copy of what they were inheriting would look identical today and silently
 * strand them on the old value forever.
 */
export async function clearOption(
	db: Db,
	secret: string,
	slug: string,
	viewer: Viewer,
	id: string,
	scope?: WriteScope
): Promise<void> {
	const { at, decl } = await locate(db, secret, slug, id)
	const target = resolveWriteScope(viewer, scope, decl.matrixSlot)

	await db
		.delete(schema.pipelineNodeOverrides)
		.where(
			and(
				eq(schema.pipelineNodeOverrides.specId, at.specId),
				eq(schema.pipelineNodeOverrides.scopeKind, target.scope),
				eq(schema.pipelineNodeOverrides.scopeId, target.scopeId),
				eq(schema.pipelineNodeOverrides.nodeKey, decl.nodeKey),
				eq(schema.pipelineNodeOverrides.slot, decl.slot),
				eq(schema.pipelineNodeOverrides.path, decl.path)
			)
		)
}

/**
 * Record a scope's choice of named config, by row id.
 *
 * Ids are safe here where preset slugs needed to be slugs (12 §3b): a config
 * hangs off the *spec*, not the version, so publishing 1.1.0 dangles nothing —
 * and a deleted config's FK nulls the selection, which `resolveSelectedConfig`
 * reads as "fall back to the shipped default" (the rule ratified for 0.6).
 *
 * Delegates to `configs.selectConfig`, which refuses a config belonging to
 * another pipeline — the panel and the runtime share one write path the same
 * way `layers()` makes them share one read path.
 */
export async function selectNamedConfig(
	db: Db,
	slug: string,
	viewer: Viewer,
	configId: number,
	scope?: WriteScope
): Promise<void> {
	const at = await published(db, slug)
	if (!at)
		throw new OptionNotFoundError(
			`There is no published pipeline called '${slug}'.`
		)

	const target: WriteScope = scope ?? writeScopeFor(viewer)
	if (target === "instance" && !viewer.isAdmin)
		throw new OptionNotWritableError(
			"Only an administrator chooses the configuration for everyone on this instance."
		)

	const scopeId =
		target === "instance"
			? 0
			: target === "chat"
				? viewer.chatId!
				: viewer.userId

	const { selectConfig } = await import("./configs")
	await selectConfig(db, at.specId, target, scopeId, configId, viewer.userId)
}
