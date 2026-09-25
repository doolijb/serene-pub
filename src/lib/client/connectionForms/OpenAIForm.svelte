<script lang="ts">
	import { completionTemplateOptions } from "$lib/client/stores/completionTemplateOptions.svelte"
	import { connectionWireMode } from "$lib/client/stores/connectionWireMode.svelte"
	import { usesCompletionTemplate } from "$lib/shared/connectionAdapters/wireMode"
	import { TokenCounterOptions } from "$lib/shared/constants/TokenCounters"
	import { Switch } from "@skeletonlabs/skeleton-svelte"
	import Select from "$lib/client/components/inputs/Select.svelte"
	import { onMount } from "svelte"
	import { useTypedSocket } from "$lib/client/sockets/loadSockets.client"
	import { useInterest } from "$lib/client/sockets/interest.svelte"
	import { z } from "zod"

	interface ExtraFieldData {
		stream: boolean
		apiKey: string
	}

	interface ExtraJson {
		stream?: boolean
		apiKey?: string
	}

	// Zod validation schema
	const openAIConnectionSchema = z.object({
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
	const defaultExtraJson = {
		stream: false,
		apiKey: ""
	}

	let openAIFields: ExtraFieldData | undefined = $state()
	let validationErrors: ValidationErrors = $state({})

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
			apiKey: extraJson.apiKey || ""
		}
	}

	function extraFieldsToExtraJson(fields: ExtraFieldData): ExtraJson {
		return {
			stream: fields.stream,
			apiKey: fields.apiKey
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
	})
</script>

{#if connection}
	<!--
		The CREDENTIAL first. It was the last field on the form, under Token
		Counter and Base URL and below the fold — the one thing this connection
		cannot work without, placed after two things most people never touch.
		Prompt format and token counter moved into Advanced for the same reason.
	-->
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
		<!-- Model picker removed: models live in the Models section below. -->
		<!-- The Test button lives on the connection view's status card, not
	     here. Two Test buttons on one screen, styled differently and
	     reporting into different places, was the shipped state. -->
		<div class="mt-2 flex flex-col gap-1">
			<label class="font-semibold" for="baseUrl">Base URL</label>
			<input
				id="baseUrl"
				type="text"
				bind:value={connection.baseUrl}
				placeholder="https://api.openai.com/v1/"
				required
				class="input {validationErrors.baseUrl
					? 'border-error-500'
					: ''}"
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
		<details class="mt-4">
			<summary
				class="hover:preset-tonal-primary flex cursor-pointer items-center gap-2 rounded-[10px] px-2 py-2 text-[13px] font-medium"
			>
				Request settings
			</summary>
			<section class="w-full space-y-4 pt-2">
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
				<!-- "Prerender Prompt" lived here. It is a CAPABILITY now —
				     Text completion, in the Capabilities panel below, graded
				     through the same four layers as everything else. Both modes
				     still POST /v1/chat/completions; what the capability selects
				     is what the MODEL receives, one formatted prompt or
				     role-tagged turns. -->
			</section>
		</details>
	{/if}
{/if}
