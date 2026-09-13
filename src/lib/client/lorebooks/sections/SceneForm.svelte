<script lang="ts">
	import * as Icons from "@lucide/svelte"
	import type { BindingWithRelations } from "$lib/client/components/lorebookForms/entryManager"
	import { getLorePoolCtx } from "./poolContext"

	/**
	 * A scene's own four fields: what it is called, what happened, who was
	 * there and who was spoken of.
	 *
	 * Fields only — the frame owns Save, Cancel and the unsaved-changes guard,
	 * so this binds to the draft the frame holds rather than keeping a second
	 * copy nothing else can see.
	 */
	interface Props {
		draft: Record<string, any>
		bindings: BindingWithRelations[]
	}

	let { draft = $bindable(), bindings }: Props = $props()

	const pool = getLorePoolCtx()

	let newParticipantId = $state<number | "">("")
	let newMentionedId = $state<number | "">("")

	function addParticipant() {
		if (newParticipantId === "") return
		const id = Number(newParticipantId)
		if (!draft.participantCharacters.includes(id))
			draft.participantCharacters = [...draft.participantCharacters, id]
		newParticipantId = ""
	}

	function addMentioned() {
		if (newMentionedId === "") return
		const id = Number(newMentionedId)
		if (!draft.mentionedCharacters.includes(id))
			draft.mentionedCharacters = [...draft.mentionedCharacters, id]
		newMentionedId = ""
	}
</script>

<label class="flex flex-col gap-1 text-sm font-semibold" for="sceneName">
	Name
</label>
<input
	id="sceneName"
	class="input preset-filled-surface-200-800 w-full rounded-lg"
	type="text"
	placeholder="Scene name"
	bind:value={draft.name}
/>

<label class="flex flex-col gap-1 text-sm font-semibold" for="sceneSummary">
	Summary
</label>
<textarea
	id="sceneSummary"
	class="textarea min-h-32 text-sm"
	placeholder="Scene summary…"
	bind:value={draft.summary}
></textarea>

<div class="space-y-1">
	<p
		class="text-surface-700-300 text-[10px] font-semibold tracking-wide uppercase"
	>
		Present
	</p>
	<div class="flex flex-wrap gap-1">
		{#each draft.participantCharacters as id, i (id)}
			<span
				class="chip preset-tonal-primary flex items-center gap-0.5 py-0 text-[10px]"
			>
				{pool.bindingName(id)}
				<button
					class="p-1.5"
					type="button"
					aria-label="Remove {pool.bindingName(id)}"
					onclick={() =>
						(draft.participantCharacters =
							draft.participantCharacters.filter(
								(_: number, j: number) => j !== i
							))}
				>
					<Icons.X size={9} />
				</button>
			</span>
		{/each}
	</div>
	<div class="flex gap-1">
		<select
			class="select select-sm flex-1 text-xs"
			aria-label="Add someone present"
			bind:value={newParticipantId}
		>
			<option value="">Add cast member…</option>
			{#each bindings.filter((b) => !draft.participantCharacters.includes(b.id)) as b (b.id)}
				<option value={b.id}>{b.name || b.binding}</option>
			{/each}
		</select>
		<button
			class="btn btn-sm preset-filled-surface-400-600 p-1"
			type="button"
			onclick={addParticipant}
			disabled={newParticipantId === ""}
			aria-label="Add someone present"
		>
			<Icons.Plus size={12} />
		</button>
	</div>
</div>

<div class="space-y-1">
	<p
		class="text-surface-700-300 text-[10px] font-semibold tracking-wide uppercase"
	>
		Mentioned
	</p>
	<div class="flex flex-wrap gap-1">
		{#each draft.mentionedCharacters as id, i (id)}
			<span
				class="chip preset-tonal-surface flex items-center gap-0.5 py-0 text-[10px]"
			>
				{pool.bindingName(id)}
				<button
					class="p-1.5"
					type="button"
					aria-label="Remove {pool.bindingName(id)}"
					onclick={() =>
						(draft.mentionedCharacters =
							draft.mentionedCharacters.filter(
								(_: number, j: number) => j !== i
							))}
				>
					<Icons.X size={9} />
				</button>
			</span>
		{/each}
	</div>
	<div class="flex gap-1">
		<select
			class="select select-sm flex-1 text-xs"
			aria-label="Add someone mentioned"
			bind:value={newMentionedId}
		>
			<option value="">Add cast member…</option>
			{#each bindings.filter((b) => !draft.mentionedCharacters.includes(b.id)) as b (b.id)}
				<option value={b.id}>{b.name || b.binding}</option>
			{/each}
		</select>
		<button
			class="btn btn-sm preset-filled-surface-400-600 p-1"
			type="button"
			onclick={addMentioned}
			disabled={newMentionedId === ""}
			aria-label="Add someone mentioned"
		>
			<Icons.Plus size={12} />
		</button>
	</div>
</div>
