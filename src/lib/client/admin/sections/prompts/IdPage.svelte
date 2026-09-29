<script lang="ts">
	/**
	 * One prompt's dedicated change page (Django change form). A prompt is a
	 * name plus named text fields, belonging to a **step** rather than to a
	 * pipeline; built-in rows are read-only here — clone to make an editable
	 * variant. Every write answers with the refreshed library view.
	 *
	 * Two things this page has to keep apart, because the row does:
	 *
	 *  - **the pool** (`poolLabel`) is what the prompt is for, and it is not a
	 *    pipeline: this row is offered in every pipeline that reuses its
	 *    step, so the heading never names one pipeline as its owner. Where it
	 *    was *written* is a secondary line.
	 *  - **`fields` and `archived`** are two different columns and must not be
	 *    rendered as one list. An archived key is text off a field the step
	 *    stopped declaring; editing it would write it back into `fields`, where
	 *    the next boot's sweep would move it out again — a row ping-ponging
	 *    between two shapes forever. So archived text is read-only, below, with
	 *    Copy as the only thing you can do to it.
	 */
	import * as Icons from "@lucide/svelte"
	import { adminGoto as goto, adminUnsavedEdits } from "$lib/client/admin/adminRouter.svelte"
	import { UnsavedEdits } from "$lib/client/forms/unsavedEdits.svelte"
	import { adminPage as page } from "$lib/client/admin/adminRouter.svelte"
	import { useTypedSocket } from "$lib/client/sockets/loadSockets.client"
	import {
		requestWithInterest,
		useInterest
	} from "$lib/client/sockets/interest.svelte"
	import { toaster } from "$lib/client/utils/toaster"
	import { getContext, untrack } from "svelte"
	import { ADMIN_SPLIT } from "$lib/client/components/admin/AdminSplit.svelte"

	type Prompt = Sockets.Pipelines.Library.LibraryPrompt

	const socket = useTypedSocket()
	const split = getContext<{ mode: "desk" | "compact" } | undefined>(
		ADMIN_SPLIT
	)
	let id = $derived(Number(page.params.id))

	let view = $state<Sockets.Pipelines.Library.Response>({})
	let loading = $state(true)
	let name = $state("")
	let fields = $state<Record<string, string>>({})

	let row = $derived(
		((view.prompts ?? []) as Prompt[]).find((r) => r.id === id)
	)
	let readonly = $derived(!!row?.isImmutable)

	/**
	 * Every push of the library moves the saved snapshot; only a clean form
	 * is overwritten by it, so another tab's save never wipes what is typed
	 * here and the echo of this page's own save makes it clean.
	 */
	const edits = new UnsavedEdits(() => ({ name, fields }))
	$effect(() => {
		if (loading || !row) return
		const next = { name: row.name, fields: { ...row.fields } }
		untrack(() =>
			edits.adoptSaved(next, (n) => {
				name = n.name
				fields = { ...n.fields }
			})
		)
	})
	let dirty = $derived(edits.dirty)
	adminUnsavedEdits(() => edits.dirty)

	function handleLibrary(res: Sockets.Pipelines.Library.Response) {
		view = res
		loading = false
	}
	function handleWrite(res: Sockets.Pipelines.Library.Response) {
		view = res
	}
	function handleError(res: { error?: string }) {
		toaster.error({ title: res.error ?? "The library refused the edit." })
	}

	const WRITE_EVENTS = [
		"pipelines:libraryUpdatePrompt",
		"pipelines:libraryClonePrompt",
		"pipelines:libraryDeletePrompt"
	] as const

	/**
	 * Every write on this page answers with the refreshed view, and a refusal
	 * answers on the `:error` name — both arrive when the person presses the
	 * button, not in reply to anything asked here, so their interest stands.
	 * One `useInterest` call per key: each is its own `$effect`, released with
	 * the page. BARE — the library is the instance's, not one session's.
	 */
	for (const ev of WRITE_EVENTS) {
		useInterest<"pipelines:libraryUpdatePrompt">(ev, handleWrite)
		useInterest<"pipelines:libraryUpdatePrompt:error">(
			`${ev}:error`,
			handleError
		)
	}

	/** The library view, asked for and listened for in one. BARE, same reason. */
	$effect(() => requestWithInterest("pipelines:library", {}, handleLibrary))

	function save() {
		if (!row) return
		socket.emit("pipelines:libraryUpdatePrompt", { id, name, fields })
		toaster.success({ title: "Prompt saved" })
	}
	function clone() {
		socket.emit("pipelines:libraryClonePrompt", { id })
		toaster.success({ title: "Prompt cloned" })
		goto("/admin/prompts")
	}
	/**
	 * Copy archived text, rather than restore it.
	 *
	 * The step does not declare the field, so putting the text back would put
	 * it where nothing reads it. Copying hands it to the person, who knows
	 * which prompt or pipeline it belongs in now — which is exactly what
	 * "recover/archive so the user can reference/copy it later" asks for.
	 */
	async function copyArchived(text: string) {
		try {
			await navigator.clipboard.writeText(text)
			toaster.success({ title: "Copied to the clipboard" })
		} catch {
			toaster.error({
				title: "Could not reach the clipboard. Select the text and copy it."
			})
		}
	}

	function remove() {
		if (!row) return
		if (
			!confirm(
				row.usedBy.length
					? `'${row.name}' is still used by ${row.usedBy.join(", ")}. ` +
							`The server will refuse until those point somewhere else. Try anyway?`
					: `Delete '${row.name}'? Nothing is using it.`
			)
		)
			return
		socket.emit("pipelines:libraryDeletePrompt", { id })
		edits.forget()
		goto("/admin/prompts")
	}
</script>

{#if split?.mode !== "desk"}
	<a
		href="/admin/prompts"
		class="text-surface-600-400 hover:text-surface-950-50 mb-3 inline-flex items-center gap-1 self-start text-[13px]"
	>
		<Icons.ChevronLeft size={14} /> Back to prompts
	</a>
{/if}

<div class="mb-4 flex flex-wrap items-center gap-3">
	<div class="min-w-0 flex-1">
		<h2
			class="text-surface-950-50 flex flex-wrap items-center gap-2 [font-family:var(--typo-heading--font-family)] text-base font-semibold"
		>
			{row?.name ?? "Prompt"}
			{#if readonly}
				<span
					class="preset-tonal-surface rounded-full px-2 py-0.5 font-sans text-xs font-normal"
				>
					built-in · read-only
				</span>
			{/if}
		</h2>
		{#if row}
			<p class="text-surface-600-400 text-sm">
				Step: {row.poolLabel}
			</p>
			{#if row.origin}
				<!-- Secondary, and phrased as history rather than ownership:
				     this row is offered in every pipeline reusing the step
				     above, and editing it reaches all of them. -->
				<p class="text-surface-600-400 text-xs">
					Written in {row.origin} — edits reach every pipeline using this
					step.
				</p>
			{/if}
		{/if}
	</div>
</div>

{#if loading}
	<p class="text-surface-600-400 text-sm">Loading…</p>
{:else if !row}
	<div class="panel-card text-surface-600-400 py-8 text-center text-sm">
		This prompt no longer exists.
		<a class="underline" href="/admin/prompts">Back to the list</a>
		.
	</div>
{:else}
	<div class="flex flex-col gap-4">
		<div class="panel-card flex flex-col gap-3">
			<label class="flex max-w-md flex-col gap-1 text-sm">
				<span class="font-medium">Name</span>
				<input class="input" bind:value={name} {readonly} />
			</label>

			<!-- The declared fields, editable. `row.fields` only — never merged
		     with `row.archived`; keeping them apart is why the two are separate
		     columns. -->
			{#each Object.keys(row.fields) as field (field)}
				<label class="flex flex-col gap-1 text-sm">
					<span class="font-medium">{field}</span>
					<textarea
						class="textarea w-full font-mono text-xs"
						rows={readonly ? 4 : 8}
						{readonly}
						spellcheck="false"
						bind:value={fields[field]}
					></textarea>
				</label>
			{/each}

			{#if row.usedBy.length}
				<p class="text-surface-600-400 text-xs">
					Used by: {row.usedBy.join(", ")}
				</p>
			{/if}

			<div class="flex flex-wrap items-center gap-2">
				{#if !readonly}
					<button
						class="btn btn-sm preset-filled-primary-500"
						disabled={!dirty}
						onclick={save}
					>
						<Icons.Save size={14} /> Save
					</button>
				{/if}
				<div class="flex-1"></div>
				<button class="btn btn-sm preset-tonal-surface" onclick={clone}>
					<Icons.Copy size={14} /> Clone
				</button>
				{#if !readonly}
					<button
						class="btn btn-sm preset-tonal-error"
						onclick={remove}
					>
						<Icons.Trash2 size={14} /> Delete
					</button>
				{/if}
			</div>
		</div>
		{#if Object.keys(row.archived ?? {}).length}
			<div class="panel-card flex flex-col gap-3">
				<p class="text-surface-600-400 text-xs">
					<Icons.Archive size={12} class="inline" />
					<strong>Archived.</strong>
					This step no longer has
					{Object.keys(row.archived).length === 1
						? "this field"
						: "these fields"}, so the text is kept here rather than
					lost. Read-only: it is copied somewhere it is still used,
					not edited back into a field nothing reads.
				</p>
				{#each Object.entries(row.archived) as [field, text] (field)}
					<div class="flex flex-col gap-1 text-sm">
						<div class="flex items-center gap-2">
							<span class="flex-1 font-medium">{field}</span>
							<button
								class="btn btn-sm preset-tonal-surface shrink-0"
								onclick={() => copyArchived(text)}
							>
								<Icons.Copy size={13} /> Copy
							</button>
						</div>
						<textarea
							class="textarea w-full font-mono text-xs opacity-70"
							rows="4"
							readonly
							spellcheck="false"
							value={text}
						></textarea>
					</div>
				{/each}
			</div>
		{/if}
	</div>
{/if}
