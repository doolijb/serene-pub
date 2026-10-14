/**
 * The layout editor's MEMBERSHIP edits (./SessionLayoutEditor builds them):
 * adding a widget from the Add menu, Duplicate, removing one, tap-to-place and
 * the drops that land a card in a zone — everything that changes WHICH widgets
 * the layout places, as opposed to where they sit (the gridstack zones' own
 * report). Add/remove do not go through gridstack's gesture events (they
 * change the id set, which re-seeds the zone), so they report themselves here.
 *
 * The two halves of the membership model part here: a side zone's widgets are
 * the zone template's, the middle's are the chat widget grid's. Each write is
 * EMITTED (`onLayout`) — the composition root persists it — and the editor's
 * working arrangement is written through `setFrame`; nothing here touches the
 * renderer.
 *
 * Call it during the editor's initialisation: its effect belongs to it.
 */
import * as Icons from "@lucide/svelte"
import { toaster } from "$lib/client/utils/toaster"
import type { SurfaceManager } from "$lib/client/surfaces/panelManager.svelte"
import {
	pinsOnFirstDrop,
	placedWidgetIds,
	withWidget,
	withoutWidget
} from "./schema"
import { withGridWidget, withoutGridWidget } from "./widgetGrid"
import {
	arrangedIds,
	MIDDLE_TARGET,
	seatCard,
	withPins
} from "./arrangedGeometry"
import { floorKeeps, floorNote } from "./primaryFloor"
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
import {
	type ArrangedGridV1,
	type ArrangedZone,
	type SessionLayoutV1,
	type WidgetGridV1,
	widgetOfInstance,
	ZONE_IDS,
	type ZoneId,
	type ZoneLayoutV1
} from "@serene-pub/sdk"
import type { SessionLayoutModel } from "./sessionLayoutModel.svelte"

export interface EditorMembershipInput {
	readonly model: SessionLayoutModel
	readonly manager: SurfaceManager
	readonly sessionId: number | null
	/** The editor's working arrangement. */
	readonly working: ArrangedGridV1
	/** Write one zone's frame of the working arrangement. */
	setFrame(zone: ZoneId, frame: ArrangedZone): void
	/** The zones' membership as the editor opened (what Cancel puts back). */
	readonly zonesSnapshot: ZoneLayoutV1 | null
	/**
	 * Every id the layout places while editing: the side lists, the middle
	 * grid and the working arrangement — what the primary floor counts.
	 */
	readonly placedIds: ReadonlySet<string>
	/** The primary widget's title — the floor's note names it. */
	readonly primaryTitle: string
	/** A zone reported a user gesture — only meaningful while simulating. */
	markSimDirty(): void
	/** Persist the slots this edit changed (the composition root writes them). */
	onLayout(patch: SessionLayoutV1): void
	/** Ask the live view to put a zone's pop-over away. */
	onPutAway(zoneId?: string): void
}

export function createEditorMembership(input: EditorMembershipInput) {
	const model = input.model
	const manager = input.manager
	function commit(next: ZoneLayoutV1) {
		input.onLayout({ zoneLayout: next })
	}
	/**
	 * `commit`'s sibling for the other half of the membership model: the SIDE
	 * zones' widgets live in the zone template, the MIDDLE's in the chat widget
	 * grid, which that template never names. See `place`.
	 */
	function commitGrid(next: WidgetGridV1) {
		input.onLayout({ widgetGrid: next })
	}

	/** Tap-to-place: the palette chip currently armed. */
	let armedId = $state<string | null>(null)
	/** The zone currently under a drag (highlight). */
	let dragOverZone = $state<string | null>(null)

	/**
	 * Every widget instance placed right now, as the Add menu counts them.
	 * The middle is the ARRANGED zone once there is an arrangement and the
	 * widget grid until then — the same precedence the live view draws on, so
	 * a widget taken out of the middle is counted where it went.
	 */
	let placedNow = $derived.by(() => {
		const w = input.working
		const middle = w.middle
			? w.middle.items.map((i) => i.id)
			: [...model.middleGridIds]
		const placed = new Set([...placedWidgetIds(model.layout), ...middle])
		// While EDITING, committed membership is not yet the truth: the
		// arrangement in progress is. A card dragged from the MIDDLE into a
		// side is reported by both zones' frames at once, but neither list
		// above holds it until Done — `layout.zones` gains it then, and the
		// middle's own membership lives in the grid, which Done reconciles
		// too — so the working frames are counted as well, or the card would
		// count nowhere. (A side→side drag stays counted the whole way: the
		// SOURCE zone's committed list names it until Done.)
		for (const id of arrangedIds(w)) placed.add(id)
		return placed
	})
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
	 * The Add menu (brief 7b): every kind, every time — a placed one with its
	 * count, and one at its `maxInstances` disabled with the reason. Adding
	 * mints the instance id (`addWidget`).
	 */
	let trayWidgets = $derived<TrayWidget[]>(trayWidgetsOf(offers, placedNow))
	/** A tray chip's icon, as a component to draw with. */
	function trayIcon(t: { icon?: string }) {
		return (t.icon && (Icons as any)[t.icon]) || Icons.LayoutPanelTop
	}
	/**
	 * Why one more instance of this placed widget cannot be added — its
	 * widget's cap — else null. What a card's Duplicate says instead.
	 */
	function copyRefusalOf(id: string): string | null {
		const widget = widgetOfInstance(id)
		const offer = offers.find((o) => o.id === widget)
		return capRefusal(
			offer?.maxInstances,
			instancesOf(widget, placedNow).length
		)
	}
	/**
	 * The primary floor's note for a widget (./primaryFloor): what its card
	 * says in place of the × when it is the last placed instance of the
	 * genre's primary widget, else null.
	 */
	function floorNoteOf(id: string): string | null {
		if (!floorKeeps(id, input.placedIds, model.primaryId)) return null
		return floorNote(input.primaryTitle)
	}
	/**
	 * The ids a minted one must not reuse: everything placed, drawn or still
	 * held by the surface manager — the working arrangement included.
	 */
	function mintTaken(): string[] {
		return [
			...placedNow,
			...input.placedIds,
			...manager.copies.map((c) => c.id)
		]
	}
	/** The ids holding stored widget settings or a style pin in this session. */
	function storedIds(): string[] {
		return [...storedWidgetSettingIds(), ...Object.keys(widgetStylePins())]
	}

	/**
	 * Pin or unpin an un-arranged zone — the Move tab's pin and the first-drop
	 * pin. Pinning puts the zone's pop-over away (the live view's, asked).
	 */
	function setPinned(zoneId: string, pinned: boolean) {
		const def = model.layout.zones[zoneId]
		if (!def) return
		commit({
			...model.layout,
			zones: { ...model.layout.zones, [zoneId]: { ...def, pinned } }
		})
		if (pinned) input.onPutAway(zoneId)
	}
	/**
	 * The Move tab's pin, from a card's own toolbar (ruled 2026-08-30): pinned
	 * is a docked rail that takes layout space, unpinned collapses to icons the
	 * panels fly out of. It is the ZONE's state and the SAME state the live
	 * rail's pin button writes — the card is just another way to reach it.
	 * Unpinned is the explicit `false`; absent means pinned (schema default).
	 */
	function toggleZonePin(zoneId: string | null) {
		if (!zoneId) return
		const pinned = model.layout.zones[zoneId]?.pinned === false
		setPinned(zoneId, pinned)
		// The side's working frame says the same of every card in it: the
		// zone pin is what an un-arranged side's cards are seeded with, and
		// a frame Done writes for it (a hand moved a card) has to carry it,
		// or the side would arrive docked whatever its pin said.
		const key = targetZoneKey(zoneId)
		const frame = key ? input.working[key] : undefined
		if (key && frame)
			input.setFrame(
				key,
				withPins(
					frame,
					frame.items.map((i) => i.id),
					pinned
				)
			)
	}
	/**
	 * A widget landed in a side zone — from the tray, from a tap-to-place, or
	 * dragged out of another zone. Ruled 2026-09-17: the FIRST one also pins the
	 * zone, when its `pinned: false` is only `defaultZoneLayout` talking. The
	 * decision is ./schema's `pinsOnFirstDrop`; the snapshot the editor opened
	 * on is what answers "did this zone have widgets before?", so a zone
	 * unpinned DURING this edit cannot be re-pinned by a second drop.
	 */
	function pinOnDrop(zoneId: string | null) {
		if (!zoneId) return
		const def = model.layout.zones[zoneId]
		if (!def || def.kind !== "side") return
		const before = input.zonesSnapshot?.zones[zoneId]
		if (!before) return
		if (
			!pinsOnFirstDrop({
				pinned: def.pinned,
				hadWidgets: before.widgets.length > 0
			})
		)
			return
		setPinned(zoneId, true)
	}
	/**
	 * A new card's default footprint: the zone's full width, three rows deep —
	 * the placement the newcomer would be seeded at (`h: 3`, `it.w ?? cols`),
	 * so it is the size the room has to be made for.
	 */
	const NEW_CARD_ROWS = 3
	/** Which working arrangement a place target writes its cells into. */
	function targetZoneKey(target: string): ZoneId | null {
		if (target === MIDDLE_TARGET) return "middle"
		if (target === model.leftZoneId) return "left"
		if (target === model.rightZoneId) return "right"
		return null
	}
	/**
	 * Where seating card `id` in `target` would leave the working arrangement
	 * (./arrangedGeometry `seatCard`: room made, the newcomer's cells written):
	 * the zone and its new frame; `"free"` when there is no frame to seat in —
	 * the phone editor, which writes its own rows (`MobileLayoutEditor`
	 * `landAtFoot`), a strip, or a zone that has not reported yet; or null when
	 * the zone has no room: no card can give up rows (`MIN_CARD_ROWS`), or the
	 * rows they give up are not together in one place — cards keep their top
	 * edges (float), so shrinking never closes the gaps between them.
	 *
	 * A Duplicate asks for its source's size first; where the zone cannot make
	 * that much room it takes the newcomer's footprint like any add.
	 */
	function seatingIn(
		target: string,
		id: string,
		size?: { w: number; h: number }
	): { zoneKey: ZoneId; frame: ArrangedZone } | "free" | null {
		if (model.mobileEdit) return "free"
		const zoneKey = targetZoneKey(target)
		if (!zoneKey) return "free"
		const frame = input.working[zoneKey]
		if (!frame) return "free"
		const footprint = { w: frame.cols, h: NEW_CARD_ROWS }
		const seated = seatCard(
			frame,
			id,
			size ? [size, footprint] : [footprint]
		)
		return seated ? { zoneKey, frame: seated } : null
	}
	/** What an add says when its zone has no room left (brief 7b review). */
	function noRoomIn(target: string) {
		const zoneKey = targetZoneKey(target)
		toaster.info({
			title:
				zoneKey === "middle"
					? "No room in the middle"
					: `No room in the ${zoneKey ?? ""} column`,
			description:
				"Make a widget there shorter, or move or remove one, then add it again."
		})
	}
	/** Does the chat widget grid hold this id, in any zone? */
	function gridHolds(id: string): boolean {
		return model.chatGrid.widgets.some((w) => w.id === id)
	}
	/**
	 * The tray's one landing — a drop or a tap-to-place, into a side zone or
	 * the middle. A card dragged BETWEEN zones is gridstack's and does not come
	 * here: a full zone still snaps that one back.
	 */
	function place(
		target: string,
		widgetId: string,
		beforeId?: string,
		size?: { w: number; h: number }
	): boolean {
		// Room first: a zone with none turns the card away rather than seat it
		// on top of another (./arrangedGeometry `seatCard`).
		const seating = seatingIn(target, widgetId, size)
		if (!seating) {
			noRoomIn(target)
			return false
		}
		manager.activate(widgetId)
		if (seating !== "free") input.setFrame(seating.zoneKey, seating.frame)
		// A widget lives in ONE zone. `withWidget` already clears the template
		// before it adds, and `withGridWidget` the grid — but neither can see
		// the other half, so landing across the two models clears the one being
		// left by hand. The tray only ever offers an unplaced widget, so this
		// is the invariant being kept rather than a case being handled.
		if (target === MIDDLE_TARGET) {
			if (placedWidgetIds(model.layout).includes(widgetId))
				commit(withoutWidget(model.layout, widgetId))
			commitGrid(withGridWidget(model.chatGrid, widgetId, "middle"))
		} else {
			commit(withWidget(model.layout, target, widgetId, beforeId))
			// Any grid entry, not only the middle's: a side entry the grid
			// named (folded into the template) is now the list's.
			if (gridHolds(widgetId))
				commitGrid(withoutGridWidget(model.chatGrid, widgetId))
			pinOnDrop(target)
		}
		armedId = null
		input.markSimDirty()
		return true
	}
	/**
	 * Add widget `widgetId` from the Add menu (brief 7b): mint its instance id
	 * (./widgetInstances `mintInstanceId`: the bare id when no instance holds
	 * it, else `W#n`, skipping what is placed or stored) and land it. Refused
	 * — with the reason — at its `maxInstances`. Answers the id it placed.
	 */
	function addWidget(
		target: string,
		widgetId: string,
		beforeId?: string
	): string | null {
		armedId = null
		const offer = offers.find((o) => o.id === widgetId)
		if (!offer) return null
		const refusal = capRefusal(
			offer.maxInstances,
			instancesOf(widgetId, placedNow).length
		)
		if (refusal) {
			toaster.info({ title: refusal })
			return null
		}
		const id = mintInstanceId(widgetId, mintTaken(), storedIds())
		if (!place(target, id, beforeId)) return null
		forgetViewState(id)
		return id
	}
	/**
	 * A newly minted COPY starts with no saved view state (a frame's scroll,
	 * an open tab): that is held in memory under the instance id
	 * (`frameStateKey`), so a `#n` re-minted after a removal would otherwise
	 * open where the removed one left off (brief 7b review). A bare id keeps
	 * its own, as it keeps its settings (plan M.3.4).
	 */
	function forgetViewState(id: string) {
		if (id !== widgetOfInstance(id))
			savedFrameState.clear(frameStateKey(input.sessionId, id))
	}
	/**
	 * Where a placed instance sits right now, as a `place` target: the zone
	 * of the working frame that holds it, else the middle grid or the zone
	 * list that names it.
	 */
	function placeTargetOf(id: string): string | null {
		for (const key of ZONE_IDS)
			if (input.working[key]?.items.some((i) => i.id === id))
				return key === "middle"
					? MIDDLE_TARGET
					: key === "left"
						? model.leftZoneId
						: model.rightZoneId
		if (model.middleGridIds.has(id)) return MIDDLE_TARGET
		return (
			Object.entries(model.layout.zones).find(([, z]) =>
				z.widgets.includes(id)
			)?.[0] ?? null
		)
	}
	/**
	 * The ids this editing session's Duplicates wrote settings or a pin
	 * under — every one minted fresh, so none held anything before. Cancel
	 * clears them; Done and a re-seed (a copy landing, Save as new) keep them,
	 * and start the list again. Not `$state`: nothing renders it.
	 */
	let duplicatedIds: string[] = []
	/**
	 * **Duplicate** a placed widget (brief 7b; QD, the plan's recommended
	 * default — ./widgetInstances `DUPLICATE_RULE`): mint a copy of its widget,
	 * hand it the source's settings and style pin verbatim — `channel`
	 * included — and seat it beside the source, at the source's size where
	 * the zone can make that much room, else at a new card's footprint.
	 * Refused at the widget's cap, and in a zone with no room at all. Answers
	 * the copy's id.
	 *
	 * The copy's id is minted FRESH (`mintInstanceId`'s `fresh`): never one
	 * holding stored values, the bare id included, so the writes below never
	 * overwrite anything. They go straight to the server, as every settings
	 * write does; the ids are remembered so Cancel can take them back.
	 */
	function duplicateWidget(sourceId: string): string | null {
		if (!duplicateOffered()) return null
		const widgetId = widgetOfInstance(sourceId)
		if (!offers.some((o) => o.id === widgetId)) return null
		const refusal = copyRefusalOf(sourceId)
		if (refusal) {
			toaster.info({ title: refusal })
			return null
		}
		const target = placeTargetOf(sourceId)
		if (!target) return null
		const id = mintInstanceId(widgetId, mintTaken(), storedIds(), {
			fresh: true
		})
		// Beside the source: after it in a list, and at its size in a frame.
		const list =
			target === MIDDLE_TARGET
				? null
				: model.layout.zones[target]?.widgets
		const at = list ? list.indexOf(sourceId) : -1
		const after = list && at >= 0 ? list[at + 1] : undefined
		const zoneKey = targetZoneKey(target)
		const src = zoneKey
			? input.working[zoneKey]?.items.find((i) => i.id === sourceId)
			: undefined
		const size = src ? { w: src.w, h: src.h } : undefined
		// Room before anything is written: a refused copy leaves nothing
		// behind, on the server or on screen.
		if (!seatingIn(target, id, size)) {
			noRoomIn(target)
			return null
		}
		forgetViewState(id)
		// The values first, so the copy's first draw already wears them.
		const carry = duplicateValues(
			sourceId,
			allWidgetSettingValues(),
			widgetStylePins()
		)
		if (carry.settings) putWidgetSettings(id, carry.settings)
		if (carry.pin) setWidgetStylePin(id, carry.pin)
		if (carry.settings || carry.pin) duplicatedIds.push(id)
		place(target, id, after, size)
		return id
	}
	// The Settings tab's overlay offers Duplicate while the editor is open —
	// never under QD's (1), tray only.
	$effect(() => {
		setWidgetDuplicator(
			duplicateOffered()
				? { duplicate: duplicateWidget, refusal: copyRefusalOf }
				: null
		)
		return () => setWidgetDuplicator(null)
	})
	function removeWidget(widgetId: string) {
		// The primary floor (./primaryFloor): the last placed instance of the
		// genre's primary never goes. Its × is not drawn; this also turns away
		// the other ways in — a card dragged back to the tray.
		const keep = floorNoteOf(widgetId)
		if (keep) {
			toaster.info({ title: keep })
			return
		}
		commit(withoutWidget(model.layout, widgetId))
		// The same split as `place`: the zone template above cannot reach a
		// grid widget, so its card's × would remove nothing at all and the
		// re-seed would bring it straight back from the grid.
		if (gridHolds(widgetId))
			commitGrid(withoutGridWidget(model.chatGrid, widgetId))
		// And out of the working arrangement: a zone is seeded from its
		// working frame too (./editorSeed), so a card left there — one dragged
		// in, which no committed list names — would be seeded straight back.
		for (const key of ZONE_IDS) {
			const frame = input.working[key]
			if (frame?.items.some((i) => i.id === widgetId))
				input.setFrame(key, {
					...frame,
					items: frame.items.filter((i) => i.id !== widgetId)
				})
		}
		manager.close(widgetId)
		input.markSimDirty()
	}

	/**
	 * A tray chip's drag carries a WIDGET id, under its own type: dropped, it
	 * mints a new instance (`addWidget`), where a placed card's drag
	 * (`text/sp-widget`, an instance id) moves that instance.
	 */
	const TRAY_DRAG_TYPE = "text/sp-tray-widget"
	function onTrayDragStart(e: DragEvent, widgetId: string) {
		e.dataTransfer?.setData(TRAY_DRAG_TYPE, widgetId)
		// "move", as a card's: the zones answer every drag with that effect.
		if (e.dataTransfer) e.dataTransfer.effectAllowed = "move"
	}
	function draggedId(e: DragEvent): string | null {
		return e.dataTransfer?.getData("text/sp-widget") || null
	}
	// `target` is a side zone's id or `MIDDLE_TARGET` — what `place` routes on
	// and what the drag-over highlight is keyed by.
	function onZoneDragOver(e: DragEvent, target: string) {
		if (!model.placing) return
		e.preventDefault()
		dragOverZone = target
		if (e.dataTransfer) e.dataTransfer.dropEffect = "move"
	}
	function onZoneDrop(e: DragEvent, target: string, beforeId?: string) {
		if (!model.placing) return
		e.preventDefault()
		e.stopPropagation()
		dragOverZone = null
		const widgetId = e.dataTransfer?.getData(TRAY_DRAG_TYPE)
		if (widgetId) {
			addWidget(target, widgetId, beforeId)
			return
		}
		const id = draggedId(e)
		if (id) place(target, id, beforeId)
	}
	function onZoneClick(target: string) {
		if (model.placing && armedId) addWidget(target, armedId)
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
		/** The Duplicates this edit wrote (what Cancel takes back), and a fresh start. */
		takeDuplicated(): string[] {
			const ids = duplicatedIds
			duplicatedIds = []
			return ids
		},
		trayIcon,
		copyRefusalOf,
		floorNoteOf,
		toggleZonePin,
		pinOnDrop,
		addWidget,
		duplicateWidget,
		removeWidget,
		onTrayDragStart,
		draggedId,
		onZoneDragOver,
		onZoneDrop,
		onZoneClick
	}
}

export type EditorMembership = ReturnType<typeof createEditorMembership>
