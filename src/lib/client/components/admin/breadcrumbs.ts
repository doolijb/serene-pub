/**
 * The admin breadcrumb trail (Django admin's `breadcrumbs` block), pure so it
 * is tested (`breadcrumbs.test.ts`): **Admin › <group> › <section> › … ›
 * <this page>**, worked out from the address and the section list
 * (`shell/adminNav.ts`) so no section keeps its own copy of where it lives.
 *
 * The group has no page of its own (Django's app index), so it is words, not
 * a link. The section links back to its changelist — with the search,
 * filters, sort and page it was last left on (`rememberChangelistQuery`), the
 * way Django's `_changelist_filters` brings a change form back to the same
 * view of the list.
 */
import type { AdminNavGroup } from "$lib/client/shell/adminNav"
import { sectionHrefFor } from "$lib/client/admin/adminRoutes"

export interface AdminCrumb {
	label: string
	/** Absent → plain words (the group, or the page you are on). */
	href?: string
	/** In place of `href`: a step that is not an address (a confirmation step back). */
	onclick?: () => void
}

/** Section href → the query its changelist was last left with. */
const lastQuery = new Map<string, string>()

export function rememberChangelistQuery(sectionHref: string, query: string) {
	if (query) lastQuery.set(sectionHref, query)
	else lastQuery.delete(sectionHref)
}

export function changelistReturnHref(sectionHref: string): string {
	return sectionHref + (lastQuery.get(sectionHref) ?? "")
}

/**
 * The trail for `path`. `current` names the page on screen when it is not the
 * section's own changelist (an object's title, "Add prompt"); `trail` is any
 * step between the section and it. The Overview has no trail: it is the root.
 */
export function adminCrumbs(
	path: string,
	nav: readonly AdminNavGroup[],
	opts: {
		current?: string
		trail?: readonly AdminCrumb[]
		/**
		 * A step of the page that is not its own address (the delete
		 * confirmation, "Delete"): always the last crumb, even on the
		 * section's own address — whose crumb then calls `sectionOnclick`
		 * (back to the list) instead of linking to where you already are.
		 */
		leaf?: string
		sectionOnclick?: () => void
	} = {}
): AdminCrumb[] {
	const clean = path.replace(/\/$/, "") || "/admin"
	if (clean === "/admin") return []
	const hrefs = nav.flatMap((g) => g.items.map((i) => i.href))
	const sectionHref = sectionHrefFor(clean, hrefs)
	const group = nav.find((g) => g.items.some((i) => i.href === sectionHref))
	const item = group?.items.find((i) => i.href === sectionHref)
	const out: AdminCrumb[] = [{ label: "Admin", href: "/admin" }]
	if (!item || !group) {
		if (opts.current) out.push({ label: opts.current })
		return out
	}
	if (group.group) out.push({ label: group.group })
	const onSection = clean === item.href
	const atSection = onSection && !opts.trail?.length && !opts.leaf
	out.push(
		atSection
			? { label: item.label }
			: onSection && opts.sectionOnclick
				? { label: item.label, onclick: opts.sectionOnclick }
				: { label: item.label, href: changelistReturnHref(item.href) }
	)
	if (!atSection) {
		out.push(...(opts.trail ?? []))
		if (opts.leaf) out.push({ label: opts.leaf })
		else if (opts.current && opts.current !== item.label) out.push({ label: opts.current })
	}
	return out
}
