/**
 * The live session's flyouts (./SessionLayoutRender builds them): the TUCKED
 * FLYOUT (ruled 2026-09-27; ./tuckedSides) — a tucked or rail-only side's
 * panel out over the session — the transient state the renderer and both
 * side mounts (./SideMount) read and toggle. Nothing here is persisted. (The
 * un-arranged zone's POP-OVER went with the zones: PLAN-session-panels
 * 2026-10-14 — a side is always a column of panels and its rail.)
 *
 * Call it during the renderer's initialisation: its effects belong to it.
 */
import { untrack } from "svelte"
import type { SurfaceManager } from "$lib/client/surfaces/panelManager.svelte"
import { toggleTuckedFlyout, type TuckedFlyout } from "./tuckedSides"
import type { SessionLayoutModel } from "./sessionLayoutModel.svelte"

/** Visible, tabbable descendants — a dialog's focus ring, in DOM order. */
export function focusablesIn(el: HTMLElement): HTMLElement[] {
	return [
		...el.querySelectorAll<HTMLElement>(
			'a[href],button:not([disabled]),input:not([disabled]),select:not([disabled]),textarea:not([disabled]),[tabindex]:not([tabindex="-1"])'
		)
	].filter((n) => n.getClientRects().length > 0)
}

export interface LiveFlyoutsInput {
	readonly model: SessionLayoutModel
	readonly manager: SurfaceManager
	/** `.live-body`, which the flyouts' own queries are scoped to. */
	readonly liveEl: HTMLElement | null
}

export function createLiveFlyouts(input: LiveFlyoutsInput) {
	const model = input.model

	/* ── the tucked flyout (ruled 2026-09-27; ./tuckedSides) ───────────────
	 * While a side is tucked — by the width, or because every panel in it is
	 * in the rail — a rail icon brings ITS panel out over the session, one at
	 * a time across both sides: opening another puts the first away, and Esc
	 * or an outside click puts it away. The flyout is the panel's own cell
	 * positioned over the session (./SideMount `cell-flyout`), driven by this
	 * one value instead of by a panel's open state, which keeps the docked
	 * choices for when the side untucks. */
	let tuckedFlyout = $state<TuckedFlyout | null>(null)
	/** The rail icon that opened it — where focus goes back to. */
	let tuckedTrigger: HTMLElement | null = null
	function tuckedOpen(side: "left" | "right", key: string): boolean {
		return tuckedFlyout?.side === side && tuckedFlyout.key === key
	}
	/** A rail icon pressed while tucked. */
	function toggleTucked(
		side: "left" | "right",
		key: string,
		trigger: HTMLElement
	) {
		const next = toggleTuckedFlyout(tuckedFlyout, { side, key })
		if (!next) {
			closeTucked(true)
			return
		}
		tuckedFlyout = next
		tuckedTrigger = trigger
		// Focus moves INTO the panel once it is drawn: its first control, or
		// the dialog itself.
		requestAnimationFrame(() => {
			const el = input.liveEl?.querySelector<HTMLElement>(
				"[data-tucked-flyout]"
			)
			if (!el) return
			const first = focusablesIn(el)[0]
			;(first ?? el).focus({ preventScroll: true })
		})
	}
	/**
	 * Put the tucked panel away. Focus goes back to its rail icon on Esc and
	 * on the icon itself — never on an outside click, which has already put
	 * focus where the user wanted it.
	 */
	function closeTucked(returnFocus: boolean) {
		const back = tuckedTrigger
		tuckedFlyout = null
		tuckedTrigger = null
		if (returnFocus) back?.focus({ preventScroll: true })
	}
	/**
	 * Put every flyout away — the tucked one, and a docked side's panel out
	 * over the session (rule (c)) — without returning focus. What the
	 * editor's starting points ask for, through the composition root.
	 */
	function putAway() {
		closeTucked(false)
		for (const side of ["left", "right"] as const)
			model.rail.groupFocus[side] = null
	}
	// Untucking puts the panel away: the docked layout is back, and its own
	// open/closed choices with it.
	$effect(() => {
		const t = untrack(() => tuckedFlyout)
		if (t && !model.tucked[t.side]) closeTucked(false)
	})
	// Crossing INTO mobile retires it too, so coming back out does not
	// re-reveal a flyout left open on a wider screen.
	$effect(() => {
		if (model.isNarrow) untrack(() => closeTucked(false))
	})
	$effect(() => {
		if (!tuckedFlyout) return
		const onDown = (e: PointerEvent) => {
			const t = e.target as HTMLElement | null
			if (t?.closest("[data-pop-keep]")) return
			closeTucked(false)
		}
		const onKey = (e: KeyboardEvent) => {
			if (e.key !== "Escape" || e.defaultPrevented) return
			// The shell's Escape steps a layer down (Stage only, Focus, the
			// dock) unless something took it — and folding the dock would
			// untuck the sides under the user's hands.
			e.preventDefault()
			closeTucked(true)
		}
		document.addEventListener("pointerdown", onDown, true)
		document.addEventListener("keydown", onKey)
		return () => {
			document.removeEventListener("pointerdown", onDown, true)
			document.removeEventListener("keydown", onKey)
		}
	})

	return {
		get tuckedFlyout() {
			return tuckedFlyout
		},
		tuckedOpen,
		toggleTucked,
		closeTucked,
		putAway
	}
}

export type LiveFlyouts = ReturnType<typeof createLiveFlyouts>
