<script lang="ts">
	/**
	 * Where a character is filed, as a single choice.
	 *
	 * `role="radio"` rows and not a `<select>`: this is the same one-of-many
	 * question the filter popout asks (§6.3), it wants the selected treatment on
	 * the row the character is already in, and a folder list is a list of places
	 * rather than a form field. Picking applies immediately and closes — one
	 * choice, one interaction, no confirm button to press afterwards.
	 */
	import { Dialog, Portal } from "@skeletonlabs/skeleton-svelte"
	import * as Icons from "@lucide/svelte"

	type Folder = Sockets.CharacterFolders.List.Response["folders"][0]

	interface Props {
		open: boolean
		onOpenChange: (e: OpenChangeDetails) => void
		/** The name shown in the title — the nickname where there is one. */
		characterName: string
		/** Where it is filed now, so that row reads as the current answer. */
		currentFolderId: number | null
		folders: Folder[]
		/** `null` is the top level. */
		onPick: (folderId: number | null) => void
		onCancel: () => void
	}

	let {
		open = $bindable(),
		onOpenChange,
		characterName,
		currentFolderId,
		folders,
		onPick,
		onCancel
	}: Props = $props()

	const rows = $derived([
		{ id: null as number | null, name: "No folder", count: null },
		...folders.map((f) => ({
			id: f.id as number | null,
			name: f.name,
			count: f.characterCount
		}))
	])
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
				class="card bg-surface-100-900 border-surface-300-700 w-[min(95vw,420px)] border p-6 shadow-xl"
				aria-labelledby="character-move-folder-title"
			>
				<h2
					id="character-move-folder-title"
					class="mb-4 text-lg font-bold"
				>
					Move “{characterName}” to…
				</h2>
				<div
					class="flex max-h-[min(60vh,360px)] flex-col gap-0.5 overflow-y-auto"
					role="radiogroup"
					aria-labelledby="character-move-folder-title"
				>
					{#each rows as row (row.id ?? "none")}
						{@const checked = currentFolderId === row.id}
						<button
							type="button"
							role="radio"
							aria-checked={checked}
							class="flex h-10 w-full items-center gap-2 rounded-lg px-2.5 text-left text-sm {checked
								? 'sidebar-row-active'
								: 'hover:preset-tonal-primary'}"
							onclick={() => onPick(row.id)}
						>
							{#if row.id === null}
								<Icons.Minus
									size={16}
									class="text-surface-400 shrink-0"
									aria-hidden="true"
								/>
							{:else}
								<Icons.Folder
									size={16}
									class="text-surface-400 shrink-0"
									aria-hidden="true"
								/>
							{/if}
							<span class="min-w-0 flex-1 truncate">
								{row.name}
							</span>
							{#if row.count !== null}
								<span class="text-surface-500 shrink-0 text-xs">
									{row.count}
								</span>
							{/if}
						</button>
					{/each}
				</div>
				{#if folders.length === 0}
					<p class="text-surface-500 mt-3 text-xs">
						You have no folders yet — make one from the New menu.
					</p>
				{/if}
				<div class="mt-4 flex justify-end">
					<button
						type="button"
						class="btn preset-filled-surface-500"
						onclick={onCancel}
					>
						Cancel
					</button>
				</div>
			</Dialog.Content>
		</Dialog.Positioner>
	</Portal>
</Dialog>
