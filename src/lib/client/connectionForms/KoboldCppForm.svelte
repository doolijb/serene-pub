<script lang="ts">
	import * as Icons from "@lucide/svelte"
	import { PromptFormats } from "$lib/shared/constants/PromptFormats"
	import { TokenCounterOptions } from "$lib/shared/constants/TokenCounters"
	import { CONNECTION_DEFAULTS } from "$lib/shared/utils/connectionDefaults"
	import { CONNECTION_TYPE } from "$lib/shared/constants/ConnectionTypes"
	import { Switch } from "@skeletonlabs/skeleton-svelte"
	import { onMount, onDestroy, getContext } from "svelte"
	import { useTypedSocket } from "$lib/client/sockets/typedSocket"
	import { z } from "zod"

	interface ExtraFieldData {
		stream: boolean
		useChat: boolean
		useMemory: boolean
		memory: string
		trimStop: boolean
		renderSpecial: boolean
		bypassEos: boolean
		grammarRetainState: boolean
		logprobs: boolean
		replaceInstructPlaceholders: boolean
		enableThinking: boolean | null
	}

	interface ExtraJson {
		stream?: boolean
		useChat?: boolean
		useMemory?: boolean
		memory?: string
		trimStop?: boolean
		renderSpecial?: boolean
		bypassEos?: boolean
		grammarRetainState?: boolean
		logprobs?: boolean
		replaceInstructPlaceholders?: boolean
		enableThinking?: boolean | null
	}

	// Zod validation schema
	const koboldCppConnectionSchema = z.object({
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
	const koboldCppSettingsCtx: KoboldCppSettingsCtx = $state(getContext("koboldCppSettingsCtx"))
	const defaultExtraJson =
		CONNECTION_DEFAULTS[CONNECTION_TYPE.KOBOLDCPP].extraJson

	let managerEnabled = $derived(
		koboldCppSettingsCtx?.settings?.koboldCppManagerEnabled ?? false
	)

	let koboldCppFields: ExtraFieldData | undefined = $state()
	let validationErrors: ValidationErrors = $state({})
	let testResult: { ok: boolean; error?: string; models?: any[] } | null =
		$state(null)

	socket.on("connections:test", (msg) => {
		testResult = msg
	})

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

		const result = koboldCppConnectionSchema.safeParse(data)

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

	function extraJsonToExtraFields(extraJson: ExtraJson): ExtraFieldData {
		return {
			stream: extraJson.stream ?? true,
			useChat: extraJson.useChat ?? true,
			useMemory: extraJson.useMemory ?? false,
			memory: extraJson.memory ?? "",
			trimStop: extraJson.trimStop ?? true,
			renderSpecial: extraJson.renderSpecial ?? false,
			bypassEos: extraJson.bypassEos ?? false,
			grammarRetainState: extraJson.grammarRetainState ?? false,
			logprobs: extraJson.logprobs ?? false,
			replaceInstructPlaceholders: extraJson.replaceInstructPlaceholders ?? false,
			enableThinking: extraJson.enableThinking ?? null
		}
	}

	function extraFieldsToExtraJson(fields: ExtraFieldData): ExtraJson {
		return {
			stream: fields.stream,
			useChat: fields.useChat,
			useMemory: fields.useMemory,
			memory: fields.memory,
			trimStop: fields.trimStop,
			renderSpecial: fields.renderSpecial,
			bypassEos: fields.bypassEos,
			grammarRetainState: fields.grammarRetainState,
			logprobs: fields.logprobs,
			replaceInstructPlaceholders: fields.replaceInstructPlaceholders,
			enableThinking: fields.enableThinking
		}
	}

	$effect(() => {
		const _koboldCppFields = koboldCppFields
		if (_koboldCppFields) {
			connection.extraJson = extraFieldsToExtraJson(_koboldCppFields)
		}
	})

	onMount(() => {
		if (connection.extraJson) {
			const extraJson = { ...defaultExtraJson, ...connection.extraJson }
			koboldCppFields = extraJsonToExtraFields(extraJson)
		} else {
			koboldCppFields = extraJsonToExtraFields(defaultExtraJson)
		}
	})

	onDestroy(() => {
		socket.off("connections:test")
	})
</script>

{#if connection}
	{#if managerEnabled}
		<div
			class="border-warning-500 bg-warning-500/10 mt-4 flex items-start gap-2 rounded-lg border p-3"
		>
			<Icons.AlertTriangle size={16} class="text-warning-700-300 mt-0.5 shrink-0" />
			<p class="text-warning-700-300 text-sm">
				KoboldCpp Manager is enabled — consider using a
				<b>KCPP Manager</b> connection instead, unless this connects
				to a different/external KoboldCpp instance.
			</p>
		</div>
	{/if}
	<div class="mt-4 flex gap-2">
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
	{#if testResult?.error}
		<p class="text-error-500 mt-2 text-sm">{testResult.error}</p>
	{/if}
	{#if !koboldCppFields?.useChat}
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
				placeholder="http://localhost:5001"
				required
				class="input"
			/>
			{#if validationErrors.baseUrl}
				<p class="text-error-500 text-sm">
					{validationErrors.baseUrl}
				</p>
			{/if}
		</div>
		{#if koboldCppFields}
			<section class="w-full space-y-4 pt-4">
				<div class="flex items-center justify-between gap-4">
					<label class="font-semibold" for="useChat">
						Use Chat Mode
					</label>
					<Switch
						name="useChat"
						checked={koboldCppFields.useChat}
						onCheckedChange={(e) =>
							(koboldCppFields!.useChat = e.checked)}
						aria-labelledby="useChat"
					/>
				</div>
				<p class="text-muted-foreground text-xs">
					Enable to use OpenAI-style chat completion format instead of
					text completion
				</p>
				<div class="flex items-center justify-between gap-4">
					<label class="font-semibold" for="stream">Stream</label>
					<Switch
						name="stream"
						checked={koboldCppFields.stream}
						onCheckedChange={(e) =>
							(koboldCppFields!.stream = e.checked)}
						aria-labelledby="stream"
					/>
				</div>
				<div class="flex items-center justify-between gap-4">
					<label class="font-semibold" for="useMemory">
						Use Memory
					</label>
					<Switch
						name="useMemory"
						checked={koboldCppFields.useMemory}
						onCheckedChange={(e) =>
							(koboldCppFields!.useMemory = e.checked)}
						aria-labelledby="useMemory"
					/>
				</div>
				{#if koboldCppFields.useMemory}
					<div class="flex flex-col gap-1">
						<label class="font-semibold" for="memory">
							Memory Text
						</label>
						<textarea
							id="memory"
							bind:value={koboldCppFields.memory}
							placeholder="Text to forcefully append to the beginning of prompts"
							class="textarea h-20"
						></textarea>
						<p class="text-muted-foreground text-xs">
							This text is forcefully appended to the beginning of
							any prompt
						</p>
					</div>
				{/if}
				<div class="flex items-center justify-between gap-4">
					<label class="font-semibold" for="trimStop">
						Trim Stop Sequences
					</label>
					<Switch
						name="trimStop"
						checked={koboldCppFields.trimStop}
						onCheckedChange={(e) =>
							(koboldCppFields!.trimStop = e.checked)}
						aria-labelledby="trimStop"
					/>
				</div>
				<div class="flex items-center justify-between gap-4">
					<label class="font-semibold" for="renderSpecial">
						Render Special Tokens
					</label>
					<Switch
						name="renderSpecial"
						checked={koboldCppFields.renderSpecial}
						onCheckedChange={(e) =>
							(koboldCppFields!.renderSpecial = e.checked)}
						aria-labelledby="renderSpecial"
					/>
				</div>
				<div class="flex items-center justify-between gap-4">
					<label class="font-semibold" for="bypassEos">
						Bypass EOS Token
					</label>
					<Switch
						name="bypassEos"
						checked={koboldCppFields.bypassEos}
						onCheckedChange={(e) =>
							(koboldCppFields!.bypassEos = e.checked)}
						aria-labelledby="bypassEos"
					/>
				</div>
				<div class="flex items-center justify-between gap-4">
					<label class="font-semibold" for="grammarRetainState">
						Retain Grammar State
					</label>
					<Switch
						name="grammarRetainState"
						checked={koboldCppFields.grammarRetainState}
						onCheckedChange={(e) =>
							(koboldCppFields!.grammarRetainState = e.checked)}
						aria-labelledby="grammarRetainState"
					/>
				</div>
				<div class="flex items-center justify-between gap-4">
					<label class="font-semibold" for="logprobs">
						Return Logprobs
					</label>
					<Switch
						name="logprobs"
						checked={koboldCppFields.logprobs}
						onCheckedChange={(e) =>
							(koboldCppFields!.logprobs = e.checked)}
						aria-labelledby="logprobs"
					/>
				</div>
				<div class="flex items-center justify-between gap-4">
					<label
						class="font-semibold"
						for="replaceInstructPlaceholders"
					>
						Replace Instruct Placeholders
					</label>
					<Switch
						name="replaceInstructPlaceholders"
						checked={koboldCppFields.replaceInstructPlaceholders}
						onCheckedChange={(e) =>
							(koboldCppFields!.replaceInstructPlaceholders =
								e.checked)}
						aria-labelledby="replaceInstructPlaceholders"
					/>
				</div>
				<div class="flex items-center justify-between gap-4">
					<div>
						<p class="font-semibold">Thinking / Reasoning</p>
						<p class="text-muted-foreground text-xs">Auto lets the model decide based on its template</p>
					</div>
					<div class="flex rounded overflow-hidden border border-surface-300-700 text-sm">
						{#each [{ label: "Auto", value: null }, { label: "On", value: true }, { label: "Off", value: false }] as opt}
							<button
								type="button"
								class="px-3 py-1 transition-colors {koboldCppFields.enableThinking === opt.value
									? 'preset-filled-primary-500'
									: 'preset-filled-surface-400-600'}"
								onclick={() => (koboldCppFields!.enableThinking = opt.value)}
							>
								{opt.label}
							</button>
						{/each}
					</div>
				</div>
			</section>
		{/if}
	</details>
{/if}
