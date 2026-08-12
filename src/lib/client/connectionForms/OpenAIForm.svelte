<script lang="ts">
	import { PromptFormats } from "$lib/shared/constants/PromptFormats"
	import { TokenCounterOptions } from "$lib/shared/constants/TokenCounters"
	import { Switch } from "@skeletonlabs/skeleton-svelte"
	import { onMount, onDestroy } from "svelte"
	import { useTypedSocket } from "$lib/client/sockets/loadSockets.client"
	import { z } from "zod"

	interface ExtraFieldData {
		stream: boolean
		apiKey: string
		prerenderPrompt: boolean
	}

	interface ExtraJson {
		stream?: boolean
		apiKey?: string
		prerenderPrompt: boolean
	}

	// Zod validation schema
	const openAIConnectionSchema = z.object({
		model: z.string().min(1, "Model is required"),
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

	const socket = useTypedSocket()
	const defaultExtraJson = {
		stream: false,
		apiKey: "",
		prerenderPrompt: false
	}

	let availableOpenAIModels: any[] = $state([])
	let openAIFields: ExtraFieldData | undefined = $state()
	let validationErrors: ValidationErrors = $state({})

	socket.on("connections:refreshModels", (msg) => {
		if (msg.models) availableOpenAIModels = msg.models
	})

	socket.on("connections:test", (msg) => {
		testResult = {
			ok: msg.ok,
			error: msg.error ?? undefined,
			models: msg.models
		}
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
			baseUrl: connection.baseUrl || "",
			apiKey: openAIFields?.apiKey || ""
		}

		const result = openAIConnectionSchema.safeParse(data)

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
	//     return connection && connection.type === "openai" && connection.baseUrl && connection.model
	// })

	function extraJsonToExtraFields(extraJson: ExtraJson): ExtraFieldData {
		return {
			stream: extraJson.stream ?? false,
			apiKey: extraJson.apiKey || "",
			prerenderPrompt: extraJson.prerenderPrompt ?? false
		}
	}

	function extraFieldsToExtraJson(fields: ExtraFieldData): ExtraJson {
		return {
			stream: fields.stream,
			apiKey: fields.apiKey,
			prerenderPrompt: fields.prerenderPrompt
		}
	}

	// Skips the FIRST write-back, which is the defaults normalization done in
	// onMount, not a user edit.
	//
	// onMount builds the field state from `{...defaults, ...connection.extraJson}`,
	// so it legitimately gains every default key the stored row lacked. Writing
	// that straight back into `connection` made the form differ from the
	// parent's `originalConnection` the instant it opened — the panel reported
	// unsaved changes with nothing touched, and then blocked closing behind a
	// destructive-sounding confirm. Real edits still write through, and a save
	// still persists the full normalized set.
	let extraJsonInitialized = false
	$effect(() => {
		const _openAIFields = openAIFields
		if (!_openAIFields) return
		// Computed on EVERY run, before the skip check, and deliberately so:
		// an effect only subscribes to the state it actually reads, and the
		// individual field values are read inside this call. Returning before
		// it — as a first attempt did — meant the effect never subscribed to
		// them, so later toggles re-triggered nothing and the form never went
		// dirty. Skip the WRITE, never the read.
		const nextExtraJson = extraFieldsToExtraJson(_openAIFields)
		// The first populated run is onMount's defaults normalization, not a
		// user edit — writing it back made the panel report unsaved changes the
		// instant it opened, then block closing behind a destructive confirm.
		if (!extraJsonInitialized) {
			extraJsonInitialized = true
			return
		}
		connection.extraJson = nextExtraJson
	})

	onMount(() => {
		if (connection.extraJson) {
			const extraJson = { ...defaultExtraJson, ...connection.extraJson }
			openAIFields = extraJsonToExtraFields(extraJson)
		} else {
			openAIFields = extraJsonToExtraFields(defaultExtraJson)
		}
		handleRefreshModels()
	})

	onDestroy(() => {
		socket.off("connections:refreshModels")
		socket.off("connections:test")
	})
</script>

{#if connection}
	<div class="mt-2 flex flex-col gap-1">
		<label class="font-semibold" for="model">Model</label>
		<select
			id="model"
			bind:value={connection.model}
			class="select bg-background border-muted w-full rounded border {validationErrors.model
				? 'border-error-500'
				: ''}"
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
		>
			<option value="">-- Select Model --</option>
			{#each availableOpenAIModels as m}
				<option value={m.id}>{m.id}</option>
			{/each}
		</select>
		{#if validationErrors.model}
			<p
				id="model-error"
				class="text-error-500 mt-1 text-sm"
				role="alert"
			>
				{validationErrors.model}
			</p>
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
	{#if openAIFields?.prerenderPrompt}
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
	<div class="mt-2 flex flex-col gap-1">
		<label class="font-semibold" for="baseUrl">Base URL</label>
		<input
			id="baseUrl"
			type="text"
			bind:value={connection.baseUrl}
			placeholder="https://api.openai.com/v1/"
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
				class="text-error-500 mt-1 text-sm"
				role="alert"
			>
				{validationErrors.baseUrl}
			</p>
		{/if}
	</div>
	{#if openAIFields}
		<div class="mt-2 flex flex-col gap-1">
			<label class="font-semibold" for="apiKey">API Key</label>
			<input
				id="apiKey"
				type="password"
				bind:value={openAIFields.apiKey}
				placeholder="sk-..."
				class="input {validationErrors.apiKey
					? 'border-error-500'
					: ''}"
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
		<details class="mt-4">
			<summary class="cursor-pointer font-semibold">
				Advanced Settings
			</summary>
			<section class="w-full space-y-4 pt-2">
				<Switch
					name="stream"
					checked={openAIFields.stream}
					onCheckedChange={(e) => (openAIFields!.stream = e.checked)}
					class="flex items-center justify-between gap-4"
				>
					<Switch.Label class="font-semibold">Stream</Switch.Label>
					<Switch.Control
						class="preset-filled-surface-300-700 data-[state=checked]:preset-filled-primary-500"
					>
						<Switch.Thumb />
					</Switch.Control>
					<Switch.HiddenInput />
				</Switch>
				<Switch
					name="prerenderPrompt"
					checked={openAIFields.prerenderPrompt}
					onCheckedChange={(e) =>
						(openAIFields!.prerenderPrompt = e.checked)}
					class="flex items-center justify-between gap-4"
				>
					<Switch.Label class="font-semibold">
						Prerender Prompt
					</Switch.Label>
					<Switch.Control
						class="preset-filled-surface-300-700 data-[state=checked]:preset-filled-primary-500"
					>
						<Switch.Thumb />
					</Switch.Control>
					<Switch.HiddenInput />
				</Switch>
			</section>
		</details>
	{/if}
{/if}
