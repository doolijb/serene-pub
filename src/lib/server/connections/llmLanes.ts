import {
	CONNECTION_DEFAULTS,
	OPENAI_COMPATIBLE_PRESETS
} from "$lib/shared/utils/connectionDefaults"
import { CONNECTION_TYPE } from "$lib/shared/constants/ConnectionTypes"

/** The width of a known cloud host's LLM lane: calls in flight at once. A constant, never a setting. */
export const CLOUD_LLM_LANE_WIDTH = 4

/** The bounds of an LLM lane width, an admin override included. */
export const MIN_LLM_LANE_WIDTH = 1
export const MAX_LLM_LANE_WIDTH = 16

/** The host an LLM lane is keyed by. */
export interface LlmLaneHost {
	/** The LLM lane key: the URL origin (`new URL(base).origin`, e.g. `http://localhost:5001`,
	 *  `https://openrouter.ai`) of the resolved base URL. A base URL that is empty or does not parse
	 *  falls back to `connection:<id>` (or `connection:<name>` when there is no id) — that
	 *  connection's own LLM lane, width 1. */
	laneKey: string
	/** A managed connection type (Serene Pub runs the process): `isManagedKoboldCpp || isManagedAudioCpp`. */
	managed: boolean
	/** The origin's hostname is a known cloud host. Never true when `managed`. */
	cloud: boolean
}

interface LlmLaneConnection {
	id?: number | null
	name?: string | null
	type?: string | null
	baseUrl?: string | null
}

function hostnameOf(url: string | undefined | null): string | null {
	if (!url) return null
	try {
		return new URL(url).hostname.toLowerCase()
	} catch {
		return null
	}
}

/**
 * Known cloud hosts, derived once from the connection catalogue (never a second
 * list): the cloud presets of the OpenAI-compatible family, plus every connection
 * default whose address is `https:`. Only public hostnames land here, so localhost,
 * loopback, private-range, `.local` and single-label hosts are never cloud.
 */
const KNOWN_CLOUD_HOSTNAMES: ReadonlySet<string> = (() => {
	const out = new Set<string>()
	for (const preset of OPENAI_COMPATIBLE_PRESETS) {
		if (preset.category !== "cloud") continue
		const h = hostnameOf(preset.connectionDefaults?.baseUrl)
		if (h) out.add(h)
	}
	for (const def of Object.values(CONNECTION_DEFAULTS)) {
		const base = (def as { baseUrl?: string }).baseUrl
		if (!base?.startsWith("https:")) continue
		const h = hostnameOf(base)
		if (h) out.add(h)
	}
	return out
})()

/** PURE. Same input, same answer. `baseUrl` here is the already-resolved address. */
export function llmLaneHostOf(connection: LlmLaneConnection): LlmLaneHost {
	const managed =
		CONNECTION_TYPE.isManagedKoboldCpp(connection.type) ||
		CONNECTION_TYPE.isManagedAudioCpp(connection.type)
	let origin: string | null = null
	if (connection.baseUrl) {
		try {
			const o = new URL(connection.baseUrl).origin
			// Non-hierarchical schemes parse to the opaque origin "null".
			if (o && o !== "null") origin = o
		} catch {
			origin = null
		}
	}
	const laneKey =
		origin ??
		`connection:${connection.id != null ? connection.id : (connection.name ?? "")}`
	const hostname = origin ? hostnameOf(origin) : null
	const cloud =
		!managed && hostname !== null && KNOWN_CLOUD_HOSTNAMES.has(hostname)
	return { laneKey, managed, cloud }
}

/** Async: resolves a managed KoboldCPP connection's real address first (its row's baseUrl is display only):
 *  `koboldCppSettings.koboldCppManagerBaseUrl ?? connection.baseUrl` — the same rule as dispatchImage.ts.
 *  Every other type (managed audio.cpp included — its row is kept in sync at boot by foldAudioCppManagedBaseUrl)
 *  uses the row's baseUrl. Then `llmLaneHostOf`. The db loads lazily, so importing this module opens no database.
 *  A settings read that throws falls back to the row's baseUrl. */
export async function resolveLlmLaneHost(
	connection: LlmLaneConnection
): Promise<LlmLaneHost> {
	let baseUrl = connection.baseUrl
	if (CONNECTION_TYPE.isManagedKoboldCpp(connection.type)) {
		try {
			const { db } = await import("$lib/server/db")
			const settings = await db.query.koboldCppSettings.findFirst()
			baseUrl = settings?.koboldCppManagerBaseUrl ?? connection.baseUrl
		} catch {
			baseUrl = connection.baseUrl
		}
	}
	return llmLaneHostOf({ ...connection, baseUrl })
}

/** The derived default width: managed → 1, cloud → CLOUD_LLM_LANE_WIDTH, everything else → 1.
 *  ⚠ The managed branch is THE HOOK for the Servers direction: a managed server's own width field
 *  (not built) would be read here. Width 1 for a managed host is the only guard against two
 *  generations on one GPU — never loosen this default. An admin's override (`llm_lane_widths`,
 *  per the 2026-11-13 ruling) still wins over it in `llmLaneWidthOf` (★I-1 asks the owner
 *  whether a managed host should accept one). */
export function defaultLlmLaneWidth(host: LlmLaneHost | undefined): number {
	if (!host) return 1
	if (host.managed) return 1
	if (host.cloud) return CLOUD_LLM_LANE_WIDTH
	return 1
}

let widthOverrides: ReadonlyMap<string, number> = new Map()

/** The width the queue uses: an override for this laneKey if one is set, else the default; clamped 1–16.
 *  Overrides come from `setLlmLaneWidthOverrides`. */
export function llmLaneWidthOf(
	host: LlmLaneHost | undefined,
	laneKey: string
): number {
	const raw = widthOverrides.get(laneKey) ?? defaultLlmLaneWidth(host)
	const n = Number.isFinite(raw) ? Math.floor(raw) : 1
	return Math.min(MAX_LLM_LANE_WIDTH, Math.max(MIN_LLM_LANE_WIDTH, n))
}

export function setLlmLaneWidthOverrides(
	overrides: ReadonlyMap<string, number>
): void {
	widthOverrides = new Map(overrides)
}
