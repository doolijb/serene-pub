/**
 * Open an **href** — a view address string, the call to action a notification
 * carries (NOMENCLATURE: *href*) — the way the application already opens that
 * place.
 *
 * - A lore address (`#lore=12/all/3`, on any path) → `digest.lore`, then the
 *   Lorebooks view. Reader: lorebooks/LorebooksWorkspace.svelte, the only
 *   reader of `digest.lore`.
 * - `/admin/...` → the Admin view at that section (`openAdminAddress`).
 * - `/docs/<slug>#anchor` → the Help view at that page (`helpRouter`).
 * - `/messages/<id>` / `/messages/people/<id>` → `digest.viewConversationId`
 *   / `digest.viewPersonId`, then the Messages view (its only reader).
 * - Anything else (`/sessions/42?message=9`) is a page → `goto`.
 *
 * The same rules as `openJumpHit` and the shell's view-link capture handler
 * (Layout.svelte, `viewLinkFor`): nothing here is a second way to reach
 * anything. ⚠ Address first, then open — see `openJumpHit`'s header.
 */

import { goto } from "$app/navigation"
import { fromHash, type LoreRoute } from "$lib/shared/lorebooks/loreRoute"
import { helpRouter } from "$lib/client/shell/helpRouter.svelte"
import { openAdminAddress } from "$lib/client/shell/openJumpHit"
import { viewLinkFor } from "$lib/client/shell/viewLinks"

/** Where an href lands, decided without touching anything. */
export type HrefTarget =
	| { kind: "lore"; route: LoreRoute }
	| { kind: "admin"; href: string }
	| { kind: "help"; slug: string | null; anchor: string }
	| { kind: "messages"; conversationId: number | null; personId: number | null }
	| { kind: "page"; href: string }

/** Pure: which reader an href belongs to. */
export function classifyHref(href: string): HrefTarget {
	const hashAt = href.indexOf("#")
	if (hashAt !== -1) {
		const route = fromHash(href.slice(hashAt))
		if (route) return { kind: "lore", route }
	}
	const link = viewLinkFor(href)
	if (link?.view === "admin") return { kind: "admin", href: link.href }
	if (link?.view === "help")
		return { kind: "help", slug: link.slug, anchor: link.anchor }
	if (link?.view === "conversations")
		return {
			kind: "messages",
			conversationId: link.conversationId,
			personId: link.personId
		}
	return { kind: "page", href }
}

export interface OpenHrefOptions {
	/** Open a view-backed href focused (full page) rather than in the sidebar. */
	focus?: boolean
}

export async function openHref(
	panelsCtx: PanelsCtx,
	href: string,
	opts: OpenHrefOptions = {}
): Promise<void> {
	// `toggle: false` either way: a call to action always opens, never closes
	// the view the person was already looking at.
	const openView = (key: string) => {
		if (opts.focus) panelsCtx.openView(key, { toggle: false, fullPage: true })
		else panelsCtx.openPanel({ key, toggle: false })
	}
	const target = classifyHref(href)
	switch (target.kind) {
		case "lore":
			panelsCtx.digest.lore = target.route
			openView("lorebooks")
			return
		case "admin":
			openAdminAddress(panelsCtx, target.href, opts)
			return
		case "help":
			helpRouter.go(target.slug, target.anchor)
			openView("help")
			return
		case "messages":
			applyMessagesDigest(panelsCtx, target)
			openView("conversations")
			return
		case "page":
			await goto(target.href)
			return
	}
}

/**
 * Hand a Messages address to the Messages view through the digest: one
 * conversation, one person, or (both null) the list — the stale half is
 * cleared so the view lands on exactly what the address names. Shared with
 * the shell's link capture and its cold-load path (Layout.svelte).
 */
export function applyMessagesDigest(
	panelsCtx: Pick<PanelsCtx, "digest">,
	place: { conversationId: number | null; personId: number | null }
): void {
	if (place.conversationId !== null)
		panelsCtx.digest.viewConversationId = place.conversationId
	else delete panelsCtx.digest.viewConversationId
	if (place.personId !== null) panelsCtx.digest.viewPersonId = place.personId
	else delete panelsCtx.digest.viewPersonId
}
