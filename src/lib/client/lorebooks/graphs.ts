/**
 * The drawings, as lenses over the scope.
 *
 * Every lens is offered in every book: a lens with nothing to draw shows its
 * own empty state, because a control that vanishes teaches the reader the
 * capability does not exist. Nothing shuts a lens, and nothing shuts the build
 * either: summarizing is a capability every instance has, not a switch an admin
 * throws.
 */

import type { LoreLens } from "./loreRoute"

/** Which canvas one of the drawing lenses asks for. */
export type LoreDrawing = "relationships" | "places"

/**
 * ⚠ The time lens is not here. It draws its own lanes and moment bar rather
 * than a canvas the graph workspace hosts, so it is dispatched beside these
 * rather than through them.
 */
const DRAWINGS: Partial<Record<LoreLens, LoreDrawing>> = {
	graph: "relationships",
	places: "places"
}

/**
 * The canvas a lens draws, or null for the three that draw the pool itself.
 *
 * ⚠ `places` draws the `anchorEntryId` parent tree, the travel links between
 * its boxes and the members standing in them: no entry kind declares a place
 * role, so what the map has to nest is what is filed under what. The day a
 * kind declares one, the drawing narrows to it.
 */
export function drawingForLens(lens: LoreLens): LoreDrawing | null {
	return DRAWINGS[lens] ?? null
}

/**
 * Why a lens cannot be drawn yet, or null while it can.
 *
 * ⚠ Every lens is drawable, so this answers null for all six. It stays as the
 * one seam a future gate belongs in, rather than being re-derived in markup.
 */
export function lensReason(lens: LoreLens): string | null {
	return null
}

/**
 * Why the graph cannot be built or extended from sessions, or null while it
 * can. Only the build reads scenes, so only the build asks this.
 *
 * ⚠ It answers null too. It stays for the same reason `lensReason` does: the
 * one seam a future gate belongs in, rather than being re-derived in markup.
 */
export function graphBuildReason(): string | null {
	return null
}
