<script lang="ts">
	import AudioCppBinaryVariantPicker from "./AudioCppBinaryVariantPicker.svelte"

	interface Props {
		onDownloadStarted: () => void
	}

	let { onDownloadStarted }: Props = $props()
</script>

<div class="flex flex-col gap-2 py-4">
	<div class="px-3">
		<p class="text-sm font-semibold">Set up audio.cpp</p>
		<p class="text-surface-700-300 mt-1 text-xs leading-relaxed">
			audio.cpp speaks replies aloud and transcribes audio. Serene Pub
			downloads it and runs it on this machine. Pick a build below; models
			come next, from the Models tab.
		</p>
	</div>
	<AudioCppBinaryVariantPicker {onDownloadStarted} />
</div>
