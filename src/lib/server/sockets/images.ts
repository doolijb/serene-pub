import { randomUUID } from "node:crypto"
import { db } from "$lib/server/db"
import type { Handler } from "$lib/shared/events"
import { getImageAdapter } from "../utils/getImageAdapter"
import { capabilityRefusal } from "$lib/server/pipelines/runtime/capabilityGuard"
import { createMedia, mediaUrl } from "$lib/server/media"
import { decryptApiKeyField } from "$lib/server/utils/tokenCrypto"
import { checkSessionAccess } from "$lib/server/utils/sessionAccess"
import { buildImageRequest } from "$lib/server/imageGen/buildRequest"
import { S } from "@serene-pub/sdk"
import { capabilityDefault } from "$lib/server/connections/capabilityDefaults"
import {
	connectionModelById,
	mergeEndpointModel
} from "$lib/server/connections/models"
import { CONNECTION_REFUSAL } from "$lib/server/connections/visibility"
import type { RunProgress } from "$lib/shared/sockets/progress"
import type { ImageGenProgress } from "$lib/shared/imageGen/types"
import { CONNECTION_TYPE } from "$lib/shared/constants/ConnectionTypes"
import type { ImageWorkflowDocument } from "$lib/shared/imageGen/types"
import { workflowDialDefaults } from "$lib/shared/imageGen/workflowShape"
import type {
	GeneratedMedia,
	ImageDrawingSheetParams,
	ImageDrawingSheetResponse,
	ImageProfileSchemaParams,
	ImageProfileSchemaResponse,
	ImagesCancelParams,
	ImagesCancelResponse,
	ImagesGenerateParams,
	ImagesGenerateResponse
} from "$lib/shared/sockets/imageGen"

/**
 * Image generation (PLAN: local image gen). A user asks an image connection to
 * render a prompt; the results are stored as Media and returned.
 *
 * This is the manual entry point — the "Test Generation" panel on a connection
 * form. The pipeline's `generate-image` provider is the other one, and the two
 * share `buildImageRequest` so that an image made from the sidebar and one made
 * by a spec are asked for in the same terms.
 *
 * It writes MEDIA, not messages.
 */

/**
 * Runs in flight, so one can be stopped.
 *
 * Keyed by a run id the CALLER may supply, because the window in which someone
 * realises they made a mistake starts when they press the button — before the
 * server has replied with anything to cancel. The user id rides along so a run
 * can only be stopped by whoever started it.
 */
const inFlight = new Map<
	string,
	{ controller: AbortController; userId: number }
>()

/** Progress is emitted at most this often; a render can report far faster than a UI can use. */
const PROGRESS_THROTTLE_MS = 250

/**
 * Load the model and resolve the address for a managed image connection.
 *
 * Returns the connection the adapter should actually be built from. A
 * non-managed connection passes straight through untouched — nobody asked this
 * app to start somebody else's A1111.
 *
 * Deliberately a small local helper rather than an import from
 * `dispatchImage.ts`: that module is the pipeline runtime and pulls in the media
 * store, the template renderer and the run registry. This socket needs two facts
 * and a function call.
 */
async function readyManagedTarget(
	connection: AdapterConnection,
	decrypted: unknown,
	signal: AbortSignal,
	onProgress: (p: ImageGenProgress) => void
): Promise<unknown> {
	if (!CONNECTION_TYPE.isManagedKoboldCpp(connection.type))
		return decrypted

	if (!connection.model)
		throw new Error(
			`"${connection.name}" has no image model selected. Pick one in its connection settings, or use "Use in Images" in the Models tab of KoboldCPP, run by Serene Pub.`
		)

	const [{ ensureManagedReady }, { sdQuantToInt }] = await Promise.all([
		import("$lib/server/koboldcpp/managedPreflight"),
		import("$lib/server/imageAdapters/KoboldCppManagedImageAdapter")
	])

	// From NAMED fields, never a spread of `extraJson` — an upgraded row can
	// still carry an `sdModelFile` from the design where one connection held two
	// models, and a spread would hand it back to the loader.
	const profile = (connection.extraJson as any)?.profile ?? {}
	const rawThreads = Number(profile.sdThreads)
	const threads =
		Number.isInteger(rawThreads) && rawThreads > 0 ? rawThreads : undefined
	const quant = sdQuantToInt(profile.sdQuant)

	onProgress({
		stage: "loading",
		percent: 0,
		message: `Loading image model "${connection.model}"…`
	})

	const { baseUrl } = await ensureManagedReady(
		{
			kind: "image",
			file: connection.model,
			...(threads !== undefined ? { threads } : {}),
			...(quant !== undefined ? { quant } : {})
		},
		{ connectionId: connection.id, signal }
	)

	return { ...(decrypted as object), baseUrl }
}

export const imagesGenerate: Handler<
	ImagesGenerateParams,
	ImagesGenerateResponse
> = {
	event: "images:generate",
	handler: async (socket, params, emitToUser) => {
		const userId = socket.user?.id
		const runId = params.runId || randomUUID()
		const fail = (error: string): ImagesGenerateResponse => {
			const res = { ok: false, error, runId }
			emitToUser("images:generate", res)
			return res
		}
		if (!userId) return fail("Not authenticated.")

		// Before the prompt is even looked at, and long before the row is
		// read. This handler takes a `connectionId` STRAIGHT from the client
		// and renders on it — the most direct "unchooseable" violation on the
		// instance, and the one that needed no review card to reach.
		//
		// Its only caller is the connection editor's test button
		// (`ImageConnectionForm`, rendered inside the admin Connections
		// sidebar), so nothing a non-admin can legitimately do arrives here.
		//
		// Refusing FIRST is what keeps it from being an enumeration oracle:
		// "Connection not found." below distinguishes a real id from an
		// invented one, and `capabilityRefusal` under it names the connection
		// outright. One sentence for every id, before either can speak.
		if (!socket.user?.isAdmin) return fail(CONNECTION_REFUSAL)

		if (!params.prompt?.trim()) return fail("A prompt is required.")

		const endpoint = await db.query.connections.findFirst({
			where: (c, { eq }) => eq(c.id, params.connectionId)
		})
		if (!endpoint) return fail("Connection not found.")
		/**
		 * THE PAIR, merged before anything reads a field off it.
		 *
		 * This is the FOURTH entry point into image generation and the only one
		 * that does not go through `resolveCapabilityTarget` — it takes a
		 * connection id straight from the client. The socket predates pairs,
		 * so the model comes from the instance registration: the
		 * `text->image` default naming THIS endpoint with an explicit model.
		 * Anything else — no registration, another endpoint's, a model id
		 * that is gone, off, or elsewhere — refuses with the fix attached
		 * rather than guessing a row, because connections have no default
		 * model to fall back to.
		 */
		const registration = await capabilityDefault(db, "text->image")
		const candidate =
			registration?.connectionId === endpoint.id &&
			registration.connectionModelId != null
				? await connectionModelById(db, registration.connectionModelId)
				: undefined
		const usable =
			candidate != null &&
			candidate.connectionId === endpoint.id &&
			candidate.enabled
				? candidate
				: undefined
		// 🚧 A template-payload endpoint (ComfyUI) can draw a test without a
		// registered model: its checkpoint is a hole in the workflow, and an
		// unset hole renders at the workflow's own literal (§4.10).
		const templatePayload = await getImageAdapter(endpoint.type)
			.then((e) => (e.sheetFor?.(endpoint as any) ?? e.sheet)?.payload === "template")
			.catch(() => false)
		if (!usable && !templatePayload)
			return fail(
				"Choose which image model this connection sends — open its Models and press Use in Images on one."
			)
		const connection = mergeEndpointModel(
			endpoint as SelectConnection,
			usable ?? null
		)
		// The same guard the three dispatchers use, for the same reason: this is
		// the fourth way into image generation, and it was the last one still
		// asking what the connection *is* rather than what it can do. A KoboldCPP
		// row whose probe resolved `text->image` renders fine through a pipeline;
		// `isImage("koboldcpp")` is false, so it was refused here — the exact case
		// getImageAdapter now routes to the A1111 adapter.
		const refusal = capabilityRefusal(connection, "text->image")
		if (refusal) return fail(refusal)

		// Media scoped to a session becomes visible to everyone in that session,
		// so membership is checked before the scope is honoured — an unchecked
		// sessionId here would let anyone write into any session's asset list.
		if (params.sessionId != null) {
			const { hasAccess } = await checkSessionAccess(
				params.sessionId,
				userId
			)
			if (!hasAccess)
				return fail("You do not have access to that session.")
		}

		// 🚧 A template-payload connection (ComfyUI) draws with a workflow
		// (§4.8 step 5): the test names one, and it is checked here the way
		// the pipeline's `resolveWorkflow` checks a slot's.
		const exportsForSheet = await getImageAdapter(connection.type)
		const flatSheet =
			exportsForSheet.sheetFor?.(connection) ?? exportsForSheet.sheet
		let workflow: ImageWorkflowDocument | null = null
		if (flatSheet?.payload === "template") {
			if (params.workflowId == null)
				return fail("Choose a workflow to draw the test with.")
			const { getWorkflowDocument } = await import(
				"$lib/server/imageGen/comfy/workflows"
			)
			workflow = await getWorkflowDocument(db, params.workflowId)
			if (!workflow) return fail("That workflow no longer exists.")
			if (workflow.dialect !== "comfyui")
				return fail(`"${workflow.name}" is not a ComfyUI workflow.`)
		}

		// The chosen config, or the instance's image default. Never the text
		// default: an image node handed a text config would have every parameter
		// dropped by the resolver and would silently render at backend defaults.
		// A workflow test with no config named draws at the workflow's own
		// dials — its variables' defaults — never the SD presets.
		const imageDefault = await capabilityDefault(db, "text->image")
		const samplingId =
			params.samplingConfigId ??
			(workflow ? null : imageDefault?.samplingConfigId)
		const sampling = samplingId
			? await db.query.samplingConfigs.findFirst({
					where: (c, { eq }) => eq(c.id, samplingId)
				})
			: undefined
		if (sampling && sampling.shape !== S.imageGen)
			return fail(
				`"${sampling.name}" is a ${sampling.shape} config and cannot drive this image connection.`
			)

		// The stored apiKey is encrypted at rest (tokenCrypto.ts) — decrypt it
		// into the adapter's copy only, exactly where connections:get does before
		// the key leaves the server, never persisting the plaintext.
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

		const req = buildImageRequest({
			prompt: params.prompt.trim(),
			negativePrompt: params.negativePrompt,
			sampling,
			connection,
			overrides: params.overrides
		})
		// A workflow draws at its own dials' defaults unless something sets them.
		if (workflow) {
			const defaults = workflowDialDefaults(workflow.variables)
			if (Object.keys(defaults).length)
				req.workflowValues = { ...defaults, ...(req.workflowValues ?? {}) }
		}

		const controller = new AbortController()
		inFlight.set(runId, { controller, userId })

		let last = 0
		const onProgress = (p: {
			stage: string
			percent: number
			step?: number
			steps?: number
			preview?: { base64: string; mime: string }
			message?: string
		}) => {
			// Throttled because a preview frame is a whole image: emitting one per
			// step would send more bytes to the browser than the finished render.
			const now = Date.now()
			if (now - last < PROGRESS_THROTTLE_MS) return
			last = now
			const event: RunProgress = {
				runId,
				sessionId: params.sessionId,
				label: connection.name,
				...p
			}
			emitToUser("images:progress", event)
		}

		let result
		try {
			// A managed connection needs its model loaded and its address
			// resolved before anything is rendered — the same two steps
			// `dispatchImage` takes, for the same two reasons. This is the
			// FOURTH entry point into image generation and it has now been the
			// last one converted twice running, so it is worth saying plainly:
			// the row's own `baseUrl` is not authoritative for a managed
			// connection (the managed KoboldCPP's settings are), and in managed mode the
			// subprocess is usually not running or is holding the chat LLM, so
			// rendering without the load gets ECONNREFUSED or draws with
			// whatever happened to be resident.
			const target = await readyManagedTarget(
				connection,
				conn,
				controller.signal,
				onProgress
			)
			const { Adapter } = await getImageAdapter(connection.type)
			const adapter = new Adapter(target as any)
			result = await adapter.generateImage(req, {
				signal: controller.signal,
				onProgress,
				...(workflow ? { workflow, runId } : {})
			})
		} catch (e) {
			emitToUser("images:progress", {
				runId,
				// Present so the interest scope can be derived — the
				// terminal frames carry the session the throttled
				// `onProgress` above already puts on every frame it sends,
				// so a tab reading another session is not shown this run
				// ending either. Undefined for a render started outside a
				// session, which is the bare scope.
				sessionId: params.sessionId,
				done: true,
				error: e instanceof Error ? e.message : String(e)
			} satisfies RunProgress)
			return fail(
				`Image generation failed: ${e instanceof Error ? e.message : String(e)}`
			)
		} finally {
			inFlight.delete(runId)
		}

		if (result.isAborted) {
			emitToUser("images:progress", {
				runId,
				// Present so the interest scope can be derived — see above.
				sessionId: params.sessionId,
				done: true,
				cancelled: true
			} satisfies RunProgress)
			const res: ImagesGenerateResponse = {
				ok: true,
				runId,
				media: [],
				cancelled: true,
				applied: result.applied,
				ignored: result.ignored
			}
			emitToUser("images:generate", res)
			return res
		}

		if (!result.media.length) return fail("The backend returned no images.")

		const media: GeneratedMedia[] = []
		for (const item of result.media) {
			const { file, original } = await createMedia(db, {
				userId,
				bytes: Buffer.from(item.base64, "base64"),
				filename: `generated.${extFor(item.mime)}`,
				// Scope to the session when in-chat; otherwise a user-level bucket.
				...(params.sessionId != null
					? { sessionId: params.sessionId }
					: { bucket: "generated" }),
				// What produced it, so "make another like that one" is answerable
				// months later. Written once, never interpreted.
				meta: {
					prompt: req.prompt,
					...(req.negativePrompt
						? { negativePrompt: req.negativePrompt }
						: {}),
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
			// Built field by field, and note what is NOT here: `path`. This
			// used to spread the on-disk location of a freshly written file into
			// a socket response, disclosing the data-dir layout and the owner's
			// user id to every browser that could read it. The path-leak tests
			// only inspected `toClientMedia`, so nothing caught it for as long
			// as it stood — `images.pathLeak.int.test.ts` covers this shape now.
			media.push({
				id: file.id,
				uuid: file.uuid,
				url: mediaUrl(file.uuid, file.rev),
				rev: file.rev,
				// The DISPLAY variant's mime. `createMedia` always writes the
				// projection, so the fallback is the row it was projected from
				// rather than an invented type — a null must never become a
				// confident "application/octet-stream" for an image.
				mime: file.displayMime ?? original.mime,
				kind: file.kind,
				width: file.width,
				height: file.height,
				...(item.seed !== undefined ? { seed: item.seed } : {})
			})
		}

		emitToUser("images:progress", {
			runId,
			// Present so the interest scope can be derived — see above.
			sessionId: params.sessionId,
			done: true,
			percent: 100
		} satisfies RunProgress)

		const res: ImagesGenerateResponse = {
			ok: true,
			runId,
			media,
			applied: result.applied,
			ignored: result.ignored
		}
		emitToUser("images:generate", res)
		return res
	}
}

/**
 * The fields a given image backend offers, so its connection form is generated
 * rather than written.
 *
 * The alternative is a bespoke Svelte component per backend — which is what
 * the per-backend form used to be, and what four backends would have made four of, each
 * re-implementing the URL field and the test button around a different middle.
 * The adapter declares its own settings in the SDK's field language; core renders
 * them without knowing what a "performance selection" is.
 */
export const imagesProfileSchema: Handler<
	ImageProfileSchemaParams,
	ImageProfileSchemaResponse
> = {
	event: "images:profileSchema",
	handler: async (socket, params, emitToUser) => {
		if (!socket.user?.id) {
			const res = { type: params.type, error: "Not authenticated." }
			emitToUser("images:profileSchema", res)
			return res
		}
		// A type, not a row, so there is no capability set to consult — and no
		// need for one. `getImageAdapter` IS the answer to "can this type draw":
		// it throws for a type it has no adapter for, and it is the same lookup
		// the render path makes. Asking `isImage` here instead disagreed with it,
		// because `koboldcpp` now routes to the A1111 adapter while its type tag
		// still says text — so the render worked and the settings form that
		// configures it could not be loaded.
		let adapter
		try {
			adapter = await getImageAdapter(params.type)
		} catch {
			const res = {
				type: params.type,
				error: "That is not an image-generation connection type."
			}
			emitToUser("images:profileSchema", res)
			return res
		}
		const res: ImageProfileSchemaResponse = {
			type: params.type,
			schema: adapter.profileSchema as
				| Record<string, unknown>
				| undefined,
			defaults: adapter.profileDefaults,
			// The drawing sheet, under the key the form already reads.
			capabilities: adapter.sheet as unknown as Record<
				string,
				unknown
			>
		}
		emitToUser("images:profileSchema", res)
		return res
	}
}

/**
 * The drawing sheet of the image pair a sampling config is likely to run
 * against (the Image default, or a named pair), so the sampling form can grey
 * the knobs that pair drops (DESIGN-image-generation §4.3).
 *
 * A NOTE, never an error: no pair set, or one that does not resolve, answers
 * `sheet: null` and the form greys nothing — a config outlives the connection
 * it happens to be paired with.
 */
export const imagesDrawingSheet: Handler<
	ImageDrawingSheetParams,
	ImageDrawingSheetResponse
> = {
	event: "images:drawingSheet",
	handler: async (socket, params, emitToUser) => {
		// 🚧 A card's Sprites tab asks whether its pair re-expresses
		// (§6.3). The owner may ask; only an admin sees the sheet.
		if (params?.characterId != null && socket.user) {
			const characterId = params.characterId
			const isAdmin = !!socket.user.isAdmin
			let res: ImageDrawingSheetResponse = {
				sheet: null,
				drops: [],
				characterId,
				expressions: false
			}
			try {
				const { mayFillSprites } = await import("$lib/server/sprites/attach")
				if (await mayFillSprites(db, socket.user.id, characterId)) {
					const { spriteExpressionPair } = await import(
						"$lib/server/sprites/reexpress"
					)
					const { samplingKeysSheetDrops } = await import(
						"$lib/shared/imageGen/types"
					)
					const pair = await spriteExpressionPair(db)
					if (pair.ok)
						res = {
							...res,
							expressions: pair.sheet.expressions === true,
							...(isAdmin
								? { sheet: pair.sheet, drops: samplingKeysSheetDrops(pair.sheet) }
								: {})
						}
				}
			} catch {
				// No sheet is an answer: nothing is offered.
			}
			emitToUser("images:drawingSheet", res)
			return res
		}
		if (!socket.user?.isAdmin) {
			const res = { error: "Only an admin can read this." }
			emitToUser("images:drawingSheet", res)
			return res
		}
		const { resolveCapabilityTarget } = await import(
			"$lib/server/connections/capabilityTarget"
		)
		const { samplingKeysSheetDrops } = await import(
			"$lib/shared/imageGen/types"
		)
		let res: ImageDrawingSheetResponse = { sheet: null, drops: [] }
		// 🚧 A workflow's sheet on a named connection (§4.8 step 4): derived
		// from what the document reads, without needing a model pair — a
		// ComfyUI's checkpoint is a hole in the workflow, not a precondition
		// for describing it.
		if (params?.workflowId != null) {
			try {
				const conn =
					params.connectionId != null
						? await db.query.connections.findFirst({
								where: (c, { eq }) => eq(c.id, params.connectionId!)
							})
						: undefined
				const { getWorkflowDocument } = await import(
					"$lib/server/imageGen/comfy/workflows"
				)
				const workflow = await getWorkflowDocument(db, params.workflowId)
				if (workflow) {
					const exports = await getImageAdapter(
						conn?.type ?? CONNECTION_TYPE.COMFYUI
					)
					if (exports.sheetForWorkflow) {
						const sheet = await exports.sheetForWorkflow(
							conn ?? { type: CONNECTION_TYPE.COMFYUI },
							workflow
						)
						res = { sheet, drops: samplingKeysSheetDrops(sheet) }
					}
				}
			} catch {
				// No sheet is an answer.
			}
			res = { ...res, workflowId: params.workflowId }
			emitToUser("images:drawingSheet", res)
			return res
		}
		try {
			const resolved = await resolveCapabilityTarget(db, {
				capability: "text->image",
				pipelineConfig: {
					connectionId: params?.connectionId ?? null,
					connectionModelId: params?.connectionModelId ?? null,
					samplingConfigId: null
				}
			})
			if (resolved.ok) {
				const exports = await getImageAdapter(resolved.connection.type)
				const sheet =
					exports.sheetFor?.(resolved.connection) ?? exports.sheet
				res = { sheet, drops: samplingKeysSheetDrops(sheet) }
			}
		} catch {
			// No sheet is an answer: the form greys nothing.
		}
		emitToUser("images:drawingSheet", res)
		return res
	}
}

export const imagesCancel: Handler<ImagesCancelParams, ImagesCancelResponse> = {
	event: "images:cancel",
	handler: async (socket, params, emitToUser) => {
		const userId = socket.user?.id
		if (!userId) {
			const res = { ok: false, found: false, error: "Not authenticated." }
			emitToUser("images:cancel", res)
			return res
		}

		const run = inFlight.get(params.runId)
		// A run that has already finished is not an error — it is a cancel that
		// arrived late, which is the normal outcome of pressing Cancel just as
		// the render lands.
		if (!run) {
			const res = { ok: true, found: false }
			emitToUser("images:cancel", res)
			return res
		}
		if (run.userId !== userId) {
			const res = { ok: false, found: false, error: "Not your run." }
			emitToUser("images:cancel", res)
			return res
		}

		run.controller.abort()
		const res = { ok: true, found: true }
		emitToUser("images:cancel", res)
		return res
	}
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

export function registerImageHandlers(
	socket: any,
	emitToUser: (event: string, data: any) => void,
	register: (
		socket: any,
		handler: Handler<any, any>,
		emitToUser: (event: string, data: any) => void
	) => void
) {
	register(socket, imagesGenerate, emitToUser)
	register(socket, imagesCancel, emitToUser)
	register(socket, imagesProfileSchema, emitToUser)
	register(socket, imagesDrawingSheet, emitToUser)
}
