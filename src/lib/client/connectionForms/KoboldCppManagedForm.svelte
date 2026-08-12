<script lang="ts">
	import * as Icons from "@lucide/svelte"
	import { PromptFormats } from "$lib/shared/constants/PromptFormats"
	import { TokenCounterOptions } from "$lib/shared/constants/TokenCounters"
	import { CONNECTION_DEFAULTS } from "$lib/shared/utils/connectionDefaults"
	import { CONNECTION_TYPE } from "$lib/shared/constants/ConnectionTypes"
	import { Switch } from "@skeletonlabs/skeleton-svelte"
	import { onMount, onDestroy, getContext } from "svelte"
	import { useTypedSocket } from "$lib/client/sockets/typedSocket"

	interface ManagedConfig {
		gpuLayers: number
		flashAttention: boolean
		batchSize: number
	}

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
		managedConfig: ManagedConfig
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
		managedConfig?: ManagedConfig
	}

	interface Props {
		connection: SelectConnection
	}

	let { connection = $bindable() } = $props()

	const socket = useTypedSocket()
	const koboldCppSettingsCtx: KoboldCppSettingsCtx = $state(
		getContext("koboldCppSettingsCtx")
	)
	const defaultExtraJson =
		CONNECTION_DEFAULTS[CONNECTION_TYPE.KOBOLDCPP_MANAGED].extraJson

	let managerEnabled = $derived(
		koboldCppSettingsCtx?.settings?.koboldCppManagerEnabled ?? false
	)

	let koboldCppFields: ExtraFieldData | undefined = $state()
	let availableModels: Sockets.KoboldCPP.ListModels.ModelFile[] = $state([])
	let isLoadingModels = $state(false)

	socket.on(
		"koboldcpp:listModels",
		(message: Sockets.KoboldCPP.ListModels.Response) => {
			isLoadingModels = false
			availableModels = message.availableModels ?? []
		}
	)

	function refreshModels() {
		isLoadingModels = true
		socket.emit("koboldcpp:listModels", {})
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
			replaceInstructPlaceholders:
				extraJson.replaceInstructPlaceholders ?? false,
			enableThinking: extraJson.enableThinking ?? null,
			managedConfig: {
				gpuLayers:
					extraJson.managedConfig?.gpuLayers ??
					defaultExtraJson.managedConfig?.gpuLayers ??
					-1,
				flashAttention:
					extraJson.managedConfig?.flashAttention ??
					defaultExtraJson.managedConfig?.flashAttention ??
					false,
				batchSize:
					extraJson.managedConfig?.batchSize ??
					defaultExtraJson.managedConfig?.batchSize ??
					512
			}
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
			enableThinking: fields.enableThinking,
			managedConfig: fields.managedConfig
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
		const _koboldCppFields = koboldCppFields
		if (!_koboldCppFields) return
		// Computed on EVERY run, before the skip check, and deliberately so:
		// an effect only subscribes to the state it actually reads, and the
		// individual field values are read inside this call. Returning before
		// it — as a first attempt did — meant the effect never subscribed to
		// them, so later toggles re-triggered nothing and the form never went
		// dirty. Skip the WRITE, never the read.
		const nextExtraJson = extraFieldsToExtraJson(_koboldCppFields)
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
			koboldCppFields = extraJsonToExtraFields(extraJson)
		} else {
			koboldCppFields = extraJsonToExtraFields(defaultExtraJson)
		}
		refreshModels()
	})

	onDestroy(() => {
		socket.off("koboldcpp:listModels")
	})
</script>

{#if connection}
	{#if !managerEnabled}
		<div
			class="border-warning-500 bg-warning-500/10 mt-4 flex items-start gap-2 rounded-lg border p-3"
		>
			<Icons.AlertTriangle
				size={16}
				class="text-warning-700-300 mt-0.5 shrink-0"
			/>
			<p class="text-warning-700-300 text-sm">
				This is a Managed KoboldCPP connection. KoboldCPP Manager must
				be enabled in Settings to use this connection.
			</p>
		</div>
	{/if}

	<div class="mt-4 flex flex-col gap-1">
		<div class="flex items-center justify-between">
			<label class="font-semibold" for="model">Model</label>
			<button
				type="button"
				class="btn btn-sm preset-filled-surface-400-600"
				onclick={refreshModels}
				title="Refresh models"
			>
				<Icons.RefreshCw
					size={14}
					class={isLoadingModels ? "animate-spin" : ""}
				/>
			</button>
		</div>
		<select
			id="model"
			class="select w-full"
			bind:value={connection.model}
			disabled={!managerEnabled}
		>
			<option value="">Select a model…</option>
			{#each availableModels as model}
				<option value={model.name}>{model.name}</option>
			{/each}
		</select>
		<p class="text-muted-foreground text-xs">
			Loaded automatically via KoboldCPP Manager's admin API the next time
			this connection is used to generate.
		</p>
	</div>

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
		<p class="text-muted-foreground mt-2 text-xs">
			Base URL is managed by KoboldCPP Manager's configured address and
			isn't set per-connection.
		</p>
		{#if koboldCppFields}
			<section class="w-full space-y-4 pt-4">
				<Switch
					name="useChat"
					checked={koboldCppFields.useChat}
					onCheckedChange={(e) =>
						(koboldCppFields!.useChat = e.checked)}
					class="flex items-center justify-between gap-4"
				>
					<Switch.Label class="font-semibold">
						Use Chat Mode
					</Switch.Label>
					<Switch.Control
						class="preset-filled-surface-300-700 data-[state=checked]:preset-filled-primary-500"
					>
						<Switch.Thumb />
					</Switch.Control>
					<Switch.HiddenInput />
				</Switch>
				<p class="text-muted-foreground text-xs">
					Enable to use OpenAI-style chat completion format instead of
					text completion
				</p>
				<Switch
					name="stream"
					checked={koboldCppFields.stream}
					onCheckedChange={(e) =>
						(koboldCppFields!.stream = e.checked)}
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
					name="useMemory"
					checked={koboldCppFields.useMemory}
					onCheckedChange={(e) =>
						(koboldCppFields!.useMemory = e.checked)}
					class="flex items-center justify-between gap-4"
				>
					<Switch.Label class="font-semibold">
						Use Memory
					</Switch.Label>
					<Switch.Control
						class="preset-filled-surface-300-700 data-[state=checked]:preset-filled-primary-500"
					>
						<Switch.Thumb />
					</Switch.Control>
					<Switch.HiddenInput />
				</Switch>
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
				<Switch
					name="trimStop"
					checked={koboldCppFields.trimStop}
					onCheckedChange={(e) =>
						(koboldCppFields!.trimStop = e.checked)}
					class="flex items-center justify-between gap-4"
				>
					<Switch.Label class="font-semibold">
						Trim Stop Sequences
					</Switch.Label>
					<Switch.Control
						class="preset-filled-surface-300-700 data-[state=checked]:preset-filled-primary-500"
					>
						<Switch.Thumb />
					</Switch.Control>
					<Switch.HiddenInput />
				</Switch>
				<Switch
					name="renderSpecial"
					checked={koboldCppFields.renderSpecial}
					onCheckedChange={(e) =>
						(koboldCppFields!.renderSpecial = e.checked)}
					class="flex items-center justify-between gap-4"
				>
					<Switch.Label class="font-semibold">
						Render Special Tokens
					</Switch.Label>
					<Switch.Control
						class="preset-filled-surface-300-700 data-[state=checked]:preset-filled-primary-500"
					>
						<Switch.Thumb />
					</Switch.Control>
					<Switch.HiddenInput />
				</Switch>
				<Switch
					name="bypassEos"
					checked={koboldCppFields.bypassEos}
					onCheckedChange={(e) =>
						(koboldCppFields!.bypassEos = e.checked)}
					class="flex items-center justify-between gap-4"
				>
					<Switch.Label class="font-semibold">
						Bypass EOS Token
					</Switch.Label>
					<Switch.Control
						class="preset-filled-surface-300-700 data-[state=checked]:preset-filled-primary-500"
					>
						<Switch.Thumb />
					</Switch.Control>
					<Switch.HiddenInput />
				</Switch>
				<Switch
					name="grammarRetainState"
					checked={koboldCppFields.grammarRetainState}
					onCheckedChange={(e) =>
						(koboldCppFields!.grammarRetainState = e.checked)}
					class="flex items-center justify-between gap-4"
				>
					<Switch.Label class="font-semibold">
						Retain Grammar State
					</Switch.Label>
					<Switch.Control
						class="preset-filled-surface-300-700 data-[state=checked]:preset-filled-primary-500"
					>
						<Switch.Thumb />
					</Switch.Control>
					<Switch.HiddenInput />
				</Switch>
				<Switch
					name="logprobs"
					checked={koboldCppFields.logprobs}
					onCheckedChange={(e) =>
						(koboldCppFields!.logprobs = e.checked)}
					class="flex items-center justify-between gap-4"
				>
					<Switch.Label class="font-semibold">
						Return Logprobs
					</Switch.Label>
					<Switch.Control
						class="preset-filled-surface-300-700 data-[state=checked]:preset-filled-primary-500"
					>
						<Switch.Thumb />
					</Switch.Control>
					<Switch.HiddenInput />
				</Switch>
				<Switch
					name="replaceInstructPlaceholders"
					checked={koboldCppFields.replaceInstructPlaceholders}
					onCheckedChange={(e) =>
						(koboldCppFields!.replaceInstructPlaceholders =
							e.checked)}
					class="flex items-center justify-between gap-4"
				>
					<Switch.Label class="font-semibold">
						Replace Instruct Placeholders
					</Switch.Label>
					<Switch.Control
						class="preset-filled-surface-300-700 data-[state=checked]:preset-filled-primary-500"
					>
						<Switch.Thumb />
					</Switch.Control>
					<Switch.HiddenInput />
				</Switch>
				<div class="flex items-center justify-between gap-4">
					<div>
						<p class="font-semibold">Thinking / Reasoning</p>
						<p class="text-muted-foreground text-xs">
							Auto lets the model decide based on its template
						</p>
					</div>
					<div
						class="border-surface-300-700 flex overflow-hidden rounded border text-sm"
					>
						{#each [{ label: "Auto", value: null }, { label: "On", value: true }, { label: "Off", value: false }] as opt}
							<button
								type="button"
								class="px-3 py-1 transition-colors {koboldCppFields.enableThinking ===
								opt.value
									? 'preset-filled-primary-500'
									: 'preset-filled-surface-400-600'}"
								onclick={() =>
									(koboldCppFields!.enableThinking =
										opt.value)}
							>
								{opt.label}
							</button>
						{/each}
					</div>
				</div>
				<hr class="border-surface-300-700" />
				<p class="text-muted-foreground text-xs">
					Managed mode launch settings — applied the next time this
					model is loaded.
				</p>
				<div class="flex flex-col gap-1">
					<label class="font-semibold" for="gpuLayers">
						GPU Layers
					</label>
					<input
						id="gpuLayers"
						type="number"
						step="1"
						bind:value={koboldCppFields.managedConfig.gpuLayers}
						class="input"
					/>
					<p class="text-muted-foreground text-xs">
						-1 = autofit as many layers as fit on GPU, 0 = CPU only
					</p>
				</div>
				<Switch
					name="flashAttention"
					checked={koboldCppFields.managedConfig.flashAttention}
					onCheckedChange={(e) =>
						(koboldCppFields!.managedConfig.flashAttention =
							e.checked)}
					class="flex items-center justify-between gap-4"
				>
					<Switch.Label class="font-semibold">
						Flash Attention
					</Switch.Label>
					<Switch.Control
						class="preset-filled-surface-300-700 data-[state=checked]:preset-filled-primary-500"
					>
						<Switch.Thumb />
					</Switch.Control>
					<Switch.HiddenInput />
				</Switch>
				<div class="flex flex-col gap-1">
					<label class="font-semibold" for="batchSize">
						Batch Size
					</label>
					<input
						id="batchSize"
						type="number"
						step="1"
						min="1"
						bind:value={koboldCppFields.managedConfig.batchSize}
						class="input"
					/>
				</div>
			</section>
		{/if}
	</details>
{/if}
