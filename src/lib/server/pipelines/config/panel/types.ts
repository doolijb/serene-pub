/**
 * The vocabulary of the configuration panel.
 *
 * An **option** is a `(nodeKey, slot, path)` address resolved through the scope
 * chain, presented to a caller as an opaque id and a label. A **Decl** is the
 * other side of it: what the definition registry says *can* be configured, before any
 * user value is applied. Everything else in this directory produces, resolves,
 * or writes one of these.
 *
 * The two error types are a distinction the caller depends on: an id naming a
 * slot the asker may not write must fail as `OptionNotWritable`, not as
 * `OptionNotFound`. They say different things to the person reading them —
 * *"connections are the administrator's"* versus *"that setting does not
 * exist"* — and only the first is true.
 */

import type { TemplateScope } from "@serene-pub/sdk"

/** Who is asking, and from where. `sessionId` is set only for a session they own. */
export interface Viewer {
	userId: number
	isAdmin: boolean
	sessionId?: number
	/**
	 * Set when this session's own values for the pipeline are read-only — its
	 * creation pipeline, once the session is created (owner ruling
	 * 2026-09-30): the sentence saying why. The view stays the session's
	 * (`scope` says so), every row reads as read-only, and a session-scope
	 * write is refused with this sentence.
	 */
	readOnlyBecause?: string
}

/** Where a value won. `author` means nothing overrode the declared default. */
/**
 * Where a resolved value came from (12 §2 as simplified 2026-08-24): the
 * session's override, the selected config, or the author's declared default.
 * The SDK's `ScopeKind` spelling. Never stored: the panel computes it per
 * read.
 */
export type OptionSource = "session" | "config" | "author"

/** The scopes a person writes at. `author` is not writable here. */
/**
 * Where an edit lands: the session's override row, or the selected config's own
 * value ("config"). The former instance/user scopes are gone — an admin's
 * site-wide edit *is* an edit to the config (ruled 2026-08-24).
 */
export type WriteScope = "session" | "config"

export interface ConfigOption {
	id: string
	label: string
	/**
	 * The step this option belongs to: its opaque handle (`stepKeyFor`, never
	 * the node key) and its heading (its step label, else its definition's
	 * name — never a counter). What the builder lists a step by, and how a
	 * front row in a settings group is traced back to the step that owns it.
	 */
	step: { key: string; heading: string }
	description?: string
	control: string
	/** The value declaration (24 T6c) — single-key, for value-decl controls. */
	decl?: Record<string, Record<string, unknown>>
	min?: number
	max?: number
	of?: readonly string[]
	/**
	 * For a `*-ref` control: what this option may be pointed at.
	 *
	 * Sent with the option rather than fetched separately, because the list is
	 * *scoped by the declaration* — a prompts slot may only offer prompts from
	 * this namespace, and a connection slot only connections that can do what
	 * the node declared it requires. A panel that fetched "all prompts" would
	 * have to re-derive both rules on the client, where the second copy
	 * eventually disagrees.
	 */
	choices?: Array<{
		id: number
		label: string
		description?: string
		/**
		 * Offered but not usable here — it exists, it simply cannot do what this
		 * slot requires. **The client must render these**, greyed, with `reason`
		 * beside them. Omitting them is the behaviour this replaces: a
		 * connection merely absent from a list makes "why isn't mine there"
		 * unanswerable on the screen that raised the question.
		 */
		disabled?: boolean
		/**
		 * Why, in a person's words — never a raw capability id.
		 *
		 * Present without `disabled` for a connection nobody has tested yet,
		 * which is *undetermined* rather than incapable: it stays selectable and
		 * says so, because treating "we never asked" as a no would empty the
		 * picker on every install that upgraded into the capability model.
		 */
		reason?: string
		/**
		 * For a `connection-ref` choice: the MODELS on that endpoint (0114).
		 *
		 * Carried on the choice rather than fetched when one is picked, for the
		 * ride-along reason `prompt` gives below: the second half of the pair
		 * would otherwise be one round trip away from every selection, which in
		 * practice means the model picker renders empty for a moment on every
		 * change and the person sees the star flicker.
		 *
		 * Absent where the endpoint has none, which is how the panel knows not
		 * to render a picker with no choice in it.
		 */
		models?: Array<{
			id: number
			/** What a person sees. */
			name: string
			/** What the adapter sends — the tooltip, when the two differ. */
			model: string
			enabled: boolean
			/** Set while the host has stopped listing it — offered greyed, with the reason. */
			missingSince: string | null
		}>
	}>
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
		/**
		 * The field names *this node* declares, which is not always all of
		 * them. The graph builder's five steps share one prompt row carrying
		 * five texts, and each step declares exactly one — so rendering the row
		 * put all five editors on all five steps: twenty-five boxes for five
		 * texts, and every step offering to edit the other four.
		 *
		 * Now that a prompt is pooled per `(node definition, slot)` the graph steps
		 * hold five separate rows rather than one shared five-field one, so this
		 * is usually the whole field set — but it stays the authority, because a
		 * row written against @1 outlives the slot that dropped a field in @2.
		 */
		declared: string[]
		/**
		 * Text for fields the slot no longer declares, off `archived_fields`.
		 *
		 * Read-only and shown apart from the editors. Left in `fields` it would
		 * be invisible — the panel renders one box per DECLARED field — so a
		 * prompt someone spent an afternoon on becomes unfindable rather than
		 * merely unused. This is the "reference/copy it later" half.
		 */
		archived?: Record<string, string>
		/** Which group it fell into, so the editor can say where it came from. */
		group?: "usedHere" | "shipped" | "alsoFits"
		/** The pipeline it was written in, when that is not this one. */
		origin?: string
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
	 * `nodeDefinitionId` is deliberately **not** here, for the reason the variable id
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
		/** The template engine id it is written in (P7). */
		engine?: string
	}
	/**
	 * For a `context-template-ref` option: every language this slot renders,
	 * most-preferred first.
	 *
	 * On the option rather than inside `contextTemplate`, for the reason
	 * `promptFields` is: the create button needs it precisely when no row is
	 * selected. A slot that accepts one language sends the one, so a client can
	 * treat "more than one entry" as "offer a choice" without a second flag.
	 */
	acceptedEngines?: string[]
	/**
	 * For a `context-template-ref` option: what the template can reference at
	 * this node, typed (typed templates P3, SDK `templateScopeAt` over the
	 * stored document) — the node's own names, its prompts, the context
	 * builder's declared keys, the bands declared upstream, `annex.<owner>.<key>`
	 * and `state`. For the editor's completion, hover and lint (P7).
	 *
	 * Template names and their descriptions only — public vocabulary, the
	 * same words a template author types — never a node key or a declarer.
	 */
	scope?: TemplateScope
	/**
	 * For a `context-template-ref` option: who supplies each root of `scope`
	 * — a type's display name and a ranking group, never a node key (P7).
	 */
	scopeDeclarers?: Record<string, { label: string; group: string }>
	/**
	 * For a `context-template-ref` option: producers feeding the template
	 * with no declared types, by label. Non-empty = an unknown name may still
	 * arrive, so the editor warns instead of refusing (P7).
	 */
	scopeUntyped?: Array<{ label: string }>
	/**
	 * For a `share` or `per-member` control: the bands, in render order.
	 *
	 * Carried on the option because the set is a fact about the *declaration*.
	 * A client that rebuilt it would be inventing the one thing the schema
	 * exists to state, and a plugin's sixth retrieval source would render as a
	 * nameless band.
	 */
	members?: readonly {
		key: string
		label?: string
		description?: string
		tone?: number
	}[]
	/** For a `share` control: the tokens the split divides. See read.ts. */
	windowTokens?: number
	/**
	 * For a `list` control: the declaration every row satisfies, with its
	 * display text already resolved.
	 *
	 * The list editor renders from THIS and from nothing it knows about any
	 * particular list — which is what a `list` kind in the field language buys
	 * over a bespoke control per list. A plugin declaring an ordered list of its
	 * own rows gets the same editor, labelled, with no client change.
	 */
	item?: {
		fields: Array<{
			key: string
			label: string
			control: string
			of?: readonly string[]
			members?: readonly {
				key: string
				label?: string
				description?: string
			}[]
			default?: unknown
		}>
	}
	/**
	 * For a `scripts-chain` option: the resolved chain, hydrated in order.
	 *
	 * The value is the ordered id list; this is what those ids *are* — name,
	 * badge, enabled — so the panel renders the chain without a second fetch,
	 * the same ride-along `prompt` makes. An id whose row was deleted since
	 * still appears, marked `missing`, because a dangle the panel hides is a
	 * chain that quietly shrank.
	 */
	scripts?: Array<{
		id: number
		name: string
		enabled: boolean
		typeLabel: string
		blastRadius: string
		operation: string
		missing?: boolean
	}>
	/**
	 * The effective view's other half (18 §4c): stop guards the run's
	 * connection carries, shown beside the chain with provenance so "why did
	 * my reply cut off" is answerable from the step card. Read-only — they are
	 * managed on the connection.
	 */
	connectionScripts?: {
		connectionName: string
		entries: Array<{ id: number; name: string; enabled: boolean }>
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
	/**
	 * True when the **configuration** holds a row for this address — that is,
	 * when somebody departed from the declared default (ruled 2026-09-10).
	 *
	 * The panel's changed marker, and the Changes view's membership test. Not a
	 * synonym for `overriddenHere`: that one follows the scope an edit lands
	 * at, so inside a session it describes the session's own override instead.
	 */
	changed: boolean
	/**
	 * For a `connection-ref` or `sampling-ref`: what this option resolves to
	 * when nothing is stored at the scope this viewer writes — the first
	 * choice a picker offers, and what Reset lands on (owner rulings
	 * 2026-09-30). `from` says whose it is; `label` is the whole line, value
	 * NAMED (*As configured — Nemo 12B · KoboldCpp*, *Pipeline default —
	 * Background*, *Instance default — …*, *No model set*).
	 */
	inherits?: OptionInherits
	/**
	 * For a `connection-ref` or `sampling-ref`: where the value in force came
	 * from, as the one muted line under the control (*Set for this session*,
	 * *From the “Adventure” configuration*, *Pipeline default*, *Instance
	 * default*).
	 */
	provenance?: OptionProvenance
	/**
	 * For a `*-ref` option: the NAME of the value in force — what a read-only
	 * row shows, never an id. For an unset model or sampling slot, the
	 * pub default that runs in its place.
	 */
	valueLabel?: string
}

/** See `ConfigOption.inherits`. */
export interface OptionInherits {
	from: "config" | "pipeline" | "pub" | "none"
	label: string
}

/** See `ConfigOption.provenance`. */
export interface OptionProvenance {
	source: "session" | "config" | "author" | "pub" | "none"
	label: string
}

/**
 * One step's rows inside a settings group's Advanced, headed by the step's
 * heading (its step label, else its definition's name — never a counter).
 * `key` is the step's opaque handle (`stepKeyFor`), the same one each of its
 * options carries in `step.key`.
 */
export interface SettingsGroupStep {
	key: string
	heading: string
	options: ConfigOption[]
}

/**
 * A **settings group** (owner rulings 2026-09-30, Q5): one model call and
 * what exists only to serve it — derived from the graph (`groups.ts`), never
 * declared. What the settings show as an **agent** (Q3): the display word;
 * this is the payload's. `kind: "pipeline"` is the *Whole pipeline* group —
 * everything no model call claims.
 *
 * `front` is the group's face, in a fixed order: its prompt (a prompts-ref,
 * or an envoy's texts), its connection, its sampling, then each source's
 * switch (a query step's `enabled`, labelled by its step heading); `enabled`
 * is the model call's own on/off switch when it has one. Everything else is
 * `advanced`, one entry per step in spine order.
 *
 * `heading` is absent on the one group of a spec with a single model call
 * (or none), and whenever only one group has anything to show this viewer.
 */
export interface SettingsGroup {
	key: string
	kind: "model-call" | "pipeline"
	heading?: string
	purpose?: string
	enabled?: ConfigOption
	front: ConfigOption[]
	advanced: SettingsGroupStep[]
	/** How many Advanced options the configuration changed — the fold's "2 changed". */
	changedInAdvanced: number
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
	/**
	 * Whether a non-admin may choose this preset. Admin's site-wide switch.
	 *
	 * Only ever `false` in an admin's view: a withdrawn configuration is not
	 * listed for anyone else (R8 — people choose from the curated set), so a
	 * non-admin never receives one to render.
	 */
	enabled: boolean
	/**
	 * Which of the mode's actions sessions on this preset include (19 §3).
	 *
	 * `null` is not `[]`: null means the preset states nothing and the
	 * companion rule decides, so a companion shipped later reaches sessions whose
	 * preset never had a view. `[]` means somebody said none.
	 */
	includedActions: string[] | null
}

export interface NamespaceSummary {
	slug: string
	name: string
	version: string
	event: string | null
	enabled: boolean
	/** Catalogue claims (23 §2), or null = unclassified. */
	taxonomy: { zone?: string; role?: string; mode?: string } | null
}

export interface NamespaceView extends NamespaceSummary {
	configs: NamedConfigSummary[]
	/**
	 * Every action this pipeline's mode is offered (19 §3) — the checklist the
	 * preset editor renders. Empty where the pipeline serves no mode.
	 *
	 * Sent with the view rather than fetched separately so the editor's list
	 * and the session's list come from one read of the same rows: a preset that
	 * could include an action no session would ever see is the two halves of one
	 * fact disagreeing.
	 */
	modeActions: {
		/** The action's key; with `specSlug`, its identity (plans/31 V2). */
		key: string
		name: string
		specSlug: string
		origin: "companion" | "foreign"
	}[]
	selectedConfig: { id: number; name: string; source: string } | null
	/**
	 * Whether this viewer may change the selection from here (R8).
	 *
	 * False for a non-admin outside a session: the selection they would be
	 * making is the pub's, and that one is the administrator's. The panel
	 * shows what is selected instead of offering a control that is refused.
	 */
	canSelectConfig: boolean
	/**
	 * The settings, grouped by model call (owner rulings 2026-09-30) — what
	 * every surface renders. See `SettingsGroup`.
	 */
	groups: SettingsGroup[]
	/**
	 * Where this view's edits land: the session's own override, or the
	 * selected configuration. A panel keys the view by its slug AND this, so
	 * two panels on one pipeline at different scopes never take each other's
	 * answers.
	 */
	scope: ViewScope
}

/** See `NamespaceView.scope`. */
export type ViewScope =
	| {
			kind: "session"
			sessionId: number
			/** Set when the session's values here are read-only: why (`Viewer.readOnlyBecause`). */
			readOnlyBecause?: string
	  }
	| { kind: "config" }

/** The id named nothing here — a stale handle, or one minted on another install. */
export class OptionNotFoundError extends Error {}

/** The scope may not write that slot. The message is written for a person (15 §1.3). */
export class OptionNotWritableError extends Error {}

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
	/**
	 * One of the few settings people actually reach for on this node.
	 *
	 * Declared by whoever wrote the type — see `SlotDecl.quick`. The panel
	 * leads with these and puts the rest one disclosure away; nothing is
	 * hidden, and the ordering is the author's rather than a guess made from
	 * type or position in the client.
	 */
	quick?: boolean
	/**
	 * What the node *is* — `query`, `task`, `provider`, `consumer`.
	 *
	 * A kind, not a topology: it says a step reads data or calls a model, which
	 * is the difference between "this fetches lore" and "this costs a request".
	 * The step label alone cannot carry that — "Assemble" and "Generate text"
	 * read identically until you know one of them talks to a server.
	 */
	nodeKind: string
	label: string
	/**
	 * Author-provided help text, when the descriptor carried one. Display
	 * only — it is stripped from the type content hash for the same reason
	 * `i18n` is, so copyediting an explanation never bumps a type version.
	 */
	description?: string
	control: string
	/**
	 * For a `connection-ref` or `sampling-ref` control: the modality this slot
	 * speaks, as a shape id.
	 *
	 * **Superseded by `requires`.** A shape is a single-modality label — "an
	 * image-gen connection" — and a real backend is not one modality; KoboldCPP
	 * answers for text, images and speech from one process. `requires` says the
	 * same thing as a relation the connection can be asked about
	 * (`text->image`), which is the fact without the assumption. Kept because
	 * every slot authored before capabilities existed declares only this, and a
	 * picker that ignored it would offer those slots everything.
	 */
	shape?: string
	/**
	 * For a `connection-ref` control: what the connection in this slot must be
	 * able to do, as capability ids (`SlotDecl.requires`).
	 *
	 * The narrowing rule when present: a connection that cannot do these is
	 * still *offered*, marked disabled with the missing capability named, so
	 * "why isn't my connection in the list" has an answer on the screen that
	 * raised the question.
	 */
	requires?: readonly string[]
	/**
	 * What the binding uses if present and copes without (`SlotDecl.optional`).
	 *
	 * Never a filter — an absent optional capability is a branch the node
	 * already handles. Carried so the panel can say which of a connection's
	 * powers this step would actually reach for.
	 */
	optional?: readonly string[]
	/** The value declaration (24 T6c) — single-key, for value-decl controls. */
	decl?: Record<string, Record<string, unknown>>
	min?: number
	max?: number
	of?: readonly string[]
	/**
	 * For a `share` or `per-member` control: the bands, in render order, each
	 * with its label and colour index.
	 *
	 * Sent with the option for the same reason `choices` is — the set is a fact
	 * about the *declaration*, and a client that rebuilt it would be inventing
	 * the one thing the schema exists to state. A plugin adding a sixth
	 * retrieval source gets a labelled band with no client change at all.
	 */
	members?: readonly {
		key: string
		label?: string
		description?: string
		tone?: number
	}[]
	/**
	 * For a `list` control: the declaration every row satisfies, with its
	 * display text already resolved.
	 *
	 * The list editor renders from THIS and from nothing it knows about any
	 * particular list — which is what a `list` kind in the field language buys
	 * over a bespoke control per list. A plugin declaring an ordered list of its
	 * own rows gets the same editor, labelled, with no client change.
	 */
	item?: {
		fields: Array<{
			key: string
			label: string
			control: string
			of?: readonly string[]
			members?: readonly {
				key: string
				label?: string
				description?: string
			}[]
			default?: unknown
		}>
	}
	authorDefault?: unknown
	/**
	 * For a template slot: which language its source is written in, as a
	 * registered engine id. Carried through so a stored value keeps its engine
	 * rather than inheriting whatever core happens to render with today.
	 *
	 * The one-element spelling of `acceptedEngines`. Resolve both through
	 * `acceptedEnginesOf`, never either alone.
	 */
	engine?: string
	/**
	 * For a template slot: every language it accepts, most-preferred first.
	 *
	 * Carried whole rather than collapsed to one here, because the picker needs
	 * the union of the accepted pools and the create path needs the first
	 * entry, and collapsing at projection time would leave the second caller
	 * unable to reconstruct the first.
	 */
	acceptedEngines?: readonly string[]
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
	 * For a variables slot: this key is a **band** declared upstream of the
	 * node (typed templates P2, `SlotDecl.rendersBands`) rather than one of the
	 * node's own `renders`. `world.ts` resolves every band key even with no
	 * layout selected, because the resolved keys are how Assemble learns which
	 * bands to render at the top level. Server-side only.
	 */
	band?: true
	/**
	 * For a `context-template-ref`: the template's typed scope at this node
	 * (typed templates P3). Surfaced on the option as `scope`.
	 */
	templateScope?: TemplateScope
	/** Who supplies each root of `templateScope`, as labels (P7). */
	templateDeclarers?: Record<string, { label: string; group: string }>
	/** Producers feeding the template untyped, as labels (P7). */
	templateUntyped?: string[]
	/** The template slot's own declared names — the definition's static scope (P7). */
	templateStaticScope?: TemplateScope
	/**
	 * The node definition this option's row pool is keyed by, version stripped.
	 *
	 * For `context-template-ref`: the node whose context the template renders.
	 * For `prompts-ref`: the node that consumes the prose — with `slot`, which
	 * every Decl already carries, it IS the prompt pool. Half a key on its own:
	 * a type may declare more than one prompts slot with different field sets,
	 * and merging them would offer each the other's fields.
	 *
	 * Either way a picker offers rows matching it and selection refuses across
	 * it. Server-side only — it is a node-shaped string the payload scan reads
	 * as topology, and the client addresses every write by option handle.
	 */
	nodeDefinitionId?: string
	/**
	 * For a `scripts-chain` option: the script types this hook accepts, as
	 * pinned ids (18 §4a). The whole attachment rule — the picker offers rows
	 * of these types and nothing else, and the write refuses across it.
	 * Server-side only: type ids are id-shaped strings the payload scan must
	 * not carry, and the client never needs them — choices arrive resolved.
	 */
	accepts?: string[]
	/** The type this came from — used only to disambiguate a repeated label. */
	typeLabel: string
	/**
	 * The step's heading: its step label (`expose.label`) when the spec gave
	 * one, else `typeLabel`. Set by `declarations()` for every decl; never
	 * numbered.
	 */
	stepHeading?: string
}
