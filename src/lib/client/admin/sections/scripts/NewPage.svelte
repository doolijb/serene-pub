<script lang="ts">
	/**
	 * Admin › Scripts › Add script: the add form. Pick the type (grouped by
	 * content scope — the type decides the variable space, the blast radius
	 * and where the script may attach) and name it; nothing is written until
	 * a Save. The source is written on the change form "Save and continue
	 * editing" lands on.
	 */
	import { getContext } from "svelte"
	import Select from "$lib/client/components/inputs/Select.svelte"
	import {
		adminGoto,
		adminUnsavedEdits
	} from "$lib/client/admin/adminRouter.svelte"
	import { useTypedSocket } from "$lib/client/sockets/loadSockets.client"
	import { declareInterest, requestWithInterest } from "$lib/client/sockets/interest.svelte"
	import { toaster } from "$lib/client/utils/toaster"
	import AdminChangeForm, {
		type AdminSaveIntent
	} from "$lib/client/components/admin/AdminChangeForm.svelte"
	import AdminFieldset from "$lib/client/components/admin/AdminFieldset.svelte"
	import AdminField, { describedBy } from "$lib/client/components/admin/AdminField.svelte"

	const userCtx: { user: SelectUser } = getContext("userCtx")
	const socket = useTypedSocket()

	let view = $state<Sockets.Pipelines.Scripts.Response>({})
	let loading = $state(true)
	let typeId = $state("")
	let name = $state("")
	/** Ids present before the create — the answer's new row is the one not here. */
	let priorIds = new Set<number>()

	adminUnsavedEdits(() => !!name.trim() && !saving)

	const selected = $derived((view.types ?? []).find((t) => t.typeId === typeId))
	const scopeLabel = (c: string) => c.charAt(0).toUpperCase() + c.slice(1)
	const options = $derived(
		(view.types ?? []).map((t) => ({ value: t.typeId, label: t.name, group: scopeLabel(t.content) }))
	)

	let saving = $state(false)
	let pendingIntent: AdminSaveIntent | null = null
	let formErrors = $state<string[]>([])
	let typeError = $state<string | null>(null)

	$effect(() => {
		if (!userCtx.user?.isAdmin) return
		const releases = [
			declareInterest<"pipelines:createScript">("pipelines:createScript", (res) => {
				const intent = pendingIntent
				if (!intent) return
				pendingIntent = null
				saving = false
				const created = res.scripts?.scripts?.find((s) => !priorIds.has(s.id))
				toaster.success({ title: `Added ${created?.name ?? "the script"}` })
				name = ""
				if (intent === "save") void adminGoto("/admin/scripts")
				else if (intent === "continue" && created)
					void adminGoto(`/admin/scripts/${created.id}`, { replaceState: true })
				else priorIds = new Set((res.scripts?.scripts ?? []).map((s) => s.id))
			}),
			declareInterest<"pipelines:createScript:error">("pipelines:createScript:error", (res) => {
				if (!pendingIntent) return
				pendingIntent = null
				saving = false
				formErrors = [res.error ?? "The script was not added."]
			}),
			requestWithInterest("pipelines:scripts", {}, (res) => {
				view = res
				loading = false
				if (!typeId && res.types?.length) typeId = res.types[0].typeId
			})
		]
		return () => {
			for (const release of releases) release()
		}
	})

	function save(intent: AdminSaveIntent) {
		typeError = typeId ? null : "Pick the script's type."
		formErrors = []
		if (typeError) return
		priorIds = new Set((view.scripts ?? []).map((s) => s.id))
		saving = true
		pendingIntent = intent
		socket.emit("pipelines:createScript", { typeId, name: name.trim() || undefined })
	}
</script>

<AdminChangeForm
	mode="add"
	title="Add script"
	purpose="Pick what kind of script it is; you write its source next."
	noun="script"
	changelistHref="/admin/scripts"
	changelistLabel="Scripts"
	dirty={!!name.trim()}
	{saving}
	canSave={!loading && !!options.length && !saving}
	errors={formErrors}
	fieldErrors={{ "script-new-type": typeError }}
	onSave={save}
>
	<AdminFieldset title="Script">
		{#if !loading && !options.length}
			<p class="text-surface-600-400 text-sm">
				No script types are registered. Core registers its own at startup, so an empty list
				usually means the type registry refused to sync — check the server log for a
				bootstrap warning.
			</p>
		{:else}
			<div class="grid gap-4 @min-[36rem]/content:grid-cols-2">
				<AdminField
					id="script-new-type"
					label="Type"
					required
					error={typeError}
					help="Decides what the script can read and rewrite, and where it attaches."
				>
					<Select
						label="Type"
						labelHidden
						{options}
						bind:value={typeId}
						placeholder={loading ? "Loading types…" : "Pick a type"}
						invalid={!!typeError}
						describedBy={describedBy("script-new-type", !!typeError)}
					/>
				</AdminField>
				<AdminField id="script-new-name" label="Name" help="Optional — a default is assigned.">
					<input
						id="script-new-name"
						class="input"
						type="text"
						bind:value={name}
						aria-describedby={describedBy("script-new-name", false)}
					/>
				</AdminField>
			</div>
			{#if selected}
				<div class="text-surface-600-400 text-xs">
					{#if selected.description}<p>{selected.description}</p>{/if}
					<p class="mt-1">
						<span class="preset-tonal-warning rounded-full px-1.5 py-0.5 text-[11px]">
							{selected.blastRadius}
						</span>
						· reads {[...selected.varsIn, ...selected.extras].join(", ") || "—"} · rewrites {selected.varsOut.join(", ") || "—"}
					</p>
				</div>
			{/if}
		{/if}
	</AdminFieldset>
</AdminChangeForm>
