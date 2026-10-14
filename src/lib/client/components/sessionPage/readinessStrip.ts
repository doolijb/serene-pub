/**
 * The readiness strip's state (PLAN-models-view-admin-bridge lane D): the
 * Models view's chat strip, said where a member actually is — above the
 * composer — while the chat job has no model.
 *
 * It reads only what EVERY client holds: the instance's capability defaults
 * (`systemSettings:get` has no role check). `connections:list` is admin-only,
 * so the strip never claims *broken* — that needs facts a member never gets.
 * It speaks one state only, `unfinished` (gold), and says nothing once a
 * model is set: the Models view, not the session, says what replies.
 */

/** The chat job's capability key. */
export const CHAT_CAPABILITY = "text->text"

/** What the strip says, or null while it has nothing to say. */
export interface ReadinessStripState {
	headline: string
	sentence: string
	/** Admin only: the press that opens the chat job's picker in Models. */
	action?: { label: string }
}

/**
 * Null while chat has a model (or the defaults have not arrived — a member
 * should never see a flash of "can't reply" on a working instance).
 *
 * A pair with a connection but no model is INCOMPLETE and resolves as
 * unconfigured (`CapabilityDefault.connectionModelId`), so it shows too.
 */
export function readinessStripState(
	defaults:
		| Record<string, Pick<Sockets.CapabilityDefault, "connectionId" | "connectionModelId">>
		| null
		| undefined,
	isAdmin: boolean
): ReadinessStripState | null {
	if (!defaults) return null
	const chat = defaults[CHAT_CAPABILITY]
	if (chat?.connectionId != null && chat.connectionModelId != null) return null
	const headline = "Sessions can't reply yet."
	return isAdmin
		? {
				headline,
				sentence: "The Reply loadout has no model.",
				action: { label: "Fill the Reply loadout" }
			}
		: {
				headline,
				sentence: "No model is set up to reply. Ask your administrator."
			}
}
