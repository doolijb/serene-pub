<script lang="ts">
	import * as Icons from "@lucide/svelte"
	import { Popover, Portal } from "@skeletonlabs/skeleton-svelte"

	/**
	 * Which line of the story is being read.
	 *
	 * One line exists, and the chip says so rather than hiding: a control that
	 * is absent teaches the reader the capability does not exist, and what a
	 * branch would be is worth knowing before there is one. There is no fork
	 * action, because a fork with nothing behind it would write a name and
	 * change nothing about what is read.
	 */
	interface Props {
		/** The branch being read. `main` is the only one. */
		branch: string
	}

	let { branch }: Props = $props()

	let open = $state(false)

	const DESCRIPTION =
		"Before the fork both lines read the same entries. After it, each " +
		"keeps its own amendments, scene captures and cast states. Nothing " +
		"merges back on its own."
</script>

<Popover
	{open}
	onOpenChange={(e) => (open = e.open)}
	positioning={{ placement: "bottom-end" }}
>
	<Popover.Trigger
		class="chip preset-tonal-surface shrink-0 gap-1 text-xs"
		title="Which line of the story is being read"
		data-lore-branch={branch}
	>
		<Icons.GitBranch size={12} aria-hidden="true" />
		<span>{branch}</span>
	</Popover.Trigger>
	<Portal>
		<Popover.Positioner class="z-[1000]!">
			<Popover.Content
				class="card bg-surface-100-900 flex w-[min(90vw,280px)] flex-col gap-2 p-4 shadow-xl"
			>
				<span class="text-sm font-semibold">
					Branches are not built yet
				</span>
				<p class="text-surface-700-300 text-xs leading-relaxed">
					{DESCRIPTION}
				</p>
			</Popover.Content>
		</Popover.Positioner>
	</Portal>
</Popover>
