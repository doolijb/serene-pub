<script lang="ts">
	import * as Icons from "@lucide/svelte"
	import { completionTemplateOptions } from "$lib/client/stores/completionTemplateOptions.svelte"
	import { connectionWireMode } from "$lib/client/stores/connectionWireMode.svelte"
	import { usesCompletionTemplate } from "$lib/shared/connectionAdapters/wireMode"
	import { TokenCounterOptions } from "$lib/shared/constants/TokenCounters"
	import { CONNECTION_DEFAULTS } from "$lib/shared/utils/connectionDefaults"
	import { CONNECTION_TYPE } from "$lib/shared/constants/ConnectionTypes"
	import { Switch } from "@skeletonlabs/skeleton-svelte"
	import Select from "$lib/client/components/inputs/Select.svelte"
	import { onMount, onDestroy, getContext } from "svelte"
	import { useTypedSocket } from "$lib/client/sockets/typedSocket"
	import { textModelOptions } from "$lib/client/components/koboldcppManager/modelKindView"

	interface ManagedConfig {
		gpuLayers: number
		flashAttention: boolean
		batchSize: number
	}

	/**
	 * ⚠ `enableThinking` is gone from this form (ruling 2026-09-12), the same
	 * way it left `KoboldCppForm`: reasoning is a SAMPLING parameter now,
	 * chosen per stage on the sampling config. The managed adapter extends the
	 * plain one, so the read it depended on is gone too. Stale keys in an
	 * existing row's `extraJson` are read by nothing and cost nothing.
	 */
	interface ExtraFieldData {
		stream: boolean
		useMemory: boolean
		memory: string
		trimStop: boolean
		renderSpecial: boolean
		bypassEos: boolean
		grammarRetainState: boolean
		logprobs: boolean
		replaceInstructPlaceholders: boolean
		managedConfig: ManagedConfig
	}

	interface ExtraJson {
		stream?: boolean
		useMemory?: boolean
		memory?: string
		trimStop?: boolean
		renderSpecial?: boolean
		bypassEos?: boolean
		grammarRetainState?: boolean
		logprobs?: boolean
		replaceInstructPlaceholders?: boolean
		managedConfig?: ManagedConfig
	}

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

	// Named so the teardown below removes only this listener — a bare
	// socket.off("koboldcpp:listModels") drops every handler for the event,
	// including the KoboldCPP Manager sidebar's, which can be open at the same
	// time as this form and uses the same list to decide which tab to land on.
	function handleListModels(message: Sockets.KoboldCPP.ListModels.Response) {
		isLoadingModels = false
		availableModels = message.availableModels ?? []
	}
	socket.on("koboldcpp:listModels", handleListModels)

	// Text-kind rows only, minus the trap of dropping a stored selection that
	// has since been classified as an image model — see textModelOptions.
	let modelSelect = $derived(
		textModelOptions(availableModels, connection?.model)
	)
	// KoboldCPP identifies a managed model by its file name, so the name is
	// both the stored value and the label.
	let modelOptions = $derived(
		modelSelect.options.map((m) => ({ value: m.name, label: m.name }))
	)

	function refreshModels() {
		isLoadingModels = true
		socket.emit("koboldcpp:listModels", {})
	}

	function extraJsonToExtraFields(extraJson: ExtraJson): ExtraFieldData {
		return {
			stream: extraJson.stream ?? true,
			useMemory: extraJson.useMemory ?? false,
			memory: extraJson.memory ?? "",
			trimStop: extraJson.trimStop ?? true,
			renderSpecial: extraJson.renderSpecial ?? false,
			bypassEos: extraJson.bypassEos ?? false,
			grammarRetainState: extraJson.grammarRetainState ?? false,
			logprobs: extraJson.logprobs ?? false,
			replaceInstructPlaceholders:
				extraJson.replaceInstructPlaceholders ?? false,
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
			useMemory: fields.useMemory,
			memory: fields.memory,
			trimStop: fields.trimStop,
			renderSpecial: fields.renderSpecial,
			bypassEos: fields.bypassEos,
			grammarRetainState: fields.grammarRetainState,
			logprobs: fields.logprobs,
			replaceInstructPlaceholders: fields.replaceInstructPlaceholders,
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
		socket.off("koboldcpp:listModels", handleListModels)
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
			<!-- A span, not a label: the accessible name comes from the picker's
			     own hidden label, and a <label for> in this header row would
			     have to name an id the picker does not expose. -->
			<span class="font-semibold">Model</span>
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
		<Select
			label="Model"
			labelHidden
			options={modelOptions}
			bind:value={connection.model}
			placeholder="Select a model…"
			emptyMessage="No text models found."
			clearable
			disabled={!managerEnabled}
		/>
		{#if modelSelect.selectedIsImageModel}
			<p class="text-warning-700-300 text-xs">
				This is an image model — KoboldCPP can't answer chat with it,
				and an image model needs its own connection. Pick a text model
				here; make the image one from KoboldCPP Manager → Models →
				Image, which creates the connection for it.
			</p>
		{/if}
		<p class="text-muted-foreground text-xs">
			Loaded automatically via KoboldCPP Manager's admin API the next time
			this connection is used to generate.
		</p>
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
				<!-- "Use Session Mode" lived here. It is a CAPABILITY now —
				     Chat messages / Text completion, in the Capabilities panel
				     below, graded through the same four layers as everything
				     else and with a hand-set value outranking every later test.
				     Left as two controls for one fact, the switch and the
				     capability could disagree, and only one of them decided
				     what went on the wire. -->
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
