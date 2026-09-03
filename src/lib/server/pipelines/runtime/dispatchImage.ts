/**
 * One prompt, one render, references back.
 *
 * The image twin of `dispatchStep`, and deliberately its shape: resolve the
 * connection and the sampling config from the ids a node handed over, build the
 * request, call the adapter, return something the graph can carry.
 *
 * ## What the binding never sees
 *
 * The connection row, its URL, its key. A provider binding hands over an *id* and
 * gets media references back; resolving that id to credentials happens here, in
 * the substrate. Same line `dispatchStep` and `dispatch` draw, and for the same
 * reason: a node that could read a connection could exfiltrate one.
 *
 * ## Why the result is references, not bytes
 *
 * The bytes are written to the media store here and only the uuid travels on
 * (media.ts: "a reference, never bytes"). A base64 string moving through the
 * graph would be copied into the review payload, the receipt and every node
 * between here and the write — megabytes each — and would leave the image
 * existing nowhere if the run were abandoned. Storing first means the image
 * exists the moment it is rendered, and the consumer that posts it is doing a
 * cheap row lookup.
 *
 * ## The queue
 *
 * Not `llmQueue` — that one is text-shaped (token budgets, a taskType vocabulary
 * about summarizing) and shared with generation, so an image render would sit in
 * a queue with replies. Instead one render at a time PER SERVER, because the
 * backends genuinely cannot do better: A1111 and KoboldCPP report progress
 * globally, so two concurrent renders on one server produce interleaved progress
 * neither caller can interpret, and their interrupt endpoints are global too, so a
 * cancel would hit whichever render happened to be running.
 *
 * Per SERVER, keyed on the base URL, and not per connection ROW — the two look
 * identical until they aren't. "Globally" above is a property of the process at
 * the other end, and nothing stops two rows pointing at one process: a KoboldCPP
 * reached as a text connection and as an image connection is exactly that, and it
 * is the configuration this milestone targets. Keyed by row id, those two get a
 * queue slot each, render concurrently on one server, and land in precisely the
 * interleaved-progress and stray-cancel state this queue exists to prevent.
 */

import { eq } from "drizzle-orm"
import * as schema from "$lib/server/db/schema"
import { capabilityDefault } from "$lib/server/connections/capabilityDefaults"
import { capabilityRefusal } from "./capabilityGuard"
import { getImageAdapter } from "$lib/server/utils/getImageAdapter"
import { normalizeBaseUrl } from "$lib/shared/utils/normalizeBaseUrl"
import { CONNECTION_TYPE } from "$lib/shared/constants/ConnectionTypes"
import { createMedia } from "$lib/server/media"
import { decryptApiKeyField } from "$lib/server/utils/tokenCrypto"
import { buildImageRequest } from "$lib/server/imageGen/buildRequest"
import {
	CORE_TEMPLATE_ENGINE,
	renderTemplate
} from "$lib/server/pipelines/prompt/renderers"
import type { ImageGenProgress } from "$lib/shared/imageGen/types"
import type { MediaRef } from "@serene-pub/sdk"

export interface ImageCall {
	/** The text the node was given — what the prompt templates interpolate. */
	prompt: string
	negative?: string
	/**
	 * The node's `prompts` slot: templates over `{prompt, negative}`. Absent
	 * fields fall back to passing the text through unchanged, which is what an
	 * unconfigured node should do rather than render nothing.
	 */
	prompts?: { positive?: string; negative?: string } | null
	/** The `connection` slot's resolved value — a `connections` row id. */
	connectionId?: number | null
	/** The `sampling` slot's resolved value — a `sampling_configs` row id. */
	samplingId?: number | null
	sessionId?: number | null
	userId?: number | null
	signal?: AbortSignal
	onProgress?: (p: ImageGenProgress) => void
}

export interface ImageCallResult {
	media: MediaRef[]
	image: MediaRef | null
	/** The rendered positive prompt — what a message posting this usually says. */
	caption: string
	applied: string[]
	ignored: string[]
	isAborted: boolean
}

export class ImageDispatchError extends Error {}

/**
 * One render at a time per server.
 *
 * A promise chain rather than a counting semaphore because the limit is exactly
 * one and the queue is short; anything more would be machinery for a case that
 * does not exist yet.
 */
const perServer = new Map<string, Promise<unknown>>()

/**
 * The queue key: the backend at the other end, not the row that named it.
 *
 * A row with no base URL falls back to its own id so two unconfigured rows do
 * not serialize against each other for no reason.
 */
const serverKey = (connection: { id: number; baseUrl?: string | null }) =>
	normalizeBaseUrl(connection.baseUrl) || `connection:${connection.id}`

/**
 * A whole number a person typed, or nothing.
 *
 * `extraJson.profile` is form state, and `SchemaForm`'s number control stores
 * `e.currentTarget.value` back UNCOERCED — so a threads field somebody touched
 * holds the string "7". That string would be written verbatim into the .kcpps
 * and handed to koboldcpp's ctypes int, which fails inside the loader rather
 * than at the point it was set. Anything that is not a positive whole number is
 * dropped rather than repaired: absent means "koboldcpp decides", which is a
 * safe answer, where a guessed one is a number nobody chose.
 */
function threadsFrom(value: unknown): number | undefined {
	if (value === undefined || value === null || value === "") return undefined
	const n = Number(value)
	return Number.isInteger(n) && n > 0 ? n : undefined
}

/**
 * Make sure the KoboldCPP Manager is up with THIS connection's image model.
 *
 * The text path has always done this — the managed adapter's preflight starts
 * the subprocess if the Manager owns one, waits out a slow load, and retries.
 * The image path had no equivalent, so rendering on a cold managed instance
 * failed with a bare connection error pointing at the image adapter, which is
 * the wrong file to go looking in.
 *
 * The same mechanism rather than a second one — same `ensureManagedReady`, same
 * `reload_config`, same baseUrl-keyed TTL — but it is now two questions with two
 * answers rather than one. A connection names exactly one model; a managed text
 * row names a text GGUF and this one names an image model. Which of them is
 * RESIDENT is neither row's business: the model manager decides that, and while
 * its answer is "one at a time" a render here evicts the chat model and the next
 * message reloads it. That is why the `loading` stage is announced before the
 * call and not after — the swap is minutes, not moments, and a progress bar that
 * jumps straight to "sampling" makes it look like a hang.
 *
 * Only for the managed image type. An external KoboldCPP, an A1111, a Forge —
 * nobody asked this app to start those, and trying would be a surprise.
 */
async function ensureManagedInstanceReady(
	connection: SelectConnection,
	opts: {
		signal?: AbortSignal
		onProgress?: (p: ImageGenProgress) => void
	}
): Promise<void> {
	if (connection.type !== CONNECTION_TYPE.KOBOLDCPP_MANAGED_IMAGE) return
	// Ahead of the loader's own "No model selected", because that sentence has no
	// idea which of possibly several connections sent it, and because a row
	// pointing at nothing is not worth a spawn and two retries.
	if (!connection.model)
		throw new ImageDispatchError(
			`"${connection.name}" has no image model selected. Pick one in its connection settings, or use "Use for image generation" in the KoboldCPP Manager.`
		)

	// Dynamically imported for the reason the adapter loaders document: these
	// modules are heavy, and one of them cannot be loaded on Android at all.
	const [{ ensureManagedReady }, { sdQuantToInt }] = await Promise.all([
		import("$lib/server/koboldcpp/managedPreflight"),
		import("$lib/server/imageAdapters/KoboldCppManagedImageAdapter")
	])

	// A SPEC, not a path: which directory a bare filename lives in is a
	// two-column question with a fallback for installs that predate the second
	// one, and `managedPreflight` answers it once for both kinds of managed
	// connection so a caller cannot get it wrong.
	//
	// Built from NAMED fields, never by spreading `extraJson`. An upgraded row
	// can still be carrying an `sdModelFile` (or a whole `managedConfig`) from
	// the design where one connection held two models, and a spread would hand
	// those straight back to the loader and re-create exactly what this replaced.
	const profile = (connection.extraJson as any)?.profile ?? {}
	const threads = threadsFrom(profile.sdThreads)
	const quant = sdQuantToInt(profile.sdQuant)

	opts.onProgress?.({
		stage: "loading",
		percent: 0,
		message: `Loading image model "${connection.model}"…`
	})

	await ensureManagedReady(
		{
			kind: "image",
			file: connection.model,
			...(threads !== undefined ? { threads } : {}),
			...(quant !== undefined ? { quant } : {})
		},
		{ connectionId: connection.id, signal: opts.signal }
	)
}

/**
 * Re-arm the managed instance's idle-unload timer after a render.
 *
 * Only for a managed connection — nobody else's server has a timer of ours
 * pointed at it. Never throws: this is housekeeping after the work is done, and
 * a failure here must not turn a finished render into a failed one.
 */
async function touchManagedTtl(
	db: any,
	connection: SelectConnection
): Promise<void> {
	if (connection.type !== CONNECTION_TYPE.KOBOLDCPP_MANAGED_IMAGE) return
	try {
		const [{ resetTtl, getLoadedSignature }, subprocessManager] =
			await Promise.all([
				import("$lib/server/koboldcpp/modelManager"),
				import("$lib/server/koboldcpp/subprocessManager")
			])
		const settings = await db.query.koboldCppSettings.findFirst()
		if (!settings) return
		// Conditioned on liveness, the same way the text path is: if the timer
		// already fired, or the subprocess died, re-arming would advertise a
		// model that is not there and mask the real state from the next load.
		const isAlive =
			settings.koboldCppManagedMode === "managed" &&
			!subprocessManager.isExternal()
				? subprocessManager.isRunning()
				: true
		if (!isAlive || !getLoadedSignature()) return
		resetTtl(
			settings.koboldCppManagerBaseUrl,
			settings.koboldCppManagedAdminPassword ?? "",
			settings.koboldCppManagedModelTtlSecs ?? 300
		)
	} catch {
		// Housekeeping only.
	}
}

/**
 * Where a managed connection's koboldcpp actually is.
 *
 * A managed row's own `baseUrl` is not authoritative and is not kept in sync —
 * the managed text adapter overwrites it from the Manager's settings on every
 * preflight, neither managed connection form treats it as more than a display
 * value, and changing the managed port updates only `koboldcpp_settings`. The
 * text path never notices, because that overwrite happens on the instance it is
 * about to generate with.
 *
 * The image path would notice: it builds its own adapter from the stored row,
 * so a port changed after the connection was created would send renders at the
 * old one and fail with a connection error pointing at the image adapter. The
 * queue key is derived from this too, so a stale value would also split one
 * process into two queues — which is exactly the case that matters here, since
 * the managed text connection and the managed image connection ARE one process.
 */
async function resolveBaseUrl(
	db: any,
	connection: SelectConnection
): Promise<string> {
	if (connection.type !== CONNECTION_TYPE.KOBOLDCPP_MANAGED_IMAGE)
		return connection.baseUrl ?? ""
	const settings = await db.query.koboldCppSettings.findFirst()
	return settings?.koboldCppManagerBaseUrl ?? connection.baseUrl ?? ""
}

function serialize<T>(key: string, work: () => Promise<T>): Promise<T> {
	const prior = perServer.get(key) ?? Promise.resolve()
	// `.catch` so one failed render does not poison the queue for the next.
	const next = prior.then(work, work)
	perServer.set(
		key,
		next.catch(() => {})
	)
	return next
}

async function resolveTarget(
	db: any,
	connectionId?: number | null,
	samplingId?: number | null
) {
	// The default registered for THIS capability, never the text one: a text
	// connection here would be handed to `getImageAdapter`, and a text sampling
	// config would have every key dropped by the resolver and render at backend
	// defaults with no error. One row per capability rather than a column pair on
	// `system_settings`, which is where these two used to live (0175).
	const fallback = await capabilityDefault(db, "text->image")

	const connId = connectionId ?? fallback?.connectionId
	const sampId = samplingId ?? fallback?.samplingConfigId

	const [connection] = connId
		? await db
				.select()
				.from(schema.connections)
				.where(eq(schema.connections.id, connId))
				.limit(1)
		: []

	const [sampling] = sampId
		? await db
				.select()
				.from(schema.samplingConfigs)
				.where(eq(schema.samplingConfigs.id, sampId))
				.limit(1)
		: []

	return { connection, sampling }
}

/** Render one image request. Throws with a sentence a person can act on. */
export async function dispatchImage(
	db: any,
	call: ImageCall
): Promise<ImageCallResult> {
	call.signal?.throwIfAborted()

	const { connection, sampling } = await resolveTarget(
		db,
		call.connectionId,
		call.samplingId
	)

	if (!connection)
		throw new ImageDispatchError(
			"no image connection is set for this step and the instance has no " +
				"default image connection either. Choose one in the pipeline's " +
				"configuration, or set an instance default in Connections → Image."
		)
	// What the connection can do, not what kind of connection it is. A plain
	// `koboldcpp` row is tagged text-gen and draws perfectly well when the
	// instance behind it was started with --sdmodel — this app neither started
	// it nor manages what it holds, so its probe is the authority and the type
	// alone would put it in the wrong family.
	const refusal = capabilityRefusal(connection, "text->image")
	if (refusal) throw new ImageDispatchError(refusal)

	// The prompts slot is a pair of templates over the incoming text. An
	// unconfigured node passes the text straight through — rendering nothing at
	// all would be a blank prompt, which is the failure that looks like the
	// backend misbehaving.
	const vars = { prompt: call.prompt ?? "", negative: call.negative ?? "" }
	const positive = await render(call.prompts?.positive, vars, vars.prompt)
	const negative = await render(call.prompts?.negative, vars, vars.negative)

	if (!positive.trim())
		throw new ImageDispatchError(
			"the prompt came out empty — there is nothing to render."
		)

	const req = buildImageRequest({
		prompt: positive,
		negativePrompt: negative || undefined,
		sampling,
		connection
	})

	// The stored apiKey is encrypted at rest (tokenCrypto.ts) — decrypted into
	// the adapter's copy only, never persisted and never returned.
	const conn =
		connection.extraJson &&
		typeof (connection.extraJson as any).apiKey === "string"
			? {
					...connection,
					extraJson: {
						...connection.extraJson,
						apiKey:
							decryptApiKeyField(
								(connection.extraJson as any).apiKey
							) ?? ""
					}
				}
			: connection

	// For a managed connection this is the Manager's address, not the row's —
	// see resolveBaseUrl. Applied to the adapter's copy AND to the queue key, so
	// two rows on one process still serialize against each other.
	const baseUrl = await resolveBaseUrl(db, connection)
	const target = { ...conn, baseUrl }

	const result = await serialize(serverKey(target), async () => {
		call.signal?.throwIfAborted()
		// Inside the queue, deliberately: this can START a subprocess and load a
		// model, which is the slowest thing that happens here, and pairing it
		// with the render keeps two IMAGE renders from interleaving a load and a
		// draw.
		//
		// ⚠ What this queue does NOT do is keep a text generation out. `perServer`
		// holds image renders only; nothing makes the text path wait on it, and
		// `modelManager`'s own lock serializes loads against each other rather
		// than against an in-flight render. So with one model resident at a time,
		// a chat message sent during a render can still swap the model out from
		// under it. Closing that properly means one critical section per backend
		// shared by both paths, which is a change to the loader and not to this
		// file — recorded here rather than papered over, because the comment that
		// used to sit here claimed the window was closed and it never was.
		await ensureManagedInstanceReady(connection, {
			signal: call.signal,
			onProgress: call.onProgress
		})
		const { Adapter } = await getImageAdapter(connection.type)
		const adapter = new Adapter(target as any)
		try {
			return await adapter.generate(req, {
				signal: call.signal,
				onProgress: call.onProgress
			})
		} finally {
			// Push the unload timer back, exactly as the TEXT path does after a
			// generation (KoboldCppManagedAdapter.generate).
			//
			// The timer is armed at LOAD time and the default is 300s, but a
			// render is routinely longer than that — SDXL on CPU, or any batch.
			// Without this, our own timer POSTs `unload_model` to koboldcpp
			// while `/sdapi/v1/txt2img` is still running, and the symptom is a
			// render that dies partway through for no reason the user can see.
			//
			// In a `finally` because a failed or cancelled render leaves the
			// model just as resident as a successful one, and the next attempt
			// should not pay for a reload it did not cause.
			await touchManagedTtl(db, connection)
		}
	})

	if (result.isAborted)
		return {
			media: [],
			image: null,
			caption: positive,
			applied: result.applied,
			ignored: result.ignored,
			isAborted: true
		}

	if (!result.media.length)
		throw new ImageDispatchError(
			`"${connection.name}" completed without returning an image.`
		)

	const refs: MediaRef[] = []
	for (const item of result.media) {
		const bytes = Buffer.from(item.base64, "base64")
		const row = await createMedia(db, {
			userId: call.userId ?? 0,
			bytes,
			filename: `generated.${extFor(item.mime)}`,
			...(call.sessionId != null
				? { sessionId: call.sessionId }
				: { bucket: "generated" }),
			// Written once at generation, never interpreted — the answer to "how
			// do I get another one like this".
			meta: {
				prompt: positive,
				...(negative ? { negativePrompt: negative } : {}),
				...(item.seed !== undefined ? { seed: item.seed } : {}),
				...(req.model ? { model: req.model } : {}),
				backend: connection.type,
				connectionName: connection.name,
				...(sampling ? { samplingConfig: sampling.name } : {}),
				request: req,
				applied: result.applied,
				ignored: result.ignored,
				...(item.meta ?? {})
			}
		})
		refs.push({
			uuid: row.uuid,
			kind: row.kind as MediaRef["kind"],
			mime: row.mime,
			bytes: row.bytes,
			...(row.width != null ? { width: row.width } : {}),
			...(row.height != null ? { height: row.height } : {}),
			...(row.filename ? { filename: row.filename } : {}),
			// Alt text, so a downgrade to a text-only consumer has something to
			// say instead of nothing (media.ts) — and so the posted message's
			// image is described rather than announced as an untitled attachment.
			text: positive
		})
	}

	return {
		media: refs,
		image: refs[0] ?? null,
		caption: positive,
		applied: result.applied,
		ignored: result.ignored,
		isAborted: false
	}
}

/**
 * A prompts-slot template, or the raw text when there is no template.
 *
 * A template that renders to nothing is treated as absent rather than as an
 * instruction to send an empty prompt — the two are indistinguishable from the
 * author's side and only one of them is ever what was meant.
 */
async function render(
	source: string | undefined | null,
	variables: Record<string, unknown>,
	fallback: string
): Promise<string> {
	if (!source || !source.trim()) return fallback
	// The core engine: a prompts slot declares no engine of its own, and the one
	// core renders is what every seeded template is written in.
	const out = await renderTemplate(CORE_TEMPLATE_ENGINE, {
		template: source,
		variables
	})
	return out.trim() ? out : fallback
}

const EXT_BY_MIME: Record<string, string> = {
	"image/png": "png",
	"image/jpeg": "jpg",
	"image/webp": "webp",
	"image/gif": "gif",
	"video/mp4": "mp4",
	"video/webm": "webm"
}
const extFor = (mime: string): string => EXT_BY_MIME[mime] ?? "png"
