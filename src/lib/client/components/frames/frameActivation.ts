/**
 * A frame's leave to change state (U5c review, S-C; fourth pass W4;
 * 2026-09-16).
 *
 * A plugin frame is an opaque-origin iframe that may `{ t: "invoke" }` one
 * of core's verbs. The verbs that **change** a message — hide, retry,
 * extend, delete, edit, swipe — are things a person does; a frame doing
 * them on its own, on a timer or on load, would be a script rewriting the
 * transcript with the person's authority. So such an invoke is honoured only
 * while a person is **currently in the frame**: the browser's own transient
 * user-activation flag is set (a real, recent click or key press somewhere)
 * *and* the frame element is the parent document's current focus. Both are
 * things activation *inside* an opaque-origin iframe leaves on the parent —
 * a click or key there both sets `navigator.userActivation.isActive` on the
 * top document (activation propagates to the ancestor) and moves
 * `document.activeElement` onto the `<iframe>` itself, which is as close to
 * "a person is interacting with this frame right now" as the parent can see
 * into an origin it cannot read. Where `userActivation` does not exist yet
 * (Firefox, as of writing) this falls back to the third pass's fixed window:
 * focus entered the frame within the last five seconds and has not left
 * since, tracked by the component's own focus/blur listeners. Anything else
 * is refused with a console warning — never fired, never silently dropped.
 *
 * ⚠ What this is and is not. It is a **mitigation** against a frame acting
 * unprompted, not a proof that a person meant the action: it says "a person
 * is in this frame right now", nothing more. The authority is the server —
 * `canActOnMessage` judges every message write against the viewer's own
 * permissions — and a frame acts with exactly its **viewer's** permissions,
 * never more. Requiring the frame to be the *current* focus — not merely
 * "user-activation is active somewhere" — is what keeps a click elsewhere on
 * the page from vouching for this frame's invoke (the third pass's own
 * complaint about `userActivation` alone, W3).
 *
 * Three verbs are further **confirm-gated**: `delete` by the host's own
 * modal (the same one the message row opens), and `retry` and `extend`
 * here — the first spends tokens, the second re-drives generation, and
 * neither press is the person's own — with a question the component puts to
 * the person before dispatch. Stop and branch are not gated at all: stop is
 * the safety verb and branch creates rather than changes.
 *
 * Pure, so it is tested without a DOM: the component owns the listeners and
 * the live `navigator`/`document` reads, and hands the two facts in.
 */

import {
	PERSON_GATED_CORE_VERBS,
	PERSON_PRESS_WINDOW_MS,
	isPersonGatedAction,
	personPressCurrent
} from "@serene-pub/sdk"

/**
 * Core's verbs that alter a message, and so need a person behind them — the
 * SDK's one table (`PERSON_GATED_CORE_VERBS`), which the component harness
 * judges by too.
 */
export const STATE_CHANGING_CORE_VERBS: ReadonlySet<string> = PERSON_GATED_CORE_VERBS

/**
 * Core's verbs a frame may invoke only after the person is asked — beyond
 * the activation check — and the question to ask. `delete` is not listed:
 * the host's handler opens its own confirmation modal, so listing it would
 * ask twice.
 */
export const FRAME_CONFIRM_QUESTIONS: Readonly<Record<string, string>> = {
	retry: "A widget asks to regenerate a reply, which spends tokens. Go ahead?",
	extend: "A widget asks to extend a reply, which spends tokens. Go ahead?",
	// The composer's Continue (B7): it starts a turn, so it spends tokens too.
	advance: "A widget asks to take the next turn, which spends tokens. Go ahead?",
	// The narrator's turn (B8) starts one too. `pick` is not listed: it opens
	// the host's own picker, which is the asking.
	narrate: "A widget asks the narrator to take a turn, which spends tokens. Go ahead?"
}
export const CONFIRMED_FRAME_VERBS: ReadonlySet<string> = new Set(
	Object.keys(FRAME_CONFIRM_QUESTIONS)
)

/**
 * How long a person having entered the frame vouches for an invoke — the
 * third pass's fixed window, kept only as the fallback for a browser with no
 * `navigator.userActivation` (Firefox, as of writing). See `hasRecentActivation`.
 * The SDK's `PERSON_PRESS_WINDOW_MS`, the component harness's window too.
 */
export const FRAME_ACTIVATION_WINDOW_MS = PERSON_PRESS_WINDOW_MS

export interface FrameActivation {
	/**
	 * When the host last saw focus enter the frame, or null — null also once
	 * focus has left it again (the component resets on blur), so "entered
	 * and still inside" is what a non-null value means. Read only as the
	 * fallback window; the live check below does not consult it.
	 */
	lastInteractionAt: number | null
}

/**
 * The two live browser facts activation *inside* an opaque-origin iframe
 * leaves on the parent (fourth pass, W4) — read by the component, which owns
 * `navigator`/`document`, and handed in so this module stays DOM-free.
 */
export interface LiveFrameActivation {
	/**
	 * `navigator.userActivation?.isActive`. `undefined` where the API does
	 * not exist (Firefox, as of writing) — the caller's signal to fall back
	 * to the fixed window, not "activation is inactive".
	 */
	userActivationActive: boolean | undefined
	/** `document.activeElement === ` the frame element. */
	frameIsActiveElement: boolean
}

/** Does this core verb need a recent activation before a frame may invoke it? */
export const needsActivation = (coreKey: string): boolean =>
	STATE_CHANGING_CORE_VERBS.has(coreKey)

/** Does this core verb need the person asked before a frame may invoke it? */
export const needsConfirmation = (coreKey: string): boolean =>
	CONFIRMED_FRAME_VERBS.has(coreKey)

/**
 * A person is in the frame right now.
 *
 * The live read wins whenever the browser can answer it: the transient
 * activation flag set, *and* the frame currently holding focus — both, so a
 * click elsewhere on the page (which sets `userActivation` alone) vouches
 * for nothing here (W3's complaint, still honoured). Only when
 * `live.userActivationActive` is `undefined` — the API does not exist — does
 * this fall back to the third pass's fixed window over `state`.
 */
export function hasRecentActivation(
	state: FrameActivation,
	now: number = Date.now(),
	live?: LiveFrameActivation
): boolean {
	if (live && live.userActivationActive !== undefined)
		return live.userActivationActive && live.frameIsActiveElement
	return personPressCurrent(state.lastInteractionAt, now)
}

export type FrameInvokeVerdict =
	| {
			allowed: true
			/** Set when the person must be asked first; the question to put to them. */
			confirm?: string
	  }
	| { allowed: false; reason: string }

/**
 * Whether a frame's invoke of a resolved action may proceed, and the
 * sentence to warn with when it may not — or, when it may, the question to
 * ask first for a verb in `CONFIRMED_FRAME_VERBS`. Only a core verb in the
 * state-changing set is gated; a contributed action is the server's to
 * judge (its audience), and the other core verbs are not changes.
 */
export function frameInvokeVerdict(
	action: { specSlug: string; key: string },
	state: FrameActivation,
	now: number = Date.now(),
	live?: LiveFrameActivation
): FrameInvokeVerdict {
	if (!isPersonGatedAction(action)) return { allowed: true }
	if (!hasRecentActivation(state, now, live))
		return {
			allowed: false,
			reason:
				`'core#${action.key}' changes a message and needs a person behind it — a frame may ` +
				`invoke it only while a person is currently interacting with it (or, where that ` +
				`cannot be seen, within ${FRAME_ACTIVATION_WINDOW_MS / 1000}s of focus entering the ` +
				`frame and before it leaves), never on its own`
		}
	const confirm = FRAME_CONFIRM_QUESTIONS[action.key]
	return confirm === undefined ? { allowed: true } : { allowed: true, confirm }
}
