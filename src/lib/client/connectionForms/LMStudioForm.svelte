<script lang="ts">
	import { PromptFormats } from "$lib/shared/constants/PromptFormats"
	import { TokenCounterOptions } from "$lib/shared/constants/TokenCounters"
	import { onMount, onDestroy } from "svelte"
	import * as skio from "sveltekit-io"

	interface Props {
		connection: SelectConnection
	}

	let { connection = $bindable() } = $props()

	const socket = skio.get()
	let availableLMStudioModels: { model: string; name: string }[] = $state([])
	let testResult: { ok: boolean; error?: string; models?: any[] } | null =
		$state(null)
	let extraFields = $state(extraJsonToExtraFields(connection.extraJson || {}))

	function handleRefreshModels() {
		socket.emit("refreshModels", {
			connection
		} as Sockets.RefreshModels.Call)
	}

	function handleTestConnection() {
		testResult = null
		socket.emit("testConnection", {
			connection
		} as Sockets.TestConnection.Call)
	}

	function extraJsonToExtraFields(extraJson: any) {
		return {
			stream: extraJson?.stream ?? true,
			think: extraJson?.think ?? false,
			ttl: extraJson?.ttl ?? 60,
			raw: extraJson?.raw ?? true,
			useChat: extraJson?.useChat ?? true
		}
	}

	$effect(() => {
		connection.extraJson = {
			...connection.extraJson,
			stream: extraFields.stream,
			think: extraFields.think,
			ttl: extraFields.ttl,
			raw: extraFields.raw,
			useChat: extraFields.useChat
		}
	})

	socket.on("refreshModels", (msg: Sockets.RefreshModels.Response) => {
		if (msg.models) availableLMStudioModels = msg.models
	})

	socket.on("testConnection", (msg: Sockets.TestConnection.Response) => {
		testResult = msg
	})

	onMount(() => {
		if (connection.baseUrl) {
			handleRefreshModels()
		}
	})

	onDestroy(() => {
		socket.off("refreshModels")
		socket.off("testConnection")
	})
</script>

<div class="flex flex-col gap-4">
	<div class="mt-2 flex flex-col gap-1">
		<label class="font-semibold" for="model">Model</label>
		<select
			id="model"
			bind:value={connection.model}
			class="select bg-background border-muted w-full rounded border"
		>
			<option value="">-- Select Model --</option>
			{#each availableLMStudioModels as m}
				<option value={m.model}>{m.name}</option>
			{/each}
		</select>
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
		{#if !extraFields.useChat}
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
			<label class="font-semibold" for="tokenCounter">
				Token Counter
			</label>
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
	</div>
	<!-- <div class="flex gap-4">
		<label class="flex items-center gap-2">
			<input
				type="checkbox"
				bind:checked={extraFields.think}
				onchange={() => {
					connection.extraJson = {
						...connection.extraJson,
						think: extraFields.think
					}
					handleChange()
				}}
			/>
			Think
		</label>
		<label class="flex items-center gap-2">
			<input
				type="checkbox"
				bind:checked={extraFields.raw}
				onchange={() => {
					connection.extraJson = {
						...connection.extraJson,
						raw: extraFields.raw
					}
					handleChange()
				}}
			/>
			Raw
		</label> 
	</div>-->
	<details class="mt-2">
		<summary class="cursor-pointer font-semibold">
			Advanced Settings
		</summary>
		<div class="mt-2 flex flex-col gap-1">
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
			<!-- Use Chat toggle -->
			<div class="mt-2 flex items-center gap-2">
				<label class="font-semibold" for="useChat">Use Chat Mode</label>
				<input
					type="checkbox"
					id="useChat"
					bind:checked={extraFields.useChat}
				/>
			</div>
			<div class="mt-2 flex items-center gap-2">
				<label class="font-semibold" for="stream">Stream</label>
				<input
					type="checkbox"
					name="stream"
					bind:checked={extraFields.stream}
					onchange={() => {
						connection.extraJson = {
							...connection.extraJson,
							stream: extraFields.stream
						}
					}}
				/>
			</div>
			<div class="mt-2 flex flex-col gap-1">
				<label class="font-semibold" for="ttl">Keep Alive (seconds)</label>
				<input
					id="ttl"
					type="number"
					bind:value={extraFields.ttl}
					class="input"
					placeholder="60"
					min="1"
				/>
			</div>
		</div>
	</details>
	{#if testResult?.error}
		<div class="text-error mt-1 text-xs">{testResult.error}</div>
	{/if}
</div>
