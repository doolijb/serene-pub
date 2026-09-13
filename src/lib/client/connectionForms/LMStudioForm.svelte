<script lang="ts">
	import { completionTemplateOptions } from "$lib/client/stores/completionTemplateOptions.svelte"
	import { connectionWireMode } from "$lib/client/stores/connectionWireMode.svelte"
	import { usesCompletionTemplate } from "$lib/shared/connectionAdapters/wireMode"
	import { TokenCounterOptions } from "$lib/shared/constants/TokenCounters"
	import Select from "$lib/client/components/inputs/Select.svelte"
	import { onMount, onDestroy } from "svelte"
	import { useTypedSocket } from "$lib/client/sockets/typedSocket"
	import { z } from "zod"

	// Zod validation schema
	const lmStudioConnectionSchema = z.object({
		model: z.string().min(1, "Model is required"),
		baseUrl: z
			.string()
			.url("Invalid URL format")
			.min(1, "Base URL is required")
	})

	type ValidationErrors = Record<string, string>

	interface Props {
		connection: SelectConnection
	}

	let { connection = $bindable() } = $props()

	/**
	 * A completion template only means something in COMPLETION wire mode.
	 *
	 * In chat mode the roles carry the structure: no delimiter is emitted and no
	 * stop string from the template is sent, so the picker below would be a
	 * saved preference that changes no byte of any request. Same "no control
	 * without an effect" rule the retrieval audit applied.
	 *
	 * Read through the store rather than off `connection.capabilities`, so the
	 * wire-mode switches in the capability panel underneath take effect here at
	 * once — that panel deliberately never writes into `connection`.
	 */
	const wireMode = connectionWireMode()
	const showFormat = $derived(usesCompletionTemplate(wireMode.of(connection)))

	const socket = useTypedSocket()
	/**
	 * The format picker's options, read from `completion_templates` instead of
	 * the eight-entry constant that used to sit beside the table — so a template
	 * an admin authored is offered by the one control that selects it. Falls back
	 * to the built-ins until the reply lands.
	 */
	const formatOptions = completionTemplateOptions()
	let availableLMStudioModels: { model: string; name: string }[] = $state([])
	// The picker takes { value, label }; LM Studio reports the id under `model`
	// and the display name under `name`.
	let modelOptions = $derived(
		availableLMStudioModels.map((m) => ({ value: m.model, label: m.name }))
	)
	let testResult: {
		ok: boolean
		error?: string | null
		models?: any[]
	} | null = $state(null)
	let validationErrors: ValidationErrors = $state({})

	// Initialize extraFields from connection.extraJson, but don't make it reactive to connection changes
	/**
	 * ⚠ `think` is gone from here (ruling 2026-09-12): reasoning is a SAMPLING
	 * parameter now, chosen per stage on the sampling config rather than once
	 * for every stage this connection serves. It was doubly dead, since no LM
	 * Studio adapter ever read `extraJson.think`, but a commented-out control
	 * is still a thing somebody uncomments. Do not re-add it.
	 */
	let extraFields = $state({
		stream: connection.extraJson?.stream ?? true,
		ttl: connection.extraJson?.ttl ?? 60,
		raw: connection.extraJson?.raw ?? true
	})

	function handleRefreshModels() {
		socket.emit("connections:refreshModels", {
			connection
		})
	}

	function handleTestConnection() {
		if (!validateConnection()) return
		testResult = null
		socket.emit("connections:test", {
			connection
		})
	}

	function validateConnection(): boolean {
		const data = {
			model: connection.model || "",
			baseUrl: connection.baseUrl || ""
		}

		const result = lmStudioConnectionSchema.safeParse(data)

		if (result.success) {
			validationErrors = {}
			return true
		} else {
			const errors: ValidationErrors = {}
			result.error.errors.forEach((error) => {
				if (error.path.length > 0) {
					errors[error.path[0] as string] = error.message
				}
			})
			validationErrors = errors
			return false
		}
	}

	const onConnectionsRefreshModels = (
		msg: Sockets.Connections.RefreshModels.Response
	) => {
		if (msg.models) availableLMStudioModels = msg.models
		if (!connection.model && msg.models.length > 0) {
			connection.model = msg.models[0].model
		}
	}
	socket.on("connections:refreshModels", onConnectionsRefreshModels)

	// Named so `off` can name it too. A bare `socket.off("connections:test")`
	// removes EVERY listener for that event — including the parent sidebar's,
	// which then stops updating for the rest of the session.
	const onConnectionsTest = (msg: Sockets.Connections.Test.Response) => {
		testResult = msg
	}
	socket.on("connections:test", onConnectionsTest)

	onMount(() => {
		if (connection.baseUrl) {
			handleRefreshModels()
		}
	})

	onDestroy(() => {
		socket.off("connections:refreshModels", onConnectionsRefreshModels)
		socket.off("connections:test", onConnectionsTest)
	})
</script>

<div class="flex flex-col gap-4">
	<div class="mt-2 flex flex-col gap-1">
		<Select
			label="Model"
			options={modelOptions}
			bind:value={connection.model}
			placeholder="-- Select Model --"
			emptyMessage="No models — try Refresh Models."
			clearable
			required
			invalid={!!validationErrors.model}
			describedBy={validationErrors.model ? "model-error" : undefined}
			onValueChange={() => {
				if (validationErrors.model) {
					const { model, ...rest } = validationErrors
					validationErrors = rest
				}
			}}
		/>
		{#if validationErrors.model}
			<p
				id="model-error"
				class="text-error-500 mt-1 text-sm"
				role="alert"
			>
				{validationErrors.model}
			</p>
		{/if}
		<div class="mt-4 flex gap-2">
			<button
				type="button"
				class="btn btn-sm preset-tonal-primary w-full"
				onclick={handleRefreshModels}
			>
				Refresh Models
			</button>
			<button
				type="button"
				class="btn preset-tonal-success btn-sm w-full"
				onclick={handleTestConnection}
				disabled={Object.keys(validationErrors).length > 0}
			>
				{#if testResult?.ok === true}
					Test: Okay!
				{:else if testResult?.ok === false}
					Test: Failed!
				{:else}
					Test Connection
				{/if}
			</button>
		</div>
		{#if showFormat}
			<Select
				class="mt-2"
				label="Prompt Format"
				options={formatOptions.value}
				bind:value={connection.promptFormat}
			/>
		{/if}
		<Select
			class="mt-2"
			label="Token Counter"
			options={TokenCounterOptions.options}
			bind:value={connection.tokenCounter}
		/>
	</div>
	<!-- <div class="flex gap-4">
		<label class="flex items-center gap-2">
			<input
				type="checkbox"
				bind:checked={extraFields.raw}
				onchange={() => {
					connection.extraJson = {
						...connection.extraJson,
						raw: extraFields.raw
					}
					handleChange()
				}}
			/>
			Raw
		</label> 
	</div>-->
	<details class="mt-2">
		<summary class="cursor-pointer font-semibold">
			Advanced Settings
		</summary>
		<div class="mt-2 flex flex-col gap-1">
			<div class="mt-2 flex flex-col gap-1">
				<label class="font-semibold" for="baseUrl">Base URL</label>
				<input
					id="baseUrl"
					type="text"
					bind:value={connection.baseUrl}
					placeholder="ws://localhost:1234"
					required
					class="input {validationErrors.baseUrl
						? 'border-error-500'
						: ''}"
					aria-invalid={validationErrors.baseUrl ? "true" : "false"}
					aria-describedby={validationErrors.baseUrl
						? "baseUrl-error"
						: undefined}
					oninput={() => {
						if (validationErrors.baseUrl) {
							const { baseUrl, ...rest } = validationErrors
							validationErrors = rest
						}
					}}
				/>
				{#if validationErrors.baseUrl}
					<p
						id="baseUrl-error"
						class="text-error-500 mt-1 text-sm"
						role="alert"
					>
						{validationErrors.baseUrl}
					</p>
				{/if}
			</div>
			<!-- "Use Session Mode" lived here. It is a CAPABILITY now —
			     Chat messages / Text completion, in the Capabilities panel
			     below, graded through the same four layers as everything else
			     and with a hand-set value outranking every later test. -->
			<div class="mt-2 flex items-center gap-2">
				<label class="font-semibold" for="stream">Stream</label>
				<input
					type="checkbox"
					id="stream"
					name="stream"
					bind:checked={extraFields.stream}
					onchange={() => {
						connection.extraJson = {
							...connection.extraJson,
							stream: extraFields.stream
						}
					}}
				/>
			</div>
			<div class="mt-2 flex flex-col gap-1">
				<label class="font-semibold" for="ttl">
					Keep Alive (seconds)
				</label>
				<input
					id="ttl"
					type="number"
					bind:value={extraFields.ttl}
					class="input"
					placeholder="60"
					min="1"
					onchange={() => {
						connection.extraJson = {
							...connection.extraJson,
							ttl: extraFields.ttl
						}
					}}
				/>
			</div>
		</div>
	</details>
	{#if testResult?.error}
		<div class="text-error mt-1 text-xs">{testResult.error}</div>
	{/if}
</div>
