<script lang="ts">
	import { TokenCounterOptions } from "$lib/shared/constants/TokenCounters"
	import { Switch } from "@skeletonlabs/skeleton-svelte"
	import { onMount, onDestroy } from "svelte"
	import { useTypedSocket } from "$lib/client/sockets/loadSockets.client"
	import { z } from "zod"

	interface ExtraFieldData {
		stream: boolean
		apiKey: string
		thinking: boolean
		thinkingBudget: number
	}

	interface ExtraJson {
		stream?: boolean
		apiKey?: string
		thinking?: boolean
		thinkingBudget?: number
	}

	const schema = z.object({
		model: z.string().min(1, "Model is required"),
		apiKey: z.string().min(1, "API key is required")
	})

	type ValidationErrors = Record<string, string>

	let { connection = $bindable() }: { connection: SelectConnection } = $props()

	const socket = useTypedSocket()
	const defaultExtraJson: ExtraFieldData = {
		stream: true,
		apiKey: "",
		thinking: false,
		thinkingBudget: 8000
	}

	let availableModels: any[] = $state([])
	let fields: ExtraFieldData | undefined = $state()
	let validationErrors: ValidationErrors = $state({})
	let testResult: { ok: boolean; error?: string | null } | null = $state(null)

	socket.on("connections:refreshModels", (msg) => {
		if (msg.models) availableModels = msg.models
	})

	socket.on("connections:test", (msg) => {
		testResult = msg
	})

	function handleRefreshModels() {
		socket.emit("connections:refreshModels", { connection })
	}

	function handleTestConnection() {
		if (!validateConnection()) return
		testResult = null
		socket.emit("connections:test", { connection })
	}

	function validateConnection(): boolean {
		const result = schema.safeParse({
			model: connection.model || "",
			apiKey: fields?.apiKey || ""
		})
		if (result.success) {
			validationErrors = {}
			return true
		}
		const errors: ValidationErrors = {}
		result.error.errors.forEach((e) => {
			if (e.path.length > 0) errors[e.path[0] as string] = e.message
		})
		validationErrors = errors
		return false
	}

	function extraJsonToFields(extraJson: ExtraJson): ExtraFieldData {
		return {
			stream: extraJson.stream ?? true,
			apiKey: extraJson.apiKey || "",
			thinking: extraJson.thinking ?? false,
			thinkingBudget: extraJson.thinkingBudget ?? 8000
		}
	}

	function fieldsToExtraJson(f: ExtraFieldData): ExtraJson {
		return {
			stream: f.stream,
			apiKey: f.apiKey,
			thinking: f.thinking,
			thinkingBudget: f.thinkingBudget
		}
	}

	$effect(() => {
		if (fields) {
			connection.extraJson = fieldsToExtraJson(fields)
		}
	})

	onMount(() => {
		fields = extraJsonToFields({ ...defaultExtraJson, ...(connection.extraJson || {}) })
		handleRefreshModels()
	})

	onDestroy(() => {
		socket.off("connections:refreshModels")
		socket.off("connections:test")
	})
</script>

{#if connection && fields}
	<div class="mt-2 flex flex-col gap-1">
		<label class="font-semibold" for="model">Model</label>
		<select
			id="model"
			bind:value={connection.model}
			class="select bg-background border-muted w-full rounded border {validationErrors.model
				? 'border-red-500'
				: ''}"
		>
			<option value="">-- Select Model --</option>
			{#each availableModels as m}
				<option value={m.id}>{m.name}</option>
			{/each}
		</select>
		{#if validationErrors.model}
			<p class="mt-1 text-sm text-red-500" role="alert">{validationErrors.model}</p>
		{/if}
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
	{#if testResult?.ok === false && testResult.error}
		<p class="mt-1 text-sm text-red-500" role="alert">{testResult.error}</p>
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

	<div class="mt-2 flex flex-col gap-1">
		<label class="font-semibold" for="apiKey">API Key</label>
		<input
			id="apiKey"
			type="password"
			bind:value={fields.apiKey}
			placeholder="sk-ant-..."
			class="input {validationErrors.apiKey ? 'border-red-500' : ''}"
		/>
		{#if validationErrors.apiKey}
			<p class="mt-1 text-sm text-red-500" role="alert">{validationErrors.apiKey}</p>
		{/if}
	</div>

	<details class="mt-4">
		<summary class="cursor-pointer font-semibold">Advanced Settings</summary>
		<section class="w-full space-y-4 pt-2">
			<div class="flex items-center justify-between gap-4">
				<label class="font-semibold" for="stream">Stream</label>
				<Switch
					name="stream"
					checked={fields.stream}
					onCheckedChange={(e) => (fields!.stream = e.checked)}
									/>
			</div>
			<div class="flex items-center justify-between gap-4">
				<div>
					<label class="font-semibold" for="thinking">Extended Thinking</label>
					<p class="text-muted-foreground text-xs">Requires Claude 3.7+ models</p>
				</div>
				<Switch
					name="thinking"
					checked={fields.thinking}
					onCheckedChange={(e) => (fields!.thinking = e.checked)}
									/>
			</div>
			{#if fields.thinking}
				<div class="flex flex-col gap-1">
					<label class="font-semibold" for="thinkingBudget">
						Thinking Budget Tokens
					</label>
					<input
						id="thinkingBudget"
						type="number"
						min="1024"
						max="32000"
						step="1024"
						bind:value={fields.thinkingBudget}
						class="input"
					/>
					<p class="text-muted-foreground text-xs">
						Max tokens the model can use for thinking (1024–32000)
					</p>
				</div>
			{/if}
		</section>
	</details>
{/if}
