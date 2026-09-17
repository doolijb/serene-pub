/**
 * The NER model's RESIDENCY — load, idle-unload, and the one call that runs it.
 *
 * The mirror of `$lib/server/embedding/index.ts`, and parallel to it for the
 * reason that file gives: an adapter is constructed per request and has nowhere
 * to keep a loaded pipeline, an idle timer or a readiness flag, so those belong
 * to the instance. The adapter delegates here; the lane's broker asks here; the
 * annotation pass reads spans from here.
 *
 * ⚠ **Every reference to `@huggingface/transformers` must stay behind a dynamic
 * import**, here and in everything this reaches. `onnxruntime-node` is a native
 * addon with no Android build, and a static import crashes server boot on a
 * phone whether or not anybody configured a NER connection.
 *
 * ## Spans are located here, not returned by the pipeline
 *
 * transformers.js 4.2.0's token-classification pipeline answers
 * `{entity_group, score, word}` and **no character offsets** — its source says
 * "TODO: Add support for start and end". Offsets are not optional for this
 * feature: a model span has to claim a stretch of the same string the gazetteer
 * matcher claims stretches of, or the two tiers cannot be merged and a model hit
 * would double-count a name tier one already resolved. So `locateSpans` finds
 * each decoded word in the source text, walking forward so repeats land on
 * different positions, and **drops a word it cannot find** rather than guessing:
 * an unavailable mechanism subtracts a signal, and a span pointing at text that
 * does not say it would put a wrong key in the annotation store.
 */

import { isAndroidWrapper } from "$lib/server/utils"
import { cacheDirFor } from "$lib/server/localModels/onnxCache"
import type { EntitySpan } from "$lib/server/adapters/actions"
import { findNerModel, isRegisteredLocalNerModel } from "./models"

type NerProbeResult = { supported: boolean; reason: string | null }

/**
 * In-memory only, per process lifetime — deliberately never persisted.
 *
 * A stored "unsupported" verdict would survive an `onnxruntime-node` upgrade
 * that fixes this exact platform, which is the class of upstream churn this
 * probe exists to stop chasing. Same argument, same shape, as the embedding
 * probe next door; kept separate rather than shared because the SENTENCE
 * differs, and the sentence is the whole product of the function.
 */
let probeResult: NerProbeResult | null = null
let probePromise: Promise<NerProbeResult> | null = null

/**
 * Attempts the real dynamic import once and caches whether it threw.
 *
 * ⚠ A pure loadability check: nothing else may go in the try block. Folding a
 * model load in would cache a failed download as a permanent "this platform
 * cannot" verdict.
 */
async function probeLocalNerSupport(): Promise<NerProbeResult> {
	if (probeResult) return probeResult
	if (!probePromise) {
		probePromise = (async () => {
			try {
				await import("@huggingface/transformers")
				probeResult = { supported: true, reason: null }
			} catch (err: any) {
				probeResult = {
					supported: false,
					reason: `Local entity extraction is not available on this system (${err?.message ?? "failed to load the local model engine"}).`
				}
			}
			return probeResult
		})()
	}
	return probePromise
}

/** Why local NER cannot run here, or null when it can. */
export async function getLocalNerUnsupportedReason(): Promise<string | null> {
	if (isAndroidWrapper()) {
		// A genuine architectural impossibility (Bionic cannot dlopen glibc
		// binaries), not a "true today" fact an upstream release could change.
		return "Local entity extraction is not available in the Android app."
	}
	return (await probeLocalNerSupport()).reason
}

/** What the loaded pipeline is called, at the shape this module uses it. */
type TokenClassifier = (
	text: string,
	options: { aggregation_strategy: "simple" }
) => Promise<Array<{ entity_group: string; score: number; word: string }>>

let classifier: TokenClassifier | null = null
let loadedModelId: string | null = null
let isLoading = false
let loadError: string | null = null

/**
 * The idle window, in minutes, as the lane's TTL.
 *
 * Held here rather than read per call because the timer has to be armed with it
 * at the moment work finishes. `setNerTtlMinutes` is called by the loader with
 * the value off the starred connection's row, which is the only moment it can
 * act on anything.
 */
let ttlMinutes = 5
let ttlTimer: ReturnType<typeof setTimeout> | null = null

/**
 * When the lane last ANNOTATED something, not when it last loaded.
 *
 * The mirror of the embedding lane's field, and set in the same one place for
 * the same reason: the timer is also reset by a load, and "loaded four minutes
 * ago, never used" is a different sentence from "last used four minutes ago".
 */
let lastUsedAt: Date | null = null

export function setNerTtlMinutes(minutes: number) {
	ttlMinutes = minutes
	resetTtlTimer()
}

/** The idle window in force right now, in minutes. */
export function getNerTtlMinutes(): number {
	return ttlMinutes
}

/** ISO time of the last extraction, or null since the last unload. */
export function getNerLastUsedAt(): string | null {
	return lastUsedAt?.toISOString() ?? null
}

function resetTtlTimer() {
	if (ttlTimer) clearTimeout(ttlTimer)
	ttlTimer = null
	if (!classifier || ttlMinutes <= 0) return
	ttlTimer = setTimeout(
		() => {
			ttlTimer = null
			unloadNerModel(`after ${ttlMinutes}m idle`)
		},
		ttlMinutes * 60 * 1000
	)
	// A background lane must never hold the process open.
	if (typeof ttlTimer.unref === "function") ttlTimer.unref()
}

/**
 * Load (or hot-swap) the entity model.
 *
 * Idempotent when the right model is already up, which is the common case: the
 * lane loads once and then annotates hundreds of rows.
 */
export async function loadNerModel(modelId: string): Promise<void> {
	if (classifier && loadedModelId === modelId) return
	if (isLoading) throw new Error("An entity model is already loading")

	const unsupportedReason = await getLocalNerUnsupportedReason()
	if (unsupportedReason) throw new Error(unsupportedReason)

	// The catalogue first, because that is where a `dtype` comes from and it is
	// the answer in the ordinary case. A model the registry holds — an `.onnx`
	// the user downloaded, filed under modality `ner` — is loadable too, with no
	// dtype override: nothing here knows what precision its weights were
	// exported at, and guessing one is how a working file stops loading.
	const modelDef = findNerModel(modelId)
	if (!modelDef && !(await isRegisteredLocalNerModel(modelId)))
		throw new Error(`Unknown entity model: ${modelId}`)

	isLoading = true
	classifier = null
	loadedModelId = null
	loadError = null
	try {
		const { pipeline: createPipeline } = await import(
			"@huggingface/transformers"
		)
		classifier = (await createPipeline("token-classification", modelId, {
			/**
			 * ⚠ Per call, NOT `env.cacheDir`.
			 *
			 * `env` is one object shared with the embedding runtime, and the two
			 * lanes load independently: a global assignment here can be
			 * overwritten between this line and the fetch it governs, which puts
			 * one lane's weights in the other's directory. The option is read at
			 * the moment the files are resolved, so it cannot race.
			 *
			 * Its own subdirectory beside the embedding weights, under the app
			 * data directory: the two catalogues can name one repo id, and a
			 * shared directory would make one cache entry mean two things.
			 */
			cache_dir: cacheDirFor("ner"),
			...(modelDef?.dtype ? { dtype: modelDef.dtype } : {})
		})) as unknown as TokenClassifier
		loadedModelId = modelId
		console.log(`[ner] Model loaded: ${modelId}`)
		resetTtlTimer()
	} catch (err: any) {
		loadError = err?.message ?? "Unknown error loading the entity model"
		console.error(`[ner] Failed to load model ${modelId}:`, err)
		throw err
	} finally {
		isLoading = false
	}
}

/** Free the model. `reason` is appended to the one log line this writes. */
export function unloadNerModel(reason?: string): void {
	if (ttlTimer) {
		clearTimeout(ttlTimer)
		ttlTimer = null
	}
	const had = classifier !== null
	classifier = null
	loadedModelId = null
	loadError = null
	// Nothing resident, so there is nothing a "last used" could be about.
	lastUsedAt = null
	if (had) console.log(`[ner] Model unloaded${reason ? ` ${reason}` : ""}`)
}

export function getLoadedNerModelId(): string | null {
	return loadedModelId
}

export function isNerModelReady(): boolean {
	return classifier !== null && loadedModelId !== null
}

export function isNerModelLoading(): boolean {
	return isLoading
}

export function getNerLoadError(): string | null {
	return loadError
}

/**
 * Whitespace between two characters of a name, as a subword decoder writes it.
 *
 * A wordpiece decode puts spaces where the passage has none (`Ashguard-Riders`
 * comes back as `Ashguard - Riders`) and never the other way round, so matching
 * a decoded word means matching its non-space characters with optional space
 * between them.
 */
const flexible = (word: string): RegExp | null => {
	const chars = [...word].filter((c) => !/\s/.test(c))
	if (!chars.length) return null
	const escape = (c: string) => c.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")
	return new RegExp(chars.map(escape).join("\\s*"))
}

/**
 * Where each decoded word sits in the source text.
 *
 * A forward cursor, because the pipeline returns entities in reading order: the
 * second mention of a name must land on the second position, not back on the
 * first. Exact match first — the ordinary case, and one `indexOf` — with the
 * space-tolerant form as the fallback.
 *
 * Exported for the adapter's own test: the arithmetic is the part of this module
 * that can be wrong without anything failing loudly.
 */
export function locateSpans(
	text: string,
	found: ReadonlyArray<{ entity_group: string; score: number; word: string }>
): EntitySpan[] {
	const out: EntitySpan[] = []
	let cursor = 0
	for (const item of found) {
		const word = (item.word ?? "").trim()
		if (!word) continue
		let start = text.indexOf(word, cursor)
		let end = start + word.length
		if (start < 0) {
			const re = flexible(word)
			const m = re ? re.exec(text.slice(cursor)) : null
			if (!m) continue
			start = cursor + m.index
			end = start + m[0].length
		}
		out.push({
			text: text.slice(start, end),
			label: item.entity_group,
			start,
			end,
			score: item.score
		})
		cursor = end
	}
	return out
}

/**
 * Run the resident model over one passage.
 *
 * ⚠ Loads nothing. Residency is the broker's business (a lane requests a model,
 * it never loads one itself), and a call that loaded on demand would put a
 * first-ever 100MB download inside whatever happened to ask first. A caller that
 * reaches this with nothing resident gets `[]`, which is the heuristic tiers
 * running alone — a subtracted signal, not a failure.
 *
 * ⚠ The pipeline tokenizes with `truncation: true`, so a passage past the
 * checkpoint's window (512 tokens on both catalogue models) is read only as far
 * as that window. The tail keeps its gazetteer and capitalisation hits, which is
 * the same shape of partial answer every bound in this stack produces, and the
 * offsets that do come back still describe this string.
 */
export async function extractNerSpans(text: string): Promise<EntitySpan[]> {
	if (!classifier || !text.trim()) return []
	const found = await classifier(text, { aggregation_strategy: "simple" })
	lastUsedAt = new Date()
	resetTtlTimer()
	return locateSpans(text, found ?? [])
}
