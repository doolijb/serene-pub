import { randomUUID } from "node:crypto"
import { db } from "$lib/server/db"
import type { Handler } from "$lib/shared/events"
import { CONNECTION_TYPE } from "$lib/shared/constants/ConnectionTypes"
import { getImageAdapter } from "../utils/getImageAdapter"
import { createMedia } from "$lib/server/media"
import { decryptApiKeyField } from "$lib/server/utils/tokenCrypto"
import { checkSessionAccess } from "$lib/server/utils/sessionAccess"
import { buildImageRequest } from "$lib/server/imageGen/buildRequest"
import { S } from "@serene-pub/sdk"
import type { RunProgress } from "$lib/shared/sockets/progress"
import type {
	GeneratedMedia,
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
		if (!params.prompt?.trim()) return fail("A prompt is required.")

		const connection = await db.query.connections.findFirst({
			where: (c, { eq }) => eq(c.id, params.connectionId)
		})
		if (!connection) return fail("Connection not found.")
		if (!CONNECTION_TYPE.isImage(connection.type))
			return fail(
				"That connection is not an image-generation connection."
			)

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

		// The chosen config, or the instance's image default. Never the text
		// default: an image node handed a text config would have every parameter
		// dropped by the resolver and would silently render at backend defaults.
		const [system] = await db.query.systemSettings.findMany({ limit: 1 })
		const samplingId =
			params.samplingConfigId ?? system?.defaultImageSamplingConfigId
		const sampling = samplingId
			? await db.query.samplingConfigs.findFirst({
					where: (c, { eq }) => eq(c.id, samplingId)
				})
			: undefined
		if (sampling && sampling.shape !== S.imageGen)
			return fail(
				`"${sampling.name}" is a ${sampling.shape} config and cannot drive an image connection.`
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
			const { Adapter } = await getImageAdapter(connection.type)
			const adapter = new Adapter(conn as any)
			result = await adapter.generate(req, {
				signal: controller.signal,
				onProgress
			})
		} catch (e) {
			emitToUser("images:progress", {
				runId,
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
			const row = await createMedia(db, {
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
			media.push({
				id: row.id,
				uuid: row.uuid,
				path: row.path,
				mime: row.mime,
				kind: row.kind,
				width: row.width,
				height: row.height,
				...(item.seed !== undefined ? { seed: item.seed } : {})
			})
		}

		emitToUser("images:progress", {
			runId,
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
 * `FooocusForm.svelte` was, and what four backends would have made four of, each
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
		if (!CONNECTION_TYPE.isImage(params.type)) {
			const res = {
				type: params.type,
				error: "That is not an image-generation connection type."
			}
			emitToUser("images:profileSchema", res)
			return res
		}

		const adapter = await getImageAdapter(params.type)
		const res: ImageProfileSchemaResponse = {
			type: params.type,
			schema: adapter.profileSchema as
				| Record<string, unknown>
				| undefined,
			defaults: adapter.profileDefaults,
			capabilities: adapter.capabilities as unknown as Record<
				string,
				unknown
			>
		}
		emitToUser("images:profileSchema", res)
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
}
