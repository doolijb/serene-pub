<script lang="ts">
	import { Popover, Portal } from "@skeletonlabs/skeleton-svelte"
	import * as Icons from "@lucide/svelte"
	import EmbeddingStatusIcon from "../EmbeddingStatusIcon.svelte"

	interface Props {
		persona: Sockets.Personas.List.Response["personaList"][0]
		onclick?: (
			persona: Sockets.Personas.List.Response["personaList"][0]
		) => void
		onEdit?: (id: number) => void
		onDelete?: (id: number) => void
		showControls?: boolean
		contentTitle?: string
	}

	let {
		persona,
		onclick,
		onEdit,
		onDelete,
		showControls = true,
		contentTitle = "Go to persona"
	}: Props = $props()

	let menuOpen = $state(false)

	function handleClick() {
		onclick?.(persona)
	}
</script>

<div
	class="group relative aspect-[3/4] w-full overflow-hidden rounded-xl shadow-md transition-transform hover:scale-[1.02] hover:shadow-xl"
>
	<button
		type="button"
		class="absolute inset-0 h-full w-full text-left focus-visible:outline-none"
		onclick={handleClick}
		title={contentTitle}
		aria-label="{contentTitle}: {persona.name}"
	>
		{#if persona.avatar}
			<img
				src={persona.avatar}
				alt=""
				loading="lazy"
				class="absolute inset-0 h-full w-full object-cover transition-transform duration-300 group-hover:scale-105"
			/>
		{:else}
			<div class="bg-surface-300-700 absolute inset-0 flex items-center justify-center">
				<Icons.UserRound class="text-surface-400 h-16 w-16" aria-hidden="true" />
			</div>
		{/if}

		<div
			class="absolute inset-x-0 bottom-0 flex flex-col gap-0.5 bg-gradient-to-t from-black/90 via-black/50 to-transparent p-3 pt-10"
		>
			<span class="flex items-center gap-1 truncate text-sm font-bold text-white drop-shadow-sm">
				<span class="truncate">{persona.name}</span>
				<EmbeddingStatusIcon embeddingModel={persona.embeddingModel} />
			</span>
			{#if persona.description}
				<span class="line-clamp-2 text-xs leading-snug text-white/80">
					{persona.description}
				</span>
			{/if}
		</div>
	</button>

	{#if showControls && (onclick || onEdit || onDelete)}
		<div class="absolute top-2 right-2" role="none" onclick={(e) => e.stopPropagation()}>
			<Popover
				open={menuOpen}
				onOpenChange={(e) => (menuOpen = e.open)}
				positioning={{ placement: "bottom-end" }}
			>
				<Popover.Trigger
					class="btn btn-sm bg-surface-950/60 hover:bg-primary-600-400 p-2 text-white backdrop-blur-sm {menuOpen
						? 'bg-primary-600-400'
						: ''}"
					aria-label="Persona options"
				>
					<Icons.EllipsisVertical size={16} />
				</Popover.Trigger>
				<Portal>
					<Popover.Positioner class="z-[1000]!">
						<Popover.Content class="card bg-primary-200-800 shadow-xl p-4 space-y-4 w-[min(90vw,240px)]">
							<header class="popover-menu-title">
								<Icons.UserCog size={18} aria-hidden="true" />
								<p>Persona Options</p>
							</header>
							<article class="flex flex-col gap-2">
								{#if onclick}
									<button
										class="btn btn-sm popover-menu-btn hover:preset-filled-primary-500"
										onclick={() => { menuOpen = false; handleClick() }}
										type="button"
									>
										<Icons.Eye size={16} aria-hidden="true" />
										<span>View</span>
									</button>
								{/if}
								{#if onEdit}
									<button
										class="btn btn-sm popover-menu-btn hover:preset-filled-success-500"
										onclick={() => { menuOpen = false; onEdit?.(persona.id!) }}
										type="button"
									>
										<Icons.Pencil size={16} aria-hidden="true" />
										<span>Edit</span>
									</button>
								{/if}
								{#if onDelete}
									<button
										class="btn btn-sm popover-menu-btn hover:preset-filled-error-500"
										onclick={() => { menuOpen = false; onDelete?.(persona.id!) }}
										type="button"
									>
										<Icons.Trash2 size={16} aria-hidden="true" />
										<span>Delete</span>
									</button>
								{/if}
							</article>
							<Popover.Arrow>
								<Popover.ArrowTip class="!bg-primary-200 dark:!bg-primary-800" />
							</Popover.Arrow>
						</Popover.Content>
					</Popover.Positioner>
				</Portal>
			</Popover>
		</div>
	{/if}
</div>
