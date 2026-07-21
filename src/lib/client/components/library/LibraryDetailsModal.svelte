<script lang="ts">
	import { Dialog, Portal } from "@skeletonlabs/skeleton-svelte"
	import * as Icons from "@lucide/svelte"
	import type { LibraryCatalogItem } from "$lib/shared/library/types"

	interface Props {
		open: boolean
		onOpenChange?: (e: { open: boolean }) => void
		item: LibraryCatalogItem | null
		imageUrl: string | null
		downloading: boolean
		loadingDetail?: boolean
		onDownload: () => void
		/** Only offered for sources that support server-side creator filtering (currently CharaVault). */
		onFilterByCreator?: (author: string) => void
		itemTypeLabel: "Character" | "Persona"
	}

	let {
		open,
		onOpenChange,
		item,
		imageUrl,
		downloading,
		loadingDetail = false,
		onDownload,
		onFilterByCreator,
		itemTypeLabel
	}: Props = $props()

	function handleClose() {
		if (downloading) return
		onOpenChange?.({ open: false })
	}
</script>

<Dialog {open} onOpenChange={(e) => { if (!e.open) handleClose() }}>
	<Portal>
		<Dialog.Backdrop class="fixed inset-0 z-50 bg-surface-50-950/50 backdrop-blur-sm" />
		<Dialog.Positioner class="fixed inset-0 z-50 flex items-center justify-center p-4">
			<Dialog.Content
				class="card bg-surface-100-900 max-h-[90vh] w-full max-w-lg space-y-5 overflow-y-auto p-6 shadow-xl sm:max-w-xl md:max-w-2xl lg:max-w-4xl"
			>
				{#if item}
					<header class="flex items-center justify-between gap-2">
						<h2 class="h3 min-w-0 truncate">{item.name}</h2>
						<button class="btn-ghost shrink-0" onclick={handleClose} aria-label="Close">
							<Icons.X size={20} />
						</button>
					</header>

					<div class="flex flex-col gap-5 sm:flex-row">
						{#if imageUrl}
							<div class="flex shrink-0 justify-center sm:w-56">
								<img
									src={imageUrl}
									alt={item.name}
									class="max-h-96 w-full rounded-lg object-contain shadow-lg sm:max-h-none"
								/>
							</div>
						{/if}

						<div class="min-w-0 flex-1 space-y-4">
							<div>
								<h3 class="mb-1 text-sm font-semibold">Description</h3>
								{#if loadingDetail}
									<p class="text-surface-700-300 flex items-center gap-2 text-sm">
										<Icons.Loader2 size={14} class="animate-spin" aria-hidden="true" />
										Loading description…
									</p>
								{:else if item.description}
									<p class="text-sm whitespace-pre-line">{item.description}</p>
								{:else}
									<p class="text-surface-700-300 text-sm italic">No description provided.</p>
								{/if}
							</div>

							{#if item.tags.length > 0}
								<div>
									<h3 class="mb-1 text-sm font-semibold">Tags</h3>
									<div class="flex flex-wrap gap-2">
										{#each item.tags as tag}
											<span class="badge preset-tonal-primary text-xs">{tag}</span>
										{/each}
									</div>
								</div>
							{/if}

							<div class="grid grid-cols-2 gap-3 text-sm sm:grid-cols-4">
								<div>
									<span class="text-surface-700-300 font-semibold">Author</span>
									{#if onFilterByCreator && item.source === "charavault" && item.author}
										<button
											type="button"
											class="anchor block truncate text-left"
											onclick={() => onFilterByCreator?.(item!.author)}
											title="Browse more from this creator"
										>
											{item.author}
										</button>
									{:else}
										<p class="truncate">{item.author}</p>
									{/if}
								</div>
								<div>
									<span class="text-surface-700-300 font-semibold">Version</span>
									<p class="truncate">{item.version}</p>
								</div>
								<div>
									<span class="text-surface-700-300 font-semibold">Spec</span>
									<p class="truncate">{item.spec}</p>
								</div>
								<div>
									<span class="text-surface-700-300 font-semibold">Category</span>
									<p class="truncate">{item.category}</p>
								</div>
							</div>

							{#if item.hasLorebook}
								<p class="flex items-center gap-1.5 text-sm">
									<Icons.BookOpen size={16} class="text-primary-500" aria-hidden="true" />
									Includes a lorebook
								</p>
							{/if}
						</div>
					</div>

					<footer class="flex justify-end gap-2 pt-2">
						<button class="btn preset-filled-surface-400-600" onclick={handleClose} disabled={downloading}>
							Close
						</button>
						<button class="btn preset-filled-primary-500" onclick={onDownload} disabled={downloading}>
							{#if downloading}
								<Icons.Loader2 size={16} class="animate-spin" />
								Downloading…
							{:else}
								<Icons.Download size={16} />
								Download {itemTypeLabel}
							{/if}
						</button>
					</footer>
				{/if}
			</Dialog.Content>
		</Dialog.Positioner>
	</Portal>
</Dialog>
