/**
 * THE HOST CARD — a pop-over's box. A widget placed in a session zone draws
 * no card of its own: the zone's PANEL draws the backing (PLAN 2026-11-05
 * R7; ./panelBacking). The host card is what is left for a widget opened
 * momentarily over the session, where a surface floating over the
 * conversation needs an edge to read as one.
 *
 * The answer reaches the widget twice (`withHostCard` in
 * `$lib/shared/widgets/context`): as `layout.v1.chrome.card`, and as
 * `data-sp-card="on" | "off"` on its box, for a stylesheet to key off.
 */

/**
 * The card's look — the same surface, border, radius and shadow a secondary
 * panel always wore. One string, so every box that wears it cannot drift.
 */
export const HOST_CARD_CLASS =
	"bg-surface-50-950 border-surface-200-800 rounded-lg border shadow-sm"
