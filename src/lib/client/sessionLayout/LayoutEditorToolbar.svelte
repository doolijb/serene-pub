<script lang="ts">
	/**
	 * The layout editor's DESKTOP toolbar (tabbed: Layouts · Settings · Move),
	 * split out of SessionLayout.
	 *
	 * It survives a previewed phone width — the tier buttons and the grid escape
	 * live in it — so a real narrow window is the only thing that has no toolbar
	 * at all; there the sticky bar at the foot of MobileLayoutEditor is it. The
	 * `{#if editing && !isNarrow}` that decides all of that stays in
	 * SessionLayout, and so does everything the toolbar only ASKS for: the
	 * presets themselves, the palette, the simulator's state. What lives here is
	 * the pane's own UI state — which tab, the one-at-a-time rename of a layout
	 * you saved, and the questions asked before a verb replaces this session's
	 * layout or deletes one of yours (brief 4: the words are `./startFrom`'s,
	 * shared with the phone's layouts sheet). Brief 6b adds each card's `⋯`
	 * menu (`LayoutCardMenu`: new-session layout, make a copy, share, rename,
	 * delete) and **Save changes to "*Name*"**.
	 */
	import type { Snippet } from "svelte"
	import * as Icons from "@lucide/svelte"
	import { tick } from "svelte"
	import type { TrayWidget } from "./widgetInstances"
	// The Move tab's screen-size simulator: the width presets the picker offers.
	import { SIM_OPTIONS, type SimTier } from "./simulator"
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

	interface Props {
		/** Which pane is showing. Bound: SessionLayout derives `placing` from it. */
		editTab: "presets" | "settings" | "move"
		/**
		 * Where the band starts. The toolbar is taken out of flow, so it cannot
		 * read the session root's box itself: SessionLayout passes 0 while the
		 * Move tab's scrim is covering the nav rail, and the root's measured
		 * offset otherwise — see `.editor`'s rule.
		 */
		insetStart: number
		/**
		 * The band's measured height, bound back out: SessionLayout reserves
		 * exactly that much room above the live view and the simulator's stage.
		 */
		height: number
		/**
		 * The session layout presets this person may start from, and the one
		 * this session's layout started from (provenance, never a base).
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
		/**
		 * What Start from scratch keeps in the middle, by name — the
		 * conversation's widget, or the genre's own main widget — so the
		 * confirmation can say it.
		 */
		mainWidgetTitle?: string
		/**
		 * Managing a preset you saved. Only ever asked for a card this user
		 * may manage (`mine`); the page owns the round trips and pushes the
		 * refreshed list back down through `presets`.
		 */
		onRenamePreset?: (presetId: number, name: string) => void
		onDeletePreset?: (presetId: number) => void
		onPresetUsage?: (presetId: number) => void
		/**
		 * The answer to the last `onPresetUsage` ask, or null while in flight;
		 * `unknown` when the ask failed.
		 */
		presetUsage?: LayoutPresetUsage | null
		/** A preset's picture — SessionLayout's snippet, drawn by both editors. */
		presetPicture: Snippet<[unknown]>
		/**
		 * **Save changes to "*Name*"** into the layout of yours this session
		 * started from; `overwriteUpdated` once the person was told it changed
		 * since the copy and said save over it. Returns whether it was sent.
		 */
		saveChanges?: (presetId: number, overwriteUpdated: boolean) => boolean
		/** The genre's name, for _Use for new *Genre* sessions_. */
		genreName?: string | null
		/** A guest in this session: no share control is drawn. */
		isGuest?: boolean
		/** An admin manages someone else's shared layout too. */
		isAdmin?: boolean
		/** The card menu's verbs (brief 6b); the page owns the round trips. */
		onShareLayout?: (presetId: number, visibility: "shared" | "private") => void
		onCloneLayout?: (presetId: number) => void
		onSetNewSessionLayout?: (presetId: number | null) => void
		/** Every widget on screen; the Settings tab only counts them. */
		styleableWidgets: { id: string; label: string }[]
		/**
		 * The Move tab's tray (brief 7b): every widget kind, every time — a
		 * placed one with its count, one at its `maxInstances` disabled with
		 * the reason. A chip carries its WIDGET id; landing it mints the
		 * instance (`SessionLayout`'s `addWidget`).
		 */
		trayWidgets: TrayWidget[]
		trayIcon: (t: TrayWidget) => any
		/** Tap-to-place: the palette chip currently armed. */
		armedId: string | null
		/** The zone currently under a drag (highlight); the tray is `__palette__`. */
		dragOverZone: string | null
		/** A chip's drag: its widget id, under the tray's own drag type. */
		onTrayDragStart: (e: DragEvent, widgetId: string) => void
		draggedId: (e: DragEvent) => string | null
		/** The tray's own drop: a card dragged back out of the layout. */
		removeWidget: (widgetId: string) => void
		/** The screen-size simulator, and the two lenses beside it. */
		simTier: SimTier | null
		setSimTier: (tier: SimTier | null) => void
		railPreview: boolean
		simGrid: boolean
		simNarrow: boolean
		/** The two commit controls, SessionLayout's own. */
		onCancel: () => void
		onDone: () => void
	}

	let {
		editTab = $bindable(),
		insetStart,
		height = $bindable(),
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
		presetPicture,
		saveChanges,
		genreName = null,
		isGuest = false,
		isAdmin = false,
		onShareLayout,
		onCloneLayout,
		onSetNewSessionLayout,
		styleableWidgets,
		trayWidgets,
		trayIcon,
		armedId = $bindable(),
		dragOverZone = $bindable(),
		onTrayDragStart,
		draggedId,
		removeWidget,
		simTier,
		setSimTier,
		railPreview = $bindable(),
		simGrid = $bindable(),
		simNarrow,
		onCancel,
		onDone
	}: Props = $props()

	/* ── managing a layout you saved ────────────────────────────────────
	 * Rename and delete are in the card menu of a layout you manage (yours;
	 * for an admin, someone's shared one); the shipped ones offer neither.
	 * Both are one-at-a-time by construction — a single id of state each —
	 * so the row can never show two open editors or two pending
	 * confirmations, and starting one closes the other. */
	/** The card whose name is being edited inline, if any. */
	let renamingId = $state<number | null>(null)
	let renameValue = $state("")
	let renameField = $state<HTMLInputElement | null>(null)
	/** The card a delete has been asked for, awaiting its "how many?" answer. */
	let deleteAskId = $state<number | null>(null)
	/** That card, or null once it is gone from the pushed list (deleted). */
	let deletingPreset = $derived(
		presets.find((p) => p.id === deleteAskId) ?? null
	)
	/** What deleting it touches, or null while the answer is still in flight. */
	let deleteUsage = $derived(
		presetUsage && presetUsage.id === deleteAskId ? presetUsage : null
	)

	function startRename(p: Sockets.Sessions.LayoutPreset) {
		deleteAskId = null
		copyAsk = null
		saveChangesAsk = null
		unshareAsk = null
		renamingId = p.id
		renameValue = p.name
	}
	/** The editor's own box: where a card's `⋯` trigger is looked up again. */
	let editorEl = $state<HTMLElement | null>(null)
	/**
	 * A rename ended from the keyboard: the field took the place of the card's
	 * `⋯` trigger (menus hand focus back to their trigger, STYLE-GUIDE §6.6),
	 * so focus goes to the new trigger once it is drawn — never the page.
	 * Not on a blur: focus is already wherever the person put it.
	 */
	async function focusCardMenu(id: number) {
		await tick()
		editorEl
			?.querySelector<HTMLElement>(`[data-card-menu="${id}"] button`)
			?.focus()
	}
	/**
	 * Commit the inline rename. Enter and blur both land here, and so does the
	 * blur that Escape causes by unmounting the field — which is why the first
	 * line checks the field is still open for THIS card: by then `cancelRename`
	 * has already cleared it, so the cancel wins the race with its own blur.
	 *
	 * An unchanged or blank name is dropped rather than sent: the server refuses
	 * a blank one anyway, and a refusal toast for pressing Enter on a name you
	 * did not edit would be noise.
	 */
	function commitRename(id: number) {
		if (renamingId !== id) return
		const name = renameValue.trim()
		const was = presets.find((p) => p.id === id)?.name
		renamingId = null
		if (!name || name === was) return
		onRenamePreset?.(id, name)
	}
	function cancelRename() {
		renamingId = null
	}
	// The field only exists while a rename is open, so focus it as it appears
	// and select what is there — the common edit is replacing the name, not
	// appending to it.
	$effect(() => {
		if (renamingId != null && renameField) {
			renameField.focus()
			renameField.select()
		}
	})

	/**
	 * Step one of the delete: ask what it touches. The confirmation cannot be
	 * answered until that lands: no session's layout changes (each holds its
	 * own copy), but a person using it for new sessions gets the genre default
	 * layout instead, and that is worth knowing before, not after.
	 */
	function askDelete(p: Sockets.Sessions.LayoutPreset) {
		renamingId = null
		copyAsk = null
		saveChangesAsk = null
		unshareAsk = null
		deleteAskId = p.id
		onPresetUsage?.(p.id)
	}

	/* ── the Start from pane (brief 4) ──────────────────────────────────
	 * Cards grouped by who brought them, a status line read off the
	 * provenance, the Updated offer, and a question before anything replaces
	 * this session's layout. */
	let groups = $derived(groupLayoutPresets(presets))
	let provenance = $derived(provenanceLine(startedFrom))
	let genreDefault = $derived(presets.find((p) => p.isGenreDefault) ?? null)
	/**
	 * The source, when it changed since this session copied it. The offer
	 * under the status line then carries its re-copy verb, so the row of
	 * verbs does not repeat it.
	 */
	let updatedSource = $derived(startedFromUpdated ? startedFrom : null)
	/** The copy waiting on a yes, if any. One question at a time. */
	let copyAsk = $state<CopyAsk | null>(null)
	let saveAsOpen = $state(false)

	/* ── the card menu and Save changes to (brief 6b) ───────────────────── */
	/** What new sessions of this genre start from: the card with the star. */
	let newSessionLayout = $derived(newSessionLayoutOf(presets))
	let menuContext = $derived({
		genreName,
		isGuest,
		isAdmin,
		newSessionLayoutId: newSessionLayout?.id ?? null
	})
	/**
	 * **Save changes to "*Name*"** is offered when this session started from
	 * a layout of YOURS (authorship, `mine`): a shipped or shared one is
	 * someone else's to change — make a copy instead.
	 */
	let saveChangesTarget = $derived(startedFrom?.mine ? startedFrom : null)
	/**
	 * Save changes to, waiting on a yes. `updated`: this session reads the
	 * layout as Updated, so saving would replace changes saved into it since
	 * the copy — the question warns and offers Start again instead.
	 */
	let saveChangesAsk = $state<{
		preset: Sockets.Sessions.LayoutPreset
		updated: boolean
	} | null>(null)

	/**
	 * An admin's _Stop sharing_ on someone else's layout, waiting on a yes:
	 * it leaves the admin's list and only its author can share it again.
	 */
	let unshareAsk = $state<Sockets.Sessions.LayoutPreset | null>(null)

	function onCardAction(action: CardMenuAction, p: Sockets.Sessions.LayoutPreset) {
		if (action === "new-session") onSetNewSessionLayout?.(newSessionChoice(p))
		else if (action === "stop-new-session") onSetNewSessionLayout?.(null)
		else if (action === "copy") onCloneLayout?.(p.id)
		else if (action === "share") onShareLayout?.(p.id, "shared")
		else if (action === "unshare") {
			if (unshareAsks(p)) askUnshare(p)
			else onShareLayout?.(p.id, "private")
		} else if (action === "rename") startRename(p)
		else if (action === "delete") askDelete(p)
	}
	function askUnshare(p: Sockets.Sessions.LayoutPreset) {
		renamingId = null
		deleteAskId = null
		copyAsk = null
		saveChangesAsk = null
		unshareAsk = p
	}
	function askSaveChanges(p: Sockets.Sessions.LayoutPreset) {
		renamingId = null
		deleteAskId = null
		copyAsk = null
		unshareAsk = null
		saveChangesAsk = { preset: p, updated: startedFromUpdated && startedFrom?.id === p.id }
	}

	/** What the one dialog asks: a copy, Save changes to, Stop sharing, else a pending delete. */
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
	const pid = $props.id()

	function askCopy(ask: CopyAsk) {
		renamingId = null
		deleteAskId = null
		saveChangesAsk = null
		unshareAsk = null
		copyAsk = ask
	}
	/** Yes: the copy, the save, Stop sharing, or the delete goes ahead. */
	function confirmYes() {
		const ask = copyAsk
		if (ask) {
			copyAsk = null
			if (ask.kind === "reset") resetLayout()
			else startFrom(copyTarget(ask))
			return
		}
		const save = saveChangesAsk
		if (save) {
			saveChangesAsk = null
			saveChanges?.(save.preset.id, save.updated)
			return
		}
		const unshare = unshareAsk
		if (unshare) {
			unshareAsk = null
			onShareLayout?.(unshare.id, "private")
			return
		}
		const doomed = deletingPreset
		deleteAskId = null
		// The refreshed list arrives on the reply and redraws the group.
		if (doomed) onDeletePreset?.(doomed.id)
	}
	/**
	 * The question's other way out: Save changes to over an Updated layout
	 * offers Start again from it, which asks its own question in the same
	 * dialog (it replaces this session's layout).
	 */
	function confirmAlternative() {
		const save = saveChangesAsk
		if (!save) return
		askCopy({ kind: "again", preset: save.preset })
	}
	function confirmNo() {
		copyAsk = null
		saveChangesAsk = null
		unshareAsk = null
		deleteAskId = null
	}
</script>

<!-- The layout editor: a tabbed toolbar over the chat. Layouts starts
     this session's layout again from a copy (and saves it as a new named
     layout); Style picks the message packs (live preview); Move places and
     arranges widgets in the zones. -->
<!-- The band stops at the session's own left edge unless the Move tab's
     scrim is covering the nav rail — see `.editor`'s rule. `insetStart` is
     the root's measured offset from the window, and since the one-rail
     shell that offset IS the rail. -->
<div
	class="editor"
	data-pop-keep
	bind:this={editorEl}
	bind:clientHeight={height}
	style:inset-inline-start="{insetStart}px"
>
	<div class="editor-tabs" role="tablist" aria-label="Layout editor">
		<span class="editor-title">
			<Icons.LayoutDashboard size={14} />
			Layout
		</span>
		<div class="editor-tablist">
			<button
				class="editor-tab"
				class:active={editTab === "presets"}
				role="tab"
				aria-selected={editTab === "presets"}
				onclick={() => (editTab = "presets")}
			>
				<Icons.LayoutTemplate size={16} />
				<!-- "Layouts", never "Presets" on screen: that is the session
				     preset's word (NOMENCLATURE §9, session layout preset). -->
				Layouts
				<!-- The layout this session started from changed since the
				     copy: the Layouts tab has an offer waiting. -->
				{#if startedFromUpdated}
					<span class="tab-dot" data-updated-dot aria-hidden="true"></span>
					<span class="sr-only">(updated)</span>
				{/if}
			</button>
			<button
				class="editor-tab"
				class:active={editTab === "settings"}
				role="tab"
				aria-selected={editTab === "settings"}
				onclick={() => (editTab = "settings")}
			>
				<Icons.SlidersHorizontal size={16} />
				Settings
			</button>
			<button
				class="editor-tab"
				class:active={editTab === "move"}
				role="tab"
				aria-selected={editTab === "move"}
				onclick={() => (editTab = "move")}
			>
				<Icons.Move size={16} />
				Move
			</button>
		</div>
		<span class="flex-1"></span>
		<button
			class="tool-btn"
			onclick={onCancel}
			title="Leave the editor and put back the layout you opened it on"
		>
			<Icons.X size={14} />
			<span>Cancel</span>
		</button>
		<button class="tool-btn primary" onclick={onDone}>
			<Icons.Check size={14} />
			<span>Done</span>
		</button>
	</div>

	<div class="editor-panel">
		{#if editTab === "presets"}
			<!-- The pane's head: where this session's layout started from,
			     then the three verbs that REPLACE it with a copy, then the
			     one that writes a new named layout from it. Done saves the
			     edits to this session only. Every copy asks first. -->
			<div class="sf-head">
				<p class="sf-status" data-layout-provenance>
					{provenance.lead}{#if provenance.name}<strong
							>{provenance.name}</strong
						>{/if}{provenance.tail}
				</p>
				<span class="flex-1"></span>
				<div
					class="sf-verbs"
					role="group"
					aria-label="Replace this session's layout"
				>
					{#if !updatedSource?.isGenreDefault}
						<button
							class="tool-btn"
							data-copy-verb="reset"
							onclick={() =>
								askCopy({ kind: "reset", preset: genreDefault })}
							title="Copy the genre default layout back into this session"
						>
							<Icons.RotateCcw size={14} />
							<span>Reset to genre default layout</span>
						</button>
					{/if}
					{#if startAgainFrom && updatedSource?.id !== startAgainFrom.id}
						{@const again = startAgainFrom}
						<button
							class="tool-btn"
							data-copy-verb="again"
							onclick={() => askCopy({ kind: "again", preset: again })}
							title={`Copy ${quoted(again.name)} into this session again`}
						>
							<Icons.RotateCcw size={14} />
							<span>Start again from {quoted(again.name)}</span>
						</button>
					{/if}
					<button
						class="tool-btn"
						data-copy-verb="scratch"
						onclick={() => askCopy({ kind: "scratch" })}
						title="The conversation and this genre's panels, each at its defaults"
					>
						<Icons.RotateCcw size={14} />
						<span>Start from scratch</span>
					</button>
				</div>
				<span class="sf-rule" aria-hidden="true"></span>
				<!-- Writing back into the layout of yours this session started
				     from (brief 6b): asks first, and warns when changes were
				     saved into it from elsewhere since the copy. -->
				{#if saveChangesTarget}
					{@const target = saveChangesTarget}
					<button
						class="tool-btn"
						aria-haspopup="dialog"
						data-save-changes
						onclick={() => askSaveChanges(target)}
						title={`Save this session's layout into ${quoted(target.name)}`}
					>
						<Icons.Save size={14} />
						<span>Save changes to {quoted(target.name)}</span>
					</button>
				{/if}
				<button
					class="tool-btn"
					aria-haspopup="dialog"
					onclick={() => (saveAsOpen = true)}
					title="Save this session's layout as a new layout every session of this genre can start from"
				>
					<Icons.Save size={14} />
					<span>Save as new layout</span>
				</button>
			</div>
			<!-- The source changed since the copy. Inside the editor only: the
			     stage never shows it, and nothing moves until they say so. -->
			{#if updatedSource}
				{@const src = updatedSource}
				<div class="sf-updated" role="status" data-layout-updated>
					<span class="sf-chip">Updated</span>
					<span class="sf-updated-text">{updatedSentence(src)}</span>
					<button
						class="tool-btn"
						data-copy-verb={src.isGenreDefault ? "reset" : "again"}
						onclick={() => askCopy(reCopyAsk(src))}
					>
						<Icons.RotateCcw size={14} />
						<span>{reCopyLabel(src)}</span>
					</button>
				</div>
			{/if}
			<!-- Start from: the cards, grouped by who brought them. Choosing
			     one asks, then COPIES it into this session; the card with the
			     ring is the one it started from. -->
			<div class="sf-groups">
				{#each groups as g, gi (g.key)}
					<section
						class="sf-group"
						data-preset-group={g.key}
						aria-labelledby="{pid}-g{gi}"
					>
						<h3
							class="sf-group-label"
							id="{pid}-g{gi}"
							data-preset-group-label
						>
							{g.label}
						</h3>
						<div class="presets-row">
							{#each g.presets as p (p.id)}
								{@const current = startedFrom?.id === p.id}
								{@const forNewSessions = newSessionLayout?.id === p.id}
								<div class="preset-item">
									<button
										class="preset-card"
										class:current
										aria-current={current ? "true" : undefined}
										data-preset-card={p.id}
										onclick={() => askCopy({ kind: "card", preset: p })}
										title={p.description ??
											(p.isGenreDefault
												? "Start from the genre default layout"
												: `Start from ${quoted(p.name)}`)}
									>
										<span class="preset-pic">
											{@render presetPicture(p.layout)}
											<!-- What new sessions of this genre start
											     from: the star of "set as default"
											     (NOMENCLATURE §22), on one card. -->
											{#if forNewSessions}
												<span
													class="preset-star"
													data-new-session-layout
													title={newSessionMark(genreName)}
													aria-hidden="true"
												>
													<Icons.Star size={11} aria-hidden="true" />
												</span>
											{/if}
											{#if current && startedFromUpdated}
												<span class="sf-chip preset-updated" aria-hidden="true"
													>Updated</span
												>
											{/if}
										</span>
										<!-- The card is named by its name first; the marks
										     drawn on the picture are said after it. -->
										<span class="preset-name">{p.name}</span>
										{#if current && startedFromUpdated}
											<span class="sr-only">{", updated"}</span>
										{/if}
										{#if forNewSessions}
											<span class="sr-only" data-new-session-words
												>{`, ${newSessionMark(genreName)}`}</span
											>
										{/if}
										<!-- Someone else's, shared on this server: whose.
										     Yours, shared: that it is. -->
										{#if !p.mine && p.origin === "user" && p.authorName}
											<span class="preset-by">by {p.authorName}</span>
										{:else if sharedMark(p)}
											<span
												class="preset-by"
												data-shared-mark
												title="Shared with everyone on this pub">{sharedMark(p)}</span
											>
										{/if}
									</button>
									<!-- Every card's menu (brief 6b): the new-session
									     layout and Make a copy for any; share, rename
									     and delete only where this person manages it —
									     a shipped layout is offered nothing it would
									     only refuse. -->
									{#if renamingId === p.id && canManageLayout(p, isAdmin)}
										<input
											class="preset-input preset-rename"
											type="text"
											bind:this={renameField}
											bind:value={renameValue}
											maxlength="80"
											aria-label={`New name for "${p.name}"`}
											onkeydown={(e) => {
												if (e.key === "Enter") {
													// Else the key's own activation lands on
													// the trigger focus moves to, and opens it.
													e.preventDefault()
													commitRename(p.id)
													focusCardMenu(p.id)
												} else if (e.key === "Escape") {
													cancelRename()
													focusCardMenu(p.id)
												}
											}}
											onblur={() => commitRename(p.id)}
										/>
									{:else}
										<div
											class="preset-actions"
											class:armed={deleteAskId === p.id ||
												unshareAsk?.id === p.id}
										>
											<!-- 24px tall at least (WCAG 2.5.8), 44px on a
											     coarse pointer (STYLE-GUIDE §9). -->
											<LayoutCardMenu
												preset={p}
												context={menuContext}
												onAction={onCardAction}
												placement="bottom-start"
												triggerClass="text-surface-600-400 hover:bg-surface-200-800 flex min-h-6 min-w-8 items-center justify-center rounded-[0.35rem] px-2 py-0.5 pointer-coarse:min-h-11 pointer-coarse:min-w-11"
											/>
										</div>
									{/if}
								</div>
							{/each}
						</div>
					</section>
				{:else}
					<span class="advanced-note">
						No layouts for this genre yet.
					</span>
				{/each}
			</div>
		{:else if editTab === "settings"}
			<!-- One line, because the controls are on the widgets: every
			     widget on screen wears its own settings overlay while
			     this tab is open, with Style as one of its sections. -->
			<p class="pack-hint">
				{#if styleableWidgets.length}
					Hover a widget to change its settings.
				{:else}
					Put a widget in the layout on the Move tab, then
					hover it to change its settings.
				{/if}
			</p>
		{:else if editTab === "move"}
			<!-- svelte-ignore a11y_no_static_element_interactions -->
			<div
				class="palette"
				class:drag-over={dragOverZone === "__palette__"}
				ondragover={(e) => {
					e.preventDefault()
					dragOverZone = "__palette__"
					if (e.dataTransfer)
						e.dataTransfer.dropEffect = "move"
				}}
				ondragleave={() => (dragOverZone = null)}
				ondrop={(e) => {
					e.preventDefault()
					dragOverZone = null
					const id = draggedId(e)
					if (id) removeWidget(id)
				}}
			>
				<span class="palette-label">
					<Icons.Plus size={13} />
					Add
				</span>
				<div class="palette-tray">
					<!-- Every kind, every time (brief 7b): adding a placed
					     one is how a second copy is made. The count says how
					     many are placed; a kind at its cap is disabled and
					     says why. -->
					{#each trayWidgets as t (t.id)}
						{@const IconCmp = trayIcon(t)}
						<button
							class="widget-card"
							class:armed={armedId === t.id}
							data-tray-widget={t.id}
							disabled={!!t.full}
							draggable={!t.full}
							ondragstart={(e) => onTrayDragStart(e, t.id)}
							onclick={() =>
								(armedId = armedId === t.id ? null : t.id)}
							title={t.full ??
								(armedId === t.id
									? "Tap a zone to place"
									: "Drag to a zone, or tap to arm")}
						>
							<IconCmp size={18} />
							<span class="widget-card-label">{t.title}</span>
							{#if t.placed}
								<span class="widget-card-count"
									><span class="sr-only">{" · "}</span>{t.placed} placed</span
								>
							{/if}
							<!-- Not every browser shows a disabled button's title:
							     the cap's reason is said on the card too. -->
							{#if t.full}
								<span class="widget-card-count"
									><span class="sr-only">{" · "}</span>{t.full}</span
								>
							{/if}
						</button>
					{/each}
				</div>
				{#if armedId}
					<span class="palette-hint">tap a zone to place</span>
				{/if}
				<span class="flex-1"></span>
				<span class="palette-tip">
					Drag onto a zone · drop here to remove
				</span>
			</div>
			<!-- The screen-size simulator (P5, ruled 2026-08-30): a LENS
			     on the one arrangement, never a second one. Picking a
			     tier redraws the three editor zones at that width, so
			     their column counts — and therefore how this same
			     `arrangedGrid` clamps into them — are the device's.
			     Nothing here is persisted; Done and leaving the tab drop
			     back to Actual — and a preview you only LOOKED at is
			     undone with it (see `exitSimulation`), so previewing a
			     phone can never clamp away a desktop arrangement.

			     The last preset, Ultrawide, is the one that is not a
			     container tier: it previews the width where the side
			     rails branch to 2-column in `DEFAULT_SIDE_RULES`, which
			     nothing else here could show. -->
			<div class="move-sim">
				<span class="move-sim-label">
					<Icons.MonitorSmartphone size={13} />
					Screen
				</span>
				<div
					class="move-sim-seg"
					role="group"
					aria-label="Preview width"
				>
					<button
						class="move-sim-btn"
						class:active={simTier === null}
						aria-pressed={simTier === null}
						title="Preview at this window's real width"
						onclick={() => setSimTier(null)}
					>
						Actual
					</button>
					{#each SIM_OPTIONS as o (o.tier)}
						<button
							class="move-sim-btn"
							class:active={simTier === o.tier}
							aria-pressed={simTier === o.tier}
							title={o.hint}
							onclick={() =>
								setSimTier(
									simTier === o.tier ? null : o.tier
								)}
						>
							{o.label}
							<span class="move-sim-px">{o.width}</span>
						</button>
					{/each}
				</div>
				<!-- The rail model (ruled 2026-09-10), on the SAME
				     arrangement: each group in a side column is its own
				     toggling panel, so this draws the sides the way a
				     session draws them — docked, or an icon in the rail,
				     or opened over the chat when the column has no room.
				     A lens like the width presets, and nothing it does is
				     persisted: pin and open live for the page. -->
				<button
					class="move-sim-btn move-sim-rails"
					class:active={railPreview}
					aria-pressed={railPreview}
					title="Draw the side columns as rails — toggle a group, pin one, and watch what does not fit fly out"
					onclick={() => (railPreview = !railPreview)}
				>
					<Icons.PanelLeftClose size={12} />
					Rails
				</button>
				<!-- The MOBILE-EDIT mode (ruled 2026-09-10): a previewed
				     width below the breakpoint draws the row editor that
				     width really gets, so it can be checked without a
				     phone. This is the way back to the grid, and it is
				     offered only here — a real narrow window has no zones
				     to drag in. -->
				{#if simNarrow}
					<button
						class="move-sim-btn move-sim-rails"
						class:active={simGrid}
						aria-pressed={simGrid}
						title="Draw the grid at this width instead of the row editor a screen this narrow gets"
						onclick={() => (simGrid = !simGrid)}
					>
						<Icons.Grid2x2 size={12} />
						Grid
					</button>
				{/if}
			</div>
			<!-- Says out loud what the guard enforces: looking at a tier
			     changes nothing, but ARRANGING at one is an edit to the
			     single layout, not to that tier. (Sibling of .move-sim so
			     the panel's flex-wrap gives it its own line when tight;
			     reuses the editor's existing hint style.) -->
			{#if simTier !== null}
				<span class="palette-hint">
					Changes you make here apply to the layout at every
					size.
				</span>
			{/if}
			{#if railPreview}
				<span class="palette-hint">
					Click a rail icon to open or close a group; the pin
					keeps one open at its own height. Alt+[ expands
					every group that fits, Alt+] sends them all to the
					rail.
				</span>
			{/if}
		{/if}
	</div>
</div>

<!-- Portalled to the body (STYLE-GUIDE §6.6): the pane's one question, and
     Save as new layout's name and description. -->
<LayoutConfirmDialog
	{confirm}
	onConfirm={confirmYes}
	onCancel={confirmNo}
	onAlternative={confirmAlternative}
/>
<SaveAsNewLayoutDialog bind:open={saveAsOpen} onSave={savePreset} />

<style>
	/* ── Layout editor toolbar (tabbed: Layouts · Settings · Move) ─────
	   While the editor is open this bar OWNS the header's band: the shell takes
	   the session header and the Jump pill out of it for the duration (see
	   layoutEditor.svelte.ts), so the bar wears the header's own ground and
	   rules off from the page the way the header did — no card, no radius, no
	   margin.

	   On MOVE it spans the whole VIEWPORT, nav rail included, because the
	   editor's three columns are laid out across the viewport rather than
	   across `<main>` — the scrim already covers the rail, and a toolbar
	   stopping short of the columns it commands would read as a second thing.

	   On PRESETS and SETTINGS there is no canvas and no scrim: those tabs are a
	   LIVE preview of the session, and the session starts to the right of the
	   nav rail. A full-bleed band there painted over the rail's first icon, so
	   its start edge is the root's own (`mLeft`, an inline style — the rail can
	   change width). */
	.editor {
		position: fixed;
		inset-block-start: 0;
		inset-inline-end: 0;
		z-index: 25;
		background: var(--color-surface-100);
		border-block-end: 1px solid
			color-mix(in oklab, var(--color-surface-300) 60%, transparent);
		box-shadow: 0 6px 20px -12px rgba(0, 0, 0, 0.4);
		overflow: hidden;
		/* The start edge moves when the tab does (viewport on Move, the root's
		   own edge on the others). Intentionally NOT transitioned: a tab switch
		   also swaps the canvas for the live session (or back), and in Chromium
		   a slide on this property played out only after that mount had
		   settled (the bar sat at its old edge for ~300ms, then jumped), which
		   reads as lag rather than motion. */
	}
	:global([data-mode="dark"]) .editor {
		background: var(--color-surface-900);
		border-block-end-color: color-mix(
			in oklab,
			var(--color-surface-700) 60%,
			transparent
		);
	}
	/* 56px and a 1rem gutter each side: the band this replaces is the header's
	   (STYLE-GUIDE §4.2), so it keeps the header's measure. */
	.editor-tabs {
		display: flex;
		align-items: center;
		gap: 0.4rem;
		min-block-size: 56px;
		padding-inline: 1rem 1rem;
		border-block-end: 1px solid
			color-mix(in oklab, var(--color-surface-300) 45%, transparent);
	}
	:global([data-mode="dark"]) .editor-tabs {
		border-block-end-color: color-mix(
			in oklab,
			var(--color-surface-700) 45%,
			transparent
		);
	}
	.editor-title {
		display: flex;
		align-items: center;
		gap: 0.35rem;
		font-size: 13px;
		font-weight: 600;
		color: var(--color-surface-700);
	}
	:global([data-mode="dark"]) .editor-title {
		color: var(--color-surface-200);
	}
	/* No pill row (STYLE-GUIDE §6.5): these are PanelTabStrip's tabs — 40px,
	   16px icon and 13px label, the selected one underlined in primary — so a
	   person moving between a panel's tabs and these sees one idiom. Not the
	   component itself: that one owns a tablist and a roving tabindex for a
	   model this toolbar does not have. */
	.editor-tablist {
		display: flex;
		margin-inline-start: 0.4rem;
	}
	.editor-tab {
		display: flex;
		align-items: center;
		gap: 0.5rem;
		block-size: 40px;
		padding-inline: 0.75rem;
		font-size: 13px;
		font-weight: 500;
		color: var(--color-surface-600);
		transition:
			box-shadow 120ms ease,
			color 120ms ease;
	}
	:global([data-mode="dark"]) .editor-tab {
		color: var(--color-surface-400);
	}
	.editor-tab:hover,
	.editor-tab.active {
		color: var(--color-surface-950);
	}
	:global([data-mode="dark"]) .editor-tab:hover,
	:global([data-mode="dark"]) .editor-tab.active {
		color: var(--color-surface-50);
	}
	.editor-tab.active {
		box-shadow: inset 0 -2px 0 var(--color-primary-500);
	}
	/* Same 1rem gutter as the tabs row above, so the palette and the Screen
	   picker start on the Layout title's line rather than 6px inside it. */
	.editor-panel {
		display: flex;
		flex-wrap: wrap;
		align-items: center;
		gap: 0.5rem 0.9rem;
		padding-block: 0.5rem;
		padding-inline: 1rem;
	}
	/* Style tab: the whole panel is one line pointing at the widgets themselves,
	   which is where the controls are. */
	.pack-hint {
		inline-size: 100%;
		font-size: 12px;
		line-height: 1.45;
		color: var(--color-surface-500);
	}
	/* Widgets tip + Advanced note + row. */
	.palette-tip,
	.advanced-note {
		font-size: 12px;
		color: var(--color-surface-500);
	}
	.presets-row {
		display: flex;
		align-items: center;
		gap: 0.5rem;
		flex-wrap: wrap;
	}

	/* ── the Start from pane's head (brief 4) ───────────────────────────
	   One line: where the layout started from, the verbs that replace it,
	   and Save as new layout set off by a hairline. It wraps rather than
	   scrolls: the band's height is measured and reserved above the page. */
	.sf-head {
		display: flex;
		flex-wrap: wrap;
		align-items: center;
		gap: 0.4rem 0.6rem;
		inline-size: 100%;
	}
	.sf-status {
		margin: 0;
		font-size: 13px;
		color: var(--color-surface-700);
	}
	:global([data-mode="dark"]) .sf-status {
		color: var(--color-surface-300);
	}
	.sf-status strong {
		font-weight: 600;
		color: var(--color-surface-950);
	}
	:global([data-mode="dark"]) .sf-status strong {
		color: var(--color-surface-50);
	}
	.sf-verbs {
		display: flex;
		flex-wrap: wrap;
		gap: 0.4rem;
	}
	.sf-rule {
		inline-size: 1px;
		block-size: 1.5rem;
		background: color-mix(in oklab, var(--color-surface-400) 45%, transparent);
	}
	/* The Updated offer: a tonal line (STYLE-GUIDE §2.4, never filled), the
	   chip, the sentence, and the one button that re-copies the source. */
	.sf-updated {
		display: flex;
		flex-wrap: wrap;
		align-items: center;
		gap: 0.4rem 0.6rem;
		inline-size: 100%;
		padding: 0.35rem 0.5rem;
		border-radius: 0.5rem;
		background: color-mix(in oklab, var(--color-primary-500) 10%, transparent);
	}
	.sf-updated-text {
		font-size: 13px;
		color: var(--color-surface-800);
	}
	:global([data-mode="dark"]) .sf-updated-text {
		color: var(--color-surface-200);
	}
	/* The chip: `preset-tonal-primary`'s recipe, spelled out because this
	   sheet is scoped. */
	.sf-chip {
		display: inline-flex;
		align-items: center;
		padding: 0.05rem 0.4rem;
		border-radius: 999px;
		font-size: 11px;
		font-weight: 600;
		line-height: 1.5;
		background: color-mix(in oklab, var(--color-primary-500) 22%, transparent);
		color: var(--color-primary-800);
	}
	:global([data-mode="dark"]) .sf-chip {
		color: var(--color-primary-200);
	}
	/* The groups sit side by side, each a muted label over its cards. */
	.sf-groups {
		display: flex;
		flex-wrap: wrap;
		align-items: flex-start;
		gap: 0.5rem 1.25rem;
		inline-size: 100%;
	}
	.sf-group {
		display: flex;
		flex-direction: column;
		gap: 0.3rem;
	}
	.sf-group-label {
		margin: 0;
		font-size: 12px;
		font-weight: 500;
		color: var(--color-surface-600);
	}
	:global([data-mode="dark"]) .sf-group-label {
		color: var(--color-surface-400);
	}
	.tab-dot {
		inline-size: 6px;
		block-size: 6px;
		border-radius: 999px;
		background: var(--color-primary-500);
		align-self: flex-start;
		margin-block-start: 0.7rem;
	}

	/* ── preset cards + their pictures ──────────────────────────────── */
	/* The card and its manage row are one column: the card stays the apply
	   control it always was (a button, which is why the actions cannot live
	   inside it), and rename/delete sit underneath. */
	.preset-item {
		display: flex;
		flex-direction: column;
		align-items: stretch;
		gap: 0.2rem;
		/* The row centres its children, and the built-in card is shorter than a
		   card carrying a manage row — top-align so every picture still lines
		   up with every other. */
		align-self: flex-start;
	}
	/* The card's `⋯` menu trigger, centred under it (brief 6b). */
	.preset-actions {
		display: flex;
		justify-content: center;
		align-self: center;
	}
	/* The card whose delete is being asked about, so the dialog and the menu
	   it came from are visibly the same thing. */
	.preset-actions.armed {
		border-radius: 0.35rem;
		background: color-mix(in oklab, var(--color-error-500) 20%, transparent);
	}
	/* The new-session layout's star: the Updated chip's recipe in the other
	   corner, so the two never cover each other. */
	.preset-star {
		position: absolute;
		inset-block-start: 0.2rem;
		inset-inline-start: 0.2rem;
		display: inline-flex;
		align-items: center;
		justify-content: center;
		inline-size: 1.1rem;
		block-size: 1.1rem;
		border-radius: 999px;
		background: var(--color-surface-50);
		box-shadow: inset 0 0 0 1px var(--color-primary-500);
		color: var(--color-primary-700);
	}
	.preset-star :global(svg) {
		fill: currentColor;
	}
	:global([data-mode="dark"]) .preset-star {
		background: var(--color-surface-950);
		color: var(--color-primary-300);
	}
	/* Both classes on purpose: `.preset-input`'s own width is declared further
	   down this sheet, so matching its specificity would lose on source order. */
	.preset-input.preset-rename {
		width: 6.5rem;
	}
	.preset-card {
		display: flex;
		flex-direction: column;
		align-items: stretch;
		gap: 0.25rem;
		padding: 0.3rem;
		border-radius: 0.5rem;
		border: 1px solid
			color-mix(in oklab, var(--color-surface-400) 45%, transparent);
		background: color-mix(
			in oklab,
			var(--color-surface-200) 60%,
			transparent
		);
	}
	/* Dark: a step above the band's ground, so the name keeps its contrast
	   (the light card left a pale name on a pale ground). */
	:global([data-mode="dark"]) .preset-card {
		border-color: color-mix(in oklab, var(--color-surface-600) 55%, transparent);
		background: color-mix(in oklab, var(--color-surface-800) 70%, transparent);
	}
	.preset-card:hover {
		border-color: var(--color-primary-500);
	}
	/* The card this session started from: the selected card's ring (STYLE-GUIDE
	   §2.4), offset by the band's own ground — never a filled primary. */
	.preset-card.current {
		box-shadow:
			0 0 0 2px var(--color-surface-100),
			0 0 0 4px var(--color-primary-500);
	}
	:global([data-mode="dark"]) .preset-card.current {
		box-shadow:
			0 0 0 2px var(--color-surface-900),
			0 0 0 4px var(--color-primary-500);
	}
	.preset-pic {
		position: relative;
		display: block;
	}
	.preset-updated {
		position: absolute;
		inset-block-start: 0.2rem;
		inset-inline-end: 0.2rem;
		background: var(--color-surface-50);
		box-shadow: inset 0 0 0 1px var(--color-primary-500);
	}
	:global([data-mode="dark"]) .preset-updated {
		background: var(--color-surface-950);
	}
	.preset-name {
		display: block;
		text-align: center;
		font-size: 13px;
		font-weight: 500;
		color: var(--color-surface-700);
		max-width: 6.5rem;
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
	}
	:global([data-mode="dark"]) .preset-name {
		color: var(--color-surface-200);
	}
	.preset-by {
		display: block;
		max-width: 6.5rem;
		margin-block-start: -0.2rem;
		text-align: center;
		font-size: 11px;
		color: var(--color-surface-600);
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
	}
	:global([data-mode="dark"]) .preset-by {
		color: var(--color-surface-400);
	}

	.preset-input {
		padding: 0.28rem 0.5rem;
		border-radius: 0.5rem;
		font-size: 14px;
		width: 10rem;
		border: 1px solid
			color-mix(in oklab, var(--color-surface-400) 45%, transparent);
		background: color-mix(
			in oklab,
			var(--color-surface-100) 80%,
			transparent
		);
		color: var(--color-surface-800);
	}
	:global([data-mode="dark"]) .preset-input {
		background: color-mix(
			in oklab,
			var(--color-surface-800) 70%,
			transparent
		);
		color: var(--color-surface-100);
	}
	.tool-btn:disabled {
		opacity: 0.45;
		cursor: not-allowed;
	}
	.sr-only {
		position: absolute;
		width: 1px;
		height: 1px;
		padding: 0;
		margin: -1px;
		overflow: hidden;
		clip-path: inset(50%);
		white-space: nowrap;
	}
	.tool-btn {
		display: flex;
		align-items: center;
		gap: 0.3rem;
		padding: 0.3rem 0.6rem;
		border-radius: 0.5rem;
		font-size: 14px;
		font-weight: 500;
		background: color-mix(
			in oklab,
			var(--color-surface-200) 80%,
			transparent
		);
		color: var(--color-surface-700);
	}
	:global([data-mode="dark"]) .tool-btn {
		background: color-mix(
			in oklab,
			var(--color-surface-800) 80%,
			transparent
		);
		color: var(--color-surface-300);
	}
	.tool-btn:hover {
		background: color-mix(
			in oklab,
			var(--color-primary-500) 20%,
			transparent
		);
	}
	.tool-btn.primary {
		background: var(--color-primary-500);
		color: var(--color-primary-contrast-500, white);
	}

	.palette {
		display: flex;
		flex-wrap: wrap;
		align-items: center;
		gap: 0.35rem;
		flex: 1 1 auto;
		padding: 0.35rem 0.45rem;
		border-radius: 0.5rem;
		border: 1px dashed
			color-mix(in oklab, var(--color-primary-500) 40%, transparent);
		background: color-mix(
			in oklab,
			var(--color-primary-500) 5%,
			transparent
		);
	}
	.palette-label {
		display: flex;
		align-items: center;
		gap: 0.3rem;
		font-size: 12px;
		font-weight: 400;
		color: var(--color-surface-500);
	}
	.palette.drag-over {
		border-style: solid;
		background: color-mix(
			in oklab,
			var(--color-error-500) 10%,
			transparent
		);
	}
	.palette-tray {
		display: flex;
		flex-wrap: wrap;
		align-items: stretch;
		gap: 0.4rem;
		flex: 1 1 auto;
	}
	/* Toggleable widgets read as square cards, not pills. */
	.widget-card {
		display: flex;
		flex-direction: column;
		align-items: center;
		justify-content: center;
		gap: 0.3rem;
		inline-size: 5.2rem;
		min-block-size: 4rem;
		padding: 0.45rem 0.35rem;
		border-radius: 0.6rem;
		font-size: 13px;
		font-weight: 500;
		text-align: center;
		cursor: grab;
		color: var(--color-surface-700);
		background: var(--color-surface-100);
		border: 1px solid
			color-mix(in oklab, var(--color-surface-300) 70%, transparent);
		transition:
			border-color 120ms ease,
			background 120ms ease,
			transform 120ms ease;
	}
	.widget-card:hover {
		transform: translateY(-1px);
		border-color: color-mix(
			in oklab,
			var(--color-primary-500) 45%,
			transparent
		);
	}
	.widget-card:disabled {
		cursor: not-allowed;
		opacity: 0.55;
		transform: none;
	}
	/* How many are placed: a second, quieter line under the name. */
	.widget-card-count {
		font-size: 11px;
		font-weight: 400;
		color: var(--color-surface-600);
	}
	:global([data-mode="dark"]) .widget-card-count {
		color: var(--color-surface-400);
	}
	.widget-card-label {
		inline-size: 100%;
		overflow: hidden;
		text-overflow: ellipsis;
		display: -webkit-box;
		-webkit-line-clamp: 2;
		line-clamp: 2;
		-webkit-box-orient: vertical;
		line-height: 1.15;
	}
	:global([data-mode="dark"]) .widget-card {
		color: var(--color-surface-200);
		background: var(--color-surface-900);
		border-color: color-mix(
			in oklab,
			var(--color-surface-700) 70%,
			transparent
		);
	}
	.widget-card.armed {
		border-color: var(--color-primary-500);
		background: color-mix(
			in oklab,
			var(--color-primary-500) 18%,
			transparent
		);
	}
	.palette-hint {
		font-size: 12px;
		color: var(--color-surface-500);
	}
	.palette-hint {
		color: var(--color-primary-600);
		font-weight: 500;
	}

	/* ── Move tab: the screen-size simulator's width picker ──────────────── */
	.move-sim {
		display: flex;
		align-items: center;
		gap: 0.4rem;
		flex: 0 0 auto;
	}
	.move-sim-label {
		display: flex;
		align-items: center;
		gap: 0.3rem;
		font-size: 12px;
		font-weight: 400;
		color: var(--color-surface-600);
	}
	:global([data-mode="dark"]) .move-sim-label {
		color: var(--color-surface-300);
	}
	/* Wraps rather than clips: `overflow: hidden` is here for the rounded
	   corners, and with six presets (Actual + five widths) a narrow editor
	   toolbar would otherwise hide the widest one — the one preset you cannot
	   reach any other way. */
	.move-sim-seg {
		display: flex;
		flex-wrap: wrap;
		border-radius: 0.45rem;
		overflow: hidden;
		border: 1px solid
			color-mix(in oklab, var(--color-surface-400) 45%, transparent);
	}
	.move-sim-btn {
		display: flex;
		align-items: center;
		gap: 0.25rem;
		padding: 0.25rem 0.55rem;
		font-size: 13px;
		font-weight: 500;
		color: var(--color-surface-600);
		background: transparent;
		border: 0;
		border-inline-start: 1px solid
			color-mix(in oklab, var(--color-surface-400) 30%, transparent);
		cursor: pointer;
		white-space: nowrap;
	}
	.move-sim-btn:first-child {
		border-inline-start: 0;
	}
	.move-sim-btn:hover {
		background: color-mix(
			in oklab,
			var(--color-primary-500) 10%,
			transparent
		);
	}
	.move-sim-btn.active {
		color: var(--color-surface-50);
		background: var(--color-primary-500);
	}
	.move-sim-px {
		font-size: 12px;
		font-weight: 400;
		opacity: 0.75;
		font-variant-numeric: tabular-nums;
	}
	:global([data-mode="dark"]) .move-sim-btn {
		color: var(--color-surface-300);
	}
	:global([data-mode="dark"]) .move-sim-btn.active {
		color: var(--color-surface-50);
	}
	/* The Rails toggle sits beside the width presets and is a lens like them,
	   so it wears the same button — with its icon on the leading edge. */
	.move-sim-rails {
		display: inline-flex;
		align-items: center;
		gap: 0.25rem;
		margin-inline-start: 0.35rem;
	}
</style>
