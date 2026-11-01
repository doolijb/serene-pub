import type { WidgetRequests } from "@serene-pub/sdk"

/** The open session's full screen, as the request needs it (structural). */
export interface SessionFullscreenControl {
	readonly on: boolean
	enter(): void
	exit(): void
	toggle(): void
}

/**
 * 🚧 `session-fullscreen` (M0, SHAPES L1): a widget or frame asks the
 * open session to enter, leave or toggle full screen. It is a person's press
 * routed through a widget, so it is refused without a live user activation;
 * and it never takes the browser full screen (`display`).
 */
export function answerSessionFullscreen(
	params: WidgetRequests["session-fullscreen"]["params"],
	control: SessionFullscreenControl | null
): void {
	if (!control) throw new Error("There is no session open to show full screen.")
	const activation =
		typeof navigator !== "undefined" ? navigator.userActivation : undefined
	if (activation && !activation.isActive) {
		throw new Error("Full screen changes only when someone presses for it.")
	}
	const on = params?.on
	if (on === true) control.enter()
	else if (on === false) control.exit()
	else control.toggle()
}
