/**
 * Landing on one message of a session from its address:
 * `/sessions/<id>?message=<messageId>[&block=<blockId>]` (`sessionHref`,
 * `shared/notifications/kinds.ts`). What the address asks for, what the page
 * should do next with the rows it holds, and which element answers it.
 *
 * The DOM hooks: a message row is `#message-<id>` (core's conversation keeps
 * its unprefixed ids — `ComponentMount`; Document View's list items carry the
 * same), and a declared block inside it is `[data-block-id="<blockId>"]`
 * (core's `MessageBlocksView`).
 */

/** The params a landing rides on; removed from the address once landed. */
export const LANDING_PARAMS = ["message", "block"] as const

export interface MessageLanding {
	messageId: number
	/** A block inside the message (a form's or choices' stamped id), when named. */
	blockId: string | null
}

/** What the address asks to land on, or null when it names no message. */
export function readMessageLanding(params: URLSearchParams): MessageLanding | null {
	const raw = params.get("message")?.trim()
	if (!raw || !/^\d+$/.test(raw)) return null
	const messageId = Number(raw)
	if (!Number.isSafeInteger(messageId) || messageId <= 0) return null
	const block = params.get("block")?.trim()
	return { messageId, blockId: block ? block : null }
}

/** The address without the landing's params (every other param kept). */
export function withoutLanding(url: URL): URL {
	const next = new URL(url)
	for (const p of LANDING_PARAMS) next.searchParams.delete(p)
	return next
}

/**
 * The next step toward the landing, from the rows the page holds:
 * - `seek` — the message is loaded; find its element;
 * - `wait` — an older page is on its way;
 * - `load-older` — the message is older than the loaded window and there is more;
 * - `give-up` — it is not here and no page will bring it (deleted, another
 *   session's, or newer than anything the session has).
 */
export type LandingStep = "seek" | "wait" | "load-older" | "give-up"

export function nextLandingStep(
	landing: MessageLanding,
	loadedIds: readonly number[],
	more: { hasOlder: boolean; loadingOlder: boolean }
): LandingStep {
	if (loadedIds.includes(landing.messageId)) return "seek"
	if (more.loadingOlder) return "wait"
	if (!loadedIds.length || !more.hasOlder) return "give-up"
	let oldest = loadedIds[0]
	for (const id of loadedIds) if (id < oldest) oldest = id
	return landing.messageId < oldest ? "load-older" : "give-up"
}

/** An attribute value, quoted for a selector. */
const quoted = (value: string) =>
	`"${value.replace(/\\/g, "\\\\").replace(/"/g, '\\"').replace(/\n/g, "\\a ")}"`

/** The selectors that answer a landing: the message's row, and the block inside it. */
export function landingSelectors(landing: MessageLanding): { message: string; block: string | null } {
	return {
		message: `[id=${quoted(`message-${landing.messageId}`)}]`,
		block: landing.blockId ? `[data-block-id=${quoted(landing.blockId)}]` : null
	}
}

/**
 * The element to land on, once it is drawn: the named block inside the
 * message when there is one, else the message. A layout may draw the log
 * twice (a view that is not showing): the one on screen wins.
 */
export function landingTarget(
	root: ParentNode,
	landing: MessageLanding
): { el: HTMLElement; focus: HTMLElement | null } | null {
	const sel = landingSelectors(landing)
	const rows = [...root.querySelectorAll<HTMLElement>(sel.message)]
	if (!rows.length) return null
	const row = rows.find((r) => r.getClientRects().length > 0) ?? rows[0]
	const block = sel.block ? row.querySelector<HTMLElement>(sel.block) : null
	// The row takes the keyboard when it can (`tabindex="-1"`), so a screen
	// reader starts reading where the link pointed.
	const rowFocus = row.hasAttribute("tabindex") ? row : null
	if (!block) return { el: row, focus: rowFocus }
	// A live form takes the keyboard at its first control; an answered one
	// leaves it on the message.
	const control = block.querySelector<HTMLElement>(
		"input:not([disabled]), select:not([disabled]), textarea:not([disabled]), button:not([disabled])"
	)
	return { el: block, focus: control ?? rowFocus }
}

/**
 * How many frames a page looks for the row once it holds it (~10s): the
 * conversation is drawn by a worker, and a layout without the log, or a row
 * on a channel the log does not show, never draws it.
 */
export const LANDING_SEEK_FRAMES = 600
