<script lang="ts">
	/**
	 * The entity connection's form: an idle timeout, and nothing else.
	 *
	 * There is one backend today and it runs in this process, so there is no host
	 * and no key to set. ⚠ The MODEL is not here either — it is chosen through
	 * `ConnectionModels`, the picker every other connection uses, which the
	 * sidebar mounts once below this. A model field here would be a second place
	 * to set one, and the pair `(endpoint, model)` is what a star registers.
	 *
	 * When a hosted entity endpoint becomes a type, its base URL and key belong
	 * here beside the timeout, the way `EmbeddingConnectionForm` carries all
	 * three: what differs between backends of one modality is two fields, not a
	 * component.
	 */
	import { CONNECTION_TYPE } from "$lib/shared/constants/ConnectionTypes"
	import { DEFAULT_NER_TTL_MINUTES } from "$lib/shared/constants/ner"

	interface Props {
		connection: SelectConnection
	}
	let { connection = $bindable() }: Props = $props()

	const isLocal = $derived(connection.type === CONNECTION_TYPE.LOCAL_ONNX_NER)

	/**
	 * The idle-unload window, in minutes, on this connection's own row.
	 *
	 * A property of the MODEL that gets unloaded, so it rides on the connection
	 * that names it rather than on the instance, and it is what the annotation
	 * lane's broker reports as the lane's TTL.
	 *
	 * Bound through a string so an empty field does not read as 0 — zero is a
	 * real setting here ("keep it loaded") and must not be what clearing the box
	 * means.
	 */
	let ttlInput = $state(
		String(
			(connection.extraJson as any)?.nerModelTtlMinutes ??
				DEFAULT_NER_TTL_MINUTES
		)
	)
	function commitTtl() {
		const n = parseInt(ttlInput, 10)
		if (Number.isNaN(n) || n < 0) {
			ttlInput = String(
				(connection.extraJson as any)?.nerModelTtlMinutes ??
					DEFAULT_NER_TTL_MINUTES
			)
			return
		}
		connection.extraJson = {
			...((connection.extraJson as any) ?? {}),
			nerModelTtlMinutes: n
		}
	}
</script>

{#if isLocal}
	<p class="text-muted mt-4 text-xs">
		Runs in this process on the CPU. Nothing leaves the machine, and there
		is no host or key to set. Pick a model below; it downloads once.
	</p>
{/if}

<div class="mt-4 flex flex-col gap-1">
	<label class="font-semibold" for="ner-ttl">Model idle timeout</label>
	<div class="flex items-center gap-2">
		<input
			id="ner-ttl"
			type="number"
			min="0"
			step="1"
			class="input w-24"
			bind:value={ttlInput}
			onblur={commitTtl}
			aria-describedby="ner-ttl-help"
		/>
		<span class="text-muted text-sm">minutes</span>
	</div>
	<p id="ner-ttl-help" class="text-muted text-xs">
		Unload the model after this long with nothing to scan. Set 0 to keep it
		loaded. Scanning resumes on its own either way; a cold start costs the
		load.
	</p>
</div>
