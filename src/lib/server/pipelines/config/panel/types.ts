/**
 * The vocabulary of the configuration panel.
 *
 * An **option** is a `(nodeKey, slot, path)` address resolved through the scope
 * chain, presented to a caller as an opaque id and a label. A **Decl** is the
 * other side of it: what the type registry says *can* be configured, before any
 * user value is applied. Everything else in this directory produces, resolves,
 * or writes one of these.
 *
 * The two error types are a distinction the caller depends on: an id naming a
 * slot the asker may not write must fail as `OptionNotWritable`, not as
 * `OptionNotFound`. They say different things to the person reading them —
 * *"connections are the administrator's"* versus *"that setting does not
 * exist"* — and only the first is true.
 */

/** Loose on purpose — callers pass the app db and the test db interchangeably. */
export type Db = {
	select: any
	insert: any
	update: any
	delete: any
}

/** Who is asking, and from where. `sessionId` is set only for a session they own. */
export interface Viewer {
	userId: number
	isAdmin: boolean
	sessionId?: number
}

/** Where a value won. `author` means nothing overrode the declared default. */
/**
 * Where a resolved value came from (12 §2 as simplified 2026-08-24): the
 * session's override, the selected config ("preset" kept as the wire literal so
 * clients need no migration), or the author's declared default.
 */
export type OptionSource = "session" | "preset" | "author"

/** The scopes a person writes at. `preset` and `author` are not writable here. */
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
	 * What *kind* of setting this is — `prompts`, `variables`, `weights`,
	 * `review`, and so on — as the descriptor's slot declared it.
	 *
	 * Deliberately not the node. The panel groups by this because a facet is
	 * what a person is looking for ("where do I change how lore is laid out")
	 * while a node is where the machine happens to compute it: the twelve
	 * `variables` options live on two different nodes purely because assembly
	 * lays out lore *after* budgeting decided what fit, and grouping by node
	 * split them across two headings for a reason no user has.
	 *
	 * It also stays inside 05 §0a's boundary — a facet names a kind, never a
	 * node key, a count, or an order.
	 */
	facet: string
	/** One of the few settings people reach for — see `Decl.quick`. */
	quick?: boolean
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
		 */
		declared: string[]
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
	/** `query` | `task` | `provider` | `consumer` — what this step does. */
	kind: string
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
	/** Whether a non-admin may choose this preset. Admin's site-wide switch. */
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

/**
 * One kind of setting, as the panel needs to render it.
 *
 * Sent with the view rather than known by the client, for the same reason a
 * share's bands are: the client used to hold this as a hardcoded list, and that
 * list was not a fallback but a *filter* — an option whose facet was not in it
 * matched no group and rendered nowhere at all.
 */
export interface FacetView {
	id: string
	label: string
	order: number
	simple: boolean
}

export interface NamespaceView extends NamespaceSummary {
	/** The kinds of setting this view contains, in render order. */
	facets: FacetView[]
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
		function: string
		name: string
		specSlug: string
		origin: "companion" | "attachment"
	}[]
	selectedConfig: { id: number; name: string; source: string } | null
	steps: ConfigStep[]
	writeScope: WriteScope
}

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
}
