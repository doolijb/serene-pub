<script lang="ts" module>
	/** What a save should do next: leave, stay, or start another. */
	export type AdminSaveIntent = "save" | "continue" | "another"
</script>

<script lang="ts">
	/**
	 * Django admin's change form, for any admin object: the breadcrumb trail
	 * back to its changelist (`AdminPageHeader` draws it), the header (the object's name, a History link, the
	 * section's own extra actions), an error summary, the caller's
	 * `AdminFieldset`s, and the **save row** pinned to the foot of the pane.
	 *
	 * The save row is Django's, in its order: Delete at the start (a quiet
	 * destructive link, never the primary), then Save and add another, Save
	 * and continue editing, and **Save** — the one filled primary. The form
	 * does not save anything itself: `onSave(intent)` hands the intent to the
	 * page, which owns the socket and decides where each intent lands.
	 *
	 * Delete asks first: the form gives its place to `AdminDeleteConfirm`
	 * (Django's confirmation page, breadcrumb "… › <object> › Delete"),
	 * listing what the page says goes with the object (`deletion()`), and
	 * only "Delete <thing>" there calls `onDelete`.
	 *
	 * Ctrl/Cmd+S inside the form is Save and continue editing.
	 *
	 * ⚠ Dirty state is the page's (`dirty`), computed with the shared form
	 * equality (`forms/sameFormValue.ts`). Leaving with unsaved edits is
	 * guarded by the shared tracker when a page wires one — this component
	 * only shows the state.
	 */
	import type { Snippet } from "svelte"
	import * as Icons from "@lucide/svelte"
	import AdminPageHeader from "./AdminPageHeader.svelte"
	import AdminDeleteConfirm from "./AdminDeleteConfirm.svelte"
	import RowMenu from "$lib/client/components/menus/RowMenu.svelte"
	import type { AdminDeletion } from "./changelist"
	import type { AdminCrumb } from "./breadcrumbs"

	interface Props {
		/** The object's name, or "Add connection". */
		title: string
		/** One sentence under the title. */
		purpose?: string
		/** "add" hides Delete and History and always allows Save. */
		mode: "add" | "change"
		/** "connection" — for the button words. */
		noun: string
		/** The changelist: the breadcrumb's first step. */
		changelistHref: string
		/** "Connections". */
		changelistLabel: string
		dirty?: boolean
		saving?: boolean
		/** Save is offered only when this is true (default: add, or dirty). */
		canSave?: boolean
		/** Errors that belong to no one field. */
		errors?: readonly string[]
		/** Field id → message, listed in the summary; the field shows its own. */
		fieldErrors?: Record<string, string | null | undefined>
		/** `/admin/history?type=…&id=…` — change mode only. */
		historyHref?: string
		/** Extra header actions (tonal; the save row owns the primary). */
		headerActions?: Snippet
		/** Chips and status under the title. */
		headerExtra?: Snippet
		/** What a delete takes, asked for when Delete is pressed. */
		deletion?: () => AdminDeletion
		onDelete?: () => void
		onSave: (intent: AdminSaveIntent) => void
		/** Hide "Save and add another" (objects that are made elsewhere). */
		addAnother?: boolean
		/** Steps between the section and this object (a preset under its genre). */
		trail?: readonly AdminCrumb[]
		/** Tonal buttons in the save row, after the unsaved-changes words (Review, Discard). */
		saveRowExtra?: Snippet
		children: Snippet
	}
	let {
		title,
		purpose,
		mode,
		noun,
		changelistHref,
		changelistLabel,
		dirty = false,
		saving = false,
		canSave,
		errors = [],
		fieldErrors = {},
		historyHref,
		headerActions,
		headerExtra,
		deletion,
		onDelete,
		onSave,
		addAnother = true,
		trail = [],
		saveRowExtra,
		children
	}: Props = $props()

	const saveable = $derived(!saving && (canSave ?? (mode === "add" || dirty)))
	const fieldErrorList = $derived(
		Object.entries(fieldErrors).filter(
			(e): e is [string, string] => !!e[1]
		)
	)
	const hasErrors = $derived(errors.length > 0 || fieldErrorList.length > 0)

	let pendingDeletion = $state<AdminDeletion | null>(null)
	function askDelete() {
		if (!deletion) return
		pendingDeletion = deletion()
	}

	function focusField(id: string) {
		const el = document.getElementById(id)
		el?.scrollIntoView({ block: "center", behavior: "smooth" })
		el?.focus({ preventScroll: true })
	}

	function handleKeydown(e: KeyboardEvent) {
		if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "s") {
			e.preventDefault()
			if (saveable) onSave("continue")
		}
	}
</script>

{#if pendingDeletion}
	<AdminDeleteConfirm
		deletion={pendingDeletion}
		trail={[...trail, { label: title, onclick: () => (pendingDeletion = null) }]}
		onCancel={() => (pendingDeletion = null)}
		onConfirm={() => {
			pendingDeletion = null
			onDelete?.()
		}}
	/>
{:else}
<!-- svelte-ignore a11y_no_static_element_interactions -->
<div class="flex min-w-0 flex-1 flex-col" onkeydown={handleKeydown}>

	<AdminPageHeader {title} {purpose} {trail}>
		{#snippet actions()}
			{@render headerActions?.()}
			{#if mode === "change" && historyHref}
				<a class="btn btn-sm preset-tonal-surface" href={historyHref}>
					<Icons.History size={16} aria-hidden="true" />
					History
				</a>
			{/if}
		{/snippet}
		{@render headerExtra?.()}
	</AdminPageHeader>

	{#if hasErrors}
		<div
			class="panel-card border-error-500/60! mb-4 flex flex-col gap-2"
			role="alert"
		>
			<p class="text-error-600-400 flex items-center gap-2 text-sm font-medium">
				<Icons.CircleAlert size={16} aria-hidden="true" />
				{fieldErrorList.length + errors.length === 1
					? "Please correct the error below."
					: "Please correct the errors below."}
			</p>
			<ul class="flex flex-col gap-1 pl-6 text-sm">
				{#each errors as message, i (i)}
					<li class="text-surface-950-50">{message}</li>
				{/each}
				{#each fieldErrorList as [id, message] (id)}
					<li>
						<button
							type="button"
							class="text-surface-950-50 text-left underline underline-offset-2"
							onclick={() => focusField(id)}
						>
							{message}
						</button>
					</li>
				{/each}
			</ul>
		</div>
	{/if}

	<div class="flex min-w-0 flex-col gap-3">
		{@render children()}
	</div>

	<!-- The save row. Sticky, so Save is in reach at the end of a long form
	     and at the top of a short one alike; on the pane's own ground so the
	     fields scroll under it. -->
	<div
		class="border-surface-200-800 bg-surface-50-950 sticky -bottom-6 z-10 -mx-5 mt-4 flex flex-wrap items-center gap-2 border-t px-5 py-3"
		role="toolbar"
		aria-label="Save {noun}"
	>
		{#if mode === "change" && deletion && onDelete}
			<button
				type="button"
				class="btn btn-sm text-error-600-400 hover:preset-tonal-error"
				onclick={askDelete}
				disabled={saving}
			>
				<Icons.Trash2 size={16} aria-hidden="true" />
				Delete
			</button>
		{/if}
		<span
			class="text-surface-600-400 mr-auto flex min-h-8 items-center gap-1.5 text-xs"
			aria-live="polite"
		>
			{#if saving}
				<Icons.LoaderCircle size={14} class="animate-spin" aria-hidden="true" />
				Saving…
			{:else if dirty}
				<span class="bg-primary-500 size-2 rounded-full" aria-hidden="true"
				></span>
				Unsaved changes
			{/if}
		</span>
		{@render saveRowExtra?.()}
		<!-- From 36rem of pane the three saves stand side by side; narrower
		     (the 400px dock) it is a split button (STYLE-GUIDE §6.1): Save,
		     and a chevron holding the two that stay or start another. -->
		<div class="flex flex-wrap items-center justify-end gap-2">
			{#if addAnother}
				<button
					type="button"
					class="btn btn-sm preset-tonal-surface hidden @min-[36rem]/content:inline-flex"
					disabled={!saveable}
					onclick={() => onSave("another")}
				>
					Save and add another
				</button>
			{/if}
			<button
				type="button"
				class="btn btn-sm preset-tonal-surface hidden @min-[36rem]/content:inline-flex"
				disabled={!saveable}
				onclick={() => onSave("continue")}
				title="Ctrl+S"
			>
				Save and continue editing
			</button>
			<span class="inline-flex items-center gap-0.5">
				<button
					type="button"
					class="btn btn-sm preset-filled-primary-500"
					disabled={!saveable}
					onclick={() => onSave("save")}
				>
					<Icons.Save size={16} aria-hidden="true" />
					Save
				</button>
				<span class="@min-[36rem]/content:hidden">
					<RowMenu
						label="More ways to save"
						triggerLabel="More ways to save"
						triggerClass="btn btn-sm preset-filled-primary-500 px-2"
						placement="top-end"
						disabled={!saveable}
						items={[
							{ label: "Save and continue editing", icon: Icons.Save, onSelect: () => onSave("continue") },
							addAnother && { label: "Save and add another", icon: Icons.Plus, onSelect: () => onSave("another") }
						]}
					>
						{#snippet trigger()}
							<Icons.ChevronUp size={16} aria-hidden="true" />
						{/snippet}
					</RowMenu>
				</span>
			</span>
		</div>
	</div>
</div>

{/if}
