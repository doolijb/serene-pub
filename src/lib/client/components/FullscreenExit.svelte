<script lang="ts">
	/**
	 * The full screen corner control (SHAPES L1): the way out, drawn where the
	 * Jump pill sits (the pill is not rendered in full screen). Awake it is a
	 * small cluster, "Exit full screen" + Esc and a ⋯ menu; after 2 s with no
	 * pointer, no focus and the menu closed it slides up until a 6 px edge is
	 * left, and returns on hover, touch or focus.
	 */
	import { onMount } from "svelte"
	import * as Icons from "@lucide/svelte"
	import RowMenu, {
		type RowMenuEntries
	} from "$lib/client/components/menus/RowMenu.svelte"

	interface Props {
		rewind: SessionHeaderRewind | null
		sessionName: string | null
		notice: string | null
		onExit: () => void
		/** Absent with advanced controls off: no Customize layout entry. */
		onLayout?: () => void
		onDisplay: () => void
		onNoticeShown: () => void
	}

	let {
		rewind,
		sessionName,
		notice,
		onExit,
		onLayout,
		onDisplay,
		onNoticeShown
	}: Props = $props()

	const IDLE_MS = 2000
	const NOTICE_MS = 6000

	let pointerOver = $state(false)
	let focusWithin = $state(false)
	let menuOpen = $state(false)
	let idle = $state(false)
	let canDisplay = $state(false)

	const asleep = $derived(
		idle && !pointerOver && !focusWithin && !menuOpen && notice === null
	)

	// Sleep timer: restarts whenever something keeps the control awake.
	$effect(() => {
		const holding = pointerOver || focusWithin || menuOpen || notice !== null
		if (holding) {
			idle = false
			return
		}
		const t = setTimeout(() => (idle = true), IDLE_MS)
		return () => clearTimeout(t)
	})

	// The notice keeps the control awake, then hands over to the 2 s rule.
	$effect(() => {
		if (notice === null) return
		const t = setTimeout(() => onNoticeShown(), NOTICE_MS)
		return () => clearTimeout(t)
	})

	function syncDisplay() {
		canDisplay =
			typeof document !== "undefined" &&
			document.fullscreenEnabled === true &&
			!document.fullscreenElement
	}
	onMount(() => {
		syncDisplay()
		document.addEventListener("fullscreenchange", syncDisplay)
		return () => document.removeEventListener("fullscreenchange", syncDisplay)
	})

	const backTitle = $derived(
		rewind?.back.reason
			? `Back one turn — ${rewind.back.reason}`
			: rewind?.back.takes
				? `Back: ${rewind.back.takes}`
				: "Back one turn"
	)
	const forwardTitle = $derived(
		rewind?.forward.reason
			? `Forward one turn — ${rewind.forward.reason}`
			: rewind?.aheadText
				? `Forward one turn (${rewind.aheadText})`
				: "Forward one turn"
	)
	const regenerateTitle = $derived(
		rewind?.regenerate?.reason
			? `Regenerate the last turn — ${rewind.regenerate.reason}`
			: "Regenerate the last turn"
	)

	const items = $derived<RowMenuEntries>([
		rewind && {
			label: "Back one turn",
			icon: Icons.Undo2,
			disabled: rewind.back.disabled,
			title: backTitle,
			onSelect: () => rewind.goBack()
		},
		rewind && {
			label: "Forward one turn",
			icon: Icons.Redo2,
			disabled: rewind.forward.disabled,
			title: forwardTitle,
			onSelect: () => rewind.goForward()
		},
		rewind?.regenerate && {
			label: "Regenerate the last turn",
			icon: Icons.RefreshCw,
			disabled: rewind.regenerate.disabled,
			title: regenerateTitle,
			onSelect: () => rewind.regenerate!.press()
		},
		rewind && { separator: true },
		onLayout && {
			label: "Customize layout",
			icon: Icons.LayoutDashboard,
			onSelect: onLayout
		},
		canDisplay && {
			label: "Use the whole screen",
			icon: Icons.Maximize,
			title: "Hides the browser's own bars too",
			onSelect: onDisplay
		},
		{ label: "Exit full screen", icon: Icons.Minimize, onSelect: onExit }
	])
</script>

<div
	class="fullscreen-exit data-[asleep]:pointer-events-none fixed top-0 right-4 z-[44] flex flex-col items-end"
	data-asleep={asleep ? "" : undefined}
	role="presentation"
	onpointerenter={() => (pointerOver = true)}
	onpointerleave={() => (pointerOver = false)}
	ontouchstart={() => (pointerOver = true)}
	onfocusin={() => (focusWithin = true)}
	onfocusout={(e) => {
		const next = e.relatedTarget as Node | null
		if (!next || !e.currentTarget.contains(next)) focusWithin = false
	}}
>
	<div
		class="fullscreen-exit-body flex flex-col items-end gap-1 pt-2 transition-[transform,opacity] duration-[160ms] motion-reduce:transition-none"
	>
		<div
			class="bg-surface-50-950/90 border-surface-200-800 flex h-[34px] items-center gap-1 rounded-full border pr-1 pl-3 backdrop-blur"
		>
			<button
				type="button"
				class="text-surface-700-300 hover:text-surface-950-50 focus-visible:outline-primary-500 flex items-center gap-2 text-chip focus-visible:outline-2"
				onclick={onExit}
			>
				Exit full screen
				<kbd
					class="bg-surface-200-800 text-surface-800-200 rounded-md px-1.5 py-0.5 font-mono text-meta"
				>
					Esc
				</kbd>
			</button>
			<RowMenu
				label="Session"
				triggerLabel="More for {sessionName ?? 'this session'}"
				triggerTitle="More"
				triggerClass="btn-icon hover:preset-tonal focus-visible:preset-tonal text-foreground size-7 shrink-0 rounded-full [&>svg]:size-4"
				horizontal
				width={220}
				{items}
				bind:open={menuOpen}
			/>
		</div>
		{#if notice !== null}
			<p role="status" class="text-meta text-surface-700-300">{notice}</p>
		{/if}
	</div>
	<!-- The wake area: the cluster's width by 24px (44px on touch) at the
	     top edge, still there while the cluster is slid away. -->
	<div
		class="pointer-events-auto pointer-coarse:h-11 absolute top-0 right-0 left-0 h-6"
		aria-hidden="true"
		style:z-index="-1"
	></div>
</div>

<style>
	.fullscreen-exit-body {
		transform: translateY(0);
		opacity: 1;
	}
	.fullscreen-exit[data-asleep] .fullscreen-exit-body {
		transform: translateY(calc(-100% + 6px));
		opacity: 0.6;
	}
</style>
