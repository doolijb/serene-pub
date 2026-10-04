<script lang="ts">
	/**
	 * The PHONE editor (ruled 2026-09-10), split out of SessionLayout.
	 *
	 * Below the breakpoint the layout is an ordered list per zone, because that
	 * is what the session draws there — no side-by-side placements, anchors
	 * reduced to order, each side group a panel that is either open or an icon.
	 * The editor edits exactly those three facts, through ./mobileEdit, into the
	 * SAME `editArranged` the grid writes and the same commit on Done. There is
	 * no mobile layout blob and no mobile preset.
	 *
	 * The two gates that decide whether this is mounted at all — `mobileEdit`
	 * and `liveStowed` — stay in SessionLayout, because the live session's own
	 * mount reads them. This component is only what is drawn once they say yes,
	 * and its sheet state is its own: closing the editor unmounts it, which
	 * resets that state with no work in SessionLayout's `closeEditor`.
	 */
	import { tick, type Snippet } from "svelte"
	import * as Icons from "@lucide/svelte"
	import type { PanelInstance } from "$lib/client/surfaces/types"
	import { duplicateOffered, type TrayWidget } from "./widgetInstances"
	// The phone editor's model (ruled 2026-09-10): below the breakpoint the
	// layout is an ordered list per zone, not a grid, and these are the only
	// edits it may make to the one arrangement. See ./mobileEdit.
	import {
		mobileRows,
		moveMember,
		moveRow,
		moveRowTo,
		restackZone,
		setRowPinned,
		type MobileRow
	} from "./mobileEdit"
	import type { RenderUnit } from "./tabGroups"
	import type { SimTier } from "./simulator"
	// A widget's settings and style open in the one app-level modal — the same
	// one the desktop editor's gear opens, a full-screen sheet at this width.
	import { openWidgetSettings } from "./widgetSettingsModal.svelte"
	// The layouts sheet says what the desktop's Layouts tab says (brief 4):
	// the same groups, status line, Updated offer and questions — and, since
	// brief 6b, the same card menu and Save changes to.
	import LayoutConfirmDialog from "./LayoutConfirmDialog.svelte"
	import SaveAsNewLayoutDialog from "./SaveAsNewLayoutDialog.svelte"
	import LayoutCardMenu from "./LayoutCardMenu.svelte"
	import {
		canManageLayout,
		copyConfirm,
		copyTarget,
		deleteConfirm,
		groupLayoutPresets,
		newSessionChoice,
		newSessionLayoutOf,
		newSessionMark,
		provenanceLine,
		quoted,
		reCopyAsk,
		reCopyLabel,
		saveChangesConfirm,
		sharedMark,
		unshareAsks,
		unshareConfirm,
		updatedSentence,
		type CardMenuAction,
		type CopyAsk,
		type LayoutPresetUsage
	} from "./startFrom"
	import {
		type ArrangedGridV1,
		type ArrangedZone,
		isInstanceOf,
		widgetOfInstance,
		type ZoneId
	} from "@serene-pub/sdk"

	/** One side's previewed column, as SessionLayout's `previewColumn` returns it. */
	type PreviewColumn = { frame: ArrangedZone; units: RenderUnit[] }

	interface Props {
		/**
		 * The editor's working arrangement — the same object the grid editor
		 * writes, bound so `writeZone` stores a re-ordered zone into it.
		 */
		editArranged: ArrangedGridV1
		/** The three previewed columns; only their `frame` is edited here. */
		leftPreview: PreviewColumn
		rightPreview: PreviewColumn
		middlePreview: PreviewColumn
		/** The Move tab's width preset, and the width it stands for. */
		simTier: SimTier | null
		simWidth: number | null
		/**
		 * The arrangement as it stood the moment Actual was left. Written into
		 * as well as read, for the reason `toggleGroupPin` is (see
		 * SessionLayout): leaving the preview restores this snapshot. Bound, so
		 * that write is a co-owner's rather than a stranger's.
		 */
		simSnapshot: ArrangedGridV1 | null
		/** The canonical side zones, or null where the layout has none. */
		leftZoneId: string | null
		rightZoneId: string | null
		/**
		 * The live column's open/closed state, keyed by `groupKey`. Bound for
		 * the same reason `simSnapshot` is: pinning a row writes into it.
		 */
		groupOpen: Record<string, boolean>
		groupKey: (side: "left" | "right", key: string) => string
		/** SessionLayout's lookups over the surface manager. */
		inst: (id: string) => PanelInstance | undefined
		iconOf: (p: PanelInstance) => any
		middleWidgetIcon: (id: string) => any
		widgetLabel: (id: string) => string
		/**
		 * The picker sheet's list (brief 7b): every widget kind, every time —
		 * a placed one with its count, one at its cap disabled with the reason.
		 */
		trayWidgets: TrayWidget[]
		trayIcon: (t: TrayWidget) => any
		/**
		 * Add a widget kind: SessionLayout mints its instance id and lands it,
		 * answering that id (null: refused at its cap).
		 */
		addWidget: (target: string, widgetId: string) => string | null
		/**
		 * A row's Duplicate (QD): SessionLayout mints the copy and copies the
		 * source's settings and style, answering the copy's id (null: refused).
		 */
		duplicateWidget: (widgetId: string) => string | null
		/** The one removal, SessionLayout's. */
		removeWidget: (widgetId: string) => void
		/**
		 * What the primary floor says about a widget (./primaryFloor): the note
		 * shown in place of its ×, when it is the last instance of the genre's
		 * primary widget, else null.
		 */
		floorNoteOf: (widgetId: string) => string | null
		/**
		 * The layouts sheet: the presets this person may start from, and the
		 * one this session's layout started from (provenance, never a base).
		 */
		presets: Sockets.Sessions.LayoutPreset[]
		startedFrom: Sockets.Sessions.LayoutPreset | null
		/** The layout it started from changed since the copy. */
		startedFromUpdated?: boolean
		/** What **Start again from "X"** re-copies; null hides the button. */
		startAgainFrom: Sockets.Sessions.LayoutPreset | null
		/**
		 * Copy a preset in (`null`: Start from scratch). Called only once the
		 * person has said yes: every copy replaces this session's layout.
		 */
		startFrom: (presetId: number | null) => void
		/**
		 * **Save as new layout** with a name and an optional description.
		 * Returns whether it was sent (false: the arrangement was refused).
		 */
		savePreset: (name: string, description: string) => boolean
		/** **Reset to genre default layout**, once confirmed. */
		resetLayout: () => void
		/** What Start from scratch keeps in the middle, by name. */
		mainWidgetTitle?: string
		/**
		 * The card menu (brief 6b), as the desktop's: managing a layout this
		 * person manages, and the new-session layout. The page owns the
		 * round trips and pushes the refreshed list back through `presets`.
		 */
		onRenamePreset?: (presetId: number, name: string) => void
		onDeletePreset?: (presetId: number) => void
		onPresetUsage?: (presetId: number) => void
		/** The answer to the last usage ask; null while in flight. */
		presetUsage?: LayoutPresetUsage | null
		onShareLayout?: (presetId: number, visibility: "shared" | "private") => void
		onCloneLayout?: (presetId: number) => void
		onSetNewSessionLayout?: (presetId: number | null) => void
		/** **Save changes to "*Name*"**, as the desktop's. */
		saveChanges?: (presetId: number, overwriteUpdated: boolean) => boolean
		/** The genre's name, for _Use for new *Genre* sessions_. */
		genreName?: string | null
		/** A guest in this session: no share control is drawn. */
		isGuest?: boolean
		/** An admin manages someone else's shared layout too. */
		isAdmin?: boolean
		/** The sticky bar's two commit controls, SessionLayout's own. */
		onCancel: () => void
		onDone: () => void
		/**
		 * A preset's picture. Defined in SessionLayout because the desktop
		 * Layouts tab draws it too, and passed down so both draw the one.
		 */
		presetPicture: Snippet<[unknown]>
	}

	let {
		editArranged = $bindable(),
		leftPreview,
		rightPreview,
		middlePreview,
		simTier,
		simWidth,
		simSnapshot = $bindable(),
		leftZoneId,
		rightZoneId,
		groupOpen = $bindable(),
		groupKey,
		inst,
		iconOf,
		middleWidgetIcon,
		widgetLabel,
		trayWidgets,
		trayIcon,
		addWidget,
		duplicateWidget,
		removeWidget,
		floorNoteOf,
		presets,
		startedFrom,
		startedFromUpdated = false,
		startAgainFrom,
		startFrom,
		savePreset,
		resetLayout,
		mainWidgetTitle = "Messages",
		onRenamePreset,
		onDeletePreset,
		onPresetUsage,
		presetUsage = null,
		onShareLayout,
		onCloneLayout,
		onSetNewSessionLayout,
		saveChanges,
		genreName = null,
		isGuest = false,
		isAdmin = false,
		onCancel,
		onDone,
		presetPicture
	}: Props = $props()

	/** The zone a widget is being added to, if the picker sheet is open. */
	let pickerTarget = $state<{ zone: ZoneId; id: string } | null>(null)
	/** The presets sheet is open. */
	let presetSheet = $state(false)
	/** The bar's Layouts button: where focus lands when a yes closes the sheet. */
	let layoutsButton = $state<HTMLButtonElement | null>(null)
	/**
	 * After a question asked from the sheet: while the sheet is open, focus
	 * goes back to where it was; once a yes has closed it, the control it was
	 * asked from is gone, so to the button that opens the sheet again — never
	 * to the page.
	 */
	const focusAfterSheet = () => (presetSheet ? null : layoutsButton)
	/** A copy waiting on a yes (the bar's Reset chip, or the sheet's). */
	let copyAsk = $state<CopyAsk | null>(null)
	let saveAsOpen = $state(false)
	let groups = $derived(groupLayoutPresets(presets))
	let provenance = $derived(provenanceLine(startedFrom))
	let genreDefault = $derived(presets.find((p) => p.isGenreDefault) ?? null)
	/** The source, when it changed since the copy; the offer re-copies it. */
	let updatedSource = $derived(startedFromUpdated ? startedFrom : null)

	/* ── the card menu, rename, delete and Save changes to (brief 6b) ──── */
	let newSessionLayout = $derived(newSessionLayoutOf(presets))
	let menuContext = $derived({
		genreName,
		isGuest,
		isAdmin,
		newSessionLayoutId: newSessionLayout?.id ?? null
	})
	/** Save changes to is offered for a layout of YOURS this session started from. */
	let saveChangesTarget = $derived(startedFrom?.mine ? startedFrom : null)
	let saveChangesAsk = $state<{
		preset: Sockets.Sessions.LayoutPreset
		updated: boolean
	} | null>(null)
	/** The row whose name is being edited in place, if any. */
	let renamingId = $state<number | null>(null)
	let renameValue = $state("")
	let renameField = $state<HTMLInputElement | null>(null)
	/** The row a delete was asked for, awaiting its usage answer. */
	let deleteAskId = $state<number | null>(null)
	let deletingPreset = $derived(presets.find((p) => p.id === deleteAskId) ?? null)
	let deleteUsage = $derived(
		presetUsage && presetUsage.id === deleteAskId ? presetUsage : null
	)
	/** An admin's Stop sharing on someone else's layout, waiting on a yes. */
	let unshareAsk = $state<Sockets.Sessions.LayoutPreset | null>(null)
	/** One question at a time: a copy, Save changes to, Stop sharing, else a delete. */
	let confirm = $derived(
		copyAsk
			? copyConfirm(copyAsk, mainWidgetTitle)
			: saveChangesAsk
				? saveChangesConfirm(saveChangesAsk.preset, saveChangesAsk.updated)
				: unshareAsk
					? unshareConfirm(unshareAsk)
					: deletingPreset
						? deleteConfirm(deletingPreset, deleteUsage)
						: null
	)

	function askCopy(ask: CopyAsk) {
		renamingId = null
		deleteAskId = null
		saveChangesAsk = null
		unshareAsk = null
		copyAsk = ask
	}
	function onCardAction(action: CardMenuAction, p: Sockets.Sessions.LayoutPreset) {
		if (action === "new-session") onSetNewSessionLayout?.(newSessionChoice(p))
		else if (action === "stop-new-session") onSetNewSessionLayout?.(null)
		else if (action === "copy") onCloneLayout?.(p.id)
		else if (action === "share") onShareLayout?.(p.id, "shared")
		else if (action === "unshare") {
			if (unshareAsks(p)) {
				copyAsk = null
				deleteAskId = null
				renamingId = null
				saveChangesAsk = null
				unshareAsk = p
			} else onShareLayout?.(p.id, "private")
		} else if (action === "rename") {
			copyAsk = null
			deleteAskId = null
			saveChangesAsk = null
			unshareAsk = null
			renamingId = p.id
			renameValue = p.name
		} else if (action === "delete") {
			copyAsk = null
			renamingId = null
			saveChangesAsk = null
			unshareAsk = null
			deleteAskId = p.id
			onPresetUsage?.(p.id)
		}
	}
	/** The layouts sheet: where a row's `⋯` trigger is looked up again. */
	let sheetEl = $state<HTMLElement | null>(null)
	/**
	 * A rename ended from the keyboard: the field had taken the row (menu
	 * included), so focus goes to the row's new `⋯` trigger — never the page.
	 */
	async function focusRowMenu(id: number) {
		await tick()
		sheetEl?.querySelector<HTMLElement>(`[data-card-menu="${id}"] button`)?.focus()
	}
	/** Enter and blur both commit; an unchanged or blank name is dropped. */
	function commitRename(id: number) {
		if (renamingId !== id) return
		const name = renameValue.trim()
		const was = presets.find((p) => p.id === id)?.name
		renamingId = null
		if (!name || name === was) return
		onRenamePreset?.(id, name)
	}
	$effect(() => {
		if (renamingId != null && renameField) {
			renameField.focus()
			renameField.select()
		}
	})
	function askSaveChanges(p: Sockets.Sessions.LayoutPreset) {
		copyAsk = null
		renamingId = null
		deleteAskId = null
		unshareAsk = null
		saveChangesAsk = { preset: p, updated: startedFromUpdated && startedFrom?.id === p.id }
	}

	/**
	 * Yes. A copy or Save changes to closes the sheet it was asked from (the
	 * layout moved on); a delete leaves it open on the list it redraws.
	 */
	function confirmYes() {
		const ask = copyAsk
		if (ask) {
			copyAsk = null
			presetSheet = false
			if (ask.kind === "reset") resetLayout()
			else startFrom(copyTarget(ask))
			return
		}
		const save = saveChangesAsk
		if (save) {
			saveChangesAsk = null
			if (saveChanges?.(save.preset.id, save.updated)) presetSheet = false
			return
		}
		const unshare = unshareAsk
		if (unshare) {
			// The row leaves this list; the sheet stays open on it.
			unshareAsk = null
			onShareLayout?.(unshare.id, "private")
			return
		}
		const doomed = deletingPreset
		deleteAskId = null
		if (doomed) onDeletePreset?.(doomed.id)
	}
	/** Save changes to's other way out: Start again from it, asked in turn. */
	function confirmAlternative() {
		const save = saveChangesAsk
		if (save) askCopy({ kind: "again", preset: save.preset })
	}
	function confirmNo() {
		copyAsk = null
		saveChangesAsk = null
		unshareAsk = null
		deleteAskId = null
	}
	/** The group a drag handle is carrying, for the row's own styling. */
	let dragRowKey = $state<string | null>(null)

	/** The frame the phone editor writes into — the working one, or the default. */
	function editFrame(zone: ZoneId): ArrangedZone {
		return (
			zone === "left"
				? leftPreview
				: zone === "right"
					? rightPreview
					: middlePreview
		).frame
	}
	/**
	 * Store one zone's re-ordered arrangement.
	 *
	 * Written into a simulated tier's snapshot as well, for the reason a pin is
	 * (see SessionLayout's `toggleGroupPin`): leaving the preview restores that snapshot, and an
	 * order the user stated must survive it without also rescuing the clamp a
	 * narrow preview made of everything else.
	 */
	function writeZone(zone: ZoneId, next: ArrangedZone) {
		if (next === editFrame(zone)) return
		editArranged[zone] = next
		if (simTier !== null && simSnapshot) simSnapshot[zone] = next
	}
	function moveRowIn(zone: ZoneId, key: string, delta: number) {
		writeZone(zone, moveRow(editFrame(zone), key, delta))
	}
	function moveMemberIn(
		zone: ZoneId,
		key: string,
		id: string,
		delta: number
	) {
		writeZone(zone, moveMember(editFrame(zone), key, id, delta))
	}
	/**
	 * Add or remove a widget from the phone editor, cells and all.
	 *
	 * The grid editor lets gridstack seed a newcomer and report the result back;
	 * with no grid mounted the arrangement has to be written here, or Done would
	 * commit a frame that does not name the widget just added — and the side
	 * would draw everything except it. Removal closes the row it leaves behind.
	 */
	function addWidgetTo(zone: ZoneId, zoneId: string, widgetId: string) {
		// Read the frame BEFORE the placement: the landing rewrites the
		// zone's widget list, which is what `editFrame` is derived from.
		const frame = editFrame(zone)
		// The id the layout MINTED (brief 7b): a kind already placed lands
		// as a copy, `W#n`, and the row's cells must name the copy.
		const id = addWidget(zoneId, widgetId)
		if (id) landAtFoot(zone, frame, id, 3)
	}
	/** A row's Duplicate: the copy lands at the foot of the list, at the source's height. */
	function duplicateIn(zone: ZoneId, sourceId: string) {
		const frame = editFrame(zone)
		const id = duplicateWidget(sourceId)
		if (!id) return
		const src = frame.items.find((i) => i.id === sourceId)
		landAtFoot(zone, frame, id, src?.h ?? 3)
	}
	/** Write one more row at the foot of a zone's frame (as it was before the landing). */
	function landAtFoot(zone: ZoneId, frame: ArrangedZone, id: string, h: number) {
		const foot = frame.items.length
			? Math.max(...frame.items.map((i) => i.y + i.h))
			: 0
		writeZone(zone, {
			cols: frame.cols,
			rows: Math.max(frame.rows, foot + h),
			items: [...frame.items, { id, x: 0, y: foot, w: frame.cols, h }]
		})
	}
	function removeWidgetFrom(zone: ZoneId, widgetId: string) {
		const frame = editFrame(zone)
		removeWidget(widgetId)
		writeZone(
			zone,
			restackZone({
				...frame,
				items: frame.items.filter((i) => i.id !== widgetId)
			})
		)
	}
	function setRowPin(zone: ZoneId, key: string, pinned: boolean) {
		writeZone(zone, setRowPinned(editFrame(zone), key, pinned))
		// "Pinned" IS "expanded by default", so the live column follows.
		if (zone !== "middle") groupOpen[groupKey(zone, key)] = pinned
	}

	/** The zones the phone editor lists, chat first. */
	let mobileZones = $derived(
		(
			[
				["middle", "Middle", Icons.MessageSquare, null],
				["left", "Left", Icons.PanelLeft, leftZoneId],
				["right", "Right", Icons.PanelRight, rightZoneId]
			] as const
		)
			.filter(([key, , , zoneId]) => key === "middle" || !!zoneId)
			.map(([key, label, icon, zoneId]) => ({
				key,
				label,
				icon,
				zoneId,
				rows: mobileRows(editFrame(key))
			}))
	)
	function rowIcon(row: MobileRow) {
		if (row.members.length > 1) return Icons.Layers
		const id = row.members[0]
		if (isInstanceOf(id, "messages")) return middleWidgetIcon(id)
		const p = inst(id)
		return p ? iconOf(p) : Icons.LayoutPanelTop
	}
	function rowTitle(row: MobileRow): string {
		return row.members.map(widgetLabel).join(" · ")
	}

	/* ── the drag handle ────────────────────────────────────────────────────
	 * A touch reorder, spent as the same single steps the arrow buttons are: a
	 * pointer that has travelled a whole row's height asks for the next index,
	 * and `moveRowTo` decides whether the arrangement can express it. Pointer
	 * events rather than HTML drag-and-drop, which no mobile browser fires.
	 */
	let dragZone: ZoneId | null = null
	let dragIndex = 0
	let dragOriginY = 0
	let dragStepPx = 44

	function startRowDrag(
		e: PointerEvent,
		zone: ZoneId,
		key: string,
		index: number
	) {
		const grip = e.currentTarget as HTMLElement
		const row = grip.closest("li") as HTMLElement | null
		if (!row) return
		e.preventDefault()
		grip.setPointerCapture(e.pointerId)
		dragZone = zone
		dragRowKey = key
		dragIndex = index
		dragOriginY = e.clientY
		dragStepPx = Math.max(24, row.offsetHeight)
	}
	function dragRow(e: PointerEvent) {
		if (!dragRowKey || !dragZone) return
		const steps = Math.trunc((e.clientY - dragOriginY) / dragStepPx)
		if (!steps) return
		const zone = dragZone
		const key = dragRowKey
		const before = editFrame(zone)
		const next = moveRowTo(before, key, dragIndex + steps)
		writeZone(zone, next)
		dragOriginY += steps * dragStepPx
		const at = mobileRows(next).findIndex((r) => r.key === key)
		if (at >= 0) dragIndex = at
	}
	function endRowDrag(e: PointerEvent) {
		const grip = e.currentTarget as HTMLElement
		if (grip.hasPointerCapture(e.pointerId))
			grip.releasePointerCapture(e.pointerId)
		dragRowKey = null
		dragZone = null
	}

	/**
	 * Escape closes the topmost sheet, innermost first. A dialog over the
	 * sheet is topmost and closes itself, so the sheet under it stays.
	 */
	$effect(() => {
		if (!pickerTarget && !presetSheet) return
		const onKey = (e: KeyboardEvent) => {
			if (e.key !== "Escape") return
			// Focus is trapped in an open dialog, so the key comes from it —
			// checked as well as the state, which the dialog may already
			// have cleared by the time this listener runs.
			const t = e.target as Element | null
			if (
				copyAsk ||
				saveChangesAsk ||
				unshareAsk ||
				deleteAskId !== null ||
				saveAsOpen
			)
				return
			// A card menu open over the sheet, or a name being edited in a
			// row, takes its own Escape (the field has already cancelled).
			if (
				t?.closest?.(
					"[data-layout-confirm], [data-save-as], [role=menu], [data-preset-rename]"
				)
			)
				return
			if (pickerTarget) pickerTarget = null
			else presetSheet = false
		}
		document.addEventListener("keydown", onKey)
		return () => document.removeEventListener("keydown", onKey)
	})
</script>

<!-- The PHONE editor (ruled 2026-09-10). A screen this narrow draws no
     side-by-side widgets and no rail, so the editor is what the session is: an
     ordered list per zone, a pin per group, and sheets for everything that a
     desktop hovers for. It writes the same arrangement the grid does — see
     ./mobileEdit — and commits down the same path.

     It sits OVER the live session rather than replacing it, so nothing in the
     session reloads while the order is edited. -->
<!-- A row's Duplicate (brief 7b; QD): a copy of the widget at the foot of the
     list, its settings and style copied. At the widget's cap, the reason. -->
{#snippet duplicateControl(zone: ZoneId, id: string, label: string, size: number)}
	{@const full = trayWidgets.find((t) => t.id === widgetOfInstance(id))?.full}
	{#if !duplicateOffered()}
		<!-- QD's "tray only": no Duplicate. -->
	{:else if full}
		<span class="medit-floor medit-nocopy" role="note" title={full} aria-label={full}>
			<Icons.Copy size={size - 1} aria-hidden="true" />
		</span>
	{:else}
		<button
			class="medit-btn"
			aria-label="Duplicate {label}"
			onclick={() => duplicateIn(zone, id)}
		>
			<Icons.Copy size={size} />
		</button>
	{/if}
{/snippet}

{#snippet mobileRowItem(
	zone: ZoneId,
	zoneId: string | null,
	rows: MobileRow[],
	row: MobileRow,
	index: number
)}
	{@const Icon = rowIcon(row)}
	{@const title = rowTitle(row)}
	<li class="medit-row" class:dragging={dragRowKey === row.key}>
		<div class="medit-line">
			<!-- The drag handle. `touch-action: none` (in CSS) is what stops the
			     page scrolling under a finger that is reordering. -->
			<button
				class="medit-grip"
				aria-label="Reorder {title}"
				onpointerdown={(e) => startRowDrag(e, zone, row.key, index)}
				onpointermove={dragRow}
				onpointerup={endRowDrag}
				onpointercancel={endRowDrag}
			>
				<Icons.GripVertical size={16} />
			</button>
			<Icon size={16} />
			<span class="medit-name">{title}</span>
			{#if row.rank !== 1}
				<span class="medit-badge">
					{row.rank === 0 ? "First" : "Last"}
				</span>
			{/if}
		</div>
		<div class="medit-acts">
			<button
				class="medit-btn"
				disabled={index === 0}
				aria-label="Move {title} up"
				onclick={() => moveRowIn(zone, row.key, -1)}
			>
				<Icons.ChevronUp size={15} />
			</button>
			<button
				class="medit-btn"
				disabled={index === rows.length - 1}
				aria-label="Move {title} down"
				onclick={() => moveRowIn(zone, row.key, 1)}
			>
				<Icons.ChevronDown size={15} />
			</button>
			{#if zone !== "middle"}
				<!-- The per-group pin, the arrangement's own field: pinned it is
				     open from the start and keeps its height, unpinned it waits
				     as an entry in the panels menu. -->
				<button
					class="medit-btn"
					class:on={row.pinned}
					aria-pressed={row.pinned}
					aria-label={row.pinned ? `Unpin ${title}` : `Pin ${title}`}
					onclick={() => setRowPin(zone, row.key, !row.pinned)}
				>
					<Icons.Pin size={15} />
				</button>
			{/if}
			<button
				class="medit-btn"
				aria-label="Open {title} settings"
				aria-haspopup="dialog"
				onclick={(e) =>
					openWidgetSettings(
						{
							widgetId: row.members[0],
							label: widgetLabel(row.members[0])
						},
						e.currentTarget
					)}
			>
				<Icons.Settings size={15} />
			</button>
			{#if zoneId && row.members.length === 1}
				{@const keep = floorNoteOf(row.members[0])}
				{@render duplicateControl(zone, row.members[0], title, 15)}
				{#if keep}
					<!-- The primary floor keeps the last Messages: no ×, and
					     the reason where the × would be. -->
					<span class="medit-floor" role="note" title={keep} aria-label={keep}>
						<Icons.Lock size={14} aria-hidden="true" />
					</span>
				{:else}
					<button
						class="medit-btn"
						aria-label="Remove {title}"
						onclick={() => removeWidgetFrom(zone, row.members[0])}
					>
						<Icons.X size={15} />
					</button>
				{/if}
			{/if}
		</div>
		{#if row.members.length > 1}
			<!-- A tab group's own order: which tab comes first. -->
			<ul class="medit-members">
				{#each row.members as id, m (id)}
					<li class="medit-member">
						<span class="medit-name">{widgetLabel(id)}</span>
						<button
							class="medit-btn"
							disabled={m === 0}
							aria-label="Move {widgetLabel(id)} earlier"
							onclick={() => moveMemberIn(zone, row.key, id, -1)}
						>
							<Icons.ChevronUp size={14} />
						</button>
						<button
							class="medit-btn"
							disabled={m === row.members.length - 1}
							aria-label="Move {widgetLabel(id)} later"
							onclick={() => moveMemberIn(zone, row.key, id, 1)}
						>
							<Icons.ChevronDown size={14} />
						</button>
						<button
							class="medit-btn"
							aria-label="Open {widgetLabel(id)} settings"
							aria-haspopup="dialog"
							onclick={(e) =>
								openWidgetSettings(
									{ widgetId: id, label: widgetLabel(id) },
									e.currentTarget
								)}
						>
							<Icons.Settings size={14} />
						</button>
						{#if zoneId}
							{@const keep = floorNoteOf(id)}
							{@render duplicateControl(zone, id, widgetLabel(id), 14)}
							{#if keep}
								<span class="medit-floor" role="note" title={keep} aria-label={keep}>
									<Icons.Lock size={13} aria-hidden="true" />
								</span>
							{:else}
								<button
									class="medit-btn"
									aria-label="Remove {widgetLabel(id)}"
									onclick={() => removeWidgetFrom(zone, id)}
								>
									<Icons.X size={14} />
								</button>
							{/if}
						{/if}
					</li>
				{/each}
			</ul>
		{/if}
	</li>
{/snippet}

<div class="medit" role="dialog" aria-label="Layout" data-pop-keep>
	<header class="medit-head">
		<Icons.LayoutDashboard size={15} />
		<span class="medit-heading">Layout</span>
		<span class="flex-1"></span>
		{#if simTier !== null}
			<span class="medit-note">Previewing {simWidth} px</span>
		{/if}
	</header>
	<div class="medit-body">
		<p class="medit-note">
			A screen this narrow draws one widget under the next. Drag a handle,
			or use the arrows, to change the order.
		</p>
		{#each mobileZones as z (z.key)}
			{@const ZoneIcon = z.icon}
			<section class="medit-zone">
				<header class="medit-zone-head">
					<ZoneIcon size={13} />
					{z.label}
					<span class="flex-1"></span>
					{#if z.zoneId}
						<button
							class="medit-chip"
							onclick={() =>
								(pickerTarget = z.zoneId
									? { zone: z.key, id: z.zoneId }
									: null)}
						>
							<Icons.Plus size={13} />
							Add
						</button>
					{/if}
				</header>
				<ul class="medit-list">
					{#each z.rows as row, i (row.key)}
						{@render mobileRowItem(z.key, z.zoneId, z.rows, row, i)}
					{/each}
					{#if !z.rows.length}
						<li class="medit-empty">Nothing here yet.</li>
					{/if}
				</ul>
			</section>
		{/each}
	</div>
	<!-- The sticky bar is the toolbar down here: commit, cancel and restore
	     without a row of tabs a thumb cannot reach. -->
	<div class="medit-bar">
		<button
			class="medit-chip"
			aria-haspopup="dialog"
			bind:this={layoutsButton}
			onclick={() => (presetSheet = true)}
		>
			<Icons.LayoutTemplate size={14} />
			Layouts
			<!-- The source changed since the copy: an offer waits inside. -->
			{#if startedFromUpdated}
				<span class="medit-dot" data-updated-dot aria-hidden="true"></span>
				<span class="sr-only">(updated)</span>
			{/if}
		</button>
		<!-- Icon-only, and it replaces the layout like the sheet's own Reset:
		     it asks first. -->
		<button
			class="medit-chip"
			title="Copy the genre default layout back into this session"
			aria-label="Reset to genre default layout"
			aria-haspopup="dialog"
			onclick={() => askCopy({ kind: "reset", preset: genreDefault })}
		>
			<Icons.RotateCcw size={14} />
		</button>
		<span class="flex-1"></span>
		<button class="medit-chip" onclick={onCancel}>Cancel</button>
		<button class="medit-chip primary" onclick={onDone}>
			<Icons.Check size={14} />
			Done
		</button>
	</div>
</div>

{#if pickerTarget}
	<!-- svelte-ignore a11y_click_events_have_key_events, a11y_no_static_element_interactions -->
	<div class="msheet-scrim" onclick={() => (pickerTarget = null)}></div>
	<div class="msheet" role="dialog" aria-label="Add a widget" data-pop-keep>
		<header class="msheet-head">
			<Icons.Plus size={14} />
			<span>Add a widget</span>
			<span class="flex-1"></span>
			<button
				class="medit-btn"
				aria-label="Close"
				onclick={() => (pickerTarget = null)}
			>
				<Icons.X size={16} />
			</button>
		</header>
		<div class="msheet-body">
			<!-- Every kind, every time (brief 7b): picking a placed one adds
			     another copy of it. -->
			{#each trayWidgets as t (t.id)}
				{@const IconCmp = trayIcon(t)}
				<button
					class="msheet-item"
					data-tray-widget={t.id}
					disabled={!!t.full}
					title={t.full ?? undefined}
					onclick={() => {
						const target = pickerTarget
						pickerTarget = null
						if (target) addWidgetTo(target.zone, target.id, t.id)
					}}
				>
					<IconCmp size={18} />
					<span>{t.title}</span>
					{#if t.placed}
						<span class="msheet-count"
							><span class="sr-only">{" · "}</span>{t.placed} placed</span
						>
					{/if}
					<!-- No hover on a phone: the cap's reason is said on the row. -->
					{#if t.full}
						<span class="msheet-count"
							><span class="sr-only">{" · "}</span>{t.full}</span
						>
					{/if}
				</button>
			{/each}
		</div>
	</div>
{/if}

{#if presetSheet}
	<!-- svelte-ignore a11y_click_events_have_key_events, a11y_no_static_element_interactions -->
	<div class="msheet-scrim" onclick={() => (presetSheet = false)}></div>
	<div
		class="msheet"
		role="dialog"
		aria-label="Layouts"
		data-pop-keep
		bind:this={sheetEl}
	>
		<header class="msheet-head">
			<Icons.LayoutTemplate size={14} />
			<span>Layouts</span>
			<span class="flex-1"></span>
			<button
				class="medit-btn"
				aria-label="Close"
				onclick={() => (presetSheet = false)}
			>
				<Icons.X size={16} />
			</button>
		</header>
		<div class="msheet-body">
			<!-- Where this session's layout started from, and — when that
			     changed since the copy — the offer to copy it again. -->
			<p class="msheet-status" data-layout-provenance>
				{provenance.lead}{#if provenance.name}<strong
						>{provenance.name}</strong
					>{/if}{provenance.tail}
			</p>
			{#if updatedSource}
				{@const src = updatedSource}
				<div class="msheet-updated" role="status" data-layout-updated>
					<p>
						<span class="msheet-chip">Updated</span>
						{updatedSentence(src)}
					</p>
					<button
						class="medit-chip"
						data-copy-verb={src.isGenreDefault ? "reset" : "again"}
						onclick={() => askCopy(reCopyAsk(src))}
					>
						<Icons.RotateCcw size={14} />
						{reCopyLabel(src)}
					</button>
				</div>
			{/if}
			<!-- Start from: grouped by who brought them. Choosing one asks,
			     then COPIES it in; the marked one is what it started from. -->
			{#each groups as g (g.key)}
				<section class="msheet-group" data-preset-group={g.key}>
					<h3 class="msheet-group-label" data-preset-group-label>
						{g.label}
					</h3>
					{#each g.presets as p (p.id)}
						{@const current = startedFrom?.id === p.id}
						{@const forNewSessions = newSessionLayout?.id === p.id}
						<!-- The row starts from it (asks first); its menu, at the
						     end, is everything else (brief 6b). -->
						<div
							class="msheet-row"
							class:armed={deleteAskId === p.id || unshareAsk?.id === p.id}
						>
							{#if renamingId === p.id && canManageLayout(p, isAdmin)}
								<div class="msheet-item msheet-renaming">
									{@render presetPicture(p.layout)}
									<input
										class="msheet-rename"
										type="text"
										data-preset-rename
										bind:this={renameField}
										bind:value={renameValue}
										maxlength="80"
										aria-label={`New name for "${p.name}"`}
										onkeydown={(e) => {
											if (e.key === "Enter") {
												// Else the key's own activation lands on the
												// trigger focus moves to, and opens it.
												e.preventDefault()
												commitRename(p.id)
												focusRowMenu(p.id)
											} else if (e.key === "Escape") {
												renamingId = null
												focusRowMenu(p.id)
											}
										}}
										onblur={() => commitRename(p.id)}
									/>
								</div>
							{:else}
								<button
									class="msheet-item"
									class:on={current}
									aria-current={current ? "true" : undefined}
									data-preset-card={p.id}
									onclick={() => askCopy({ kind: "card", preset: p })}
								>
									{@render presetPicture(p.layout)}
									<span class="msheet-item-text">
										<span class="msheet-item-name">
											{p.name}
											{#if current && startedFromUpdated}
												<span class="msheet-chip">Updated</span>
											{/if}
										</span>
										<!-- No hover on a phone: the star's words are
										     said on the row. -->
										{#if forNewSessions}
											<span
												class="msheet-item-desc msheet-new-session"
												data-new-session-layout
											>
												<Icons.Star size={12} aria-hidden="true" />
												{newSessionMark(genreName)}
											</span>
										{/if}
										{#if !p.mine && p.origin === "user" && p.authorName}
											<span class="msheet-item-desc">by {p.authorName}</span>
										{:else if sharedMark(p)}
											<span class="msheet-item-desc" data-shared-mark
												>{sharedMark(p)}</span
											>
										{/if}
										{#if p.description}
											<span class="msheet-item-desc">{p.description}</span>
										{/if}
									</span>
								</button>
								<!-- 32px, and 44px on a coarse pointer (STYLE-GUIDE §9). -->
								<LayoutCardMenu
									preset={p}
									context={menuContext}
									onAction={onCardAction}
									triggerClass="text-surface-600-400 hover:bg-surface-200-800 flex size-8 shrink-0 items-center justify-center self-center rounded-[8px] pointer-coarse:size-11"
								/>
							{/if}
						</div>
					{/each}
				</section>
			{:else}
				<p class="medit-note">No layouts for this genre yet.</p>
			{/each}
			{#if saveChangesTarget}
				{@const target = saveChangesTarget}
				<button
					class="medit-chip"
					aria-haspopup="dialog"
					data-save-changes
					onclick={() => askSaveChanges(target)}
				>
					<Icons.Save size={14} />
					Save changes to {quoted(target.name)}
				</button>
			{/if}
			<button
				class="medit-chip"
				aria-haspopup="dialog"
				onclick={() => (saveAsOpen = true)}
			>
				<Icons.Save size={14} />
				Save as new layout
			</button>
			<!-- The verbs that REPLACE this session's layout; each asks. -->
			<div class="msheet-verbs" role="group" aria-label="Replace this session's layout">
				{#if !updatedSource?.isGenreDefault}
					<button
						class="medit-chip"
						data-copy-verb="reset"
						onclick={() => askCopy({ kind: "reset", preset: genreDefault })}
					>
						<Icons.RotateCcw size={14} />
						Reset to genre default layout
					</button>
				{/if}
				{#if startAgainFrom && updatedSource?.id !== startAgainFrom.id}
					{@const again = startAgainFrom}
					<button
						class="medit-chip"
						data-copy-verb="again"
						onclick={() => askCopy({ kind: "again", preset: again })}
					>
						<Icons.RotateCcw size={14} />
						Start again from {quoted(again.name)}
					</button>
				{/if}
				<button
					class="medit-chip"
					data-copy-verb="scratch"
					onclick={() => askCopy({ kind: "scratch" })}
				>
					<Icons.RotateCcw size={14} />
					Start from scratch
				</button>
			</div>
		</div>
	</div>
{/if}

<!-- Portalled to the body, over the sheet (STYLE-GUIDE §5.4, §6.6). -->
<LayoutConfirmDialog
	{confirm}
	onConfirm={confirmYes}
	onCancel={confirmNo}
	onAlternative={confirmAlternative}
	finalFocus={focusAfterSheet}
/>
<SaveAsNewLayoutDialog
	bind:open={saveAsOpen}
	finalFocus={focusAfterSheet}
	onSave={(name, description) => {
		const sent = savePreset(name, description)
		if (sent) presetSheet = false
		return sent
	}}
/>

<style>
	/* ── the phone editor ──────────────────────────────────────────────────
	   Fixed over the session, which stays mounted underneath: a full-height
	   column of head / scrolling list / sticky bar, so the commit controls are
	   at the thumb end whatever the list does. */
	.medit {
		position: fixed;
		inset: 0;
		z-index: 40;
		display: flex;
		flex-direction: column;
		background: var(--color-surface-50);
		color: var(--color-surface-contrast-50);
	}
	:global([data-mode="dark"]) .medit {
		background: var(--color-surface-950);
		color: var(--color-surface-contrast-950);
	}
	.medit-head,
	.medit-bar {
		display: flex;
		align-items: center;
		gap: 0.4rem;
		padding: 0.5rem 0.75rem;
		border-block-end: 1px solid
			color-mix(in oklab, currentColor 14%, transparent);
	}
	.medit-bar {
		border-block-end: none;
		border-block-start: 1px solid
			color-mix(in oklab, currentColor 14%, transparent);
		/* The home indicator on a phone sits over the last few pixels. */
		padding-block-end: max(0.5rem, env(safe-area-inset-bottom));
	}
	.medit-heading {
		font-weight: 600;
	}
	.medit-body {
		flex: 1;
		min-block-size: 0;
		overflow-y: auto;
		padding: 0.75rem;
		display: flex;
		flex-direction: column;
		gap: 0.75rem;
	}
	.medit-note {
		font-size: 0.75rem;
		opacity: 0.7;
		margin: 0;
	}
	.medit-zone {
		border: 1px solid color-mix(in oklab, currentColor 14%, transparent);
		border-radius: 0.5rem;
		overflow: hidden;
	}
	.medit-zone-head {
		display: flex;
		align-items: center;
		gap: 0.35rem;
		padding: 0.4rem 0.5rem;
		font-size: 0.75rem;
		font-weight: 600;
		background: color-mix(in oklab, currentColor 6%, transparent);
	}
	.medit-list,
	.medit-members {
		list-style: none;
		margin: 0;
		padding: 0;
	}
	.medit-row {
		display: flex;
		flex-wrap: wrap;
		align-items: center;
		gap: 0.25rem 0.4rem;
		padding: 0.4rem 0.5rem;
		border-block-start: 1px solid
			color-mix(in oklab, currentColor 10%, transparent);
	}
	.medit-row.dragging {
		background: color-mix(
			in oklab,
			var(--color-primary-500) 14%,
			transparent
		);
	}
	.medit-line {
		display: flex;
		align-items: center;
		gap: 0.4rem;
		flex: 1 1 10rem;
		min-inline-size: 0;
	}
	.medit-name {
		flex: 1;
		min-inline-size: 0;
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
		font-size: 0.85rem;
	}
	.medit-badge {
		font-size: 0.6875rem;
		padding: 0.1rem 0.3rem;
		border-radius: 0.25rem;
		background: color-mix(in oklab, currentColor 12%, transparent);
	}
	.medit-acts {
		display: flex;
		align-items: center;
		gap: 0.2rem;
	}
	/* A touch target, not an icon: 2.25rem is the smallest square a thumb hits
	   reliably, and every control in this editor is one. */
	.medit-btn,
	.medit-grip {
		display: inline-flex;
		align-items: center;
		justify-content: center;
		inline-size: 2.25rem;
		block-size: 2.25rem;
		border-radius: 0.4rem;
		border: 1px solid transparent;
		background: transparent;
		color: inherit;
		cursor: pointer;
	}
	.medit-grip {
		/* The page must not scroll under a finger that is reordering. */
		touch-action: none;
		cursor: grab;
	}
	.medit-btn:disabled {
		opacity: 0.3;
		cursor: default;
	}
	/* Where the × would be on the row the primary floor keeps: the reason, as
	   a quiet lock (its label says it), taking the ×'s square so the row's
	   controls do not shift. */
	.medit-floor {
		display: inline-flex;
		align-items: center;
		justify-content: center;
		inline-size: 2.25rem;
		block-size: 2.25rem;
		color: var(--color-surface-600-400);
	}
	.medit-btn.on {
		color: var(--color-primary-500);
		border-color: color-mix(
			in oklab,
			var(--color-primary-500) 40%,
			transparent
		);
	}
	.medit-members {
		flex-basis: 100%;
		padding-inline-start: 2.25rem;
	}
	.medit-member {
		display: flex;
		align-items: center;
		gap: 0.2rem;
		font-size: 0.8rem;
		opacity: 0.85;
	}
	.medit-empty {
		padding: 0.5rem;
		font-size: 0.75rem;
		opacity: 0.6;
	}
	.medit-chip {
		display: inline-flex;
		align-items: center;
		gap: 0.3rem;
		padding: 0.4rem 0.7rem;
		min-block-size: 2.25rem;
		border-radius: 0.4rem;
		border: 1px solid color-mix(in oklab, currentColor 22%, transparent);
		background: transparent;
		color: inherit;
		font-size: 0.8rem;
		cursor: pointer;
	}
	.medit-chip.primary {
		background: var(--color-primary-500);
		color: var(--color-primary-contrast-500);
		border-color: transparent;
	}
	.medit-chip:disabled {
		opacity: 0.4;
		cursor: default;
	}

	/* ── the sheets ────────────────────────────────────────────────────────
	   A picker, the layouts and one widget's settings each arrive over the
	   editor rather than inside it: on a screen this narrow there is no room
	   beside the list, and a hover overlay has nothing to hover. */
	.msheet-scrim {
		position: fixed;
		inset: 0;
		z-index: 41;
		background: rgba(0, 0, 0, 0.4);
	}
	.msheet {
		position: fixed;
		inset-inline: 0;
		inset-block-end: 0;
		z-index: 42;
		display: flex;
		flex-direction: column;
		max-block-size: 85dvh;
		border-start-start-radius: 0.75rem;
		border-start-end-radius: 0.75rem;
		background: var(--color-surface-50);
		color: var(--color-surface-contrast-50);
		box-shadow: 0 -10px 30px rgba(0, 0, 0, 0.3);
	}
	:global([data-mode="dark"]) .msheet {
		background: var(--color-surface-950);
		color: var(--color-surface-contrast-950);
	}
	.msheet-head {
		display: flex;
		align-items: center;
		gap: 0.4rem;
		padding: 0.5rem 0.75rem;
		font-weight: 600;
		font-size: 0.85rem;
		border-block-end: 1px solid
			color-mix(in oklab, currentColor 14%, transparent);
	}
	.msheet-body {
		flex: 1;
		min-block-size: 0;
		overflow-y: auto;
		padding: 0.75rem;
		padding-block-end: max(0.75rem, env(safe-area-inset-bottom));
		display: flex;
		flex-direction: column;
		gap: 0.4rem;
	}
	.msheet-item {
		display: flex;
		align-items: center;
		gap: 0.5rem;
		padding: 0.5rem;
		min-block-size: 2.75rem;
		border-radius: 0.4rem;
		border: 1px solid color-mix(in oklab, currentColor 16%, transparent);
		background: transparent;
		color: inherit;
		font-size: 0.85rem;
		text-align: start;
		cursor: pointer;
	}
	/* The layout this session started from: the selected card's ring
	   (STYLE-GUIDE §2.4), offset by the sheet's ground — never a fill. */
	.msheet-item:disabled {
		cursor: not-allowed;
		opacity: 0.55;
	}
	/* How many are placed (brief 7b), and a capped widget's reason. */
	.msheet-count {
		margin-inline-start: auto;
		font-size: 0.75rem;
		color: var(--color-surface-600);
	}
	.msheet-count + .msheet-count {
		margin-inline-start: 0.4rem;
	}
	:global([data-mode="dark"]) .msheet-count {
		color: var(--color-surface-400);
	}
	.medit-nocopy {
		opacity: 0.45;
	}
	.msheet-item.on {
		border-color: var(--color-primary-500);
		box-shadow:
			0 0 0 1px var(--color-surface-50),
			0 0 0 3px var(--color-primary-500);
	}
	:global([data-mode="dark"]) .msheet-item.on {
		box-shadow:
			0 0 0 1px var(--color-surface-950),
			0 0 0 3px var(--color-primary-500);
	}
	.msheet-item-text {
		display: flex;
		flex-direction: column;
		gap: 0.1rem;
		min-inline-size: 0;
	}
	/* A layout's row (brief 6b): the row that starts from it, then its `⋯`
	   menu — a sibling, never inside the row's own button. */
	.msheet-row {
		display: flex;
		align-items: stretch;
		gap: 0.25rem;
		border-radius: 0.4rem;
	}
	.msheet-row > .msheet-item {
		flex: 1;
		min-inline-size: 0;
	}
	/* The row whose delete is being asked about. */
	.msheet-row.armed {
		background: color-mix(in oklab, var(--color-error-500) 14%, transparent);
	}
	.msheet-renaming {
		cursor: default;
	}
	.msheet-rename {
		flex: 1;
		min-inline-size: 0;
		padding: 0.35rem 0.5rem;
		border-radius: 0.4rem;
		font-size: 0.9rem;
		border: 1px solid var(--color-primary-500);
		background: var(--color-surface-50);
		color: var(--color-surface-900);
	}
	:global([data-mode="dark"]) .msheet-rename {
		background: var(--color-surface-950);
		color: var(--color-surface-100);
	}
	/* What new sessions start from: the star, said in words on a phone. */
	.msheet-item-desc.msheet-new-session {
		display: flex;
		align-items: center;
		gap: 0.3rem;
	}
	.msheet-new-session :global(svg) {
		flex-shrink: 0;
		fill: currentColor;
		color: var(--color-primary-600);
	}
	:global([data-mode="dark"]) .msheet-new-session :global(svg) {
		color: var(--color-primary-400);
	}
	.msheet-item-name {
		display: flex;
		align-items: center;
		gap: 0.4rem;
		font-weight: 500;
	}
	.msheet-item-desc {
		font-size: 0.75rem;
		color: var(--color-surface-600);
		display: -webkit-box;
		-webkit-line-clamp: 2;
		line-clamp: 2;
		-webkit-box-orient: vertical;
		overflow: hidden;
	}
	:global([data-mode="dark"]) .msheet-item-desc {
		color: var(--color-surface-400);
	}
	/* ── the Start from sheet's head, groups and verbs (brief 4) ──────── */
	.msheet-status {
		margin: 0 0 0.2rem;
		font-size: 0.85rem;
	}
	.msheet-status strong {
		font-weight: 600;
	}
	.msheet-updated {
		display: flex;
		flex-direction: column;
		align-items: flex-start;
		gap: 0.4rem;
		padding: 0.5rem 0.6rem;
		border-radius: 0.5rem;
		background: color-mix(in oklab, var(--color-primary-500) 10%, transparent);
		font-size: 0.8rem;
	}
	.msheet-updated p {
		margin: 0;
	}
	/* `preset-tonal-primary`'s recipe, spelled out because this sheet is scoped. */
	.msheet-chip {
		display: inline-flex;
		align-items: center;
		padding: 0.05rem 0.4rem;
		border-radius: 999px;
		font-size: 0.6875rem;
		font-weight: 600;
		line-height: 1.5;
		background: color-mix(in oklab, var(--color-primary-500) 22%, transparent);
		color: var(--color-primary-800);
	}
	:global([data-mode="dark"]) .msheet-chip {
		color: var(--color-primary-200);
	}
	.msheet-group {
		display: flex;
		flex-direction: column;
		gap: 0.4rem;
		margin-block-start: 0.35rem;
	}
	.msheet-group-label {
		margin: 0;
		font-size: 0.75rem;
		font-weight: 500;
		color: var(--color-surface-600);
	}
	:global([data-mode="dark"]) .msheet-group-label {
		color: var(--color-surface-400);
	}
	.msheet-verbs {
		display: flex;
		flex-wrap: wrap;
		gap: 0.4rem;
		margin-block-start: 0.35rem;
		padding-block-start: 0.6rem;
		border-block-start: 1px solid
			color-mix(in oklab, currentColor 14%, transparent);
	}
	.medit-dot {
		inline-size: 6px;
		block-size: 6px;
		border-radius: 999px;
		background: var(--color-primary-500);
	}
</style>
