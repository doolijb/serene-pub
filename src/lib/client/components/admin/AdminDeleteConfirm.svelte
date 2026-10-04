<script lang="ts">
	/**
	 * Django admin's "Are you sure?" **page**: what goes, and under each
	 * object what goes or changes with it (its models, the defaults it held,
	 * the pipelines still pointing at it). Shared by the changelist's
	 * "Delete selected …" bulk action and the change form's Delete, which each
	 * put this in place of themselves — the confirmation is a step of the
	 * pane with its own breadcrumb ("… › Delete"), not a dialog over it, so a
	 * long cascade list scrolls with the pane and nothing else competes.
	 *
	 * Cancel is the first, safe choice and takes the reader back where they
	 * were; the destructive button names the count it takes ("Delete 2
	 * connections"), never a bare "OK". When nothing listed can go (every
	 * selected object is protected) there is no delete button, only Back.
	 */
	import { onMount } from "svelte"
	import * as Icons from "@lucide/svelte"
	import AdminPageHeader from "./AdminPageHeader.svelte"
	import type { AdminDeletion } from "./changelist"
	import type { AdminCrumb } from "./breadcrumbs"

	interface Props {
		deletion: AdminDeletion
		onConfirm: () => void
		onCancel: () => void
		/** Steps between the section and "Delete" (the object being deleted). */
		trail?: readonly AdminCrumb[]
	}
	let { deletion, onConfirm, onCancel, trail = [] }: Props = $props()

	const uid = $props.id()
	let cancelEl = $state<HTMLButtonElement | null>(null)
	onMount(() => {
		cancelEl?.focus()
		cancelEl?.closest(".admin-content")?.scrollTo({ top: 0 })
	})
</script>

<section class="flex min-w-0 flex-col" aria-labelledby="{uid}-title">
	<AdminPageHeader title={deletion.title} crumb="Delete" {trail} sectionOnclick={onCancel} />
	<div class="panel-card flex flex-col gap-4">
		<p id="{uid}-title" class="text-surface-950-50 flex items-start gap-2 text-sm">
			<Icons.TriangleAlert
				size={18}
				class="text-error-600-400 mt-px shrink-0"
				aria-hidden="true"
			/>
			{deletion.summary ?? "This cannot be undone. These go:"}
		</p>
		{#if deletion.objects.length}
			<ul
				class="border-surface-200-800 flex flex-col gap-3 rounded-[10px] border p-3 text-sm"
				aria-label="What will be deleted"
			>
				{#each deletion.objects as object, i (i)}
					<li>
						<span class="text-surface-950-50 font-medium">{object.label}</span>
						{#if object.related?.length}
							<ul class="mt-1 flex flex-col gap-1 pl-4">
								{#each object.related as rel, j (j)}
									<li class="text-surface-600-400 text-xs">
										<span class="text-surface-700-300">{rel.label}:</span>
										{rel.items.join(", ")}
									</li>
								{/each}
							</ul>
						{/if}
					</li>
				{/each}
			</ul>
		{/if}
		<div class="flex flex-wrap items-center gap-2">
			<button
				bind:this={cancelEl}
				type="button"
				class="btn preset-tonal-surface"
				onclick={onCancel}
			>
				<Icons.ChevronLeft size={16} aria-hidden="true" />
				{deletion.objects.length ? "No, take me back" : "Back"}
			</button>
			{#if deletion.objects.length}
				<button type="button" class="btn preset-filled-error-500" onclick={onConfirm}>
					<Icons.Trash2 size={16} aria-hidden="true" />
					{deletion.confirmLabel}
				</button>
			{/if}
		</div>
	</div>
</section>
