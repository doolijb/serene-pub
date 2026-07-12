<script lang="ts">
	import { getDoc, type DocSection } from "$lib/shared/utils/docsIndex"
	import DocResultCard from "./DocResultCard.svelte"

	let {
		sections,
		compact = false,
		onSelect
	}: {
		sections: DocSection[]
		compact?: boolean
		onSelect: (section: DocSection) => void
	} = $props()

	let grouped = $derived.by(() => {
		const bySlug = new Map<string, DocSection[]>()
		for (const section of sections) {
			const list = bySlug.get(section.slug) ?? []
			list.push(section)
			bySlug.set(section.slug, list)
		}
		return [...bySlug.entries()]
	})
</script>

<div class={compact ? "max-h-[60vh] space-y-4 overflow-y-auto" : "space-y-6"}>
	{#if grouped.length === 0}
		<div class="text-surface-500 py-8 text-center">
			<p>No matching documentation found.</p>
		</div>
	{:else}
		{#each grouped as [slug, groupSections]}
			{@const doc = getDoc(slug)}
			<div class="space-y-2">
				<h4 class="h4 font-semibold">{doc?.title ?? slug}</h4>
				<div class="grid grid-cols-1 gap-2">
					{#each groupSections as section}
						<DocResultCard {section} onclick={() => onSelect(section)} />
					{/each}
				</div>
			</div>
		{/each}
	{/if}
</div>
