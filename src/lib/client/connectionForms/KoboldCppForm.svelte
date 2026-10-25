<script lang="ts">
	import * as Icons from "@lucide/svelte"
	import ConnectionFieldSelect from "./ConnectionFieldSelect.svelte"
	import {
		KOBOLDCPP_REQUEST_SWITCHES,
		PROMPT_FORMAT,
		TOKEN_COUNTER
	} from "./connectionFieldWords"
	import { completionTemplateOptions } from "$lib/client/stores/completionTemplateOptions.svelte"
	import { connectionWireMode } from "$lib/client/stores/connectionWireMode.svelte"
	import { usesCompletionTemplate } from "$lib/shared/connectionAdapters/wireMode"
	import { TokenCounterOptions } from "$lib/shared/constants/TokenCounters"
	import { CONNECTION_DEFAULTS } from "$lib/shared/utils/connectionDefaults"
	import { CONNECTION_TYPE } from "$lib/shared/constants/ConnectionTypes"
	import { Switch } from "@skeletonlabs/skeleton-svelte"
	import { getContext } from "svelte"
	import { useExtraJsonSync } from "./extraJsonSync.svelte"
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
		// The event fans out to every open form: another connection's result
		// is not this one's.
		if (msg.connectionId != null && msg.connectionId !== connection.id)
			return
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

	// Seeds the fields from `{...defaults, ...connection.extraJson}` on mount
	// and whenever the draft is replaced from outside (an external save, Reset),
	// and writes back only on a real edit — merged over `extraJson`, so keys
	// this form doesn't own survive. See `useExtraJsonSync` for why the seed's
	// own write-back is skipped.
	useExtraJsonSync<ExtraFieldData>({
		connection: () => connection,
		fields: () => koboldCppFields,
		seed: (extraJson) => {
			koboldCppFields = extraJsonToExtraFields({
				...defaultExtraJson,
				...(extraJson ?? {})
			} as ExtraJson)
		},
		project: (fields) =>
			extraFieldsToExtraJson(fields)
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
		<p class="text-error-600-400 mt-2 text-sm">{testResult.error}</p>
	{/if}
	{#if showFormat}
		<ConnectionFieldSelect
			class="mt-2"
			words={PROMPT_FORMAT}
			options={formatOptions.value.map((o) => ({
				value: String(o.value),
				label: o.label
			}))}
			bind:value={connection.promptFormat}
		/>
	{/if}
	<ConnectionFieldSelect
		class="mt-2"
		words={TOKEN_COUNTER}
		options={TokenCounterOptions.options.map((t) => ({
			value: String(t.value),
			label: t.label
		}))}
		bind:value={connection.tokenCounter}
	/>
	<details class="mt-4">
		<summary
			class="hover:preset-tonal-primary flex cursor-pointer items-center gap-2 rounded-base px-2 py-2 text-chip font-medium"
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
				<p class="text-error-600-400 text-sm">
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
				<!-- Each switch's label and help line come from
				     `connectionFieldWords`, shared by both KoboldCPP forms so
				     the two cannot say different things. -->
				{#each KOBOLDCPP_REQUEST_SWITCHES as s (s.key)}
					<div class="flex flex-col gap-1">
						<Switch
							name={s.key}
							checked={koboldCppFields[s.key]}
							onCheckedChange={(e) =>
								(koboldCppFields![s.key] = e.checked)}
							class="flex items-center justify-between gap-4"
						>
							<Switch.Label class="font-semibold">
								{s.label}
							</Switch.Label>
							<Switch.Control
								class="preset-filled-surface-300-700 data-[state=checked]:preset-filled-primary-500"
							>
								<Switch.Thumb />
							</Switch.Control>
							<Switch.HiddenInput />
						</Switch>
						<p class="text-surface-600-400 text-xs">{s.help}</p>
					</div>
					{#if s.key === "useMemory" && koboldCppFields.useMemory}
						<div class="flex flex-col gap-1">
							<label class="font-semibold" for="memory">
								Memory text
							</label>
							<!-- What it does is the Use memory line just
							     above; no second sentence for it here. -->
							<textarea
								id="memory"
								bind:value={koboldCppFields.memory}
								placeholder="Notes the model should always see"
								class="textarea h-20"
							></textarea>
						</div>
					{/if}
				{/each}
			</section>
		{/if}
	</details>
{/if}
