<script lang="ts">
	import * as Icons from "@lucide/svelte"
	import { Dialog, Portal } from "@skeletonlabs/skeleton-svelte"
	import {
		deleteMemberCopy,
		type PrivateLoreChoice
	} from "./castSave"

	/**
	 * Deleting a cast member, and what happens to the lore private to them.
	 *
	 * Owner ruling 4: the dialog ASKS. Their character lore is anchored to them
	 * with `ON DELETE SET NULL`, so lore left behind becomes unassigned — and
	 * unassigned lore is narrator-visible. That is a disclosure, so it is the
	 * author's choice, said plainly, with the counts. A member with no private
	 * lore gets a plain confirm.
	 *
	 * The counts come from `narrativeGraph:checkNodeMergeReferences`, asked by
	 * the caller as the dialog opens; Delete waits for them, because the
	 * question cannot be asked before the answer is known.
	 */
	interface Props {
		open: boolean
		name: string
		linked: boolean
		relationshipCount: number
		/** The pre-check's answer; null while it is on its way. */
		check: Sockets.NarrativeGraph.CheckNodeMergeReferences.Response | null
		/** Why the pre-check did not answer, when it did not. */
		checkError?: string | null
		/** The delete is on its way. */
		busy?: boolean
		onConfirm: (privateLore: PrivateLoreChoice) => void
		onCancel: () => void
	}

	let {
		open,
		name,
		linked,
		relationshipCount,
		check,
		checkError = null,
		busy = false,
		onConfirm,
		onCancel
	}: Props = $props()

	let copy = $derived(
		deleteMemberCopy({ name, linked, relationshipCount, check })
	)

	/**
	 * Keep is the default: it is what the delete did before the question
	 * existed, and it destroys nothing the author wrote.
	 */
	let choice = $state<PrivateLoreChoice>("keep")
	$effect(() => {
		if (open) choice = "keep"
	})
</script>

<Dialog
	{open}
	onOpenChange={(e) => {
		if (!e.open) onCancel()
	}}
>
	<Portal>
		<Dialog.Backdrop
			class="bg-surface-50-950/50 fixed inset-0 z-50 backdrop-blur-sm"
		/>
		<Dialog.Positioner
			class="fixed inset-0 z-50 flex items-center justify-center p-4"
		>
			<Dialog.Content
				class="card bg-surface-100-900 flex w-full max-w-md flex-col gap-4 p-6 shadow-xl"
				data-cast-delete-dialog
			>
				<Dialog.Title class="h3">{copy.title}</Dialog.Title>
				<p class="text-surface-700-300 text-sm">{copy.message}</p>

				{#if copy.mergeWarning}
					<p class="text-warning-700-300 text-sm">
						{copy.mergeWarning}
					</p>
				{/if}

				{#if checkError}
					<p class="text-error-600-400 text-sm" role="alert">
						Could not count the lore private to them: {checkError}
						Close this and try again.
					</p>
				{:else if !check}
					<p
						class="text-surface-600-400 flex items-center gap-2 text-sm"
						aria-live="polite"
					>
						<Icons.Loader2
							size={14}
							class="animate-spin"
							aria-hidden="true"
						/>
						Counting the lore private to them…
					</p>
				{:else if copy.lore}
					<fieldset class="flex flex-col gap-2" data-cast-delete-lore>
						<legend class="mb-1 text-sm font-semibold">
							{copy.lore.lead}
						</legend>
						<label
							class="panel-edge flex cursor-pointer items-start gap-2 rounded-lg border p-3"
							class:preset-tonal-primary={choice === "keep"}
						>
							<input
								class="radio mt-0.5"
								type="radio"
								name="castDeleteLore"
								value="keep"
								bind:group={choice}
							/>
							<span class="flex flex-col gap-0.5">
								<span class="text-sm font-semibold">
									{copy.lore.keep}
								</span>
								<span class="text-surface-700-300 text-xs">
									{copy.lore.keepDetail}
								</span>
							</span>
						</label>
						<label
							class="panel-edge flex cursor-pointer items-start gap-2 rounded-lg border p-3"
							class:preset-tonal-error={choice === "delete"}
						>
							<input
								class="radio mt-0.5"
								type="radio"
								name="castDeleteLore"
								value="delete"
								bind:group={choice}
							/>
							<span class="flex flex-col gap-0.5">
								<span class="text-sm font-semibold">
									{copy.lore.remove}
								</span>
								<span class="text-surface-700-300 text-xs">
									{copy.lore.removeDetail}
								</span>
							</span>
						</label>
					</fieldset>
				{/if}

				<footer class="flex justify-end gap-2">
					<button
						class="btn preset-tonal-surface"
						type="button"
						onclick={onCancel}
					>
						Cancel
					</button>
					<button
						class="btn preset-filled-error-500"
						type="button"
						disabled={!check || busy}
						onclick={() => onConfirm(copy.lore ? choice : "keep")}
					>
						<Icons.Trash2 size={16} aria-hidden="true" />
						Delete
					</button>
				</footer>
			</Dialog.Content>
		</Dialog.Positioner>
	</Portal>
</Dialog>
