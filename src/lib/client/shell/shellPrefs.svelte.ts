/**
 * Per-browser shell preferences: the ones that describe how THIS screen
 * should feel rather than anything about the account, persisted to
 * localStorage beside `serene-pub:shell` and `serene-pub:railWide`.
 *
 * - `dockWidth` — the width a docked view comes back at: the 400px dock or
 *   half the room right of the rail. Focus is not a dock width; it is its own
 *   address (see Layout.svelte, "Focus").
 * - `animateViews` — whether opening, resizing and focusing a view animate.
 *   `prefers-reduced-motion` wins over it in CSS regardless.
 * - `proseScale` — the story text size, as a multiple of the 17px the
 *   message styles are drawn at. Written to `--sp-prose-scale` on the root so
 *   the packs can read it without importing anything.
 * - `headerFurled` — the session header rolled up out of the way (next-pass
 *   note 29, 2026-10-02): the bar across a session's top — its name, faces
 *   and genre, the Layout button — and the layout's top strips with it. Per
 *   device, since how much room a screen has is the screen's question.
 *   ⚠ Not **Stage only** (the shell's Ctrl+., which hides the rail, the views
 *   and every side) and not **tucked** sides (the session's narrow-box rule).
 *
 * Every read and write is guarded: storage can throw (private windows,
 * blocked site data) and the shell must still draw without it.
 */

export type DockWidth = "dock" | "half"

const DOCK_WIDTH_KEY = "serene-pub:dockWidth"
const ANIMATE_KEY = "serene-pub:animateViews"
const PROSE_SCALE_KEY = "serene-pub:proseScale"
const HEADER_FURLED_KEY = "serene-pub:sessionHeaderFurled"

/** The story text sizes offered, in px at scale 1 = 17px. */
export const PROSE_SIZES = [16, 17, 18, 20] as const

function read(key: string): string | null {
	try {
		return typeof localStorage === "undefined"
			? null
			: localStorage.getItem(key)
	} catch {
		return null
	}
}

function write(key: string, value: string) {
	try {
		localStorage.setItem(key, value)
	} catch {}
}

function applyProseScale(scale: number) {
	if (typeof document === "undefined") return
	document.documentElement.style.setProperty(
		"--sp-prose-scale",
		String(scale)
	)
}

class ShellPrefs {
	dockWidth = $state<DockWidth>(read(DOCK_WIDTH_KEY) === "half" ? "half" : "dock")
	animateViews = $state(read(ANIMATE_KEY) !== "false")
	proseScale = $state(Number(read(PROSE_SCALE_KEY)) || 1)
	headerFurled = $state(read(HEADER_FURLED_KEY) === "true")

	constructor() {
		applyProseScale(this.proseScale)
	}

	setDockWidth(next: DockWidth) {
		this.dockWidth = next
		write(DOCK_WIDTH_KEY, next)
	}

	setAnimateViews(next: boolean) {
		this.animateViews = next
		write(ANIMATE_KEY, String(next))
	}

	/** The story text size in px (16–20), the unit Settings shows. */
	get proseSize(): number {
		return Math.round(this.proseScale * 17)
	}

	setHeaderFurled(next: boolean) {
		this.headerFurled = next
		write(HEADER_FURLED_KEY, String(next))
	}

	setProseSize(px: number) {
		this.proseScale = px / 17
		write(PROSE_SCALE_KEY, String(this.proseScale))
		applyProseScale(this.proseScale)
	}
}

export const shellPrefs = new ShellPrefs()
