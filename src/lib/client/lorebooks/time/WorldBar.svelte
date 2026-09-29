<script lang="ts">
	import * as Icons from "@lucide/svelte"
	import { Popover, Portal } from "@skeletonlabs/skeleton-svelte"
	import BranchChip from "./BranchChip.svelte"
	import { momentLabel } from "./moment"
	import { worldRosterLine, type Inhabitant } from "./worldRoster"

	/**
	 * Which world you are in, at the top of every book.
	 *
	 * Line and moment were both reachable before — the branch chip beside the
	 * book's name, the moment on a bar at the very bottom — and neither
	 * announced that they are the same question asked twice. **Where am I in
	 * this story?** is one question, so it is one control, and it sits where a
	 * reader looks first rather than in two corners.
	 *
	 * ⚠ It does not replace the moment BAR at the foot of the workspace. That
	 * is the scrubber — a tick per date, drag to move. This is the readout and
	 * the switches. Reading at the top, driving at the bottom.
	 */
	interface Props {
		lorebookId: number
		branches: readonly Sockets.Amendments.Branch[]
		/** The line being read. NULL = main. */
		branchId: number | null
		/** The moment being read, as the route spells it. Absent is now. */
		moment?: string
		/** Everyone the world holds at this moment, on this line. */
		inhabitants: readonly Inhabitant[]
		comparing?: boolean
		onBranch: (branchId: number | undefined) => void
		onMoment: (moment?: string) => void
		onCompare: () => void
		onOpenMember: (castId: number) => void
	}

	let {
		lorebookId,
		branches,
		branchId,
		moment,
		inhabitants,
		comparing = false,
		onBranch,
		onMoment,
		onCompare,
		onOpenMember
	}: Props = $props()

	let rosterOpen = $state(false)

	let lineName = $derived(
		branches.find((b) => b.id === branchId)?.name ?? "main"
	)
	/** Two of someone is the interesting case, so the sentence leads with it. */
	let summary = $derived(worldRosterLine(inhabitants))
</script>

<div
	class="border-border bg-surface-50-950 flex flex-wrap items-center gap-2 rounded-[10px] border px-3 py-2"
	data-lore-worldbar
>
	<Icons.Globe2
		size={14}
		class="text-surface-600-400 shrink-0"
		aria-hidden="true"
	/>

	<BranchChip
		{lorebookId}
		{branches}
		{branchId}
		{moment}
		onSwitch={onBranch}
		{onCompare}
		{comparing}
	/>

	<!-- The moment, said in words rather than as a slider position. -->
	<span class="text-surface-700-300 shrink-0 text-xs">
		{moment ? momentLabel(moment) : "now"}
	</span>
	{#if moment}
		<button
			class="btn btn-sm preset-tonal-surface shrink-0 text-xs"
			type="button"
			onclick={() => onMoment(undefined)}
		>
			Return to now
		</button>
	{/if}

	<span class="flex-1"></span>

	<!-- Who the world holds right here. The count is the hook; the list is
	     what makes two of one person visible at all. -->
	<Popover
		open={rosterOpen}
		onOpenChange={(e) => (rosterOpen = e.open)}
		positioning={{ placement: "bottom-end" }}
	>
		<Popover.Trigger
			class="chip preset-tonal-surface shrink-0 gap-1.5 text-xs"
			title="Everyone this world holds at this moment"
			data-lore-roster-trigger
		>
			<Icons.Users size={13} aria-hidden="true" />
			<span>{summary}</span>
		</Popover.Trigger>
		<Portal>
			<Popover.Positioner class="z-[1000]!">
				<Popover.Content
					class="card bg-surface-100-900 flex max-h-[26rem] w-[min(90vw,360px)] flex-col gap-2 overflow-y-auto p-4 shadow-xl"
					data-lore-roster
				>
					<div class="flex flex-col gap-1">
						<span class="text-sm font-semibold">
							In the world {moment ? momentLabel(moment) : "now"}
						</span>
						<p class="text-surface-700-300 text-xs leading-relaxed">
							On <strong>{lineName}</strong>. Someone who has not
							arrived yet, or who has left, is not here.
						</p>
					</div>

					{#if !inhabitants.length}
						<p class="text-surface-700-300 text-xs leading-relaxed">
							Nobody is in this world yet. Cast members arrive
							from a session on their own.
						</p>
					{/if}

					{#each inhabitants as who (who.key)}
						<button
							class="hover:preset-tonal-surface flex items-center gap-2 rounded-[8px] px-2 py-1.5 text-left"
							type="button"
							onclick={() => {
								rosterOpen = false
								onOpenMember(who.castId)
							}}
						>
							<span
								class="bg-surface-200-800 flex size-7 shrink-0 items-center justify-center rounded-[7px] text-xs"
							>
								{who.initial}
							</span>
							<span class="min-w-0 flex-1">
								<span class="block truncate text-xs">
									{who.name}
								</span>
								{#if who.aspect}
									<span
										class="text-surface-600-400 block truncate text-[11px]"
									>
										{who.aspect}
									</span>
								{/if}
							</span>
							{#if who.alsoHere}
								<!-- Two of them at one moment: the case a single
								     resolved row cannot express. -->
								<span
									class="chip preset-tonal-primary shrink-0 text-[11px]"
								>
									also here
								</span>
							{/if}
						</button>
					{/each}
				</Popover.Content>
			</Popover.Positioner>
		</Portal>
	</Popover>
</div>
