<script lang="ts">
	import * as Icons from "@lucide/svelte"
	import Select from "$lib/client/components/inputs/Select.svelte"
	import { completionTemplateOptions } from "$lib/client/stores/completionTemplateOptions.svelte"
	import { connectionWireMode } from "$lib/client/stores/connectionWireMode.svelte"
	import { usesCompletionTemplate } from "$lib/shared/connectionAdapters/wireMode"
	import { TokenCounterOptions } from "$lib/shared/constants/TokenCounters"
	import { CONNECTION_DEFAULTS } from "$lib/shared/utils/connectionDefaults"
	import { CONNECTION_TYPE } from "$lib/shared/constants/ConnectionTypes"
	import { Switch } from "@skeletonlabs/skeleton-svelte"
	import { onMount, getContext } from "svelte"
	import { useTypedSocket } from "$lib/client/sockets/typedSocket"
	import { useInterest } from "$lib/client/sockets/interest.svelte"
	import { z } from "zod"

	/**
	 * ⚠ `enableThinking` is gone from this form (ruling 2026-09-12): reasoning
	 * is a SAMPLING parameter now, chosen per step on the sampling config
	 * rather than once for every step this connection serves. A stale key in
	 * an existing row's `extraJson` is read by nothing — the column is jsonb,
	 * so an unread key costs nothing and no migration clears it. Do not re-add
	 * the Auto/On/Off control here.
	 */
	interface ExtraFieldData {
		stream: boolean
		useMemory: boolean
		memory: string
		trimStop: boolean
		renderSpecial: boolean
		bypassEos: boolean
		grammarRetainState: boolean
		replaceInstructPlaceholders: boolean
	}

	interface ExtraJson {
		stream?: boolean
		useMemory?: boolean
		memory?: string
		trimStop?: boolean
		renderSpecial?: boolean
		bypassEos?: boolean
		grammarRetainState?: boolean
		replaceInstructPlaceholders?: boolean
	}

	// Zod validation schema
	const koboldCppConnectionSchema = z.object({
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
		CONNECTION_DEFAULTS[CONNECTION_TYPE.KOBOLDCPP].extraJson

	let managerEnabled = $derived(
		koboldCppSettingsCtx?.settings?.koboldCppManagerEnabled ?? false
	)

	let koboldCppFields: ExtraFieldData | undefined = $state()
	let validationErrors: ValidationErrors = $state({})
	let testResult: { ok: boolean; error?: string; models?: any[] } | null =
		$state(null)

	// Standing interest in the test result, held by the registry for as long as
	// this form is mounted and released with it. The registry keeps ONE raw
	// listener for the event and fans it out, so the parent sidebar's own
	// interest is untouched by this form coming and going.
	const onConnectionsTest = (msg: Sockets.Connections.Test.Response) => {
		testResult = {
			ok: msg.ok,
			error: msg.error ?? undefined,
			models: msg.models
		}
	}
	useInterest<"connections:test">("connections:test", onConnectionsTest)

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
			useMemory: extraJson.useMemory ?? false,
			memory: extraJson.memory ?? "",
			trimStop: extraJson.trimStop ?? true,
			renderSpecial: extraJson.renderSpecial ?? false,
			bypassEos: extraJson.bypassEos ?? false,
			grammarRetainState: extraJson.grammarRetainState ?? false,
			replaceInstructPlaceholders:
				extraJson.replaceInstructPlaceholders ?? false
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
			replaceInstructPlaceholders: fields.replaceInstructPlaceholders
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
	})
</script>

{#if connection}
	<!-- Model input removed: models live in the Models section below. -->
	{#if managerEnabled}
		<div
			class="border-warning-500 bg-warning-500/10 mt-4 flex items-start gap-2 rounded-lg border p-3"
		>
			<Icons.AlertTriangle
				size={16}
				class="text-warning-700-300 mt-0.5 shrink-0"
			/>
			<p class="text-warning-700-300 text-sm">
				Serene Pub is running KoboldCPP for you — consider using the
				<b>KoboldCPP, run by Serene Pub</b>
				connection instead, unless this connects to a different/external
				KoboldCPP instance.
			</p>
		</div>
	{/if}
	<!-- The Test button lives on the connection view's status card, not
	     here. Two Test buttons on one screen, styled differently and
	     reporting into different places, was the shipped state. -->
	{#if testResult?.error}
		<p class="text-error-500 mt-2 text-sm">{testResult.error}</p>
	{/if}
	{#if showFormat}
		<div class="mt-2 flex flex-col gap-1">
			<Select
				label="Prompt format"
				class="w-full"
				options={formatOptions.value.map((o) => ({
					value: String(o.value),
					label: o.label
				}))}
				bind:value={connection.promptFormat}
			/>
		</div>
	{/if}
	<div class="mt-2 flex flex-col gap-1">
		<Select
			label="Token counter"
			class="w-full"
			options={TokenCounterOptions.options.map((t) => ({
				value: String(t.value),
				label: t.label
			}))}
			bind:value={connection.tokenCounter}
		/>
	</div>
	<details class="mt-4">
		<summary
			class="hover:preset-tonal-primary flex cursor-pointer items-center gap-2 rounded-[10px] px-2 py-2 text-[13px] font-medium"
		>
			Request settings
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
				<!-- "Use Chat Mode" lived here. It is a CAPABILITY now —
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
						<p class="text-surface-600-400 text-xs">
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
			</section>
		{/if}
	</details>
{/if}
