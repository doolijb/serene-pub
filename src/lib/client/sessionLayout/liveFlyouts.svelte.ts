/**
 * The live session's flyouts (./SessionLayoutRender builds them): the
 * POP-OVER of an unpinned rail or a narrow drawer, and the TUCKED FLYOUT
 * (ruled 2026-09-27; ./tuckedSides) — the transient state the renderer and
 * both side mounts (./SideMount) read and toggle. Nothing here is persisted.
 *
 * Call it during the renderer's initialisation: its effects belong to it.
 */
import { untrack } from "svelte"
import { SvelteSet } from "svelte/reactivity"
import type { SurfaceManager } from "$lib/client/surfaces/panelManager.svelte"
import type { ResolvedZone } from "./schema"
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

	/* ── pop-over (unpinned rails + narrow drawers) ────────────────── */
	let popId = $state<string | null>(null)
	/**
	 * Every zone popped over at least once, kept (unit M): its flyout is
	 * mounted the first time it opens and HIDDEN when it closes, never
	 * unmounted, so closing and reopening a flyout remounts (and reloads) no
	 * widget in it. Only while the zone still pops over: pinned, its
	 * widgets live in its rail instead.
	 */
	const poppedZones = new SvelteSet<string>()
	$effect(() => {
		if (popId) poppedZones.add(popId)
	})
	let keptPops = $derived(
		model.resolved.filter((z) => poppedZones.has(z.id) && z.mode !== "rail")
	)
	/** Put the pop-over away — any, or only `zoneId`'s. */
	function putAway(zoneId?: string) {
		if (!zoneId || popId === zoneId) popId = null
	}
	function togglePop(zoneId: string, widgetId?: string) {
		if (popId === zoneId && !widgetId) {
			popId = null
			return
		}
		popId = zoneId
		if (widgetId) {
			const p = model.inst(widgetId)
			if (p?.collapsed) input.manager.toggleCollapse(widgetId)
			// Scroll the tapped widget into view once the flyout paints.
			requestAnimationFrame(() =>
				input.liveEl
					?.querySelector(
						`.zone-flyout [data-panel-id="${widgetId}"]`
					)
					?.scrollIntoView({ block: "nearest" })
			)
		}
	}
	// Click-away + Escape close the pop-over (mockup behavior).
	$effect(() => {
		if (!popId) return
		const onDown = (e: PointerEvent) => {
			const t = e.target as HTMLElement | null
			if (t?.closest("[data-pop-keep]")) return
			popId = null
		}
		const onKey = (e: KeyboardEvent) => {
			if (e.key === "Escape") popId = null
		}
		document.addEventListener("pointerdown", onDown, true)
		document.addEventListener("keydown", onKey)
		return () => {
			document.removeEventListener("pointerdown", onDown, true)
			document.removeEventListener("keydown", onKey)
		}
	})

	/* ── the tucked flyout (ruled 2026-09-27; ./tuckedSides) ───────────────
	 * While the sides are tucked, a rail icon brings ITS panel out over the
	 * session, one at a time across both sides: opening another puts the first
	 * away, and Esc or an outside click puts it away. It is the same flyout
	 * both paths already had — an arranged group's cell positioned over the
	 * session (`cell-flyout`), an un-arranged zone's `.zone-flyout` — driven by
	 * this one value instead of by a group's open state / `popId`, which keep
	 * the docked choices for when the sides untuck. */
	let tuckedFlyout = $state<TuckedFlyout | null>(null)
	/** The rail icon that opened it — where focus goes back to. */
	let tuckedTrigger: HTMLElement | null = null
	/**
	 * The widget an un-arranged zone's flyout shows while tucked, by zone.
	 * Kept after it closes so the closed flyout keeps the SAME mount hidden
	 * (the keep-alive `keptPops` exists for) rather than filling with the
	 * zone's other widgets.
	 */
	let tuckedShown = $state<Record<string, string>>({})
	/** The un-arranged zone holding the tucked panel that is out, if any. */
	let tuckedZoneId = $derived.by(() => {
		const t = tuckedFlyout
		if (!t || !model.tucked[t.side] || model.arrangedHere(t.side))
			return null
		const zones = t.side === "left" ? model.leftZones : model.rightZones
		return zones.find((z) => z.def.widgets.includes(t.key))?.id ?? null
	})
	$effect(() => {
		const id = tuckedZoneId
		const t = tuckedFlyout
		if (!id || !t) return
		untrack(() => {
			poppedZones.add(id)
			if (tuckedShown[id] !== t.key) tuckedShown[id] = t.key
		})
	})
	/** A zone narrowed to the one widget its tucked flyout shows. */
	function tuckedZone(z: ResolvedZone): ResolvedZone {
		const id = tuckedShown[z.id]
		return id && z.def.widgets.includes(id)
			? { ...z, def: { ...z.def, widgets: [id] } }
			: z
	}
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
	// Untucking puts the panel away: the docked layout is back, and its own
	// open/closed choices with it.
	$effect(() => {
		const t = untrack(() => tuckedFlyout)
		if (t && !model.tucked[t.side]) closeTucked(false)
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
	// Crossing INTO mobile retires any desktop pop-over, so coming back out does
	// not re-reveal a flyout the user left open on a wider screen.
	$effect(() => {
		// Tucking retires it too: a tucked zone's flyout is `tuckedFlyout`'s.
		// Only a TUCKED side's — the side holding the log never tucks.
		const side = popId ? model.layout.zones[popId]?.side : undefined
		if (
			model.isNarrow ||
			(popId && model.tucked[side === "left" ? "left" : "right"])
		)
			popId = null
	})

	return {
		get popId() {
			return popId
		},
		set popId(v: string | null) {
			popId = v
		},
		get keptPops() {
			return keptPops
		},
		putAway,
		togglePop,
		get tuckedFlyout() {
			return tuckedFlyout
		},
		get tuckedShown() {
			return tuckedShown
		},
		get tuckedZoneId() {
			return tuckedZoneId
		},
		tuckedZone,
		tuckedOpen,
		toggleTucked,
		closeTucked
	}
}

export type LiveFlyouts = ReturnType<typeof createLiveFlyouts>
