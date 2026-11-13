<!-- The greeting list editor: one textarea per greeting with its "Group
     sessions only" mark and remove button, then the add button. Used by the
     card editor and the cast member form. -->
<script lang="ts">
	import * as Icons from "@lucide/svelte"
	import type { CharacterGreeting } from "$lib/shared/characters/profile"
	import { FIELD_CLASS } from "./fieldClass"
	import RemoveRowButton from "./RemoveRowButton.svelte"

	interface Props {
		greetings: CharacterGreeting[]
		onText: (index: number, text: string) => void
		onGroupOnly: (index: number, groupOnly: boolean) => void
		onRemove: (index: number) => void
		onAdd: () => void
		/** id on the outer div (a label elsewhere may point at it). */
		id?: string
	}

	let { greetings, onText, onGroupOnly, onRemove, onAdd, id }: Props =
		$props()
</script>

<div class="flex flex-col gap-3" {id}>
	{#each greetings as greeting, idx (idx)}
		<div class="flex items-start gap-2">
			<div class="flex min-w-0 flex-1 flex-col gap-1.5">
				<textarea
					rows={idx === 0 ? 8 : 3}
					value={greeting.text}
					oninput={(e) => onText(idx, e.currentTarget.value)}
					class="{FIELD_CLASS} resize-y"
					placeholder="Greeting..."
					aria-label={`Greeting ${idx + 1}`}
				></textarea>
				<label
					class="flex items-center gap-2 text-xs pointer-coarse:min-h-11"
				>
					<input
						type="checkbox"
						class="checkbox"
						checked={!!greeting.groupOnly}
						onchange={(e) =>
							onGroupOnly(idx, e.currentTarget.checked)}
					/>
					Group sessions only
				</label>
			</div>
			<RemoveRowButton
				label={`Remove greeting ${idx + 1}`}
				onRemove={() => onRemove(idx)}
			/>
		</div>
	{/each}
	<button
		type="button"
		class="btn btn-sm preset-tonal-surface self-start"
		onclick={onAdd}
	>
		<Icons.Plus size={14} aria-hidden="true" />
		Add a greeting
	</button>
</div>
