<script lang="ts">
	/**
	 * Admin → Connections → Add connection: the add form. A name and a
	 * service, the two things `connections:create` needs; everything else is
	 * set on the change form the create lands on, with the service's own
	 * defaults already filled in (the same seed the Connections view's New
	 * dialog uses).
	 *
	 * Save goes back to the changelist, Save and continue editing opens the
	 * new connection's change form, Save and add another clears this form.
	 */
	import { onMount } from "svelte"
	import * as Icons from "@lucide/svelte"
	import { useTypedSocket } from "$lib/client/sockets/typedSocket"
	import { useInterest } from "$lib/client/sockets/interest.svelte"
	import {
		adminGoto,
		adminUnsavedEdits
	} from "$lib/client/admin/adminRouter.svelte"
	import { toaster } from "$lib/client/utils/toaster"
	import { CONNECTION_TYPE } from "$lib/shared/constants/ConnectionTypes"
	import {
		CONNECTION_DEFAULTS,
		OPENAI_COMPATIBLE_PRESETS
	} from "$lib/shared/utils/connectionDefaults"
	import type { ConnectionServiceItem } from "$lib/shared/utils/connectionServiceItems"
	import ConnectionServicePicker from "$lib/client/components/sidebars/ConnectionServicePicker.svelte"
	import AdminChangeForm, {
		type AdminSaveIntent
	} from "$lib/client/components/admin/AdminChangeForm.svelte"
	import AdminFieldset from "$lib/client/components/admin/AdminFieldset.svelte"
	import AdminField, { describedBy } from "$lib/client/components/admin/AdminField.svelte"

	const socket = useTypedSocket()

	let names = $state<string[]>([])
	useInterest<"connections:list">("connections:list", (msg) => {
		names = msg.connectionsList.map((c) => (c.name ?? "").trim().toLowerCase())
	})
	onMount(() => socket.emit("connections:list", {}))

	let name = $state("")
	let service = $state<ConnectionServiceItem | undefined>()
	/** A typed name is the person's; a picked service only fills an empty one. */
	let nameTouched = $state(false)
	$effect(() => {
		if (service && !nameTouched) name = service.label
	})

	let saving = $state(false)
	/** Typed-but-not-added is an unsaved edit; a landed create is not. */
	let landed = false
	adminUnsavedEdits(() => !landed && (!!name.trim() || !!service))
	let pendingIntent = $state<AdminSaveIntent | null>(null)
	let nameError = $state<string | null>(null)
	let serviceError = $state<string | null>(null)
	let formErrors = $state<string[]>([])
	/** Bumped to remount the picker empty after Save and add another. */
	let formKey = $state(0)

	function save(intent: AdminSaveIntent) {
		const trimmed = name.trim()
		nameError = !trimmed
			? "A connection needs a name."
			: names.includes(trimmed.toLowerCase())
				? `A connection named "${trimmed}" already exists.`
				: null
		serviceError = service ? null : "Choose the service this connection talks to."
		formErrors = []
		if (nameError || serviceError || !service) return
		const { type, presetValue, presetSlug } = service
		const preset =
			type === CONNECTION_TYPE.OPENAI
				? OPENAI_COMPATIBLE_PRESETS.find((p) => p.value === presetValue)
				: undefined
		if (type === CONNECTION_TYPE.OPENAI && !preset) {
			serviceError = "That service preset is not known."
			return
		}
		saving = true
		pendingIntent = intent
		socket.emit("connections:create", {
			connection: {
				name: trimmed,
				type,
				enabled: true,
				preset: presetSlug,
				...(preset ? preset.connectionDefaults : (CONNECTION_DEFAULTS[type] ?? {}))
			} as any
		})
	}

	function handleCreate(msg: Sockets.Connections.Create.Response) {
		// emitToUser reaches every open view; only this form's own create moves it.
		if (!pendingIntent || !msg.connection?.id) return
		if ((msg.connection.name ?? "").trim() !== name.trim()) return
		const intent = pendingIntent
		pendingIntent = null
		saving = false
		toaster.success({ title: `Added ${msg.connection.name}` })
		if (intent !== "another") landed = true
		if (intent === "continue") void adminGoto(`/admin/connections/${msg.connection.id}`)
		else if (intent === "save") void adminGoto("/admin/connections")
		else {
			names = [...names, name.trim().toLowerCase()]
			name = ""
			service = undefined
			nameTouched = false
			formKey++
		}
	}
	function handleCreateError(msg: { error?: string }) {
		if (!pendingIntent) return
		pendingIntent = null
		saving = false
		const error = msg.error ?? "The connection was not created."
		if (/name/i.test(error)) nameError = error
		else formErrors = [error]
	}
	useInterest<"connections:create">("connections:create", handleCreate)
	useInterest<"connections:create:error">("connections:create:error", handleCreateError)
</script>

<AdminChangeForm
	mode="add"
	title="Add connection"
	purpose="Pick the service and name it. Its address, key and models are set on the next screen."
	noun="connection"
	changelistHref="/admin/connections"
	changelistLabel="Connections"
	{saving}
	dirty={!!name.trim() || !!service}
	errors={formErrors}
	fieldErrors={{ "new-connection-name": nameError, "new-connection-service": serviceError }}
	onSave={save}
>
	<AdminFieldset title="Service">
		{#key formKey}
			<div data-field="new-connection-service" id="new-connection-service" tabindex="-1">
				<ConnectionServicePicker
					bind:selectedItem={service}
					label="Service"
				/>
			</div>
		{/key}
		{#if serviceError}
			<p class="text-error-600-400 flex items-center gap-1.5 text-xs">
				<Icons.CircleAlert size={14} aria-hidden="true" />
				{serviceError}
			</p>
		{/if}
	</AdminFieldset>

	<AdminFieldset title="Identity">
		<AdminField
			id="new-connection-name"
			label="Name"
			required
			error={nameError}
			help="What pickers and the Connections view call it. Unique across this pub."
		>
			<input
				id="new-connection-name"
				class="input"
				type="text"
				bind:value={name}
				oninput={() => (nameTouched = true)}
				aria-invalid={!!nameError}
				aria-describedby={describedBy("new-connection-name", !!nameError)}
			/>
		</AdminField>
	</AdminFieldset>
</AdminChangeForm>
