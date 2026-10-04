<script lang="ts">
	/**
	 * Two panes side by side with a **divider** between them that the reader
	 * drags, steps with the arrow keys, or double-clicks to reset.
	 *
	 * The lorebook's list-beside-editor (Entries, Time, Cast) is this. Not
	 * `PanelSplit`: that one is the sidebar views' fixed-list shape, with its
	 * own compact switch and empty column; this is only the desk half, and its
	 * owner decides what compact draws.
	 *
	 * The share is remembered per device under `storageKey` (STYLE-GUIDE
	 * §5.2), and the pixel floors are the grid's, so no drag can squeeze a
	 * pane below `minFirst` / `minSecond`.
	 */
	import * as Icons from "@lucide/svelte"
	import type { Snippet } from "svelte"
	import {
		clampShare,
		loadShare,
		saveShare,
		shareAfterKey,
		shareFromPointer
	} from "./splitShare"

	interface Props {
		/** Where this split's share is remembered on this device. */
		storageKey: string
		/** The first pane's share before anything is remembered, 0–1. */
		defaultShare?: number
		/** The panes' pixel floors. */
		minFirst?: number
		minSecond?: number
		/** What the divider resizes, for its accessible name. */
		label?: string
		/** The id of the first pane, which the divider controls. */
		firstId?: string
		first: Snippet
		second: Snippet
	}

	let {
		storageKey,
		defaultShare = 0.42,
		minFirst = 260,
		minSecond = 320,
		label = "Resize the list and the editor",
		firstId,
		first,
		second
	}: Props = $props()

	/** The divider's own track, which is the gap between the panes. */
	const GUTTER = 16

	// The key never changes while mounted; the share is read once.
	// svelte-ignore state_referenced_locally
	let share = $state(loadShare(storageKey, clampShare(defaultShare)))
	let dragging = $state(false)
	let box: HTMLDivElement | undefined = $state()

	const columns = $derived(
		`minmax(${minFirst}px, ${share}fr) ${GUTTER}px minmax(${minSecond}px, ${1 - share}fr)`
	)

	function commit(next: number) {
		share = clampShare(next)
		saveShare(storageKey, share)
	}

	function onPointerDown(e: PointerEvent) {
		if (e.button !== 0) return
		e.preventDefault()
		;(e.currentTarget as HTMLElement).setPointerCapture?.(e.pointerId)
		dragging = true
	}

	function onPointerMove(e: PointerEvent) {
		if (!dragging || !box) return
		const rect = box.getBoundingClientRect()
		share = shareFromPointer(e.clientX, rect.left, rect.width, GUTTER)
	}

	function onPointerUp(e: PointerEvent) {
		if (!dragging) return
		dragging = false
		;(e.currentTarget as HTMLElement).releasePointerCapture?.(e.pointerId)
		commit(share)
	}

	function onKeydown(e: KeyboardEvent) {
		const next = shareAfterKey(share, e.key, e.shiftKey)
		if (next === null) return
		e.preventDefault()
		commit(next)
	}

	function reset() {
		share = clampShare(defaultShare)
		saveShare(storageKey, null)
	}
</script>

<div
	bind:this={box}
	class="grid min-h-0 flex-1 grid-rows-[minmax(0,1fr)]"
	class:select-none={dragging}
	style="grid-template-columns: {columns};"
	data-lore-split
	data-split-dragging={dragging ? "" : undefined}
>
	<div class="flex min-h-0 min-w-0 flex-col" id={firstId}>
		{@render first()}
	</div>
	<!-- svelte-ignore a11y_no_noninteractive_tabindex -->
	<!-- svelte-ignore a11y_no_noninteractive_element_interactions -->
	<div
		role="separator"
		aria-orientation="vertical"
		aria-label={label}
		aria-controls={firstId}
		aria-valuenow={Math.round(share * 100)}
		aria-valuemin={20}
		aria-valuemax={80}
		aria-valuetext="List {Math.round(share * 100)}%"
		tabindex="0"
		title="Drag to resize · double click to reset"
		class="group relative flex cursor-col-resize touch-none items-center justify-center rounded focus-visible:outline-none"
		data-split-divider
		onpointerdown={onPointerDown}
		onpointermove={onPointerMove}
		onpointerup={onPointerUp}
		onpointercancel={() => (dragging = false)}
		ondblclick={reset}
		onkeydown={onKeydown}
	>
		<!-- The shell edge's look (Layout.svelte): a hairline that shows on
		     hover, focus and drag, and a grip in the middle. -->
		<span
			class="bg-primary-500 absolute inset-y-0 left-1/2 w-0.5 -translate-x-1/2 transition-opacity group-hover:opacity-60 group-focus-visible:opacity-100 {dragging
				? 'opacity-60'
				: 'opacity-0'}"
			aria-hidden="true"
		></span>
		<span
			class="bg-surface-200-800 text-surface-700-300 relative flex h-10 w-4 items-center justify-center rounded-lg transition-opacity group-hover:opacity-100 group-focus-visible:opacity-100 {dragging
				? 'opacity-100'
				: 'opacity-40'}"
			aria-hidden="true"
		>
			<Icons.GripVertical class="size-3.5" />
		</span>
	</div>
	<div class="flex min-h-0 min-w-0 flex-col">
		{@render second()}
	</div>
</div>
