/**
 * 🚧 `view-image` (anyone may ask): open one image in the page's lightbox —
 * with the images it sits with (`gallery`, a message's media strip), so the
 * lightbox can page through them.
 *
 * Core's messages show images from anywhere, as they always have; a plugin's
 * widget only the app's own (R69) — the page fetching an address a widget
 * chose is a way out for what it was shown. Every address in a gallery is
 * held to the same rule as `src`: a gallery is not a side door.
 */
import { hostAttributeValueFinding } from "@serene-pub/sdk"

/** A gallery as the page receives it, after the check. */
export interface ViewImageGallery {
	srcs: string[]
	index: number
	captions?: string[]
}

/** What this answer needs of the page. */
export interface ViewImageDeps {
	viewImage(src: string, gallery?: ViewImageGallery): void
}

const REFUSAL = "view-image shows the app's own images only"

function allowed(src: string, owner: string): boolean {
	return owner === "core"
		? /^(https?:|\/|data:image\/)/.test(src)
		: !hostAttributeValueFinding("img", "src", src)
}

/** Answer one `view-image` from `from.owner` (`'core'` or a plugin id). */
export function answerViewImage(params: unknown, from: { owner: string }, deps: ViewImageDeps): void {
	const p = (params ?? {}) as Record<string, unknown>
	const src = String(p.src ?? "")
	if (!allowed(src, from.owner)) throw new Error(REFUSAL)

	const g = p.gallery as Record<string, unknown> | undefined
	if (g === undefined || g === null) return deps.viewImage(src)
	const srcs = Array.isArray(g.srcs) ? g.srcs : null
	const index = g.index
	if (
		!srcs ||
		!srcs.every((s) => typeof s === "string") ||
		typeof index !== "number" ||
		!Number.isInteger(index) ||
		srcs[index] !== src
	)
		throw new Error("view-image's gallery must list its srcs with src at index")
	if (!srcs.every((s) => allowed(s as string, from.owner))) throw new Error(REFUSAL)
	const captions = Array.isArray(g.captions)
		? g.captions.map((c) => (typeof c === "string" ? c : ""))
		: undefined
	deps.viewImage(src, {
		srcs: srcs as string[],
		index,
		...(captions ? { captions } : {})
	})
}
