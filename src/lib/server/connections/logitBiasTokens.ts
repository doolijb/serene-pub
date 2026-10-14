/**
 * Logit bias entries → token ids, for one request (plan logit-bias L4–L6).
 *
 * A sampling config's `logitBias` is a list of logit bias entries — words,
 * exact text, or token ids — and a backend takes ids. So before an adapter
 * builds its request, each entry is read by the shared syntax
 * (`readLogitBiasText`), its text handed to the connection's tokenizer, and
 * every token of the sequence given the entry's bias. On an id two rows share,
 * the later row wins.
 *
 * ## Which tokenizer
 *
 * - KoboldCPP (managed or not) and llama.cpp: the server's own tokenize route
 *   (`tokenIdsEndpointFor`), exact for the model it has loaded.
 * - Anything else: the local encoder the connection's tokenizer setting names
 *   (`loadTokenIdEncoder`). A ratio tokenizer (`estimate`, …) has no ids.
 *
 * With no tokenizer, word and exact entries are left out; `[ids]` entries
 * never need one and still go. An unavailable mechanism subtracts — it never
 * guesses ids from another tokenizer.
 *
 * ## The cache
 *
 * `logit_bias_tokens`, keyed by (connection, model, tokenizer fingerprint,
 * text): read in one query, the misses tokenized (one request each, with a
 * short timeout, stopping at the first that fails), then inserted with
 * on-conflict-do-nothing. The fingerprint names the tokenizer that answered —
 * the service and the model its server says is loaded, or the local encoder —
 * so a model swapped behind an unchanged connection misses rather than reading
 * another vocabulary's ids.
 *
 * ⚠ Nothing here can fail a generation. A tokenizer or cache that does not
 * answer leaves the affected entries out, and the request goes without them.
 */

import { and, eq, inArray } from "drizzle-orm"
import * as schema from "$lib/server/db/schema"
import { CONNECTION_DEFAULTS } from "$lib/shared/utils/connectionDefaults"
import {
	readLogitBiasText,
	readLogitBiasValue,
	type LogitBiasReading
} from "$lib/shared/utils/logitBias"
import { tokenIdsEndpointFor } from "./backendTokenCount"

/** What resolution reads off the connection pair. */
export interface LogitBiasConnection {
	id: number
	type: string
	baseUrl?: string | null
	/** The pair's model identifier. */
	model?: string | null
	/** The tokenizer setting (`metadata.tokenizer` in the run's world). */
	tokenCounter?: string | null
}

/** A tokenizer that gives ids, and which one it is. */
export interface LogitBiasTokenizer {
	/** Stored as `tokenizer_fingerprint`. */
	fingerprint: string
	/** Each text's ids, in order; null for a text it could not tokenize. */
	tokenize(texts: string[]): Promise<(number[] | null)[]>
}

/** An entry left out of the request, and why. */
export interface SkippedLogitBiasEntry {
	text: string
	reason: string
}

export interface LogitBiasResolution {
	/** Token id → bias. Empty when nothing resolved; then nothing is sent. */
	biases: Map<number, number>
	/** Entries left out, in list order. Empty rows are not among them. */
	skipped: SkippedLogitBiasEntry[]
	/**
	 * The list asked for something and nothing could be sent — the value was
	 * unreadable, or no entry resolved. The adapter notes `logitBias` as
	 * ignored on the receipt.
	 */
	ignored: boolean
}

export interface LogitBiasDeps {
	/** The cache's database; the app's own when absent. */
	db?: Db
	fetch?: typeof fetch
	/** The tokenizer to use instead of the connection's; null for none. */
	tokenizer?: LogitBiasTokenizer | null
}

/** Per tokenize request, and for the loaded-model question. */
const REQUEST_TIMEOUT_MS = 3000

/** Resolve a stored `logitBias` value to token id → bias for this connection. */
export async function resolveLogitBias(
	connection: LogitBiasConnection,
	value: unknown,
	deps: LogitBiasDeps = {}
): Promise<LogitBiasResolution> {
	const entries = readLogitBiasValue(value)
	if (!entries)
		return {
			biases: new Map(),
			skipped: [
				{
					text: describe(value),
					reason: "The logit bias value is not a list Serene Pub can read."
				}
			],
			ignored: true
		}

	const rows = entries.map((entry) => ({
		value: entry.value,
		text: entry.text,
		reading: readLogitBiasText(entry.text)
	}))
	const texts = [
		...new Set(rows.map((r) => textOf(r.reading)).filter(isString))
	]

	let ids = new Map<string, number[]>()
	let tokenizer: LogitBiasTokenizer | null = null
	if (texts.length) {
		const fetchImpl = deps.fetch ?? fetch
		tokenizer =
			deps.tokenizer !== undefined
				? deps.tokenizer
				: await logitBiasTokenizerFor(connection, fetchImpl)
		if (tokenizer)
			ids = await tokenIdsFor(connection, tokenizer, texts, deps.db)
	}

	const biases = new Map<number, number>()
	const skipped: SkippedLogitBiasEntry[] = []
	for (const row of rows) {
		const { reading } = row
		if (reading.kind === "empty") continue
		if (reading.kind === "invalid") {
			skipped.push({ text: row.text, reason: reading.reason })
			continue
		}
		const tokens =
			reading.kind === "ids" ? reading.ids : ids.get(reading.text)
		if (!tokens?.length) {
			skipped.push({
				text: row.text,
				reason: tokenizer
					? "The tokenizer did not answer for this text."
					: "This connection has no tokenizer that gives token ids."
			})
			continue
		}
		for (const id of tokens) biases.set(id, row.value)
	}

	const askedForSomething = rows.some((r) => r.reading.kind !== "empty")
	return { biases, skipped, ignored: askedForSomething && !biases.size }
}

/**
 * The tokenizer that gives this connection's ids, or null when it has none.
 *
 * The server's own route where its type has one; the local encoder its
 * tokenizer setting names otherwise.
 */
export async function logitBiasTokenizerFor(
	connection: LogitBiasConnection,
	fetchImpl: typeof fetch = fetch
): Promise<LogitBiasTokenizer | null> {
	const endpoint = tokenIdsEndpointFor(
		connection.type,
		connection.baseUrl ||
			(CONNECTION_DEFAULTS as Record<string, { baseUrl?: string }>)[
				connection.type
			]?.baseUrl
	)
	if (endpoint) {
		const loaded =
			(await getJson(fetchImpl, endpoint.loadedModel.url).then((json) =>
				json === undefined ? null : endpoint.loadedModel.read(json)
			)) ??
			connection.model ??
			""
		return {
			fingerprint: `${connection.type}:${loaded}`,
			tokenize: async (texts) => {
				const out: (number[] | null)[] = []
				let reachable = true
				for (const text of texts) {
					// One refusal is the server's answer for the rest too: a
					// list of fifty would otherwise wait out fifty timeouts.
					const json = reachable
						? await postJson(
								fetchImpl,
								endpoint.url,
								endpoint.body(text)
							)
						: undefined
					if (json === undefined) reachable = false
					out.push(json === undefined ? null : endpoint.read(json))
				}
				return out
			}
		}
	}

	const { loadTokenIdEncoder } = await import(
		"$lib/server/pipelines/runtime/tokenizers"
	)
	const encode = await loadTokenIdEncoder(connection.tokenCounter)
	if (!encode) return null
	return {
		fingerprint: `local:${connection.tokenCounter}`,
		tokenize: async (texts) =>
			texts.map((text) => {
				try {
					return encode(text)
				} catch {
					// gpt-tokenizer refuses text spelling a special token.
					return null
				}
			})
	}
}

/**
 * Each text's ids under this tokenizer: the cache first, the tokenizer for
 * the misses, and the answers written back.
 */
async function tokenIdsFor(
	connection: LogitBiasConnection,
	tokenizer: LogitBiasTokenizer,
	texts: string[],
	injected?: Db
): Promise<Map<string, number[]>> {
	const model = connection.model ?? ""
	const key = {
		connectionId: connection.id,
		model,
		tokenizerFingerprint: tokenizer.fingerprint
	}
	const db = injected ?? (await appDb())
	const found = new Map<string, number[]>()

	if (db)
		try {
			const rows = await db
				.select({
					tokenizedText: schema.logitBiasTokens.tokenizedText,
					tokenIds: schema.logitBiasTokens.tokenIds
				})
				.from(schema.logitBiasTokens)
				.where(
					and(
						eq(
							schema.logitBiasTokens.connectionId,
							key.connectionId
						),
						eq(schema.logitBiasTokens.model, key.model),
						eq(
							schema.logitBiasTokens.tokenizerFingerprint,
							key.tokenizerFingerprint
						),
						inArray(schema.logitBiasTokens.tokenizedText, texts)
					)
				)
			for (const row of rows) found.set(row.tokenizedText, row.tokenIds)
		} catch (err) {
			console.warn("[logit bias] Could not read the token cache:", err)
		}

	const misses = texts.filter((t) => !found.has(t))
	if (!misses.length) return found

	let answers: (number[] | null)[]
	try {
		answers = await tokenizer.tokenize(misses)
	} catch (err) {
		console.warn("[logit bias] The tokenizer failed:", err)
		return found
	}
	const fresh: (typeof schema.logitBiasTokens.$inferInsert)[] = []
	misses.forEach((text, i) => {
		const ids = answers[i]
		if (!ids?.length) return
		found.set(text, ids)
		fresh.push({ ...key, tokenizedText: text, tokenIds: ids })
	})

	if (db && fresh.length)
		try {
			await db
				.insert(schema.logitBiasTokens)
				.values(fresh)
				.onConflictDoNothing()
		} catch (err) {
			console.warn("[logit bias] Could not write the token cache:", err)
		}
	return found
}

/**
 * Forget a connection's cached token ids — called when its model or its
 * tokenizer setting is edited. Deleting the connection cascades.
 */
export async function pruneLogitBiasTokens(
	db: Db,
	connectionId: number
): Promise<void> {
	await db
		.delete(schema.logitBiasTokens)
		.where(eq(schema.logitBiasTokens.connectionId, connectionId))
}

/** `{ "<id>": bias }` — the OpenAI-compatible and KoboldCPP wire shape. */
export function logitBiasObject(
	biases: ReadonlyMap<number, number>
): Record<string, number> {
	const out: Record<string, number> = {}
	for (const [id, bias] of biases) out[String(id)] = bias
	return out
}

/** `[[id, bias], …]` — llama.cpp's typed `logit_bias`. */
export function logitBiasPairs(
	biases: ReadonlyMap<number, number>
): [number, number][] {
	return [...biases]
}

/** The text a tokenizer is handed for a reading, if it needs one. */
const textOf = (reading: LogitBiasReading): string | undefined =>
	reading.kind === "word" || reading.kind === "exact"
		? reading.text
		: undefined

const isString = (v: unknown): v is string => typeof v === "string"

/** An unreadable value, short enough for a log line. */
function describe(value: unknown): string {
	const text = typeof value === "string" ? value : JSON.stringify(value)
	return String(text ?? "").slice(0, 60)
}

/** The app's database, once it is ready; null where it cannot be had. */
async function appDb(): Promise<Db | null> {
	try {
		const mod = await import("$lib/server/db")
		await mod.dbReady
		return mod.db as unknown as Db
	} catch {
		return null
	}
}

/** A JSON GET; undefined for anything but a 2xx JSON answer. */
async function getJson(fetchImpl: typeof fetch, url: string): Promise<unknown> {
	try {
		const res = await fetchImpl(url, {
			signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS)
		})
		return res.ok ? await res.json() : undefined
	} catch {
		return undefined
	}
}

/** A JSON POST; undefined for anything but a 2xx JSON answer. */
async function postJson(
	fetchImpl: typeof fetch,
	url: string,
	body: Record<string, unknown>
): Promise<unknown> {
	try {
		const res = await fetchImpl(url, {
			method: "POST",
			headers: { "Content-Type": "application/json" },
			body: JSON.stringify(body),
			signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS)
		})
		return res.ok ? await res.json() : undefined
	} catch {
		return undefined
	}
}
