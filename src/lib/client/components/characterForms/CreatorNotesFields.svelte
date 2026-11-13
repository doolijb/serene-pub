<!-- The Notes tab body: the creator notes text and, when asked, the notes'
     language and the other-language rows. Used by the card editor and the
     cast member form. -->
<script lang="ts">
	import type { Snippet } from "svelte"
	import { FIELD_CLASS } from "./fieldClass"
	import type { NoteLanguageRow } from "./cardDraft"
	import ProseField from "./ProseField.svelte"
	import RemoveRowButton from "./RemoveRowButton.svelte"
	import AddRowButton from "./AddRowButton.svelte"

	interface Props {
		textId: string
		langId: string
		text?: string
		lang?: string
		/** Rows are edited in place, added with push, removed with splice. */
		variants?: NoteLanguageRow[]
		/** Show Language and Other languages. */
		languages?: boolean
		/** The languages' error sentence. */
		error?: string | null
		placeholder?: string
		/** Passed to the text's ProseField. */
		disabled?: boolean
		/** Passed to the text's ProseField. */
		follow?: Snippet
		/** Called after any edit inside the component. */
		onchange?: () => void
	}

	let {
		textId,
		langId,
		text = $bindable(""),
		lang = $bindable(""),
		variants = $bindable([]),
		languages = false,
		error = null,
		placeholder = "Notes from the character creator...",
		disabled = false,
		follow,
		onchange
	}: Props = $props()
</script>

<div class="flex flex-col gap-4">
	<div class="flex flex-col">
		<ProseField
			id={textId}
			label="Creator notes"
			rows={4}
			bind:value={text}
			{placeholder}
			{disabled}
			{follow}
			oninput={() => onchange?.()}
		/>
	</div>
	{#if languages}
		<div class="flex flex-col">
			<label class="text-surface-600-400 mb-1.5 text-xs" for={langId}>
				Language
			</label>
			<input
				id={langId}
				type="text"
				bind:value={lang}
				oninput={() => onchange?.()}
				class="{FIELD_CLASS} w-24"
				placeholder="en"
				aria-label="Language of these notes"
			/>
		</div>
		<div class="flex flex-col">
			<span class="text-surface-600-400 mb-1.5 text-xs">
				Other languages
			</span>
			<div class="flex flex-col gap-2">
				{#each variants as _row, idx (idx)}
					<div class="flex items-start gap-2">
						<input
							type="text"
							bind:value={variants[idx].lang}
							oninput={() => onchange?.()}
							class="{FIELD_CLASS} w-16 shrink-0"
							placeholder="fr"
							aria-label={`Language ${idx + 1}`}
						/>
						<textarea
							rows="3"
							bind:value={variants[idx].text}
							oninput={() => onchange?.()}
							class="{FIELD_CLASS} flex-1 resize-y"
							placeholder="Notes in this language..."
							aria-label={`Notes in language ${idx + 1}`}
						></textarea>
						<RemoveRowButton
							label={`Remove language ${idx + 1}`}
							onRemove={() => {
								variants.splice(idx, 1)
								onchange?.()
							}}
						/>
					</div>
				{/each}
				{#if error}
					<p class="text-error-600-400 text-sm" role="alert">
						{error}
					</p>
				{/if}
				<AddRowButton
					label="Add a language"
					onAdd={() => {
						variants.push({ lang: "", text: "" })
						onchange?.()
					}}
				/>
			</div>
		</div>
	{/if}
</div>
