<script lang="ts">
	/**
	 * Django admin's "Are you sure?" step, as a dialog: what goes, and under
	 * each object what goes or changes with it (its models, the defaults it
	 * held). Shared by the changelist's bulk delete and the change form's
	 * Delete, so both ask the same question the same way.
	 *
	 * Cancel is the focused, safe choice; the destructive button names the
	 * count it takes ("Delete 2 connections"), never a bare "OK".
	 */
	import * as Icons from "@lucide/svelte"
	import { Dialog, Portal } from "@skeletonlabs/skeleton-svelte"
	import type { AdminDeletion } from "./changelist"

	interface Props {
		open: boolean
		deletion: AdminDeletion | null
		onConfirm: () => void
		onCancel: () => void
	}
	let { open, deletion, onConfirm, onCancel }: Props = $props()

	const uid = $props.id()
</script>

<Dialog
	{open}
	role="alertdialog"
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
				class="card bg-surface-100-900 flex max-h-[85vh] w-full max-w-lg flex-col gap-4 p-5 shadow-xl"
				aria-describedby="{uid}-summary"
			>
				{#if deletion}
					<Dialog.Title
						class="text-surface-950-50 flex items-center gap-2 text-lg font-semibold"
					>
						<Icons.TriangleAlert
							size={18}
							class="text-error-600-400 shrink-0"
							aria-hidden="true"
						/>
						{deletion.title}
					</Dialog.Title>
					<p id="{uid}-summary" class="text-surface-700-300 text-sm">
						{deletion.summary ??
							"This cannot be undone. These go:"}
					</p>
					{#if deletion.objects.length}
					<ul
						class="border-surface-200-800 flex min-h-0 flex-col gap-3 overflow-y-auto rounded-[10px] border p-3 text-sm"
						aria-label="What will be deleted"
					>
						{#each deletion.objects as object, i (i)}
							<li>
								<span class="text-surface-950-50 font-medium">
									{object.label}
								</span>
								{#if object.related?.length}
									<ul class="mt-1 flex flex-col gap-1 pl-4">
										{#each object.related as rel, j (j)}
											<li class="text-surface-600-400 text-xs">
												<span class="text-surface-700-300">
													{rel.label}:
												</span>
												{rel.items.join(", ")}
											</li>
										{/each}
									</ul>
								{/if}
							</li>
						{/each}
					</ul>
					{/if}
					<footer class="flex flex-wrap justify-end gap-2">
						<button
							type="button"
							class="btn preset-tonal-surface"
							onclick={onCancel}
						>
							{deletion.objects.length ? "Cancel" : "Close"}
						</button>
						<!-- Nothing in the list means nothing can go (every
						     selected object is protected): no delete button. -->
						{#if deletion.objects.length}
							<button
								type="button"
								class="btn preset-filled-error-500"
								onclick={onConfirm}
							>
								<Icons.Trash2 size={16} aria-hidden="true" />
								{deletion.confirmLabel}
							</button>
						{/if}
					</footer>
				{/if}
			</Dialog.Content>
		</Dialog.Positioner>
	</Portal>
</Dialog>
