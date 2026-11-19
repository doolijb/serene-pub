<script lang="ts">
	/**
	 * The Tags card on the settings form: the tag input with its suggestions
	 * dropdown, and the chosen tags as removable chips. The form owns the tag
	 * lists, the filtering and every add / remove; the search text and the
	 * dropdown's open flag are the form's too, bound here.
	 */
	import * as Icons from "@lucide/svelte"
	import { CARD_CLASS } from "./editSessionForm"

	interface Props {
		/** The input's text; the form filters its suggestions by it. */
		tagSearchInput: string
		/** Whether the suggestions dropdown is open. */
		showTagSuggestions: boolean
		/** The tags offered, already filtered by the form. */
		filteredTags: SelectTag[]
		/** The names of the chosen tags. */
		selectedTags: string[]
		/** Every known tag, for a chip's colour. */
		tagsList: SelectTag[]
		/** A guest may not add or remove tags. */
		isGuest: boolean
		addTag: (tagName: string) => void
		removeTag: (tagName: string) => void
	}

	let {
		tagSearchInput = $bindable(),
		showTagSuggestions = $bindable(),
		filteredTags,
		selectedTags,
		tagsList,
		isGuest,
		addTag,
		removeTag
	}: Props = $props()

	const FIELD_CLASS = "input rounded-base"
</script>

<section class="{CARD_CLASS} mb-10">
	<label
		class="text-surface-600-400 mb-1.5 block text-xs"
		for="tagInput"
	>
		Tags
	</label>
	<div class="relative">
		<input
			id="tagInput"
			type="text"
			bind:value={tagSearchInput}
			class={FIELD_CLASS}
			placeholder="Add a tag…"
			disabled={isGuest}
			onfocus={() => (showTagSuggestions = true)}
			onblur={() =>
				setTimeout(
					() => (showTagSuggestions = false),
					200
				)}
		/>

		<!-- Tag suggestions dropdown -->
		{#if showTagSuggestions && filteredTags.length > 0}
			<div
				class="bg-surface-100-900 border-surface-200-800 rounded-base absolute z-10 mt-1 max-h-40 w-full overflow-y-auto border shadow-lg"
			>
				{#each filteredTags as tag}
					<button
						type="button"
						class="hover:bg-surface-200-800 w-full px-3 py-2 text-left transition-colors"
						onclick={() => addTag(tag.name)}
					>
						<span
							class="chip mr-2 {tag.colorPreset ||
								'preset-filled-primary-500'}"
						>
							{tag.name}
						</span>
						{#if tag.description}
							<span
								class="text-surface-600-400 text-xs"
							>
								- {tag.description}
							</span>
						{/if}
					</button>
				{/each}
			</div>
		{/if}
	</div>

	<!-- Selected tags display -->
	{#if selectedTags.length > 0}
		<div class="mt-2 flex flex-wrap gap-2">
			{#each selectedTags as tagName}
				{@const tag = tagsList.find(
					(t) => t.name === tagName
				)}
				<button
					type="button"
					class="chip {tag?.colorPreset ||
						'preset-filled-primary-500'} group relative"
					onclick={() => removeTag(tagName)}
					disabled={isGuest}
					title={isGuest
						? tagName
						: "Click to remove tag"}
				>
					{tagName}
					{#if !isGuest}
						<Icons.X
							size={14}
							class="ml-1 opacity-60 group-hover:opacity-100"
						/>
					{/if}
				</button>
			{/each}
		</div>
	{/if}
</section>
