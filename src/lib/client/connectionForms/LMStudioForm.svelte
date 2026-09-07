<script lang="ts">
	import { PromptFormats } from "$lib/shared/constants/PromptFormats"
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

	const socket = useTypedSocket()
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
	let extraFields = $state({
		stream: connection.extraJson?.stream ?? true,
		think: connection.extraJson?.think ?? false,
		ttl: connection.extraJson?.ttl ?? 60,
		raw: connection.extraJson?.raw ?? true,
		useSession: connection.extraJson?.useSession ?? true
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
		{#if !extraFields.useSession}
			<Select
				class="mt-2"
				label="Prompt Format"
				options={PromptFormats.options}
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
				bind:checked={extraFields.think}
				onchange={() => {
					connection.extraJson = {
						...connection.extraJson,
						think: extraFields.think
					}
					handleChange()
				}}
			/>
			Think
		</label>
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
			<!-- Use Session toggle -->
			<div class="mt-2 flex items-center gap-2">
				<label class="font-semibold" for="useSession">
					Use Session Mode
				</label>
				<input
					type="checkbox"
					id="useSession"
					bind:checked={extraFields.useSession}
					onchange={() => {
						connection.extraJson = {
							...connection.extraJson,
							useSession: extraFields.useSession
						}
					}}
				/>
			</div>
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
