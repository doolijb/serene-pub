/**
 * 🚧 (M2b) The review list's three groups. A package's permissions are shown, and
 * granted, group by group: what a frame may do in a session, what its applet may
 * do outside one, and the sandbox's own reach on this pub. Pure, so the install
 * review (before upload) and the plugin page (live ticks) group alike.
 */
import { permissionGroup, type PermissionGroup } from "./declaredPermissions"

/** The groups in review order, each with the heading the list shows. */
export const PERMISSION_GROUP_HEADINGS: ReadonlyArray<{ group: PermissionGroup; heading: string }> = [
	{ group: "session", heading: "In a session" },
	{ group: "applet", heading: "Outside a session — its applet" },
	{ group: "system", heading: "On this pub" }
]

/** The rows that belong to each group, in review order; an empty group is left out. */
export function groupPermissionRows<T extends { key: string }>(
	rows: readonly T[]
): Array<{ group: PermissionGroup; heading: string; rows: T[] }> {
	return PERMISSION_GROUP_HEADINGS.map(({ group, heading }) => ({
		group,
		heading,
		rows: rows.filter((r) => permissionGroup(r.key) === group)
	})).filter((g) => g.rows.length > 0)
}

/** Tick or untick every key of one group, leaving the others as they are. */
export function setGroupTicks(
	ticks: Record<string, boolean>,
	keys: readonly string[],
	on: boolean
): Record<string, boolean> {
	const next = { ...ticks }
	for (const k of keys) next[k] = on
	return next
}
