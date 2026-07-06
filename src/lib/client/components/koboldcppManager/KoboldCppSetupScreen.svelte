<script lang="ts">
	import * as Icons from "@lucide/svelte"
	import * as skio from "sveltekit-io"
	import { onMount, onDestroy } from "svelte"
	import { toaster } from "$lib/client/utils/toaster"

	interface Props {
		onChooseManaged: () => void
		onChooseExternal: () => void
	}

	let { onChooseManaged, onChooseExternal }: Props = $props()

	const socket = skio.get()
	let saving = $state(false)

	function chooseManaged() {
		saving = true
		socket.emit("koboldcpp:setManagedMode", { mode: "managed" })
	}

	function chooseExternal() {
		saving = true
		socket.emit("koboldcpp:setManagedMode", { mode: "external" })
	}

	onMount(() => {
		socket.on("koboldcpp:setManagedMode", (msg: Sockets.KoboldCpp.SetManagedMode.Response) => {
			saving = false
			if (!msg.success) toaster.error({ title: "Failed to save mode" })
		})
		socket.on("koboldcpp:setManagedMode:error", () => {
			saving = false
			toaster.error({ title: "Failed to save mode" })
		})
	})

	onDestroy(() => {
		socket.off("koboldcpp:setManagedMode")
		socket.off("koboldcpp:setManagedMode:error")
	})
</script>

<div class="flex flex-col items-center gap-6 px-4 py-8">
	<div class="text-center">
		<p class="text-surface-600-400 text-sm">
			Choose how you want to use KoboldCPP with Serene Pub.
		</p>
	</div>

	<div class="flex w-full max-w-lg flex-col gap-4">
		<!-- Managed option -->
		<button
			class="bg-surface-100-900 hover:bg-surface-200-800 border-surface-300-700 hover:border-primary-500 flex flex-col items-start gap-3 rounded-xl border-2 p-5 text-left transition disabled:opacity-50"
			onclick={() => { chooseManaged(); onChooseManaged() }}
			disabled={saving}
		>
			<div class="bg-primary-100-900 text-primary-600-400 rounded-lg p-2.5">
				<Icons.Bot size={22} />
			</div>
			<div>
				<p class="text-sm font-semibold">Let Serene Pub manage it</p>
				<p class="text-surface-500 mt-1 text-xs leading-relaxed">
					Download a KoboldCPP binary and let Serene Pub start, stop, and load models
					automatically.
				</p>
			</div>
			<span class="bg-primary-500 mt-auto rounded px-2 py-0.5 text-xs font-medium text-white">
				Recommended
			</span>
		</button>

		<!-- External option -->
		<button
			class="bg-surface-100-900 hover:bg-surface-200-800 border-surface-300-700 hover:border-secondary-500 flex flex-col items-start gap-3 rounded-xl border-2 p-5 text-left transition disabled:opacity-50"
			onclick={() => { chooseExternal(); onChooseExternal() }}
			disabled={saving}
		>
			<div class="bg-secondary-100-900 text-secondary-600-400 rounded-lg p-2.5">
				<Icons.Terminal size={22} />
			</div>
			<div>
				<p class="text-sm font-semibold">I'll manage it myself</p>
				<p class="text-surface-500 mt-1 text-xs leading-relaxed">
					Start KoboldCPP yourself and connect Serene Pub to the running instance via URL.
				</p>
			</div>
			<span class="text-surface-500 mt-auto text-xs">Manual setup</span>
		</button>
	</div>
</div>
