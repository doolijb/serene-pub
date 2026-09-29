<script lang="ts">
	/**
	 * One widget's settings and style, in an app-level modal (owner ruling
	 * 2026-09-27).
	 *
	 * A card drawn inside the widget's own box would be clipped by a small
	 * cell or a side column. The modal is portalled to the body, so no
	 * widget box, zone or flyout can clip it, and it is the ONE place a
	 * widget's settings open from — every entry point calls
	 * `openWidgetSettings`, and `SessionLayout` mounts this once.
	 *
	 * Settings apply as they change (`WidgetSettingsPanel` writes on
	 * `change`), so the modal has Close, never Save. The style editor inside it
	 * keeps its own Save and Cancel, and while it is open the modal steps aside
	 * — no scrim, docked to the edge AWAY from the widget (`editorDock`) —
	 * because live-apply is only worth anything if the widget can be seen
	 * changing.
	 *
	 * Escape backs out of the style editor first, then closes the modal; focus
	 * goes back to the control that opened it.
	 */
	import { onDestroy, tick, untrack } from "svelte"
	import * as Icons from "@lucide/svelte"
	import { Dialog, Portal } from "@skeletonlabs/skeleton-svelte"
	import WidgetSettingsPanel from "./WidgetSettingsPanel.svelte"
	import WidgetStyleSection from "./WidgetStyleSection.svelte"
	import { widgetStylesStore } from "$lib/client/stores/widgetStyles.svelte"
	import {
		closeWidgetSettings,
		widgetSettingsModal,
		widgetSettingsReturnTarget,
		widgetSettingsTitle
	} from "./widgetSettingsModal.svelte"

	const modal = widgetSettingsModal()
	const styles = widgetStylesStore()

	let target = $derived(modal.current)
	let open = $derived(target !== null)
	let editing = $state(false)
	/**
	 * Which edge the style editor docks to: the one away from the widget, read
	 * from where the control that opened the modal sits. A widget on the right
	 * half gets the editor on the left, and the other way round.
	 */
	let editorDock = $derived.by((): "start" | "end" => {
		if (!editing) return "end"
		const from = widgetSettingsReturnTarget()
		if (!from || typeof window === "undefined") return "end"
		const r = from.getBoundingClientRect()
		return r.left + r.width / 2 > window.innerWidth / 2 ? "start" : "end"
	})
	let section = $state<{ cancelEditor: () => boolean } | null>(null)

	/**
	 * The open widget is ARMED for as long as the modal is open: that keeps its
	 * in-box ring showing while the style editor previews on it, and releasing
	 * the arm on close is what drops any draft preview and save hold with it.
	 */
	$effect(() => {
		const id = target?.widgetId
		if (!id) return
		// Untracked: arming reads the pin it writes, and a re-run here would
		// disarm — dropping the draft preview — on every write.
		untrack(() => styles.arm(id))
		return () =>
			untrack(() => {
				styles.disarm(id)
				editing = false
			})
	})

	function close() {
		const back = closeWidgetSettings()
		// `finalFocusEl` is the dialog's own route back; this is the fallback
		// for when the dialog has already let focus go to the body.
		void tick().then(() => {
			if (back && document.activeElement !== back) back.focus()
		})
	}

	// Module state outlives this component: leaving the session with the modal
	// open must not open it again on the next session's page.
	onDestroy(() => {
		closeWidgetSettings()
	})

	function onEscapeKeyDown(e: KeyboardEvent) {
		// The editor answers Escape first — Cancel, putting the saved style back.
		if (section?.cancelEditor()) e.preventDefault()
	}
</script>

<Dialog
	{open}
	onOpenChange={(e) => {
		if (!e.open) close()
	}}
	{onEscapeKeyDown}
	finalFocusEl={() => widgetSettingsReturnTarget()}
>
	<Portal>
		<Dialog.Backdrop
			class="wsm-backdrop fixed inset-0 z-50 {editing
				? 'bg-transparent'
				: 'bg-surface-50-950/50'}"
		/>
		<Dialog.Positioner
			class="wsm-positioner fixed inset-0 z-50 flex items-center {editing
				? editorDock === 'start'
					? 'justify-start'
					: 'justify-end'
				: 'justify-center'}"
		>
			<Dialog.Content
				class="wsm-content card bg-surface-100-900 shadow-xl"
				data-editing={editing ? "" : undefined}
			>
				{#if target}
					<header class="wsm-head">
						<Icons.SlidersHorizontal size={16} aria-hidden="true" />
						<Dialog.Title class="wsm-title">
							{widgetSettingsTitle(target.label)}
						</Dialog.Title>
						<Dialog.CloseTrigger
							class="btn-icon btn-icon-sm hover:preset-tonal"
							aria-label="Close"
						>
							<Icons.X size={16} />
						</Dialog.CloseTrigger>
					</header>
					<div class="wsm-body">
						{#key target.widgetId}
							{#if !editing}
								<WidgetSettingsPanel
									widgetId={target.widgetId}
								/>
							{/if}
							<WidgetStyleSection
								bind:this={section}
								bind:editing
								widgetId={target.widgetId}
								label={target.label}
								mount={target.mount}
							/>
						{/key}
					</div>
					{#if !editing}
						<footer class="wsm-foot">
							<Dialog.CloseTrigger
								class="btn preset-filled-surface-500"
							>
								Close
							</Dialog.CloseTrigger>
						</footer>
					{/if}
				{/if}
			</Dialog.Content>
		</Dialog.Positioner>
	</Portal>
</Dialog>

<style>
	/* A column of head / scrolling body / foot, never taller than the window:
	   a widget with many settings (Messages has ten) scrolls INSIDE the modal. */
	:global(.wsm-positioner) {
		padding: 1rem;
	}
	:global(.wsm-content) {
		display: flex;
		flex-direction: column;
		inline-size: min(100%, 32rem);
		max-block-size: calc(100dvh - 2rem);
		overflow: hidden;
	}
	/* The style editor wants room for a stylesheet. */
	:global(.wsm-content[data-editing]) {
		inline-size: min(100%, 44rem);
	}
	.wsm-head {
		display: flex;
		align-items: center;
		gap: 0.5rem;
		padding: 0.9rem 1rem 0.6rem;
	}
	:global(.wsm-title) {
		flex: 1;
		min-inline-size: 0;
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
		font-size: 1.125rem;
		font-weight: 600;
	}
	.wsm-body {
		display: flex;
		flex-direction: column;
		gap: 0.75rem;
		min-block-size: 0;
		overflow-y: auto;
		overscroll-behavior: contain;
		padding: 0.25rem 1rem 1rem;
	}
	.wsm-foot {
		display: flex;
		justify-content: flex-end;
		gap: 0.5rem;
		padding: 0.6rem 1rem 0.9rem;
		border-block-start: 1px solid
			color-mix(in oklab, var(--color-surface-500) 25%, transparent);
	}
	/* Phone width: a full-screen sheet, the way the phone editor's own sheets
	   fill the screen. */
	@media (max-width: 639px) {
		:global(.wsm-positioner) {
			padding: 0;
		}
		:global(.wsm-content),
		:global(.wsm-content[data-editing]) {
			inline-size: 100%;
			block-size: 100dvh;
			max-block-size: 100dvh;
			border-radius: 0;
		}
	}
</style>
