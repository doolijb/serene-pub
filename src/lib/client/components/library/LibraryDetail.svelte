<script lang="ts">
	/**
	 * One library result's **detail** in the Library view (NOMENCLATURE §26):
	 * the card as its source describes it, and the one thing to do with it —
	 * import it into Characters.
	 *
	 * Replaced `LibraryDetailsModal`: the library is a sidebar view now, so the
	 * detail is a pane — beside the grid when the view has desk room, in place
	 * of the list with a back header in the dock (`PanelSplit`).
	 *
	 * **Import** is the one filled primary (STYLE-GUIDE §6.1). Once a card is
	 * in, the primary becomes **Open in Characters**, which is what a person
	 * who just imported something does next — and the view stays where it was,
	 * so browsing carries on.
	 */
	import * as Icons from "@lucide/svelte"
	import type { LibraryCatalogItem } from "$lib/shared/library/types"
	import PanelNavHeader from "$lib/client/components/panels/PanelNavHeader.svelte"
	import DetailHero from "$lib/client/components/panels/DetailHero.svelte"
	import RetryableImage from "./RetryableImage.svelte"

	interface Props {
		item: LibraryCatalogItem
		imageUrl: string | null
		/** An import is in flight (for any result: one at a time). */
		importing: boolean
		/** The full description is still being fetched. */
		loadingDetail?: boolean
		/** The character this result became, once imported in this visit. */
		importedCharacterId?: number | null
		/** Absent at desk width, where the list stays beside the detail. */
		onBack?: () => void
		onImport: () => void
		onOpenInCharacters: (characterId: number) => void
		/** Only offered for sources that filter by creator (CharaVault). */
		onFilterByCreator?: (author: string) => void
	}

	let {
		item,
		imageUrl,
		importing,
		loadingDetail = false,
		importedCharacterId = null,
		onBack,
		onImport,
		onOpenInCharacters,
		onFilterByCreator
	}: Props = $props()

	let meta = $derived(
		[
			item.spec && `Spec ${item.spec}`,
			item.version && `Version ${item.version}`,
			item.source !== "charavault" && item.category
		]
			.filter(Boolean)
			.join(" · ")
	)
</script>

<!-- `@container/libdetail`: the pane decides whether the portrait sits beside
     the description, never the window (STYLE-GUIDE §5.3). -->
<article class="@container/libdetail flex min-w-0 flex-col gap-4">
	<!-- The back row only where there is somewhere to go back to (the dock);
	     beside the grid the hero's name is the pane's heading instead of
	     saying the name twice. -->
	{#if onBack}
		<PanelNavHeader
			title={item.name}
			{onBack}
			backLabel="Back to the library"
		/>
	{/if}

	<DetailHero
		title={item.name}
		headingLevel={onBack ? undefined : 2}
		subtitle={item.author ? `by ${item.author}` : undefined}
		meta={meta || undefined}
	>
		{#snippet media()}
			{#if imageUrl}
				<RetryableImage
					src={imageUrl}
					alt=""
					loading="eager"
					class="size-[72px] rounded-[14px] object-cover object-top"
				/>
			{:else}
				<span
					class="bg-surface-200-800 grid size-[72px] place-items-center rounded-[14px]"
				>
					<Icons.User
						size={32}
						class="text-surface-600-400"
						aria-hidden="true"
					/>
				</span>
			{/if}
		{/snippet}
		{#snippet chips()}
			{#if item.hasLorebook || importedCharacterId != null}
				<div class="flex flex-wrap gap-1.5">
					{#if item.hasLorebook}
						<span
							class="badge preset-tonal-primary inline-flex items-center gap-1 text-xs"
						>
							<Icons.BookOpen size={12} aria-hidden="true" />
							Includes a lorebook
						</span>
					{/if}
					{#if importedCharacterId != null}
						<span
							class="badge preset-tonal-success inline-flex items-center gap-1 text-xs"
						>
							<Icons.Check size={12} aria-hidden="true" />
							In your characters
						</span>
					{/if}
				</div>
			{/if}
		{/snippet}
		{#snippet actions()}
			<div class="flex flex-wrap items-center gap-2">
				{#if importedCharacterId != null}
					<button
						type="button"
						class="btn btn-sm preset-filled-primary-500"
						onclick={() => onOpenInCharacters(importedCharacterId!)}
					>
						<Icons.UsersRound size={16} aria-hidden="true" />
						Open in Characters
					</button>
				{:else}
					<button
						type="button"
						class="btn btn-sm preset-filled-primary-500"
						onclick={onImport}
						disabled={importing}
					>
						{#if importing}
							<Icons.Loader2
								size={16}
								class="animate-spin"
								aria-hidden="true"
							/>
							Importing…
						{:else}
							<Icons.Download size={16} aria-hidden="true" />
							Import
						{/if}
					</button>
				{/if}
				{#if onFilterByCreator && item.source === "charavault" && item.author}
					<button
						type="button"
						class="btn btn-sm preset-tonal"
						onclick={() => onFilterByCreator?.(item.author)}
						title="Show only cards by {item.author}"
					>
						<Icons.UserSearch size={16} aria-hidden="true" />
						More by {item.author}
					</button>
				{/if}
			</div>
		{/snippet}
	</DetailHero>

	<div
		class="flex flex-col gap-4 @min-[36rem]/libdetail:flex-row @min-[36rem]/libdetail:items-start"
	>
		{#if imageUrl}
			<div
				class="w-full max-w-[18rem] shrink-0 self-center @min-[36rem]/libdetail:self-start"
			>
				<RetryableImage
					src={imageUrl}
					alt={item.name}
					loading="eager"
					class="w-full rounded-[12px] object-contain shadow-md"
				/>
			</div>
		{/if}

		<div class="flex min-w-0 flex-1 flex-col gap-4">
			<section class="panel-card">
				<h3 class="text-surface-600-400 mb-1.5 text-xs font-medium">
					Description
				</h3>
				{#if loadingDetail}
					<p
						class="text-surface-600-400 flex items-center gap-2 text-sm"
					>
						<Icons.Loader2
							size={14}
							class="animate-spin"
							aria-hidden="true"
						/>
						Loading the description…
					</p>
				{:else if item.description}
					<p class="text-sm break-words whitespace-pre-line">
						{item.description}
					</p>
				{:else}
					<p class="text-surface-600-400 text-sm">
						No description given.
					</p>
				{/if}
			</section>

			{#if item.tags.length > 0}
				<section class="panel-card">
					<h3 class="text-surface-600-400 mb-1.5 text-xs font-medium">
						Tags
					</h3>
					<div class="flex flex-wrap gap-1.5">
						{#each item.tags as tag (tag)}
							<span class="badge preset-tonal text-xs">{tag}</span>
						{/each}
					</div>
				</section>
			{/if}
		</div>
	</div>
</article>
