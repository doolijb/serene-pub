<script lang="ts">
	import * as Icons from "@lucide/svelte"
	import LoreContentField from "$lib/client/components/lorebookForms/LoreContentField.svelte"
	import type { BindingWithRelations } from "$lib/client/components/lorebookForms/entryManager"
	import { editBounds, formatDateValue } from "../sections/historyDates"
	import type { PoolSource } from "../sections/types"
	import { readInLine, type TimeSceneRow } from "./storyTime"

	/**
	 * One dated entry, as the line's own editor.
	 *
	 * When first, because on this drawing the date is the address: it is what
	 * puts the entry where it is, and the one field with a rule the rest of the
	 * line depends on — an entry that crosses a neighbour reorders the story
	 * with nothing saying so. What it was compiled from and who was present are
	 * readouts of other rows rather than fields of this one, so they are listed
	 * and not edited here.
	 */
	interface Props {
		/** The stored row, or null while one is being written. */
		source: PoolSource | null
		isNew: boolean
		/** The draft the lens owns. This mutates it in place. */
		draft: Record<string, any>
		bindings: BindingWithRelations[]
		/** Every dated entry, for the ordering rule the date has to keep. */
		siblings: PoolSource[]
		/** The scenes this entry was compiled from. */
		scenes: TimeSceneRow[]
		/** Who is present, by binding id. */
		present: number[]
		castName: (bindingId: number) => string
		/** The heading: what this entry reads as on the line. */
		title: string
		/** Where the newest run ranked it, when it marked it at all. */
		readIn: { rank: number; total: number } | null
		dirty: boolean
		canSave: boolean
		onSave: () => void
		onClose: () => void
		onRecompile: () => void
		onOpenScene: (sceneId: number) => void
	}

	let {
		source,
		isNew,
		draft = $bindable(),
		bindings = $bindable(),
		siblings,
		scenes,
		present,
		castName,
		title,
		readIn,
		dirty,
		canSave,
		onSave,
		onClose,
		onRecompile,
		onOpenScene
	}: Props = $props()

	let bounds = $derived(
		isNew
			? { min: -Infinity, max: Infinity }
			: editBounds(siblings as any, source?.id)
	)
</script>

<div
	class="flex min-h-0 flex-1 flex-col gap-4 overflow-y-auto"
	data-lore-dated-editor
>
	<div class="flex flex-wrap items-center gap-2">
		<button
			class="btn btn-sm preset-filled-surface-400-600 shrink-0 p-2"
			type="button"
			onclick={onClose}
			title="Close"
			aria-label="Close"
		>
			<Icons.X size={16} aria-hidden="true" />
		</button>
		<span
			class="text-surface-700-300 shrink-0 text-[10px] tracking-wide uppercase"
		>
			History
		</span>
		<h3 class="min-w-0 flex-1 truncate text-sm font-semibold">
			{isNew ? "New dated entry" : title}
		</h3>
		<span class="text-surface-700-300 shrink-0 text-xs">
			{isNew ? "Not saved yet" : dirty ? "Unsaved changes" : "Saved"}
		</span>
		<button
			class="btn btn-sm preset-filled-success-500 shrink-0"
			type="button"
			disabled={!canSave}
			onclick={onSave}
		>
			<Icons.Save size={16} aria-hidden="true" />
			<span>{isNew ? "Create" : "Save"}</span>
		</button>
	</div>

	<div class="flex flex-col gap-1">
		<span class="text-sm font-semibold">When</span>
		<div class="flex gap-2">
			<div class="flex flex-col gap-1">
				<label class="text-xs font-semibold" for="dteYear">
					Year <span class="text-error-500">*</span>
				</label>
				<input
					id="dteYear"
					class="input preset-filled-surface-200-800 w-full rounded-lg"
					type="number"
					bind:value={draft.year}
					required
					placeholder="3"
				/>
			</div>
			<div class="flex flex-col gap-1">
				<label class="text-xs font-semibold" for="dteMonth">
					Month
				</label>
				<input
					id="dteMonth"
					class="input preset-filled-surface-200-800 w-full rounded-lg"
					type="number"
					bind:value={draft.month}
					placeholder="2"
				/>
			</div>
			<div class="flex flex-col gap-1">
				<label class="text-xs font-semibold" for="dteDay">Day</label>
				<input
					id="dteDay"
					class="input preset-filled-surface-200-800 w-full rounded-lg"
					type="number"
					bind:value={draft.day}
					placeholder="12"
				/>
			</div>
		</div>
		{#if bounds.min !== -Infinity || bounds.max !== Infinity}
			<p class="text-surface-700-300 text-xs">
				{#if bounds.min !== -Infinity && bounds.max !== Infinity}
					Must be between {formatDateValue(bounds.min)} and {formatDateValue(
						bounds.max
					)}
				{:else if bounds.min !== -Infinity}
					Must be after {formatDateValue(bounds.min)}
				{:else}
					Must be before {formatDateValue(bounds.max)}
				{/if}
			</p>
		{/if}
		<!-- The calendar the months and days are named in is the book's, and no
		     book declares one yet, so the fields are numbers and there is
		     nowhere to send a reader who wants to name them. -->
		<p class="text-surface-700-300 text-xs">
			Months and days are numbers until a book can name its own calendar.
		</p>
	</div>

	<div class="flex flex-col gap-1">
		<label class="text-sm font-semibold" for="dteContent">Content</label>
		<div id="dteContent">
			<LoreContentField
				bind:content={draft.content}
				bind:lorebookBindingList={bindings as any}
			/>
		</div>
	</div>

	{#if !isNew}
		<div class="flex flex-col gap-2">
			<div class="flex flex-wrap items-center gap-2">
				<span class="text-sm font-semibold">
					Compiled from {scenes.length}
					{scenes.length === 1 ? "scene" : "scenes"}
				</span>
				<button
					class="btn btn-sm preset-tonal-secondary shrink-0"
					type="button"
					disabled={scenes.length === 0}
					title={scenes.length === 0
						? "Capture a scene from a session first"
						: "Compile these scenes into this entry again"}
					onclick={onRecompile}
				>
					<Icons.Wand size={13} aria-hidden="true" /> Recompile
				</button>
			</div>
			{#if scenes.length === 0}
				<p class="text-surface-700-300 text-xs italic">
					Nothing was compiled into this entry. Capture a scene from a
					session and it lists here.
				</p>
			{:else}
				<ul class="flex flex-col gap-1">
					{#each scenes as scene (scene.id)}
						<li>
							<button
								type="button"
								class="btn btn-sm hover:preset-tonal-surface w-full justify-start gap-2"
								onclick={() => onOpenScene(scene.id)}
							>
								<span
									class="text-surface-700-300 shrink-0 text-[10px] tracking-wide uppercase"
								>
									Scene
								</span>
								<span class="min-w-0 flex-1 truncate text-left">
									{scene.name || "Unnamed Scene"}
								</span>
								<span
									class="text-surface-700-300 shrink-0 text-xs"
								>
									{scene.selectedMessageIds?.length ?? 0} messages
								</span>
							</button>
						</li>
					{/each}
				</ul>
			{/if}
		</div>

		<div class="flex flex-col gap-1">
			<span class="text-sm font-semibold">Present</span>
			{#if present.length === 0}
				<p class="text-surface-700-300 text-xs italic">
					Nobody is named in the scenes this entry was compiled from.
				</p>
			{:else}
				<div class="flex flex-wrap items-center gap-1">
					{#each present as id (id)}
						<span class="chip preset-tonal-primary py-0 text-xs">
							{castName(id)}
						</span>
					{/each}
				</div>
			{/if}
			<p class="text-surface-700-300 text-xs">
				Present comes from the scenes this entry was compiled from, so
				it is edited on the scene.
			</p>
		</div>

		{#if readIn}
			<p class="text-surface-700-300 text-xs" data-lore-read-in>
				{readInLine(readIn.rank, readIn.total)}
			</p>
		{/if}
	{/if}
</div>
