<script lang="ts">
	import { TokenCounterOptions } from "$lib/shared/constants/TokenCounters"
	import { Switch } from "@skeletonlabs/skeleton-svelte"
	import { onMount } from "svelte"
	import { useTypedSocket } from "$lib/client/sockets/loadSockets.client"
	import { useInterest } from "$lib/client/sockets/interest.svelte"
	import { z } from "zod"

	/**
	 * ⚠ `thinking` and `thinkingBudget` are gone from this form (ruling
	 * 2026-09-12): reasoning is a SAMPLING parameter now, chosen per stage on
	 * the sampling config rather than once for every stage this connection
	 * serves. Stale keys in an existing row's `extraJson` are read by nothing —
	 * the column is jsonb, so an unread key costs nothing and no migration
	 * clears them. Do not re-add the toggle here.
	 */
	interface ExtraFieldData {
		stream: boolean
		apiKey: string
	}

	interface ExtraJson {
		stream?: boolean
		apiKey?: string
	}

	const schema = z.object({
		apiKey: z.string().min(1, "API key is required")
	})

	type ValidationErrors = Record<string, string>

	let { connection = $bindable() }: { connection: SelectConnection } =
		$props()

	const socket = useTypedSocket()
	const defaultExtraJson: ExtraFieldData = {
		stream: true,
		apiKey: ""
	}

	let fields: ExtraFieldData | undefined = $state()
	let validationErrors: ValidationErrors = $state({})
	let testResult: { ok: boolean; error?: string | null } | null = $state(null)

	// Standing interest in the test result, held by the registry for as long as
	// this form is mounted and released with it. The registry keeps ONE raw
	// listener for the event and fans it out, so the parent sidebar's own
	// interest is untouched by this form coming and going.
	const onConnectionsTest = (msg: Sockets.Connections.Test.Response) => {
		testResult = msg
	}
	useInterest<"connections:test">("connections:test", onConnectionsTest)

	function handleTestConnection() {
		if (!validateConnection()) return
		testResult = null
		socket.emit("connections:test", { connection })
	}

	function validateConnection(): boolean {
		const result = schema.safeParse({
			apiKey: fields?.apiKey || ""
		})
		if (result.success) {
			validationErrors = {}
			return true
		}
		const errors: ValidationErrors = {}
		result.error.errors.forEach((e) => {
			if (e.path.length > 0) errors[e.path[0] as string] = e.message
		})
		validationErrors = errors
		return false
	}

	function extraJsonToFields(extraJson: ExtraJson): ExtraFieldData {
		return {
			stream: extraJson.stream ?? true,
			apiKey: extraJson.apiKey || ""
		}
	}

	function fieldsToExtraJson(f: ExtraFieldData): ExtraJson {
		return {
			stream: f.stream,
			apiKey: f.apiKey
		}
	}

	$effect(() => {
		if (fields) {
			connection.extraJson = fieldsToExtraJson(fields)
		}
	})

	onMount(() => {
		fields = extraJsonToFields({
			...defaultExtraJson,
			...(connection.extraJson || {})
		})
	})
</script>

{#if connection && fields}
	<!-- Model picker removed: models live in the Models section below. -->

	<!-- The Test button lives on the connection view's status card, not
	     here. Two Test buttons on one screen, styled differently and
	     reporting into different places, was the shipped state. -->
	{#if testResult?.ok === false && testResult.error}
		<p class="text-error-500 mt-1 text-sm" role="alert">
			{testResult.error}
		</p>
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
		<label class="font-semibold" for="apiKey">API Key</label>
		<input
			id="apiKey"
			type="password"
			bind:value={fields.apiKey}
			placeholder="sk-ant-..."
			class="input {validationErrors.apiKey ? 'border-error-500' : ''}"
		/>
		{#if validationErrors.apiKey}
			<p class="text-error-500 mt-1 text-sm" role="alert">
				{validationErrors.apiKey}
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
			<Switch
				name="stream"
				checked={fields.stream}
				onCheckedChange={(e) => (fields!.stream = e.checked)}
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
	</details>
{/if}
