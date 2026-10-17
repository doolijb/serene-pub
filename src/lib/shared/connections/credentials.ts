/**
 * Whether a connection NEEDS a key, and where a person gets one.
 *
 * ## Why this is a module and not a boolean on the form
 *
 * Until 2026-09-23 the index could not tell "you have not finished setting this
 * up" from "this is broken", because nothing on the wire said whether a key was
 * even wanted. So a brand-new OpenRouter row — created ten seconds ago, no key
 * typed yet — listed as `Couldn't list models · Missing credentia…` with a red
 * dot and a **Fix** button, next to another one just like it. A fresh install
 * looked half-broken, and the two rows that looked broken were the two the
 * person had not got to yet.
 *
 * Those are different sentences and they deserve different colours. A row that
 * is *unfinished* is gold and says what is missing; only a row that was
 * finished and still failed is red. Drawing that line needs one fact the client
 * never had: does this type want a key, and is there one.
 *
 * ⚠ **The key itself never crosses.** `buildConnectionsList` projects a
 * BOOLEAN. The encrypted value lives in `connections.extra_json` and is walked
 * only by `utils/tokenCrypto.ts`; nothing here reads or returns it.
 *
 * ⚠ Client-safe, and shared on purpose: the server decides `present` because
 * only it can see the column, the client decides `required` because it has the
 * same preset table, and both have to agree or the index and the connection
 * view would disagree about whether a row is finished.
 */
import { CONNECTION_TYPE } from "../constants/ConnectionTypes"

/** What a type or preset expects in the way of a credential. */
export type CredentialPolicy =
	/** It will not answer without one. A missing key is *unfinished*. */
	| "required"
	/** It may take one — a local server behind a password. Absence is fine. */
	| "optional"
	/** There is nothing to hold. Local runtimes and the ONNX lanes. */
	| "none"

/**
 * Where a service hands out keys.
 *
 * ⚠ Only ever rendered as a link a person clicks, never fetched. The one job it
 * has is to save somebody the search that stands between them and a working
 * install, which is the most common place a first setup dies.
 *
 * Keyed by preset slug (`OPENAI_COMPATIBLE_PRESETS`), the same key the New
 * connection picker and the connection view read.
 */
export const KEY_URLS: Readonly<Record<string, string>> = {
	openrouter: "https://openrouter.ai/keys",
	"openai-official": "https://platform.openai.com/api-keys",
	groq: "https://console.groq.com/keys",
	"together-ai": "https://api.together.ai/settings/api-keys",
	"mistral-ai": "https://console.mistral.ai/api-keys",
	deepseek: "https://platform.deepseek.com/api_keys",
	"google-gemini": "https://aistudio.google.com/app/apikey",
	anthropic: "https://console.anthropic.com/settings/keys",
	"perplexity-ai": "https://console.perplexity.ai/",
	"fireworks-ai": "https://app.fireworks.ai/settings/users/api-keys",
	deepinfra: "https://deepinfra.com/dash/api_keys",
	"xai-grok": "https://console.x.ai/",
	"novita-ai": "https://novita.ai/settings/key-management",
	"featherless-ai": "https://featherless.ai/account/api-keys",
	"demon-route": "https://demonroute.com/login",
	cohere: "https://dashboard.cohere.com/api-keys",
	// Anyscale ended its shared endpoints in August 2024: its main site, not a
	// key page that may be gone.
	anyscale: "https://www.anyscale.com/",
	// The hosted image types, keyed by type id (`keyUrlFor` reads them so).
	horde: "https://aihorde.net/register",
	// Account Settings → Get Persistent API Token, inside the app.
	novelai: "https://novelai.net/",
	bfl: "https://dashboard.bfl.ai/"
}

/** Types that are a key away from working, whatever preset they carry. */
const KEYED_TYPES: ReadonlySet<string> = new Set([
	CONNECTION_TYPE.ANTHROPIC,
	CONNECTION_TYPE.NOVELAI,
	CONNECTION_TYPE.BFL
])

/** Types whose key is their own (looked up by type, not preset), keyed or not. */
const KEY_URL_BY_TYPE: ReadonlySet<string> = new Set([
	CONNECTION_TYPE.HORDE,
	CONNECTION_TYPE.NOVELAI,
	CONNECTION_TYPE.BFL
])

/**
 * Types with nothing to authenticate: a process this pub runs, or a model it
 * loads in-process.
 */
const KEYLESS_TYPES: ReadonlySet<string> = new Set([
	CONNECTION_TYPE.KOBOLDCPP_MANAGED,
	CONNECTION_TYPE.KOBOLDCPP_MANAGED_IMAGE,
	CONNECTION_TYPE.LOCAL_ONNX_EMBEDDINGS,
	CONNECTION_TYPE.LOCAL_ONNX_NER,
	CONNECTION_TYPE.OLLAMA,
	CONNECTION_TYPE.OLLAMA_EMBEDDINGS,
	CONNECTION_TYPE.LM_STUDIO
])

/**
 * Preset slugs whose service is a cloud API. Read off `category: "cloud"` in
 * `OPENAI_COMPATIBLE_PRESETS`, restated here because that table is a display
 * list with display-order integers and this is a policy.
 *
 * A row with no preset — one made before its preset carried a slug, or a
 * hand-typed URL — resolves through `baseUrl` below instead.
 */
const CLOUD_SLUGS: ReadonlySet<string> = new Set([
	"openrouter",
	"openai-official",
	"groq",
	"together-ai",
	"mistral-ai",
	"deepseek",
	"google-gemini",
	"anyscale",
	"deepinfra",
	"fireworks-ai",
	"perplexity-ai",
	"xai-grok",
	"cohere",
	"novita-ai",
	"featherless-ai",
	"demon-route"
])

/** Hosts nobody reaches without a key, for a row carrying no preset slug. */
function looksLikeCloud(baseUrl: string | null | undefined): boolean {
	const raw = baseUrl?.trim()
	if (!raw) return false
	let host: string
	try {
		host = new URL(raw).hostname.toLowerCase()
	} catch {
		return false
	}
	// A loopback or private address is somebody's own machine, whatever the
	// preset says. Everything else that answers an OpenAI-shaped API on the
	// public internet wants a key.
	if (
		host === "localhost" ||
		host.endsWith(".local") ||
		host === "0.0.0.0" ||
		/^127\./.test(host) ||
		/^10\./.test(host) ||
		/^192\.168\./.test(host) ||
		/^172\.(1[6-9]|2\d|3[01])\./.test(host) ||
		// CGNAT, 100.64.0.0/10 — where Tailscale hands out its addresses.
		/^100\.(6[4-9]|[7-9]\d|1[01]\d|12[0-7])\./.test(host) ||
		// Link-local, 169.254.0.0/16.
		/^169\.254\./.test(host) ||
		host === "[::1]" ||
		// A single-label name (`ollama`, `gpu-box`) is a LAN or Docker
		// hostname; no public API is reached without a dot. IPv6 literals
		// are bracketed, so they are not caught here.
		(!host.includes(".") && !host.startsWith("["))
	)
		return false
	return true
}

/**
 * What this connection expects.
 *
 * ⚠ Answers `optional`, never `required`, whenever it is not sure. An
 * *unfinished* row nags; a row wrongly called unfinished nags about nothing,
 * which is the failure this whole change exists to remove. Being wrong in the
 * quiet direction is the only acceptable way to be wrong here.
 */
export function credentialPolicy(connection: {
	type?: string | null
	preset?: string | null
	baseUrl?: string | null
}): CredentialPolicy {
	const type = connection.type ?? ""
	if (KEYED_TYPES.has(type)) return "required"
	if (KEYLESS_TYPES.has(type)) return "none"
	const preset = connection.preset ?? ""
	if (preset && CLOUD_SLUGS.has(preset)) return "required"
	if (type === CONNECTION_TYPE.OPENAI)
		return looksLikeCloud(connection.baseUrl) ? "required" : "optional"
	return "optional"
}

/** The page where this service hands out keys, or null. */
export function keyUrlFor(connection: {
	type?: string | null
	preset?: string | null
}): string | null {
	if (connection.type === CONNECTION_TYPE.ANTHROPIC)
		return KEY_URLS.anthropic ?? null
	if (connection.type && KEY_URL_BY_TYPE.has(connection.type))
		return KEY_URLS[connection.type] ?? null
	const preset = connection.preset ?? ""
	return (preset && KEY_URLS[preset]) || null
}

/** Whether this connection is still waiting on a key it cannot work without. */
export function needsCredential(connection: {
	type?: string | null
	preset?: string | null
	baseUrl?: string | null
	hasCredential?: boolean
}): boolean {
	return (
		credentialPolicy(connection) === "required" &&
		connection.hasCredential === false
	)
}
