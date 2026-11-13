<!--
	🚧 Advanced controls (2026-11-10): one muted line at the foot of a form that
	hid something, with a quiet link that turns the preference on. Static: it
	counts nothing. It never registers a socket listener and never toasts; the
	surface redraws when the shell's `userSettings:get` listener updates
	`userSettingsCtx`, and a failure is toasted by Layout's `:error` catch-all.
-->
<script lang="ts">
	import { useTypedSocket } from "$lib/client/sockets/loadSockets.client"

	let { class: className = "" }: { class?: string } = $props()

	const socket = useTypedSocket()

	function onShowClick() {
		socket?.emit("userSettings:updateShowAdvancedControls", {
			enabled: true
		})
	}
</script>

<p class="text-surface-600-400 text-xs {className}">
	Some controls are hidden.
	<button type="button" class="anchor" onclick={onShowClick}>
		Show advanced controls
	</button>
</p>
