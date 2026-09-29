/**
 * The admin settings Jump can find, one row per thing an administrator
 * changes — "tunnel", "backup", "two-factor" — each pointing at the exact
 * field (`#target`, landed on by AdminView) rather than the top of its page.
 *
 * A table, like `adminNav.ts`, and for the same reason: the fields are
 * written in markup, so something has to name them for search. A row whose
 * target moves is caught by `adminSettings.test.ts`, which checks every
 * target is present in the source of the section it points into.
 */

import { TRANSFORMS, capabilityLabel, type CapabilityId } from "@serene-pub/sdk"
import { ADMIN_USERS_HREF } from "./adminNav"

export interface AdminSetting {
	/** What the row says, in the words on the field. */
	label: string
	/** The section's address plus `#target` (an element id or `data-field`). */
	href: string
	/** The page it lives on, the row's second line. */
	page: string
	/** Other words a person might type for it. */
	keywords?: string
}

const STATIC: AdminSetting[] = [
	// General
	{ label: "Default language", href: "/admin/general#language-heading", page: "General", keywords: "locale translation interface" },
	{ label: "Automatic translation", href: "/admin/general#enable-auto-translate", page: "General", keywords: "libretranslate translate service url" },
	{ label: "User accounts", href: "/admin/general#accounts", page: "General", keywords: "login sign in password multi-user" },
	{ label: "Community library: CharaVault", href: "/admin/general#charavault-heading", page: "General", keywords: "characters import cards" },
	{ label: "Run scripts", href: "/admin/general#scripts-enabled", page: "General", keywords: "scripting pipeline scripts" },
	// Network
	{ label: "Tunnel", href: "/admin/network#tunnel-heading", page: "Network", keywords: "remote access cloudflare public hostname connector token domain" },
	{ label: "Start the tunnel when the app starts", href: "/admin/network#tunnel-autostart", page: "Network", keywords: "autostart" },
	{ label: "Allowed hosts", href: "/admin/network#hosts-heading", page: "Network", keywords: "origin hostname lan" },
	// Data
	{ label: "Back up daily", href: "/admin/data#backup-daily", page: "Data and backups", keywords: "schedule automatic" },
	{ label: "Include user files in backups", href: "/admin/data#backup-include-user-files", page: "Data and backups", keywords: "images avatars media" },
	{ label: "Back up now", href: "/admin/data#backup-now", page: "Data and backups", keywords: "backup snapshot export" },
	{ label: "Backups", href: "/admin/data#backups-list", page: "Data and backups", keywords: "delete restore" },
	{ label: "Databases set aside", href: "/admin/data#set-aside", page: "Data and backups", keywords: "recovery corrupt" },
	// Diagnostics
	{ label: "Context debugging", href: "/admin/diagnostics#enable-context-debugging", page: "Diagnostics", keywords: "prompt debug logs" },
	// Extensions
	{ label: "Plugin sandbox", href: "/admin/plugins#plugin-sandbox", page: "Plugins", keywords: "SP_PLUGINS_ENABLED hooks enable" },
	{ label: "Installed plugins", href: "/admin/plugins#installed-plugins", page: "Plugins", keywords: "extensions permissions backend" },
	{ label: "Recent hook calls", href: "/admin/plugins#hook-calls", page: "Plugins", keywords: "errors timeouts" },
	// People
	{ label: "Invites", href: `${ADMIN_USERS_HREF}/invites`, page: "Users", keywords: "invite link sign up" },
	{ label: "Add a user", href: `${ADMIN_USERS_HREF}/new`, page: "Users", keywords: "new account" }
]

/** One row per model job on Defaults, named as that page names it. */
function defaultsRows(): AdminSetting[] {
	return (Object.keys(TRANSFORMS) as CapabilityId[]).map((id) => ({
		label: `Default model for ${capabilityLabel(id)}`,
		href: `/admin/defaults#default:${id}`,
		page: "Defaults",
		keywords: `${id} connection sampling job`
	}))
}

/** Every row, filtered to what exists on this install. */
export function adminSettings(opts: { accountsEnabled: boolean }): AdminSetting[] {
	const rows = [...STATIC, ...defaultsRows()]
	return opts.accountsEnabled
		? rows
		: rows.filter((r) => !r.href.startsWith(ADMIN_USERS_HREF))
}

/**
 * Rows where every word of the query appears in the label, page or keywords;
 * label matches first.
 */
export function matchAdminSettings(
	rows: AdminSetting[],
	query: string,
	cap: number
): AdminSetting[] {
	const words = query.toLowerCase().split(/\s+/).filter(Boolean)
	if (!words.length) return []
	const scored: { row: AdminSetting; rank: number }[] = []
	for (const row of rows) {
		const label = row.label.toLowerCase()
		const rest = `${row.page} ${row.keywords ?? ""}`.toLowerCase()
		let inLabel = 0
		let ok = true
		for (const w of words) {
			if (label.includes(w)) inLabel++
			else if (!rest.includes(w)) {
				ok = false
				break
			}
		}
		if (ok) scored.push({ row, rank: words.length - inLabel })
	}
	scored.sort((a, b) => a.rank - b.rank)
	return scored.slice(0, cap).map((s) => s.row)
}
