<script lang="ts">
	import * as Icons from "@lucide/svelte"
	import { getContext } from "svelte"

	/**
	 * The form for the audio.cpp this pub runs.
	 *
	 * There is nothing here to type: the address comes from audio.cpp's own
	 * settings (its port), and its speech and transcription packages are got
	 * in the connection's Models tab. So the form says so, and says when the
	 * runtime is switched off.
	 */
	let { connection = $bindable() } = $props()

	const audioCppSettingsCtx: AudioCppSettingsCtx = $state(
		getContext("audioCppSettingsCtx") ?? { settings: undefined }
	)
	const settings = $derived(audioCppSettingsCtx.settings)
	// Unknown until settings arrive: claim nothing about the switch.
	const switchedOff = $derived(!!settings && !settings.enabled)
	const address = $derived(
		settings?.baseUrl ?? connection?.baseUrl ?? ""
	)
</script>

{#if connection}
	{#if switchedOff}
		<div
			class="border-warning-500 bg-warning-500/10 mt-4 flex items-start gap-2 rounded-lg border p-3"
		>
			<Icons.AlertTriangle
				size={16}
				class="text-warning-700-300 mt-0.5 shrink-0"
			/>
			<p class="text-warning-700-300 text-sm">
				This connection is audio.cpp, run by Serene Pub, which is turned
				off. Turn it on from Connections → Add → audio.cpp, run by Serene
				Pub to use this connection.
			</p>
		</div>
	{/if}

	<p class="text-surface-600-400 mt-4 text-sm">
		Address
		<span class="text-surface-950-50 ml-1 font-mono">{address}</span>
	</p>
	<p class="text-surface-600-400 mt-1 text-sm">
		This address comes from audio.cpp's own settings, so it is not edited
		here. Speech and transcription models are got in this connection's Models
		tab.
	</p>
{/if}
