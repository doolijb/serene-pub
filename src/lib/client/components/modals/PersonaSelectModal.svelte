<script lang="ts">
	import { Modal } from "@skeletonlabs/skeleton-svelte"
	import Avatar from "../Avatar.svelte"
	import * as Icons from "@lucide/svelte"

	import { getContext } from "svelte"

	interface Props {
		open: boolean
		personas?: Partial<SelectPersona>[]
		onclose?: () => void
		onOpenChange?: (e: { open: boolean }) => void
		onSelect:
			| ((personaId: number) => void)
			| ((persona: Partial<SelectPersona> & { id: number }) => void)
		title?: string
		description?: string
		returnFullPersona?: boolean
	}

	let {
		open = $bindable(),
		personas,
		onclose,
		onOpenChange,
		onSelect,
		title = "Select Persona",
		description,
		returnFullPersona = false
	}: Props = $props()

	// Get personas from user context if not provided
	let userCtx: UserCtx = getContext("userCtx")
	let availablePersonas = $derived(personas || userCtx.personas || [])
	let search = $state("")

	let filtered = $derived.by(() => {
		if (!search.trim()) return availablePersonas
		return availablePersonas.filter(
			(p) =>
				p.name!.toLowerCase().includes(search.toLowerCase()) ||
				(p.description &&
					p.description.toLowerCase().includes(search.toLowerCase()))
		)
	})
</script>

<Modal
	{open}
	onOpenChange={(e) => {
		if (onOpenChange) {
			onOpenChange(e)
		} else if (!e.open && onclose) {
			onclose()
		}
	}}
	contentBase="card bg-surface-100-900 p-6 space-y-6 shadow-xl max-h-[95dvh] relative overflow-hidden w-[min(95vw,800px)]"
	backdropClasses="backdrop-blur-sm"
>
	{#snippet content()}
		<header class="flex items-center justify-between">
			<h2 class="h2">{title}</h2>
			<button
				class="btn btn-sm"
				onclick={() => {
					if (onOpenChange) {
						onOpenChange({ open: false })
					} else if (onclose) {
						onclose()
					}
				}}
			>
				<Icons.X size={20} />
			</button>
		</header>
		{#if description}
			<p class="text-surface-600-400">{description}</p>
		{/if}
		<input
			class="input w-full"
			type="text"
			placeholder="Search personas..."
			bind:value={search}
		/>
		<div class="max-h-[60dvh] min-h-0 overflow-y-auto">
			<div class="relative flex flex-col pr-2 lg:flex-row lg:flex-wrap">
				{#if filtered.length === 0}
					<div class="text-surface-500 text-center">
						No personas found
					</div>
				{/if}
				{#each filtered as p}
					{#if p.id}
						<div class="flex p-1 lg:basis-1/2">
							<button
								class="group preset-outlined-surface-400-600 hover:preset-filled-surface-500 relative flex w-full gap-3 overflow-hidden rounded p-2"
								onclick={() => {
									if (returnFullPersona) {
										// For EditChatForm - return full persona object
										;(
											onSelect as (
												persona: Partial<SelectPersona> & {
													id: number
												}
											) => void
										)(
											p as Partial<SelectPersona> & {
												id: number
											}
										)
									} else {
										// For chat page - return just ID
										;(
											onSelect as (
												personaId: number
											) => void
										)(p.id!)
									}
									if (onOpenChange) {
										onOpenChange({ open: false })
									} else if (onclose) {
										onclose()
									}
								}}
							>
								<div class="w-fit">
									<Avatar char={p} />
								</div>
								<div
									class="relative flex w-0 min-w-0 flex-1 flex-col"
								>
									<div
										class="w-full truncate text-left font-semibold"
									>
										{p.name}
									</div>
									<div
										class="text-surface-500 group-hover:text-surface-800-200 line-clamp-2 w-full text-left text-xs"
									>
										{p.description || "No description"}
									</div>
								</div>
							</button>
						</div>
					{/if}
				{/each}
			</div>
		</div>
	{/snippet}
</Modal>
