<script lang="ts">
	/**
	 * The Fooocus (image generation) connection form. Deliberately lean — no
	 * prompt format / token counter / session mode, which are text-only. Just the
	 * Fooocus-API URL, an optional API key, a Test button, and a checkpoint picker
	 * populated from the test's model list.
	 */
	import * as Icons from "@lucide/svelte"
	import { onDestroy } from "svelte"
	import { useTypedSocket } from "$lib/client/sockets/typedSocket"

	interface Props {
		connection: SelectConnection
	}
	let { connection = $bindable() }: Props = $props()

	const socket = useTypedSocket()

	type TestResult = { ok: boolean; error?: string; models?: string[] }
	let testResult = $state<TestResult | null>(null)
	let models: string[] = $derived(testResult?.models ?? [])

	// A named handler + targeted off, so unmounting this form removes only its
	// own listener and never the parent sidebar's connections:test handler.
	const onTest = (msg: Sockets.Connections.Test.Response) => {
		if (msg.connectionId != null && msg.connectionId !== connection.id) return
		testResult = {
			ok: msg.ok,
			error: msg.error ?? undefined,
			models: msg.models
		}
	}
	socket.on("connections:test", onTest)
	onDestroy(() => socket.off("connections:test", onTest))

	function handleTest() {
		testResult = null
		socket.emit("connections:test", { connection })
	}

	// The apiKey binding needs a container object.
	$effect(() => {
		if (connection && !connection.extraJson) connection.extraJson = {}
	})
</script>

{#if connection}
	<div class="mt-4 flex flex-col gap-1">
		<label class="font-semibold" for="fooocus-base">Fooocus-API URL</label>
		<input
			id="fooocus-base"
			type="text"
			class="input"
			placeholder="http://localhost:8888"
			bind:value={connection.baseUrl}
		/>
		<p class="text-muted-foreground text-xs">
			Fooocus itself has no HTTP API — run <b>Fooocus-API</b> (the FastAPI
			wrapper) and point this at it. Default port is 8888.
		</p>
	</div>

	{#if connection.extraJson}
		<div class="mt-2 flex flex-col gap-1">
			<label class="font-semibold" for="fooocus-key">
				API Key (optional)
			</label>
			<input
				id="fooocus-key"
				type="password"
				class="input"
				placeholder="Only if Fooocus-API was started with --apikey"
				bind:value={connection.extraJson.apiKey}
			/>
		</div>
	{/if}

	<div class="mt-3 flex gap-2">
		<button
			type="button"
			class="btn preset-tonal-success btn-sm w-full"
			onclick={handleTest}
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

	{#if models.length}
		<div class="mt-3 flex flex-col gap-1">
			<label class="flex items-center gap-1.5 font-semibold" for="fooocus-model">
				<Icons.Image size={14} />
				Checkpoint
			</label>
			<select
				id="fooocus-model"
				class="select bg-background border-muted w-full rounded border"
				bind:value={connection.model}
			>
				<option value="">(Fooocus default)</option>
				{#each models as m}
					<option value={m}>{m}</option>
				{/each}
			</select>
			<p class="text-muted-foreground text-xs">
				The base checkpoint. Leave on default to let Fooocus choose.
			</p>
		</div>
	{/if}
{/if}
