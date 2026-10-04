/**
 * Is a zone's arranged grid out of room?
 *
 * The editor's zones are gridstack grids of a definite size, and the middle
 * one is normally filled edge to edge by Messages (a GROW widget takes every
 * cell there is). A card dragged onto a grid with no free cell simply snaps
 * back, silently — which reads as a broken drop rather than a full zone. This
 * is the one question the header needs in order to say so.
 *
 * Pure, and deliberately an AREA sum rather than a packing test: whether the
 * free cells are contiguous enough for the card being carried is gridstack's
 * answer to give, and it gives it the moment the card is over the zone. This
 * answers the prior question — is there any room at all — which is the one the
 * user can act on ("resize a widget").
 */
import type { ArrangedZone } from "@serene-pub/sdk"

/** True when the arrangement's items account for every cell in its frame. */
export function zoneIsFull(l: ArrangedZone | undefined): boolean {
	if (!l || !l.items.length) return false
	const cells = l.cols * l.rows
	if (cells <= 0) return false
	const used = l.items.reduce((n, i) => n + i.w * i.h, 0)
	return used >= cells
}
