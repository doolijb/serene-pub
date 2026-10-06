<script lang="ts">
	/**
	 * Admin › Prompts › one prompt: the change form (Django admin). A prompt
	 * is a name plus named text fields, belonging to a **step** rather than to
	 * a pipeline; built-in rows are read-only here — Duplicate makes an
	 * editable variant (`/admin/prompts/new?from=<id>`). Fieldsets:
	 *
	 * - **Identity** — name; step, origin and where it was written, readonly.
	 * - **Text** — the step's declared fields.
	 * - **Pipelines** (inline) — every pipeline with a step that can pick it,
	 *   and whether it picks it now; each opens that pipeline's workspace.
	 * - **Archived** (collapsed) — text off fields the step does not
	 *   declare: read-only, Copy only. `fields` and `archived` are two
	 *   columns and never one list — editing archived text would write it
	 *   back into `fields`, where the next boot's sweep moves it out again.
	 *
	 * Every write answers with the refreshed library view (`res.library`).
	 */
	import { untrack } from "svelte"
	import * as Icons from "@lucide/svelte"
	import { useTypedSocket } from "$lib/client/sockets/typedSocket"
	import { requestWithInterest, useInterest } from "$lib/client/sockets/interest.svelte"
	import {
		adminGoto,
		adminPage,
		adminUnsavedEdits
	} from "$lib/client/admin/adminRouter.svelte"
	import { UnsavedEdits } from "$lib/client/forms/unsavedEdits.svelte"
	import { toaster } from "$lib/client/utils/toaster"
	import AdminChangeForm, {
		type AdminSaveIntent
	} from "$lib/client/components/admin/AdminChangeForm.svelte"
	import AdminFieldset from "$lib/client/components/admin/AdminFieldset.svelte"
	import AdminField, { describedBy } from "$lib/client/components/admin/AdminField.svelte"
	import AdminInline from "$lib/client/components/admin/AdminInline.svelte"
	import { pipelinesFitting, promptDeletion } from "./promptsAdmin"

	type Prompt = Sockets.Pipelines.Library.LibraryPrompt
	type Pipeline = Sockets.Pipelines.Library.LibraryPipeline
	type Draft = { name: string; fields: Record<string, string> }

	const socket = useTypedSocket()
	const id = $derived(Number(adminPage.params.id))
	const validId = $derived(Number.isInteger(id) && id > 0)

	let view = $state<Sockets.Pipelines.Library.Response>({})
	let loading = $state(true)
	const row = $derived(((view.prompts ?? []) as Prompt[]).find((r) => r.id === id))
	const readOnly = $derived(!!row?.isImmutable)

	let draft = $state<Draft | undefined>(undefined)
	const edits = new UnsavedEdits(() => draft)
	adminUnsavedEdits(() => edits.dirty)
	const toDraft = (r: Prompt): Draft => ({ name: r.name, fields: { ...r.fields } })

	/**
	 * Every push of the library moves the saved snapshot; only a clean form
	 * is overwritten by it, so another tab's save never wipes what is typed
	 * here and the echo of this page's own save makes it clean.
	 */
	$effect(() => {
		if (loading || !row) return
		const next = toDraft(row)
		untrack(() => {
			if (draft === undefined) {
				draft = next
				edits.markSaved()
			} else edits.adoptSaved(next, (d) => (draft = d))
		})
	})

	$effect(() =>
		requestWithInterest("pipelines:library", {}, (res) => {
			view = res
			loading = false
		})
	)

	// ── save ────────────────────────────────────────────────────────────
	let saving = $state(false)
	let pendingIntent: AdminSaveIntent | null = null
	let formErrors = $state<string[]>([])
	let nameError = $state<string | null>(null)

	function save(intent: AdminSaveIntent) {
		if (!draft || !row || readOnly) return
		const name = draft.name.trim()
		nameError = name ? null : "A prompt needs a name."
		formErrors = []
		if (nameError) return
		draft.name = name
		if (!edits.dirty) return land(intent)
		saving = true
		pendingIntent = intent
		const snap = $state.snapshot(draft)
		socket.emit("pipelines:libraryUpdatePrompt", { id, name: snap.name, fields: snap.fields })
	}
	function land(intent: AdminSaveIntent) {
		if (intent === "save") void adminGoto("/admin/prompts")
		else if (intent === "another") void adminGoto(`/admin/prompts/new?from=${id}`)
	}
	useInterest<"pipelines:libraryUpdatePrompt">("pipelines:libraryUpdatePrompt", (res) => {
		if (res.library) view = res.library
		const mine = pendingIntent
		if (!mine) return
		pendingIntent = null
		saving = false
		const saved = ((res.library?.prompts ?? []) as Prompt[]).find((r) => r.id === id)
		if (saved) {
			draft = toDraft(saved)
			edits.markSaved()
		}
		toaster.success({ title: `Saved ${saved?.name ?? "the prompt"}` })
		land(mine)
	})
	useInterest<"pipelines:libraryUpdatePrompt:error">(
		"pipelines:libraryUpdatePrompt:error",
		(res) => {
			if (!pendingIntent) return
			pendingIntent = null
			saving = false
			const error = res.error ?? "The prompt was not saved."
			if (/name/i.test(error)) nameError = error
			else formErrors = [error]
		}
	)

	// ── delete ──────────────────────────────────────────────────────────
	let deleting = false
	function remove() {
		if (!row || readOnly) return
		deleting = true
		socket.emit("pipelines:libraryDeletePrompt", { id })
	}
	useInterest<"pipelines:libraryDeletePrompt">("pipelines:libraryDeletePrompt", (res) => {
		if (res.library) view = res.library
		if (!deleting) return
		deleting = false
		edits.forget()
		toaster.success({ title: "Prompt deleted" })
		void adminGoto("/admin/prompts", { replaceState: true })
	})
	useInterest<"pipelines:libraryDeletePrompt:error">(
		"pipelines:libraryDeletePrompt:error",
		(res) => {
			if (!deleting) return
			deleting = false
			formErrors = [res.error ?? "The prompt was not deleted."]
		}
	)

	/**
	 * Copy archived text, rather than restore it: the step does not declare
	 * the field, so putting the text back would put it where nothing reads it.
	 */
	async function copyArchived(text: string) {
		try {
			await navigator.clipboard.writeText(text)
			toaster.success({ title: "Copied to the clipboard" })
		} catch {
			toaster.error({ title: "Could not reach the clipboard. Select the text and copy it." })
		}
	}

	const title = $derived(draft?.name.trim() || row?.name || "Prompt")
	const fitting = $derived(row ? pipelinesFitting(row, (view.pipelines ?? []) as Pipeline[]) : [])
	const archived = $derived(Object.entries(row?.archived ?? {}))
</script>

{#if !validId}
	<!-- Between addresses: nothing to show for a frame. -->
{:else if loading}
	<div
		class="text-surface-600-400 flex items-center justify-center gap-2 py-16 text-sm"
		role="status"
	>
		<Icons.LoaderCircle size={16} class="animate-spin" aria-hidden="true" />
		Loading prompt…
	</div>
{:else if !row || !draft}
	<div class="m-auto flex flex-col items-center gap-3 py-16 text-center">
		<p class="text-surface-600-400 text-sm">There is no prompt {id}.</p>
		<a href="/admin/prompts" class="btn btn-sm preset-tonal-surface">All prompts</a>
	</div>
{:else}
	<AdminChangeForm
		mode="change"
		{title}
		purpose={readOnly
			? "A built-in prompt: read-only. Duplicate it to make one you can change."
			: "Edits reach every pipeline whose step picks this prompt."}
		noun="prompt"
		changelistHref="/admin/prompts"
		changelistLabel="Prompts"
		dirty={edits.dirty}
		{saving}
		canSave={readOnly ? false : undefined}
		errors={formErrors}
		fieldErrors={{ "prompt-admin-name": nameError }}
		deletion={readOnly ? undefined : () => promptDeletion([row!])}
		onDelete={readOnly ? undefined : remove}
		onSave={save}
	>
		{#snippet headerActions()}
			<a href="/admin/prompts/new?from={id}" class="btn btn-sm preset-tonal-surface">
				<Icons.Copy size={16} aria-hidden="true" />
				Duplicate
			</a>
		{/snippet}
		{#snippet headerExtra()}
			<div class="flex flex-wrap items-center gap-1.5 text-xs">
				<span class="border-surface-300-700 text-surface-600-400 rounded-full border px-2 py-0.5">
					{row!.poolLabel}
				</span>
				{#if readOnly}
					<span class="border-surface-300-700 text-surface-600-400 rounded-full border px-2 py-0.5">
						Built-in
					</span>
				{/if}
			</div>
		{/snippet}

		<AdminFieldset title="Identity">
			<div class="grid gap-4 @min-[36rem]/content:grid-cols-3">
				{#if readOnly}
					<AdminField id="prompt-admin-name" label="Name" value={draft.name} />
				{:else}
					<AdminField
						id="prompt-admin-name"
						label="Name"
						required
						error={nameError}
						help="Unique within its step."
					>
						<input
							id="prompt-admin-name"
							class="input"
							type="text"
							bind:value={draft.name}
							aria-invalid={!!nameError}
							aria-describedby={describedBy("prompt-admin-name", !!nameError)}
						/>
					</AdminField>
				{/if}
				<AdminField id="prompt-admin-step" label="Step" value={row.poolLabel} />
				<AdminField
					id="prompt-admin-origin"
					label="Origin"
					value={(readOnly ? "Built-in" : "Custom") +
						(row.origin ? ` · written in ${row.origin}` : "")}
				/>
			</div>
		</AdminFieldset>

		<AdminFieldset
			title="Text"
			description="The fields this step declares. Each is sent where the step places it."
		>
			{#each Object.keys(draft.fields) as field (field)}
				<AdminField id="prompt-admin-field-{field}" label={field}>
					<textarea
						id="prompt-admin-field-{field}"
						class="textarea w-full font-mono text-xs"
						rows={readOnly ? 4 : 8}
						readonly={readOnly}
						spellcheck="false"
						bind:value={draft.fields[field]}
					></textarea>
				</AdminField>
			{:else}
				<p class="text-surface-600-400 text-sm">This step declares no text fields.</p>
			{/each}
		</AdminFieldset>

		<AdminInline
			title="Pipelines"
			description="Every pipeline with a step that can pick this prompt. Picking happens in the pipeline's settings."
			rows={fitting}
			rowKey={(p) => p.slug}
			columns={[
				{ key: "name", label: "Pipeline", primary: true, text: (p) => p.label },
				{
					key: "genres",
					label: "Genres",
					text: (p) => (p.genres ?? []).map((g) => g.name).join(", ") || "—"
				},
				{
					key: "picks",
					label: "Picks it now",
					// `usedBy` names pipelines by label: four genres' "Reply" are four.
					text: (p) => (row!.usedBy.includes(p.label) ? "Yes" : "No")
				}
			]}
			rowHref={(p) => `/admin/pipelines/${encodeURIComponent(p.slug)}`}
			emptyMessage="No installed pipeline has a step that reads this prompt's pool."
		/>

		{#if archived.length}
			<AdminFieldset
				title="Archived"
				description="Text off fields this step no longer declares, kept rather than lost. Read-only: copy it somewhere it is still used."
				collapsible
			>
				{#each archived as [field, text] (field)}
					<div class="flex flex-col gap-1 text-sm">
						<div class="flex items-center gap-2">
							<span class="flex-1 font-medium">{field}</span>
							<button
								type="button"
								class="btn btn-sm preset-tonal-surface shrink-0"
								onclick={() => copyArchived(text)}
							>
								<Icons.Copy size={13} aria-hidden="true" /> Copy
							</button>
						</div>
						<textarea
							class="textarea w-full font-mono text-xs opacity-70"
							rows="4"
							readonly
							spellcheck="false"
							aria-label="Archived {field}"
							value={text}
						></textarea>
					</div>
				{/each}
			</AdminFieldset>
		{/if}
	</AdminChangeForm>
{/if}
