/**
 * 🚧 The Scene action's bindings (DESIGN-image-generation §6.4; I9) —
 * `core:spec/chat-illustrate-scene`:
 *
 *  - `core:query/likeness-images@1` — everyone on stage's likeness image
 *    (else avatar), in stage order: the switched-on cast by seat, then the
 *    personas. The read is `likeness_images` in `host.ts`, answered by
 *    `likenessImagesFor` below. Not capped: the picture step's host caps
 *    references at the drawing sheet's maximum and says so.
 *  - `core:task/clean-image-prompt@1` — a text model's reply as one prompt
 *    line (`cleanImagePrompt`). Pure.
 *  - `core:task/picture-placement@1` — message, backdrop or both, the
 *    press's payload over the step's parameter (`picturePlacement`). Pure.
 */
import type { Bindings, MediaRef } from "@serene-pub/sdk"
import { halt, ok, reads } from "@serene-pub/sdk"
import type * as C from "@serene-pub/contracts"
import { and, asc, eq, isNull } from "drizzle-orm"
import * as schema from "$lib/server/db/schema"
import { likenessOf } from "$lib/server/characters/likeness"
import { getMedia } from "$lib/server/media"
import type { CoreQueryCtx, NodeInput } from "./bindingTypes"

type Db = Parameters<typeof getMedia>[0]

/* ── the clean step ─────────────────────────────────────────────────────── */

/** Quote pairs a model wraps a whole answer in. */
const WRAPPING_QUOTES: ReadonlyArray<[string, string]> = [
	['"', '"'],
	["'", "'"],
	["“", "”"],
	["‘", "’"],
	["`", "`"]
]

/**
 * A model's reply as one prompt line: a code fence and a `Prompt:` label
 * dropped, wrapping quotes stripped, line breaks and list bullets turned
 * into commas, empty tags and repeated spaces collapsed, a trailing full
 * stop removed. Prose keeps its sentences; only its line breaks become
 * commas — or a space after a line that ends a sentence. Empty in, empty out.
 */
export function cleanImagePrompt(raw: unknown): string {
	let s = typeof raw === "string" ? raw : ""
	// A fenced block: keep what is inside it.
	const fenced = /```[a-zA-Z]*\s*\n?([\s\S]*?)```/.exec(s)
	if (fenced) s = fenced[1]
	s = s.replace(/```/g, "").trim()
	// A label the model put in front: "Prompt:", "Tags -", "Image prompt:".
	s = s.replace(/^\s*(?:image\s+)?(?:prompt|tags)\s*[:\-–—]\s*/i, "")
	// Wrapping quotes, possibly nested ("'…'").
	for (let changed = true; changed; ) {
		changed = false
		s = s.trim()
		for (const [open, close] of WRAPPING_QUOTES) {
			if (s.length >= 2 && s.startsWith(open) && s.endsWith(close)) {
				s = s.slice(open.length, s.length - close.length)
				changed = true
			}
		}
	}
	const parts = s
		.split(/\r?\n+/)
		.map((line) =>
			line
				// A list bullet or number at the start of a line.
				.replace(/^\s*(?:[-*•]+|\d+[.)])\s+/, "")
				.trim()
		)
		.filter(Boolean)
	// A line that ends a sentence runs on with a space; any other line is a tag.
	s = parts.reduce(
		(acc, part) => (!acc ? part : /[.!?]$/.test(acc) ? `${acc} ${part}` : `${acc}, ${part}`),
		""
	)
	return s
		.replace(/\s+/g, " ")
		.replace(/\s*,\s*/g, ", ")
		.replace(/(?:,\s*)+,/g, ",")
		.replace(/^[,\s]+|[,\s]+$/g, "")
		.replace(/\.+$/, "")
		.trim()
}

/* ── placement ──────────────────────────────────────────────────────────── */

/** @internal */
export type PicturePlacement = "message" | "backdrop" | "both"

const PLACEMENTS: ReadonlySet<string> = new Set(["message", "backdrop", "both"])

const placementOf = (v: unknown): PicturePlacement | null =>
	typeof v === "string" && PLACEMENTS.has(v) ? (v as PicturePlacement) : null

/**
 * Where the picture goes: the press's own `payload.placement` when it
 * names one of the three, else the step's `placement` parameter, else
 * `both`.
 */
export function picturePlacement(
	payload: unknown,
	param: unknown
): { placement: PicturePlacement; message: boolean; backdrop: boolean } {
	const pressed =
		payload && typeof payload === "object"
			? placementOf((payload as { placement?: unknown }).placement)
			: null
	const placement = pressed ?? placementOf(param) ?? "both"
	return {
		placement,
		message: placement !== "backdrop",
		backdrop: placement !== "message"
	}
}

/* ── likeness images ────────────────────────────────────────────────────── */

function mediaRefOf(file: {
	uuid: string
	kind: string
	displayMime: string | null
	displayBytes: number | null
	width: number | null
	height: number | null
	filename: string | null
}): MediaRef {
	return {
		uuid: file.uuid,
		kind: file.kind as MediaRef["kind"],
		mime: file.displayMime ?? "image/png",
		bytes: file.displayBytes ?? 0,
		...(file.width != null ? { width: file.width } : {}),
		...(file.height != null ? { height: file.height } : {}),
		...(file.filename ? { filename: file.filename } : {})
	}
}

/**
 * Everyone on stage's likeness image, in stage order — the order
 * `core:var/likenesses@1` lays the tag lines out in (`promptFields.ts`):
 * the switched-on, seated cast by position, then the personas by
 * position. A likeness image, else the avatar; someone with neither, or
 * whose file is gone or is not an image, is skipped. One picture per
 * file: the same image twice is sent once.
 */
export async function likenessImagesFor(
	db: Db,
	sessionId: number
): Promise<MediaRef[]> {
	const cast = await db
		.select({
			extensions: schema.characters.extensions,
			avatarMediaId: schema.characters.avatarMediaId
		})
		.from(schema.sessionCharacters)
		.innerJoin(
			schema.characters,
			eq(schema.characters.id, schema.sessionCharacters.characterId)
		)
		.where(
			and(
				eq(schema.sessionCharacters.sessionId, sessionId),
				eq(schema.sessionCharacters.isActive, true),
				isNull(schema.sessionCharacters.removedAt)
			)
		)
		.orderBy(asc(schema.sessionCharacters.position))
	const personas = await db
		.select({
			extensions: schema.characters.extensions,
			avatarMediaId: schema.characters.avatarMediaId
		})
		.from(schema.sessionPersonas)
		.innerJoin(
			schema.characters,
			eq(schema.characters.id, schema.sessionPersonas.personaId)
		)
		.where(
			and(
				eq(schema.sessionPersonas.sessionId, sessionId),
				isNull(schema.sessionPersonas.removedAt)
			)
		)
		.orderBy(asc(schema.sessionPersonas.position))
	const out: MediaRef[] = []
	const seen = new Set<number>()
	for (const row of [...cast, ...personas]) {
		const id = likenessOf(row).imageMediaId
		if (id == null || seen.has(id)) continue
		seen.add(id)
		const file = await getMedia(db, id)
		if (!file || file.kind !== "image") continue
		out.push(mediaRefOf(file as any))
	}
	return out
}

/* ── the bindings ───────────────────────────────────────────────────────── */

export function illustrateSceneBindings(): Bindings {
	return {
		"core:query/likeness-images@1": reads<typeof C.likenessImages>(
			async (
				input: NodeInput<typeof C.likenessImages>,
				ctx: CoreQueryCtx
			) => {
				const refs = await ctx.read("likeness_images", {
					sessionId: input?.scope?.sessionId
				})
				const references = Array.isArray(refs) ? refs : []
				return ok({ main: references, references })
			},
			{ ports: ["scope"] }
		),
		"core:task/clean-image-prompt@1": reads<typeof C.cleanImagePrompt>(
			async (input: NodeInput<typeof C.cleanImagePrompt>) => {
				const prompt = cleanImagePrompt(input?.text)
				if (!prompt)
					return halt(
						"the model wrote nothing to draw — its reply was empty once cleaned"
					)
				return ok({ main: prompt, prompt })
			},
			{ ports: ["text"] }
		),
		"core:task/picture-placement@1": reads<typeof C.picturePlacement>(
			async (input: NodeInput<typeof C.picturePlacement>) => {
				const decided = picturePlacement(
					input?.payload,
					(input as { params?: { placement?: unknown } })?.params
						?.placement
				)
				return ok({ main: decided, ...decided })
			},
			{ ports: ["payload"], params: ["placement"] }
		)
	}
}
