/**
 * The NER model's RESIDENCY — load, idle-unload, and the one call that runs it.
 *
 * The mirror of `$lib/server/embedding/index.ts`, and parallel to it for the
 * reason that file gives: an adapter is constructed per request and has nowhere
 * to keep a loaded pipeline, an idle timer or a readiness flag, so those belong
 * to the instance. `LocalOnnxNerAdapter` delegates here, for both of its
 * halves: its `extractEntities` runs the pipeline held here, and its module's
 * `residency` is how the lane's broker loads one. Nothing else calls the
 * loader; the annotation pass reads spans through the adapter.
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
 *
 * ## A long passage is read in windows
 *
 * The checkpoint reads 512 tokens at a time and the pipeline truncates past
 * that, so `extractNerSpans` cuts a longer passage into overlapping windows
 * (`planWindows`), runs each, and maps the spans back onto the whole string.
 * Each window is located on its own, so `locateSpans`' forward cursor never
 * crosses a cut, and the overlap is what lets a name a cut falls inside be read
 * whole by the neighbouring window.
 */

import {
	cacheDirFor,
	invalidateCachedScan,
	isCached,
	modelDirFor
} from "$lib/server/localModels/onnxCache"
import { localOnnxAvailability } from "$lib/server/localModels/onnxRuntime"
import type { EntitySpan } from "$lib/server/adapters/actions"
import { findNerModel } from "./models"

/**
 * Why local NER cannot run here, or null when it can.
 *
 * The verdict is `localOnnxAvailability()` (`localModels/onnxRuntime.ts`): the
 * embedding lane loads the same runtime, so the two share one probe and cannot
 * disagree. Only the SENTENCE is this lane's.
 */
export async function getLocalNerUnsupportedReason(): Promise<string | null> {
	const availability = await localOnnxAvailability()
	return availability.available
		? null
		: `Local entity extraction is not available on this system: ${availability.reason}.`
}

/** What the loaded pipeline is called, at the shape this module uses it. */
interface TokenClassifier {
	(
		text: string,
		options: { aggregation_strategy: "simple" }
	): Promise<Array<{ entity_group: string; score: number; word: string }>>
	/** The checkpoint's tokenizer — what a window is measured with. */
	tokenizer?: {
		encode(text: string): number[]
		model_max_length?: number
	}
	model?: { config?: { max_position_embeddings?: number } }
}

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

	// The catalogue first, because its `dtype` is the answer in the ordinary
	// case. A model the registry holds — an `.onnx` the user downloaded, filed
	// under modality `ner` — is loadable too, at the precision its download
	// fetched (`registeredNerModel`), or with no dtype override when the row
	// records none: guessing a precision is how a working file stops loading.
	const modelDef = findNerModel(modelId)
	const registered = modelDef ? null : await registeredNerModel(modelId)
	if (!modelDef && !registered)
		throw new Error(`Unknown entity model: ${modelId}`)
	const dtype = modelDef?.dtype ?? registered?.dtype ?? null

	isLoading = true
	classifier = null
	loadedModelId = null
	loadError = null
	try {
		const { pipeline: createPipeline, env } = await import(
			"@huggingface/transformers"
		)
		const options = {
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
			...(dtype ? { dtype: dtype as any } : {})
		}
		/**
		 * ⚠ A model on disk is loaded from its DIRECTORY, by path, not by repo
		 * id — the only way it loads offline.
		 *
		 * transformers.js 4.2.0 honours `cache_dir` for the files it fetches but
		 * not for the step that decides which files to fetch: `pipeline()`'s
		 * `get_pipeline_files` and the tokenizer's `get_tokenizer_files` look
		 * in `env.cacheDir` — the embedding lane's directory, or the package's
		 * own. With remote models refused that lookup finds nothing, and the
		 * load fails on `config.json` or yields a pipeline with no tokenizer
		 * ("this.tokenizer is not a function" on the first passage); online it
		 * asks the Hub, and fetches `config.json` into whatever `env.cacheDir`
		 * names. A path is not a repo id, so every file is read straight from
		 * the directory the download filled: no cache lookup, no network, and
		 * nothing of `env` consulted.
		 *
		 * By repo id when nothing is on disk yet — a first load, which
		 * downloads and needs the network anyway — and as the fallback when
		 * the directory lacks a file this precision needs and the Hub may
		 * supply it.
		 */
		const dir = (await isCached(modelId, "ner"))
			? modelDirFor(modelId, "ner")
			: null
		const load = (source: string) =>
			createPipeline(
				"token-classification",
				source,
				options
			) as unknown as Promise<TokenClassifier>
		try {
			classifier = await load(dir ?? modelId)
		} catch (err) {
			if (!dir || env?.allowRemoteModels === false) throw err
			console.warn(
				`[ner] ${modelId} did not load from ${dir}; trying the Hub:`,
				err
			)
			classifier = await load(modelId)
		}
		// A load by repo id may have downloaded; the scan memo would not know.
		if (!dir) invalidateCachedScan(modelId, "ner")
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

/**
 * The local model registry's row for an id the catalogue does not name, or
 * null when it holds none.
 *
 * `dtype` is the precision the row's download fetched — `local_models.
 * quantization`, which `connections:downloadModel` records from the same
 * resolution it downloads with (catalogue, then the model's declared
 * `extra_json.onnx.dtype`). Loading at any other precision asks for weights
 * the download never fetched. Null for a row that records none.
 *
 * Answers null rather than throwing when the database is unreachable: the
 * caller's next step is a refusal naming the model, which is a better sentence
 * than a database error in a path about loading a model.
 */
async function registeredNerModel(
	id: string
): Promise<{ dtype: string | null } | null> {
	if (!id) return null
	try {
		const { db } = await import("$lib/server/db")
		const schema = await import("$lib/server/db/schema")
		const { and, eq, or } = await import("drizzle-orm")
		const [row] = await db
			.select({ quantization: schema.localModels.quantization })
			.from(schema.localModels)
			.where(
				and(
					eq(schema.localModels.modality, "ner"),
					or(
						eq(schema.localModels.modelName, id),
						eq(schema.localModels.filename, id)
					)
				)
			)
			.limit(1)
		if (!row) return null
		return { dtype: row.quantization || null }
	} catch {
		return null
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
 * How far one window reaches before the tokenizer is asked, in characters.
 *
 * About 350 tokens of English prose, well inside a 512-token checkpoint, so the
 * ordinary window is never measured twice. Denser text — a script the
 * vocabulary splits finely, a run of numbers — is shrunk to fit by
 * `planWindows`, which is the only place the real limit is known.
 */
export const NER_WINDOW_CHARS = 1500

/**
 * What two neighbouring windows share, in characters.
 *
 * Longer than any name a passage plausibly contains — a titled, multi-word name
 * runs to a few dozen characters — because that is the property the merge
 * relies on: a name a cut falls inside lies whole inside the neighbouring
 * window, so the clipped copy can always be dropped for the whole one.
 */
export const NER_WINDOW_OVERLAP_CHARS = 200

/** The token window when the checkpoint publishes none — BERT's. */
const DEFAULT_MAX_TOKENS = 512

/**
 * A window narrower than this is not shrunk further; the pipeline's own
 * truncation is the floor.
 */
const MIN_WINDOW_CHARS = 64

/** One stretch of the passage the model reads in a single call. */
export interface NerWindow {
	start: number
	end: number
}

const isSpace = (c: string | undefined) => c !== undefined && /\s/.test(c)

/**
 * Pull a cut back to the end of the last whole word before it, so the window
 * ends on a word and whitespace follows.
 *
 * A cut inside a word hands the model half a word, and wordpiece decodes half a
 * name as a confident different one. Ending ON the word, never on trailing
 * whitespace, is what lets the merge see that a span in the window's last word
 * may continue past the cut (`clipped`). Kept where it is when there is no
 * whitespace in the back half of the window — one enormous token is cut hard
 * rather than shrinking the window to nothing.
 */
function snapBack(text: string, start: number, end: number): number {
	if (end >= text.length) return text.length
	if (isSpace(text[end]) && !isSpace(text[end - 1])) return end
	let i = end
	while (i > start && !isSpace(text[i])) i--
	while (i > start && isSpace(text[i - 1])) i--
	return i - start >= (end - start) / 2 ? i : end
}

/**
 * Move a window's start forward to the beginning of a word, never past
 * `limit` (the previous window's end).
 */
function snapForward(text: string, pos: number, limit: number): number {
	let i = pos
	if (i > 0 && !isSpace(text[i - 1]))
		while (i < limit && !isSpace(text[i])) i++
	while (i < limit && isSpace(text[i])) i++
	return i
}

/**
 * The windows a passage is read in: one when it fits, otherwise overlapping
 * windows of at most `size` characters, each shrunk until `fits` accepts it.
 *
 * `fits` is the tokenizer's verdict (`encode(window).length` against the
 * checkpoint's limit), or null when no tokenizer is to hand, which makes the
 * windows purely by characters. A passage the tokenizer says fits whole is one
 * window at any length up to four windows' worth — past that it cannot fit
 * and is not worth encoding to be told so.
 *
 * Exported for the test: like `locateSpans`, it is arithmetic that can be wrong
 * without anything failing loudly.
 */
export function planWindows(
	text: string,
	fits: ((window: string) => boolean) | null,
	size = NER_WINDOW_CHARS,
	overlap = NER_WINDOW_OVERLAP_CHARS
): NerWindow[] {
	if (!text) return []
	const whole = fits
		? text.length <= size * 4 && fits(text)
		: text.length <= size
	if (whole) return [{ start: 0, end: text.length }]
	const accepts = fits ?? (() => true)
	const out: NerWindow[] = []
	let start = 0
	while (start < text.length) {
		let end = snapBack(text, start, Math.min(text.length, start + size))
		while (!accepts(text.slice(start, end))) {
			const shorter = snapBack(
				text,
				start,
				start + Math.floor((end - start) * 0.75)
			)
			if (shorter >= end || shorter - start < MIN_WINDOW_CHARS) break
			end = shorter
		}
		out.push({ start, end })
		if (end >= text.length) break
		const share = Math.min(overlap, Math.floor((end - start) / 2))
		start = snapForward(text, end - share, end)
	}
	return out
}

/** A span located in one window, with whether a cut may have clipped it. */
export interface NerWindowSpan extends EntitySpan {
	/** It touches a cut — it may be the visible half of a longer name. */
	clipped: boolean
}

/**
 * Which of two overlapping spans the passage keeps.
 *
 * A clipped span loses to one that is not: the overlap guarantees the
 * neighbouring window read the same stretch whole. Otherwise the higher score,
 * then the longer span, then the first seen.
 */
function preferred(a: NerWindowSpan, b: NerWindowSpan): NerWindowSpan {
	if (a.clipped !== b.clipped) return a.clipped ? b : a
	if (a.score !== b.score) return a.score > b.score ? a : b
	return b.end - b.start > a.end - a.start ? b : a
}

/**
 * The spans of every window, as one non-overlapping list over the passage.
 *
 * A stretch two windows both read comes back twice — the same name, or one
 * whole and one clipped — and exactly one survives (`preferred`).
 */
export function mergeWindowSpans(spans: NerWindowSpan[]): EntitySpan[] {
	const sorted = [...spans].sort((a, b) => a.start - b.start || b.end - a.end)
	const kept: NerWindowSpan[] = []
	for (const span of sorted) {
		const last = kept.at(-1)
		if (last && span.start < last.end)
			kept[kept.length - 1] = preferred(last, span)
		else kept.push(span)
	}
	return kept.map(({ clipped: _clipped, ...span }) => span)
}

/** The checkpoint's token limit: the tighter of what its tokenizer and config publish. */
function tokenLimit(run: TokenClassifier): number {
	const published = [
		run.tokenizer?.model_max_length,
		run.model?.config?.max_position_embeddings
	].filter(
		(n): n is number => typeof n === "number" && Number.isFinite(n) && n > 0
	)
	return published.length ? Math.min(...published) : DEFAULT_MAX_TOKENS
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
 * A passage past the checkpoint's window (512 tokens on both catalogue models)
 * is read in overlapping windows rather than truncated — see the header. The
 * offsets that come back describe THIS string, whichever window found them.
 */
export async function extractNerSpans(text: string): Promise<EntitySpan[]> {
	// Held for the whole passage: a swap mid-passage must not put a second
	// model's spans beside the first one's.
	const run = classifier
	if (!run || !text.trim()) return []

	const limit = tokenLimit(run)
	const encode = run.tokenizer?.encode?.bind(run.tokenizer)
	const fits = encode
		? (window: string) => encode(window).length <= limit
		: null

	const spans: NerWindowSpan[] = []
	for (const w of planWindows(text, fits)) {
		const window = text.slice(w.start, w.end)
		const found = await run(window, { aggregation_strategy: "simple" })
		for (const span of locateSpans(window, found ?? [])) {
			const clipped =
				(w.start > 0 && !/\s/.test(window.slice(0, span.start))) ||
				(w.end < text.length && !/\s/.test(window.slice(span.end)))
			spans.push({
				...span,
				start: span.start + w.start,
				end: span.end + w.start,
				clipped
			})
		}
	}
	lastUsedAt = new Date()
	resetTtlTimer()
	return mergeWindowSpans(spans)
}
