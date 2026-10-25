<script lang="ts">
	import { completionTemplateOptions } from "$lib/client/stores/completionTemplateOptions.svelte"
	import { connectionWireMode } from "$lib/client/stores/connectionWireMode.svelte"
	import { usesCompletionTemplate } from "$lib/shared/connectionAdapters/wireMode"
	import { TokenCounterOptions } from "$lib/shared/constants/TokenCounters"
	import { CONNECTION_TYPE } from "$lib/shared/constants/ConnectionTypes"
	import ConnectionFieldSelect from "./ConnectionFieldSelect.svelte"
	import { PROMPT_FORMAT, TOKEN_COUNTER } from "./connectionFieldWords"
	import { useExtraJsonSync } from "./extraJsonSync.svelte"
	import { useTypedSocket } from "$lib/client/sockets/typedSocket"
	import { useInterest } from "$lib/client/sockets/interest.svelte"
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

	/**
	 * A completion template only means something in COMPLETION wire mode.
	 *
	 * The same gate the other five forms carry, and it became reachable here
	 * the day this type gained a chat leg: `llamacpp` names the SERVICE now, so
	 * a connection of it can be switched to llama-server's OpenAI-compatible
	 * route — where the roles carry the structure, no delimiter is emitted and
	 * no stop string from the template is sent. The picker would be a saved
	 * preference that changes no byte of any request.
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
		stream: false
	}

	let llamaCppFields: ExtraFieldData | undefined = $state()
	let validationErrors: ValidationErrors = $state({})

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
			connection.type === CONNECTION_TYPE.LLAMACPP &&
			connection.baseUrl
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

	// Seeds the fields from `{...defaults, ...connection.extraJson}` on mount
	// and whenever the draft is replaced from outside (an external save, Reset),
	// and writes back only on a real edit — merged over `extraJson`, so keys
	// this form doesn't own survive. See `useExtraJsonSync` for why the seed's
	// own write-back is skipped.
	useExtraJsonSync<ExtraFieldData>({
		connection: () => connection,
		fields: () => llamaCppFields,
		seed: (extraJson) => {
			llamaCppFields = extraJsonToExtraFields({
				...defaultExtraJson,
				...(extraJson ?? {})
			} as ExtraJson)
		},
		project: (fields) =>
			extraFieldsToExtraJson(fields)
	})
</script>

{#if connection}
	<!-- No model picker here: connections have no default model. Models live
	     in the Models section below. -->
	<!-- The Test button lives on the connection view's status card, not
	     here. Two Test buttons on one screen, styled differently and
	     reporting into different places, was the shipped state. -->
	{#if showFormat}
		<ConnectionFieldSelect
			class="mt-2"
			words={PROMPT_FORMAT}
			options={formatOptions.value}
			bind:value={connection.promptFormat}
		/>
	{/if}
	<ConnectionFieldSelect
		class="mt-2"
		words={TOKEN_COUNTER}
		options={TokenCounterOptions.options}
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
				placeholder="http://localhost:8080/"
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
					class="text-error-600-400 mt-1 text-sm"
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
