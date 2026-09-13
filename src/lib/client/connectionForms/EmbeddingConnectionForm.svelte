<script lang="ts">
	/**
	 * One form for all three embedding backends.
	 *
	 * The same argument `ImageConnectionForm` makes: what differs between them is
	 * two fields, not a component. Local ONNX has neither a host nor a key (the
	 * weights sit in the app data directory); the two host types have both, and
	 * differ only in which route their adapter posts to — which is the TYPE's
	 * business, not this form's.
	 *
	 * ⚠ The MODEL is not here. It is chosen through `ConnectionModels`, the same
	 * picker every other connection uses, which the sidebar mounts once below
	 * this for all of them. A model field here would be a second place to set
	 * one, and the pair `(endpoint, model)` is what a star registers.
	 */
	import { CONNECTION_TYPE } from "$lib/shared/constants/ConnectionTypes"
	import { DEFAULT_EMBEDDING_TTL_MINUTES } from "$lib/shared/constants/embeddings"

	interface Props {
		connection: SelectConnection
	}
	let { connection = $bindable() }: Props = $props()

	const isLocal = $derived(
		connection.type === CONNECTION_TYPE.LOCAL_ONNX_EMBEDDINGS
	)
	// Ollama's route needs no key; an OpenAI-compatible one usually does, and
	// LM Studio or llama.cpp usually does not, which is why it stays optional.
	const takesKey = $derived(
		connection.type === CONNECTION_TYPE.OPENAI_EMBEDDINGS
	)

	/**
	 * The idle-unload window, in minutes, on this connection's own row.
	 *
	 * A property of the MODEL that gets unloaded, so it rides on the connection
	 * that names it rather than on the instance. Two embedding connections may
	 * want different windows, and one number for both could serve neither.
	 *
	 * Bound through a string so an empty field does not read as 0 — zero is a
	 * real setting here ("keep it loaded") and must not be what clearing the box
	 * means.
	 */
	let ttlInput = $state(
		String(
			(connection.extraJson as any)?.embeddingModelTtlMinutes ??
				DEFAULT_EMBEDDING_TTL_MINUTES
		)
	)
	function commitTtl() {
		const n = parseInt(ttlInput, 10)
		if (Number.isNaN(n) || n < 0) {
			ttlInput = String(
				(connection.extraJson as any)?.embeddingModelTtlMinutes ??
					DEFAULT_EMBEDDING_TTL_MINUTES
			)
			return
		}
		connection.extraJson = {
			...((connection.extraJson as any) ?? {}),
			embeddingModelTtlMinutes: n
		}
	}
</script>

{#if !isLocal}
	<div class="mt-4 flex flex-col gap-1">
		<label class="font-semibold" for="embedding-base-url">Base URL</label>
		<input
			id="embedding-base-url"
			type="text"
			class="input"
			bind:value={connection.baseUrl}
			placeholder={connection.type === CONNECTION_TYPE.OLLAMA_EMBEDDINGS
				? "http://localhost:11434"
				: "https://api.openai.com/v1"}
			aria-describedby="embedding-base-url-help"
		/>
		<p id="embedding-base-url-help" class="text-muted text-xs">
			{#if connection.type === CONNECTION_TYPE.OLLAMA_EMBEDDINGS}
				Ollama's own address. Embeddings go to its native /api/embed
				route, so do not add /v1 here.
			{:else}
				Sent exactly as typed. Most services want /v1 on the end;
				llama.cpp's server does not.
			{/if}
		</p>
	</div>

	{#if takesKey}
		<div class="mt-4 flex flex-col gap-1">
			<label class="font-semibold" for="embedding-api-key">API Key</label>
			<input
				id="embedding-api-key"
				type="password"
				class="input"
				value={typeof (connection.extraJson as any)?.apiKey === "string"
					? (connection.extraJson as any).apiKey
					: ""}
				oninput={(e) =>
					(connection.extraJson = {
						...((connection.extraJson as any) ?? {}),
						apiKey: e.currentTarget.value
					})}
				placeholder="Optional, depending on the service"
				aria-describedby="embedding-api-key-help"
			/>
			<p id="embedding-api-key-help" class="text-muted text-xs">
				Stored encrypted. Leave it empty for a service that does not ask
				for one, such as LM Studio or llama.cpp.
			</p>
		</div>
	{/if}
{:else}
	<p class="text-muted mt-4 text-xs">
		Runs in this process on the CPU. Nothing leaves the machine, and there
		is no host or key to set. Pick a model below; it downloads once.
	</p>
{/if}

<div class="mt-4 flex flex-col gap-1">
	<label class="font-semibold" for="embedding-ttl">Model idle timeout</label>
	<div class="flex items-center gap-2">
		<input
			id="embedding-ttl"
			type="number"
			min="0"
			step="1"
			class="input w-24"
			bind:value={ttlInput}
			onblur={commitTtl}
			aria-describedby="embedding-ttl-help"
		/>
		<span class="text-muted text-sm">minutes</span>
	</div>
	<p id="embedding-ttl-help" class="text-muted text-xs">
		{#if isLocal}
			Unload the model after this long with nothing to do. Set 0 to keep
			it loaded.
		{:else}
			Kept for consistency. A hosted endpoint holds no memory here, so
			nothing is unloaded whatever this says.
		{/if}
	</p>
</div>
