import * as path from "path"
import * as fsPromises from "fs/promises"
import {
	fetchCurrentModelStatus,
	fetchImageModelStatus,
	fetchModelStatusForPoll,
	type ImageModelStatus
} from "./kcppHttp"
import { CONNECTION_DEFAULTS } from "$lib/shared/utils/connectionDefaults"
import { CONNECTION_TYPE } from "$lib/shared/constants/ConnectionTypes"
import { MODEL_EXTENSION_RE } from "./modelKind"
import { pollUntilReady } from "./pollUntilReady"

/**
 * One model, named by one connection.
 *
 * A connection row names exactly ONE model and its type says which kind that is:
 * a `koboldcpp_managed` row names a text GGUF, a `koboldcpp_managed_image` row
 * names an image model. Nothing above this file asserts anything about what is
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

export type ManagedModelKind = ManagedModelRequest["kind"]

type PlannedModel<K extends ManagedModelKind> = Omit<
	Extract<ManagedModelRequest, { kind: K }>,
	"kind"
>

/** What should be (or is) resident, keyed by kind. */
export type Residency = {
	text?: PlannedModel<"text">
	image?: PlannedModel<"image">
}

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
const ttlTimers: Record<string, ReturnType<typeof setTimeout>> = {}

// Simple lock so concurrent requests don't double-load
let loadingPromise: Promise<void> | null = null

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
let loadedSignature: LoadedSignature | null = null

/**
 * What this process last loaded via ensureModelLoaded(), if anything — the
 * only source of truth for gpuLayers/flashAttention/batchSize/contextSize and
 * for WHICH image model is resident, since koboldcpp exposes none of those for
 * querying. Resets to null on server restart even if koboldcpp itself is still
 * running with a model loaded.
 */
export function getLoadedSignature(): LoadedSignature | null {
	return loadedSignature
}

/**
 * Which of the models named by connections should be resident after this load.
 *
 * TODAY: exactly one. koboldcpp CAN hold a text and an image model at once —
 * verified against the real binary, one .kcpps carrying both `model` and
 * `sdmodel` loads both and reports `llm: true` and `txt2img: true` together — so
 * co-loading is not ruled out, it is simply not what we do. That makes this a
 * SCHEDULING decision, and it is made here and nowhere else.
 *
 * To co-load, return `{ ...current, ...planEntry(req) }` and the rest of this
 * file follows unchanged: the .kcpps builder already emits both blocks
 * independently, the signature already holds both entries, and the readiness
 * wait already waits on whichever kinds the plan names. Nothing in connections,
 * the schema, the manifest, the adapters or dispatchImage knows this function
 * exists.
 *
 * The cost of today's answer, stated plainly so nobody rediscovers it as a bug:
 * chat and image CONTEND for the one slot, so a message with a picture can cost
 * two model loads. That is the accepted trade — switching models is the same as
 * it already is between two LLMs — and it is exactly what co-loading would
 * remove.
 */
export function planResidency(
	req: ManagedModelRequest,
	_current: Residency
): Residency {
	return planEntry(req)
}

/** The request as a one-key residency: everything except the discriminant. */
function planEntry(req: ManagedModelRequest): Residency {
	if (req.kind === "text") {
		const { kind: _kind, ...text } = req
		return { text }
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
function normalizeModelName(name: string): string {
	return path.basename(name).replace(MODEL_EXTENSION_RE, "")
}

/**
 * Does what is resident already satisfy the plan?
 *
 * Key-count equality plus every planned kind satisfied means the key SETS match,
 * so a plan that drops a kind (an image-only request while a text model is
 * resident, which is every alternation under today's policy) correctly reads as
 * a mismatch rather than as "close enough".
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
	return true
}

/** What koboldcpp itself says about one kind in the plan. `unknown` is "we
 * could not ask", never "the wrong thing is loaded" — see the livelock note in
 * ensureModelLoaded. */
type Verdict = "confirmed" | "contradicted" | "unknown"

async function waitForModelReady(
	baseUrl: string,
	expectedFile: string,
	signal?: AbortSignal,
	isAlive?: () => boolean
): Promise<void> {
	const expected = normalizeModelName(expectedFile)
	await pollUntilReady(
		async () => {
			const { modelName, refused } =
				await fetchModelStatusForPoll(baseUrl)
			const current = modelName ? normalizeModelName(modelName) : null
			if (current && current === expected) return "ready"
			return refused ? "refused" : "not-ready"
		},
		{
			signal,
			isAlive,
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
 * The .kcpps koboldcpp will be told to load.
 *
 * Two independently gated blocks. Neither implies the other, and both being
 * present at once is expressible — {@link planResidency} is simply the only
 * thing that never produces it today.
 *
 * Every key here must be written into the FILE rather than passed as a spawn
 * arg. koboldcpp's admin reload_config handler resets every non-protected arg
 * to its argparse default before reapplying whatever keys the .kcpps contains
 * (confirmed by reading koboldcpp.py's reload path: the final branch always runs
 * reload_from_new_args(defaultargs) first). Neither `jinja` nor `sdmodel` is in
 * koboldcpp's protected-args list, so a spawn-time-only flag survives right up
 * until the first model load through this path and is then silently wiped.
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
					batchsize: plan.text.batchSize
				}
			: {
					// No `model`, no `model_param`, and none of the text knobs —
					// an image-only load has no context size to state and must
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
			: {})
	}
}

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
}): Promise<void> {
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
	if (loadingPromise) {
		if (signal) {
			await Promise.race([
				loadingPromise.catch(() => {}),
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
			await loadingPromise.catch(() => {})
		}
	}

	const current = loadedSignature?.resident ?? {}
	const plan = planResidency(request, current)

	// Ask koboldcpp only about the kinds the plan actually names. An image-only
	// plan must NEVER touch /api/v1/model: that endpoint reports the TEXT model,
	// and with an image-only load it answers the literal string "inactive" —
	// definitive, and never equal to any expected filename — so a wait on it
	// would sit for the full 30-minute isAlive budget on every single render.
	const textStatus = plan.text ? await fetchCurrentModelStatus(baseUrl) : null
	const imageStatus: ImageModelStatus | null = plan.image
		? await fetchImageModelStatus(baseUrl)
		: null

	const verdicts: Verdict[] = []
	if (plan.text && textStatus) {
		const loaded = textStatus.modelName
			? normalizeModelName(textStatus.modelName)
			: null
		verdicts.push(
			!textStatus.determined
				? "unknown"
				: loaded === normalizeModelName(plan.text.file)
					? "confirmed"
					: "contradicted"
		)
	}
	if (plan.image && imageStatus) {
		// "confirmed" is weaker here than on the text side: txt2img says AN
		// image model is resident, not which. Identity comes solely from our own
		// record, which is why a verdict is only ever consulted alongside
		// residencyMatches() and never on its own.
		verdicts.push(
			!imageStatus.determined
				? "unknown"
				: imageStatus.present
					? "confirmed"
					: "contradicted"
		)
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
	if (recordMatches && !verdicts.includes("contradicted")) {
		if (verdicts.includes("unknown")) {
			console.log(
				`[KoboldCPP] model status unavailable (busy loading or generating); trusting the in-process record for "${request.file}" instead of forcing a reload`
			)
		}
		resetTtl(baseUrl, adminPassword, ttlSecs)
		return
	}

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
		connectionId
	)

	loadingPromise = (async () => {
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
				hardTimeoutMs: isAlive ? 30 * 60_000 : 60_000,
				label: "reload_config request"
			}
		)
		if (!data.success) {
			throw new Error(
				"reload_config rejected the request (success: false)"
			)
		}

		// One wait per kind the plan names — both, when a future policy co-loads.
		if (plan.text) {
			await waitForModelReady(baseUrl, plan.text.file, signal, isAlive)
		}
		if (plan.image) {
			await waitForImageModelReady(
				baseUrl,
				plan.image.file,
				imageStatus!.determined && !imageStatus!.present,
				signal,
				isAlive
			)
		}
	})()

	try {
		await loadingPromise
	} finally {
		loadingPromise = null
	}

	loadedSignature = { resident: plan, rawConfigJson: configJson }
	resetTtl(baseUrl, adminPassword, ttlSecs)
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
			loadedSignature = null
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
