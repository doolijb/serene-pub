/**
 * The admin sections, as data.
 *
 * Two things read this list: the admin shell's own rail
 * (`routes/admin/+layout.svelte`) and the Jump overlay, which offers the same
 * pages as an **Admin pages** group. It lives here rather than in the route so
 * the second reader does not have to import a `+layout.svelte`, and so nobody
 * is tempted to keep a second copy of it in step by hand — a jump that opens a
 * page the rail has renamed, or misses one the rail has gained, is exactly the
 * rot a duplicated table produces.
 *
 * `icon` is a name from the app's lucide set, resolved by each reader
 * (`Icons[item.icon]`), so this module carries no component imports and stays
 * cheap for the shell to load.
 */

import type * as Icons from "@lucide/svelte"

export interface AdminNavItem {
	href: string
	label: string
	icon: keyof typeof Icons
}

export interface AdminNavGroup {
	group: string
	items: AdminNavItem[]
}

/** The path the Users section lives at; see `adminNavFor`. */
export const ADMIN_USERS_HREF = "/admin/users"

/** The path the Updates section lives at; see `adminNavFor`. */
export const ADMIN_UPDATES_HREF = "/admin/updates"

/**
 * Grouped by the job a person came to do (ruled 2026-09-27, the admin
 * overhaul), not by the table behind it. An empty `group` draws no label:
 * Overview stands alone at the top. Instance is what Settings and Servers
 * were, split by topic; `/admin/settings` and `/admin/servers` redirect.
 */
export const ADMIN_NAV: AdminNavGroup[] = [
	{
		group: "",
		items: [{ href: "/admin", label: "Overview", icon: "Gauge" }]
	},
	{
		group: "Models",
		items: [
			// Defaults first: it is the question the other two answer —
			// which connection, with which sampling, does each job.
			{ href: "/admin/defaults", label: "Defaults", icon: "Target" },
			{ href: "/admin/connections", label: "Connections", icon: "Cable" },
			{
				href: "/admin/sampling",
				label: "Sampling",
				icon: "SlidersHorizontal"
			}
		]
	},
	{
		group: "People",
		items: [
			{ href: ADMIN_USERS_HREF, label: "Users", icon: "Users" },
			{
				href: "/admin/sessions",
				label: "Sessions",
				icon: "MessagesSquare"
			}
		]
	},
	{
		group: "Play",
		items: [
			{ href: "/admin/session-genres", label: "Genres", icon: "Shapes" },
			{ href: "/admin/session-presets", label: "Presets", icon: "Ticket" }
		]
	},
	{
		group: "Pipelines",
		items: [
			{ href: "/admin/pipelines", label: "Pipelines", icon: "Workflow" },
			{ href: "/admin/pipelines/events", label: "Events", icon: "Zap" },
			{
				href: "/admin/configurations",
				label: "Configurations",
				icon: "SlidersVertical"
			},
			{ href: "/admin/scripts", label: "Scripts", icon: "SquareCode" }
		]
	},
	{
		group: "Writing",
		items: [
			{
				href: "/admin/prompts",
				label: "Prompts",
				icon: "MessageSquareText"
			},
			{
				href: "/admin/context-templates",
				label: "Context templates",
				icon: "LayoutTemplate"
			},
			// Beside the context templates because they are the two halves
			// of one rendered prompt: that one is the words, this one is
			// what wraps each block of them.
			{
				href: "/admin/completion-templates",
				label: "Completion templates",
				icon: "Brackets"
			},
			{
				href: "/admin/variable-templates",
				label: "Variable templates",
				icon: "Braces"
			}
		]
	},
	{
		group: "Extensions",
		items: [
			{ href: "/admin/plugins", label: "Plugins", icon: "Puzzle" },
			// Beside Plugins because both put widgets on a session page: a
			// plugin's arrive packaged, an authored component is written here.
			{ href: "/admin/components", label: "Components", icon: "Blocks" }
		]
	},
	{
		group: "Pub",
		items: [
			{ href: "/admin/general", label: "General", icon: "Settings" },
			{ href: "/admin/network", label: "Network", icon: "Globe" },
			{
				href: "/admin/data",
				label: "Data and backups",
				icon: "Database"
			},
			{
				href: "/admin/diagnostics",
				label: "Diagnostics",
				icon: "Activity"
			},
			// Who changed what, and when — every section's changes in one
			// list (the admin logbook). A change form links here with
			// `?type=…&id=…` for one object's history.
			{ href: "/admin/history", label: "History", icon: "History" },
			// Hidden on a pre-release build, which never updates itself.
			{ href: ADMIN_UPDATES_HREF, label: "Updates", icon: "CircleArrowUp" }
		]
	}
]

/**
 * With accounts off there is no roster to manage: the Users section (and its
 * handlers, server-side) exists only when accounts do. Filtering the nav model
 * keeps empty groups from rendering a bare label — and keeps the Jump overlay
 * from offering a page that is not there.
 */
export function adminNavFor(
	accountsEnabled: boolean,
	isPrerelease = false
): AdminNavGroup[] {
	if (accountsEnabled && !isPrerelease) return ADMIN_NAV
	// A pre-release never updates itself, so it has no Updates section.
	const hidden = new Set<string>([
		...(accountsEnabled ? [] : [ADMIN_USERS_HREF]),
		...(isPrerelease ? [ADMIN_UPDATES_HREF] : [])
	])
	return ADMIN_NAV.map((s) => ({
		...s,
		items: s.items.filter((i) => !hidden.has(i.href))
	})).filter((s) => s.items.length > 0)
}

/** Every section as one flat list, which is what a search wants. */
export function adminNavItems(
	accountsEnabled: boolean,
	isPrerelease = false
): AdminNavItem[] {
	return adminNavFor(accountsEnabled, isPrerelease).flatMap((s) => s.items)
}
