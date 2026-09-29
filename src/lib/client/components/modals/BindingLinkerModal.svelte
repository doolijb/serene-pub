<script lang="ts">
	import { Dialog, Portal } from "@skeletonlabs/skeleton-svelte"
	import * as Icons from "@lucide/svelte"
	import { untrack } from "svelte"

	type OrphanedBinding = Sockets.BindingCheck.Result.OrphanedBinding

	/**
	 * A review of the book's cast members with no card behind them, one at a
	 * time. There is nothing here to link them TO: the binding check mints a
	 * member for every session character before it reports, so no session
	 * character is ever left without one (finding #140 — the old picker read a
	 * list that was always empty). Linking a card is the Cast board's job.
	 */
	interface Props {
		open: boolean
		orphanedBindings: OrphanedBinding[]
		onOpenChange: (e: { open: boolean }) => void
		onDone?: () => void
	}

	let {
		open = $bindable(),
		orphanedBindings = [],
		onOpenChange,
		onDone
	}: Props = $props()

	type Status = "pending" | "skipped"
	let statuses = $state<Record<number, Status>>(
		untrack(() =>
			Object.fromEntries(
				orphanedBindings.map((b) => [b.id, "pending" as Status])
			)
		)
	)

	let currentIndex = $state(0)
	let currentBinding = $derived(orphanedBindings[currentIndex] ?? null)

	function advance() {
		const nextIdx = orphanedBindings.findIndex(
			(b, i) => i > currentIndex && statuses[b.id] === "pending"
		)
		if (nextIdx !== -1) {
			currentIndex = nextIdx
		} else {
			onOpenChange({ open: false })
			onDone?.()
		}
	}

	function skip(bindingId: number) {
		statuses[bindingId] = "skipped"
		advance()
	}
</script>

<Dialog {open} {onOpenChange}>
	<Portal>
		<Dialog.Backdrop
			class="bg-surface-50-950/50 fixed inset-0 z-50 backdrop-blur-sm"
		/>
		<Dialog.Positioner
			class="fixed inset-0 z-50 flex items-center justify-center p-4"
		>
			<Dialog.Content
				class="card bg-surface-100-900 relative max-h-[95dvh] w-[min(95vw,576px)] space-y-5 overflow-hidden p-6 shadow-xl"
			>
				<header class="flex items-center justify-between">
					<h2 class="text-lg font-semibold">
						Cast member with no card
					</h2>
					<button
						aria-label="Close"
						class="btn btn-sm preset-tonal"
						onclick={() => onOpenChange({ open: false })}
					>
						<Icons.X size={18} />
					</button>
				</header>

				{#if currentBinding}
					<p class="text-surface-600-400 text-sm">
						The cast member tagged <code class="code">
							{currentBinding.binding}
						</code>
						has no character card linked. You can link one from the
						lorebook's Cast.
					</p>

					<button
						class="preset-outlined-surface-400-600 btn w-full justify-start gap-3"
						onclick={() => skip(currentBinding.id)}
					>
						<Icons.SkipForward size={18} />
						<span>Skip — leave this member unlinked for now</span>
					</button>

					<div
						class="text-surface-700-300 border-t pt-2 text-right text-xs"
					>
						Member {currentIndex + 1} of {orphanedBindings.length}
					</div>
				{/if}
			</Dialog.Content>
		</Dialog.Positioner>
	</Portal>
</Dialog>
