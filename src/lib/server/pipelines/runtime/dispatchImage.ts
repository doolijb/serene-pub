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
 * a queue with replies. Instead one render at a time PER CONNECTION, because the
 * backends genuinely cannot do better: A1111 and KoboldCPP report progress
 * globally, so two concurrent renders on one server produce interleaved progress
 * neither caller can interpret, and Fooocus's stop endpoint is global too, so a
 * cancel would hit whichever render happened to be running.
 */

import { eq } from "drizzle-orm"
import * as schema from "$lib/server/db/schema"
import { CONNECTION_TYPE } from "$lib/shared/constants/ConnectionTypes"
import { getImageAdapter } from "$lib/server/utils/getImageAdapter"
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
 * One render at a time per connection.
 *
 * A promise chain rather than a counting semaphore because the limit is exactly
 * one and the queue is short; anything more would be machinery for a case that
 * does not exist yet.
 */
const perConnection = new Map<number, Promise<unknown>>()

function serialize<T>(
	connectionId: number,
	work: () => Promise<T>
): Promise<T> {
	const prior = perConnection.get(connectionId) ?? Promise.resolve()
	// `.catch` so one failed render does not poison the queue for the next.
	const next = prior.then(work, work)
	perConnection.set(
		connectionId,
		next.catch(() => {})
	)
	return next
}

async function resolveTarget(
	db: any,
	connectionId?: number | null,
	samplingId?: number | null
) {
	const [system] = await db.select().from(schema.systemSettings).limit(1)

	// The IMAGE defaults, never the text ones: a text connection here would be
	// handed to `getImageAdapter`, and a text sampling config would have every
	// key dropped by the resolver and render at backend defaults with no error.
	const connId = connectionId ?? system?.defaultImageConnectionId
	const sampId = samplingId ?? system?.defaultImageSamplingConfigId

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
	if (!CONNECTION_TYPE.isImage(connection.type))
		throw new ImageDispatchError(
			`"${connection.name}" is a ${connection.type} connection, which does not generate images.`
		)

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

	const result = await serialize(connection.id, async () => {
		call.signal?.throwIfAborted()
		const { Adapter } = await getImageAdapter(connection.type)
		const adapter = new Adapter(conn as any)
		return adapter.generate(req, {
			signal: call.signal,
			onProgress: call.onProgress
		})
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
