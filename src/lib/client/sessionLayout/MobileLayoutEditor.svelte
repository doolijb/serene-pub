<script lang="ts">
	/**
	 * The PHONE editor (PLAN-session-panels-2026-10-14 §3 lane 4).
	 *
	 * Below the breakpoint the session draws one panel under the next, so the
	 * editor is a list: one row per panel, its tabs listed inside, in the order
	 * Above · Middle · Below · Left · Right (./mobileEdit). Every edit is one of
	 * ./arrangeOps — the desktop editor's — over the one working
	 * `PanelLayoutV1`, so there is no mobile layout blob and no mobile preset.
	 *
	 * Nothing is locked (§10 R-B): every tab has ×, and a refusal
	 * (`MIDDLE_EMPTY`) is said in the status line. A side lists two groups,
	 * Docked then In the rail (R-C); a row's up / down crosses between them.
	 * Any row but the primary can be made main (`makeMain`).
	 *
	 * Done writes the panels through the manager's `setPanels` only when they
	 * differ from what the editor opened on (`samePanels`), then closes.
	 *
	 * It sits OVER the live session rather than replacing it, so nothing in the
	 * session reloads while the order is edited. Its sheet state is its own:
	 * closing the editor unmounts it, which resets that state.
	 */
	import { tick, untrack, type Snippet } from "svelte"
	import * as Icons from "@lucide/svelte"
	import type { PanelLayoutV1 } from "@serene-pub/sdk"
	import { isInstanceOf, widgetOfInstance } from "@serene-pub/sdk"
	import type { PanelInstance } from "$lib/client/surfaces/types"
	import { duplicateOffered, type TrayWidget } from "./widgetInstances"
	import { samePanels, type ArrangeOutcome } from "./arrangeOps"
	import {
		addAt,
		canSplitOut,
		duplicateTab,
		mintFor,
		moveRow,
		moveRowTo,
		moveTabInto,
		moveTabWithin,
		phoneSections,
		removeTabFrom,
		makeMain,
		setRowHeight,
		splitTab,
		type AddTarget,
		type PhoneRow
	} from "./mobileEdit"
	import type { SimTier } from "./simulator"
	// A widget's settings and style open in the one app-level modal — the same
	// one the desktop editor's gear opens, a full-screen sheet at this width.
	import { openWidgetSettings } from "./widgetSettingsModal.svelte"
	// The layouts sheet says what the desktop's Layouts tab says: the same
	// sections, source lines, status line, Updated offer, questions and card menu.
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
		sourceLine,
		unshareAsks,
		unshareConfirm,
		updatedSentence,
		type CardMenuAction,
		type CopyAsk,
		type LayoutPresetUsage
	} from "./startFrom"

	/** The floor a session draws with nothing placed: Messages alone in the middle. */
	const floorPanels = (): PanelLayoutV1 => ({
		version: 1,
		left: [],
		middle: { above: [], primary: { key: "p1", tabs: ["messages"] }, below: [] },
		right: []
	})

	interface Props {
		/**
		 * The editor's working arrangement. Bound: every row edit replaces it
		 * with the op's answer, so the live view under the editor follows.
		 */
		editPanels?: PanelLayoutV1
		/**
		 * The arrangement the editor opened on; Done writes only when the
		 * working one differs from it. Absent: `editPanels` as it is mounted.
		 */
		openedPanels?: PanelLayoutV1
		/** The surface manager: Done's one write (`setPanels`). */
		manager?: { setPanels(panels: PanelLayoutV1): void }
		/**
		 * The instance ids that hold stored values (settings, a style pin), so
		 * a minted id never inherits a removed copy's (`mintInstanceId`).
		 */
		storedIds?: () => Iterable<string>
		/**
		 * A widget instance was minted and placed — `sourceId` set for a
		 * Duplicate, so the owner copies the source's settings and style to
		 * it; null for an Add.
		 */
		onMinted?: (id: string, sourceId: string | null) => void
		/** The Move tab's width preset, and the width it stands for. */
		simTier?: SimTier | null
		simWidth?: number | null
		/** SessionLayout's lookups over the surface manager. */
		inst: (id: string) => PanelInstance | undefined
		iconOf: (p: PanelInstance) => any
		middleWidgetIcon: (id: string) => any
		widgetLabel: (id: string) => string
		/**
		 * The picker sheet's list: every widget kind, every time — a placed
		 * one with its count, one at its cap disabled with the reason.
		 */
		trayWidgets: TrayWidget[]
		trayIcon: (t: TrayWidget) => any
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
		/** The card menu, as the desktop's. */
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
		/** The sticky bar's commit controls: close without writing, and close after Done's write. */
		onCancel: () => void
		onDone: () => void
		/**
		 * A preset's picture. Defined in SessionLayout because the desktop
		 * Layouts tab draws it too, and passed down so both draw the one.
		 */
		presetPicture: Snippet<[unknown]>
	}

	let {
		editPanels = $bindable(floorPanels()),
		openedPanels,
		manager,
		storedIds = () => [],
		onMinted,
		simTier = null,
		simWidth = null,
		inst,
		iconOf,
		middleWidgetIcon,
		widgetLabel,
		trayWidgets,
		trayIcon,
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

	/** What the editor opened on, taken once: Done compares against it. */
	const opened: PanelLayoutV1 = untrack(() =>
		$state.snapshot(openedPanels ?? editPanels)
	) as PanelLayoutV1

	/* ── the rows ───────────────────────────────────────────────────────── */
	let sections = $derived(phoneSections(editPanels))
	/** The last refusal, said under the list until the next edit. */
	let notice = $state<string | null>(null)

	/** Take an op's answer: the new arrangement, or its refusal said. */
	function apply(out: ArrangeOutcome): boolean {
		if (!out.layout) {
			notice = out.refused
			return false
		}
		notice = null
		if (out.layout !== editPanels) editPanels = out.layout
		return true
	}
	/** Ops read a plain document, never the bound proxy. */
	const cur = () => $state.snapshot(editPanels) as PanelLayoutV1

	function addFromPicker(target: AddTarget, widgetId: string) {
		const id = mintFor(cur(), widgetId, storedIds())
		if (apply(addAt(cur(), id, target))) onMinted?.(id, null)
	}
	function duplicate(sourceId: string) {
		const id = mintFor(cur(), widgetOfInstance(sourceId), storedIds(), {
			fresh: true
		})
		const out = duplicateTab(cur(), sourceId, id)
		// The owner seeds the copy's settings first, so its first draw wears them.
		if (out.layout) onMinted?.(id, sourceId)
		apply(out)
	}
	function tabIcon(id: string) {
		if (isInstanceOf(id, "messages")) return middleWidgetIcon(id)
		const p = inst(id)
		return p ? iconOf(p) : Icons.LayoutPanelTop
	}
	function rowIcon(row: PhoneRow) {
		return row.tabs.length > 1 ? Icons.Layers : tabIcon(row.tabs[0])
	}
	function rowTitle(row: PhoneRow): string {
		return row.title ?? row.tabs.map(widgetLabel).join(" · ")
	}

	/** Done: write only what changed, then close. */
	function done() {
		const now = cur()
		if (manager && !samePanels(opened, now)) manager.setPanels(now)
		onDone()
	}

	/* ── sheets ─────────────────────────────────────────────────────────── */
	/** Where the picker sheet lands a widget, while it is open. */
	let pickerTarget = $state<AddTarget | null>(null)
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
	let layoutSections = $derived(groupLayoutPresets(presets))
	let provenance = $derived(provenanceLine(startedFrom))
	let genreDefault = $derived(presets.find((p) => p.isGenreDefault) ?? null)
	/** The source, when it changed since the copy; the offer re-copies it. */
	let updatedSource = $derived(startedFromUpdated ? startedFrom : null)

	/* ── the card menu, rename, delete and Save changes to ─────────────── */
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

	/* ── the drag handle ────────────────────────────────────────────────────
	 * A touch reorder, spent as the same single steps the arrow buttons are: a
	 * pointer that has travelled a whole row's height asks for the next index
	 * in the row's column (`moveRowTo`). Pointer events rather than HTML
	 * drag-and-drop, which no mobile browser fires.
	 */
	let dragRowKey = $state<string | null>(null)
	let dragIndex = 0
	let dragOriginY = 0
	let dragStepPx = 44

	/** A row's index in its column (the middle's three sections are one column). */
	function columnIndex(key: string): number {
		const row = sections.flatMap((s) => s.rows).find((r) => r.key === key)
		if (!row) return -1
		const middle = row.place === "above" || row.place === "primary" || row.place === "below"
		const column = sections
			.filter((s) =>
				middle
					? s.place === "above" || s.place === "primary" || s.place === "below"
					: s.place === row.place
			)
			.flatMap((s) => s.rows)
		return column.findIndex((r) => r.key === key)
	}
	function startRowDrag(e: PointerEvent, key: string) {
		const grip = e.currentTarget as HTMLElement
		const row = grip.closest("li") as HTMLElement | null
		if (!row) return
		e.preventDefault()
		grip.setPointerCapture(e.pointerId)
		dragRowKey = key
		dragIndex = columnIndex(key)
		dragOriginY = e.clientY
		dragStepPx = Math.max(24, row.offsetHeight)
	}
	function dragRow(e: PointerEvent) {
		if (!dragRowKey) return
		const steps = Math.trunc((e.clientY - dragOriginY) / dragStepPx)
		if (!steps) return
		apply(moveRowTo(cur(), dragRowKey, dragIndex + steps))
		dragOriginY += steps * dragStepPx
		dragIndex = columnIndex(dragRowKey)
	}
	function endRowDrag(e: PointerEvent) {
		const grip = e.currentTarget as HTMLElement
		if (grip.hasPointerCapture(e.pointerId))
			grip.releasePointerCapture(e.pointerId)
		dragRowKey = null
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

<!-- The PHONE editor (PLAN-session-panels-2026-10-14 §3 lane 4): one row per
     panel, its tabs inside, in the order Above · Middle · Below · Left ·
     Right. A screen this narrow draws one panel under the next and hovers
     for nothing, so every control is on the row. -->
<!-- A tab's Duplicate: a copy of the widget beside it in the same panel, its
     settings and style copied. At the widget's cap, the reason. -->
{#snippet duplicateControl(id: string, label: string)}
	{@const full = trayWidgets.find((t) => t.id === widgetOfInstance(id))?.full}
	{#if !duplicateOffered()}
		<!-- QD's "tray only": no Duplicate. -->
	{:else if full}
		<span class="medit-floor medit-nocopy" role="note" title={full} aria-label={full}>
			<Icons.Copy size={13} aria-hidden="true" />
		</span>
	{:else}
		<button class="medit-btn" aria-label="Duplicate {label}" onclick={() => duplicate(id)}>
			<Icons.Copy size={14} />
		</button>
	{/if}
{/snippet}

{#snippet tabItem(row: PhoneRow, id: string, t: number)}
	{@const label = widgetLabel(id)}
	{@const TabIcon = tabIcon(id)}
	<li class="medit-member" data-panel-tab={id}>
		<TabIcon size={14} aria-hidden="true" />
		<span class="medit-name">{label}</span>
		{#if row.tabs.length > 1}
			<button
				class="medit-btn"
				disabled={t === 0}
				aria-label="Move {label} earlier"
				onclick={() => apply(moveTabWithin(cur(), id, -1))}
			>
				<Icons.ChevronLeft size={14} />
			</button>
			<button
				class="medit-btn"
				disabled={t === row.tabs.length - 1}
				aria-label="Move {label} later"
				onclick={() => apply(moveTabWithin(cur(), id, 1))}
			>
				<Icons.ChevronRight size={14} />
			</button>
		{/if}
		{#if row.aboveKey}
			<button
				class="medit-btn"
				aria-label="Move {label} into panel above"
				title="Move into panel above"
				onclick={() => apply(moveTabInto(cur(), id, -1))}
			>
				<Icons.ArrowUpToLine size={14} />
			</button>
		{/if}
		{#if row.belowKey}
			<button
				class="medit-btn"
				aria-label="Move {label} into panel below"
				title="Move into panel below"
				onclick={() => apply(moveTabInto(cur(), id, 1))}
			>
				<Icons.ArrowDownToLine size={14} />
			</button>
		{/if}
		{#if canSplitOut(editPanels, id)}
			<button
				class="medit-btn"
				aria-label="Split {label} out"
				title="Split out"
				onclick={() => apply(splitTab(cur(), id))}
			>
				<Icons.SquareSplitVertical size={14} />
			</button>
		{/if}
		<button
			class="medit-btn"
			aria-label="Open {label} settings"
			aria-haspopup="dialog"
			onclick={(e) => openWidgetSettings({ widgetId: id, label }, e.currentTarget)}
		>
			<Icons.Settings size={14} />
		</button>
		{@render duplicateControl(id, label)}
		<button
			class="medit-btn"
			aria-label="Remove {label}"
			onclick={() => apply(removeTabFrom(cur(), id))}
		>
			<Icons.X size={14} />
		</button>
	</li>
{/snippet}

{#snippet panelRow(row: PhoneRow)}
	{@const Icon = rowIcon(row)}
	{@const title = rowTitle(row)}
	<li class="medit-row" class:dragging={dragRowKey === row.key} data-panel-row={row.key}>
		<div class="medit-line">
			{#if row.canMoveUp || row.canMoveDown}
				<!-- The drag handle. `touch-action: none` (in CSS) is what stops
				     the page scrolling under a finger that is reordering. -->
				<button
					class="medit-grip"
					aria-label="Reorder {title}"
					onpointerdown={(e) => startRowDrag(e, row.key)}
					onpointermove={dragRow}
					onpointerup={endRowDrag}
					onpointercancel={endRowDrag}
				>
					<Icons.GripVertical size={16} />
				</button>
			{/if}
			<Icon size={16} aria-hidden="true" />
			<span class="medit-name">{title}</span>
			{#if row.tabs.length > 1}
				<span class="medit-badge">{row.tabs.length} tabs</span>
			{/if}
		</div>
		<div class="medit-acts">
			{#if row.canMoveUp || row.canMoveDown}
				<button
					class="medit-btn"
					disabled={!row.canMoveUp}
					aria-label="Move {title} up"
					onclick={() => apply(moveRow(cur(), row.key, -1))}
				>
					<Icons.ChevronUp size={15} />
				</button>
				<button
					class="medit-btn"
					disabled={!row.canMoveDown}
					aria-label="Move {title} down"
					onclick={() => apply(moveRow(cur(), row.key, 1))}
				>
					<Icons.ChevronDown size={15} />
				</button>
			{/if}
			{#if row.height && row.group !== "rail"}
				{@const fit = row.height === "fit"}
				<!-- Fit takes the content's height; Fill shares what is left. -->
				<button
					class="medit-chip medit-height"
					aria-label="Height of {title}: {fit ? 'Fit' : 'Fill'}. Switch to {fit ? 'Fill' : 'Fit'}"
					onclick={() => apply(setRowHeight(cur(), row.key, fit ? "fill" : "fit"))}
				>
					{#if fit}<Icons.FoldVertical size={13} />{:else}<Icons.UnfoldVertical size={13} />{/if}
					{fit ? "Fit" : "Fill"}
				</button>
			{/if}
			{#if row.canMakeMain}
				<!-- The primary is a place: this panel goes there, the old
				     primary to the end of Above. -->
				<button
					class="medit-btn"
					aria-label="Make {title} main"
					title="Make main"
					data-make-main={row.key}
					onclick={() => apply(makeMain(cur(), row.key))}
				>
					<Icons.Crown size={15} />
				</button>
			{/if}
			<button
				class="medit-btn"
				aria-label="Add a tab to {title}"
				aria-haspopup="dialog"
				onclick={() => (pickerTarget = { kind: "panel", panelKey: row.key })}
			>
				<Icons.Plus size={15} />
			</button>
		</div>
		<ul class="medit-members">
			{#each row.tabs as id, t (id)}
				{@render tabItem(row, id, t)}
			{/each}
		</ul>
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
			A screen this narrow draws one panel under the next. Drag a handle, or
			use the arrows, to change the order.
		</p>
		{#if notice}
			<p class="medit-notice" role="status" data-medit-notice>{notice}</p>
		{/if}
		{#each sections as s (s.place)}
			<section class="medit-zone" data-panel-section={s.place}>
				<header class="medit-zone-head">
					{s.label}
					<span class="flex-1"></span>
					<button class="medit-chip" onclick={() => (pickerTarget = s.add)}>
						<Icons.Plus size={13} />
						Add
					</button>
				</header>
				{#if s.groups}
					<!-- A side: Docked, then In the rail. Both headers always
					     show, so an empty group still says where rows go. -->
					{#each s.groups as g (g.group)}
						<h3 class="medit-group-head" data-side-group={g.group}>{g.label}</h3>
						<ul class="medit-list" data-side-group-list={g.group}>
							{#each g.rows as row (row.key)}
								{@render panelRow(row)}
							{/each}
							{#if !g.rows.length}
								<li class="medit-empty">
									{g.group === "docked" ? "Nothing docked." : "Nothing in the rail."}
								</li>
							{/if}
						</ul>
					{/each}
				{:else}
					<ul class="medit-list">
						{#each s.rows as row (row.key)}
							{@render panelRow(row)}
						{/each}
						{#if !s.rows.length}
							<li class="medit-empty">Nothing here yet.</li>
						{/if}
					</ul>
				{/if}
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
		<button class="medit-chip primary" onclick={done}>
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
			<!-- Every kind, every time: picking a placed one adds another copy. -->
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
						if (target) addFromPicker(target, t.id)
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
			<!-- Start from: two sections, Ready-made and Yours (./startFrom
			     `groupLayoutPresets`). Choosing one asks, then COPIES it in;
			     the marked one is what it started from. -->
			{#each layoutSections as g (g.key)}
				<section class="msheet-group" data-preset-group={g.key}>
					<h3 class="msheet-group-label" data-preset-group-label>
						{g.label}
					</h3>
					{#each g.cards as p (p.id)}
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
										<!-- Where it comes from (./startFrom `sourceLine`). -->
										<span class="msheet-item-desc" data-preset-source
											>{sourceLine(p, startedFrom?.id ?? null)}</span
										>
										<!-- Yours, shared: the desktop card's word. -->
										{#if sharedMark(p)}
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
									triggerClass="text-surface-600-400 hover:bg-surface-200-800 flex size-8 shrink-0 items-center justify-center self-center rounded-lg pointer-coarse:size-11"
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
		/* The body scrolls; a section never shrinks to fit it. */
		flex-shrink: 0;
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
	/* A control that is not offered here (Duplicate at a widget's cap): the
	   reason, quiet, taking the button's square so the row does not shift. */
	.medit-floor {
		display: inline-flex;
		align-items: center;
		justify-content: center;
		inline-size: 2.25rem;
		block-size: 2.25rem;
		color: var(--color-surface-600-400);
	}
	/* A side's group label (Docked / In the rail): plain, under the section head. */
	.medit-group-head {
		margin: 0;
		padding: 0.3rem 0.5rem 0.15rem;
		font-size: 0.6875rem;
		font-weight: 600;
		color: var(--color-surface-600-400);
	}
	.medit-members {
		flex-basis: 100%;
		padding-inline-start: 2.25rem;
	}
	.medit-member {
		display: flex;
		flex-wrap: wrap;
		align-items: center;
		gap: 0.2rem;
		font-size: 0.8rem;
		opacity: 0.85;
	}
	.medit-notice {
		margin: 0;
		padding: 0.4rem 0.6rem;
		border-radius: 0.4rem;
		font-size: 0.8rem;
		background: color-mix(in oklab, var(--color-warning-500) 16%, transparent);
	}
	.medit-chip.medit-height {
		min-block-size: 2.25rem;
		padding-inline: 0.5rem;
		font-size: 0.75rem;
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
