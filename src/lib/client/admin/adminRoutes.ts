/**
 * Every admin address and the section it shows — the table the Admin view's
 * router (`adminRouter.svelte.ts`) matches against. Each entry loads its
 * components lazily, so the shell does not carry the pipeline workspace just
 * because the rail has an Admin item.
 *
 * Every object section is Django-shaped (note 37, STYLE-GUIDE §6.11): the
 * changelist at `/admin/<section>`, the add form at `/new`, the change form
 * at `/:id` — each its own page, never a list beside a detail. A `layout`
 * may still wrap a `page` the way a SvelteKit `+layout.svelte` did; no
 * section uses one today. Literal segments come before `:params` so `/new`,
 * `/invites` and `/events` are never read as an id.
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

const S = {
	overview: () => import("./sections/overview/Page.svelte"),
	defaults: () => import("./sections/defaults/Page.svelte"),
	connections: () => import("./sections/connections/Page.svelte"),
	connectionsNew: () => import("./sections/connections/NewPage.svelte"),
	connectionsId: () => import("./sections/connections/IdPage.svelte"),
	sampling: () => import("./sections/sampling/Page.svelte"),
	samplingNew: () => import("./sections/sampling/NewPage.svelte"),
	samplingId: () => import("./sections/sampling/IdPage.svelte"),
	users: () => import("./sections/users/Page.svelte"),
	usersNew: () => import("./sections/users/NewPage.svelte"),
	usersInvites: () => import("./sections/users/InvitesPage.svelte"),
	usersId: () => import("./sections/users/IdPage.svelte"),
	sessions: () => import("./sections/sessions/Page.svelte"),
	genres: () => import("./sections/session-genres/Page.svelte"),
	genresId: () => import("./sections/session-genres/IdPage.svelte"),
	presets: () => import("./sections/session-presets/Page.svelte"),
	presetsNew: () => import("./sections/session-presets/NewPage.svelte"),
	presetsId: () => import("./sections/session-presets/IdPage.svelte"),
	pipelines: () => import("./sections/pipelines/Page.svelte"),
	events: () => import("./sections/pipelines/EventsPage.svelte"),
	eventsId: () => import("./sections/pipelines/EventIdPage.svelte"),
	workspace: () => import("./sections/pipelines/SlugPage.svelte"),
	configurations: () => import("./sections/configurations/Page.svelte"),
	scripts: () => import("./sections/scripts/Page.svelte"),
	scriptsNew: () => import("./sections/scripts/NewPage.svelte"),
	scriptsId: () => import("./sections/scripts/IdPage.svelte"),
	prompts: () => import("./sections/prompts/Page.svelte"),
	promptsNew: () => import("./sections/prompts/NewPage.svelte"),
	promptsId: () => import("./sections/prompts/IdPage.svelte"),
	context: () => import("./sections/context-templates/Page.svelte"),
	contextNew: () => import("./sections/context-templates/NewPage.svelte"),
	contextId: () => import("./sections/context-templates/IdPage.svelte"),
	variables: () => import("./sections/variable-templates/Page.svelte"),
	variablesNew: () => import("./sections/variable-templates/NewPage.svelte"),
	variablesId: () => import("./sections/variable-templates/IdPage.svelte"),
	completion: () => import("./sections/completion-templates/Page.svelte"),
	completionNew: () => import("./sections/completion-templates/NewPage.svelte"),
	completionId: () => import("./sections/completion-templates/IdPage.svelte"),
	plugins: () => import("./sections/plugins/Page.svelte"),
	pluginsId: () => import("./sections/plugins/IdPage.svelte"),
	components: () => import("./sections/components/Page.svelte"),
	componentsNew: () => import("./sections/components/NewPage.svelte"),
	componentsId: () => import("./sections/components/IdPage.svelte"),
	general: () => import("./sections/general/Page.svelte"),
	network: () => import("./sections/network/Page.svelte"),
	data: () => import("./sections/data/Page.svelte"),
	diagnostics: () => import("./sections/diagnostics/Page.svelte"),
	history: () => import("./sections/history/Page.svelte"),
	historyId: () => import("./sections/history/IdPage.svelte"),
	updates: () => import("./sections/updates/Page.svelte")
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
	{ pattern: "/admin/users", page: S.users },
	{ pattern: "/admin/users/new", page: S.usersNew },
	{ pattern: "/admin/users/invites", page: S.usersInvites },
	{ pattern: "/admin/users/:id", page: S.usersId },
	{ pattern: "/admin/sessions", page: S.sessions },
	{ pattern: "/admin/session-genres", page: S.genres },
	{ pattern: "/admin/session-genres/:id", page: S.genresId },
	{ pattern: "/admin/session-presets", page: S.presets },
	{ pattern: "/admin/session-presets/new", page: S.presetsNew },
	{ pattern: "/admin/session-presets/:id", page: S.presetsId },
	{ pattern: "/admin/pipelines", page: S.pipelines },
	{ pattern: "/admin/pipelines/events", page: S.events },
	{ pattern: "/admin/pipelines/events/:id", page: S.eventsId },
	{ pattern: "/admin/pipelines/:slug", page: S.workspace },
	{ pattern: "/admin/configurations", page: S.configurations },
	{ pattern: "/admin/scripts", page: S.scripts },
	{ pattern: "/admin/scripts/new", page: S.scriptsNew },
	{ pattern: "/admin/scripts/:id", page: S.scriptsId },
	{ pattern: "/admin/prompts", page: S.prompts },
	{ pattern: "/admin/prompts/new", page: S.promptsNew },
	{ pattern: "/admin/prompts/:id", page: S.promptsId },
	{ pattern: "/admin/context-templates", page: S.context },
	{ pattern: "/admin/context-templates/new", page: S.contextNew },
	{ pattern: "/admin/context-templates/:id", page: S.contextId },
	{ pattern: "/admin/variable-templates", page: S.variables },
	{ pattern: "/admin/variable-templates/new", page: S.variablesNew },
	{ pattern: "/admin/variable-templates/:id", page: S.variablesId },
	{ pattern: "/admin/completion-templates", page: S.completion },
	{ pattern: "/admin/completion-templates/new", page: S.completionNew },
	{ pattern: "/admin/completion-templates/:id", page: S.completionId },
	{ pattern: "/admin/plugins", page: S.plugins },
	{ pattern: "/admin/plugins/:id", page: S.pluginsId },
	{ pattern: "/admin/components", page: S.components },
	{ pattern: "/admin/components/new", page: S.componentsNew },
	{ pattern: "/admin/components/:id", page: S.componentsId },
	{ pattern: "/admin/general", page: S.general },
	{ pattern: "/admin/network", page: S.network },
	{ pattern: "/admin/data", page: S.data },
	{ pattern: "/admin/diagnostics", page: S.diagnostics },
	{ pattern: "/admin/history", page: S.history },
	{ pattern: "/admin/history/:id", page: S.historyId },
	{ pattern: "/admin/updates", page: S.updates }
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
