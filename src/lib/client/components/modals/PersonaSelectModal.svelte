<script lang="ts">
	import { Dialog, Portal } from "@skeletonlabs/skeleton-svelte"
	import Avatar from "../Avatar.svelte"
	import * as Icons from "@lucide/svelte"

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

	// Every caller passes `personas` explicitly (see EditSessionForm.svelte,
	// sessions/[id]/+page.svelte, LorebookBindingsManager.svelte) — there is no
	// personas-list context to fall back to.
	let availablePersonas = $derived(personas || [])
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

<Dialog
	{open}
	onOpenChange={(e) => {
		if (onOpenChange) {
			onOpenChange(e)
		} else if (!e.open && onclose) {
			onclose()
		}
	}}
>
	<Portal>
		<Dialog.Backdrop
			class="bg-surface-50-950/50 fixed inset-0 z-50 backdrop-blur-sm"
		/>
		<Dialog.Positioner
			class="fixed inset-0 z-50 flex items-center justify-center p-4"
		>
			<Dialog.Content
				class="card bg-surface-100-900 relative max-h-[95dvh] w-[min(95vw,800px)] space-y-6 overflow-hidden p-6 shadow-xl"
			>
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
					<div
						class="relative flex flex-col pr-2 lg:flex-row lg:flex-wrap"
					>
						{#if filtered.length === 0}
							<div class="text-surface-700-300 text-center">
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
												// For EditSessionForm - return full persona object
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
												// For session page - return just ID
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
										<div class="w-fit shrink-0">
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
												class="text-surface-700-300 group-hover:text-surface-800-200 line-clamp-2 w-full text-left text-xs"
											>
												{p.description ||
													"No description"}
											</div>
										</div>
									</button>
								</div>
							{/if}
						{/each}
					</div>
				</div>
			</Dialog.Content>
		</Dialog.Positioner>
	</Portal>
</Dialog>
