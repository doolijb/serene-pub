<script lang="ts">
	import { useTypedSocket } from "$lib/client/sockets/typedSocket"
	import { onDestroy } from "svelte"
	import { z } from "zod"

	// Zod validation schema
	const chatGPTConnectionSchema = z.object({
		baseUrl: z
			.string()
			.url("Invalid URL format")
			.min(1, "Base URL is required"),
		model: z.string().min(1, "Model is required"),
		apiKey: z.string().min(1, "API key is required")
	})

	type ValidationErrors = Record<string, string>

	interface Props {
		connection: SelectConnection
	}

	let { connection = $bindable() } = $props()

	let testResult: { ok: boolean; error?: string } | null = $state(null)
	let validationErrors: ValidationErrors = $state({})
	const socket = useTypedSocket()
	function handleTestConnection() {
		if (!validateConnection()) return
		testResult = null
		socket.emit("connections:test", { connection })
	}

	function validateConnection(): boolean {
		const data = {
			baseUrl: connection.baseUrl || "",
			model: connection.model || "",
			apiKey: connection.apiKey || ""
		}

		const result = chatGPTConnectionSchema.safeParse(data)

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
	$effect(() => {
		function handleTest(msg) {
			testResult = msg
		}
		socket.on("connections:test", handleTest)
		return () => {
			socket.off && socket.off("connections:test", handleTest)
		}
	})

	onDestroy(() => {
		socket.off && socket.off("testConnection", handleTest)
	})
</script>

{#if connection}
	<div class="mt-2 flex flex-col gap-1">
		<label class="font-semibold" for="baseUrl">Base URL</label>
		<input
			id="baseUrl"
			type="text"
			bind:value={connection.baseUrl}
			class="input {validationErrors.baseUrl ? 'border-error-500' : ''}"
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
				class="mt-1 text-sm text-error-500"
				role="alert"
			>
				{validationErrors.baseUrl}
			</p>
		{/if}
	</div>
	<div class="mt-2 flex flex-col gap-1">
		<label class="font-semibold" for="model">Model</label>
		<input
			id="model"
			type="text"
			bind:value={connection.model}
			class="input {validationErrors.model ? 'border-error-500' : ''}"
			aria-invalid={validationErrors.model ? "true" : "false"}
			aria-describedby={validationErrors.model
				? "model-error"
				: undefined}
			oninput={() => {
				if (validationErrors.model) {
					const { model, ...rest } = validationErrors
					validationErrors = rest
				}
			}}
		/>
		{#if validationErrors.model}
			<p id="model-error" class="mt-1 text-sm text-error-500" role="alert">
				{validationErrors.model}
			</p>
		{/if}
	</div>
	<div class="mt-2 flex flex-col gap-1">
		<label class="font-semibold" for="enabled">Enabled</label>
		<input
			id="enabled"
			type="checkbox"
			bind:checked={connection.enabled}
			class="accent-primary"
		/>
	</div>
	<div class="mt-2 flex flex-col gap-1">
		<label class="font-semibold" for="chatgptApiKey">ChatGPT API Key</label>
		<input
			id="chatgptApiKey"
			type="password"
			bind:value={connection.apiKey}
			class="input {validationErrors.apiKey ? 'border-error-500' : ''}"
			aria-invalid={validationErrors.apiKey ? "true" : "false"}
			aria-describedby={validationErrors.apiKey
				? "apiKey-error"
				: undefined}
			oninput={() => {
				if (validationErrors.apiKey) {
					const { apiKey, ...rest } = validationErrors
					validationErrors = rest
				}
			}}
		/>
		{#if validationErrors.apiKey}
			<p id="apiKey-error" class="mt-1 text-sm text-error-500" role="alert">
				{validationErrors.apiKey}
			</p>
		{/if}
	</div>
	<button
		type="button"
		class="btn preset-filled-primary-500 mt-2 w-full"
		onclick={handleTestConnection}
		disabled={Object.keys(validationErrors).length > 0}
	>
		Test Connection
	</button>
	{#if testResult}
		<div class="mt-1 text-sm">
			{#if testResult.ok}
				<span class="text-success">Connection OK</span>
			{:else}
				<span class="text-error">{testResult.error}</span>
			{/if}
		</div>
	{/if}
{/if}
