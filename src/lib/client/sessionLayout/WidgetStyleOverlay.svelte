<script lang="ts">
	/**
	 * The way into one widget's settings on the layout editor's Settings tab
	 * (PLAN 25; ruled 2026-09-09, and 2026-09-27 for the modal).
	 *
	 * While the tab is open every widget wears this overlay, invisible until
	 * you hover or focus it: a scrim with a "Settings" button, which opens
	 * the widget's settings and style in the app-level modal
	 * (`WidgetSettingsModal`), and — while the layout editor can make one — a
	 * "Duplicate" button beside it (brief 7b; QD): a copy of this widget
	 * beside it, its settings and style copied (`./widgetDuplicate`). The settings themselves are never drawn in here
	 * any more — a card inside the widget's box was clipped by any cell smaller
	 * than it, and the owner ruled it into a modal.
	 *
	 * ## Where this lives, and why
	 *
	 * Inside `WidgetHost`, which is the ONE place that knows a REMOTE widget is
	 * skinnable at all. Its wrapper is `display: contents` and so has no box of
	 * its own, so the overlay is positioned against the panel card —
	 * `Panel`'s `<section>` — which is the box a person actually points at.
	 *
	 * A FRAME widget mounts it from `Panel`'s frame branch instead, against the
	 * same card (`mount="frame"`), which keeps the button OUTSIDE the iframe:
	 * a frame skin lands inside the frame's document and so cannot restyle — or
	 * hide — the way to take it back off.
	 *
	 * ## While the modal is open
	 *
	 * The modal arms this widget, which keeps the overlay showing; while its
	 * style editor is previewing a draft here, the scrim clears and a ring is
	 * left so it stays obvious WHICH widget is being styled.
	 */
	import * as Icons from "@lucide/svelte"
	import {
		overlayVisible,
		widgetStylesStore
	} from "$lib/client/stores/widgetStyles.svelte"
	import {
		openWidgetSettings,
		widgetSettingsTitle
	} from "./widgetSettingsModal.svelte"
	import { widgetDuplicator } from "./widgetDuplicate.svelte"

	interface Props {
		/** The widget being configured — the `widget_styles.widgetSlug` too. */
		widgetId: string
		/** What to call it on screen (the panel's own title). */
		label: string
		/**
		 * Which kind of widget this overlay is on — handed to the modal, whose
		 * style editor words the reach of the CSS differently for a frame.
		 */
		mount?: "remote" | "frame"
	}

	let { widgetId, label, mount = "remote" }: Props = $props()

	const styles = widgetStylesStore()
	const duplicator = widgetDuplicator()
	/** At its widget's cap, why no Duplicate (brief 7b review); else null. */
	let dupRefusal = $derived(
		duplicator.available ? duplicator.refusal(widgetId) : null
	)

	let rootEl = $state<HTMLDivElement | null>(null)
	let hovered = $state(false)
	let focused = $state(false)
	let armed = $derived(styles.armed === widgetId)
	let previewing = $derived(styles.preview?.widgetId === widgetId)

	let visible = $derived(
		overlayVisible({
			styleMode: styles.styleMode,
			hovered,
			focused,
			armed
		})
	)

	/** Focus moving WITHIN the overlay is not focus leaving it. */
	function onFocusOut(e: FocusEvent) {
		const to = e.relatedTarget
		if (to instanceof Node && rootEl?.contains(to)) return
		focused = false
	}

	function open(e: MouseEvent) {
		openWidgetSettings(
			{ widgetId, label, mount },
			e.currentTarget as HTMLElement
		)
	}
</script>

<!-- Nothing at all outside the editor's Settings tab: no hidden overlay to
     swallow a widget's own hover affordances in the live view. -->
{#if styles.styleMode}
	<div
		bind:this={rootEl}
		class="ws-overlay"
		class:visible
		class:editing={previewing}
		role="group"
		aria-label={widgetSettingsTitle(label)}
		onpointerenter={() => (hovered = true)}
		onpointerleave={() => (hovered = false)}
		onfocusin={() => (focused = true)}
		onfocusout={onFocusOut}
	>
		<div class="ws-actions">
			<button
				type="button"
				class="ws-open"
				aria-haspopup="dialog"
				aria-label="Open {widgetSettingsTitle(label)}"
				title={widgetSettingsTitle(label)}
				onclick={open}
			>
				<Icons.Settings size={15} aria-hidden="true" />
				<span class="ws-open-label">Settings</span>
			</button>
			{#if dupRefusal}
				<!-- At its widget's cap (a plugin's `maxInstances`), the reason
				     where Duplicate would be — as its card and the Add menu say. -->
				<span class="ws-open ws-nocopy" role="note">
					<Icons.Copy size={15} aria-hidden="true" />
					<span class="ws-open-label">{dupRefusal}</span>
				</span>
			{:else if duplicator.available}
				<button
					type="button"
					class="ws-open"
					aria-label="Duplicate {label}"
					title="Duplicate {label}"
					onclick={() => duplicator.duplicate(widgetId)}
				>
					<Icons.Copy size={15} aria-hidden="true" />
					<span class="ws-open-label">Duplicate</span>
				</button>
			{/if}
		</div>
	</div>
{/if}

<style>
	/* Positioned against the panel card (Panel's `<section>` is `relative`),
	   because WidgetHost's own wrapper is `display: contents` and has no box.
	   Above the widget's content, below the editor toolbar and any portal. */
	.ws-overlay {
		position: absolute;
		inset: 0;
		z-index: 6;
		display: grid;
		place-items: center;
		padding: 0.4rem;
		border-radius: inherit;
		background: color-mix(
			in oklab,
			var(--color-surface-50) 70%,
			transparent
		);
		opacity: 0;
		transition: opacity 120ms ease;
	}
	:global([data-mode="dark"]) .ws-overlay {
		background: color-mix(
			in oklab,
			var(--color-surface-950) 70%,
			transparent
		);
	}
	.ws-overlay.visible {
		opacity: 1;
	}
	/* While the modal's style editor previews a draft here, the scrim and the
	   button get out of the way: the point of live-apply is seeing the widget
	   change. A ring is left so it stays obvious WHICH widget is being styled. */
	.ws-overlay.editing {
		background: transparent;
		outline: 2px solid var(--color-primary-500);
		outline-offset: -2px;
	}
	.ws-overlay.editing .ws-open {
		visibility: hidden;
	}
	@media (prefers-reduced-motion: reduce) {
		.ws-overlay {
			transition: none;
		}
	}
	/* Settings, then Duplicate; they wrap under each other in a narrow cell. */
	.ws-actions {
		display: flex;
		flex-wrap: wrap;
		justify-content: center;
		gap: 0.4rem;
		max-inline-size: 100%;
	}
	.ws-open {
		display: inline-flex;
		align-items: center;
		gap: 0.35rem;
		max-inline-size: 100%;
		padding: 0.4rem 0.8rem;
		border-radius: 0.5rem;
		border: 1px solid
			color-mix(in oklab, var(--color-surface-500) 30%, transparent);
		font-size: 14px;
		font-weight: 500;
		background: var(--color-surface-50);
		color: var(--color-surface-800);
		box-shadow: 0 6px 18px rgb(0 0 0 / 0.16);
	}
	:global([data-mode="dark"]) .ws-open {
		background: var(--color-surface-900);
		color: var(--color-surface-100);
	}
	.ws-open:hover {
		background: color-mix(
			in oklab,
			var(--color-primary-500) 20%,
			var(--color-surface-50)
		);
	}
	:global([data-mode="dark"]) .ws-open:hover {
		background: color-mix(
			in oklab,
			var(--color-primary-500) 20%,
			var(--color-surface-900)
		);
	}
	.ws-open:focus-visible {
		outline: 2px solid var(--color-primary-500);
		outline-offset: 2px;
	}
	.ws-open-label {
		white-space: nowrap;
	}
	/* A note, not a control: no lift, no hover, a dashed edge. */
	.ws-nocopy {
		cursor: default;
		box-shadow: none;
		border-style: dashed;
	}
	.ws-nocopy:hover,
	:global([data-mode="dark"]) .ws-nocopy:hover {
		background: var(--color-surface-50);
	}
	:global([data-mode="dark"]) .ws-nocopy:hover {
		background: var(--color-surface-900);
	}
</style>
