/**
 * The layout editor's MEMBERSHIP edits (./SessionLayoutEditor builds them):
 * adding a widget from the tray, Duplicate, removing one, tap-to-place and
 * the tray's own drops — everything that changes WHICH widgets the layout
 * places, as opposed to where they sit.
 *
 * Over panels (PLAN-session-panels-2026-10-14): the editor holds ONE working
 * `PanelLayoutV1`, and every edit here is one of ./arrangeOps' pure ops
 * applied to it through `input.edit` — the editor keeps the result (or says
 * the refusal). Membership is `placedIds(panels)`, nothing else. Nothing is
 * written to the session until Done. There is no lock (§10 R-B): a removal
 * is refused only by the op itself (the middle is never empty), and every
 * refusal — a cap included — is said through `input.edit`, the editor's
 * status line, never a toast.
 *
 * Call it during the editor's initialisation: its effect belongs to it.
 */
import * as Icons from "@lucide/svelte"
import type { SurfaceManager } from "$lib/client/surfaces/panelManager.svelte"
import {
	addTab,
	newPanel,
	panelOfTab,
	placedIds,
	removeTab,
	type ArrangeOutcome,
	type PanelSlot,
	type TabSlot
} from "./arrangeOps"
import {
	capRefusal,
	duplicateOffered,
	duplicateValues,
	instancesOf,
	mintInstanceId,
	trayOffers,
	trayWidgets as trayWidgetsOf,
	type TrayOffer,
	type TrayWidget
} from "./widgetInstances"
import { setWidgetDuplicator } from "./widgetDuplicate.svelte"
import {
	frameStateKey,
	savedFrameState
} from "$lib/client/components/frames/framePort"
import {
	allWidgetSettingValues,
	putWidgetSettings,
	storedWidgetSettingIds
} from "$lib/client/stores/widgetSettings.svelte"
import {
	setWidgetStylePin,
	widgetStylePins
} from "$lib/client/stores/widgetStyles.svelte"
import { CORE_WIDGETS } from "$lib/shared/widgets/types"
import { type PanelLayoutV1, widgetOfInstance } from "@serene-pub/sdk"
import type { SessionLayoutModel } from "./sessionLayoutModel.svelte"

/**
 * Where a widget lands: as a tab of a panel, or as a new panel of its own at
 * a slot of one stack (a side, or the middle's strips) — `rail` puts a new
 * side panel straight in the rail (dropped on a side's rail strip, §10 R-C).
 */
export type ArrangeTarget = { tab: TabSlot } | { panel: PanelSlot; rail?: boolean }

/** A tray chip's drag carries a WIDGET id under this type; a placed tab's, an instance id. */
export const TRAY_DRAG_TYPE = "text/sp-tray-widget"
export const TAB_DRAG_TYPE = "text/sp-widget"
export const PANEL_DRAG_TYPE = "text/sp-panel"

export interface EditorMembershipInput {
	readonly model: SessionLayoutModel
	readonly manager: SurfaceManager
	readonly sessionId: number | null
	/** The editor's working panels. */
	readonly panels: PanelLayoutV1
	/** Apply one op's outcome: keep its layout, or say its refusal. Answers whether it was kept. */
	edit(outcome: ArrangeOutcome): boolean
}

export function createEditorMembership(input: EditorMembershipInput) {
	const manager = input.manager

	/** Tap-to-place: the tray chip currently armed. */
	let armedId = $state<string | null>(null)
	/** What is under a drag (a drop target's key; `__palette__` is the tray). */
	let dragOverZone = $state<string | null>(null)

	/** Every widget instance the working panels place. */
	let placedNow = $derived(new Set(placedIds(input.panels)))
	/**
	 * Every widget kind this session can add (brief 7b): Messages — unless
	 * the genre withholds it — then every declared widget, placed or not.
	 */
	let offers = $derived<TrayOffer[]>(
		trayOffers(
			manager.decls,
			manager.omitted.has("messages")
				? null
				: {
						id: "messages",
						title:
							CORE_WIDGETS.find((w) => w.id === "messages")
								?.title ?? "Messages",
						icon: "MessagesSquare"
					}
		)
	)
	/**
	 * The tray (brief 7b): every kind, every time — a placed one with its
	 * count, and one at its `maxInstances` disabled with the reason.
	 */
	let trayWidgets = $derived<TrayWidget[]>(trayWidgetsOf(offers, placedNow))
	/** A tray chip's icon, as a component to draw with. */
	function trayIcon(t: { icon?: string }) {
		return (t.icon && (Icons as any)[t.icon]) || Icons.LayoutPanelTop
	}
	/** Why one more instance of this placed widget cannot be added, else null. */
	function copyRefusalOf(id: string): string | null {
		const widget = widgetOfInstance(id)
		const offer = offers.find((o) => o.id === widget)
		return capRefusal(
			offer?.maxInstances,
			instancesOf(widget, placedNow).length
		)
	}
	/** The ids a minted one must not reuse: everything placed or held by the manager. */
	function mintTaken(): string[] {
		return [...placedNow, ...manager.copies.map((c) => c.id)]
	}
	/** The ids holding stored widget settings or a style pin in this session. */
	function storedIds(): string[] {
		return [...storedWidgetSettingIds(), ...Object.keys(widgetStylePins())]
	}
	/** Land an id that is not yet placed at a target. */
	function land(id: string, at: ArrangeTarget): boolean {
		const outcome =
			"tab" in at
				? addTab(input.panels, id, at.tab)
				: newPanel(input.panels, id, at.panel, at.rail ? { pinned: false } : {})
		return input.edit(outcome)
	}
	/**
	 * Add widget `widgetId` from the tray (brief 7b): mint its instance id
	 * (./widgetInstances `mintInstanceId`) and land it. Refused — with the
	 * reason — at its `maxInstances`. Answers the id it placed.
	 */
	function addWidget(widgetId: string, at: ArrangeTarget): string | null {
		armedId = null
		const offer = offers.find((o) => o.id === widgetId)
		if (!offer) return null
		const refusal = capRefusal(
			offer.maxInstances,
			instancesOf(widgetId, placedNow).length
		)
		if (refusal) {
			input.edit({ refused: refusal })
			return null
		}
		const id = mintInstanceId(widgetId, mintTaken(), storedIds())
		if (!land(id, at)) return null
		forgetViewState(id)
		return id
	}
	/**
	 * A newly minted COPY starts with no saved view state (a frame's scroll,
	 * an open tab): a `#n` re-minted after a removal would otherwise open
	 * where the removed one left off. A bare id keeps its own.
	 */
	function forgetViewState(id: string) {
		if (id !== widgetOfInstance(id))
			savedFrameState.clear(frameStateKey(input.sessionId, id))
	}
	/**
	 * The ids this edit's Duplicates wrote settings or a pin under — every
	 * one minted fresh, so none held anything before. Cancel clears them.
	 */
	let duplicatedIds: string[] = []
	/**
	 * **Duplicate** a placed widget (brief 7b; QD): mint a FRESH copy of its
	 * widget, hand it the source's settings and style pin verbatim, and add
	 * it as the next tab of the source's panel. Refused at the widget's cap.
	 */
	function duplicateWidget(sourceId: string): string | null {
		if (!duplicateOffered()) return null
		const widgetId = widgetOfInstance(sourceId)
		if (!offers.some((o) => o.id === widgetId)) return null
		const refusal = copyRefusalOf(sourceId)
		if (refusal) {
			input.edit({ refused: refusal })
			return null
		}
		const holder = panelOfTab(input.panels, sourceId)
		if (!holder) return null
		const id = mintInstanceId(widgetId, mintTaken(), storedIds(), {
			fresh: true
		})
		const index = holder.panel.tabs.indexOf(sourceId) + 1
		if (!input.edit(addTab(input.panels, id, { panelKey: holder.panel.key, index })))
			return null
		forgetViewState(id)
		const carry = duplicateValues(
			sourceId,
			allWidgetSettingValues(),
			widgetStylePins()
		)
		if (carry.settings) putWidgetSettings(id, carry.settings)
		if (carry.pin) setWidgetStylePin(id, carry.pin)
		if (carry.settings || carry.pin) duplicatedIds.push(id)
		return id
	}
	// The live overlay offers Duplicate while the editor is open — never
	// under QD's (1), tray only.
	$effect(() => {
		setWidgetDuplicator(
			duplicateOffered()
				? { duplicate: duplicateWidget, refusal: copyRefusalOf }
				: null
		)
		return () => setWidgetDuplicator(null)
	})
	/** Remove a placed widget; a refusal (`MIDDLE_EMPTY`) is said and it stays. */
	function removeWidget(id: string): boolean {
		return input.edit(removeTab(input.panels, id))
	}

	function onTrayDragStart(e: DragEvent, widgetId: string) {
		e.dataTransfer?.setData(TRAY_DRAG_TYPE, widgetId)
		if (e.dataTransfer) e.dataTransfer.effectAllowed = "move"
	}
	/** The placed instance a drag carries, if it is a tab's. */
	function draggedId(e: DragEvent): string | null {
		return e.dataTransfer?.getData(TAB_DRAG_TYPE) || null
	}
	/** The tray widget a drag carries, if it is a chip's. */
	function draggedWidget(e: DragEvent): string | null {
		return e.dataTransfer?.getData(TRAY_DRAG_TYPE) || null
	}

	/**
	 * An id another editor minted and placed (the phone's row editor mints
	 * its own): a fresh copy forgets its view state, and a Duplicate's copy
	 * takes its source's settings and style pin, as `duplicateWidget` does.
	 */
	function adopt(id: string, sourceId: string | null) {
		forgetViewState(id)
		if (!sourceId) return
		const carry = duplicateValues(
			sourceId,
			allWidgetSettingValues(),
			widgetStylePins()
		)
		if (carry.settings) putWidgetSettings(id, carry.settings)
		if (carry.pin) setWidgetStylePin(id, carry.pin)
		if (carry.settings || carry.pin) duplicatedIds.push(id)
	}

	return {
		get armedId() {
			return armedId
		},
		set armedId(v: string | null) {
			armedId = v
		},
		get dragOverZone() {
			return dragOverZone
		},
		set dragOverZone(v: string | null) {
			dragOverZone = v
		},
		get trayWidgets() {
			return trayWidgets
		},
		get placed(): ReadonlySet<string> {
			return placedNow
		},
		/** The Duplicates this edit wrote (what Cancel takes back), and a fresh start. */
		takeDuplicated(): string[] {
			const ids = duplicatedIds
			duplicatedIds = []
			return ids
		},
		trayIcon,
		copyRefusalOf,
		addWidget,
		duplicateWidget,
		removeWidget,
		onTrayDragStart,
		draggedId,
		draggedWidget,
		storedIds,
		adopt
	}
}

export type EditorMembership = ReturnType<typeof createEditorMembership>
