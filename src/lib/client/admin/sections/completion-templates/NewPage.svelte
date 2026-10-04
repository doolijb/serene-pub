<script lang="ts">
	/**
	 * Admin › Completion templates › Add completion template: the add form. A
	 * key (fixed once made — connections store it), a name, and where the
	 * delimiters start: another template's (`?from=<id>` preselects it) or a
	 * plain `### role` framing. The framing itself is edited on the change
	 * form "Save and continue editing" lands on.
	 */
	import Select from "$lib/client/components/inputs/Select.svelte"
	import { adminGoto, adminPage, adminUnsavedEdits } from "$lib/client/admin/adminRouter.svelte"
	import { useTypedSocket } from "$lib/client/sockets/loadSockets.client"
	import { getInterestContext } from "$lib/client/sockets/interest.svelte"
	import { toaster } from "$lib/client/utils/toaster"
	import { refreshCompletionTemplateOptions } from "$lib/client/stores/completionTemplateOptions.svelte"
	import AdminChangeForm, {
		type AdminSaveIntent
	} from "$lib/client/components/admin/AdminChangeForm.svelte"
	import AdminFieldset from "$lib/client/components/admin/AdminFieldset.svelte"
	import AdminField, { describedBy } from "$lib/client/components/admin/AdminField.svelte"

	const socket = useTypedSocket()
	const interest = getInterestContext()
	const ROLES = ["system", "user", "assistant", "model", "tool", "function"]

	let rows = $state<SelectCompletionTemplate[]>([])
	let loaded = false
	let name = $state("")
	let key = $state("")
	let from = $state("")
	const dirty = $derived(!!name.trim() || !!key.trim())
	adminUnsavedEdits(() => dirty && !saving)

	let saving = $state(false)
	let pendingIntent: AdminSaveIntent | null = null
	let formErrors = $state<string[]>([])
	let keyError = $state<string | null>(null)
	let nameError = $state<string | null>(null)

	$effect(() => {
		const releases = [
			interest.requestWithInterest("completionTemplates:list", {}, (res) => {
				rows = res.completionTemplatesList
				if (!loaded) {
					loaded = true
					const want = adminPage.url.searchParams.get("from")
					if (want && rows.some((r) => String(r.id) === want)) from = want
				}
			}),
			interest.declareInterest<"completionTemplates:create">("completionTemplates:create", (res) => {
				const intent = pendingIntent
				if (!intent) return
				pendingIntent = null
				saving = false
				refreshCompletionTemplateOptions()
				toaster.success({ title: `Added ${res.completionTemplate.name}` })
				name = ""
				key = ""
				if (intent === "save") void adminGoto("/admin/completion-templates")
				else if (intent === "continue")
					void adminGoto(`/admin/completion-templates/${res.completionTemplate.id}`, {
						replaceState: true
					})
			}),
			interest.declareInterest<"completionTemplates:create:error">(
				"completionTemplates:create:error",
				(res) => {
					if (!pendingIntent) return
					pendingIntent = null
					saving = false
					const error = res.error ?? "The template was not added."
					if (/key/i.test(error)) keyError = error
					else formErrors = [error]
				}
			)
		]
		return () => {
			for (const release of releases) release()
		}
	})

	function save(intent: AdminSaveIntent) {
		const k = key.trim()
		keyError = !k
			? "A completion template needs a key."
			: rows.some((r) => r.key === k)
				? "That key is taken."
				: null
		nameError = name.trim() ? null : "A completion template needs a name."
		formErrors = []
		if (keyError || nameError) return
		const src = rows.find((r) => String(r.id) === from)
		saving = true
		pendingIntent = intent
		socket.emit("completionTemplates:create", {
			completionTemplate: {
				key: k,
				name: name.trim(),
				renderMode: "flat",
				// Something to open with: a template that opens with nothing
				// for every role is refused on save.
				roles: src
					? src.roles
					: Object.fromEntries(ROLES.map((r) => [r, { prefix: `### ${r}\n`, suffix: "\n" }])),
				fallbackRole: src ? src.fallbackRole : { prefix: "### user\n", suffix: "\n" },
				stopStrings: src ? src.stopStrings : [],
				isSelectable: true
			} as any
		})
	}
</script>

<AdminChangeForm
	mode="add"
	title="Add completion template"
	purpose="Starts from another template's delimiters or a plain ### role framing; you shape the framing next."
	noun="completion template"
	changelistHref="/admin/completion-templates"
	changelistLabel="Completion templates"
	{dirty}
	{saving}
	errors={formErrors}
	fieldErrors={{ "ct-new-key": keyError, "ct-new-name": nameError }}
	onSave={save}
>
	<AdminFieldset title="Template">
		<div class="grid gap-4 @min-[36rem]/content:grid-cols-2">
			<AdminField id="ct-new-name" label="Name" required error={nameError}>
				<input
					id="ct-new-name"
					class="input"
					type="text"
					bind:value={name}
					aria-invalid={!!nameError}
					aria-describedby={describedBy("ct-new-name", !!nameError)}
				/>
			</AdminField>
			<AdminField
				id="ct-new-key"
				label="Key"
				required
				error={keyError}
				help="Stored on every connection that selects it, so it cannot change later."
			>
				<input
					id="ct-new-key"
					class="input font-mono"
					type="text"
					bind:value={key}
					aria-invalid={!!keyError}
					aria-describedby={describedBy("ct-new-key", !!keyError)}
				/>
			</AdminField>
			<AdminField id="ct-new-from" label="Start from" help="The delimiters and stop strings are copied.">
				<Select
					label="Start from"
					labelHidden
					options={[
						{ value: "", label: "Plain ### role framing" },
						...rows.map((r) => ({ value: String(r.id), label: r.name }))
					]}
					bind:value={from}
					describedBy={describedBy("ct-new-from", false)}
				/>
			</AdminField>
		</div>
	</AdminFieldset>
</AdminChangeForm>
