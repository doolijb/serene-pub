/**
 * 🚧 **Describe image** — `core:oracle/describe-image@1` (DESIGN-image-
 * generation §5, *Describe from image*; follow-up D1, 2026-10-12).
 *
 * Two halves, as every model call has:
 *
 *  - `describeImageBindings()` — the binding: forwards the pictures, the
 *    instruction (the `prompts` slot's `instruction` field) and the slots'
 *    resolved pair. It never sees a connection or a byte.
 *  - `describeImage()` — the host's call: one user turn holding the
 *    instruction, the pictures as that turn's attachments, sent through
 *    `dispatchGeneration` against the **`text+image->text`** job — the
 *    model the pub reads pictures with — not the chat default.
 *
 * Works with no session (a card action): the dispatch then has no cast and
 * no transcript, and a picture may travel when it is the person's own file
 * or the card's (`resolveAttachments`).
 */
import type { Bindings, MediaRef } from "@serene-pub/sdk"
import { halt, ok, reads } from "@serene-pub/sdk"
import type * as C from "@serene-pub/contracts"
import { slotModelId } from "$lib/shared/connections/slotRef"
import type { NodeInput, OracleCtx } from "./bindingTypes"

/** The job a describe step reads pictures on. */
export const DESCRIBE_IMAGE_CAPABILITY = "text+image->text"

/** A prompts-slot field as text: a bare string, or a resolved row's `source`. */
function fieldText(v: unknown): string {
	if (typeof v === "string") return v
	const source = (v as { source?: unknown } | null | undefined)?.source
	return typeof source === "string" ? source : ""
}

/** A resolved slot's row id: a number, a numeric string, `{ id }` / `{ ref }`. */
function refId(v: unknown): number | null {
	if (typeof v === "number") return Number.isSafeInteger(v) ? v : null
	if (typeof v === "string" && /^\d+$/.test(v)) return Number(v)
	if (v && typeof v === "object")
		return refId((v as { ref?: unknown; id?: unknown }).ref ?? (v as { id?: unknown }).id)
	return null
}

export interface DescribeImageRequest {
	/** The binding's payload: `images`, `instruction`, `connection`, `sampling`. */
	payload: Record<string, any>
	sessionId?: number
	userId?: number
	/** The card a card action runs on — its own files may travel. */
	characterId?: number
	signal?: AbortSignal
	onChunk?: (chunk: string) => void
}

/** The host's half: the request, sent; the answer's text back. */
export async function describeImage(
	db: Db,
	req: DescribeImageRequest
): Promise<{ text: string }> {
	const p = req.payload
	const images = (Array.isArray(p.images) ? p.images : []) as MediaRef[]
	const instruction = String(p.instruction ?? "").trim()
	const { dispatchGeneration } = await import(
		"$lib/server/pipelines/runtime/dispatch"
	)
	const result = await dispatchGeneration({
		// Already compiled: one user turn, no transcript, no speaker. The
		// adapter puts the pictures on this turn (`withAttachments`).
		compiledPrompt: {
			messages: [{ role: "user", content: instruction }],
			meta: { currentTurnCharacterId: null }
		},
		db,
		sessionId: req.sessionId,
		userId: req.userId,
		characterId: req.characterId,
		capability: DESCRIBE_IMAGE_CAPABILITY,
		currentCharacterId: null,
		attachments: images,
		connectionId: refId(p.connection),
		connectionModelId: slotModelId(p.connection),
		samplingId: refId(p.sampling),
		// One answer, waited for: nothing streams it anywhere.
		streaming: "off",
		onChunk: req.onChunk,
		signal: req.signal,
		queue: {
			taskType: "field_generation",
			sessionId: req.sessionId,
			userId: req.userId,
			label: "Describe image"
		}
	})
	return { text: result.text ?? "" }
}

/** The binding. */
export function describeImageBindings(): Bindings {
	return {
		"core:oracle/describe-image@1": reads<typeof C.describeImage>(
			async (input: NodeInput<typeof C.describeImage>, ctx: OracleCtx) => {
				const images = Array.isArray(input?.images) ? input.images : []
				if (images.length === 0)
					return halt(
						"there is no picture to describe — the character has no likeness image and no avatar"
					)
				const instruction = fieldText(
					(input as { prompts?: Record<string, unknown> })?.prompts
						?.instruction
				).trim()
				if (!instruction)
					return halt(
						"the describe step has no question to ask — its prompt row is empty"
					)
				const result: any = await ctx.call({
					images,
					instruction,
					connection: (input as any)?.connection ?? null,
					sampling: (input as any)?.sampling ?? null
				})
				const text = typeof result?.text === "string" ? result.text : ""
				return ok({ main: text, text })
			},
			{ ports: ["images", "prompts", "connection", "sampling"] }
		)
	}
}
