<script lang="ts">
	import { completionTemplateOptions } from "$lib/client/stores/completionTemplateOptions.svelte"
	import { connectionWireMode } from "$lib/client/stores/connectionWireMode.svelte"
	import { usesCompletionTemplate } from "$lib/shared/connectionAdapters/wireMode"
	import { TokenCounterOptions } from "$lib/shared/constants/TokenCounters"
	import { CONNECTION_DEFAULTS } from "$lib/shared/utils/connectionDefaults"
	import { CONNECTION_TYPE } from "$lib/shared/constants/ConnectionTypes"
	import { Switch } from "@skeletonlabs/skeleton-svelte"
	import Select from "$lib/client/components/inputs/Select.svelte"
	import ConnectionFieldSelect from "./ConnectionFieldSelect.svelte"
	import { PROMPT_FORMAT, TOKEN_COUNTER } from "./connectionFieldWords"
	import { useExtraJsonSync } from "./extraJsonSync.svelte"
	import { useTypedSocket } from "$lib/client/sockets/typedSocket"
	import { useInterest } from "$lib/client/sockets/interest.svelte"
	import { z } from "zod"

	// BARE is a number with no unit, which Ollama reads as seconds — and is
	// how the documented "-1" (keep loaded forever) is written. A sentinel
	// rather than "" because the picker reads an empty value as "nothing
	// selected".
	const BARE = "bare"
	const KEEP_ALIVE_UNITS = [
		{ value: BARE, label: "none" },
		{ value: "ms", label: "ms" },
		{ value: "s", label: "s" },
		{ value: "m", label: "m" },
		{ value: "h", label: "h" }
	]

	/**
	 * ⚠ `think` is gone from this form (ruling 2026-09-12): reasoning is a
	 * SAMPLING parameter now, chosen per step on the sampling config rather
	 * than once for every step this connection serves. Stale keys in an
	 * existing row's `extraJson` are read by nothing: the column is jsonb, so
	 * an unread key costs nothing and no migration clears them. Do not re-add
	 * the toggle here.
	 */
	interface ExtraFieldData {
		stream: boolean
		/** `null` when the input is emptied: the key is then left out and the
		 *  adapter's own fallback ("5m") applies. */
		keepAliveNumber: number | null
		keepAliveUnit: string
	}

	interface ExtraJson {
		stream?: boolean
		keepAlive?: string
	}

	// Zod validation schema. No model field: connections have no default
	// model, so the endpoint form never names one — models are synced from
	// the host and browsed from the connections index.
	const ollamaConnectionSchema = z.object({
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
	 * The format picker's options, read from `completion_templates` rather
	 * than a constant beside the table — so a template
	 * an admin authored is offered by the one control that selects it. Falls back
	 * to the built-ins until the reply lands.
	 */
	const formatOptions = completionTemplateOptions()
	const defaultExtraJson =
		CONNECTION_DEFAULTS[CONNECTION_TYPE.OLLAMA].extraJson

	let testResult: { ok: boolean; error?: string; models?: any[] } | null =
		$state(null)
	let ollamaFields: ExtraFieldData | undefined = $state()
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

	// (removed: the old validity check read `connection.model`, and
	// connections have no default model to be valid against.)

	/**
	 * Parsed losslessly: "0m" stays 0 (unload at once; a `|| default` on the
	 * parse would read it as unset) and "-1" stays -1 with no unit (forever).
	 * Anything unparseable shows the default rather than a mangled value.
	 */
	function parseKeepAlive(value: unknown): { number: number; unit: string } {
		const fallback = { number: 5, unit: "m" }
		if (typeof value === "number" && Number.isFinite(value))
			return { number: value, unit: BARE }
		if (typeof value !== "string") return fallback
		const match = /^(-?\d+)(ms|s|m|h)?$/.exec(value.trim())
		if (!match) return fallback
		return { number: Number(match[1]), unit: match[2] ?? BARE }
	}

	function extraJsonToExtraFields(extraJson: ExtraJson): ExtraFieldData {
		const keepAlive = parseKeepAlive(extraJson.keepAlive)
		return {
			stream: extraJson.stream || false,
			keepAliveNumber: keepAlive.number,
			keepAliveUnit: keepAlive.unit
		}
	}

	function extraFieldsToExtraJson(fields: ExtraFieldData): ExtraJson {
		const number = fields.keepAliveNumber
		return {
			stream: fields.stream,
			// Emptied input → key removed (see mergeExtraJson), never "nullm".
			keepAlive:
				typeof number === "number" && Number.isFinite(number)
					? `${Math.trunc(number)}${
							fields.keepAliveUnit && fields.keepAliveUnit !== BARE
								? fields.keepAliveUnit
								: ""
						}`
					: undefined
		}
	}

	// Seeds the fields from `{...defaults, ...connection.extraJson}` on mount
	// and whenever the draft is replaced from outside (an external save, Reset),
	// and writes back only on a real edit — merged over `extraJson`. See
	// `useExtraJsonSync` for why the seed's own write-back is skipped.
	useExtraJsonSync<ExtraFieldData>({
		connection: () => connection,
		fields: () => ollamaFields,
		seed: (extraJson) => {
			ollamaFields = extraJsonToExtraFields({
				...defaultExtraJson,
				...(extraJson ?? {})
			} as ExtraJson)
		},
		project: (fields) =>
			extraFieldsToExtraJson(fields)
	})
</script>

{#if connection}
	<!-- No model picker and no Refresh here: models are synced from the
	     host on their own and browsed from the connections index. Test
	     checks the host (and persists what it lists). -->
	<!-- The Test button lives on the connection view's status card, not
	     here. Two Test buttons on one screen, styled differently and
	     reporting into different places, was the shipped state. -->
	<!-- Out of "Request settings": the address is what an Ollama connection
	     cannot work without, and every Ollama connection is managed against
	     its own host — "Change address" on the status card lands here (plan
	     2026-09-24 B4/C4). -->
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
		{#if ollamaFields}
			<div class="mt-2 flex flex-col gap-1">
				<!-- Points at the number, which is what "Keep Alive" actually
				     labels. The unit
				     picker carries its own label, hidden so the pair still
				     reads as one field. -->
				<label class="font-semibold" for="keepAliveNumber">
					Keep Alive
				</label>
				<div class="flex items-center gap-2">
					<input
						id="keepAliveNumber"
						type="number"
						step="1"
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
				<!-- "Use Chat Mode" lived here. It is a CAPABILITY now —
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
