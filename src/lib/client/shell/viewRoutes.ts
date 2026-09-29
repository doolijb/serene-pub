/**
 * The addresses views own when they are focused.
 *
 * A view shows at one of three widths — docked beside the page, half the
 * room, or focused over it — and only Focus writes to the address bar.
 * Entering Focus from a page shallow-routes (`pushState`) to the view's
 * address, so the page underneath stays mounted and Back steps down a width
 * instead of leaving it. Loading one of these addresses cold renders an empty
 * route page and the shell focuses the view over it (see Layout.svelte,
 * "Focus").
 *
 * A view missing from this table can still be focused; it just keeps the
 * address of the page it was focused over. Pipelines (`/pipelines/*` are real
 * pages), Users and Legacy are left out on purpose.
 *
 * Admin and Help own whole trees (`/admin/prompts/12`, `/docs/sessions`): the
 * address is the section or page on screen, which each view's router supplies
 * (`registerViewAddress`). Help's is `/docs` because that is where every
 * compiled documentation link already points.
 */
export const VIEW_ROUTES: Readonly<Record<string, string>> = {
	sessions: "/sessions",
	characters: "/characters",
	library: "/library",
	lorebooks: "/lorebooks",
	tags: "/tags",
	connections: "/connections",
	sampling: "/sampling",
	settings: "/settings",
	activity: "/activity",
	help: "/docs",
	admin: "/admin"
}

/** Views whose address is a tree under their root, not one path. */
const TREE_VIEWS = new Set(["admin", "help"])

/** A view's current address when it is more than its root (Admin's section, Help's page). */
const addressProviders = new Map<string, () => string>()

export function registerViewAddress(key: string, provider: () => string) {
	addressProviders.set(key, provider)
}

/** The address a focused view writes: its current one, else its root. */
export function viewAddress(key: string): string | null {
	return addressProviders.get(key)?.() ?? viewPath(key)
}

/** The address a view owns when focused, or null when it owns none. */
export function viewPath(key: string): string | null {
	return Object.prototype.hasOwnProperty.call(VIEW_ROUTES, key)
		? VIEW_ROUTES[key]
		: null
}

/** The view whose address this is (an exact match, trailing slash allowed). */
export function viewForPath(pathname: string): string | null {
	const path =
		pathname.length > 1 && pathname.endsWith("/")
			? pathname.slice(0, -1)
			: pathname
	for (const [key, route] of Object.entries(VIEW_ROUTES)) {
		if (route === path) return key
		if (TREE_VIEWS.has(key) && path.startsWith(route + "/")) return key
	}
	return null
}

/** The widths a view can be shown at. */
export type ViewWidth = "dock" | "half" | "focus"

/** Ctrl+\ steps through the widths in this order and wraps. */
export function nextWidth(current: ViewWidth): ViewWidth {
	return current === "dock" ? "half" : current === "half" ? "focus" : "dock"
}

/**
 * Where a released drag of the sidebar's edge lands: the snap point nearest
 * the pointer, with Focus claimed early (past 85% of the room) because
 * dragging all the way to the window's edge is a long way to go for it.
 *
 * `x` is the sidebar's would-be width and `room` everything right of the rail.
 */
export function snapWidth(x: number, room: number, dock = 400): ViewWidth {
	if (room <= 0) return "dock"
	if (x >= room * 0.85) return "focus"
	const half = room / 2
	return Math.abs(x - dock) <= Math.abs(x - half) ? "dock" : "half"
}
