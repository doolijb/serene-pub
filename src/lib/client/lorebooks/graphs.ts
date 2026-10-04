/**
 * The drawings, as lenses over the scope.
 *
 * Every lens is offered in every book: a lens with nothing to draw shows its
 * own empty state, because a control that vanishes teaches the reader the
 * capability does not exist. Nothing shuts a lens, and nothing shuts the build
 * either: summarizing is a capability every instance has, not a switch an admin
 * throws.
 */

/**
 * Which canvas one of the drawing lenses asks for. A lens names its canvas
 * in its descriptor (`lenses/registry.ts` — `drawing`, `drawingForLens`);
 * the time lens is not one, it draws its own lanes and moment bar.
 */
export type LoreDrawing = "relationships" | "places"

/**
 * Why the graph cannot be built or extended from sessions, or null while it
 * can. Only the build reads scenes, so only the build asks this.
 *
 * ⚠ It answers null. It stays as the one seam a future gate belongs in,
 * rather than being re-derived in markup — as a lens's own gate is its
 * descriptor's `reason` (`lenses/registry.ts`).
 */
export function graphBuildReason(): string | null {
	return null
}
