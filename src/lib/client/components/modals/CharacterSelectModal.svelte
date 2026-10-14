<script lang="ts">
	/**
	 * Pick characters from a list the caller hands in.
	 *
	 * Single mode: a press on a row picks it (`onSelect`). Multi mode
	 * (`multiSelect`): rows are checkboxes, and the footer's **Add N** hands
	 * back the ticked ids in the order they were ticked (`onMultiSelect`) —
	 * the order a cast was picked in is its order. Rows are the session
	 * form's `CharacterPickRow`, so the dialog and the form look alike.
	 */
	import { Dialog, Portal } from "@skeletonlabs/skeleton-svelte"
	import CharacterPickRow, {
		pickRowMatches
	} from "../sessionForms/CharacterPickRow.svelte"
	import EmptyState from "../EmptyState.svelte"
	import * as Icons from "@lucide/svelte"

	interface Props {
		open: boolean
		characters: Partial<SelectCharacter>[]
		onOpenChange: (e: { open: boolean }) => void
		onSelect?: (
			character: Partial<SelectCharacter> & { id: number }
		) => void
		// Inline create. A picker must never be an overlay with nothing to
		// offer and no way to make something — on a fresh install there are
		// no characters at all, and the session form requires one. Callers
		// that can host a creator pass this; when absent, no create
		// affordance is rendered.
		onCreateNew?: () => void
		/** Tick several, then add them together with `onMultiSelect`. */
		multiSelect?: boolean
		/** The ticked ids, in the order they were ticked. */
		onMultiSelect?: (ids: number[]) => void
		/** Characters not to offer because they are already chosen. They go
		 *  here, not filtered out of `characters`: the empty state reads both
		 *  to tell "everyone is already chosen" from "none exist yet". */
		excludeIds?: number[]
		/** Multi mode: how many more fit — the genre's cap less what is
		 *  already chosen. Past it, the unticked rows are disabled. */
		selectedLimit?: number
	}

	let {
		open = $bindable(),
		characters = [],
		onOpenChange,
		onSelect,
		onCreateNew,
		multiSelect = false,
		onMultiSelect,
		excludeIds = [],
		selectedLimit
	}: Props = $props()
	let search = $state("")
	/** Multi mode's ticks, in the order they were made. */
	let picked = $state<number[]>([])
	let searchInput = $state<HTMLInputElement | null>(null)

	type Row = Partial<SelectCharacter> & { id: number }

	let offered = $derived.by(() => {
		const excluded = new Set(excludeIds)
		return characters.filter(
			(c): c is Row => c.id != null && !excluded.has(c.id)
		)
	})

	/** Search matches only what a row shows (`pickRowMatches`). */
	let filtered = $derived(offered.filter((c) => pickRowMatches(c, search)))

	const atLimit = $derived(
		selectedLimit != null && picked.length >= selectedLimit
	)

	const emptyMessage = $derived(
		search
			? `No characters found matching "${search}".`
			: offered.length === 0 && characters.length > 0
				? "Everyone here is already chosen."
				: "No characters yet — create one to get started."
	)

	const addLabel = $derived(
		picked.length === 0
			? "Add"
			: `Add ${picked.length} ${picked.length === 1 ? "character" : "characters"}`
	)

	/** Each opening starts with nothing ticked. */
	$effect(() => {
		if (open) picked = []
	})

	function toggle(id: number) {
		if (picked.includes(id)) {
			picked = picked.filter((p) => p !== id)
			return
		}
		if (atLimit) return
		picked = [...picked, id]
	}

	function confirmMulti() {
		if (!picked.length) return
		onMultiSelect?.([...picked])
		onOpenChange({ open: false })
	}
</script>

<Dialog {open} {onOpenChange} initialFocusEl={() => searchInput}>
	<Portal>
		<Dialog.Backdrop
			class="bg-surface-50-950/50 fixed inset-0 z-50 backdrop-blur-sm"
		/>
		<Dialog.Positioner
			class="fixed inset-0 z-50 flex items-center justify-center p-4"
		>
			<Dialog.Content
				class="card bg-surface-100-900 relative flex max-h-[95dvh] w-[min(95vw,640px)] flex-col gap-4 overflow-hidden p-6 shadow-xl"
			>
				<header class="flex items-center justify-between">
					<Dialog.Title>
						{#snippet element(attributes)}
							<h2
								{...attributes as Record<string, unknown>}
								class="h2"
							>
								{multiSelect
									? "Add characters"
									: "Select character"}
							</h2>
						{/snippet}
					</Dialog.Title>
					<button
						type="button"
						aria-label="Close"
						class="btn btn-sm"
						onclick={() => onOpenChange({ open: false })}
					>
						<Icons.X size={20} aria-hidden="true" />
					</button>
				</header>
				<input
					bind:this={searchInput}
					aria-label="Search characters"
					class="input w-full"
					type="text"
					placeholder="Search characters..."
					bind:value={search}
				/>
				{#if multiSelect && selectedLimit != null}
					<p class="text-surface-600-400 text-xs" role="status">
						{atLimit
							? "That's all there's room for — untick one to choose another."
							: `Room for ${selectedLimit} more.`}
					</p>
				{/if}
				{#if filtered.length === 0}
					<EmptyState
						icon={Icons.Users}
						message={emptyMessage}
						ctaLabel={search || !onCreateNew
							? undefined
							: "New character"}
						onCta={search ? undefined : onCreateNew}
					/>
				{:else}
					<ul
						class="flex min-h-0 flex-col gap-1 overflow-y-auto pr-2"
						aria-label="Characters"
					>
						{#each filtered as c (c.id)}
							<li>
								{#if multiSelect}
									<CharacterPickRow
										character={c}
										kind="checkbox"
										checked={picked.includes(c.id)}
										disabled={atLimit &&
											!picked.includes(c.id)}
										onchange={() => toggle(c.id)}
									/>
								{:else}
									<CharacterPickRow
										character={c}
										kind="button"
										onchange={() => onSelect?.(c)}
									/>
								{/if}
							</li>
						{/each}
					</ul>
					{#if onCreateNew}
						<div class="panel-edge border-t pt-4">
							<button
								type="button"
								class="btn btn-sm preset-tonal-primary flex items-center gap-1"
								onclick={onCreateNew}
							>
								<Icons.Plus size={16} aria-hidden="true" /> New character
							</button>
						</div>
					{/if}
				{/if}
				{#if multiSelect}
					<footer class="flex justify-end gap-2">
						<button
							type="button"
							class="btn preset-tonal-surface"
							onclick={() => onOpenChange({ open: false })}
						>
							Cancel
						</button>
						<button
							type="button"
							class="btn preset-filled-primary-500"
							disabled={picked.length === 0}
							onclick={confirmMulti}
						>
							{addLabel}
						</button>
					</footer>
				{/if}
			</Dialog.Content>
		</Dialog.Positioner>
	</Portal>
</Dialog>
