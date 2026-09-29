/**
 * 🚧 `view-image` (anyone may ask): open one image in the page's viewer.
 *
 * Core's messages show images from anywhere, as they always have; a plugin's
 * widget only the app's own (R69) — the page fetching an address a widget
 * chose is a way out for what it was shown.
 */
import { hostAttributeValueFinding } from "@serene-pub/sdk"

/** What this answer needs of the page. */
export interface ViewImageDeps {
	viewImage(src: string): void
}

/** Answer one `view-image` from `from.owner` (`'core'` or a plugin id). */
export function answerViewImage(params: unknown, from: { owner: string }, deps: ViewImageDeps): void {
	const p = params as Record<string, unknown>
	const src = String(p.src ?? "")
	const ok =
		from.owner === "core"
			? /^(https?:|\/|data:image\/)/.test(src)
			: !hostAttributeValueFinding("img", "src", src)
	if (!ok) throw new Error("view-image shows the app's own images only")
	deps.viewImage(src)
}
