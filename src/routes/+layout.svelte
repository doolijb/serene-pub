<script lang="ts">
	import { browser } from "$app/environment"
	import Layout from "$lib/client/components/Layout.svelte"
	import { loadSocketsClient } from "$lib/client/sockets/loadSockets.client"
    import type { Snippet } from "svelte"
	import { page } from "$app/state"
	import * as Icons from "@lucide/svelte"
	import { Toaster } from "@skeletonlabs/skeleton-svelte"
	import { toaster } from "$lib/client/utils/toaster"

	interface Props {
		children?: Snippet
	}

	let { children }: Props = $props()

	let socketsInitialized = $state(false)
	let showUpdateBar = $state(true)

	if (browser) {
		const domain = page.url.hostname
		console.log(`Serene Pub is running on domain: ${domain}`)
		loadSocketsClient({domain}).then(() => {
			socketsInitialized = true
		})
	}
</script>

{#if socketsInitialized}
	<Layout>
		{@render children?.()}
	</Layout>
{/if}
{#if page.data?.isNewerReleaseAvailable && showUpdateBar}
	<div class="sticky bottom-0 left-0 right-0 p-4 bg-surface-200-800 text-center z-100">
		<span>
			A newer version of Serene Pub is available!&nbsp;
			<a href="https://github.com/doolijb/serene-pub/releases" target="_blank" rel="noopener" class="btn preset-filled-success-500">
				<Icons.Download size={16} />
				Download here
			</a>
		</span>
		<button onclick={() => showUpdateBar = false} style="margin-left: 2rem; background: none; border: none; color: #fff; font-size: 1.5rem; cursor: pointer;">
			<Icons.X size={16} />
		</button>
	</div>
{/if}

<Toaster {toaster}></Toaster>
