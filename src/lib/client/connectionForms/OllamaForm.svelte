<script lang="ts">
	import { completionTemplateOptions } from "$lib/client/stores/completionTemplateOptions.svelte"
	import { connectionWireMode } from "$lib/client/stores/connectionWireMode.svelte"
	import { usesCompletionTemplate } from "$lib/shared/connectionAdapters/wireMode"
	import { TokenCounterOptions } from "$lib/shared/constants/TokenCounters"
	import { CONNECTION_DEFAULTS } from "$lib/shared/utils/connectionDefaults"
	import { CONNECTION_TYPE } from "$lib/shared/constants/ConnectionTypes"
	import { Switch } from "@skeletonlabs/skeleton-svelte"
	import Select from "$lib/client/components/inputs/Select.svelte"
	import { onMount, onDestroy } from "svelte"
	import { useTypedSocket } from "$lib/client/sockets/typedSocket"
	import { z } from "zod"

	const KEEP_ALIVE_UNITS = [
		{ value: "ms", label: "ms" },
		{ value: "s", label: "s" },
		{ value: "m", label: "m" },
		{ value: "h", label: "h" }
	]

	/**
	 * ⚠ `think` is gone from this form (ruling 2026-09-12): reasoning is a
	 * SAMPLING parameter now, chosen per stage on the sampling config rather
	 * than once for every stage this connection serves. Stale keys in an
	 * existing row's `extraJson` are read by nothing: the column is jsonb, so
	 * an unread key costs nothing and no migration clears them. Do not re-add
	 * the toggle here.
	 */
	interface ExtraFieldData {
		stream: boolean
		keepAliveNumber: number
		keepAliveUnit: string
	}

	interface ExtraJson {
		stream?: boolean
		keepAlive?: string
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
	const defaultExtraJson =
		CONNECTION_DEFAULTS[CONNECTION_TYPE.OLLAMA].extraJson

	let availableOllamaModels: any[] = $state([])
	// The picker takes { value, label }; Ollama reports the id under `model`
	// and the display name under `name`.
	let modelOptions = $derived(
		availableOllamaModels.map((m) => ({ value: m.model, label: m.name }))
	)
	let ollamaFields: ExtraFieldData | undefined = $state()
	let validationErrors: ValidationErrors = $state({})

	const onConnectionsRefreshModels = (
		msg: Sockets.Connections.RefreshModels.Response
	) => {
		if (msg.models) availableOllamaModels = msg.models
	}
	socket.on("connections:refreshModels", onConnectionsRefreshModels)

	// Named so `off` can name it too. A bare `socket.off("connections:test")`
	// removes EVERY listener for that event — including the parent sidebar's,
	// which then stops updating for the rest of the session.
	const onConnectionsTest = (msg: Sockets.Connections.Test.Response) => {
		testResult = {
			ok: msg.ok,
			error: msg.error ?? undefined,
			models: msg.models
		}
	}
	socket.on("connections:test", onConnectionsTest)

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
			keepAlive: `${fields.keepAliveNumber}${fields.keepAliveUnit}`
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
		const _ollamaFields = ollamaFields
		if (!_ollamaFields) return
		// Computed on EVERY run, before the skip check, and deliberately so:
		// an effect only subscribes to the state it actually reads, and the
		// individual field values are read inside this call. Returning before
		// it — as a first attempt did — meant the effect never subscribed to
		// them, so later toggles re-triggered nothing and the form never went
		// dirty. Skip the WRITE, never the read.
		const nextExtraJson = extraFieldsToExtraJson(_ollamaFields)
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
			ollamaFields = extraJsonToExtraFields(extraJson)
		} else {
			ollamaFields = extraJsonToExtraFields(defaultExtraJson)
		}
		handleRefreshModels()
	})

	onDestroy(() => {
		socket.off("connections:refreshModels", onConnectionsRefreshModels)
		socket.off("connections:test", onConnectionsTest)
	})
</script>

{#if connection}
	<Select
		class="mt-2"
		label="Model"
		options={modelOptions}
		bind:value={connection.model}
		placeholder="-- Select Model --"
		emptyMessage="No models — try Refresh Models."
		clearable
		required
	/>
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
				<!-- Points at the number, which is what "Keep Alive" actually
				     labels; it used to name an id no element had. The unit
				     picker carries its own label, hidden so the pair still
				     reads as one field. -->
				<label class="font-semibold" for="keepAliveNumber">
					Keep Alive
				</label>
				<div class="flex items-center gap-2">
					<input
						id="keepAliveNumber"
						type="number"
						min="0"
						bind:value={ollamaFields.keepAliveNumber}
						class="input bg-background border-muted w-32 rounded border"
					/>
					<Select
						class="w-24"
						label="Keep alive unit"
						labelHidden
						options={KEEP_ALIVE_UNITS}
						bind:value={ollamaFields.keepAliveUnit}
					/>
				</div>
			</div>
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
					checked={ollamaFields.stream}
					onCheckedChange={(e) => (ollamaFields!.stream = e.checked)}
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
			</section>
		{/if}
	</details>
{/if}
