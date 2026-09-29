/**
 * Where a jump hit lands.
 *
 * The overlay's one job is to pick a hit; this module's one job is to open it
 * **the way the application already opens that kind of thing** — the same
 * deep-link mailbox (`panelsCtx.digest`) every existing "show me that" button
 * writes, or `goto` where the thing is a page. Nothing here is a second way to
 * reach anything: each branch names the reader that consumes what it writes, so
 * a reader that moves takes its branch with it instead of leaving a jump that
 * silently opens an empty panel.
 *
 * ⚠ **The digest is written BEFORE the view opens.** Both orders work today —
 * every reader is an `$effect` or an `onMount` that runs after the panel
 * mounts — but one order is a rule and two orders are a coin flip the day a
 * reader stops being an effect. Address first, then open.
 */

import { goto } from "$app/navigation"
import { adminRouter } from "$lib/client/admin/adminRouter.svelte"
import { DEFAULT_SCOPE } from "$lib/shared/lorebooks/loreRoute"
import { helpRouter } from "$lib/client/shell/helpRouter.svelte"
import type { JumpHit } from "$lib/shared/sockets/jump"

/**
 * A hit's id as the digest wants it.
 *
 * `JumpHit.id` is `number | string` because the shape is meant to survive a
 * kind whose rows are not integer-keyed; every kind today is, and every digest
 * key and route below is numeric.
 */
function numericId(id: number | string): number | null {
	const n = typeof id === "number" ? id : Number(id)
	return Number.isFinite(n) ? n : null
}

export interface OpenJumpHitOptions {
	/**
	 * Open a view-backed hit FOCUSED (full page) rather than in the sidebar —
	 * Shift Enter / Shift click in the overlay. A hit that navigates to a page
	 * (a session) is a page either way and ignores it.
	 */
	focus?: boolean
}

/**
 * Open the thing a jump hit names.
 *
 * Async because two kinds are pages rather than panels and `goto` is what
 * finishes them; the panel branches settle immediately.
 */
/**
 * Open an admin address in the Admin view: the section first, then the view,
 * focused when asked. Admin is a view, not a page, so this never navigates
 * away from what is underneath.
 */
export function openAdminAddress(
	panelsCtx: PanelsCtx,
	href: string,
	opts: { focus?: boolean } = {}
): void {
	void adminRouter.go(href)
	panelsCtx.openView("admin", { toggle: false, fullPage: opts.focus })
}

export async function openJumpHit(
	panelsCtx: PanelsCtx,
	hit: JumpHit,
	options: OpenJumpHitOptions = {}
): Promise<void> {
	// The one place a branch opens its view, so "focused" is one decision
	// rather than one per branch. `toggle: false` either way: a jump always
	// opens, never closes the view the person was already looking at.
	const openView = (key: string) => {
		if (options.focus)
			panelsCtx.openView(key, { toggle: false, fullPage: true })
		else panelsCtx.openPanel({ key, toggle: false })
	}

	// ⚠ BEFORE the numeric-id guard. A `doc` hit's id is a slug — the one kind
	// whose rows are not integer-keyed — so the guard below would drop it.
	if (hit.kind === "doc") {
		// Reader: HelpSidebar.svelte, which follows the router whether it is
		// mounted yet or not. The Help view is the one reading of the docs, so
		// this is the same from anywhere — including from a Help address.
		helpRouter.go(String(hit.id), hit.anchor ?? "")
		openView("help")
		return
	}

	const id = numericId(hit.id)
	if (id === null) return

	switch (hit.kind) {
		// The read-only detail screen, not the edit form — a jump is a lookup.
		// Reader: components/sidebars/CharactersSidebar.svelte (`viewCharacterId`);
		// the edit form is `digest.characterId`.
		//
		// ⚠ There is no `persona` branch and there must not be one: a persona
		// IS a character, so its hit arrives as a `character` with
		// `hint: "persona"` and lands here. A second branch would be a second
		// address for one row.
		case "character":
			panelsCtx.digest.viewCharacterId = id
			openView("characters")
			return

		// A session is a page, not a panel — the same navigation
		// SessionsSidebar's own row does (`handleOpenSession`, :140). NOT
		// `digest.sessionId`, which opens that sidebar's *edit form* (:294).
		case "session":
			await goto(`/sessions/${id}`)
			return

		// One address for the book, the section and the entry. Reader:
		// lorebooks/LorebooksWorkspace.svelte:579 — the only reader of
		// `digest.lore`, and it takes the address with it. `scope` is required
		// by `LoreRoute`; `DEFAULT_SCOPE` ("all") is where a book opens when
		// nothing says otherwise, which is exactly what a jump is saying.
		case "lorebook":
			panelsCtx.digest.lore = { lorebookId: id, scope: DEFAULT_SCOPE }
			openView("lorebooks")
			return

		// The same address one level deeper. `parentId` is the entry's lorebook
		// — without it there is no book to open the entry inside, so a hit that
		// somehow arrives without one opens nothing rather than the wrong book.
		case "entry": {
			const lorebookId =
				hit.parentId === undefined ? null : numericId(hit.parentId)
			if (lorebookId === null) return
			panelsCtx.digest.lore = {
				lorebookId,
				scope: DEFAULT_SCOPE,
				entryId: id
			}
			openView("lorebooks")
			return
		}

		// ⚠ No digest key exists for a tag: `PanelsCtx["digest"]` has no
		// `tagId`, and components/sidebars/TagsSidebar.svelte is write-only on
		// the digest — it seeds other panels' links and reads none of its own.
		// So a tag jump opens the panel and stops there. Giving it a mailbox
		// means adding a key to `src/app.d.ts` and a reader to that sidebar,
		// which is the shell lane's file and the shell lane's call.
		case "tag":
			openView("tags")
			return

		// Reader: the `digestId` seeding in ConnectionsSidebar's `onMount`.
		// The digest is now the mechanism for external navigation that OPENS
		// that view only — a page that EMBEDS its own copy passes
		// `initialConnectionId` instead (S3), because one shared slot is
		// consumed by whichever copy mounts first.
		//
		// ⚠ Two things this branch cannot promise, both the shell lane's to
		// settle if it wants them: `leftNav.connections` is registered only for
		// an admin (Layout.svelte:421), so opening it is a silent no-op for
		// anyone else — harmless, since the server never sends a non-admin a
		// `connection` hit to click; and that sidebar consumes the digest in
		// `onMount` rather than an `$effect`, so jumping to a second connection
		// while the panel is already open sets a key nothing reads again.
		case "connection":
			panelsCtx.digest.connectionId = id
			openView("connections")
			return

		// A page, like a session. Admin-only on both sides — the server sends
		// no `user` hit to anyone else.
		case "user":
			openAdminAddress(panelsCtx, `/admin/users/${id}`, options)
			return
	}
}
