/**
 * 🚧 M2e ★C-1 `leaveDestination`: where an applet's launcher goes when it is
 * left (owner, 2026-11-04): back where you came from — Apps when entered from
 * Apps, Home from Home, Sessions as the fallback.
 *
 * What it is: a pure decision over the history state an applet card writes
 * (`from`) and whether the Apps view is registered (it is only while an applet
 * is listed, ★N1). What it is not: a router — the launcher does the going.
 */
export type LeaveDestination = "apps" | "home" | "sessions"

/** The two places a card is drawn: the Apps view and Home. */
export type AppletCardOrigin = "apps" | "home"

export function leaveDestination(
	from: unknown,
	appsRegistered: boolean
): LeaveDestination {
	if (from === "apps" && appsRegistered) return "apps"
	if (from === "home") return "home"
	// A cold load (`page.state` is `{}`), junk, or Apps no longer registered.
	return "sessions"
}
