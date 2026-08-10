<script lang="ts">
	import type { Snippet } from "svelte"
	import * as Icons from "@lucide/svelte"

	/**
	 * The panel chrome: title on the left, fullscreen/close on the right.
	 * Previously inlined three times in Layout.svelte (left, right, mobile),
	 * which had drifted apart — the mobile copy used a <span> instead of a
	 * heading and had no id, leaving its dialog's aria-labelledby pointing at
	 * an element that was never rendered.
	 */
	interface Props {
		title: string
		/** Emitted as the heading's id so the panel's aria-labelledby
		    resolves. Load-bearing: Layout's regions reference
		    "left-panel-title"/"right-panel-title", and the mobile dialog
		    references "mobile-panel-title". */
		titleId?: string
		/** Panel titles fall back to the raw nav key (eg. "koboldcpp") when a
		    nav entry has no explicit title, so this stays on by default.
		    text-transform:capitalize only uppercases first letters, so
		    "KoboldCPP Manager" and "Lorebooks+" survive it unchanged. */
		capitalizeTitle?: boolean
		onClose: () => void
		/** Accessible name for the close button, eg. "Close Chats panel". */
		closeLabel: string
		/** Omit onToggleFullscreen to hide that button entirely — this is how
		    the mobile dialog keeps its button-less chrome. */
		isFullscreen?: boolean
		onToggleFullscreen?: () => void
		/** Extra chrome controls, rendered before fullscreen/close. */
		actions?: Snippet
	}

	let {
		title,
		titleId,
		capitalizeTitle = true,
		onClose,
		closeLabel,
		isFullscreen = false,
		onToggleFullscreen,
		actions
	}: Props = $props()

	// `btn` (not `btn-icon`) because app.css's global :disabled / :active /
	// :focus-visible patches all key off `.btn` — these buttons previously
	// used a `btn-ghost` class that is defined neither in app.css nor by
	// Skeleton, so they resolved to zero CSS and missed the app's standard
	// focus ring. `p-1` keeps the compact chrome look, and an explicit hover
	// preset is needed because .btn's built-in hover is a brightness() filter,
	// which is invisible on a transparent background.
	//
	// NOTE: `btn-ghost` is still used ~22 other places in the app. Do NOT
	// "fix" it by defining it globally without auditing every call site —
	// most of them have hand-added compensating classes (`rounded p-0.5`,
	// `absolute inset-y-0 …`) that real padding would break.
	const chromeBtn = "btn hover:preset-tonal-surface shrink-0 p-1"
</script>

<div class="flex min-w-0 items-center justify-between gap-2 p-4">
	<h2
		id={titleId}
		data-panel-title
		class="text-foreground min-w-0 flex-1 truncate text-lg font-semibold {capitalizeTitle
			? 'capitalize'
			: ''}"
	>
		{title}
	</h2>
	<div class="flex shrink-0 items-center gap-1">
		{@render actions?.()}
		{#if onToggleFullscreen}
			<button
				type="button"
				class={chromeBtn}
				onclick={onToggleFullscreen}
				aria-label={isFullscreen ? "Exit fullscreen" : "Fullscreen"}
				title={isFullscreen ? "Exit fullscreen" : "Fullscreen"}
			>
				{#if isFullscreen}
					<Icons.Minimize2
						class="text-foreground h-5 w-5"
						aria-hidden="true"
					/>
				{:else}
					<Icons.Maximize2
						class="text-foreground h-5 w-5"
						aria-hidden="true"
					/>
				{/if}
			</button>
		{/if}
		<button
			type="button"
			class={chromeBtn}
			onclick={onClose}
			aria-label={closeLabel}
			title={closeLabel}
		>
			<Icons.X class="text-foreground h-5 w-5" aria-hidden="true" />
		</button>
	</div>
</div>
