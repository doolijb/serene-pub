<script lang="ts">
	import { browser } from "$app/environment"
	import Layout from "$lib/client/components/Layout.svelte"
	import { loadSocketsClient } from "$lib/client/sockets/loadSockets.client"
	import type { Snippet } from "svelte"
	import { page } from "$app/state"
	import * as Icons from "@lucide/svelte"
	import { Toast } from "@skeletonlabs/skeleton-svelte"
	import { toaster } from "$lib/client/utils/toaster"
	import LoginForm from "$lib/client/components/LoginForm.svelte"

	interface Props {
		children?: Snippet
	}

	let { children }: Props = $props()

	let socketsInitialized = $state(false)
	let showUpdateBar = $state(true)
	let showLogin = $state(false)

	async function initializeSocketsIfAllowed() {
		if (!browser) return
		const { checkSystemSettings, checkAuthentication } = await import(
			"$lib/client/utils/authFlow"
		)
		const systemSettings = await checkSystemSettings()
		if (systemSettings.isAccountsEnabled) {
			const isAuthenticated = await checkAuthentication()
			if (!isAuthenticated) {
				showLogin = true
				return
			}
		}
		const domain = page.url.hostname
		await loadSocketsClient({ domain })
		socketsInitialized = true
	}

	if (browser) {
		initializeSocketsIfAllowed()
	}
</script>

<svelte:head>
	<title>Serene Pub</title>
	<meta name="description" content="Serene Pub" />
</svelte:head>

{#if socketsInitialized}
	<Layout>
		{#key page.route}
			{@render children?.()}
		{/key}
	</Layout>
{:else if showLogin}
	<LoginForm />
{/if}
{#if page.data?.isNewerReleaseAvailable && showUpdateBar}
	<div
		class="bg-surface-200-800 sticky right-0 bottom-0 left-0 z-100 p-4 text-center"
	>
		<span>
			A newer version of Serene Pub is available!&nbsp;
			<a
				href="https://github.com/doolijb/serene-pub/releases"
				target="_blank"
				rel="noopener"
				class="btn preset-filled-success-500"
			>
				<Icons.Download size={16} />
				Download here
			</a>
		</span>
		<button
			onclick={() => (showUpdateBar = false)}
			style="margin-left: 2rem; background: none; border: none; color: #fff; font-size: 1.5rem; cursor: pointer;"
		>
			<Icons.X size={16} />
		</button>
	</div>
{/if}

<Toast.Group {toaster}>
	{#snippet children(toast)}
		<Toast
			{toast}
			class="card flex items-start gap-3 p-4 shadow-xl {toast.type === 'error'
				? 'preset-filled-error-500'
				: toast.type === 'success'
					? 'preset-filled-success-500'
					: toast.type === 'warning'
						? 'preset-filled-warning-500'
						: 'preset-filled-surface-500'}"
		>
			<Toast.Message class="flex-1 space-y-1">
				{#if toast.title}
					<Toast.Title class="font-semibold">{toast.title}</Toast.Title>
				{/if}
				{#if toast.description}
					<Toast.Description class="text-sm opacity-80">{toast.description}</Toast.Description>
				{/if}
			</Toast.Message>
			{#if toast.closable}
				<Toast.CloseTrigger class="btn btn-sm">
					<Icons.X size={16} />
				</Toast.CloseTrigger>
			{/if}
		</Toast>
	{/snippet}
</Toast.Group>
