import * as path from "path"
import * as fsPromises from "fs/promises"
import {
	fetchCurrentModelStatus,
	fetchImageModelStatus,
	fetchLoadedEmbeddingModel,
	fetchModelStatusForPoll,
	type ImageModelStatus,
	type LoadedModel
} from "./kcppHttp"
import { CONNECTION_DEFAULTS } from "$lib/shared/utils/connectionDefaults"
import { CONNECTION_TYPE } from "$lib/shared/constants/ConnectionTypes"
import { MODEL_EXTENSION_RE } from "./modelKind"
import { pollUntilReady } from "./pollUntilReady"

/**
 * One model, named by one request.
 *
 * The managed endpoint carries text, image and embedding models, each with its
 * `modality`, and a request names ONE of them and says which kind it is.
 * Nothing above this file asserts anything about what is
 * loaded — a request says WHICH model it needs, and {@link planResidency} below
 * decides what ends up resident.
 *
 * A discriminated union rather than one object with two optional model fields,
 * so "a request naming two models" and "text knobs riding along with an image
 * model" are unrepresentable rather than merely unwritten. `path` is resolved by
 * the caller (see modelsDir.ts) because which directory a filename belongs in is
 * a two-column question this file has no business answering.
 */
export type ManagedModelRequest =
	| {
			kind: "text"
			/** Bare filename, as stored on the connection row. */
			file: string
			/** Absolute path, already resolved and contained. */
			path: string
			gpuLayers: number
			flashAttention: boolean
			batchSize: number
			contextSize: number
			/**
			 * The vision projector's bare filename (`visionProjector.ts`), or
			 * absent for a model that reads no images.
			 */
			mmproj?: string
			/** Its absolute path, resolved and contained like `path`. */
			mmprojPath?: string
	  }
	| {
			kind: "image"
			file: string
			path: string
			/** Threads for the image model. Absent lets koboldcpp decide. */
			threads?: number
			/**
			 * Quantisation for the image model: 0 = off, 1 = q8, 2 = q4.
			 *
			 * An int, not a name — koboldcpp's argparse is
			 * `type=int, choices=[0,1,2]` and the value is assigned straight into
			 * a ctypes int, so a `"q8_0"` here would be written verbatim into the
			 * .kcpps and blow up inside the loader rather than at the point it
			 * was set.
			 */
			quant?: 0 | 1 | 2
	  }
	| {
			/** koboldcpp's third loader, `--embeddingsmodel` — co-resident
			 * with the other two (see {@link planResidency}). */
			kind: "embeddings"
			file: string
			path: string
			/**
			 * `--embeddingsmaxctx`: the most tokens one input may hold. Absent
			 * leaves koboldcpp's own default. Unlike the text model's, compared
			 * exactly — it is a setting, not a demand a bigger window serves.
			 */
			contextSize?: number
			/**
			 * `--embeddingsgpu`. Absent is koboldcpp's default, the CPU — which
			 * keeps the embedding model out of the VRAM the chat model is
			 * sized against.
			 */
			gpu?: boolean
	  }

export type ManagedModelKind = ManagedModelRequest["kind"]

type PlannedModel<K extends ManagedModelKind> = Omit<
	Extract<ManagedModelRequest, { kind: K }>,
	"kind"
>

/** What should be (or is) resident, keyed by kind. */
export type Residency = {
	text?: PlannedModel<"text">
	image?: PlannedModel<"image">
	embeddings?: PlannedModel<"embeddings">
}

/** The embeddings slot's contents: the request minus its discriminant. */
export type EmbeddingModelSlot = PlannedModel<"embeddings">

// Sourced from the shared connection defaults (the same object the edit
// form and connections:create/get backfilling use) rather than a separate
// local copy, so a launch config and the form displaying it can never drift.
const SHARED_MANAGED_DEFAULTS =
	CONNECTION_DEFAULTS[CONNECTION_TYPE.KOBOLDCPP_MANAGED].extraJson
		.managedConfig!

/** The text-load knobs a managed connection falls back to when its row carries
 * none. Image loads have no counterpart: koboldcpp's own defaults for
 * sdthreads/sdquant are the honest answer, so absent means absent. */
export const DEFAULT_MANAGED_CONFIG = {
	gpuLayers: SHARED_MANAGED_DEFAULTS.gpuLayers, // -1 = koboldcpp autofit (offload as many layers as fit on GPU)
	flashAttention: SHARED_MANAGED_DEFAULTS.flashAttention,
	batchSize: SHARED_MANAGED_DEFAULTS.batchSize
}

// TTL timers, keyed by baseUrl (the koboldcpp instance), not connectionId.
// There's only ever one koboldcpp process per instance — the resource this
// timer guards is shared, not per-connection. Two managed connections pointed
// at the same instance (e.g. a "Session" connection and a separate "Summarizer"
// connection) used to each get their own independent timer keyed by their
// own connectionId: whichever fired first would unload the model out from
// under the other connection's active or imminent generation, regardless of
// that connection's own idle state. Keying by baseUrl means any activity on
// the shared instance resets the one timer that actually governs it. It is also
// exactly why a second connection TYPE does not get a second timer: an image
// connection points at the same process, so it shares the same timer.
// Held on `globalThis` with the rest of this module's mutable state — see
// `shared` below.

// Simple lock so concurrent requests don't double-load — same home.

// What's actually resident right now, as far as this process knows.
//
// A map keyed by KIND, rewritten wholesale on every load — deliberately not a
// cache keyed by MODEL NAME, which is the shape that goes wrong: an entry for a
// model that has since been evicted still looks validly cached, so the next
// request for it skips a load it very much needs. Keying by kind cannot do that,
// because the loader replaces the whole map with what it just asked for.
export interface LoadedSignature {
	resident: Residency
	// The exact .kcpps file content sent to koboldcpp's admin API — kept
	// verbatim (not re-derived from the fields above) so what's shown to the
	// user is guaranteed to match what was actually sent, including any
	// fields added here in the future that the summary fields don't surface.
	rawConfigJson: string
}

/**
 * This module's mutable state, on `globalThis` for the same reason
 * `subprocessManager.ts` keeps its own there: a Vite SSR re-evaluation (any
 * edit under `$lib/server/db`, or to `./kcppHttp`/`./pollUntilReady`) would
 * otherwise start a NEW evaluation with no record of what the still-running
 * koboldcpp has loaded, and the next generation re-issues a same-file reload
 * the process did not need — while the OLD evaluation's TTL timer stays armed
 * against a record nobody can reset any more. Production evaluates once.
 */
interface ModelManagerState {
	ttlTimers: Record<string, ReturnType<typeof setTimeout>>
	loadingPromise: Promise<void> | null
	loadedSignature: LoadedSignature | null
	/** The standing embedding model — see "The embeddings slot" below.
	 * Optional because a state object from an evaluation older than the slot
	 * can still be on `globalThis` in a dev server; absent reads as none. */
	embeddingModel?: EmbeddingModelSlot | null
}
const globalScope = globalThis as unknown as {
	__SERENE_PUB_KCPP_MODELS__?: ModelManagerState
}
const shared: ModelManagerState = (globalScope.__SERENE_PUB_KCPP_MODELS__ ??= {
	ttlTimers: {},
	loadingPromise: null,
	loadedSignature: null,
	embeddingModel: null
})
const ttlTimers = shared.ttlTimers

/**
 * What this process last loaded via ensureModelLoaded(), if anything — the
 * only source of truth for gpuLayers/flashAttention/batchSize/contextSize and
 * for WHICH image model is resident, since koboldcpp exposes none of those for
 * querying. Resets to null on server restart even if koboldcpp itself is still
 * running with a model loaded.
 */
export function getLoadedSignature(): LoadedSignature | null {
	return shared.loadedSignature
}

/*
 * ## The embeddings slot
 *
 * koboldcpp holds an embedding model in a slot of its own (`--embeddingsmodel`),
 * beside whichever text or image model is loaded, on the CPU by default. So
 * the embedding model is CO-RESIDENT: loading it never evicts the text or image
 * model, and a text or image swap never evicts it. Every `.kcpps` this file
 * writes carries it, because `reload_config` resets every key a file leaves out
 * (see {@link buildConfigContent}).
 *
 * The API, for the managed embedding adapter and the "Use for embeddings"
 * handler:
 *
 *   - **Load (and keep) one**: `ensureManagedReady({ kind: "embeddings", file,
 *     contextSize?, gpu? })` from `managedPreflight.ts` — the same entry the
 *     text and image paths use, which resolves the path, starts the process
 *     and lands here. It reloads only when the slot holds something else, and
 *     otherwise just resets the idle timer: call it before every embedding
 *     request, which is what "embedding work keeps the model warm" means. On
 *     success the model becomes the STANDING one.
 *   - **The standing model** ({@link getEmbeddingModel} /
 *     {@link setEmbeddingModel}): what every later load keeps in the slot. It
 *     outlives an idle unload (`unloadModel` forgets what is resident, not
 *     what is wanted), so the next chat load brings the embedding model back
 *     with it in the same reload. It does NOT outlive a server restart — the
 *     caller that owns the choice (the `text->embedding` default) re-states it
 *     with `setEmbeddingModel` or simply by its next `ensureManagedReady`.
 *   - **Clear or change it**: `setEmbeddingModel(null)` (or another slot). No
 *     I/O of its own: the next load of ANY kind sees the slot differ from
 *     what is resident and reloads once, the same path a text-model change
 *     takes.
 *   - **What is loaded**: {@link getLoadedEmbeddingModel} is this process's
 *     record; `fetchLoadedEmbeddingModel` (`kcppHttp.ts`) asks koboldcpp.
 *
 * Two failures are kept away from chat. A standing model whose file has gone is
 * dropped before it is written into a load — koboldcpp answers a missing
 * `embeddingsmodel` by abandoning the WHOLE requested config for its launch
 * one ("recover to safe mode", verified on 1.119), which would take the text
 * model with it. And a load the embedding model does not come back from drops
 * it as standing, so the preflight's retry loads the chat model alone.
 */

/** The standing embedding model, or null. */
export function getEmbeddingModel(): EmbeddingModelSlot | null {
	return shared.embeddingModel ?? null
}

/**
 * Name the standing embedding model, or clear it with null. Takes effect on
 * the next load of any kind — one reload — rather than now; see above.
 */
export function setEmbeddingModel(model: EmbeddingModelSlot | null): void {
	shared.embeddingModel = model ? { ...model } : null
}

/** The embedding model's bare filename as this process last loaded it, or
 * null — like {@link getLoadedSignature}, forgotten on a server restart. */
export function getLoadedEmbeddingModel(): string | null {
	return shared.loadedSignature?.resident.embeddings?.file ?? null
}

/**
 * The standing embedding model, if its file is still there.
 *
 * Only an absolute path can be checked; a bare filename (no models directory
 * configured, the legacy shape) is koboldcpp's to resolve and passes through.
 */
async function standingEmbeddingModel(): Promise<EmbeddingModelSlot | null> {
	const standing = getEmbeddingModel()
	if (!standing || !path.isAbsolute(standing.path)) return standing
	try {
		await fsPromises.access(standing.path)
		return standing
	} catch {
		console.warn(
			`[KoboldCPP] embedding model "${standing.file}" is no longer at ${standing.path} — loading without it`
		)
		shared.embeddingModel = null
		return null
	}
}

/**
 * Which of the models named by connections should be resident after this load.
 *
 * Text and image: exactly one of the two. koboldcpp CAN hold a text and an
 * image model at once — verified against the real binary, one .kcpps carrying
 * both `model` and `sdmodel` loads both and reports `llm: true` and `txt2img:
 * true` together — so co-loading is not ruled out, it is simply not what we
 * do. That makes this a SCHEDULING decision, and it is made here and nowhere
 * else.
 *
 * To co-load them, return `{ ...current, ...planEntry(req) }` and the rest of
 * this file follows unchanged: the .kcpps builder already emits every block
 * independently, the signature already holds every entry, and the readiness
 * waits already wait on whichever kinds the plan names. Nothing in
 * connections, the schema, the manifest, the adapters or dispatchImage knows
 * this function exists.
 *
 * The cost of that answer, stated plainly so nobody rediscovers it as a bug:
 * chat and image CONTEND for the one slot, so a message with a picture can cost
 * two model loads. That is the accepted trade — switching models is the same as
 * it already is between two LLMs — and it is exactly what co-loading would
 * remove.
 *
 * Embeddings: CO-RESIDENT, always (see "The embeddings slot" above). An
 * embeddings request keeps whatever text or image model `current` holds; a
 * text or image request keeps `standingEmbeddings` — the standing model, not
 * whatever `current` happens to record, so a cleared one is dropped by the next
 * load and one remembered across an idle unload comes back with it.
 */
export function planResidency(
	req: ManagedModelRequest,
	current: Residency,
	standingEmbeddings: EmbeddingModelSlot | null = null
): Residency {
	if (req.kind === "embeddings") {
		return {
			...(current.text ? { text: current.text } : {}),
			...(current.image ? { image: current.image } : {}),
			...planEntry(req)
		}
	}
	return {
		...planEntry(req),
		...(standingEmbeddings ? { embeddings: standingEmbeddings } : {})
	}
}

/** The request as a one-key residency: everything except the discriminant. */
function planEntry(req: ManagedModelRequest): Residency {
	if (req.kind === "text") {
		const { kind: _kind, ...text } = req
		return { text }
	}
	if (req.kind === "embeddings") {
		const { kind: _kind, ...embeddings } = req
		return { embeddings }
	}
	const { kind: _kind, ...image } = req
	return { image }
}

// koboldcpp's /api/v1/model reports the loaded model without its file
// extension (e.g. "koboldcpp/MN-12B-Lyra-v4-Q4_K_M"), while a request tracks
// the full filename (e.g. "MN-12B-Lyra-v4-Q4_K_M.gguf") — strip both down to a
// bare basename so "is the right model already loaded" comparisons actually
// match instead of always reporting a mismatch. Only ever used against
// koboldcpp's own answer; this process compares its own records verbatim.
//
// Exported as THE rule for "one koboldcpp model, however it is spelled": the
// embedding adapters check a response's `model` with it, and the managed
// endpoint's vector identity is built from it (`embedding/target.ts`), so a
// spelling koboldcpp answers with and the one a row stores cannot disagree.
export function normalizeModelName(name: string): string {
	return path.basename(name.trim()).replace(MODEL_EXTENSION_RE, "")
}

/**
 * Does what is resident already satisfy the plan?
 *
 * Key-count equality plus every planned kind satisfied means the key SETS match,
 * so a plan that drops a kind (an image-only request while a text model is
 * resident, which is every alternation under today's policy; any load after
 * the embedding model was cleared) correctly reads as a mismatch rather than as
 * "close enough".
 */
function residencyMatches(current: Residency, plan: Residency): boolean {
	if (Object.keys(current).length !== Object.keys(plan).length) return false
	if (plan.text) {
		const have = current.text
		if (
			!have ||
			have.file !== plan.text.file ||
			have.path !== plan.text.path ||
			have.gpuLayers !== plan.text.gpuLayers ||
			have.flashAttention !== plan.text.flashAttention ||
			have.batchSize !== plan.text.batchSize ||
			// A projector added, removed or swapped is a different launch: the
			// running process cannot grow or drop one without a reload.
			(have.mmprojPath ?? null) !== (plan.text.mmprojPath ?? null) ||
			// >=, not ===: a model already loaded with a bigger context window
			// serves a smaller request without a reload.
			have.contextSize < plan.text.contextSize
		) {
			return false
		}
	}
	if (plan.image) {
		const have = current.image
		if (
			!have ||
			have.file !== plan.image.file ||
			have.path !== plan.image.path ||
			(have.threads ?? null) !== (plan.image.threads ?? null) ||
			// 0 is koboldcpp's own default, so absent and 0 say the same thing.
			(have.quant ?? 0) !== (plan.image.quant ?? 0)
		) {
			return false
		}
	}
	if (plan.embeddings) {
		const have = current.embeddings
		if (
			!have ||
			have.file !== plan.embeddings.file ||
			have.path !== plan.embeddings.path ||
			// Absent and 0 both leave koboldcpp's default.
			(have.contextSize ?? 0) !== (plan.embeddings.contextSize ?? 0) ||
			!!have.gpu !== !!plan.embeddings.gpu
		) {
			return false
		}
	}
	return true
}

/** What koboldcpp itself says about one kind in the plan. `unknown` is "we
 * could not ask", never "the wrong thing is loaded" — see the livelock note in
 * ensureModelLoaded. */
type Verdict = "confirmed" | "contradicted" | "unknown"

/**
 * How long an unbroken run of connection refusals is tolerated on a load we
 * cannot gate on process liveness (an external or adopted-external instance).
 *
 * koboldcpp takes its listener DOWN for the whole of a load — measured against
 * the real binary at 6s for a warm same-file reload and 23s for a cold 16 GB
 * text model, and a slow disk or CPU-only box stretches that into minutes. The
 * generic three-strikes default (~6s) therefore failed every external-mode
 * load of any real model with "appears to have crashed" while it was loading
 * fine. A dead external process is still caught, just by time rather than by
 * a tick count; the fixed hard ceiling below remains the outer bound.
 */
const EXTERNAL_REFUSAL_GRACE_MS = 5 * 60_000

/**
 * How long a continuously-affirmative `/api/v1/model` is allowed to mean
 * nothing before we accept it anyway — the text twin of
 * {@link IMAGE_RELOAD_SETTLE_MS}, consulted only when the expected model was
 * ALREADY reported resident before the reload (see waitForModelReady).
 */
const TEXT_RELOAD_SETTLE_MS = 20_000

/**
 * Wait for the text model to finish loading.
 *
 * The trap is a same-file reload: this process restarted while koboldcpp kept
 * running with the model (adopted through the pid file), or a load knob
 * changed (context, GPU layers). koboldcpp really does tear down and reload —
 * but its OUTGOING listener keeps answering `/api/v1/model` with the very same
 * name for over a second after `reload_config` has returned `success`. A wait
 * that simply looked for the expected name returned on its first tick, the
 * load was reported complete, and the generation that followed was sent
 * straight into the 6–25s window where nothing was listening at all.
 *
 * So when `alreadyReportedResident`, the wait is for something that CHANGED
 * first — the listener going down, or a different answer — exactly as the
 * image wait does. The poll runs faster in that phase so a small model's
 * brief gap isn't missed between two ticks; if it is missed anyway, the settle
 * backstop accepts the uninterrupted answer rather than hanging.
 */
async function waitForModelReady(
	baseUrl: string,
	expectedFile: string,
	alreadyReportedResident: boolean,
	signal?: AbortSignal,
	isAlive?: () => boolean
): Promise<void> {
	const expected = normalizeModelName(expectedFile)
	const startedAt = Date.now()
	let sawSomethingChange = !alreadyReportedResident
	await pollUntilReady(
		async () => {
			const { modelName, refused } =
				await fetchModelStatusForPoll(baseUrl)
			const current = modelName ? normalizeModelName(modelName) : null
			if (current !== expected) {
				sawSomethingChange = true
				return refused ? "refused" : "not-ready"
			}
			if (sawSomethingChange) return "ready"
			if (Date.now() - startedAt >= TEXT_RELOAD_SETTLE_MS) {
				console.log(
					`[KoboldCPP] model "${expectedFile}": koboldcpp has answered with it without interruption since the reload, so the load window was missed rather than still running — treating it as loaded`
				)
				return "ready"
			}
			return "not-ready"
		},
		{
			signal,
			isAlive,
			intervalMs: alreadyReportedResident ? 500 : 2000,
			refusedGraceMs: EXTERNAL_REFUSAL_GRACE_MS,
			// With a real liveness check (managed mode, we hold the process
			// handle), there's no need to guess how long a huge model can
			// take on slow hardware — wait as long as it's actually alive.
			// Without one (an external instance we merely ping), fall back
			// to a fixed, conservative ceiling since we have no better signal.
			hardTimeoutMs: isAlive ? 30 * 60_000 : 600_000,
			label: `model "${expectedFile}"`,
			onTick: (elapsed) =>
				console.log(
					`[KoboldCPP] still waiting for "${expectedFile}" to finish loading… (${Math.round(elapsed / 1000)}s)`
				)
		}
	)
}

/**
 * How long a continuously-affirmative `txt2img` is allowed to mean nothing
 * before we accept it anyway.
 *
 * Only consulted when the flag was ALREADY set before the reload (see
 * waitForImageModelReady). koboldcpp takes its listener down for the entire
 * duration of a load — measured against the real binary at 1.75s for a 650 MB
 * image model and 21s for an 11 GB text one — so twenty seconds of the endpoint
 * answering on every single tick is itself evidence that no load is in progress
 * and the gap was simply missed between two polls.
 */
const IMAGE_RELOAD_SETTLE_MS = 20_000

/**
 * Wait for an image model to finish loading.
 *
 * `/api/extra/version`'s `txt2img` says AN image model is resident, never which
 * one, and — this is the trap — it does not go false in between. Measured on a
 * real image→image reload: `true` for the first half-second (the OUTGOING
 * model), then the listener disappears for the whole load, then `true` again
 * with the new model. A poll that simply waited for `true` would have returned
 * on its first tick, before the requested model had loaded a single byte.
 *
 * So the wait is for something that actually CHANGED. Either the flag was known
 * to be off before the reload (a cold process, or a text model being evicted —
 * both verified to report `txt2img: false`), in which case any `true` is proof;
 * or it was not, in which case one non-affirmative observation has to land first.
 * That observation is the load itself: the listener is down for all of it.
 */
async function waitForImageModelReady(
	baseUrl: string,
	expectedFile: string,
	knownOffBeforeReload: boolean,
	signal?: AbortSignal,
	isAlive?: () => boolean
): Promise<void> {
	const startedAt = Date.now()
	let sawSomethingChange = knownOffBeforeReload
	await pollUntilReady(
		async () => {
			const { present, refused, determined } =
				await fetchImageModelStatus(baseUrl)
			if (!determined || !present) {
				sawSomethingChange = true
				return refused ? "refused" : "not-ready"
			}
			if (sawSomethingChange) return "ready"
			if (Date.now() - startedAt >= IMAGE_RELOAD_SETTLE_MS) {
				console.log(
					`[KoboldCPP] image model "${expectedFile}": koboldcpp has answered without interruption since the reload, so the load window was missed rather than still running — treating it as loaded`
				)
				return "ready"
			}
			return "not-ready"
		},
		{
			signal,
			isAlive,
			refusedGraceMs: EXTERNAL_REFUSAL_GRACE_MS,
			hardTimeoutMs: isAlive ? 30 * 60_000 : 600_000,
			label: `image model "${expectedFile}"`,
			onTick: (elapsed) =>
				console.log(
					`[KoboldCPP] still waiting for image model "${expectedFile}" to finish loading… (${Math.round(elapsed / 1000)}s)`
				)
		}
	)
}

/**
 * How long koboldcpp may keep answering WITHOUT the embedding model after it
 * has demonstrably reloaded, before the load is called failed. Every model in
 * a .kcpps is loaded before the listener comes back up (1.119 logs "Load
 * Embeddings Model OK" ahead of "Starting Kobold API"), so the first answer
 * after a reload is already the final one; this only absorbs the old
 * listener's last second.
 */
const EMBEDDING_MISSING_GRACE_MS = 15_000

/**
 * The embedding model did not come back from a reload. Its own class so a load
 * that only CARRIED the embedding model (a chat swap) can be told apart from
 * one that asked for it — see ensureModelLoaded.
 */
class EmbeddingModelMissingError extends Error {}

/**
 * Wait for the embedding model to finish loading.
 *
 * Unlike the image wait this one knows WHICH model is resident:
 * `fetchLoadedEmbeddingModel` reads the name off a one-word embedding request.
 * The outgoing-listener trap is the text wait's — when the expected model was
 * already reported resident, something has to change first — unless
 * `listenerUp`, which says an earlier wait in this same load already saw the
 * reload through: one process, one restart, every slot back at once.
 *
 * The one failure it does not wait out: once a reload has been seen, a
 * koboldcpp that keeps answering with no (or another) embedding model has come
 * back without it — a file it could not load sends it to its launch config —
 * and waiting the full budget for a model that is not coming would hold the
 * chat model's load hostage to it.
 */
async function waitForEmbeddingModelReady(
	baseUrl: string,
	expectedFile: string,
	opts: {
		alreadyReportedResident: boolean
		listenerUp: boolean
		signal?: AbortSignal
		isAlive?: () => boolean
	}
): Promise<void> {
	const expected = normalizeModelName(expectedFile)
	const startedAt = Date.now()
	let sawSomethingChange = opts.listenerUp || !opts.alreadyReportedResident
	let reloadSeen = opts.listenerUp
	let wrongSince: number | null = null
	await pollUntilReady(
		async () => {
			const { name, determined } =
				await fetchLoadedEmbeddingModel(baseUrl)
			if (!determined) {
				// Down, or busy: either way the reload is under way.
				sawSomethingChange = true
				reloadSeen = true
				wrongSince = null
				return "not-ready"
			}
			if (!name || normalizeModelName(name) !== expected) {
				sawSomethingChange = true
				// The outgoing process HAD it, so an answer without it can
				// only come from the new one.
				if (opts.alreadyReportedResident) reloadSeen = true
				if (reloadSeen) {
					wrongSince ??= Date.now()
					if (Date.now() - wrongSince >= EMBEDDING_MISSING_GRACE_MS) {
						throw new EmbeddingModelMissingError(
							`The embedding model "${expectedFile}" did not load — koboldcpp came back ${name ? `with "${name}"` : "without one"}.`
						)
					}
				}
				return "not-ready"
			}
			if (sawSomethingChange) return "ready"
			if (Date.now() - startedAt >= TEXT_RELOAD_SETTLE_MS) {
				console.log(
					`[KoboldCPP] embedding model "${expectedFile}": koboldcpp has answered with it without interruption since the reload, so the load window was missed rather than still running — treating it as loaded`
				)
				return "ready"
			}
			return "not-ready"
		},
		{
			signal: opts.signal,
			isAlive: opts.isAlive,
			intervalMs: sawSomethingChange ? 2000 : 500,
			refusedGraceMs: EXTERNAL_REFUSAL_GRACE_MS,
			hardTimeoutMs: opts.isAlive ? 30 * 60_000 : 600_000,
			label: `embedding model "${expectedFile}"`,
			onTick: (elapsed) =>
				console.log(
					`[KoboldCPP] still waiting for embedding model "${expectedFile}" to finish loading… (${Math.round(elapsed / 1000)}s)`
				)
		}
	)
}

/**
 * The .kcpps koboldcpp will be told to load.
 *
 * Three independently gated blocks. None implies another. Text and image
 * together is expressible — {@link planResidency} is simply the only thing that
 * never produces it today — and embeddings rides beside either, or alone.
 *
 * Every key here must be written into the FILE rather than passed as a spawn
 * arg. koboldcpp's admin reload_config handler resets every non-protected arg
 * to its argparse default before reapplying whatever keys the .kcpps contains
 * (confirmed by reading koboldcpp.py's reload path: the final branch always runs
 * reload_from_new_args(defaultargs) first). Neither `jinja` nor `sdmodel` is in
 * koboldcpp's protected-args list, so a spawn-time-only flag survives right up
 * until the first model load through this path and is then silently wiped.
 * The embeddings keys are the sharpest case of it: a chat-model swap that left
 * `embeddingsmodel` out would unload the embedding model, so it is in every
 * file whose plan carries one.
 *
 * Exported alongside {@link planResidency} so a test can hand it a two-entry
 * plan directly. "Co-loading is one function away" is a claim worth checking
 * rather than asserting — nothing in production builds such a plan today.
 */
export function buildConfigContent(plan: Residency): Record<string, unknown> {
	return {
		...(plan.text
			? {
					model: [plan.text.path],
					gpulayers: plan.text.gpuLayers,
					contextsize: plan.text.contextSize,
					flashattention: plan.text.flashAttention,
					batchsize: plan.text.batchSize,
					// `--mmproj [filename]`, a plain string (default ''), and not
					// in reload_config's protected args — so it is written here
					// on every load or the reload resets it to none (verified
					// against koboldcpp.py, 2026-10-02).
					...(plan.text.mmprojPath
						? { mmproj: plan.text.mmprojPath }
						: {})
				}
			: {
					// No `model`, no `model_param`, and none of the text knobs —
					// an image- or embeddings-only load has no context size to
					// state and must
					// not state one, or it would disagree with whatever the next
					// text load asks for and force an extra reload. `nomodel` is
					// belt and braces on top of the omission, since it is the
					// documented arg the process already spawns with. Verified
					// against the real binary: reload_config accepts this and
					// comes up with txt2img on and llm off.
					nomodel: true
				}),
		// See subprocessManager.ts's --jinja comment for what this enables.
		jinja: true,
		...(plan.image
			? {
					// A bare STRING, unlike `model` above. `--model` is nargs='+'
					// so it arrives as a list; `--sdmodel` is a plain string with
					// default '' (confirmed against a .kcpps written by
					// koboldcpp's own GUI, where `sdmodel` is `""` while `sdlora`
					// and friends are lists). reload_from_new_args setattrs
					// whatever JSON value it finds with no coercion at all, and
					// the loader then hands it to os.path.abspath() — which turns
					// a one-element list into the literal "['/path']" and then
					// can't find it.
					sdmodel: plan.image.path,
					...(plan.image.threads
						? { sdthreads: plan.image.threads }
						: {}),
					// 0 is koboldcpp's own default (no quantisation), so a falsy
					// check omitting it says exactly the same thing as sending it.
					...(plan.image.quant ? { sdquant: plan.image.quant } : {})
				}
			: {}),
		...(plan.embeddings
			? {
					// A bare string, like `sdmodel` (argparse default ''), and
					// verified on 1.119: with `nomodel` and nothing else, this
					// loads the embedding model alone and reports
					// `embeddings: true`, `llm: false`.
					embeddingsmodel: plan.embeddings.path,
					...(plan.embeddings.contextSize
						? { embeddingsmaxctx: plan.embeddings.contextSize }
						: {}),
					...(plan.embeddings.gpu ? { embeddingsgpu: true } : {})
				}
			: {})
	}
}

/**
 * Make the model this request names resident, reloading only when it is not.
 *
 * Resolves `true` when it loaded (a reload was written and waited out), and
 * `false` when what was already resident served the request — the common case,
 * and on the embedding lane a once-per-batch one, so a caller logs the load
 * and stays quiet about the rest.
 */
export async function ensureModelLoaded(opts: {
	connectionId: number
	/** The ONE model this connection needs. What ends up resident alongside it
	 * is planResidency's decision, not the caller's. */
	request: ManagedModelRequest
	baseUrl: string
	adminDir: string
	adminPassword: string
	ttlSecs: number
	signal?: AbortSignal
	/** Ground-truth "is the koboldcpp process we spawned still alive"
	 * check — only available when the caller owns the subprocess (managed
	 * mode). When given, waits described below are gated on this rather
	 * than a fixed timeout, so a huge model on slow hardware isn't cut off
	 * just because it's slower than whatever number was guessed here. */
	isAlive?: () => boolean
}): Promise<boolean> {
	const {
		connectionId,
		request,
		baseUrl,
		adminDir,
		adminPassword,
		ttlSecs,
		signal,
		isAlive
	} = opts

	// A previous caller's load may still be in flight. Wait for it, but don't
	// hang forever if that caller was cancelled and its own fetch is still
	// winding down — race our own cancellation against it too.
	if (shared.loadingPromise) {
		if (signal) {
			await Promise.race([
				shared.loadingPromise.catch(() => {}),
				new Promise<void>((_, reject) => {
					if (signal.aborted) reject(signal.reason)
					else
						signal.addEventListener(
							"abort",
							() => reject(signal.reason),
							{ once: true }
						)
				})
			])
			signal.throwIfAborted()
		} else {
			await shared.loadingPromise.catch(() => {})
		}
	}

	const current = shared.loadedSignature?.resident ?? {}
	const plan = planResidency(
		request,
		current,
		request.kind === "embeddings" ? null : await standingEmbeddingModel()
	)

	// Ask koboldcpp about the kind this REQUEST names, and only that one — a
	// slot the plan merely carries along was verified when it was loaded, and
	// is asked about below only if a reload follows. An image-only plan must
	// NEVER touch /api/v1/model: that endpoint reports the TEXT model, and with
	// an image-only load it answers the literal string "inactive" — definitive,
	// and never equal to any expected filename — so a wait on it would sit for
	// the full 30-minute isAlive budget on every single render.
	let textStatus =
		request.kind === "text" ? await fetchCurrentModelStatus(baseUrl) : null
	let imageStatus: ImageModelStatus | null =
		request.kind === "image" ? await fetchImageModelStatus(baseUrl) : null
	let embeddingStatus: LoadedModel | null =
		request.kind === "embeddings"
			? await fetchLoadedEmbeddingModel(baseUrl)
			: null

	let verdict: Verdict
	if (request.kind === "text") {
		const loaded = textStatus!.modelName
			? normalizeModelName(textStatus!.modelName)
			: null
		verdict = !textStatus!.determined
			? "unknown"
			: loaded === normalizeModelName(request.file)
				? "confirmed"
				: "contradicted"
	} else if (request.kind === "image") {
		// "confirmed" is weaker here than on the text side: txt2img says AN
		// image model is resident, not which. Identity comes solely from our own
		// record, which is why a verdict is only ever consulted alongside
		// residencyMatches() and never on its own.
		verdict = !imageStatus!.determined
			? "unknown"
			: imageStatus!.present
				? "confirmed"
				: "contradicted"
	} else {
		verdict = !embeddingStatus!.determined
			? "unknown"
			: embeddingStatus!.name &&
				  normalizeModelName(embeddingStatus!.name) ===
						normalizeModelName(request.file)
				? "confirmed"
				: "contradicted"
	}

	const recordMatches = residencyMatches(current, plan)

	// Skipping the reload hinges on our own record either way. The case where
	// koboldcpp could not be asked is the load-bearing one: while a big model is
	// loading, or while a long generation holds its single worker, its status
	// endpoints simply do not answer
	// in time. Treating that silence as "the wrong model is loaded" makes us
	// reload — which aborts the in-flight load and guarantees the next probe is
	// also unanswered. That is a livelock, and it cost a 15-minute graph build
	// that produced nothing (39 reloads, 2 completed generations). If we cannot
	// ask, but our own record says we already loaded exactly this, believe the
	// record; a genuinely wrong model surfaces as a failed generation, which is
	// recoverable, whereas the reload loop is not. An image load blocks that
	// same single worker for minutes in exactly the same way, so the image half
	// mirrors this rather than merely inheriting it.
	if (recordMatches && verdict !== "contradicted") {
		if (verdict === "unknown") {
			console.log(
				`[KoboldCPP] model status unavailable (busy loading or generating); trusting the in-process record for "${request.file}" instead of forcing a reload`
			)
		}
		resetTtl(baseUrl, adminPassword, ttlSecs)
		return false
	}

	// A reload follows. Each readiness wait below needs what koboldcpp said
	// about ITS kind beforehand, so the kinds the request did not name are
	// asked now — once per reload, not once per request.
	if (plan.text && !textStatus)
		textStatus = await fetchCurrentModelStatus(baseUrl)
	if (plan.image && !imageStatus)
		imageStatus = await fetchImageModelStatus(baseUrl)
	if (plan.embeddings && !embeddingStatus)
		embeddingStatus = await fetchLoadedEmbeddingModel(baseUrl)

	// Whether koboldcpp itself said the requested text model was resident
	// before we asked for a reload — the outgoing listener will keep saying
	// so for a moment after the reload has begun, which is why the wait
	// below must first see that answer change before believing it.
	const textAlreadyReportedResident =
		!!plan.text &&
		!!textStatus?.determined &&
		!!textStatus.modelName &&
		normalizeModelName(textStatus.modelName) ===
			normalizeModelName(plan.text.file)
	const embeddingAlreadyReportedResident =
		!!plan.embeddings &&
		!!embeddingStatus?.determined &&
		!!embeddingStatus.name &&
		normalizeModelName(embeddingStatus.name) ===
			normalizeModelName(plan.embeddings.file)

	// koboldcpp's admin reload_config only accepts .kcpps files that live inside
	// its --admindir (validated against a jailed allowlist), referenced by a path
	// relative to that directory — an absolute /tmp path is silently rejected.
	// The KIND is in the name so a text and an image model that happen to share a
	// basename cannot overwrite each other's config inside that one directory.
	const configFilename = `serene_${request.kind}_${path
		.basename(request.file)
		.replace(MODEL_EXTENSION_RE, "")}.kcpps`
	const configJson = JSON.stringify(buildConfigContent(plan), null, 2)

	console.log(
		`[KoboldCPP] loading ${request.kind} model "${request.file}" for connection`,
		connectionId,
		plan.embeddings && request.kind !== "embeddings"
			? `(keeping embedding model "${plan.embeddings.file}")`
			: ""
	)

	shared.loadingPromise = (async () => {
		await fsPromises.writeFile(
			path.join(adminDir, configFilename),
			configJson
		)

		// koboldcpp's admin API can briefly stop accepting connections while
		// swapping models internally (a prior load winding down, or its own
		// reload machinery restarting the listener) — a request landing in
		// that exact window gets a raw ECONNREFUSED with no HTTP response at
		// all. Retry through that exact same way the readiness waits below
		// tolerate it: trust isAlive when we have it, otherwise a bounded
		// consecutive-refusal count.
		let data: any
		await pollUntilReady(
			async () => {
				const timeoutSignal = AbortSignal.timeout(600_000)
				let resp: Response
				try {
					resp = await fetch(`${baseUrl}/api/admin/reload_config`, {
						method: "POST",
						headers: {
							"Content-Type": "application/json",
							Authorization: `Bearer ${adminPassword}`
						},
						body: JSON.stringify({ filename: configFilename }),
						signal: signal
							? AbortSignal.any([signal, timeoutSignal])
							: timeoutSignal
					})
				} catch (err) {
					const cause = (err as { cause?: { code?: string } })?.cause
					if (cause?.code === "ECONNREFUSED") return "refused"
					throw err
				}
				if (!resp.ok) {
					const text = await resp.text().catch(() => "")
					throw new Error(
						`reload_config failed: ${resp.status} ${text}`
					)
				}
				data = await resp.json().catch(() => ({}))
				return "ready"
			},
			{
				signal,
				isAlive,
				refusedGraceMs: EXTERNAL_REFUSAL_GRACE_MS,
				hardTimeoutMs: isAlive ? 30 * 60_000 : 60_000,
				label: "reload_config request"
			}
		)
		if (!data.success) {
			throw new Error(
				"reload_config rejected the request (success: false)"
			)
		}

		// One wait per kind the plan names. Embeddings goes first: it is the
		// one wait that can tell "koboldcpp came back without it" from "still
		// loading", and a file it cannot load sends koboldcpp to its launch
		// config with NOTHING loaded — a text wait run first would sit out its
		// whole budget for a chat model that is not coming back either. Each
		// wait after the first knows the new process is already up.
		let listenerUp = false
		if (plan.embeddings) {
			await waitForEmbeddingModelReady(baseUrl, plan.embeddings.file, {
				alreadyReportedResident: embeddingAlreadyReportedResident,
				listenerUp,
				signal,
				isAlive
			})
			listenerUp = true
		}
		if (plan.text) {
			await waitForModelReady(
				baseUrl,
				plan.text.file,
				textAlreadyReportedResident && !listenerUp,
				signal,
				isAlive
			)
			listenerUp = true
		}
		if (plan.image) {
			await waitForImageModelReady(
				baseUrl,
				plan.image.file,
				listenerUp ||
					(imageStatus!.determined && !imageStatus!.present),
				signal,
				isAlive
			)
		}
	})()

	try {
		await shared.loadingPromise
	} catch (err) {
		// A load that only CARRIED the embedding model failed because of it:
		// drop it as standing, so the preflight's next attempt loads the chat
		// (or image) model alone instead of failing the same way again.
		if (
			err instanceof EmbeddingModelMissingError &&
			request.kind !== "embeddings"
		) {
			console.warn(
				`[KoboldCPP] ${err.message} Dropping it, so the ${request.kind} model loads without it.`
			)
			shared.embeddingModel = null
		}
		throw err
	} finally {
		shared.loadingPromise = null
	}

	shared.loadedSignature = { resident: plan, rawConfigJson: configJson }
	// Standing only once it has loaded: a model that cannot load must never
	// ride along into the next chat load.
	if (request.kind === "embeddings") shared.embeddingModel = plan.embeddings!
	resetTtl(baseUrl, adminPassword, ttlSecs)
	return true
}

export async function unloadModel(
	baseUrl: string,
	adminPassword: string
): Promise<boolean> {
	try {
		// There is no dedicated unload endpoint — koboldcpp's admin API treats the
		// literal filename "unload_model" as a special reload_config target.
		const resp = await fetch(`${baseUrl}/api/admin/reload_config`, {
			method: "POST",
			headers: {
				"Content-Type": "application/json",
				Authorization: `Bearer ${adminPassword}`
			},
			body: JSON.stringify({ filename: "unload_model" }),
			signal: AbortSignal.timeout(10_000)
		})
		if (!resp.ok) return false
		const data = await resp.json().catch(() => ({}))
		if (data.success) {
			shared.loadedSignature = null
		}
		return !!data.success
	} catch {
		return false
	}
}

export function resetTtl(
	baseUrl: string,
	adminPassword: string,
	ttlSecs: number
) {
	clearTtl(baseUrl)
	if (ttlSecs <= 0) return
	ttlTimers[baseUrl] = setTimeout(() => {
		delete ttlTimers[baseUrl]
		unloadModel(baseUrl, adminPassword).catch(() => {})
	}, ttlSecs * 1000)
}

export function clearTtl(baseUrl: string) {
	if (ttlTimers[baseUrl]) {
		clearTimeout(ttlTimers[baseUrl])
		delete ttlTimers[baseUrl]
	}
}

export function clearAllTtls() {
	for (const url of Object.keys(ttlTimers)) {
		clearTimeout(ttlTimers[url])
		delete ttlTimers[url]
	}
}
