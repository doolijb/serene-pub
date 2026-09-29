/**
 * Every admin address and the section it shows — the table the Admin view's
 * router (`adminRouter.svelte.ts`) matches against. Each entry loads its
 * components lazily, so the shell does not carry the pipeline workspace just
 * because the rail has an Admin item.
 *
 * A `layout` wraps its `page` the way a SvelteKit `+layout.svelte` did: the
 * list-and-detail sections draw their list in the layout and the item in the
 * page. Literal segments come before `:params` so `/new` and `/events` are
 * never read as an id.
 */
import type { Component } from "svelte"

type Loader = () => Promise<{ default: Component<any> }>

export interface AdminRoute {
	pattern: string
	page: Loader
	layout?: Loader
}

export interface AdminMatch {
	pattern: string
	params: Record<string, string>
	route: AdminRoute | null
}

const empty: Loader = () => import("./sections/Empty.svelte")

const S = {
	overview: () => import("./sections/overview/Page.svelte"),
	defaults: () => import("./sections/defaults/Page.svelte"),
	connections: () => import("./sections/connections/Page.svelte"),
	connectionsNew: () => import("./sections/connections/NewPage.svelte"),
	connectionsId: () => import("./sections/connections/IdPage.svelte"),
	sampling: () => import("./sections/sampling/Page.svelte"),
	samplingNew: () => import("./sections/sampling/NewPage.svelte"),
	samplingId: () => import("./sections/sampling/IdPage.svelte"),
	users: () => import("./sections/users/Layout.svelte"),
	usersNew: () => import("./sections/users/NewPage.svelte"),
	usersInvites: () => import("./sections/users/InvitesPage.svelte"),
	usersId: () => import("./sections/users/IdPage.svelte"),
	sessions: () => import("./sections/sessions/Page.svelte"),
	genres: () => import("./sections/session-genres/Layout.svelte"),
	genresId: () => import("./sections/session-genres/IdPage.svelte"),
	presets: () => import("./sections/session-presets/Layout.svelte"),
	presetsNew: () => import("./sections/session-presets/NewPage.svelte"),
	presetsId: () => import("./sections/session-presets/IdPage.svelte"),
	pipelines: () => import("./sections/pipelines/Page.svelte"),
	events: () => import("./sections/pipelines/EventsPage.svelte"),
	workspace: () => import("./sections/pipelines/SlugPage.svelte"),
	configurations: () => import("./sections/configurations/Page.svelte"),
	scripts: () => import("./sections/scripts/Layout.svelte"),
	scriptsNew: () => import("./sections/scripts/NewPage.svelte"),
	scriptsId: () => import("./sections/scripts/IdPage.svelte"),
	prompts: () => import("./sections/prompts/Layout.svelte"),
	promptsId: () => import("./sections/prompts/IdPage.svelte"),
	context: () => import("./sections/context-templates/Layout.svelte"),
	contextNew: () => import("./sections/context-templates/NewPage.svelte"),
	contextId: () => import("./sections/context-templates/IdPage.svelte"),
	variables: () => import("./sections/variable-templates/Layout.svelte"),
	variablesNew: () => import("./sections/variable-templates/NewPage.svelte"),
	variablesId: () => import("./sections/variable-templates/IdPage.svelte"),
	completion: () => import("./sections/completion-templates/Layout.svelte"),
	completionId: () => import("./sections/completion-templates/IdPage.svelte"),
	plugins: () => import("./sections/plugins/Page.svelte"),
	components: () => import("./sections/components/Page.svelte"),
	componentsId: () => import("./sections/components/IdPage.svelte"),
	general: () => import("./sections/general/Page.svelte"),
	network: () => import("./sections/network/Page.svelte"),
	data: () => import("./sections/data/Page.svelte"),
	diagnostics: () => import("./sections/diagnostics/Page.svelte"),
	history: () => import("./sections/history/Page.svelte")
} satisfies Record<string, Loader>

export const ADMIN_ROUTES: AdminRoute[] = [
	{ pattern: "/admin", page: S.overview },
	{ pattern: "/admin/defaults", page: S.defaults },
	{ pattern: "/admin/connections", page: S.connections },
	{ pattern: "/admin/connections/new", page: S.connectionsNew },
	{ pattern: "/admin/connections/:id", page: S.connectionsId },
	{ pattern: "/admin/sampling", page: S.sampling },
	{ pattern: "/admin/sampling/new", page: S.samplingNew },
	{ pattern: "/admin/sampling/:id", page: S.samplingId },
	{ pattern: "/admin/users", layout: S.users, page: empty },
	{ pattern: "/admin/users/new", layout: S.users, page: S.usersNew },
	{ pattern: "/admin/users/invites", layout: S.users, page: S.usersInvites },
	{ pattern: "/admin/users/:id", layout: S.users, page: S.usersId },
	{ pattern: "/admin/sessions", page: S.sessions },
	{ pattern: "/admin/session-genres", layout: S.genres, page: empty },
	{ pattern: "/admin/session-genres/:id", layout: S.genres, page: S.genresId },
	{ pattern: "/admin/session-presets", layout: S.presets, page: empty },
	{ pattern: "/admin/session-presets/new", layout: S.presets, page: S.presetsNew },
	{ pattern: "/admin/session-presets/:id", layout: S.presets, page: S.presetsId },
	{ pattern: "/admin/pipelines", page: S.pipelines },
	{ pattern: "/admin/pipelines/events", page: S.events },
	{ pattern: "/admin/pipelines/:slug", page: S.workspace },
	{ pattern: "/admin/configurations", page: S.configurations },
	{ pattern: "/admin/scripts", layout: S.scripts, page: empty },
	{ pattern: "/admin/scripts/new", layout: S.scripts, page: S.scriptsNew },
	{ pattern: "/admin/scripts/:id", layout: S.scripts, page: S.scriptsId },
	{ pattern: "/admin/prompts", layout: S.prompts, page: empty },
	{ pattern: "/admin/prompts/:id", layout: S.prompts, page: S.promptsId },
	{ pattern: "/admin/context-templates", layout: S.context, page: empty },
	{ pattern: "/admin/context-templates/new", layout: S.context, page: S.contextNew },
	{ pattern: "/admin/context-templates/:id", layout: S.context, page: S.contextId },
	{ pattern: "/admin/variable-templates", layout: S.variables, page: empty },
	{ pattern: "/admin/variable-templates/new", layout: S.variables, page: S.variablesNew },
	{ pattern: "/admin/variable-templates/:id", layout: S.variables, page: S.variablesId },
	{ pattern: "/admin/completion-templates", layout: S.completion, page: empty },
	{ pattern: "/admin/completion-templates/:id", layout: S.completion, page: S.completionId },
	{ pattern: "/admin/plugins", page: S.plugins },
	{ pattern: "/admin/components", page: S.components },
	{ pattern: "/admin/components/:id", page: S.componentsId },
	{ pattern: "/admin/general", page: S.general },
	{ pattern: "/admin/network", page: S.network },
	{ pattern: "/admin/data", page: S.data },
	{ pattern: "/admin/diagnostics", page: S.diagnostics },
	{ pattern: "/admin/history", page: S.history }
]

/** Addresses that moved, kept working (`/admin/settings` was one page). */
const ALIASES: Record<string, string> = {
	"/admin/settings": "/admin/general",
	"/admin/servers": "/admin/network"
}

export function resolveAdminAlias(href: string): string {
	const q = href.indexOf("?")
	const path = (q === -1 ? href : href.slice(0, q)).replace(/\/$/, "")
	const target = ALIASES[path]
	return target ? target + (q === -1 ? "" : href.slice(q)) : href
}

/**
 * Match a path against the table. Unknown addresses fall back to the
 * Overview with `route: null`, so the view can say "not found" instead of
 * going blank.
 */
export function matchAdminRoute(path: string): AdminMatch {
	const parts = path.split("/").filter(Boolean)
	for (const route of ADMIN_ROUTES) {
		const pp = route.pattern.split("/").filter(Boolean)
		if (pp.length !== parts.length) continue
		const params: Record<string, string> = {}
		let ok = true
		for (let i = 0; i < pp.length; i++) {
			if (pp[i].startsWith(":")) params[pp[i].slice(1)] = decodeURIComponent(parts[i])
			else if (pp[i] !== parts[i]) {
				ok = false
				break
			}
		}
		if (ok) return { pattern: route.pattern, params, route }
	}
	return { pattern: "/admin", params: {}, route: null }
}

/** The nav row a path belongs to: the longest section prefix, `/admin` only exactly. */
export function sectionHrefFor(path: string, hrefs: string[]): string | null {
	let best: string | null = null
	for (const h of hrefs) {
		const hit = h === "/admin" ? path === "/admin" : path === h || path.startsWith(h + "/")
		if (hit && (!best || h.length > best.length)) best = h
	}
	return best
}
