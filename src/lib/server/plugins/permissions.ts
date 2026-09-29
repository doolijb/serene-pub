/**
 * The permission model — fine-grained, manifest-declared, deny-by-default.
 *
 * A plugin's manifest *declares* what it wants across three axes: system
 * permissions (storage, network), SP Core resources, and events. Nothing is
 * ambient — a permission the manifest did not declare is simply never derived.
 * On top of the declaration, an **admin can deny any single permission** at the
 * plugin level; the *effective* set is `declared − admin-denied`, and every
 * permission grant the sandbox hands out (the storage quota + admin override,
 * the per-host fetch allowlist) is derived from the effective set, never the raw
 * manifest.
 *
 * **Nothing is granted until an admin has looked at it.** A declaration is a
 * request, not a grant: the effective set is `declared − admin-denied − *not yet
 * reviewed*`, so a plugin whose permissions no one has reviewed loads and runs
 * with every grant-bearing permission refused — inert, not broken. It keeps the
 * ambient stdlib, `ctx.log`, `ctx.random`, `ctx.now` and `ctx.signal`; it gets
 * no storage, no network, no resources and no events.
 *
 * The review record lives in the same `adminDenied` list, as one reserved
 * `__reviewed:…` entry per permission an admin has decided about — the key plus
 * whatever payload was shown with it, so a raised storage quota is a new request
 * rather than an old approval. Deliberately per-permission rather than a
 * whole-set fingerprint, and deliberately not keyed to the bundle hash: an
 * update that asks for nothing new carries every marker forward and needs no
 * re-consent, while anything the plugin did not ask for before has no marker and
 * is therefore denied until someone looks. (The bundle hash is the
 * *other* gate, in `store.ts`: changed bytes force `enabled=false`, so new code
 * cannot run under the old approval either.) Storing it here rather than in a
 * column of its own is what lets every existing reader — `eventHost`,
 * `frameHost`, `store` — inherit the gate without changing a line: they already
 * pass `adminDenied` to `effectivePermissions`.
 *
 * A second layer — **per-user opt-in for account-affecting permissions** (the
 * resource/event kinds) and the session account-visibility view — is marked
 * here (`accountAffecting`) and enforced once the event surface exists; today
 * events are only a consequence of a session, so there is nothing system-wide
 * to opt into yet.
 */
import type { WidgetSectionScope } from "@serene-pub/sdk"

export type PermissionKind = "system" | "resource" | "event"

export interface Permission {
	/** Stable key an admin denial targets, e.g. "storage", "resource:lore:write". */
	key: string
	kind: PermissionKind
	/** Human label for the admin/consent UI. */
	label: string
	/**
	 * Touches the triggering user's own account/data → needs per-user opt-in
	 * (the resource and event kinds). System permissions do not.
	 */
	accountAffecting: boolean
	/** Declaration payload (storage quota, network hosts, …). */
	config?: Record<string, unknown>
}

/** The declared-object form — this app's authoring reference. */
export interface DeclaredPermissions {
	storage?: { quotaBytes?: number }
	network?: { hosts?: string[] }
	resources?: string[]
	events?: string[]
}

export interface PluginManifest {
	/**
	 * Two accepted shapes, one keyed result. The object form above is this app's
	 * authoring reference; the SDK packager instead emits a **compiled flat list**
	 * (`permissions: string[]`, "compiled from usage, never declared") whose keys
	 * are the same taxonomy the audit screen uses — `"storage"`, `"storage:<bytes>"`,
	 * `"network"`, `"network:<host>"`, `"resource:<r>"`, `"event:<e>"`. Both
	 * normalize here so the app can read either without caring which packager
	 * produced the manifest. The two models still diverge on more than this
	 * (transport, hook identity) — see the divergence note in project memory —
	 * but permission-reading is made tolerant of both. An unrecognised key is
	 * *surfaced* as a generic permission, never dropped: the audit screen must
	 * show everything a manifest declared, or a denial cannot target it. The
	 * one exception is a key containing `#`, refused outright
	 * (`isRefusedPermissionKey`): it could spell another permission's review.
	 */
	permissions?: DeclaredPermissions | string[]
	/** Its genres, whose panels may declare `scopes` (read for `widget:<scope>`). */
	genres?: unknown
	/** Its package widgets (R71), each of which may declare `scopes` (read for `widget:<scope>`). */
	widgets?: unknown
}

/**
 * The data a plugin's widget may ask for beyond the base sections
 * (`WidgetDecl.scopes`) — each a permission of its own, `widget:<scope>`,
 * reviewed and deniable like any other. One label per scope in the SDK's one
 * table (`WIDGET_SCOPED_SECTIONS`), held to it by the type: a scope added
 * there without a sentence here does not compile, and could never be
 * granted. `session:full` (the conversation dossier) and `session:state`
 * (R72) are supplied by this build; `lore` is the grant to page the lore by
 * request; the rest are declared-but-absent, and a widget reads their absence.
 */
export const WIDGET_SCOPE_LABELS: Readonly<Record<WidgetSectionScope, string>> = {
	"session:full": "Its widgets see the whole conversation as you do — the cast, your personas, your unsent draft and the session's state",
	"session:state": "Its widgets see the session's stats and states",
	persona: "Its widgets see your persona",
	characters: "Its widgets see the session's characters",
	lore: "Its widgets see the session's lore"
}

/**
 * The scopes a manifest's widgets declare, read off the declarations
 * themselves — a genre's panels (`genres[].shape.panels[].scopes`) and the
 * package's own widgets (R71, `widgets[].scopes`) alike — never trusted to a
 * compiled list, so a package cannot ask for data through a widget and leave
 * the request off its permissions.
 */
export function declaredWidgetScopes(manifest: PluginManifest | null | undefined): string[] {
	const out = new Set<string>()
	const take = (decl: unknown) => {
		const scopes = (decl as { scopes?: unknown } | null)?.scopes
		for (const scope of Array.isArray(scopes) ? scopes : [])
			if (typeof scope === "string" && Object.hasOwn(WIDGET_SCOPE_LABELS, scope)) out.add(scope)
	}
	const genres = Array.isArray(manifest?.genres) ? (manifest!.genres as unknown[]) : []
	for (const g of genres) {
		const panels = (g as { shape?: { panels?: unknown } } | null)?.shape?.panels
		for (const panel of Array.isArray(panels) ? panels : []) take(panel)
	}
	for (const widget of Array.isArray(manifest?.widgets) ? (manifest!.widgets as unknown[]) : []) take(widget)
	return [...out].sort()
}

/**
 * What one panel — or one package widget (R71) — may read: the scopes it
 * asked for that its plugin was granted. It can narrow its plugin's grant,
 * never widen it.
 */
export function panelGrants(
	asked: unknown,
	manifest: PluginManifest | null | undefined,
	adminDenied: string[] | null | undefined
): string[] {
	if (!Array.isArray(asked) || !asked.length) return []
	const granted = new Set(grantedWidgetScopes(manifest, adminDenied))
	return [...new Set(asked.filter((s): s is string => typeof s === "string" && granted.has(s)))]
}

/**
 * The widget scopes an admin has granted this plugin (declared − denied −
 * unreviewed) — only scopes this build knows (`WIDGET_SCOPE_LABELS`). A
 * compiled `widget:<x>` this build does not recognise is surfaced for review
 * as an unknown permission, and approving THAT grants no data: nothing here
 * supplies `<x>`, and a scope a later build learns is reviewed again under
 * its own sentence (`reviewMark`).
 */
export function grantedWidgetScopes(
	manifest: PluginManifest | null | undefined,
	adminDenied: string[] | null | undefined
): string[] {
	return effectivePermissions(declaredPermissions(manifest), adminDenied)
		.filter((p) => isWidgetScopePermission(p))
		.map((p) => p.key.slice("widget:".length))
}

/**
 * The permission each recognised widget scope is reviewed and granted as —
 * `widget:<scope>`, account-affecting, labelled from the one table. The one
 * spelling of that permission: a plugin's manifest reaches it through
 * `declaredPermissions`, and an **authored component** (`server/components`),
 * which has no manifest, through its own widget declaration's `scopes`.
 * A scope this build does not know is dropped: nothing supplies it.
 */
export function widgetScopePermissions(scopes: unknown): Permission[] {
	if (!Array.isArray(scopes)) return []
	const known = new Set(
		scopes.filter(
			(s): s is WidgetSectionScope => typeof s === "string" && Object.hasOwn(WIDGET_SCOPE_LABELS, s)
		)
	)
	return [...known].sort().map((scope) => ({
		key: `widget:${scope}`,
		kind: "resource" as const,
		label: WIDGET_SCOPE_LABELS[scope],
		accountAffecting: true
	}))
}

/** A recognised widget scope's permission — `widget:<scope>` for a scope in the SDK's table. */
function isWidgetScopePermission(p: Permission): boolean {
	return (
		p.kind === "resource" &&
		p.key.startsWith("widget:") &&
		Object.hasOwn(WIDGET_SCOPE_LABELS, p.key.slice("widget:".length))
	)
}

const DEFAULT_STORAGE_QUOTA = 5 * 1024 * 1024
/**
 * The band the sandbox clamps any declared storage quota into (1 KB … 256 MB),
 * mirroring the author-side compiler's range but enforced *here* rather than
 * trusted from the manifest.
 */
export const MIN_STORAGE_QUOTA = 1024
export const MAX_STORAGE_QUOTA = 256 * 1024 * 1024
/**
 * An *admin* storage-quota override may exceed the author band: unlike the
 * manifest value (an untrusted author declaration), an override is a deliberate,
 * trusted admin act. It is still clamped to a sane admin band [1 KB … 2 GB] so a
 * typo cannot hand one plugin the whole disk.
 */
export const MAX_ADMIN_STORAGE_QUOTA = 2 * 1024 * 1024 * 1024

/**
 * The storage quota the sandbox will actually enforce, from whatever a manifest
 * declared. Defense-in-depth, and the single point of truth for *both* accepted
 * manifest shapes: the author-side compiler already rejects an out-of-range
 * quota, but install stores the manifest verbatim and never re-compiles it, so
 * the untrusted value is validated here, where every permission grant is
 * derived. Non-positive / non-finite → the safe default; anything real is
 * clamped into [MIN, MAX] so a manifest can neither break its own storage (a
 * negative quota would reject every write) nor grant itself an unbounded share
 * of the disk (storageHost enforces the number literally).
 */
function normalizeStorageQuota(raw: unknown): number {
	if (typeof raw !== "number" || !Number.isFinite(raw) || raw <= 0)
		return DEFAULT_STORAGE_QUOTA
	return Math.min(
		Math.max(Math.floor(raw), MIN_STORAGE_QUOTA),
		MAX_STORAGE_QUOTA
	)
}

/**
 * An admin's per-plugin storage-quota override, in bytes. A valid positive,
 * finite number is clamped into the admin band and returned; anything else
 * (non-positive, non-finite, non-number, or nullish) yields `undefined`, which
 * the caller reads as "no override — the manifest-derived quota stands".
 */
export function normalizeAdminStorageQuota(raw: unknown): number | undefined {
	if (typeof raw !== "number" || !Number.isFinite(raw) || raw <= 0)
		return undefined
	return Math.min(
		Math.max(Math.floor(raw), MIN_STORAGE_QUOTA),
		MAX_ADMIN_STORAGE_QUOTA
	)
}

/**
 * Fold either accepted permission shape into the object form plus the keys that
 * matched no known permission (surfaced, not discarded).
 */
function toDeclared(
	permissions: DeclaredPermissions | string[] | null | undefined
): { declared: DeclaredPermissions; unknown: string[] } {
	if (!permissions) return { declared: {}, unknown: [] }
	if (!Array.isArray(permissions))
		return { declared: permissions, unknown: [] }

	const declared: DeclaredPermissions = {}
	const resources: string[] = []
	const events: string[] = []
	const hosts: string[] = []
	const unknown: string[] = []
	let storage = false
	let network = false
	for (const raw of permissions) {
		if (typeof raw !== "string" || !raw) continue
		// Refused before it is read at all (`isRefusedPermissionKey`) — not
		// surfaced as unknown, not folded into a known permission.
		if (isRefusedPermissionKey(raw)) continue
		if (raw === "storage") storage = true
		else if (raw.startsWith("storage:")) {
			// The number is not validated here — `normalizeStorageQuota` in
			// `declaredPermissions` is the one gate for both shapes, so a bad
			// value (NaN, negative) folds to the default there rather than
			// diverging between the array and object forms.
			storage = true
			declared.storage = {
				quotaBytes: Number(raw.slice("storage:".length))
			}
		} else if (raw === "network") network = true
		else if (raw.startsWith("network:")) {
			network = true
			const host = raw.slice("network:".length)
			if (host) hosts.push(host)
		} else if (raw.startsWith("resource:"))
			resources.push(raw.slice("resource:".length))
		else if (raw.startsWith("event:"))
			events.push(raw.slice("event:".length))
		// Read off the panels and widgets themselves (`declaredWidgetScopes`); the compiled
		// key is the CLI's echo of the same declaration.
		else if (raw.startsWith("widget:") && Object.hasOwn(WIDGET_SCOPE_LABELS, raw.slice("widget:".length))) continue
		else unknown.push(raw)
	}
	if (storage && !declared.storage) declared.storage = {}
	if (network) declared.network = { hosts }
	if (resources.length) declared.resources = resources
	if (events.length) declared.events = events
	return { declared, unknown }
}

/** Normalize a manifest's declared permissions into a flat, keyed list. */
export function declaredPermissions(
	manifest: PluginManifest | null | undefined
): Permission[] {
	const { declared: p, unknown } = toDeclared(manifest?.permissions)
	const out: Permission[] = []
	if (p.storage) {
		const quotaBytes = normalizeStorageQuota(p.storage.quotaBytes)
		out.push({
			key: "storage",
			kind: "system",
			label: `Private file storage (up to ${Math.round(quotaBytes / 1024)} KB)`,
			accountAffecting: false,
			config: { quotaBytes }
		})
	}
	if (p.network) {
		const hosts = (
			Array.isArray(p.network.hosts) ? p.network.hosts : []
		).filter((h): h is string => typeof h === "string" && h.length > 0)
		if (hosts.length === 0) {
			// A `network` request that names no host reaches nothing; surfaced so an
			// admin still sees (and could deny) the inert declaration.
			out.push({
				key: "network",
				kind: "system",
				label: "Network access (no hosts declared)",
				accountAffecting: false,
				config: { host: null }
			})
		} else {
			// One granular, individually-deniable permission *per host* — an admin
			// can revoke a single host without killing the plugin's whole network
			// grant. A `*` / `*.suffix` wildcard is a host like any other here; the
			// fetch host enforces the match and the internal-IP block at call time.
			for (const host of hosts)
				out.push({
					key: `network:${host}`,
					kind: "system",
					label: `Network access to ${host}`,
					accountAffecting: false,
					config: { host }
				})
		}
	}
	for (const r of Array.isArray(p.resources) ? p.resources : [])
		out.push({
			key: `resource:${r}`,
			kind: "resource",
			label: `Account resource: ${r}`,
			accountAffecting: true
		})
	for (const e of Array.isArray(p.events) ? p.events : [])
		out.push({
			key: `event:${e}`,
			kind: "event",
			label: `Event: ${e}`,
			accountAffecting: true
		})
	out.push(...widgetScopePermissions(declaredWidgetScopes(manifest)))
	// Keys the compiled form declared but this build does not recognise. Shown
	// so an admin sees (and can deny) every declared permission; treated
	// conservatively as a non-account-affecting system permission for display.
	for (const key of unknown)
		out.push({
			key,
			kind: "system",
			label: `Declared permission: ${key}`,
			accountAffecting: false
		})
	// The object form names resources, events and hosts freely too, so the
	// refusal is applied to the keys themselves, whichever shape built them.
	return out.filter((p) => !isRefusedPermissionKey(p.key))
}

/**
 * A declared key this build refuses outright: never listed, never reviewed,
 * never granted, never marked. `#` is the separator `reviewMark` puts between
 * a key and what it was reviewed as (`#scope`, `#{…payload}`), so a key that
 * carries one can spell another permission's mark — a declared
 * `widget:lore#scope` marks as `__reviewed:widget:lore#scope`, the review of
 * the real `lore` scope, and `storage#{"quotaBytes":N}` marks as the review
 * of the real storage request. Deciding such a key (even denying it) would
 * grant the permission it imitates. With `#` out of every key, the key is
 * everything before a mark's first `#`, and two permissions cannot share a
 * mark. Dropping it is not hiding a request: a refused key can never be in
 * force, so there is nothing for a denial to target. (No other key grammar
 * exists here — an unrecognised key is still surfaced; this is the one
 * character the review record cannot tell apart.)
 */
export function isRefusedPermissionKey(key: string): boolean {
	return key.includes("#")
}

/* ── consent: the install-time review gate ───────────────────────────────── */

/**
 * The reserved prefix marking one reviewed key inside `adminDenied`. A manifest
 * *can* declare a key in this namespace (the compiled array form passes any
 * string through, and this file surfaces rather than drops what it does not
 * recognise) — which is why `reviewMark` prefixes unconditionally: a declared
 * `__reviewed:x` is marked `__reviewed:__reviewed:x`, never as a review of `x`.
 * The matching guard is on the write side, in the socket handler: a key in this
 * namespace is not togglable, so a denial cannot be spent forging a review.
 */
const REVIEW_PREFIX = "__reviewed:"

/**
 * The stored marker recording that an admin has decided about one declared
 * permission — its key **and the payload they were shown with it**.
 *
 * The payload matters because the key alone is not the whole request: `storage`
 * asks for a number of bytes, and a plugin that consented at 1 MB and returns
 * asking for 256 MB is asking for something new under an old approval. Folding
 * the config in makes that a fresh request, and does it generically, so the same
 * holds for any permission that grows a declaration later. It is a no-op for the
 * ones whose payload is already in the key (`network:<host>`) or absent
 * (resources, events).
 *
 * A recognised widget scope's mark also says it was reviewed AS that scope
 * (`#scope`). A `widget:<x>` this build did not know was shown as an unknown
 * permission ("Declared permission: widget:<x>", no data behind it), and its
 * review stored the bare mark; a later build that learns `<x>` must ask
 * again under the sentence that names the data, not carry that review over
 * into a grant. (A consequence, once: a scope reviewed before this rule is
 * asked about again.)
 */
export function reviewMark(p: Permission | string): string {
	if (typeof p === "string") return REVIEW_PREFIX + p
	if (isWidgetScopePermission(p)) return `${REVIEW_PREFIX}${p.key}#scope`
	return p.config
		? `${REVIEW_PREFIX}${p.key}#${JSON.stringify(p.config)}`
		: REVIEW_PREFIX + p.key
}

/** True for a stored entry that is a review marker rather than a denial. */
export function isReviewMark(entry: string): boolean {
	return entry.startsWith(REVIEW_PREFIX)
}

/** The markers a full review of `declared` writes — the admin's consent act. */
export function reviewMarks(declared: Permission[]): string[] {
	return declared.map((p) => reviewMark(p))
}

/**
 * Declared permissions no admin has decided about yet. These are refused (see
 * `effectivePermissions`) and are what the admin surface reports as waiting.
 */
export function pendingPermissions(
	declared: Permission[],
	adminDenied: string[] | null | undefined
): Permission[] {
	const marks = new Set(adminDenied ?? [])
	return declared.filter((p) => !marks.has(reviewMark(p)))
}

/**
 * Is this plugin waiting on an admin? True while any declared permission is
 * unreviewed — a fresh install, or an update that asks for something new. A
 * plugin that declares nothing is never waiting: there is nothing to consent to.
 */
export function needsReview(
	manifest: PluginManifest | null | undefined,
	adminDenied: string[] | null | undefined
): boolean {
	const declared = declaredPermissions(manifest)
	return pendingPermissions(declared, adminDenied).length > 0
}

/**
 * The effective set: what the sandbox actually hands out.
 *
 * Two subtractions, not one. An admin **denial** removes a permission they
 * looked at and said no to; the **absence of a review marker** removes one they
 * have not looked at at all. Both are refusals, and the second is the one that
 * makes a declaration a request rather than a grant — a plugin installed and
 * enabled but never reviewed reaches nothing.
 */
export function effectivePermissions(
	declared: Permission[],
	adminDenied: string[] | null | undefined
): Permission[] {
	const entries = new Set(adminDenied ?? [])
	return declared.filter(
		(p) => !entries.has(p.key) && entries.has(reviewMark(p))
	)
}

/**
 * Storage quota (bytes) the sandbox will enforce, or undefined to deny storage.
 * Storage must be granted (an admin can deny the `storage` key outright); when it
 * is, a valid admin override supersedes the manifest-derived quota, otherwise the
 * manifest value (author-band-clamped) stands.
 */
export function storageGrant(
	effective: Permission[],
	adminOverrideBytes?: number | null
): number | undefined {
	const s = effective.find((p) => p.key === "storage")
	if (!s) return undefined
	if (adminOverrideBytes != null) {
		const o = normalizeAdminStorageQuota(adminOverrideBytes)
		if (o !== undefined) return o
	}
	return s.config?.quotaBytes as number
}

/**
 * Allowed fetch hosts from the effective set, or undefined to deny network.
 * Each surviving `network:<host>` permission contributes one host; a plain
 * `network` (no host) request yields an empty allowlist (network requested but
 * nothing reachable). Denying a single `network:<host>` key drops just that host.
 */
export function networkGrant(effective: Permission[]): string[] | undefined {
	const requested = effective.some(
		(p) => p.key === "network" || p.key.startsWith("network:")
	)
	if (!requested) return undefined
	const hosts: string[] = []
	for (const p of effective)
		if (p.key.startsWith("network:")) {
			const h = p.config?.host
			if (typeof h === "string" && h.length > 0) hosts.push(h)
		}
	return hosts
}

/** One row of the admin permissions view: a declared permission + its state. */
export interface PermissionState {
	key: string
	kind: PermissionKind
	label: string
	accountAffecting: boolean
	/** In force right now — reviewed *and* not denied. */
	granted: boolean
	/** Declared, but no admin has decided about it yet. Refused meanwhile. */
	pending: boolean
}

/** The full permission picture for one plugin, for the admin UI. */
export function permissionStates(
	manifest: PluginManifest | null | undefined,
	adminDenied: string[] | null | undefined
): PermissionState[] {
	const entries = new Set(adminDenied ?? [])
	return declaredPermissions(manifest).map((p) => ({
		key: p.key,
		kind: p.kind,
		label: p.label,
		accountAffecting: p.accountAffecting,
		granted: !entries.has(p.key) && entries.has(reviewMark(p)),
		pending: !entries.has(reviewMark(p))
	}))
}
