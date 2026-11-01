/**
 * How a manifest's permission declaration reads — pure, so it runs in the
 * browser as well as the server. Shared so Admin › Plugins can show a package's
 * permissions before it is uploaded; the consent and grant half stays in
 * `$lib/server/plugins/permissions.ts`.
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
	/**
	 * 🚧 `serve` (M0, SHAPES L12 Seams): globs over the plugin's own
	 * storage its OWN frames may read at `/plugin-data/<id>/<path>`. Compiled
	 * as one `storage-serve:<glob>` key per glob.
	 */
	storage?: {
		quotaBytes?: number
		serve?: string[]
		/** 🚧 Per-user plugin storage (M2b): compiled as `storage-per-user[:<bytes>]`, the applet group. */
		perUser?: { quotaBytes?: number }
	}
	network?: { hosts?: string[] }
	/** 🚧 `autoplay` (M0, SHAPES L8): compiled as `media:autoplay`. */
	media?: { autoplay?: boolean }
	resources?: string[]
	events?: string[]
	/** 🚧 The session group (M2b): grants for its frames, compiled to the same `widget:<grant>` keys. */
	session?: { scopes?: string[] }
	/** 🚧 The applet group (M2b): compiled to `applet:…` keys. */
	applet?: {
		characters?: "read" | "write"
		lorebooks?: "read" | "write"
		sessions?: { genres?: string[] }
		annex?: { user?: boolean }
	}
}

/**
 * 🚧 The **permission group** a permission is shown and granted under (M2b):
 * `session` — what the package's code may do in the session it is mounted in or
 * running for (its widgets' grants, the session events it hears); `applet` —
 * what its applet may do with the person's library and the pub outside any one
 * session (the `applet:` keys, per-user storage); `system` — the sandbox's own
 * reach (its pub-wide files, network hosts, media). Read off the key alone, so
 * the server, the admin page and the packager can never sort one differently.
 * ⚠ Not a front-end API (`ui` · `session` · `applet`), which is what a mount
 * holds; a group is what an admin grants.
 */
export type PermissionGroup = "system" | "session" | "applet"

/** 🚧 The group a permission key belongs to (M2b). */
export function permissionGroup(key: string): PermissionGroup {
	if (key.startsWith("widget:") || key.startsWith("event:")) return "session"
	if (key.startsWith("applet:") || key === PER_USER_STORAGE_KEY) return "applet"
	return "system"
}

/** 🚧 The key per-user plugin storage is reviewed and granted as (M2b). */
export const PER_USER_STORAGE_KEY = "storage-per-user"

const APPLET_LEVELS = ["read", "write"] as const

/**
 * 🚧 A served-storage glob this build accepts (M0): relative,
 * slash-separated, no `.`/`..` segment, no backslash, no `#` (the review
 * separator). Anything else is surfaced as an unknown key and never served.
 */
export function isServableGlob(glob: unknown): glob is string {
	if (typeof glob !== "string" || !glob || glob.length > 200) return false
	if (
		glob.startsWith("/") ||
		glob.includes("\\") ||
		glob.includes("#") ||
		glob.includes("\0")
	)
		return false
	return !glob
		.split("/")
		.some((seg) => seg === "" || seg === "." || seg === "..")
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
export const WIDGET_SCOPE_LABELS: Readonly<Record<WidgetSectionScope, string>> =
	{
		"session:full":
			"Its widgets see the whole conversation as you do — the cast, your personas, your unsent draft and the session's state",
		"session:state": "Its widgets see the session's stats and states",
		persona: "Its widgets see your persona",
		characters: "Its widgets see the session's characters",
		lore: "Its widgets see the session's lore"
	}

/**
 * 🚧 The **write grants** a plugin's widget may ask for (D4, ruled Q2) —
 * each its own permission, `widget:<scope>:write`, reviewed and deniable
 * apart from the read it sits beside: an admin who granted
 * `widget:session:state` is asked again before a widget may CHANGE the
 * session's state. Keyed by the bare grant, as the widget's `scopes` and the
 * page's `from.grants` carry it (`session:state:write`). Holding one never
 * grants the read. A channel's write (`channel:<slug>:write`, for `send` and
 * `draft`) names the plugin's own slug, so it is labelled by
 * {@link widgetGrantLabel} rather than listed here. Every write is
 * account-affecting: it goes in as the viewer.
 */
export const WIDGET_WRITE_LABELS: Readonly<
	Partial<Record<`${WidgetSectionScope}:write`, string>>
> = {
	"session:state:write":
		"Its widgets may change the session's stats and states as you, when you press in them"
}

/** A channel's write grant: `channel:<slug>:write`, the slug one lane-free channel slug. */
const CHANNEL_WRITE_GRANT = /^channel:([A-Za-z0-9][A-Za-z0-9_-]{0,63}):write$/

/**
 * The sentence a widget grant is reviewed under — a read scope
 * ({@link WIDGET_SCOPE_LABELS}), a write grant ({@link WIDGET_WRITE_LABELS},
 * or a channel's `channel:<slug>:write`) — or null when this build supplies
 * nothing for it. The ONE recogniser every derivation below goes through, so
 * a grant is known everywhere or nowhere.
 */
export function widgetGrantLabel(grant: unknown): string | null {
	if (typeof grant !== "string") return null
	if (Object.hasOwn(WIDGET_SCOPE_LABELS, grant))
		return WIDGET_SCOPE_LABELS[grant as WidgetSectionScope]
	if (Object.hasOwn(WIDGET_WRITE_LABELS, grant))
		return (
			WIDGET_WRITE_LABELS[grant as keyof typeof WIDGET_WRITE_LABELS] ??
			null
		)
	const channel = CHANNEL_WRITE_GRANT.exec(grant)?.[1]
	return channel
		? `Its widgets may send and draft lines as you on the '${channel}' channel, when you press in them`
		: null
}

/**
 * The scopes a manifest's widgets declare, read off the declarations
 * themselves — a genre's panels (`genres[].shape.panels[].scopes`) and the
 * package's own widgets (R71, `widgets[].scopes`) alike — never trusted to a
 * compiled list, so a package cannot ask for data through a widget and leave
 * the request off its permissions.
 */
export function declaredWidgetScopes(
	manifest: PluginManifest | null | undefined
): string[] {
	const out = new Set<string>()
	const take = (decl: unknown) => {
		const scopes = (decl as { scopes?: unknown } | null)?.scopes
		for (const scope of Array.isArray(scopes) ? scopes : [])
			if (typeof scope === "string" && widgetGrantLabel(scope) !== null)
				out.add(scope)
	}
	const genres = Array.isArray(manifest?.genres)
		? (manifest!.genres as unknown[])
		: []
	for (const g of genres) {
		const panels = (g as { shape?: { panels?: unknown } } | null)?.shape
			?.panels
		for (const panel of Array.isArray(panels) ? panels : []) take(panel)
	}
	for (const widget of Array.isArray(manifest?.widgets)
		? (manifest!.widgets as unknown[])
		: [])
		take(widget)
	// 🚧 M2b: the session group's own grants (for frames no widget declares), in
	// either manifest shape.
	const perms = manifest?.permissions
	if (Array.isArray(perms)) {
		for (const raw of perms)
			if (typeof raw === "string" && raw.startsWith("widget:") && !isRefusedPermissionKey(raw))
				take({ scopes: [raw.slice("widget:".length)] })
	} else take((perms as DeclaredPermissions | undefined)?.session)
	return [...out].sort()
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
	const known = new Map<string, string>()
	for (const s of scopes) {
		const label = widgetGrantLabel(s)
		if (label !== null) known.set(s as string, label)
	}
	return [...known.keys()].sort().map((scope) => ({
		key: `widget:${scope}`,
		kind: "resource" as const,
		label: known.get(scope)!,
		accountAffecting: true
	}))
}

const DEFAULT_STORAGE_QUOTA = 64 * 1024 * 1024
/**
 * The band the sandbox clamps any declared storage quota into (1 KB … 256 MB),
 * mirroring the author-side compiler's range but enforced *here* rather than
 * trusted from the manifest.
 */
export const MIN_STORAGE_QUOTA = 1024
export const MAX_STORAGE_QUOTA = 256 * 1024 * 1024

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
	// 🚧 M0: served-storage globs and the autoplay grant.
	const serve: string[] = []
	// 🚧 M2b: the session group's own grants and the applet group.
	const sessionScopes: string[] = []
	const applet: NonNullable<DeclaredPermissions["applet"]> = {}
	const appletGenres: string[] = []
	let perUser: { quotaBytes?: number } | undefined
	let autoplay = false
	let storage = false
	let network = false
	for (const raw of permissions) {
		if (typeof raw !== "string" || !raw) continue
		// Refused before it is read at all (`isRefusedPermissionKey`) — not
		// surfaced as unknown, not folded into a known permission.
		if (isRefusedPermissionKey(raw)) continue
		if (raw.startsWith("storage-serve:")) {
			const glob = raw.slice("storage-serve:".length)
			if (isServableGlob(glob)) serve.push(glob)
			else unknown.push(raw)
		} else if (raw === PER_USER_STORAGE_KEY) perUser = perUser ?? {}
		else if (raw.startsWith(`${PER_USER_STORAGE_KEY}:`))
			perUser = { quotaBytes: Number(raw.slice(PER_USER_STORAGE_KEY.length + 1)) }
		else if (raw.startsWith("applet:")) {
			const [, what, rest] = /^applet:([a-z]+):(.+)$/.exec(raw) ?? []
			if ((what === "characters" || what === "lorebooks") && (APPLET_LEVELS as readonly string[]).includes(rest!)) {
				// Write holds read: the higher of two compiled levels wins.
				if (applet[what] !== "write") applet[what] = rest as "read" | "write"
			} else if (what === "sessions" && rest) appletGenres.push(rest)
			else if (what === "annex" && rest === "user") applet.annex = { user: true }
			else unknown.push(raw)
		} else if (raw === "media:autoplay") autoplay = true
		else if (raw === "storage") storage = true
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
		// 🚧 M2b: the same key may also carry a grant declared for the package's
		// frames (`permissions.session.scopes`), which no widget names — kept, so a
		// compiled list can ask for more than its widgets do, never less.
		else if (
			raw.startsWith("widget:") &&
			widgetGrantLabel(raw.slice("widget:".length)) !== null
		)
			sessionScopes.push(raw.slice("widget:".length))
		else unknown.push(raw)
	}
	if (sessionScopes.length) declared.session = { scopes: sessionScopes }
	if (appletGenres.length) applet.sessions = { genres: appletGenres }
	if (Object.keys(applet).length) declared.applet = applet
	if (storage && !declared.storage) declared.storage = {}
	if (perUser) declared.storage = { ...(declared.storage ?? {}), perUser }
	// A served glob rides the storage declaration it reads from; without one
	// it is surfaced (an admin sees it) and never served.
	if (serve.length) {
		if (declared.storage) declared.storage.serve = serve
		else unknown.push(...serve.map((g) => `storage-serve:${g}`))
	}
	if (autoplay) declared.media = { autoplay: true }
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
	// `storage: { perUser }` alone asks for per-user files only, not the pub-wide folder (M2b).
	const storageKeys = p.storage ? Object.keys(p.storage).filter((k) => (p.storage as Record<string, unknown>)[k] !== undefined) : []
	if (p.storage && (storageKeys.length === 0 || storageKeys.some((k) => k !== "perUser"))) {
		const quotaBytes = normalizeStorageQuota(p.storage.quotaBytes)
		out.push({
			key: "storage",
			kind: "system",
			label: `Private file storage (up to ${quotaBytes >= 1024 * 1024 ? `${Math.round(quotaBytes / (1024 * 1024))} MB` : `${Math.round(quotaBytes / 1024)} KB`})`,
			accountAffecting: false,
			config: { quotaBytes }
		})
		// 🚧 M0 (SHAPES L12 Seams): one deniable permission per served
		// glob, like one per network host. The object form is held to the
		// same grammar as the compiled one.
		const serve = Array.isArray(p.storage.serve) ? p.storage.serve : []
		for (const glob of serve)
			if (isServableGlob(glob))
				out.push({
					key: `storage-serve:${glob}`,
					kind: "system",
					label: `Show its own frames the stored files matching ${glob}`,
					accountAffecting: false,
					config: { glob }
				})
	}
	// 🚧 M0 (SHAPES L8): its frames may start sound without a press of their own.
	if (p.media?.autoplay === true)
		out.push({
			key: "media:autoplay",
			kind: "system",
			label: "Play sound in its frames once you have clicked anywhere on the page",
			accountAffecting: false
		})
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
			label: `Hears ${e} in every session on this pub`,
			accountAffecting: true
		})
	// 🚧 M2b: per-user plugin storage — its own key, its own quota, the applet group.
	const perUser = p.storage?.perUser
	if (perUser && typeof perUser === "object") {
		const quotaBytes = normalizeStorageQuota(perUser.quotaBytes)
		out.push({
			key: PER_USER_STORAGE_KEY,
			kind: "system",
			label: `Private files for each person (up to ${quotaBytes >= 1024 * 1024 ? `${Math.round(quotaBytes / (1024 * 1024))} MB` : `${Math.round(quotaBytes / 1024)} KB`} each)`,
			accountAffecting: true,
			config: { quotaBytes }
		})
	}
	// 🚧 M2b: the applet group, one deniable key per grant (one per genre).
	const a = p.applet && typeof p.applet === "object" ? p.applet : undefined
	const library = { characters: "characters", lorebooks: "lorebooks" } as const
	for (const what of ["characters", "lorebooks"] as const) {
		const level = a?.[what]
		if (level !== "read" && level !== "write") continue
		out.push({
			key: `applet:${what}:${level}`,
			kind: "resource",
			label:
				level === "write"
					? `Its applet reads, creates and changes your ${library[what]}, as you`
					: `Its applet reads your ${library[what]}`,
			accountAffecting: true
		})
	}
	for (const genre of Array.isArray(a?.sessions?.genres) ? a!.sessions!.genres! : [])
		if (typeof genre === "string" && genre)
			out.push({
				key: `applet:sessions:${genre}`,
				kind: "resource",
				label: `Its applet lists, opens, starts and changes your sessions of ${genre}`,
				accountAffecting: true,
				config: { genre }
			})
	if (a?.annex?.user === true)
		out.push({
			key: "applet:annex:user",
			kind: "resource",
			label: "It keeps a small document for each person who uses it",
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
