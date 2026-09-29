/**
 * **Local discovery** — which model servers are already running on THIS
 * machine, and what chat models each one can answer with.
 *
 * The setup wizard's Choose an LLM step asks this once on arrival, so a person
 * who already runs Ollama, LM Studio, llama.cpp or KoboldCPP sees it as a card
 * and picks a model in one press, instead of being sent to a form that asks
 * for an address they never had to know.
 *
 * ## Two steps per service, and why
 *
 * 1. **Fingerprint** — one small HTTP request to the service's well-known
 *    port, answered in a shape only that service gives (`/api/version` for
 *    Ollama, `{"result":"KoboldCpp"}`, llama-server's `/props`). A short,
 *    hard timeout: a closed port answers at once, and a port held by
 *    something else must not stall the wizard. Port 8080 in particular is
 *    everybody's, so a bare 200 there is not llama.cpp.
 * 2. **List** — only for a service that answered, through that type's OWN
 *    adapter `listModels`, the one `modelSync` uses. The identifiers offered
 *    here are therefore exactly the ones a sync of the connection writes, so
 *    the model a person picks is the row the default is registered against.
 *    (LM Studio lists over its SDK's websocket, which retries a closed port
 *    rather than failing — the fingerprint is what keeps it from being asked
 *    at all when nothing is there.)
 *
 * Only this machine's fixed addresses are probed; nothing here takes an
 * address from the caller, so the handler is not a request-forgery surface.
 */

import { CONNECTION_TYPE } from "$lib/shared/constants/ConnectionTypes"
import { CONNECTION_DEFAULTS } from "$lib/shared/utils/connectionDefaults"
import { normalizeProbedModels } from "$lib/shared/connections/probedModels"
import { adapterIO } from "./modelSync"

/** A fingerprint must answer within this, or the service counts as absent. */
export const FINGERPRINT_TIMEOUT_MS = 1500
/** A listing from a service that DID answer may take a little longer. */
export const LISTING_TIMEOUT_MS = 8000

export interface LocalCandidate {
	/** The connection type a connection to this service is created as. */
	type: string
	/** The service's name, as a card shows it. */
	label: string
	/** What the connection's `baseUrl` is saved as. */
	baseUrl: string
	/** Where the fingerprint is asked. */
	probeUrl: string
	/** Whether the fingerprint's JSON is this service's. */
	matches: (body: any) => boolean
}

/**
 * The services Serene Pub has a native connection type for, at the address
 * each installs to by default. The `baseUrl` is the type's own default
 * (`CONNECTION_DEFAULTS`), so a connection created from a card is the one the
 * Add form would have prefilled.
 */
export const LOCAL_CANDIDATES: readonly LocalCandidate[] = [
	{
		type: CONNECTION_TYPE.OLLAMA,
		label: "Ollama",
		baseUrl: "http://localhost:11434",
		probeUrl: "http://localhost:11434/api/version",
		matches: (b) => typeof b?.version === "string"
	},
	{
		type: CONNECTION_TYPE.LM_STUDIO,
		label: "LM Studio",
		baseUrl: "ws://localhost:1234",
		probeUrl: "http://localhost:1234/v1/models",
		matches: (b) => Array.isArray(b?.data)
	},
	{
		type: CONNECTION_TYPE.LLAMACPP,
		label: "llama.cpp",
		baseUrl: "http://localhost:8080/",
		probeUrl: "http://localhost:8080/props",
		matches: (b) =>
			!!b &&
			typeof b === "object" &&
			("default_generation_settings" in b || "total_slots" in b)
	},
	{
		type: CONNECTION_TYPE.KOBOLDCPP,
		label: "KoboldCPP",
		baseUrl: "http://localhost:5001",
		probeUrl: "http://localhost:5001/api/extra/version",
		matches: (b) => b?.result === "KoboldCpp"
	}
]

export interface DiscoveredModel {
	model: string
	name: string
}

export interface DiscoveredProvider {
	type: string
	label: string
	baseUrl: string
	/** Chat models the service lists; empty when it has none loaded. */
	models: DiscoveredModel[]
	/** The listing failed although the service answered. */
	error: string | null
}

type FetchLike = (url: string, init?: RequestInit) => Promise<Response>
type ListModels = (
	type: string,
	connection: Record<string, unknown>
) => Promise<{ models: unknown[]; error?: string | null }>

/** Ask one fingerprint; true only for this service's own answer. */
async function fingerprint(
	candidate: LocalCandidate,
	fetchImpl: FetchLike
): Promise<boolean> {
	try {
		const res = await fetchImpl(candidate.probeUrl, {
			signal: AbortSignal.timeout(FINGERPRINT_TIMEOUT_MS),
			// A fixed local address that redirects elsewhere is not the
			// service this card would name.
			redirect: "manual"
		})
		if (!res.ok) return false
		return candidate.matches(await res.json())
	} catch {
		return false
	}
}

/**
 * The models worth offering for chat: text generation, or a listing that says
 * nothing about modality (llama.cpp, LM Studio's LLM entries). Embedding and
 * image models are left out — registering one for chat is refused.
 */
export function chatModelsOf(listed: unknown): DiscoveredModel[] {
	// LM Studio's SDK marks embedding entries by `type`, which the shared
	// normaliser does not read (it reads only an explicit `modality`).
	const entries = Array.isArray(listed)
		? listed.filter(
				(e) =>
					!(
						e &&
						typeof e === "object" &&
						(e as any).type === "embedding"
					)
			)
		: []
	return normalizeProbedModels(entries)
		.filter((m) => m.modality == null || m.modality === "text-gen")
		.map((m) => ({ model: m.model, name: m.name || m.model }))
}

async function defaultListModels(
	type: string,
	connection: Record<string, unknown>
) {
	const { listModels } = await adapterIO(type)
	return listModels(connection as any)
}

async function listWithin(
	candidate: LocalCandidate,
	listModels: ListModels
): Promise<{ models: unknown[]; error: string | null }> {
	let timer: ReturnType<typeof setTimeout> | undefined
	const timeout = new Promise<{ models: unknown[]; error: string }>(
		(resolve) => {
			timer = setTimeout(
				() =>
					resolve({
						models: [],
						error: `${candidate.label} did not list its models in time.`
					}),
				LISTING_TIMEOUT_MS
			)
		}
	)
	try {
		const connection = {
			...(CONNECTION_DEFAULTS as Record<string, object>)[candidate.type],
			type: candidate.type,
			baseUrl: candidate.baseUrl
		}
		const listing = await Promise.race([
			listModels(candidate.type, connection),
			timeout
		])
		return {
			models: Array.isArray(listing?.models) ? listing.models : [],
			error: listing?.error ?? null
		}
	} catch (e: any) {
		return { models: [], error: e?.message ?? String(e) }
	} finally {
		if (timer) clearTimeout(timer)
	}
}

/**
 * Every candidate, probed concurrently; the answer names only the services
 * that are running, in `LOCAL_CANDIDATES` order.
 */
export async function discoverLocalProviders(
	opts: {
		fetchImpl?: FetchLike
		listModels?: ListModels
		candidates?: readonly LocalCandidate[]
	} = {}
): Promise<DiscoveredProvider[]> {
	const fetchImpl = opts.fetchImpl ?? (fetch as FetchLike)
	const listModels = opts.listModels ?? defaultListModels
	const candidates = opts.candidates ?? LOCAL_CANDIDATES
	const found = await Promise.all(
		candidates.map(async (candidate) => {
			if (!(await fingerprint(candidate, fetchImpl))) return null
			const listing = await listWithin(candidate, listModels)
			const provider: DiscoveredProvider = {
				type: candidate.type,
				label: candidate.label,
				baseUrl: candidate.baseUrl,
				models: listing.error ? [] : chatModelsOf(listing.models),
				error: listing.error
			}
			return provider
		})
	)
	return found.filter((p): p is DiscoveredProvider => p !== null)
}
