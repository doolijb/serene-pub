<script lang="ts">
	import { PromptFormats } from "$lib/shared/constants/PromptFormats"
	import { TokenCounterOptions } from "$lib/shared/constants/TokenCounters"
	import { CONNECTION_DEFAULTS } from "$lib/shared/utils/connectionDefaults"
	import { CONNECTION_TYPE } from "$lib/shared/constants/ConnectionTypes"
	import { Switch } from "@skeletonlabs/skeleton-svelte"
	import { onMount, onDestroy } from "svelte"
	import { useTypedSocket } from "$lib/client/sockets/typedSocket"
	import { z } from "zod"

	interface ExtraFieldData {
		stream: boolean
		think: boolean
		keepAliveNumber: number
		keepAliveUnit: string
		useChat: boolean
	}

	interface ExtraJson {
		stream?: boolean
		think?: boolean
		keepAlive?: string
		useChat?: boolean
	}

	// Zod validation schema
	const ollamaConnectionSchema = z.object({
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
	const defaultExtraJson =
		CONNECTION_DEFAULTS[CONNECTION_TYPE.OLLAMA].extraJson

	let availableOllamaModels: any[] = $state([])
	let ollamaFields: ExtraFieldData | undefined = $state()
	let validationErrors: ValidationErrors = $state({})

	socket.on("connections:refreshModels", (msg) => {
		if (msg.models) availableOllamaModels = msg.models
	})

	socket.on("connections:test", (msg) => {
		testResult = msg
	})

	function handleRefreshModels() {
		socket.emit("connections:refreshModels", {
			connection
		})
	}

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
			model: connection.model || "",
			baseUrl: connection.baseUrl || ""
		}

		const result = ollamaConnectionSchema.safeParse(data)

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

	// let isValid = $derived.by(() => {
	// 	return (
	// 		connection &&
	// 		connection.type === "ollama" &&
	// 		connection.baseUrl &&
	// 		connection.model
	// 	)
	// })

	function extraJsonToExtraFields(extraJson: ExtraJson): ExtraFieldData {
		return {
			stream: extraJson.stream || false,
			think: extraJson.think || false,
			useChat: extraJson.useChat ?? true,
			keepAliveNumber: extraJson.keepAlive
				? parseInt(extraJson.keepAlive) || 300
				: 300,
			keepAliveUnit: extraJson.keepAlive
				? extraJson.keepAlive.replace(/^[0-9]+/, "")
				: "ms"
		}
	}

	function extraFieldsToExtraJson(fields: ExtraFieldData): ExtraJson {
		return {
			stream: fields.stream,
			think: fields.think,
			keepAlive: `${fields.keepAliveNumber}${fields.keepAliveUnit}`,
			useChat: fields.useChat ?? true
		}
	}

	$effect(() => {
		const _ollamaFields = ollamaFields
		if (_ollamaFields) {
			connection.extraJson = extraFieldsToExtraJson(_ollamaFields)
		}
	})

	onMount(() => {
		if (connection.extraJson) {
			const extraJson = { ...defaultExtraJson, ...connection.extraJson }
			ollamaFields = extraJsonToExtraFields(extraJson)
		} else {
			ollamaFields = extraJsonToExtraFields(defaultExtraJson)
		}
		handleRefreshModels()
	})

	onDestroy(() => {
		socket.off("refreshModels")
		socket.off("testConnection")
	})
</script>

{#if connection}
	<div class="mt-2 flex flex-col gap-1">
		<label class="font-semibold" for="model">Model</label>
		<select
			id="model"
			bind:value={connection.model}
			class="select bg-background border-muted w-full rounded border"
		>
			<option value="">-- Select Model --</option>
			{#each availableOllamaModels as m}
				<option value={m.model}>{m.name}</option>
			{/each}
		</select>
	</div>
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
	{#if !ollamaFields?.useChat}
		<div class="mt-2 flex flex-col gap-1">
			<label class="font-semibold" for="promptFormat">
				Prompt Format
			</label>
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
	{/if}
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
				placeholder="http://localhost:11434/"
				required
				class="input"
			/>
		</div>
		{#if ollamaFields}
			<div class="mt-2 flex flex-col gap-1">
				<label class="font-semibold" for="keepAlive">Keep Alive</label>
				<div class="flex items-center gap-2">
					<input
						id="keepAliveNumber"
						type="number"
						min="0"
						bind:value={ollamaFields.keepAliveNumber}
						class="input bg-background border-muted w-32 rounded border"
					/>
					<select
						id="keepAliveUnit"
						bind:value={ollamaFields.keepAliveUnit}
						class="select bg-background border-muted w-24 rounded border"
					>
						<option value="ms">ms</option>
						<option value="s">s</option>
						<option value="m">m</option>
						<option value="h">h</option>
					</select>
				</div>
			</div>
			<section class="w-full space-y-4 pt-4">
				<div class="flex items-center justify-between gap-4">
					<label class="font-semibold" for="useChat">
						Use Chat Mode
					</label>
					<Switch
						name="useChat"
						checked={ollamaFields.useChat}
						onCheckedChange={(e) =>
							(ollamaFields!.useChat = e.checked)}
						aria-labelledby="useChat"
					>
						<Switch.Control class="preset-filled-surface-300-700 data-[state=checked]:preset-filled-primary-500">
							<Switch.Thumb />
						</Switch.Control>
						<Switch.HiddenInput />
					</Switch>
				</div>
				<div class="flex items-center justify-between gap-4">
					<label class="font-semibold" for="stream">Stream</label>
					<Switch
						name="stream"
						checked={ollamaFields.stream}
						onCheckedChange={(e) =>
							(ollamaFields!.stream = e.checked)}
						aria-labelledby="stream"
					>
						<Switch.Control class="preset-filled-surface-300-700 data-[state=checked]:preset-filled-primary-500">
							<Switch.Thumb />
						</Switch.Control>
						<Switch.HiddenInput />
					</Switch>
				</div>
				<div class="flex items-center justify-between gap-4">
					<label class="font-semibold" for="think">Think</label>
					<Switch
						name="think"
						checked={ollamaFields.think}
						onCheckedChange={(e) =>
							(ollamaFields!.think = e.checked)}
						aria-labelledby="think"
					>
						<Switch.Control class="preset-filled-surface-300-700 data-[state=checked]:preset-filled-primary-500">
							<Switch.Thumb />
						</Switch.Control>
						<Switch.HiddenInput />
					</Switch>
				</div>
			</section>
		{/if}
	</details>
{/if}
