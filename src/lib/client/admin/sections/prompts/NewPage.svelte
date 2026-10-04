<script lang="ts">
	/**
	 * Admin › Prompts › Add prompt: the add form. A prompt's fields are its
	 * step's, so a new one always starts as a copy of an existing prompt —
	 * pick it (grouped by step) and name the new one. The text is written on
	 * the change form the create lands on: "Save and continue editing" is the
	 * usual press.
	 *
	 * `?from=<id>` preselects the prompt to start from: the change form's
	 * Duplicate and "Save and add another" land here. The server makes the
	 * copy (`pipelines:libraryClonePrompt`, which answers with `createdId`)
	 * and keeps the name unique within the step.
	 */
	import * as Icons from "@lucide/svelte"
	import { useTypedSocket } from "$lib/client/sockets/typedSocket"
	import { requestWithInterest, useInterest } from "$lib/client/sockets/interest.svelte"
	import {
		adminGoto,
		adminPage,
		adminUnsavedEdits
	} from "$lib/client/admin/adminRouter.svelte"
	import { toaster } from "$lib/client/utils/toaster"
	import Select from "$lib/client/components/inputs/Select.svelte"
	import AdminChangeForm, {
		type AdminSaveIntent
	} from "$lib/client/components/admin/AdminChangeForm.svelte"
	import AdminFieldset from "$lib/client/components/admin/AdminFieldset.svelte"
	import AdminField, { describedBy } from "$lib/client/components/admin/AdminField.svelte"

	type Prompt = Sockets.Pipelines.Library.LibraryPrompt

	const socket = useTypedSocket()

	let prompts = $state<Prompt[]>([])
	let loading = $state(true)
	let name = $state("")
	let startFrom = $state("")
	$effect(() =>
		requestWithInterest("pipelines:library", {}, (res) => {
			prompts = (res.prompts ?? []) as Prompt[]
			if (loading) {
				loading = false
				const from = adminPage.url.searchParams.get("from")
				if (from && prompts.some((p) => String(p.id) === from)) startFrom = from
			}
		})
	)

	const source = $derived(prompts.find((p) => String(p.id) === startFrom))
	const options = $derived(
		[...prompts]
			.sort(
				(a, b) =>
					a.poolLabel.localeCompare(b.poolLabel) || a.name.localeCompare(b.name)
			)
			.map((p) => ({
				value: String(p.id),
				label: p.name,
				group: p.poolLabel,
				hint: p.isImmutable ? "Built-in" : undefined
			}))
	)
	const dirty = $derived(!!name.trim() || (!!startFrom && !adminPage.url.searchParams.get("from")))
	adminUnsavedEdits(() => dirty && !saving)

	let saving = $state(false)
	let pendingIntent: AdminSaveIntent | null = null
	let sourceError = $state<string | null>(null)
	let formErrors = $state<string[]>([])

	function save(intent: AdminSaveIntent) {
		sourceError = source ? null : "Pick the prompt to start from."
		formErrors = []
		if (!source) return
		saving = true
		pendingIntent = intent
		socket.emit("pipelines:libraryClonePrompt", {
			id: source.id,
			...(name.trim() ? { name: name.trim() } : {})
		})
	}
	useInterest<"pipelines:libraryClonePrompt">("pipelines:libraryClonePrompt", (res) => {
		const intent = pendingIntent
		if (!intent) return
		pendingIntent = null
		saving = false
		const made = ((res.library?.prompts ?? []) as Prompt[]).find((p) => p.id === res.createdId)
		toaster.success({ title: `Added ${made?.name ?? "the prompt"}` })
		name = ""
		if (intent === "save") void adminGoto("/admin/prompts")
		else if (intent === "continue" && res.createdId)
			void adminGoto(`/admin/prompts/${res.createdId}`, { replaceState: true })
		else void adminGoto(`/admin/prompts/new${startFrom ? `?from=${startFrom}` : ""}`)
	})
	useInterest<"pipelines:libraryClonePrompt:error">(
		"pipelines:libraryClonePrompt:error",
		(res) => {
			if (!pendingIntent) return
			pendingIntent = null
			saving = false
			formErrors = [res.error ?? "The prompt was not added."]
		}
	)
</script>

<AdminChangeForm
	mode="add"
	title="Add prompt"
	purpose="A new prompt starts as a copy of one already written for the same step; you change its text next."
	noun="prompt"
	changelistHref="/admin/prompts"
	changelistLabel="Prompts"
	{dirty}
	{saving}
	errors={formErrors}
	fieldErrors={{ "prompt-new-source": sourceError }}
	onSave={save}
>
	<AdminFieldset title="Prompt">
		<div class="grid gap-4 @min-[36rem]/content:grid-cols-2">
			<AdminField
				id="prompt-new-source"
				label="Start from"
				required
				error={sourceError}
				help="Its step decides where the new prompt is offered; its text is copied."
			>
				<Select
					label="Start from"
					labelHidden
					{options}
					bind:value={startFrom}
					placeholder={loading ? "Loading prompts…" : "Pick a prompt"}
					invalid={!!sourceError}
					describedBy={describedBy("prompt-new-source", !!sourceError)}
				/>
			</AdminField>
			<AdminField
				id="prompt-new-name"
				label="Name"
				help={source ? `Left empty: "${source.name} (copy)".` : "Unique within its step."}
			>
				<input
					id="prompt-new-name"
					class="input"
					type="text"
					bind:value={name}
					aria-describedby={describedBy("prompt-new-name", false)}
				/>
			</AdminField>
		</div>
		{#if source}
			<p class="text-surface-600-400 flex items-center gap-1.5 text-xs">
				<Icons.Info size={14} aria-hidden="true" />
				Step: {source.poolLabel}
			</p>
		{/if}
	</AdminFieldset>
</AdminChangeForm>
