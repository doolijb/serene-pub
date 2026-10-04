/**
 * The lens mounts — the screen each descriptor's `mount` names.
 *
 * A mount takes the one `LensProps` shape the workspace hands every lens and
 * draws the lens's screen with the parts it needs, so the workspace mounts a
 * lens as `<Mount lens={…} {lorebookId} {bench} bind:hasUnsavedChanges />`
 * with no ladder of its own. Kept apart from the registry so the registry
 * stays pure data (see `types.ts`).
 */

import type { Component } from "svelte"
import DrawingMount from "./DrawingMount.svelte"
import LivesMount from "./LivesMount.svelte"
import PoolMount from "./PoolMount.svelte"
import TimeMount from "./TimeMount.svelte"
import type { LensDescriptor, LensMountId, LensProps } from "./types"

export const LENS_MOUNTS: Record<
	LensMountId,
	Component<LensProps, {}, "hasUnsavedChanges">
> = {
	pool: PoolMount,
	drawing: DrawingMount,
	time: TimeMount,
	lives: LivesMount
}

/** The screen a lens is drawn with. */
export function mountFor(
	lens: LensDescriptor
): Component<LensProps, {}, "hasUnsavedChanges"> {
	return LENS_MOUNTS[lens.mount]
}
