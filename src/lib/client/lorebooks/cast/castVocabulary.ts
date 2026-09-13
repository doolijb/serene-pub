/**
 * What a cast member's state and visibility look like, in one place.
 *
 * The Cast list, the member form and the graph's node list all draw the same
 * two badges, and a badge that means one thing in a list and another on a
 * canvas is a badge nobody can read.
 */

export const CAST_STATES = [
	"active",
	"deceased",
	"missing",
	"departed"
] as const

export const CAST_VISIBILITIES = ["normal", "legendary", "hidden"] as const

const STATE_COLOR: Record<string, string> = {
	active: "preset-tonal-primary",
	deceased: "preset-tonal-error",
	missing: "preset-tonal-surface",
	departed: "preset-tonal-secondary"
}

const STATE_RING: Record<string, string> = {
	active: "ring-primary-500",
	deceased: "ring-error-500",
	missing: "ring-surface-400",
	departed: "ring-secondary-500"
}

const VISIBILITY_COLOR: Record<string, string> = {
	normal: "preset-tonal-surface",
	legendary: "preset-tonal-warning",
	hidden: "preset-tonal-surface"
}

export function stateBadge(state: string): { color: string; ring: string } {
	return {
		color: STATE_COLOR[state] ?? "preset-tonal-surface",
		ring: STATE_RING[state] ?? "ring-surface-400"
	}
}

export function visibilityBadge(visibility: string): string {
	return VISIBILITY_COLOR[visibility] ?? "preset-tonal-surface"
}
