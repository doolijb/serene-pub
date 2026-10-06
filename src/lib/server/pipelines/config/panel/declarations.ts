/**
 * What a pipeline says can be configured — read from rows, not from code.
 *
 * 12 §2 puts slot declarations in the type descriptor *"so a plugin Provider's
 * prompt fields render next to core's automatically, with no UI work"*, and F6
 * says core reads a plugin without executing it. Both are only true if the form
 * is generated from `pipeline_definition_registry.slots` rather than from an
 * in-process descriptor map — which exists for core types, does not exist for a
 * `transport: 'process'` type, and is the exact thing F6 forbids reaching for.
 *
 * So everything here goes through the registry table. `declarations()` is the
 * entry point: a slug in, one `Decl` per configurable path out.
 */

import { asc, eq } from "drizzle-orm"
import * as schema from "$lib/server/db/schema"
import { i18nTextIn } from "$lib/shared/i18n/i18nText"
import { poolKeyFor } from "$lib/server/pipelines/entities/contextTemplateDefaults"
import {
	WRITE_MATRIX,
	getVariable,
	clauseSettingsSlotFor,
	envoyPromptsSlotFor,
	ENVOY_CONFIG_PREFIX,
	isEnvoyConfigKey,
	fieldLabel,
	scriptPointsOf,
	rendersAt,
	templateScopeAt,
	templateScopeReport,
	type ScopeSource,
	type SpecDocument,
	type TemplateScope,
	type FieldDecl,
	type SlotDecl,
	type ScriptPointDecl
} from "@serene-pub/sdk"
import { type Decl } from "$lib/server/pipelines/config/panel/types"
import { isUnreadSlot } from "$lib/server/pipelines/boot/unreadAllowList"
import { isHeldConnectionSlot } from "$lib/server/pipelines/config/heldSlots"

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
	scripts: "scripts",
	// The substrate's own (R-9): an optional node's switch, a gated node's
	// review position, a gather clause's mode. Read from the row's `slots`
	// like every other kind — never synthesised here.
	settings: "settings"
}

const PARAM_CONTROL: Record<string, string> = {
	number: "number",
	integer: "integer",
	string: "string",
	// The field language's multi-line string (`FieldType` `text`): an
	// envoy's instructions are the first parameter to use it. `read.ts`
	// bridges it to a `text@1` value declaration with `multiline` set.
	text: "text",
	boolean: "boolean",
	enum: "enum",
	"string[]": "string[]",
	secret: "secret",
	// One control per shape of value, not per setting. The bar knows nothing
	// about retrieval — it renders whatever bands the declaration names, which
	// is what lets a plugin's own share parameter render without touching it.
	share: "share",
	perMember: "per-member",
	// The third of the family, and its own control because the arithmetic it
	// implies is different: independent 0..1 strengths, drawn as one bar each,
	// where `share` normalises to a fixed total and `perMember` has no range at
	// all. Rendering a strength like a share would teach a reader that turning
	// one up turns the others down.
	strengths: "strengths",
	// An ordered list of rows, rendered from the ELEMENT's declaration rather
	// than from anything this panel knows about any particular list. The
	// `blocks` param is the first of them; a plugin declaring `type: 'list'`
	// gets the same editor with no work here.
	//
	// ⚠ `object` is deliberately absent. Nothing declares a bare object param
	// yet, and mapping it to a control the client has no branch for would put a
	// text box in front of a value it cannot edit — the dead-control family.
	// Add it here when there is a control to point at.
	list: "list"
}

/**
 * A list element's declaration, flattened for the client.
 *
 * The same projection `members` gets and for the same reason: display text is
 * resolved here, because the client renders strings and does not pick them. A
 * plugin's list of its own rows arrives labelled without anybody editing the
 * panel.
 *
 * One level. A list of objects is the shape this exists for; a list of lists is
 * not offered a control, and the declaration check refuses neither — it simply
 * arrives with no fields, which the client renders as an unlabelled row rather
 * than as nothing.
 */
function itemDeclOf(
	item: FieldDecl | undefined,
	language?: string
): Decl["item"] | undefined {
	if (!item) return undefined
	const fields = Object.entries(item.fields ?? {}).map(([key, raw]) => {
		const f = raw as FieldDecl
		return {
			key,
			label: i18nText(f.label, language) ?? humanizeCamel(key),
			control: PARAM_CONTROL[f.type] ?? "string",
			...(f.of ? { of: f.of } : {}),
			...(f.members
				? {
						members: f.members.map((m) => ({
							key: m.key,
							label:
								i18nText(m.label, language) ??
								humanizeCamel(m.key),
							...(i18nText(m.description, language)
								? {
										description: i18nText(
											m.description,
											language
										)!
									}
								: {})
						}))
					}
				: {}),
			...(f.default !== undefined ? { default: f.default } : {})
		}
	})
	return { fields }
}

/**
 * `postHistoryInstructions` becomes `Post History Instructions`.
 *
 * Exported for the same reason `i18nText` is: `reconcileConfigs` names a culled
 * option whose declaration is gone, and the only thing left to name it with is
 * its address. A second spelling of "how a key becomes English" would make the
 * notice call a setting something the panel never called it.
 */
export function humanizeCamel(key: string): string {
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
export function humanizeTypeId(definitionId: string): string {
	const tail = definitionId.replace(/@\d+$/, "").split("/").pop() ?? definitionId
	const words = tail.split(/[-_]/).join(" ")
	return words.charAt(0).toUpperCase() + words.slice(1)
}

/**
 * The display text of an `I18n`, in a language, or undefined.
 *
 * Exported because `read.ts` resolves facet headings the same way, and a second
 * copy of "how display text is read out of a declaration" is the kind of
 * duplication this layer keeps finding at the point where the two disagree.
 *
 * The body moved to `$lib/shared/i18n/i18nText` when language became a setting
 * (R5) — this stayed a re-export rather than becoming an import at ten call
 * sites, and `language` stayed optional so every one of those call sites keeps
 * the English it already resolved. Passing a language is what a caller does
 * once it has one to pass; see `$lib/server/i18n` for where one comes from.
 */
export const i18nText = (v: unknown, language?: string): string | undefined =>
	i18nTextIn(v, language)

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
	/** `bandKeys` from `openRenders`, `templateScope` from `templateScopeFor`. */
	decl: SlotDecl & {
		bandKeys?: readonly string[]
		templateScope?: TemplateScope
		templateDeclarers?: Record<string, TemplateDeclarer>
		templateUntyped?: string[]
	},
	typeLabel: string,
	definitionId: string,
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
		...(decl.engine ? { engine: decl.engine } : {}),
		...(decl.acceptedEngines?.length ? { acceptedEngines: [...decl.acceptedEngines] } : {})
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
				nodeDefinitionId: poolKeyFor(definitionId),
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
			// A band declared upstream (typed templates P2) — `declarations()`
			// has already opened `renders` to include it (`rendersAt`).
			const band = (decl as { bandKeys?: readonly string[] }).bandKeys?.includes(
				key
			)
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
				...(band ? { band: true as const } : {}),
				control: "variable-template-ref"
			}
		})

	// A `settings` slot is the same shape one kind over — declared fields,
	// one option each — and renders through the same branch, which is what
	// "the panel renders it like any slot" means. Its one difference is per
	// field: `review` carries a facet of its own (`FieldDecl.facet`), so the
	// gate keeps the heading it has always had beside the switch's.
	if (decl.kind === "parameters" || decl.kind === "settings")
		return Object.entries(decl.schema ?? {}).map(([param, raw]) => {
			const p = raw as FieldDecl
			const paramDescription = i18nText(p?.description)
			return {
				...base,
				...(p?.facet ? { facet: p.facet } : {}),
				path: param,
				label: i18nText(fieldLabel(p ?? {})) ?? humanizeCamel(param),
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
								label: i18nText(m.label) ?? humanizeCamel(m.key),
								...(i18nText(m.description)
									? { description: i18nText(m.description)! }
									: {}),
								...(m.tone != null ? { tone: m.tone } : {})
							}))
						}
					: {}),
				// The element declaration, for a `list`. Absent for every other
				// control, which is what keeps the payload the size it was.
				...((it) => (it ? { item: it } : {}))(
					p?.type === "list" ? itemDeclOf(p.item) : undefined
				),
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
				nodeDefinitionId: poolKeyFor(definitionId),
				label: humanizeCamel(slotName),
				...(slotDescription ? { description: slotDescription } : {}),
				control: "context-template-ref",
				// Typed templates P3 — `declarations()` computed it over the
				// stored document (`templateScopeFor`).
				...(decl.templateScope ? { templateScope: decl.templateScope } : {}),
				...(decl.templateDeclarers
					? { templateDeclarers: decl.templateDeclarers }
					: {}),
				...(decl.templateUntyped?.length
					? { templateUntyped: decl.templateUntyped }
					: {}),
				// The definition's own names — the library's scope, where no
				// step is in view (P7).
				...(decl.variables ? { templateStaticScope: decl.variables } : {})
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

/**
 * What the spec subscribes to: its **inlet lock** — the one subscription a
 * pipeline has (R-4, 2026-09-16; the subscriptions table it replaced was read
 * by nothing at dispatch and is gone). The lock's event id
 * (`core:event/message-respond@1`) is what a preset binds and dispatch keys on.
 * `enabled` is kept for the panel's shape: a lock has no off switch, so it is
 * always live.
 */
export async function subscription(db: Db, specVersionId: number) {
	const [row] = await db
		.select({ inputEvent: schema.pipelineSpecVersions.inputEvent })
		.from(schema.pipelineSpecVersions)
		.where(eq(schema.pipelineSpecVersions.id, specVersionId))
		.limit(1)
	return {
		event: (row?.inputEvent as string | undefined) ?? null,
		enabled: true
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
 * lands on is the same one twice running. A gather clause's settings step
 * rides along at the spine position of its first member node, not at the
 * tail; an envoy's step sorts past the end, because `read.ts` pulls it out
 * of the spine into its own trailing group.
 */
/**
 * A `variables` slot with `rendersBands`, its `renders` opened (typed
 * templates P2): the static keys plus every band declared upstream of the
 * named in-port — SDK `rendersAt` over the stored document, reading each
 * node's in-ports and declared bands from its **registry row** (`ports`, and
 * `policy.bands`), never from a loaded plugin (F6). The band keys ride along
 * as `bandKeys` so each option can say it is one.
 *
 * A collision — two upstream declarers naming one band differently, or a band
 * shadowing a name the node renders itself — throws `BandCollisionError`
 * naming both: the document is broken the same way for every reader, and a
 * pipeline that cannot say what its template receives must not run.
 */
export async function openRenders(
	docOf: () => Promise<SpecDocument>,
	nodeKey: string,
	decl: SlotDecl,
	byPin: Map<string, any>
): Promise<SlotDecl & { bandKeys: string[] }> {
	const doc = await docOf()
	const renders = rendersAt(doc, nodeKey, decl, rowSource(byPin))
	const own = new Set(Object.keys(decl.renders ?? {}))
	return {
		...decl,
		renders,
		bandKeys: Object.keys(renders).filter((k) => !own.has(k))
	}
}

/**
 * A node's definition as the SDK's document walks read it, from its
 * **registry row** — slots, ports, and the policy half (`bands`,
 * `portSchemas`) — never from a loaded plugin (F6).
 */
export const rowSource =
	(byPin: Map<string, any>) =>
	(n: { definitionId: string; definitionVersion: number }): ScopeSource | undefined => {
		const row = byPin.get(`${n.definitionId}@${n.definitionVersion}`)
		return row
			? {
					slots: row.slots ?? {},
					ports: row.ports ?? {},
					bands: row.policy?.bands ?? undefined,
					portSchemas: row.policy?.portSchemas ?? undefined
				}
			: undefined
	}

/**
 * What a `template` slot can reference at this node of the stored document
 * (typed templates P3): SDK `templateScopeAt` over the rows — the node's own
 * names, its prompts, the context builder's declared keys, the bands
 * declared upstream, `annex.<owner>.<key>` and `state` typed for the spec's
 * genre. Carried on the `context-template-ref` option for the editor (P7).
 *
 * Throws on a root two declarers claim, and on a forbidden kind — for the
 * reason `openRenders` does: the document is broken the same way for every
 * reader.
 */
export async function templateScopeFor(
	docOf: () => Promise<SpecDocument>,
	nodeKey: string,
	slotName: string,
	byPin: Map<string, any>
): Promise<TemplateScope> {
	return templateScopeAt(await docOf(), nodeKey, {
		slot: slotName,
		describe: rowSource(byPin)
	})
}

/**
 * Who supplies a template root, in words (typed templates P7). `group`
 * is how the editor ranks and groups a completion; never a node key.
 */
export interface TemplateDeclarer {
	label: string
	group: "self" | "promptFields" | "builder" | "band" | "annex"
}

/**
 * `templateScopeFor`, plus who declares each root and which producers feed
 * it untyped — both as LABELS (a type's own name), for the editor's hover,
 * tree and lint. The SDK's declarer strings name node keys
 * (`'context' (core:task/…@1).templateContext`); the payload carries no
 * topology (05 §0a), so each is rewritten to the definition's display name.
 */
export async function templateScopeDetailFor(
	docOf: () => Promise<SpecDocument>,
	nodeKey: string,
	slotName: string,
	byPin: Map<string, any>
): Promise<{
	scope: TemplateScope
	declarers: Record<string, TemplateDeclarer>
	untyped: string[]
}> {
	const report = templateScopeReport(await docOf(), nodeKey, {
		slot: slotName,
		describe: rowSource(byPin)
	})
	const nameOf = (pin: string) => {
		const at = pin.lastIndexOf("@")
		const definitionId = at === -1 ? pin : pin.slice(0, at)
		return (
			i18nText(byPin.get(pin)?.i18n?.name) ?? humanizeTypeId(definitionId)
		)
	}
	const DECLARER = /^'([^']*)' \(([^)]*)\)(.*)$/
	const read = (by: string): TemplateDeclarer => {
		const m = DECLARER.exec(by)
		if (!m) return { label: "Annex declarations", group: "annex" }
		const [, key, pin, tail] = m as unknown as [string, string, string, string]
		const name = nameOf(pin)
		const slot = / slot '([^']*)'$/.exec(tail)?.[1]
		if (slot !== undefined)
			return key === nodeKey && slot === slotName
				? { label: `This step (${name})`, group: "self" }
				: { label: `${name} prompts`, group: "promptFields" }
		if (tail.startsWith(".")) return { label: name, group: "builder" }
		return { label: `${name} (band)`, group: "band" }
	}
	return {
		scope: report.scope,
		declarers: Object.fromEntries(
			Object.entries(report.declarers).map(([root, by]) => [root, read(by)])
		),
		untyped: [...new Set(report.untyped.map((by) => read(by).label))]
	}
}

export async function declarations(
	db: Db,
	specVersionId: number
): Promise<Decl[]> {
	const nodes = await db
		.select()
		.from(schema.pipelineNodes)
		.where(eq(schema.pipelineNodes.specVersionId, specVersionId))
		.orderBy(asc(schema.pipelineNodes.position))
	// Fetched here rather than beside the clause-settings loop below (its
	// original home) because a clause's spine position is needed to place
	// its settings step among the node steps — see the sort at the bottom of
	// this function.
	const clauseRows = await db
		.select()
		.from(schema.pipelineClauses)
		.where(eq(schema.pipelineClauses.specVersionId, specVersionId))
		.orderBy(asc(schema.pipelineClauses.position))
	/**
	 * A clause's `position` is the builder's node counter at the moment
	 * `.gather()`/`.each()`/… was called (`declareClause`, SDK `builder.ts`)
	 * — which is also the position the clause's first member node gets, since
	 * nothing else is pushed between declaring the clause and building its
	 * first chain. So a clause and its first member always tie here; the
	 * sort below breaks the tie in the clause's favour, which is what "sits
	 * at its spine position" means: right where the block it governs begins.
	 */
	const positionByClauseId = new Map<string, number>(
		(clauseRows as any[]).map((c) => [c.clauseId, c.position as number])
	)
	const positionByNodeKey = new Map<string, number>(
		(nodes as any[]).map((n) => [n.nodeKey, n.position as number])
	)

	const registry = await db.select().from(schema.pipelineDefinitionRegistry)
	const byPin = new Map<string, any>(
		(registry as any[]).map((r) => [`${r.definitionId}@${r.version}`, r])
	)

	// The stored document, read once and only if a slot needs it — an open
	// `renders` (typed templates P2) walks its edges.
	let docPromise: Promise<SpecDocument> | undefined
	const docOf = () =>
		(docPromise ??= import("$lib/server/pipelines/boot/store").then((m) =>
			m.loadDocument(db, specVersionId)
		))

	const out: Decl[] = []
	for (const node of nodes as any[]) {
		const row = byPin.get(`${node.definitionId}@${node.definitionVersion}`)
		if (!row) continue
		// The name the type declares, and only then a name made up from its id.
		// The row is already in hand here — it was being read for `slots` while
		// the label beside it was invented, so the panel called a node one
		// thing and the pipeline map called it another.
		const typeLabel =
			i18nText(row.i18n?.name) ?? humanizeTypeId(node.definitionId)
		const slots = (row.slots ?? {}) as Record<string, SlotDecl>
		for (const [slotName, decl] of Object.entries(slots)) {
			// A slot that takes no pick is not a choice: the run drops a value
			// stored there and resolves the instance default, so a picker for
			// it would change nothing. Two kinds: a held connection slot
			// (`isHeldConnectionSlot` — today `query-windows`' embedding
			// connection, held at the active one by policy: a pipeline never
			// chooses its embedding connection, owner 2026-10-05), and a slot
			// no handler reads (`isUnreadSlot` — none today). Off this list, a
			// stored row at the address is culled by `reconcileConfigs` as
			// orphaned.
			if (
				isHeldConnectionSlot(decl) ||
				isUnreadSlot(`${node.definitionId}@${node.definitionVersion}`, slotName)
			)
				continue
			// A slot the spec wired as a *reference to another node's* is not
			// this node's to configure: the owner's option is the one that
			// exists, and offering a second box for the same authored text is
			// the three-System-boxes defect (13 §12 finding i). The wiring
			// lives in the node's stored config — a `slot` ref with `ofNode`.
			//
			// ⚠ For `params` the line runs through the slot, not around it
			// (R-7 P2, refined 2026-09-16 — `FieldDecl.shared`): the fields the
			// definition marks `shared` are the owner's and render there once;
			// the rest are this node's own — its share of the window, its
			// ceiling — resolve at its own address through the same reference,
			// and render here, on the step a reader is looking at, labelled
			// with the band the declaration names. `reconcileConfigs` derives
			// the addresses it back-fills and culls from this list, so an own
			// field left off it would have its stored row culled as orphaned.
			const wired = (node.config ?? {})[slotName]
			const referenced =
				wired &&
				typeof wired === "object" &&
				(wired as any).__ref === "slot" &&
				// Another node's slot, or an envoy's (`slot.prompts({ envoy })`,
				// U5g) — either way the owner's option is the one that exists.
				(((wired as any).ofNode && (wired as any).ofNode !== node.nodeKey) ||
					!!(wired as any).ofEnvoy)
			if (referenced && decl.kind !== "parameters") continue
			const forThisNode: SlotDecl =
				referenced && decl.kind === "parameters"
					? ({
							...decl,
							schema: Object.fromEntries(
								Object.entries(
									(decl.schema ?? {}) as Record<
										string,
										{ shared?: boolean }
									>
								).filter(([, f]) => f?.shared !== true)
							)
						} as SlotDecl)
					: decl
			if (
				forThisNode.kind === "parameters" &&
				!Object.keys(forThisNode.schema ?? {}).length
			)
				continue
			out.push(
				...declsForSlot(
					node.nodeKey,
					slotName,
					forThisNode.kind === "variables" && forThisNode.rendersBands
						? await openRenders(docOf, node.nodeKey, forThisNode, byPin)
						: forThisNode.kind === "template"
							? {
									...forThisNode,
									...(await templateScopeDetailFor(
										docOf,
										node.nodeKey,
										slotName,
										byPin
									).then((d) => ({
										templateScope: d.scope,
										templateDeclarers: d.declarers,
										templateUntyped: d.untyped
									})))
								}
							: forThisNode,
					typeLabel,
					node.definitionId,
					String(row.kind ?? "")
				)
			)
		}

		// Interior script points (18 §4e): one chain option per declared point,
		// addressed as slot `scripts` at the point's own path — which is where
		// the executor's `ctx.scripts.applyText` reads it, so what the panel
		// writes is what the broker runs. Read from the row like everything
		// else (F6). What the point accepts is the point's own declaration
		// (R-11) — read through the SDK's one reader.
		for (const point of scriptPointsOf({
			scriptPoints: (row.scriptPoints ?? []) as ScriptPointDecl[]
		})) {
			const description = i18nText(point.description)
			out.push({
				nodeKey: node.nodeKey,
				slot: "scripts",
				matrixSlot: "scripts",
				path: point.key,
				facet: "scripts",
				label: i18nText(point.label) ?? humanizeCamel(point.key),
				...(description ? { description } : {}),
				control: "scripts-chain",
				accepts: [...point.accepts],
				typeLabel,
				nodeKind: String(row.kind ?? "")
			})
		}
	}

	/**
	 * The envoys this spec reads (plans/29 R-18 (2); U5g): one step per
	 * `envoy:<key>` a `slot.prompts({ envoy })` compiled to, at that
	 * address — the same address the executor resolves config for, so the
	 * panel's row and the run's value cannot part. Only the envoys the spec
	 * *references*: a genre's other envoys are not this pipeline's to tune,
	 * and a control nothing reads is the dead-control family.
	 *
	 * An envoy is not a node and has no registry row, so the SDK declares
	 * its slot (`envoyPromptsSlotFor`) from the genre's declaration — read
	 * off the create spec's row through `declaredEnvoys`, never from the
	 * running registry — and it renders through `declsForSlot` like a
	 * node's. The genre's text is the author default; an admin's edit is a
	 * deviation above it. An envoy absent from the genre's declaration
	 * still gets its step, with empty defaults: the stored deviation stays
	 * reachable rather than becoming an orphan `reconcileConfigs` would cull.
	 */
	const envoyKeys = new Set<string>()
	for (const node of nodes as any[])
		for (const target of Object.values(
			(node.resolvedRefs ?? {}) as Record<string, string>
		))
			if (isEnvoyConfigKey(target)) envoyKeys.add(target)
	if (envoyKeys.size) {
		const [version] = await db
			.select({ inputGenre: schema.pipelineSpecVersions.inputGenre })
			.from(schema.pipelineSpecVersions)
			.where(eq(schema.pipelineSpecVersions.id, specVersionId))
			.limit(1)
		const { declaredEnvoys } = await import(
			"$lib/server/pipelines/entities/envoys"
		)
		const declared = version?.inputGenre
			? await declaredEnvoys(db, version.inputGenre)
			: []
		for (const key of envoyKeys) {
			const slug = key.slice(ENVOY_CONFIG_PREFIX.length)
			const envoy = declared.find((d) => d.slug === slug)
			out.push(
				...declsForSlot(
					key,
					"prompts",
					envoyPromptsSlotFor(
						envoy
							? { key: envoy.key, name: envoy.name, prompts: envoy.prompts }
							: { key: slug, name: { en: slug } }
					),
					`Envoy · ${(envoy && i18nText(envoy.name)) || slug}`,
					"",
					"envoy"
				)
			)
		}
	}

	/**
	 * One option per gather clause: does this group run together or in turn?
	 *
	 * Addressed by the clause's id in the same `settings` slot a node's review
	 * uses, because that is how the executor reads it — clauses are passed to
	 * `resolveConfig` alongside nodes, so `settings.mode` on a clause id
	 * resolves exactly like `settings.review` on a node key.
	 *
	 * A clause is not a node definition and has no registry row to carry the
	 * declaration, so the SDK declares it (`clauseSettingsSlotFor`, R-9) from
	 * the two facts the row does carry — its kind and its authored mode — and
	 * it renders through `declsForSlot` like a node's slot. Only a gather
	 * gets one; the SDK says why the other three do not.
	 */
	for (const clause of clauseRows as any[]) {
		const decl = clauseSettingsSlotFor({
			kind: String(clause.kind ?? ""),
			mode: clause.mode ?? null
		})
		if (!decl) continue
		out.push(
			...declsForSlot(
				clause.clauseId,
				"settings",
				decl,
				humanizeCamel(clause.clauseId),
				"",
				"clause"
			)
		)
	}

	/**
	 * The spine order: a node at its own position, a clause's settings step
	 * tied with (and, on the tie, sorted just before) its first member node,
	 * and an envoy's step pushed past the end — it is not a step in the
	 * spine at all any more (see `namespaceView` in `read.ts`, which lifts
	 * `nodeKind === "envoy"` out into its own trailing, unnumbered group).
	 * `Array.prototype.sort` is stable, so decls that tie here — every decl
	 * of one node, or one clause, or the envoys among themselves — keep the
	 * relative order they were pushed in above.
	 */
	const spineKey = (d: Decl): number => {
		if (d.nodeKind === "envoy") return Number.POSITIVE_INFINITY
		if (d.nodeKind === "clause") {
			const p = positionByClauseId.get(d.nodeKey)
			return p != null ? p - 0.5 : Number.POSITIVE_INFINITY
		}
		return positionByNodeKey.get(d.nodeKey) ?? Number.POSITIVE_INFINITY
	}
	out.sort((a, b) => spineKey(a) - spineKey(b))

	// Each step's heading: the step label the spec gave the node as placed
	// (`expose.label`), else what its definition is called. Never a counter
	// (owner rulings 2026-09-30) — two steps the definition name cannot tell
	// apart are told apart by a label on the spec, or by the group they sit in.
	const headingOf = new Map<string, string>()
	for (const node of nodes as any[]) {
		const label = i18nText(node.expose?.label)
		if (label) headingOf.set(node.nodeKey, label)
	}
	for (const d of out) d.stepHeading = headingOf.get(d.nodeKey) ?? d.typeLabel

	return disambiguate(out)
}
