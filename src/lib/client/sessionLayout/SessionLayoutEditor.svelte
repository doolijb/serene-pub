<script lang="ts">
	/**
	 * The session LAYOUT EDITOR: the desktop toolbar (Presets · Settings ·
	 * Move), the Move tab's gridstack canvas and its screen-size simulator, the
	 * phone's row editor, Start from / Save as, and Done / Cancel.
	 *
	 * Mounted by the composition root only while the editor is open, so every
	 * piece of state here is this edit's and goes when it closes. It never
	 * writes the live view's state: what it changes about the layout it EMITS
	 * — `onLayout` with the slots a change rewrites (the root persists them),
	 * and `onWorking` with the arrangement in progress (the root draws it
	 * through the model while the editor is open, so the Presets and Settings
	 * tabs preview it). The side rail model's transient open state and the
	 * simulator's width are the model's, which the live view reads too.
	 *
	 * The header's Layout button is the one way in (./layoutEditor); while the
	 * desktop editor is open the shell hands its top band to the toolbar.
	 */
	import { untrack } from "svelte"
	import type { SurfaceManager } from "$lib/client/surfaces/panelManager.svelte"
	import { placedWidgetIds } from "./schema"
	import { widgetsInZone } from "./widgetGrid"
	import { floorKeptId, floorRefusal } from "./primaryFloor"
	import {
		arrangementAtDone,
		changedSlots,
		placementAtDone
	} from "./donePlacement"
	import {
		editorSeedKey,
		editorZoneIds,
		middleSeedPlace,
		sideSeedPin,
		type ZoneMembers
	} from "./editorSeed"
	import { emptyMiddleRefusal } from "./placementRules"
	import { toaster } from "$lib/client/utils/toaster"
	import { zoneEntries } from "./panelWidgets"
	import type { GsItem } from "./GridStackZone.svelte"
	import {
		arrangedIds,
		arrangementIsEmpty,
		dedupeArranged,
		loadArranged,
		seedPositions,
		withGeometry,
		withPins
	} from "./arrangedGeometry"
	import { simulationExit, simulationRebase, type SimTier } from "./simulator"
	import type { RenderUnit } from "./tabGroups"
	import type { ColumnLayout } from "./sideRail"
	import { dropWidgetStylePins } from "$lib/client/stores/widgetStyles.svelte"
	import { dropWidgetSettings } from "$lib/client/stores/widgetSettings.svelte"
	import { CORE_WIDGETS } from "$lib/shared/widgets/types"
	import {
		type ArrangedGridV1,
		type ArrangedItem,
		type ArrangedZone,
		isInstanceOf,
		type SessionLayoutV1,
		widgetOfInstance,
		type ZoneId,
		type ZoneLayoutV1
	} from "@serene-pub/sdk"
	import { closeWidgetSettings } from "./widgetSettingsModal.svelte"
	import MobileLayoutEditor from "./MobileLayoutEditor.svelte"
	import LayoutEditorToolbar from "./LayoutEditorToolbar.svelte"
	import LayoutEditCanvas from "./LayoutEditCanvas.svelte"
	import GroupRail from "./GroupRail.svelte"
	import PresetPicture from "./PresetPicture.svelte"
	import type { SessionLayoutModel } from "./sessionLayoutModel.svelte"
	import type { WidgetSettingsFlow } from "./widgetSettingsFlow.svelte"
	import { createEditorMembership } from "./editorMembership.svelte"
	import type { StartFromProps } from "./startFrom"

	/** The starting points and their verbs are the page's (./startFrom). */
	interface Props extends StartFromProps {
		model: SessionLayoutModel
		flow: WidgetSettingsFlow
		manager: SurfaceManager
		sessionId: number | null
		/** The arrangement in progress, emitted on every change (the live preview). */
		onWorking: (arranged: ArrangedGridV1) => void
		/** The slots a change rewrites; the composition root persists them. */
		onLayout: (patch: SessionLayoutV1) => void
		/** Ask the live view to put a pop-over away (any, or one zone's). */
		onPutAway: (zoneId?: string) => void
		/** The editor is done (Done or Cancel): the root closes it. */
		onClose: () => void
	}

	let {
		model,
		flow,
		manager,
		sessionId,
		presets = [],
		startedFromLayoutPresetId = null,
		startedFromUpdated = false,
		onStartFrom,
		onSavePreset,
		onRenamePreset,
		onDeletePreset,
		onPresetUsage,
		presetUsage = null,
		onSaveChanges,
		onShareLayout,
		onCloneLayout,
		onSetNewSessionLayout,
		genreName = null,
		isGuest = false,
		isAdmin = false,
		onWorking,
		onLayout,
		onPutAway,
		onClose
	}: Props = $props()

	let rail = $derived(model.rail)
	const inst = (id: string) => model.inst(id)
	const isConversation = (id: string) => model.isConversation(id)
	const widgetLabel = (id: string) => flow.widgetLabel(id)
	let layout = $derived(model.layout)
	let chatGrid = $derived(model.chatGrid)
	let primaryId = $derived(model.primaryId)
	let leftZoneId = $derived(model.leftZoneId)
	let rightZoneId = $derived(model.rightZoneId)

	/* ── the working copy (the editor → live connector) ─────────────────────
	 * `editArranged` is the EDITOR's working copy: the gridstack zones report
	 * each zone's arrangement (cell dims + item cells) into it as you edit, and
	 * it is seeded from persistence as the editor opens (and re-seeded by a
	 * copy landing or Save as new, which change what "persisted" means).
	 * Committed on Done. Every change is emitted (`onWorking`), and the live
	 * view draws it through the model while the editor is open. */
	let editArranged = $state<ArrangedGridV1>({})
	// What the live view draws while the editor is open. A card dragged from
	// one side to the other can be reported by BOTH zones for a moment, and
	// the drawn layout admits an id once, in reading order (middle, left,
	// right) — so a right-to-left drag previewed in its destination and a
	// left-to-right one in its source. Deduplicated the way Done does it, the
	// last drop names the zone that holds it: the preview shows the card where
	// it was dropped.
	$effect(() => {
		onWorking(
			dedupeArranged(
				$state.snapshot(editArranged) as ArrangedGridV1,
				lastDropped
			).arranged
		)
	})
	/**
	 * The zones' membership as the editor opened, and the whole of what Cancel
	 * can put back: adding or removing a widget writes straight through to the
	 * layout, so an editor that could only restore the arrangement would leave
	 * a cancelled add behind.
	 */
	let editZonesSnapshot = $state<ZoneLayoutV1 | null>(null)
	/**
	 * Which secondaries were ACTIVE as the editor opened — the other half of
	 * what Cancel puts back. Adding a widget activates its panel and removing
	 * one closes it, and the model re-injects every active-but-unplaced
	 * secondary into a side zone, so restoring the zones alone would hand a
	 * cancelled add straight back on the right and leave a cancelled removal
	 * gone. Not `$state`: nothing renders it.
	 */
	let editActiveSnapshot: Set<string> | null = null
	/**
	 * The MIDDLE's membership as the editor opened — the third thing Cancel
	 * puts back, because adding or removing a widget there writes straight
	 * through to the widget grid and `editZonesSnapshot` cannot see it. The
	 * stored blob, verbatim: legitimately `undefined` on a layout that never
	 * saved a grid, and that is a value to put back — so it is boxed. Not
	 * `$state`: nothing renders it.
	 */
	let editWidgetGridSnapshot: { value: unknown } | null = null
	/**
	 * The last cross-zone drop, as the destination zone reported it. The one
	 * event that names a widget AND the zone that now holds it, so it is what
	 * `commitArrangement`'s one-zone-per-widget invariant breaks a tie with.
	 */
	let lastDropped: { id: string; zone: ZoneId } | null = null
	/**
	 * The zones a HAND wrote during this edit — a gesture in the zone (drag,
	 * resize, drop in or out, fit, dock, anchor, group), a group pinned in the
	 * rail preview, a row moved in the phone editor. Done writes the frame of
	 * a zone the stored layout does not arrange only when it is here
	 * (./donePlacement `arrangementAtDone`); every other such frame is the
	 * zone's seed. Not `$state`: nothing renders it.
	 */
	const authoredZones = new Set<ZoneId>()
	/**
	 * Every id the layout places while editing: the side lists, the middle
	 * grid and the WORKING arrangement — what the primary floor counts, and
	 * what Save as new sends as `drawn`.
	 */
	let placedIds = $derived(
		new Set<string>([
			...placedWidgetIds(layout),
			...model.middleGridIds,
			...arrangedIds(editArranged)
		])
	)
	/** The primary widget's own title — the floor's note names the widget. */
	let primaryTitle = $derived(
		CORE_WIDGETS.find((w) => w.id === widgetOfInstance(primaryId))?.title ??
			inst(primaryId)?.title ??
			widgetLabel(primaryId)
	)

	/* ── the guard that keeps a LOOK from becoming an EDIT ────────────────
	 * Drawing a zone narrower re-measures it, so gridstack re-columns and
	 * reports the clamped result back through `onChange` — indistinguishable, at
	 * that seam, from the user having dragged everything into one column. So
	 * previewing Compact would rewrite the real arrangement, and Actual would not
	 * spread it back out: a preview button would be a destructive edit.
	 *
	 * Hence: snapshot on the way in, put it back on the way out — unless a real
	 * GESTURE happened while simulating, which the zones report through
	 * `onGesture`. A gesture at a narrow tier is a deliberate edit to the ONE
	 * arrangement, at every size, which is what the panel's note says out loud.
	 * The tier itself is the model's (`simTier`): the live view reads it. */
	/** The arrangement as it stood the moment Actual was left. */
	let simSnapshot = $state<ArrangedGridV1 | null>(null)
	/** Whether the user has arranged anything since. */
	let simDirty = $state(false)
	/**
	 * A user gesture: the zone it happened in (when one is named) is now
	 * AUTHORED, and while simulating the preview's clamp becomes the user's.
	 */
	function markSimDirty(zone?: ZoneId) {
		if (zone) authoredZones.add(zone)
		if (model.simTier !== null) simDirty = true
	}
	/** Pick a tier, or `null` for Actual. Entering Actual→tier takes the snapshot. */
	function setSimTier(tier: SimTier | null) {
		if (tier === model.simTier) return
		if (tier === null) {
			exitSimulation()
			return
		}
		// Tier→tier keeps the original snapshot: the arrangement to restore is
		// still the one from before any preview, not the last preview's clamp.
		if (model.simTier === null) {
			simSnapshot = $state.snapshot(editArranged) as ArrangedGridV1
			simDirty = false
		}
		model.simTier = tier
	}
	/**
	 * Back to Actual, restoring the pre-preview arrangement unless the user
	 * earned the simulated one. Leaving the simulated branch destroys the whole
	 * edit canvas and rebuilds it from `editArranged`, so putting the state back
	 * is the whole job. Safe to call when not simulating — Done leans on that.
	 */
	function exitSimulation() {
		if (model.simTier === null) return
		editArranged = simulationExit(
			simSnapshot,
			$state.snapshot(editArranged) as ArrangedGridV1,
			simDirty
		).arranged
		model.simTier = null
		simSnapshot = null
		simDirty = false
	}
	// The width simulator belongs to the Move tab and only to it: leaving the
	// tab (or Done) drops back to Actual, so the editor is never left looking
	// at a screen the user isn't on — and drops the preview's clamp with it.
	$effect(() => {
		if (model.placing) return
		untrack(() => exitSimulation())
	})
	/**
	 * A phone has no tab strip: presets are a sheet, settings and style are the
	 * sheet a row's own button opens, so the tabs collapse to the one the row
	 * list is.
	 */
	$effect(() => {
		if (model.mobileEdit) model.editTab = "move"
	})

	/* ── adding, duplicating, removing (./editorMembership) ────────────── */
	const membership = createEditorMembership({
		get model() {
			return model
		},
		get manager() {
			return manager
		},
		get sessionId() {
			return sessionId
		},
		get working() {
			return editArranged
		},
		setFrame: (zone, frame) => (editArranged[zone] = frame),
		get zonesSnapshot() {
			return editZonesSnapshot
		},
		get placedIds() {
			return placedIds
		},
		get primaryTitle() {
			return primaryTitle
		},
		markSimDirty,
		onLayout: (patch) => onLayout(patch),
		onPutAway: (zoneId) => onPutAway(zoneId)
	})
	const { floorNoteOf, copyRefusalOf } = membership

	/* ── seeding ────────────────────────────────────────────────────────── */
	/**
	 * Seed the editor's working copy and what Cancel puts back from the
	 * layout as it is saved — as the editor opens, and again whenever that
	 * layout is REPLACED underneath it (a copy landing, a Save as new).
	 */
	function seedEditor() {
		// Reseed from the persisted arrangement (not wiped) so the editor
		// opens on what was last saved — the source of truth, so there's no
		// stale in-memory state to re-commit.
		editArranged = loadArranged(manager.arrangedGrid)
		// What Cancel puts back; the arrangement's own restore is the reseed.
		editZonesSnapshot = JSON.parse(JSON.stringify(layout)) as ZoneLayoutV1
		// The middle's half of the same restore — the slot verbatim, possibly
		// `undefined`, which is a value to put back.
		editWidgetGridSnapshot = { value: $state.snapshot(manager.widgetGrid) }
		// The other half of it: which panels were on.
		editActiveSnapshot = new Set(model.activeSecondaryIds)
		// What Cancel takes back starts again from here too.
		membership.takeDuplicated()
		// The layout now stored is the one Done compares against, so nothing
		// written before this counts as authored against it.
		authoredZones.clear()
		// A layout replaced under the phone-width preview (a copy asked for
		// from its Presets sheet or Reset chip): the preview's "before" is now
		// the replacement, or Done's `exitSimulation` would put the pre-copy
		// arrangement back and save it under the copy's provenance.
		const guard = simulationRebase(
			model.simTier !== null,
			$state.snapshot(editArranged) as ArrangedGridV1
		)
		simSnapshot = guard.snapshot
		simDirty = guard.dirty
	}
	untrack(seedEditor)
	/**
	 * How many copies this editor asked for (Start from, Start again, Reset,
	 * Start from scratch) whose answers have not re-seeded the manager yet. A
	 * refused one is taken back (`startFrom`), so a later re-seed from
	 * anywhere else never throws away an edit in progress.
	 */
	let copiesPending = 0
	// When that copy lands the page re-seeds the manager, and the open editor
	// must then draw the new layout, not the one it opened on. Only for a copy
	// it asked for: a re-seed from anywhere else (another tab opening the
	// session) never throws away an edit in progress.
	let seenSeeds = untrack(() => manager.seedCount)
	$effect(() => {
		const n = manager.seedCount
		if (n === seenSeeds) return
		seenSeeds = n
		untrack(() => {
			if (copiesPending === 0) return
			copiesPending--
			seedEditor()
			lastDropped = null
			onPutAway()
			membership.armedId = null
		})
	})

	/* ── gridstack-backed editor items ──────────────────────────────────────
	 * Each zone hands gridstack a plain {id,title,size,floorNote} list;
	 * gridstack owns drag/resize/snap. The list is keyed by its ids, so adding/
	 * removing a widget re-seeds the grid, while a drag/resize — which changes
	 * only positions, not the id set — leaves it untouched. Each list carries
	 * its default placement (place/h); `withGeometry` overlays any saved
	 * x/y/w/h from the working copy so re-opening the editor restores what was
	 * arranged rather than re-laying-out from defaults.
	 *
	 * WHICH cards each zone holds is ./editorSeed's: the zone's committed
	 * members (the middle's grid, a side's zone lists), less what another
	 * zone's working frame took, plus what its own working frame holds that it
	 * does not list. A zone re-seeds only on `editorSeedKeys`, never on a drag. */
	let editorLeftPanels = $derived(
		model.leftZones.flatMap(model.zoneEntriesOf)
	)
	let editorRightPanels = $derived(
		model.rightZones.flatMap(model.zoneEntriesOf)
	)
	let editorCommitted = $derived<ZoneMembers>({
		left: editorLeftPanels.map((p) => p.id),
		middle: widgetsInZone(chatGrid, "middle").map((w) => w.id),
		right: editorRightPanels.map((p) => p.id)
	})
	let editorSeedIds = $derived<ZoneMembers>({
		left: editorZoneIds("left", editorCommitted, editArranged),
		middle: editorZoneIds("middle", editorCommitted, editArranged),
		right: editorZoneIds("right", editorCommitted, editArranged)
	})
	/** The card the primary floor keeps, if exactly one instance is placed. */
	let floorKept = $derived.by(() => floorKeptId(placedIds, primaryId))
	/**
	 * The widgets at their `maxInstances` cap (brief 7b review): their cards
	 * say so where Duplicate would be, and that is drawn at seed — so it is
	 * part of every zone's seed key. No core widget has a cap.
	 */
	let cappedWidgets = $derived.by(() =>
		membership.trayWidgets.filter((t) => t.full).map((t) => t.id)
	)
	let editorSeedKeys = $derived<Record<ZoneId, string>>({
		left: editorSeedKey(editorCommitted.left, floorKept, cappedWidgets),
		middle: editorSeedKey(editorCommitted.middle, floorKept, cappedWidgets),
		right: editorSeedKey(editorCommitted.right, floorKept, cappedWidgets)
	})
	let middleGsItems = $derived<GsItem[]>(
		withGeometry(
			editorSeedIds.middle.flatMap((id): GsItem[] => {
				const w = chatGrid.widgets.find(
					(g) => g.id === id && g.zone === "middle"
				)
				// A card the working arrangement brought in has no grid entry
				// until Done; it is admitted when the middle can draw it.
				if (!w && !isConversation(id) && !inst(id)) return []
				// The chat's bound default, read off the widget rather than its
				// name (./editorSeed `middleSeedPlace`): a GROW height fills what
				// is left, a FIXED one docks three cells deep against the edge it
				// anchors to. A newcomer grows when it is a log (the floor's shape).
				return [
					{
						id,
						title: widgetLabel(id),
						// The primary floor: the LAST placed Messages (or an R71
						// genre's own primary) offers no ×, and says why. Every
						// card moves, into any zone — placement is free (brief 7a).
						...floorNoteProp(id),
						...copyRefusalProp(id),
						...middleSeedPlace(
							w,
							isConversation(id) || isInstanceOf(id, primaryId)
						)
					}
				]
			}),
			editArranged.middle
		)
	)
	/**
	 * A side zone's cards: the panels and conversations its seed ids name.
	 * Each carries the ZONE's pin as its default (./editorSeed
	 * `sideSeedPin`): an un-arranged side is docked or an icon strip as a
	 * whole, so its seed frame says so card by card — and a frame Done writes
	 * for it keeps the side as it was. A card the working frame holds takes
	 * the frame's pin instead (`withGeometry`).
	 */
	function sideGsItems(
		ids: readonly string[],
		zoneId: string | null
	): GsItem[] {
		const pin = sideSeedPin(zoneId ? layout.zones[zoneId] : undefined)
		return zoneEntries(
			ids,
			manager.instances,
			isConversation,
			widgetLabel
		).map((p) => ({
			id: p.id,
			title: p.title,
			h: 3,
			...pin,
			...floorNoteProp(p.id),
			...copyRefusalProp(p.id)
		}))
	}
	let leftGsItems = $derived<GsItem[]>(
		withGeometry(
			sideGsItems(editorSeedIds.left, leftZoneId),
			editArranged.left
		)
	)
	let rightGsItems = $derived<GsItem[]>(
		withGeometry(
			sideGsItems(editorSeedIds.right, rightZoneId),
			editArranged.right
		)
	)
	function floorNoteProp(id: string): { floorNote?: string } {
		const note = floorNoteOf(id)
		return note ? { floorNote: note } : {}
	}
	/** A card whose widget is at its cap says so where Duplicate would be (brief 7b). */
	function copyRefusalProp(id: string): { copyRefusal?: string } {
		const note = copyRefusalOf(id)
		return note ? { copyRefusal: note } : {}
	}

	/* ── the Move tab's rail preview ────────────────────────────────────────
	 * The side rail model, drawn from the EDITOR's working arrangement so the
	 * rail can be played with at every screen size before it is lived with:
	 * toggle a group, pin or unpin one, and watch the column answer at Compact
	 * through Ultrawide. The cards here are titles, not live panels — a second
	 * mount of a real panel is exactly what the no-reload law forbids. */
	/** Measured height and width of each preview column. */
	let previewPx = $state<Record<"left" | "right", number>>({
		left: 0,
		right: 0
	})
	let previewWPx = $state<Record<"left" | "right", number>>({
		left: 0,
		right: 0
	})
	/**
	 * The cell rows an UN-arranged middle is read at: enough of them that a
	 * strip above the conversation reads as a strip against the widget that
	 * fills what is left. A stated choice, not a measured one.
	 */
	const MIDDLE_SEED_ROWS = 12
	function previewColumn(side: ZoneId): {
		/**
		 * The arrangement the preview is a view of. It IS `editArranged[side]`
		 * when there is one; without one it is the default placement resolved
		 * for this side, which is what the gridstack zone would have reported
		 * the moment it mounted. Either way it is a frame the pin toggle can
		 * write into (see `toggleGroupPin`).
		 */
		frame: ArrangedZone
		units: RenderUnit[]
	} {
		const items =
			side === "left"
				? leftGsItems
				: side === "right"
					? rightGsItems
					: middleGsItems
		const frame = editArranged[side]
		const cols = frame?.cols ?? 1
		// No frame yet (a layout never arranged): the items' own default
		// placement is the arrangement, and its rows are what they stack to.
		// The middle is the exception — its messages widget FILLS, so its rows
		// are a proportion rather than a sum, and summing them would hand a
		// 3-cell strip half the chat.
		const rows =
			frame?.rows ??
			(side === "middle"
				? MIDDLE_SEED_ROWS
				: Math.max(
						1,
						items.reduce((n, it) => n + (it.h ?? 3), 0)
					))
		const meta = new Map(items.map((it) => [it.id, it]))
		// `seedPositions` reads cells and returns cells; group, anchor and the
		// group's pin ride on the ITEMS, so they are laid back over its answer.
		const pos: ArrangedItem[] = seedPositions(items, cols, rows, frame).map(
			(c) => {
				const m = meta.get(c.id)
				return {
					...c,
					...(m?.group ? { group: m.group } : {}),
					...(m?.anchor ? { anchor: m.anchor } : {}),
					...(m?.pinned === false ? { pinned: false } : {})
				}
			}
		)
		return {
			frame: { cols, rows, items: pos },
			units: rail.columnUnits(pos)
		}
	}
	let leftPreview = $derived(previewColumn("left"))
	let rightPreview = $derived(previewColumn("right"))
	let middlePreview = $derived(previewColumn("middle"))
	function previewRail(
		side: "left" | "right",
		p: { frame: ArrangedZone; units: RenderUnit[] }
	): ColumnLayout {
		// The same call the live column makes, over the previewed device's
		// numbers: below 1024 a side takes no layout space at all, so the
		// preview shows what that device does — icons, and the tapped group as
		// a sheet. One decision, never a second model.
		return rail.columnLayout(side, p.units, p.frame.rows, {
			sheet: false,
			narrow: model.simNarrow,
			heightPx: previewPx[side],
			widthPx: previewWPx[side]
		})
	}
	let leftPreviewCol = $derived(previewRail("left", leftPreview))
	let rightPreviewCol = $derived(previewRail("right", rightPreview))
	/**
	 * Pin / unpin one group (ruled 2026-09-10) — the Move tab's toggle, and a
	 * real persisted decision: it is written onto the arranged ITEMS the group
	 * is made of, so Done commits it with the rest of the arrangement and a
	 * preset saved from it carries it.
	 *
	 * Intentionally NOT `markSimDirty`. A pin moves no cell, so it must not make
	 * a previewed width's clamp count as an arrangement the user made. But
	 * `exitSimulation` puts the pre-preview arrangement back, which would take
	 * the pin with it, so the pin is written into that snapshot too.
	 */
	function toggleGroupPin(side: "left" | "right", u: RenderUnit) {
		const next = !rail.groupPinned(u)
		const ids = u.members.map((m) => m.id)
		const saved = editArranged[side]
		// The frame to write into. Normally the working arrangement itself —
		// but the preview can show a group that arrangement has not caught up
		// with (a side with none yet, or a widget enabled since it was last
		// reported), and a pin written into a frame missing that id would be
		// dropped on the floor. The preview's own frame always contains it.
		const base =
			saved && ids.every((id) => saved.items.some((i) => i.id === id))
				? saved
				: (side === "left" ? leftPreview : rightPreview).frame
		editArranged[side] = withPins(base, ids, next)
		// A group's pin is written onto the side's frame, so the frame is
		// the user's now: Done writes it, a seed or not.
		authoredZones.add(side)
		if (model.simTier !== null && simSnapshot)
			simSnapshot[side] = withPins(simSnapshot[side] ?? base, ids, next)
		// "Pinned" IS "expanded by default", so saying it opens the group; and
		// unpinning hands it back to the rail.
		rail.groupOpen[rail.groupKey(side, u.key)] = next
		if (!next && rail.groupFocus[side] === u.key)
			rail.groupFocus[side] = null
	}
	/**
	 * A preview group that flew out closes on outside click and Escape, like
	 * the live column's (`data-pop-keep` marks the editor's zones and the
	 * flyout). Only armed while the preview is drawn and something flies.
	 */
	$effect(() => {
		if (!model.railPreview) return
		const flying = {
			left: leftPreviewCol.flyout,
			right: rightPreviewCol.flyout
		}
		const sides = (["left", "right"] as const).filter(
			(side) => flying[side]
		)
		if (!sides.length) return
		const shut = () => {
			for (const side of sides) {
				const k = flying[side]
				if (!k) continue
				rail.groupOpen[rail.groupKey(side, k)] = false
				rail.groupFocus[side] = null
			}
		}
		const onDown = (e: PointerEvent) => {
			if ((e.target as HTMLElement | null)?.closest("[data-pop-keep]"))
				return
			shut()
		}
		const onKey = (e: KeyboardEvent) => {
			if (e.key === "Escape") shut()
		}
		document.addEventListener("pointerdown", onDown, true)
		document.addEventListener("keydown", onKey)
		return () => {
			document.removeEventListener("pointerdown", onDown, true)
			document.removeEventListener("keydown", onKey)
		}
	})

	/* ── Done, Cancel ───────────────────────────────────────────────────── */
	/**
	 * Commit the editor arrangement on Done: side-zone membership into the zone
	 * template (for the palette/active logic), and the full per-zone geometry
	 * into the arrangement (positions + anchors + groups — what makes the
	 * arrangement survive a reload and restore into the editor). EMITTED: the
	 * composition root persists the slots that changed.
	 *
	 * Returns false, having written NOTHING, when Done is refused — QF (1)
	 * (./placementRules): a middle left empty is almost always a move
	 * half-made, so the editor stays open and says so.
	 */
	function commitArrangement(): boolean {
		// Never persist a PREVIEW. Done can be pressed with a tier still
		// showing, so leave simulation here, synchronously, and save the
		// arrangement the user actually made. A no-op at Actual, and a no-op
		// after a gesture (that arrangement is theirs).
		exitSimulation()
		// The invariant, enforced here because here is where the three zones
		// first exist side by side: a widget id lives in exactly ONE zone. The
		// warning is deliberate — a silent repair hides the regression that
		// made the repair necessary.
		const deduped = dedupeArranged(
			$state.snapshot(editArranged) as ArrangedGridV1,
			lastDropped
		)
		for (const d of deduped.duplicates)
			console.warn(
				`[session layout] "${d.id}" was arranged in more than one zone ` +
					`(${[d.kept, ...d.dropped].join(", ")}); kept ${d.kept}.`
			)
		const arrangement = deduped.arranged
		// Membership, both halves (./donePlacement): each side that reported a
		// frame has its list replaced in row order, and the middle's grid is
		// reconciled against its frame — an ABSENT middle frame is no opinion,
		// never an empty middle. Placement is free: the conversation is
		// written wherever its card was left, a side included. Read off the
		// WHOLE arrangement, seeds included: a seed holds its zone's members
		// in the order the zone lists them, so it moves none of them.
		const done = placementAtDone({
			zones: layout,
			grid: chatGrid,
			arrangement,
			sideZoneIds: { left: leftZoneId, right: rightZoneId },
			primaryId
		})
		// The arrangement Done writes: the stored layout's frames and the ones
		// a hand wrote, never a zone's seed (./donePlacement
		// `arrangementAtDone`). A middle the stored layout draws from its grid
		// stays drawn from it — a `fixed` strip at its own height — and an
		// un-arranged side stays its zone list and the ladder.
		const kept = arrangementAtDone(
			arrangement,
			model.storedArranged,
			authoredZones
		)
		// The floor, asked of what Done would commit (./primaryFloor): the
		// backstop for a card lost some other way — refused and said, never
		// committed for every reader to repair. Then QF: an empty middle is a
		// move half-made.
		const refusal =
			floorRefusal(
				{ zones: done.zones, grid: done.grid, arranged: kept },
				primaryId,
				primaryTitle
			) ?? emptyMiddleRefusal(done.middle)
		if (refusal) {
			toaster.error({ title: refusal })
			return false
		}
		// Only the slots that CHANGED, compared through the round trip's one
		// normaliser (./donePlacement `changedSlots`) — so Done with no change
		// writes nothing. The grid is compared with the SAVED grid, not the
		// floored one: where the floor appended the log to a layout that never
		// saved one, Done is what makes that placement the saved one. An
		// arrangement with no widgets in it is stored as none, which is what
		// an empty one means.
		const patch = changedSlots(
			{
				zoneLayout: layout,
				widgetGrid: model.savedGrid,
				arrangedGrid: model.storedArranged
			},
			{
				zoneLayout: done.zones,
				widgetGrid: done.grid,
				arrangedGrid: arrangementIsEmpty(kept) ? undefined : kept
			}
		)
		// The live view's only source once the editor closes; with nothing
		// changed it already draws the stored layout.
		if (Object.keys(patch).length) onLayout(patch)
		return true
	}
	/**
	 * Leave the editor, keeping everything — the desktop Done, the bar's, and
	 * the header's Layout button pressed again (the composition root calls
	 * this). Done saves to THIS SESSION only (owner L3); a named layout is Save
	 * as new layout's. A refused Done leaves the editor open.
	 */
	export function finishEditing() {
		if (!commitArrangement()) return
		closeEditor()
	}
	/**
	 * Leave the editor, keeping nothing: the arrangement goes back to what is
	 * persisted, and the zones' membership AND the panels' active state to what
	 * they held when the editor opened — adding and removing a widget writes
	 * straight through to both.
	 */
	function cancelEditing() {
		exitSimulation()
		// Activations first: the zones are written next, and a zone naming a
		// panel that is still closed is not the layout that was opened on.
		const wasActive = editActiveSnapshot
		if (wasActive) {
			for (const p of manager.instances) {
				if (p.role === "primary") continue
				if (p.active && !wasActive.has(p.id)) manager.close(p.id)
				else if (!p.active && wasActive.has(p.id))
					manager.activate(p.id)
			}
		}
		const patch: SessionLayoutV1 = {}
		if (editZonesSnapshot) patch.zoneLayout = editZonesSnapshot
		// …and the middle's membership, which lives in the other slot: the
		// stored blob, verbatim and possibly unset, not a parsed grid.
		if (editWidgetGridSnapshot)
			patch.widgetGrid =
				editWidgetGridSnapshot.value as SessionLayoutV1["widgetGrid"]
		if ("zoneLayout" in patch || "widgetGrid" in patch) onLayout(patch)
		editArranged = loadArranged(manager.arrangedGrid)
		// …and what this edit's Duplicates wrote, under ids the restored
		// layout does not place (each was minted holding nothing).
		const duplicated = membership.takeDuplicated()
		if (duplicated.length) {
			dropWidgetSettings(duplicated)
			dropWidgetStylePins(duplicated)
		}
		closeEditor()
	}
	function closeEditor() {
		membership.takeDuplicated()
		copiesPending = 0
		membership.armedId = null
		editZonesSnapshot = null
		editActiveSnapshot = null
		editWidgetGridSnapshot = null
		lastDropped = null
		// A widget's settings modal is module state, so it is closed here: its
		// entry points are the editor's. The phone editor's sheets go with it.
		closeWidgetSettings()
		onClose()
	}

	/* ── starting points (the copy model) ───────────────────────────────
	 * The pane lists the session layout presets this person may start from.
	 * Every verb here REPLACES this session's layout with a copy (brief 3 of
	 * `PLAN-layout-one-format-2026-09-28`); the page owns the round trips, and
	 * the copy's answer re-seeds the manager, which the open editor follows.
	 * Both editors ask before they call `startFrom` or `resetLayout` (brief 4,
	 * `./startFrom` and `LayoutConfirmDialog`), so nothing here asks again. */
	/** The preset this session's layout started from, if it is still listed. */
	let startedFrom = $derived(
		presets.find((p) => p.id === startedFromLayoutPresetId) ?? null
	)
	/** The genre's genre default layout, if its owner ships one. */
	let genreDefaultPreset = $derived(
		presets.find((p) => p.isGenreDefault) ?? null
	)
	/**
	 * What **Start again from "X"** re-copies: the source, when it is still
	 * one this person can start from and is not the genre default layout
	 * (Reset covers that one).
	 */
	let startAgainFrom = $derived(
		startedFrom && !startedFrom.isGenreDefault ? startedFrom : null
	)
	/** Copy a preset in (`null`: Start from scratch). */
	async function startFrom(layoutPresetId: number | null) {
		if (!onStartFrom) return
		copiesPending++
		const asked = onStartFrom(layoutPresetId)
		onPutAway()
		membership.armedId = null
		// Refused (the preset went, another genre's, a thrown handler): no
		// re-seed is coming for it. Landed: the re-seed already took it back.
		if (!(await asked) && copiesPending > 0) copiesPending--
	}
	/**
	 * **Reset to genre default layout**: copy the genre default layout back
	 * into this session. A genre whose owner ships none has no such row, and
	 * resetting it is starting from scratch — which is what its sessions
	 * started from in the first place.
	 */
	function resetLayout() {
		startFrom(genreDefaultPreset?.id ?? null)
	}
	/**
	 * **Save as new layout**: commit what is arranged (as Done would — the
	 * saved layout is what this session now holds), then save it as a new
	 * named layout the session started from. The editor stays open, re-seeded
	 * on the committed layout. Returns whether it was sent, so the dialog
	 * keeps a refused name for the next try.
	 */
	function savePreset(name: string, description = ""): boolean {
		const n = name.trim()
		if (!n) return false
		if (!commitArrangement()) return false
		onSavePreset?.(n, [...placedIds], description.trim() || undefined)
		seedEditor()
		return true
	}
	/**
	 * **Save changes to "*Name*"** (brief 6b): commit what is arranged, as
	 * Save as new does, then write it back into the layout of this person's
	 * that the session started from. The editor stays open, re-seeded on the
	 * committed layout. Returns whether it was sent.
	 */
	function saveChanges(presetId: number, overwriteUpdated: boolean): boolean {
		if (!commitArrangement()) return false
		onSaveChanges?.(presetId, [...placedIds], overwriteUpdated)
		seedEditor()
		return true
	}
</script>

<!-- A preset's PICTURE (./PresetPicture), handed to both editors' cards. -->
{#snippet presetPicture(preset: unknown)}
	<PresetPicture {preset} {widgetLabel} />
{/snippet}

<!-- The Move tab's preview rail: the live side's own rail (./GroupRail), over
     the editor's working arrangement. The editor never tucks. -->
{#snippet groupRail(
	side: "left" | "right",
	units: RenderUnit[],
	col: ColumnLayout,
	markPinned: boolean
)}
	<GroupRail {side} {units} {col} {markPinned} {rail} />
{/snippet}

<!-- The Move tab's three editor zones — drawn at the real width or inside the
     simulator's frame. ONE call site in source, drawn by whichever branch is
     up: switching branches rebuilds the canvas either way (see
     `exitSimulation`). -->
{#snippet canvas()}
	<LayoutEditCanvas
		editGeom={model.editGeom}
		{leftZoneId}
		{rightZoneId}
		{leftGsItems}
		{middleGsItems}
		{rightGsItems}
		seedKeys={editorSeedKeys}
		bind:editArranged
		railPreview={model.railPreview}
		bind:dragOverZone={membership.dragOverZone}
		armedId={membership.armedId}
		onZoneDragOver={membership.onZoneDragOver}
		onZoneDrop={membership.onZoneDrop}
		onZoneClick={membership.onZoneClick}
		placing={model.placing}
		{layout}
		storedArranged={model.storedArranged}
		toggleZonePin={membership.toggleZonePin}
		removeWidget={membership.removeWidget}
		duplicateWidget={membership.duplicateWidget}
		onDropped={(id, zone) => (lastDropped = { id, zone })}
		pinOnDrop={membership.pinOnDrop}
		{markSimDirty}
		{leftPreview}
		{rightPreview}
		{leftPreviewCol}
		{rightPreviewCol}
		simNarrow={model.simNarrow}
		simHeight={model.simHeight}
		bind:previewPx
		bind:previewWPx
		groupIcon={rail.groupIcon}
		groupTitle={rail.groupTitle}
		groupPinned={rail.groupPinned}
		{toggleGroupPin}
		cellGridStyle={rail.cellGridStyle}
		{groupRail}
	/>
{/snippet}

<!-- The phone's row editor (ruled 2026-09-10): the row list, its sheets and
     their state, which unmounts with it. ONE call site in source, drawn at
     the real width over the live session, or in the simulator's frame. -->
{#snippet phoneEditor()}
	<MobileLayoutEditor
		bind:editArranged
		onZoneAuthored={(zone) => authoredZones.add(zone)}
		{leftPreview}
		{rightPreview}
		{middlePreview}
		simTier={model.simTier}
		simWidth={model.simWidth}
		bind:simSnapshot
		{leftZoneId}
		{rightZoneId}
		bind:groupOpen={rail.groupOpen}
		groupKey={rail.groupKey}
		{inst}
		iconOf={model.iconOf}
		middleWidgetIcon={model.middleWidgetIcon}
		{widgetLabel}
		trayWidgets={membership.trayWidgets}
		trayIcon={membership.trayIcon}
		addWidget={membership.addWidget}
		duplicateWidget={membership.duplicateWidget}
		removeWidget={membership.removeWidget}
		{floorNoteOf}
		{presets}
		{startedFrom}
		{startedFromUpdated}
		{startAgainFrom}
		{startFrom}
		{savePreset}
		{resetLayout}
		mainWidgetTitle={primaryTitle}
		{onRenamePreset}
		{onDeletePreset}
		{onPresetUsage}
		{presetUsage}
		{saveChanges}
		{genreName}
		{isGuest}
		{isAdmin}
		{onShareLayout}
		{onCloneLayout}
		{onSetNewSessionLayout}
		onCancel={cancelEditing}
		onDone={finishEditing}
		{presetPicture}
	/>
{/snippet}

<!-- The toolbar is the DESKTOP's, and it survives a previewed phone width:
     the tier buttons and the grid escape live in it, so hiding it with the
     grid would strand the preview it started. A real narrow window has no
     toolbar at all — the sticky bar at the foot of the row editor is it. -->
{#if !model.isNarrow}
	<LayoutEditorToolbar
		bind:editTab={model.editTab}
		insetStart={model.placing ? 0 : model.mLeft}
		bind:height={model.toolbarH}
		{presets}
		{startedFrom}
		{startedFromUpdated}
		{startAgainFrom}
		{startFrom}
		{savePreset}
		{resetLayout}
		mainWidgetTitle={primaryTitle}
		{onRenamePreset}
		{onDeletePreset}
		{onPresetUsage}
		{presetUsage}
		{presetPicture}
		{saveChanges}
		{genreName}
		{isGuest}
		{isAdmin}
		{onShareLayout}
		{onCloneLayout}
		{onSetNewSessionLayout}
		styleableWidgets={flow.styleableWidgets}
		trayWidgets={membership.trayWidgets}
		trayIcon={membership.trayIcon}
		bind:armedId={membership.armedId}
		bind:dragOverZone={membership.dragOverZone}
		onTrayDragStart={membership.onTrayDragStart}
		draggedId={membership.draggedId}
		removeWidget={membership.removeWidget}
		simTier={model.simTier}
		{setSimTier}
		bind:railPreview={model.railPreview}
		bind:simGrid={model.simGrid}
		simNarrow={model.simNarrow}
		onCancel={cancelEditing}
		onDone={finishEditing}
	/>
{/if}

<!-- A width below the breakpoint gets the ROW editor instead of the grid
     (ruled 2026-09-10). The live session stays mounted underneath it rather
     than being swapped for a canvas, so nothing in it reloads. -->
{#if model.placing && !model.mobileEdit}
	<!-- The Move tab is the visual grid editor: each zone is drawn as its
	     own square-cell grid, IN PLACE. Cards occupy cells; you drag widgets
	     straight onto the zone they belong in. -->
	<div class="edit-scrim"></div>
	{#if model.simWidth != null}
		<!-- Simulated: the whole canvas is drawn at the tier's width inside a
		     centred, labelled frame. `transform` (always set, even at 1) is
		     the scale itself, and what keeps the frame inside the real
		     viewport when the tier is wider than it instead of overflowing.
		     Caveat: gridstack's drag helper lives on <body>, so while the
		     frame is scaled DOWN (label says so) a drag reads a little off. -->
		<div class="sim-stage">
			<div class="sim-label">
				Previewing at {model.simWidth} px{model.simPct < 100
					? ` · shown at ${model.simPct}%`
					: ""}
			</div>
			<div
				class="sim-frame"
				style="inline-size:{model.simWidth}px; transform:scale({model
					.editGeom.scale});"
			>
				{@render canvas()}
			</div>
		</div>
	{:else}
		<!-- Actual: one fixed row filling the window below the toolbar,
		     nav rail included — the scrim already covers it, and the three
		     columns are a split of the whole width, not of `<main>`. -->
		<div class="edit-shell" style="inset-block-start:{model.toolbarH}px;">
			{@render canvas()}
		</div>
	{/if}
{:else if model.placing && model.simWidth != null}
	<!-- A phone width previewed from a desktop: the row editor drawn in the
	     same frame the grid preview uses, at that device's width and height.
	     The frame's `transform` is what its fixed boxes — the editor and its
	     sheets — anchor to, so the preview is a phone rather than a takeover
	     of the whole window. -->
	<div class="edit-scrim"></div>
	<div class="sim-stage">
		<div class="sim-label">
			Previewing at {model.simWidth} px{model.simPct < 100
				? ` · shown at ${model.simPct}%`
				: ""}
		</div>
		<div
			class="sim-frame"
			style="inline-size:{model.simWidth}px; max-block-size:{model.simHeight}px; transform:scale({model
				.editGeom.scale});"
		>
			{@render phoneEditor()}
		</div>
	</div>
{/if}

<!-- The row editor at the REAL width, over the live session: everything in
     the session stays mounted while the order is edited. -->
{#if model.mobileEdit && model.simWidth == null}
	{@render phoneEditor()}
{/if}

<style>
	/* ── the visual grid editor (Move tab), square-cell grids ──────────── */
	/* Dim the live chat / scene backdrop so the grid reads as a distinct mode.
	   Fixed layer under the zones (which are z-index 20). */
	.edit-scrim {
		position: fixed;
		inset: 0;
		z-index: 15;
		background: color-mix(
			in oklab,
			var(--color-surface-950) 62%,
			transparent
		);
		backdrop-filter: blur(2px);
	}
	/* Actual: the canvas fills the window below the toolbar, nav rail included
	   — the three columns are a split of the whole VIEWPORT (the scrim already
	   covers the rail), not of `<main>`. The toolbar's measured height is an
	   inline style, so this rule owns only the box. */
	.edit-shell {
		position: fixed;
		inset-inline: 0;
		inset-block-end: 0;
		z-index: 16;
		display: flex;
		flex-direction: column;
		min-block-size: 0;
	}

	/* ── the screen-size simulator's frame ─────────────────────────────────
	   The stage takes the editor body's slot (in flow, below the toolbar, so it
	   can never cover it) and centres one frame drawn at the simulated width.
	   `overflow: hidden` is the belt to the scale's braces: a frame can never
	   push the page sideways. */
	.sim-stage {
		position: relative;
		z-index: 16;
		flex: 1;
		display: flex;
		flex-direction: column;
		align-items: center;
		min-block-size: 0;
		overflow: hidden;
	}
	/* The frame's label sits OUTSIDE the transform, so "shown at 60%" is not
	   itself rendered at 60%. */
	.sim-label {
		flex: none;
		margin-block-end: 0.3rem;
		padding: 0.12rem 0.5rem;
		border-radius: 0 0 0.45rem 0.45rem;
		font-size: 12px;
		font-weight: 500;
		color: var(--color-surface-50);
		background: color-mix(
			in oklab,
			var(--color-primary-500) 78%,
			transparent
		);
	}
	/* The simulated viewport. Its `transform` is always set (scale(1) included)
	   — the scale itself, and what keeps a tier wider than the window inside
	   it. The canvas it holds is a plain grid row now, so nothing depends on
	   this box being a containing block; the mobile row editor's fixed sheets
	   still do, which is the other reason it is never unset. */
	.sim-frame {
		position: relative;
		flex: 1;
		display: flex;
		flex-direction: column;
		min-block-size: 0;
		transform-origin: top center;
		border: 1.5px solid
			color-mix(in oklab, var(--color-primary-500) 55%, transparent);
		border-radius: 0.5rem;
		background: color-mix(
			in oklab,
			var(--color-surface-950) 22%,
			transparent
		);
	}
</style>
