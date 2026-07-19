<script lang="ts">
	import { PromptFormats } from "$lib/shared/constants/PromptFormats"
	import { TokenCounterOptions } from "$lib/shared/constants/TokenCounters"
	import { onMount, onDestroy } from "svelte"
	import { useTypedSocket } from "$lib/client/sockets/typedSocket"
	import { z } from "zod"

	interface ExtraFieldData {
		stream: boolean
	}

	interface ExtraJson {
		stream?: boolean
	}

	// Zod validation schema
	const llamaCppConnectionSchema = z.object({
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
	const defaultExtraJson = {
		stream: false
	}

	let llamaCppFields: ExtraFieldData | undefined = $state()
	let validationErrors: ValidationErrors = $state({})

	socket.on("connections:test", (msg) => {
		testResult = { ok: msg.ok, error: msg.error ?? undefined, models: msg.models }
	})

	let testResult: { ok: boolean; error?: string; models?: any[] } | null =
		$state(null)

	function handleTestConnection() {
		if (!validateConnection()) return
		testResult = null
		socket.emit("connections:test", {
			connection
		})
	}

	function validateConnection(): boolean {
		const data = {
			baseUrl: connection.baseUrl || ""
		}

		const result = llamaCppConnectionSchema.safeParse(data)

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

	let isValid = $derived.by(() => {
		return (
			connection &&
			connection.type === "llamacpp" &&
			connection.baseUrl &&
			connection.model
		)
	})

	function extraJsonToExtraFields(extraJson: ExtraJson): ExtraFieldData {
		return {
			stream: extraJson.stream || false
		}
	}

	function extraFieldsToExtraJson(fields: ExtraFieldData): ExtraJson {
		return {
			stream: fields.stream
		}
	}

	$effect(() => {
		const _llamaCppFields = llamaCppFields
		if (_llamaCppFields) {
			connection.extraJson = extraFieldsToExtraJson(_llamaCppFields)
		}
	})

	onMount(() => {
		if (connection.extraJson) {
			const extraJson = { ...defaultExtraJson, ...connection.extraJson }
			llamaCppFields = extraJsonToExtraFields(extraJson)
		} else {
			llamaCppFields = extraJsonToExtraFields(defaultExtraJson)
		}
	})

	onDestroy(() => {
		socket.off("connections:test")
	})
</script>

{#if connection}
	<div class="mt-4 flex gap-2">
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
	<div class="mt-2 flex flex-col gap-1">
		<label class="font-semibold" for="promptFormat">Prompt Format</label>
		<select
			id="promptFormat"
			class="select bg-background border-muted w-full rounded border"
			bind:value={connection.promptFormat}
		>
			{#each PromptFormats.options as option}
				<option value={option.value}>{option.label}</option>
			{/each}
		</select>
	</div>
	<div class="mt-2 flex flex-col gap-1">
		<label class="font-semibold" for="tokenCounter">Token Counter</label>
		<select
			id="tokenCounter"
			bind:value={connection.tokenCounter}
			class="select bg-background border-muted w-full rounded border"
		>
			{#each TokenCounterOptions.options as t}
				<option value={t.value}>{t.label}</option>
			{/each}
		</select>
	</div>
	<details class="mt-4">
		<summary class="cursor-pointer font-semibold">
			Advanced Settings
		</summary>
		<div class="mt-2 flex flex-col gap-1">
			<label class="font-semibold" for="baseUrl">Base URL</label>
			<input
				id="baseUrl"
				type="text"
				bind:value={connection.baseUrl}
				placeholder="http://localhost:8080/"
				required
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
		{#if llamaCppFields}
			<div class="mt-2 flex flex-col gap-1">
				<label class="font-semibold" for="stream">Stream</label>
				<input
					id="stream"
					type="checkbox"
					bind:checked={llamaCppFields.stream}
					class="input bg-background border-muted h-6 w-6 rounded border"
				/>
			</div>
		{/if}
	</details>
{/if}
