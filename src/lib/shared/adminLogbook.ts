/**
 * The **admin logbook** — who changed what on this instance, and when (the
 * Django admin's "History"). One **logbook record** per successful admin
 * change: the actor, the object it touched, the action, a one-line summary
 * and a redacted field diff.
 *
 * ⚠ Not the lore **history** (history entries, the `history` band), and not
 * `binding_merge_logs` (the graph absorb's undo record, which comments call an
 * "audit log"). The UI calls this section **History** — prose, like Django's
 * button — but code never says `history` for it (NOMENCLATURE R1/R2).
 *
 * Shared because the address contract is shared: a change form links to
 * `/admin/history?type=<logbook object type>&id=<object id>`, and the type
 * keys below are what it must put in `type`.
 */

/** What a logbook record says happened to its object (Django's ADDITION/CHANGE/DELETION, plus one). */
export type LogbookAction = "add" | "change" | "delete" | "other"

export const LOGBOOK_ACTIONS: readonly LogbookAction[] = [
	"add",
	"change",
	"delete",
	"other"
]

export const LOGBOOK_ACTION_LABELS: Record<LogbookAction, string> = {
	add: "Added",
	change: "Changed",
	delete: "Deleted",
	other: "Action"
}

export interface LogbookObjectType {
	/** Singular, lower-case prose: "connection", "sampling config". */
	label: string
	/** Where the object lives in the Admin view, when it has a page of its own. */
	href?: (id: string | null) => string | null
}

const at = (base: string) => (id: string | null) =>
	id == null ? base : `${base}/${encodeURIComponent(id)}`

/**
 * Every **logbook object type**. The key is the `?type=` value in a History
 * link; `id` is the object's own id as text (numeric ids, a component's
 * 10-character id, a plugin slug, a genre id, a capability id). Singletons —
 * the instance settings, the tunnel, the managers — carry no id.
 */
export const LOGBOOK_OBJECT_TYPES = {
	instance: { label: "instance settings", href: () => "/admin/general" },
	"capability-default": {
		label: "capability default",
		href: () => "/admin/defaults"
	},
	connection: { label: "connection", href: at("/admin/connections") },
	"sampling-config": { label: "sampling config", href: at("/admin/sampling") },
	user: { label: "user", href: at("/admin/users") },
	invite: { label: "invite", href: () => "/admin/users/invites" },
	"two-factor": { label: "two-factor", href: at("/admin/users") },
	backup: { label: "backup", href: () => "/admin/data" },
	tunnel: { label: "tunnel", href: () => "/admin/network" },
	plugin: { label: "plugin", href: () => "/admin/plugins" },
	component: { label: "component", href: at("/admin/components") },
	"completion-template": {
		label: "completion template",
		href: at("/admin/completion-templates")
	},
	"session-genre": { label: "genre", href: at("/admin/session-genres") },
	"session-preset": { label: "preset", href: at("/admin/session-presets") },
	pipeline: { label: "pipeline", href: at("/admin/pipelines") },
	prompt: { label: "prompt", href: at("/admin/prompts") },
	"context-template": {
		label: "context template",
		href: at("/admin/context-templates")
	},
	"variable-template": {
		label: "variable template",
		href: at("/admin/variable-templates")
	},
	script: { label: "script", href: at("/admin/scripts") },
	theme: { label: "instance theme" },
	koboldcpp: { label: "KoboldCPP manager" },
	ollama: { label: "Ollama manager" },
	"chara-vault": { label: "CharaVault account", href: () => "/admin/general" }
} satisfies Record<string, LogbookObjectType>

export type LogbookObjectTypeId = keyof typeof LOGBOOK_OBJECT_TYPES

export function isLogbookObjectType(v: unknown): v is LogbookObjectTypeId {
	return typeof v === "string" && Object.hasOwn(LOGBOOK_OBJECT_TYPES, v)
}

/** One field of a logbook record's diff. Values are already redacted and clipped. */
export interface LogbookChange {
	/** Dotted path into the object: `defaultLanguage`, `values.temperature`. */
	field: string
	/** The field in prose: "default language". */
	label: string
	before?: unknown
	after?: unknown
	/** A secret changed; neither value is kept. */
	redacted?: true
}

/** A logbook record as the History section reads it. */
export interface LogbookRecordView {
	id: number
	/** ISO 8601. */
	at: string
	actorUserId: number | null
	/** The actor's name when it happened, so a deleted user still reads. */
	actorName: string
	/** The socket event that made the change, e.g. `connections:update`. */
	event: string
	objectType: string
	objectId: string | null
	objectLabel: string
	action: LogbookAction
	summary: string
	changes: LogbookChange[]
}
