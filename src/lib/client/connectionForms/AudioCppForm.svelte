<script lang="ts">
	interface Props {
		connection: SelectConnection
	}
	let { connection = $bindable() }: Props = $props()
</script>

{#if connection}
	<!-- No model picker and no Refresh here: models are synced from the
	     host on their own and browsed from the connections index. Test
	     checks the host (and persists what it lists). -->
	<!-- The Test button lives on the connection view's status card, not
	     here. Two Test buttons on one screen, styled differently and
	     reporting into different places, was the shipped state. -->
	<div class="mt-2 flex flex-col gap-1">
		<label class="font-semibold" for="baseUrl">Server URL</label>
		<input
			id="baseUrl"
			type="url"
			bind:value={connection.baseUrl}
			placeholder="http://127.0.0.1:8080"
			required
			class="input"
		/>
		<p class="text-surface-600-400 text-xs">
			The address of an audio.cpp server you run yourself.
		</p>
	</div>
{/if}
