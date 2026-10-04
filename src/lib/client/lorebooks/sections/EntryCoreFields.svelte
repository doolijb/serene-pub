<script lang="ts">
	import * as Icons from "@lucide/svelte"
	import type { BindingWithRelations } from "$lib/client/components/lorebookForms/entryManager"
	import LoreContentField from "$lib/client/components/lorebookForms/LoreContentField.svelte"
	import KeywordChips from "../editor/KeywordChips.svelte"
	import PartOfField from "../editor/PartOfField.svelte"
	import { getLorePoolCtx } from "./poolContext"
	import { readsAsRegex } from "$lib/shared/entries/runawayPattern"

	/**
	 * Level one of the editor: the fields every entry door asks for, in the
	 * order they are read — name, what it says, what reaches it, where it is
	 * filed.
	 *
	 * Name is shown only by the doors whose kind declares a title role —
	 * History is not named, it is dated, and its heading is the date. Keywords
	 * are shown whatever the instance does, because the keyword mechanism runs
	 * whether or not an embedding model is loaded; what changes with the model
	 * is the hint, which is a claim about semantic matching and is only made
	 * where semantic matching is actually happening.
	 */
	interface Props {
		draft: Record<string, any>
		idPrefix: string
		bindings: BindingWithRelations[]
		vectorizationEnabled: boolean
		showName?: boolean
		namePlaceholder?: string
	}

	let {
		draft = $bindable(),
		idPrefix,
		bindings = $bindable(),
		vectorizationEnabled,
		showName = true,
		namePlaceholder = ""
	}: Props = $props()

	const poolCtx = getLorePoolCtx()
</script>

{#if showName}
	<div class="flex flex-col gap-1">
		<label
			class="flex items-center gap-1 text-sm font-semibold"
			for="{idPrefix}Name"
		>
			Name <span class="text-error-500">*</span>
			<Icons.ScanEye
				size={13}
				class="text-surface-600-400 relative top-[1px]"
			/>
		</label>
		<input
			id="{idPrefix}Name"
			class="input preset-filled-surface-200-800 w-full rounded-lg"
			type="text"
			bind:value={draft.name}
			placeholder={namePlaceholder}
			required
		/>
	</div>
{/if}

<!-- `data-lore-field` names the fields a Loose ends row opens focused
     (`looseEnds.ts`): content, keywords, and History's date. -->
<div class="flex flex-col gap-1" data-lore-field="content">
	<!-- A span, not a label: the editor is a contenteditable div, which a
	     label cannot target. It names the editor through aria-labelledby. -->
	<span
		class="flex items-center gap-1 text-sm font-semibold"
		id="{idPrefix}ContentLabel"
	>
		Content
		<Icons.ScanEye
			size={13}
			class="text-surface-600-400 relative top-[1px]"
			aria-hidden="true"
		/>
	</span>
	<LoreContentField
		bind:content={draft.content}
		bind:lorebookBindingList={bindings as any}
		labelledBy="{idPrefix}ContentLabel"
	/>
</div>

<div class="contents" data-lore-field="keywords">
	<KeywordChips
		bind:keys={draft.keys}
		{idPrefix}
		regex={readsAsRegex(draft)}
		semantic={vectorizationEnabled}
	/>
</div>

<PartOfField
	bind:draft
	pool={poolCtx.pool}
	newRowBranchId={poolCtx.newRowBranchId}
	{idPrefix}
/>
