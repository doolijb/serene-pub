/**
 * **Notifications** — one per-user list of things that happened to you or are
 * waiting on you, shown in the Activity view (plan of record:
 * `~/.claude/plans/PLAN-notifications-2026-09-28.md`).
 *
 * Kept in `shared` so the server (which raises and clears rows) and the client
 * (which renders them) read one declaration of each **notification kind**.
 *
 * ## What it is not
 *
 * - Not the admin **Needs you** list (`server/admin/attention.ts`). That list is
 *   DERIVED from instance conditions on every read and cannot be dismissed; a
 *   notification is a stored row about one person. A condition that stays true
 *   (a stale backup, a missing chat model) belongs there, never here — a
 *   dismissable copy would let someone hide something still broken (the
 *   news-vs-condition rule, `schema.ts` `session_preset_notices`).
 * - Not a **notice** (config notices, §6) and not the plugin event host's
 *   fire-and-forget fan-out (`plugins/eventHost.ts`).
 * - Never a bare `Notification` type: that is the DOM global.
 *
 * ## The words
 *
 * - **regarding** — the per-user dedupe key (`session:42/move`). Raising the
 *   same `regarding` again bumps the open row instead of adding one. Not
 *   _subject_ (a turn entry's, a binding's, an amendment's).
 * - **level** — `error` · `attention` (the admin list's `AttentionLevel`, and
 *   the same §6.11 dot colours) · `info`.
 * - **href** — where the call to action goes: a view address, the same string
 *   a link to that place would carry. Not _destination_ (the model finder's).
 * - **read** → **cleared**. A row is read once its person has seen it; it is
 *   cleared once it stops needing them, and `clearedHow` says why.
 */
import type { I18n } from "@serene-pub/sdk"

export type NotificationLevel = "error" | "attention" | "info"

/**
 * What clears a row of this kind.
 *
 * - `view` — **news**: it happened, and seeing it is enough.
 * - `resolve` — a **condition**: it clears only when it stops being true;
 *   viewing it only marks it read.
 * - `either` — whichever comes first.
 */
export type NotificationClearsOn = "view" | "resolve" | "either"

export const NOTIFICATION_CLEARED_HOW = [
	"viewed",
	"acted",
	"superseded",
	"dismissed",
	"lapsed"
] as const
export type NotificationClearedHow = (typeof NOTIFICATION_CLEARED_HOW)[number]

export const NOTIFICATION_LEVELS = ["error", "attention", "info"] as const

/** A row's substitution values: `{session}` → "The Guard Room". */
export type NotificationVars = Record<string, string | number>

/**
 * One notification kind. Its text lives HERE, not on the row: a row carries
 * only `vars`, so the words can be translated (the en template goes through
 * `t()` on the client, `statusText`) and corrected without rewriting rows.
 */
export interface NotificationKindDecl {
	/** `core:notification/<slug>@1`. */
	id: string
	level: NotificationLevel
	clearsOn: NotificationClearsOn
	title: I18n
	detail?: I18n
	/** The call to action's label: "Open session", "Answer". */
	cta: I18n
	/**
	 * The thing it is about lives only in server memory, so a restart makes
	 * every open row of this kind point at nothing. The boot sweep clears
	 * them as `lapsed`.
	 */
	memoryBacked?: boolean
}

/** A row as it crosses the wire. Dates are ISO strings. */
export interface NotificationRow {
	id: number
	kind: string
	regarding: string
	level: NotificationLevel
	href: string
	vars: NotificationVars
	raisedAt: string
	lastRaisedAt: string
	readAt: string | null
	clearedAt: string | null
	clearedHow: NotificationClearedHow | null
}

const registry = new Map<string, NotificationKindDecl>()

/**
 * Declare a kind. Idempotent on an identical redeclare — a module evaluated
 * twice under HMR must not fail — and a throw on a CONFLICTING one, because two
 * meanings for one id is exactly the bug a registry exists to refuse.
 */
export function defineNotificationKind<T extends NotificationKindDecl>(
	decl: T
): T {
	const prior = registry.get(decl.id)
	if (prior && JSON.stringify(prior) !== JSON.stringify(decl))
		throw new Error(
			`Notification kind ${decl.id} is already declared differently`
		)
	registry.set(decl.id, decl)
	return decl
}

export function notificationKind(id: string): NotificationKindDecl | undefined {
	return registry.get(id)
}

export function notificationKinds(): NotificationKindDecl[] {
	return [...registry.values()]
}

// ── Core kinds ─────────────────────────────────────────────────────────────

/**
 * You are next in the rotation: the stored turn order's head is your own
 * entry (owner ruling 2026-09-28, Q1). Only where there IS a rotation — a
 * narrator genre's empty order, or an AI turn left unfired, raises nothing.
 * The words are the composer line's (A8): "Your turn".
 */
export const YOUR_MOVE = defineNotificationKind({
	id: "core:notification/your-move@1",
	level: "attention",
	clearsOn: "resolve",
	title: "Your turn in {session}",
	cta: "Open session"
})

/**
 * An **open form** addressed to you (a person, never the AI — the AI case is
 * `form-addressed`, §9). Answering clears it; so does a newer line that
 * leaves it stale.
 */
export const OPEN_FORM = defineNotificationKind({
	id: "core:notification/open-form@1",
	level: "attention",
	clearsOn: "either",
	title: "A question is waiting for you in {session}",
	cta: "Answer"
})

/** A reply you asked for failed. News: seeing it is enough. */
export const REPLY_FAILED = defineNotificationKind({
	id: "core:notification/reply-failed@1",
	level: "error",
	clearsOn: "view",
	title: "A reply failed in {session}",
	detail: "{error}",
	cta: "Open session"
})

/**
 * A background job of yours (a graph build, a scene or session summary, a
 * history compile) is waiting for your review. The job lives in server memory
 * (`activityStore`), so a restart lapses the row. Cleared `acted` on apply,
 * `dismissed` when the card is dismissed.
 */
export const ACTIVITY_READY = defineNotificationKind({
	id: "core:notification/activity-ready@1",
	level: "attention",
	clearsOn: "resolve",
	title: "{job} is ready to review",
	detail: "{subject}",
	cta: "Review",
	memoryBacked: true
})

/** A background job of yours failed. Its card stays until dismissed. */
export const ACTIVITY_FAILED = defineNotificationKind({
	id: "core:notification/activity-failed@1",
	level: "error",
	clearsOn: "either",
	title: "{job} failed",
	detail: "{subject}",
	cta: "Open",
	memoryBacked: true
})

/** A model download YOU started finished. News, for the admin who started it. */
export const DOWNLOAD_DONE = defineNotificationKind({
	id: "core:notification/download-done@1",
	level: "info",
	clearsOn: "view",
	title: "{model} finished downloading",
	cta: "Open"
})

/** A model download YOU started failed. */
export const DOWNLOAD_FAILED = defineNotificationKind({
	id: "core:notification/download-failed@1",
	level: "error",
	clearsOn: "view",
	title: "{model} failed to download",
	detail: "{error}",
	cta: "Open"
})

/**
 * A newer release is out (every admin). Replaces the interim update bar.
 * Superseded by a newer tag, and cleared once the pub runs it.
 */
export const UPDATE_AVAILABLE = defineNotificationKind({
	id: "core:notification/update-available@1",
	level: "attention",
	clearsOn: "view",
	title: "Serene Pub {tag} is available",
	cta: "See the update"
})

/**
 * A 0.5.3 database finished upgrading (every admin, once). News: what changed
 * or could not be carried is in the admin History as upgrade notes.
 */
export const DATA_UPGRADE_DONE = defineNotificationKind({
	id: "core:notification/data-upgrade-done@1",
	level: "info",
	clearsOn: "view",
	title: "Your 0.5.3 data was upgraded to 0.6",
	detail: "{notes} upgrade note(s) to read in History",
	cta: "Open History"
})

/**
 * The `regarding` keys, built in one place so a raise and its clear can never
 * spell the same thing two ways.
 */
export const regardingFor = {
	/** One per activity: ready and failed share it, so failing replaces ready. */
	activity: (activityId: string) => `activity:${activityId}`,
	/** `source` is `koboldcpp` · `ollama` · `onnx`; `key` names the model. */
	download: (source: string, key: string) => `download:${source}:${key}`,
	update: () => `app:update`,
	dataUpgrade: () => `app:data-upgrade`,
	move: (sessionId: number) => `session:${sessionId}/move`,
	form: (sessionId: number, messageId: number, blockId: string) =>
		`session:${sessionId}/form:${messageId}/${blockId}`,
	/** The prefix every `form` key of one session starts with. */
	formsIn: (sessionId: number) => `session:${sessionId}/form:`,
	replyFailed: (sessionId: number, messageId: number) =>
		`session:${sessionId}/failed:${messageId}`
}

/** The session page, optionally landed on one message (and a block in it). */
export function sessionHref(
	sessionId: number,
	messageId?: number,
	blockId?: string
): string {
	if (messageId === undefined) return `/sessions/${sessionId}`
	const q = new URLSearchParams({ message: String(messageId) })
	if (blockId) q.set("block", blockId)
	return `/sessions/${sessionId}?${q}`
}
