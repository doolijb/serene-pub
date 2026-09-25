<script lang="ts">
	import { useTypedSocket } from "$lib/client/sockets/typedSocket"
	import { useInterest } from "$lib/client/sockets/interest.svelte"
	import { z } from "zod"

	// Zod validation schema
	const chatGPTConnectionSchema = z.object({
		baseUrl: z
			.string()
			.url("Invalid URL format")
			.min(1, "Base URL is required"),
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
	// Standing interest in the test result, released when this form unmounts.
	// The registry keeps ONE raw listener per event and fans it out, so the
	// parent sidebar's own interest is untouched by this form coming and going.
	useInterest<"connections:test">("connections:test", (msg) => {
		testResult = { ok: msg.ok, error: msg.error ?? undefined }
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
				class="text-error-500 mt-1 text-sm"
				role="alert"
			>
				{validationErrors.baseUrl}
			</p>
		{/if}
	</div>
	<!-- Model input removed: models live in the Models section below. -->
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
			<p
				id="apiKey-error"
				class="text-error-500 mt-1 text-sm"
				role="alert"
			>
				{validationErrors.apiKey}
			</p>
		{/if}
	</div>

	<!-- The Test button lives on the connection view's status card, not
	     here. Two Test buttons on one screen, styled differently and
	     reporting into different places, was the shipped state. -->
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
