/**
 * THE HOST CARD (ruled 2026-09-27) — pure, and the whole decision.
 *
 * A widget placed in a session sits FLUSH in its cell: the host draws no card
 * (surface, border, title bar) around it, and the widget's own style decides
 * whether it has a surface — the direction is that session widgets carry no
 * styling of their own and a stylesheet lays it on top. The card comes back in
 * exactly two cases:
 *
 *   • the person turned on the widget's **Card** setting (`hostCard`, a core
 *     field every widget has — `$lib/shared/widgets/settings`);
 *   • the widget is MOMENTARILY opened over the session — a pop-over, a
 *     flyout (docked rule (c), an un-arranged zone's, a tucked side's), the
 *     phone's panel sheet. A surface floating over the conversation needs an
 *     edge to read as one, so there it is carded whatever the setting says.
 *
 * The answer reaches the widget twice (`withHostCard` in
 * `$lib/shared/widgets/context`): as `layout.v1.chrome.card`, and as
 * `data-sp-card="on" | "off"` on its box, for a stylesheet to key off.
 *
 * The messages widget is the exception (note 18, 2026-10-02): its Card setting
 * is a backing MODE (`backingMode`, Auto / On / Off) over the message backing
 * its style declares (`$lib/shared/widgets/messageBacking`), and only a
 * pop-over gets this host card.
 *
 * "Card" alone is a character file (NOMENCLATURE, content): the setting key and
 * this module say `hostCard` — the card the HOST draws — and only the UI label
 * is the bare word.
 */
export interface HostCardInput {
	/** The widget's stored `hostCard` setting — untrusted, so only `true` is on. */
	setting: unknown
	/** Is the widget momentarily opened over the session right now? */
	popover: boolean
}

export function hostCardShown(o: HostCardInput): boolean {
	return o.popover || o.setting === true
}

/**
 * The card's look — the same surface, border, radius and shadow a secondary
 * panel always wore. One string, so the panel chrome and the conversation's
 * box (which has no panel around it) cannot drift apart.
 */
export const HOST_CARD_CLASS =
	"bg-surface-50-950 border-surface-200-800 rounded-lg border shadow-sm"
