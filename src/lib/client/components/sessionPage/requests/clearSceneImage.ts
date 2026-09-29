/**
 * 🚧 `clear-scene-image` (R21): core's scene portraits take down the portrait
 * pinned on one side. Core's widgets only (the askers table, `./askers.ts`).
 *
 * It clears the PAGE's own pin — the one state the page persists, mirrors into
 * the `sceneImages` store and projects into `characters.v1` — never a copy of
 * it (R77, F10: the native widget cleared the store and left the page's pin
 * standing, so the next change anywhere put the portrait back). The page and
 * every widget then read one answer.
 *
 * Clearing a side with nothing pinned is done already, not an error.
 */
import type { WidgetRequests } from "@serene-pub/sdk"

type Side = WidgetRequests["clear-scene-image"]["params"]["side"]

/** The page's pins, as this answer writes them. */
export interface SceneImagePins {
	clear(side: Side): void
}

/** Answer one `clear-scene-image` against the page's own pins. */
export function answerClearSceneImage(params: unknown, pins: SceneImagePins): void {
	const side = (params as { side?: unknown } | null | undefined)?.side
	if (side !== "left" && side !== "right")
		throw new Error("clear-scene-image clears the 'left' or the 'right' portrait")
	pins.clear(side)
}
