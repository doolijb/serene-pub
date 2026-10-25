<script lang="ts">
	import * as Icons from "@lucide/svelte"
	import { Popover, Portal } from "@skeletonlabs/skeleton-svelte"
	import { momentLabel } from "./moment"
	import { worldRosterLine, type Inhabitant } from "./worldRoster"

	/**
	 * Who the world holds at the moment being read, on the line being read.
	 *
	 * A cast fact, so it stands with the cast rather than on the moment bar:
	 * the count is the hook, and the list is what makes two of one person
	 * visible at all. `inhabitants` comes from `worldRoster`, one row per
	 * appearance.
	 */
	interface Props {
		/** The book's lines, to name the one being read. */
		branches: readonly Sockets.Amendments.Branch[]
		/** The line being read. NULL = main. */
		branchId: number | null
		/** The moment being read, as the route spells it. Absent is now. */
		moment?: string
		/** Everyone the world holds at this moment, on this line. */
		inhabitants: readonly Inhabitant[]
		onOpenMember: (castId: number) => void
		placement?: "bottom-end" | "bottom-start" | "top-start" | "top-end"
	}

	let {
		branches,
		branchId,
		moment,
		inhabitants,
		onOpenMember,
		placement = "bottom-end"
	}: Props = $props()

	let open = $state(false)

	let lineName = $derived(
		branches.find((b) => b.id === branchId)?.name ?? "main"
	)
	/** Two of someone is the interesting case, so the sentence leads with it. */
	let summary = $derived(worldRosterLine(inhabitants))
</script>

<Popover
	{open}
	onOpenChange={(e) => (open = e.open)}
	positioning={{ placement }}
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
						Nobody is in this world yet. Cast members arrive from a
						session on their own.
					</p>
				{/if}

				{#each inhabitants as who (who.key)}
					<button
						class="hover:preset-tonal-surface flex items-center gap-2 rounded-lg px-2 py-1.5 text-left"
						type="button"
						onclick={() => {
							open = false
							onOpenMember(who.castId)
						}}
					>
						<span
							class="bg-surface-200-800 flex size-7 shrink-0 items-center justify-center rounded-lg text-xs"
						>
							{who.initial}
						</span>
						<span class="min-w-0 flex-1">
							<span class="block truncate text-xs">
								{who.name}
							</span>
							{#if who.aspect}
								<span
									class="text-surface-600-400 block truncate text-meta"
								>
									{who.aspect}
								</span>
							{/if}
						</span>
						{#if who.alsoHere}
							<!-- Two of them at one moment: the case a single
							     resolved row cannot express. -->
							<span
								class="chip preset-tonal-primary shrink-0 text-meta"
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
