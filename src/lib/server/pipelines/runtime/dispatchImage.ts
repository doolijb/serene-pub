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

import { resolveCapabilityTarget } from "$lib/server/connections/capabilityTarget"
import {
	ComposedError,
	connectionIdentity
} from "$lib/server/connections/visibility"
import { getImageAdapter } from "$lib/server/utils/getImageAdapter"
import { normalizeBaseUrl } from "$lib/shared/utils/normalizeBaseUrl"
import { CONNECTION_TYPE } from "$lib/shared/constants/ConnectionTypes"
import { createMedia } from "$lib/server/media"
import { decryptApiKeyField } from "$lib/server/utils/tokenCrypto"
import {
	applyOrientation,
	buildImageRequest,
	fitRequestToSheet,
	type ImageOrientation
} from "$lib/server/imageGen/buildRequest"
import {
	STANDARD_DIALS,
	workflowDialDefaults
} from "$lib/shared/imageGen/workflowShape"
import {
	mergeWorkflowValues,
	workflowValuesOf
} from "$lib/shared/loadouts/workflowValues"
import {
	assignCallMedia,
	missingKeys,
	planImageCalls,
	sanitiseSeriesKeys,
	type ImageCallPlan,
	type RenderedSeriesItem
} from "$lib/server/imageGen/packing"
import {
	judgeSheet,
	type CutOutMode,
	type ReferencesPolicy
} from "$lib/server/imageGen/sheetGuard"
import {
	CORE_TEMPLATE_ENGINE,
	renderTemplate,
	type RenderRun
} from "$lib/server/pipelines/prompt/renderers"
import type {
	GeneratedMediaItem,
	ImageGenProgress,
	ImageGenRequest,
	ImageWorkflowDocument
} from "$lib/shared/imageGen/types"
import type { StreamingMode } from "$lib/server/connections/streaming"
import type { ImageSeriesItemV1, MediaRef } from "@serene-pub/sdk"
import type { RunArtifact } from "$lib/server/pipelines/runtime/receipts"

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
	/**
	 * The MODEL half of the `connection` slot's pair (0114). Null means the
	 * endpoint's default model, which is what every slot authored before the
	 * split says and what every registration the backfill left behind means.
	 */
	connectionModelId?: number | null
	/** The `sampling` slot's resolved value — a `sampling_configs` row id. */
	samplingId?: number | null
	/**
	 * 🚧 The `workflow` slot's resolved value — a `workflows` row id
	 * (DESIGN-image-generation §4.10). Required only when the pair's drawing
	 * sheet says `payload: "template"` (ComfyUI); flat dialects ignore it.
	 */
	workflowId?: number | null
	/**
	 * The loadout's dials for that workflow (lane E2) — `workflow_values`,
	 * carried on the slot as `{ id, values }`. Layered over the workflow's
	 * defaults; ignored when the pair draws without a workflow.
	 */
	workflowValues?: Record<string, unknown> | null
	sessionId?: number | null
	userId?: number | null
	/**
	 * The run this render belongs to, when it belongs to one (`RenderRun`).
	 *
	 * Only the prompts-slot render reads it, and only so a template that names
	 * a *plugin's* engine renders as a hook call cancelling the run can find.
	 * Absent for a caller with no run — a direct dispatch, a test — which is
	 * an association that was never made rather than one that went missing.
	 */
	runId?: string
	/**
	 * The run's artifact collector, when this render belongs to a run.
	 *
	 * ⚠ **This is the only place a rendered image's row ids exist.** The node
	 * publishes `MediaRef`s — uuid, mime, dimensions — because bytes and row
	 * ids both stop here by design, so nothing downstream and nothing on the
	 * receipt can say which `files` rows the run created. Pushed at the write,
	 * read by `saveReceipt`. Absent for a direct dispatch or a test, which is
	 * an association that was never made rather than one that went missing.
	 */
	artifacts?: RunArtifact[]
	/** Which node is rendering, stamped onto the artifacts above. */
	nodeKey?: string
	signal?: AbortSignal
	onProgress?: (p: ImageGenProgress) => void
	/**
	 * How the author wants this render sent — the node's `streaming` parameter.
	 *
	 * On an image backend there is no token stream, so what `off` turns off is
	 * the PROGRESS: the poll an adapter runs beside the render and the preview
	 * frames it decodes. A background step pays for neither, which is the whole
	 * of what the parameter buys here.
	 *
	 * Absent and `auto` are the same render.
	 */
	streaming?: StreamingMode | null
	/**
	 * The `series` port: the pictures wanted, each `{ key, vars }`. Absent or
	 * empty = one item, key `"1"` — with the sampling's `batch` pictures of it,
	 * as before the series existed (DESIGN-image-generation §4.7).
	 */
	series?: ImageSeriesItemV1[] | null
	/** The `references` port: images the output should resemble. */
	references?: MediaRef[] | null
	/** The `init` port: the starting canvas. */
	init?: MediaRef | null
	/** The `mask` port: where to paint. */
	mask?: MediaRef | null
	/** The `orientation` param. Absent = `free`. */
	orientation?: ImageOrientation | null
	/** The `cutOut` param. Absent = `off`. */
	cutOut?: CutOutMode | null
	/** The `references` param. Absent = `preferred`. */
	referencesPolicy?: ReferencesPolicy | null
	/**
	 * 🚧 The `seed` param (I5): `per-run` sends one seed with every call of
	 * the step when the sampling's is random. Absent = `as-set`.
	 */
	seedPolicy?: "as-set" | "per-run" | null
	/**
	 * Told the call plan BEFORE the first adapter call, so the receipt holds
	 * it even when a call fails. The object is then filled in place — each
	 * call's `applied`/`ignored`/`returned`, and the shortfall — so a holder
	 * of the reference sees the outcome without being told twice.
	 */
	onPlan?: (plan: ImageCallPlan) => void
}

/** A media reference carrying the series key it was drawn for. */
export type KeyedMediaRef = MediaRef & { key?: string }

export interface ImageCallResult {
	/** Every picture drawn, keyed; surplus with no key context has no `key`. */
	media: KeyedMediaRef[]
	/** The first keyed picture. */
	image: KeyedMediaRef | null
	/** The first item's rendered positive prompt — what a message posting this usually says. */
	caption: string
	/** Union over the calls; each call's own is on `plan.calls`. */
	applied: string[]
	ignored: string[]
	isAborted: boolean
	/** How the series was packed, with each call's outcome. */
	plan: ImageCallPlan
	/** What the action's form should have said before the run. */
	preRunNotices: string[]
}

/**
 * A dispatch failure, and a marker: this sentence is ours.
 *
 * `ComposedError` is what tells `persistGenerationErrorRow` that the message may
 * be stored and shown to anybody — it names no connection. An adapter's own
 * error, which names the base URL and the model file, is a plain `Error` and is
 * replaced there instead. The optional second argument is the identity the
 * failure was about, carried as a field so the projection can remove it for
 * everyone who is not an administrator.
 */
export class ImageDispatchError extends ComposedError {}

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
 * Make sure KoboldCPP, run by Serene Pub is up with THIS connection's image model.
 *
 * The text path has always done this — the managed adapter's preflight starts
 * the subprocess if the managed KoboldCPP owns one, waits out a slow load, and retries.
 * The image path had no equivalent, so rendering on a cold managed instance
 * failed with a bare connection error pointing at the image adapter, which is
 * the wrong file to go looking in.
 *
 * The same mechanism rather than a second one — same `ensureManagedReady`, same
 * `reload_config`, same baseUrl-keyed TTL — but it is now two questions with two
 * answers rather than one: the managed endpoint carries text and image models,
 * and a render asks for one of its image ones. Which is RESIDENT is the model
 * manager's decision, and while
 * its answer is "one at a time" a render here evicts the chat model and the next
 * message reloads it. That is why the `loading` stage is announced before the
 * call and not after — the swap is minutes, not moments, and a progress bar that
 * jumps straight to "sampling" makes it look like a hang.
 *
 * Only for the managed KoboldCPP. An external KoboldCPP, an A1111, a Forge —
 * nobody asked this app to start those, and trying would be a surprise.
 */
async function ensureManagedInstanceReady(
	connection: AdapterConnection,
	opts: {
		signal?: AbortSignal
		onProgress?: (p: ImageGenProgress) => void
	}
): Promise<void> {
	if (!CONNECTION_TYPE.isManagedKoboldCpp(connection.type)) return
	// Ahead of the loader's own "No model selected", because that sentence has no
	// idea which of possibly several connections sent it, and because a row
	// pointing at nothing is not worth a spawn and two retries.
	if (!connection.model)
		throw new ImageDispatchError(
			`The connection in the Images loadout has no image model selected. ` +
				`Pick one in its connection settings, or use "Use in Images" ` +
				`in the Models tab of KoboldCPP, run by Serene Pub.`,
			connectionIdentity(connection)
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

	// The model file is a PATH on a managed connection — the administrator's
	// directory layout, in a progress line that reaches every viewer of the
	// session. It rides as a field instead, which `emitToUser` removes for
	// everyone who is not an administrator; the sentence stands on its own.
	opts.onProgress?.({
		stage: "loading",
		percent: 0,
		message: "Loading the image model…",
		connection: connectionIdentity(connection)
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
	db: Db,
	connection: SelectConnection
): Promise<void> {
	if (!CONNECTION_TYPE.isManagedKoboldCpp(connection.type)) return
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
 * the managed text adapter overwrites it from the managed KoboldCPP's settings on every
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
	db: Db,
	connection: SelectConnection
): Promise<string> {
	if (!CONNECTION_TYPE.isManagedKoboldCpp(connection.type))
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

/**
 * The workflow a template-payload pair draws with (DESIGN-image-generation
 * §4.10), refused at bind with a sentence when it is missing, gone, of
 * another dialect, or names what this server lacks (§4.9 — the check is
 * recorded on the connection, so its row goes `unfinished` too).
 */
async function resolveWorkflow(
	db: Db,
	connection: SelectConnection,
	workflowId: number | null | undefined
): Promise<ImageWorkflowDocument> {
	if (workflowId == null)
		throw new ImageDispatchError(
			"Choose a workflow for this step — its image server draws with a ComfyUI workflow.",
			connectionIdentity(connection)
		)
	const { getWorkflowDocument } = await import(
		"$lib/server/imageGen/comfy/workflows"
	)
	const workflow = await getWorkflowDocument(db, workflowId)
	if (!workflow)
		throw new ImageDispatchError(
			"The workflow this step names no longer exists. Choose another.",
			connectionIdentity(connection)
		)
	if (connection.type === CONNECTION_TYPE.COMFYUI) {
		if (workflow.dialect !== "comfyui")
			throw new ImageDispatchError(
				`"${workflow.name}" is not a ComfyUI workflow.`,
				connectionIdentity(connection)
			)
		const { checkWorkflowOnConnection } = await import(
			"$lib/server/imageGen/comfy/serverCheck"
		)
		// An unreachable server is the run's failure to report, not the
		// check's: only a definite miss refuses here.
		const checked = await checkWorkflowOnConnection(
			db,
			connection,
			workflow
		).catch(() => null)
		if (checked?.problem)
			throw new ImageDispatchError(
				checked.problem,
				connectionIdentity(connection)
			)
	}
	return workflow
}

/**
 * Everything a render decides before it sends anything — shared by the run
 * (`dispatchImage`) and the action form's preview (`previewImageRun`), so the
 * notice a form shows and the run that follows cannot disagree.
 *
 * Resolves the pair, reads its drawing sheet, judges the step's needs against
 * it (refusing a hard need the pair lacks), renders the prompt rows once per
 * series item, builds and fits the request, and packs the series into calls.
 */
async function prepareImageRun(db: Db, call: ImageCall) {
	// The capability is `text->image` and nothing else, which is what keeps the
	// text default out of here: a text connection would be handed to
	// `getImageAdapter`, and a text sampling config would have every key dropped
	// by the resolver and render at backend defaults with no error.
	//
	// The refusal that used to sit below this — "what the connection can do, not
	// what kind of connection it is", since a plain `koboldcpp` row is tagged
	// text-gen and draws perfectly well when the instance behind it was started
	// with --sdmodel — is inside `resolveCapabilityTarget` now, so the same guard
	// runs for every capability rather than once per dispatcher.
	const resolved = await resolveCapabilityTarget(db, {
		capability: "text->image",
		pipelineConfig: {
			connectionId: call.connectionId,
			connectionModelId: call.connectionModelId,
			samplingConfigId: call.samplingId
		}
	})
	if (!resolved.ok)
		throw new ImageDispatchError(
			resolved.problem.message,
			resolved.problem.connection
		)
	const { connection, sampling } = resolved

	// The drawing sheet of THIS pair — the module's, refined by type and model.
	const exports = await getImageAdapter(connection.type)
	let sheet = exports.sheetFor?.(connection) ?? exports.sheet

	// A template-payload pair draws with a workflow (§4.10): the slot is
	// required for it, the sheet is derived from it, and it is checked
	// against this server before anything is sent (§4.9).
	const workflow =
		sheet.payload === "template"
			? await resolveWorkflow(db, connection, call.workflowId)
			: null
	if (workflow && exports.sheetForWorkflow)
		sheet = await exports.sheetForWorkflow(connection, workflow)

	// The bind guard for sheet facts (§4.6): a hard need the pair lacks is
	// refused here, before anything renders or is sent.
	const references = (call.references ?? []).filter(isMediaRef)
	const verdict = judgeSheet(sheet, {
		references: references.length,
		init: isMediaRef(call.init),
		mask: isMediaRef(call.mask),
		referencesPolicy: call.referencesPolicy,
		cutOut: call.cutOut
	})
	if (verdict.refusal)
		throw new ImageDispatchError(
			verdict.refusal,
			connectionIdentity(connection)
		)

	// The run the templates render under, in the shape `renderTemplate`
	// takes. `user` comes off the call rather than being asked for twice: it is
	// the same person the media rows are written for.
	const run: RenderRun = {
		runId: call.runId,
		user: call.userId != null ? String(call.userId) : undefined
	}

	// The base request, from the sampling config — sizes turned and fitted to
	// the sheet by the HOST, once, so no adapter computes them twice.
	const sampled = buildImageRequest({
		prompt: call.prompt ?? "",
		sampling,
		connection
	})
	// A workflow's dials start at its own variables' defaults (§7.1, as
	// reversed 2026-10-12), so it runs as written with nothing overriding
	// them; a loadout's overrides merge over these.
	if (workflow) {
		const defaults = workflowDialDefaults(workflow.variables)
		if (Object.keys(defaults).length)
			sampled.workflowValues = { ...defaults, ...(sampled.workflowValues ?? {}) }
	}
	// The loadout's own dials over them (lane E2): its `workflow_values`,
	// projected onto the slot by `applyLoadoutLayer`. A standard dial set
	// there (steps, cfg, size…) also fills the request's own field — the
	// field is what the adapter feeds the workflow — so "set here" on the
	// loadout beats the sampling config's value. A step-level override of the
	// dials, when one exists, layers over these the same way.
	const loadoutDials = workflow ? workflowValuesOf(call.workflowValues) : null
	if (loadoutDials) {
		sampled.workflowValues = mergeWorkflowValues(
			sampled.workflowValues,
			loadoutDials
		)
		const fields = sampled as unknown as Record<string, unknown>
		for (const [name, key] of Object.entries(STANDARD_DIALS))
			if (loadoutDials[name] !== undefined) fields[key] = loadoutDials[name]
	}
	const oriented = applyOrientation(sampled, call.orientation)
	const base = fitRequestToSheet(oriented, sheet, call.orientation)
	// 🚧 The `seed` param (I5, additive): `per-run` draws ONE seed when the
	// sampling leaves it random, so every call of this step sends the same
	// one and a series coheres. A sampling that fixes its own seed keeps it.
	if (
		call.seedPolicy === "per-run" &&
		!(typeof base.seed === "number" && base.seed >= 0)
	)
		base.seed = Math.floor(Math.random() * 2 ** 31)

	// The series: what pictures are wanted. Absent = ONE item, key "1" — and,
	// as before the series existed, the sampling's `batch` pictures of it.
	const series = (call.series ?? []).filter(
		(i): i is ImageSeriesItemV1 =>
			!!i && typeof i === "object" && i.key !== undefined
	)
	const items: RenderedSeriesItem[] = []
	if (series.length) {
		const keys = sanitiseSeriesKeys(series.map((i) => String(i.key)))
		for (const [n, item] of series.entries()) {
			const vars = {
				...(item.vars ?? {}),
				prompt: call.prompt ?? "",
				negative: call.negative ?? "",
				key: keys[n]!
			}
			items.push(await renderItem(call, vars, keys[n]!, String(item.key), run))
		}
	} else {
		const vars = {
			prompt: call.prompt ?? "",
			negative: call.negative ?? "",
			key: "1"
		}
		const one = await renderItem(call, vars, "1", "1", run)
		const n = Math.max(1, Math.floor(base.batch ?? 1))
		for (let i = 0; i < n; i++) items.push(one)
	}

	const plan = planImageCalls(items, sheet, exports)
	if (
		sampled.width !== base.width ||
		sampled.height !== base.height ||
		base.aspect
	)
		plan.size = {
			asked: { width: sampled.width, height: sampled.height },
			sent: {
				width: base.width,
				height: base.height,
				...(base.aspect ? { aspect: base.aspect } : {})
			}
		}

	return {
		connection,
		sampling,
		exports,
		sheet,
		workflow,
		verdict,
		references,
		items,
		base,
		plan,
		// The sampling's `batch` is the count of ONE prompt's pictures; with a
		// series the series is the count, so a batch set there is not honoured.
		batchOverridden: series.length > 0 && (sampled.batch ?? 1) > 1
	}
}

/** Render one series item's prompt rows; refuses an empty positive. */
async function renderItem(
	call: ImageCall,
	vars: Record<string, unknown>,
	key: string,
	label: string,
	run: RenderRun
): Promise<RenderedSeriesItem> {
	// The prompts slot is a pair of templates over the incoming text. An
	// unconfigured node passes the text straight through — rendering nothing at
	// all would be a blank prompt, which is the failure that looks like the
	// backend misbehaving.
	const prompt = await render(
		call.prompts?.positive,
		vars,
		String(vars.prompt ?? ""),
		run
	)
	const negative = await render(
		call.prompts?.negative,
		vars,
		String(vars.negative ?? ""),
		run
	)
	if (!prompt.trim())
		throw new ImageDispatchError(
			"the prompt came out empty — there is nothing to render."
		)
	return {
		key,
		label,
		prompt,
		...(negative ? { negative } : {}),
		vars
	}
}

const isMediaRef = (v: unknown): v is MediaRef =>
	!!v &&
	typeof v === "object" &&
	typeof (v as MediaRef).uuid === "string" &&
	!!(v as MediaRef).uuid

/**
 * What a picture step WOULD do, without doing it — for the action's form
 * (DESIGN-image-generation §4.6, §4.7): the refusal it would meet, the
 * pre-run notices it should show (*This model can't take a reference
 * image…*), and the packing (*12 pictures · 3 calls*). Server side only; the
 * form lane reads it.
 */
export async function previewImageRun(
	db: Db,
	call: ImageCall
): Promise<
	| {
			ok: true
			preRunNotices: string[]
			plan: ImageCallPlan
			/**
			 * 🚧 Which pair would draw (I5, additive) — for a form's cost
			 * line (*28 pictures · 3 calls on …*) and the per-image price
			 * read off the model's facts. Server side only: a member's form
			 * is never shown a connection or a model.
			 */
			pair: {
				connectionId: number
				connectionName: string
				connectionModelId: number | null
				modelName: string | null
			}
	  }
	| { ok: false; refusal: string }
> {
	try {
		const prepared = await prepareImageRun(db, call)
		const c = prepared.connection as {
			id: number
			name: string
			connectionModelId?: number | null
			connectionModelName?: string | null
			model?: string | null
		}
		return {
			ok: true,
			preRunNotices: prepared.verdict.preRunNotices,
			plan: prepared.plan,
			pair: {
				connectionId: c.id,
				connectionName: c.name,
				connectionModelId: c.connectionModelId ?? null,
				modelName: c.connectionModelName ?? c.model ?? null
			}
		}
	} catch (e) {
		if (e instanceof ImageDispatchError)
			return { ok: false, refusal: e.message }
		throw e
	}
}

/** Render one image step — a series, packed into calls. Throws with a sentence a person can act on. */
export async function dispatchImage(
	db: Db,
	call: ImageCall
): Promise<ImageCallResult> {
	call.signal?.throwIfAborted()

	const prepared = await prepareImageRun(db, call)
	const { connection, sampling, exports, verdict, references, items, base, plan } =
		prepared
	const { workflow } = prepared
	const caption = items[0]?.prompt ?? ""

	// The plan goes on the receipt BEFORE the first call, so a render that
	// fails or is cancelled still says what it was going to do.
	call.onPlan?.(plan)

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

	// For a managed connection this is the managed KoboldCPP's address, not the row's —
	// see resolveBaseUrl. Applied to the adapter's copy AND to the queue key, so
	// two rows on one process still serialize against each other.
	const baseUrl = await resolveBaseUrl(db, connection)
	const target = { ...conn, baseUrl }

	// Bytes for the referenced files, read here so the adapters never import
	// the media store (`ImageGenOptions.loadMedia`).
	const loadMedia = async (ref: MediaRef) => {
		const { getMediaByUuid, readMedia } = await import("$lib/server/media")
		const file = await getMediaByUuid(db, ref.uuid)
		const read = file ? await readMedia(db, file.id) : null
		if (!read) throw new Error(`media ${ref.uuid} is gone`)
		return { bytes: read.bytes, mime: read.mime }
	}

	const byKey = new Map(items.map((i) => [i.key, i]))
	const applied = new Set<string>()
	const ignored = new Set<string>(prepared.batchOverridden ? ["batch"] : [])
	const drawn: Array<{ item: GeneratedMediaItem; key: string | null; prompt: string; negative?: string; call: number }> = []
	let isAborted = false
	let refusal: string | null = null

	// The whole plan is ONE queue slot: a series is one step, and another
	// render interleaving its calls would interleave the progress and the
	// interrupts this queue exists to keep apart.
	await serialize(serverKey(target), async () => {
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
		// file — recorded here rather than papered over.
		await ensureManagedInstanceReady(connection, {
			signal: call.signal,
			onProgress: call.onProgress
		})
		const adapter = new exports.Adapter(target as any)
		try {
			for (const planned of plan.calls) {
				const item = byKey.get(planned.keys[0]!)!
				const { batch: _sampledBatch, ...rest } = base
				const req: ImageGenRequest = {
					...rest,
					prompt: item.prompt,
					...(item.negative ? { negativePrompt: item.negative } : {}),
					...(planned.count > 1 ? { batch: planned.count } : {}),
					...(references.length ? { references } : {}),
					...(isMediaRef(call.init) ? { init: call.init } : {}),
					...(isMediaRef(call.mask) ? { mask: call.mask } : {}),
					...(verdict.transparent ? { transparent: true } : {})
				}
				const result = await adapter.generateImage(req, {
					signal: call.signal,
					loadMedia,
					// The workflow a template-payload pair draws with, and —
					// for a keyed-graph call — every item it draws (§4.7).
					...(workflow ? { workflow } : {}),
					...(call.runId ? { runId: call.runId } : {}),
					...(plan.packing === "keyed-graph"
						? {
								series: planned.keys.map((k) => {
									const it = byKey.get(k)!
									return {
										key: k,
										prompt: it.prompt,
										...(it.negative ? { negative: it.negative } : {}),
										...(it.vars ? { vars: it.vars } : {})
									}
								})
							}
						: {}),
					// ⚠ Withheld rather than ignored, and the difference is the
					// cost. An adapter that is handed no callback runs no progress
					// poll and decodes no preview frame, which is what `off` is
					// asking for; one handed a callback it must not call would pay
					// for both and throw the answers away.
					onProgress:
						call.streaming === "off" ? undefined : call.onProgress
				})
				// Per call, onto the plan the receipt already holds.
				planned.applied = result.applied
				planned.ignored = result.ignored
				planned.returned = result.media.length
				for (const k of result.applied) applied.add(k)
				for (const k of result.ignored) ignored.add(k)
				const keys = assignCallMedia(planned, result.media.length)
				result.media.forEach((m, i) => {
					// A keyed backend says which item drew each picture (its
					// marked output node's prefix, §4.11); `null` is an extra
					// it drew outside any key. Absent = keyed by the call.
					const key =
						m.key === undefined
							? (keys[i] ?? null)
							: m.key !== null && planned.keys.includes(m.key)
								? m.key
								: null
					const source = key ? (byKey.get(key) ?? item) : item
					drawn.push({
						item: m,
						key,
						prompt: source.prompt,
						negative: source.negative,
						call: planned.index
					})
				})
				if (result.isAborted) {
					isAborted = true
					break
				}
				// A refusal (moderation) the service will repeat: stop the
				// series rather than pay for the same answer per call.
				if (result.refusal) {
					refusal = result.refusal.message
					if (result.refusal.noRetry) break
				}
			}
		} finally {
			// Push the unload timer back, exactly as the TEXT path does after a
			// generation (KoboldCppManagedAdapter.generateText).
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

	// Shortfall, per key; surplus with no key context, counted.
	const got = new Map<string, number>()
	for (const d of drawn) if (d.key) got.set(d.key, (got.get(d.key) ?? 0) + 1)
	const missing = missingKeys(items, got)
	if (missing.length) plan.missing = missing
	const unkeyed = drawn.filter((d) => !d.key).length
	if (unkeyed) plan.unkeyed = unkeyed

	if (isAborted && !drawn.length)
		return {
			media: [],
			image: null,
			caption,
			applied: [...applied],
			ignored: [...ignored],
			isAborted: true,
			plan,
			preRunNotices: verdict.preRunNotices
		}

	if (!drawn.length)
		throw new ImageDispatchError(
			refusal ?? "The image connection completed without returning an image.",
			connectionIdentity(connection)
		)

	const refs: KeyedMediaRef[] = []
	for (const d of drawn) {
		const { item } = d
		const label = d.key ? byKey.get(d.key)?.label : undefined
		const bytes = Buffer.from(item.base64, "base64")
		const { file, original } = await createMedia(db, {
			userId: call.userId ?? 0,
			bytes,
			filename: `generated.${extFor(item.mime)}`,
			...(call.sessionId != null
				? { sessionId: call.sessionId }
				: { bucket: "generated" }),
			// Written once at generation, never interpreted — the answer to "how
			// do I get another one like this".
			meta: {
				prompt: d.prompt,
				...(d.negative ? { negativePrompt: d.negative } : {}),
				...(item.seed !== undefined ? { seed: item.seed } : {}),
				...(base.model ? { model: base.model } : {}),
				backend: connection.type,
				connectionName: connection.name,
				...(sampling ? { samplingConfig: sampling.name } : {}),
				request: base,
				applied: [...applied],
				ignored: [...ignored],
				// Which series item this picture was drawn for — null for
				// surplus kept with no key — and the label the key came from.
				seriesKey: d.key,
				...(label !== undefined && label !== d.key
					? { seriesLabel: label }
					: {}),
				// A transparent background was asked for and this pair cannot
				// draw one: the cut-out task picks these up.
				...(verdict.needsCutOut ? { needsCutOut: true } : {}),
				// The pair was asked for, and draws, alpha itself: the cut-out
				// task's `auto` mode reads this and leaves the picture alone.
				...(verdict.transparent ? { transparent: "native" } : {}),
				...(item.meta ?? {})
			}
		})
		// Everything here comes off the FILE row (0182). `uuid`, `kind`,
		// dimensions and `filename` are file-level and exact; `mime` and
		// `bytes` describe the file's DISPLAY variant and are a HINT, which is
		// why they read the denormalised projection rather than a variant row —
		// a request naming `?v=` or negotiated by Accept can legitimately be
		// answered with different bytes and a different type, and a receipt is
		// what records which one was actually sent. `createMedia` always writes
		// the projection, so the fallback is the row it was projected from and
		// never a fabricated type or a zero length.
		refs.push({
			uuid: file.uuid,
			kind: file.kind as MediaRef["kind"],
			mime: file.displayMime ?? original.mime,
			bytes: file.displayBytes ?? original.bytes,
			...(file.width != null ? { width: file.width } : {}),
			...(file.height != null ? { height: file.height } : {}),
			// Seconds here, milliseconds in the column. Its PRESENCE is the
			// signal that a time dimension exists, which is what lets a
			// consumer notice that converting to a still format would be a
			// downgrade rather than performing one silently.
			...(file.durationMs != null
				? { duration: file.durationMs / 1000 }
				: {}),
			...(file.filename ? { filename: file.filename } : {}),
			// Alt text, so a downgrade to a text-only consumer has something to
			// say instead of nothing (media.ts) — and so the posted message's
			// image is described rather than announced as an untitled attachment.
			text: d.prompt,
			// The series item this was drawn for. Absent on surplus kept with
			// no key context — a consumer keyed by label ignores those.
			...(d.key ? { key: d.key } : {})
		})
		// What the run MADE, as row ids — the refs above are what the graph
		// carries and deliberately name no row. `created` even on a dedupe hit
		// (`createMedia` returns the existing rows for identical bytes from the
		// same user): this run produced that image, and the artifact is a
		// statement about the run rather than about the row's age.
		if (call.artifacts) {
			call.artifacts.push({
				kind: "file",
				entityId: file.id,
				action: "created",
				nodeKey: call.nodeKey ?? null
			})
			call.artifacts.push({
				kind: "variant",
				entityId: original.id,
				action: "created",
				nodeKey: call.nodeKey ?? null
			})
		}
	}

	return {
		media: refs,
		image: refs.find((r) => r.key) ?? refs[0] ?? null,
		caption,
		applied: [...applied],
		ignored: [...ignored],
		isAborted,
		plan,
		preRunNotices: verdict.preRunNotices
	}
}

/**
 * A prompts-slot template, or the raw text when there is no template.
 *
 * A template that renders to nothing is treated as absent rather than as an
 * instruction to send an empty prompt — the two are indistinguishable from the
 * author's side and only one of them is ever what was meant.
 *
 * ## The run rides along, and today nothing reads it
 *
 * The engine below is pinned to `CORE_TEMPLATE_ENGINE`, so this render is
 * always in-process Handlebars and never a plugin's hook, and core's renderer
 * ignores both `RenderRun` fields. It is threaded anyway, because the moment a
 * prompts slot carries an engine of its own that render becomes a sandboxed
 * hook call and cancelling the run reaches it only by the id the hooks are
 * grouped under (`hookGrace.ts`) — a thread that has to be added at that point
 * is one nobody remembers is missing, since the symptom is a render that keeps
 * going inside a run the person already cancelled.
 *
 * `RenderRun` is optional here for the same reason it is optional everywhere
 * else: a direct dispatch is a render no run owns, not a run that lost its id.
 */
async function render(
	source: string | undefined | null,
	variables: Record<string, unknown>,
	fallback: string,
	run: RenderRun = {}
): Promise<string> {
	if (!source || !source.trim()) return fallback
	// The core engine: a prompts slot declares no engine of its own, and the one
	// core renders is what every seeded template is written in.
	const out = await renderTemplate(CORE_TEMPLATE_ENGINE, {
		template: source,
		variables,
		...run
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
