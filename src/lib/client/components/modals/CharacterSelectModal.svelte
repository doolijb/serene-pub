<script lang="ts">
	import { Modal } from "@skeletonlabs/skeleton-svelte"
	import Avatar from "../Avatar.svelte"
	import * as Icons from "@lucide/svelte"

	interface Props {
		open: boolean
		characters: Partial<SelectCharacter>[]
		onOpenChange: (e: { open: boolean }) => void
		onSelect: (character: Partial<SelectCharacter> & { id: number }) => void
	}

	let {
		open = $bindable(),
		characters = [],
		onOpenChange,
		onSelect
	}: Props = $props()
	let search = $state("")

	let filtered = $derived.by(() => {
		if (!search.trim()) return characters
		return characters.filter(
			(c) =>
				c.name!.toLowerCase().includes(search.toLowerCase()) ||
				(c.nickname &&
					c.nickname.toLowerCase().includes(search.toLowerCase())) ||
				(c.description &&
					c.description
						.toLowerCase()
						.includes(search.toLowerCase())) ||
				(c.creatorNotes &&
					c.creatorNotes.toLowerCase().includes(search.toLowerCase()))
		)
	})
</script>

<Modal
	{open}
	{onOpenChange}
	contentBase="card bg-surface-100-900 p-6 space-y-6 shadow-xl max-h-[95dvh] relative overflow-hidden w-[min(95vw,800px)]"
	backdropClasses="backdrop-blur-sm"
>
	{#snippet content()}
		<header class="flex items-center justify-between">
			<h2 class="h2">Select Character</h2>
			<button
				class="btn btn-sm"
				onclick={() => onOpenChange({ open: false })}
			>
				<Icons.X size={20} />
			</button>
		</header>
		<input
			class="input w-full"
			type="text"
			placeholder="Search characters..."
			bind:value={search}
		/>
		<div class="max-h-[60dvh] min-h-0 overflow-y-auto">
			<div class="relative flex flex-col pr-2 lg:flex-row lg:flex-wrap">
				{#if filtered.length === 0}
					<div class="text-surface-500 text-center">
						No characters found
					</div>
				{/if}
				{#each filtered as c}
					<div class="flex p-1 lg:basis-1/2">
						<button
							class="group preset-outlined-surface-400-600 hover:preset-filled-surface-500 relative flex w-full gap-3 overflow-hidden rounded p-2"
							onclick={() => onSelect(c)}
						>
							<div class="w-fit">
								<Avatar char={c} />
							</div>
							<div
								class="relative flex w-0 min-w-0 flex-1 flex-col"
							>
								<div
									class="w-full truncate text-left font-semibold"
								>
									{c.nickname || c.name}
								</div>
								<div
									class="text-surface-500 group-hover:text-surface-800-200 line-clamp-2 w-full text-left text-xs"
								>
									{c.creatorNotes ||
										c.description ||
										"No description"}
								</div>
							</div>
						</button>
					</div>
				{/each}
			</div>
		</div>
	{/snippet}
</Modal>
