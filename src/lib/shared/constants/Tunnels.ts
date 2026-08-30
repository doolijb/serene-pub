/**
 * Tunnel provider / mode / status vocabulary (26 §3, §7).
 *
 * `provider` and `status` are open text columns in the DB rather than hard
 * Postgres enums, on purpose: adding a provider later should be a data change,
 * not a migration. These constants are the app-side vocabulary over those
 * columns, not a database constraint.
 */
export class TunnelProviders {
	/** Zero-account anonymous `trycloudflare.com` URL. Built now. */
	static readonly CLOUDFLARE_QUICK = "cloudflare_quick"
	/** Free CF account + domain + connector token, stable hostname. Built now. */
	static readonly CLOUDFLARE_NAMED = "cloudflare_named"
	/** Deferred (26 §7). */
	static readonly TAILSCALE_FUNNEL = "tailscale_funnel"
	/** Deferred — admin already runs their own relay; SP manages no process. */
	static readonly CUSTOM = "custom"

	/** Only what the v1 supervisor actually implements. */
	static readonly ALL = [
		TunnelProviders.CLOUDFLARE_QUICK,
		TunnelProviders.CLOUDFLARE_NAMED
	] as const

	static readonly LABELS: Record<string, string> = {
		[TunnelProviders.CLOUDFLARE_QUICK]: "Cloudflare Quick Tunnel",
		[TunnelProviders.CLOUDFLARE_NAMED]: "Cloudflare Named Tunnel",
		[TunnelProviders.TAILSCALE_FUNNEL]: "Tailscale Funnel",
		[TunnelProviders.CUSTOM]: "Custom (self-managed)"
	}

	static getLabel(provider: string): string {
		return TunnelProviders.LABELS[provider] || provider
	}

	/** Does SP spawn and supervise a process for this provider? */
	static isManaged(provider: string): boolean {
		return provider !== TunnelProviders.CUSTOM
	}
}

/**
 * Kept separate from `provider` even though it is redundant while only
 * Cloudflare is implemented (26 §7): the moment a second provider lands, most
 * UI and supervisor logic branches on `mode`, not `provider`, and that split
 * shouldn't need a schema change to introduce.
 */
export class TunnelModes {
	/** URL is issued per-run and changes on every start. */
	static readonly EPHEMERAL = "ephemeral"
	/** Hostname is stable across runs. */
	static readonly PERSISTENT = "persistent"

	static readonly ALL = [
		TunnelModes.EPHEMERAL,
		TunnelModes.PERSISTENT
	] as const
}

/** Supervisor-written, never admin-editable (26 §3). */
export class TunnelStatuses {
	static readonly STOPPED = "stopped"
	static readonly STARTING = "starting"
	static readonly RUNNING = "running"
	static readonly ERROR = "error"

	static readonly ALL = [
		TunnelStatuses.STOPPED,
		TunnelStatuses.STARTING,
		TunnelStatuses.RUNNING,
		TunnelStatuses.ERROR
	] as const
}

export type TunnelProvider =
	| "cloudflare_quick"
	| "cloudflare_named"
	| "tailscale_funnel"
	| "custom"
export type TunnelMode = "ephemeral" | "persistent"
export type TunnelStatus = "stopped" | "starting" | "running" | "error"

/** The seeded `servers` row representing this instance (26 §2). */
export const LOCAL_SERVER_SLUG = "local"

/** Pre-filled when a TTL is first turned on (26 §4) — 12 hours. A default, not
 *  a fixed value: the admin can set any duration within the bounds below. */
export const DEFAULT_TUNNEL_TTL_SECONDS = 43200

/**
 * Fifteen minutes. Short enough for a deliberately brief share, comfortably
 * longer than the 60s the supervisor allows a launch — so a mistyped value
 * cannot expire a tunnel before it has finished starting — and a clean quarter
 * hour, which matters because the UI edits this in hours and a floor of 300s
 * renders as `min="0.08333333333333333"`.
 */
export const MIN_TUNNEL_TTL_SECONDS = 900

/**
 * Thirty days. Not a security boundary — an admin who wants a permanently
 * reachable instance should turn the TTL off rather than set a huge one, and
 * this bound exists so a slip of the keyboard cannot silently mean "never" while
 * the UI still claims a timer is running.
 */
export const MAX_TUNNEL_TTL_SECONDS = 2_592_000

/** Whole hours the UI offers as one-click choices; any value in range is valid. */
export const TUNNEL_TTL_PRESET_HOURS = [1, 4, 8, 12, 24, 72] as const
