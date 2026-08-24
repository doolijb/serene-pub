<script lang="ts">
	import { page } from "$app/state"

	// There was no +error.svelte at all before this, so every SvelteKit error —
	// a mistyped URL, a deleted session id, a load() throwing — rendered the
	// framework's built-in fallback: an unstyled white page with a bare status
	// code, on an app that is otherwise dark-themed, with no way back.
	//
	// Styling is inline rather than themed on purpose: this can render before
	// (or instead of) the app shell, including when the failure is in a layout
	// load, so it can't depend on the theme having been applied.
	const status = $derived(page.status)
	const isNotFound = $derived(status === 404)
	const message = $derived(page.error?.message ?? "Something went wrong.")
</script>

<svelte:head>
	<title>{isNotFound ? "Not found" : "Error"} — Serene Pub</title>
</svelte:head>

<div
	class="flex min-h-screen items-center justify-center p-6"
	style="background:#1a1a22;color:#e8e8ef;"
	role="alert"
>
	<div class="w-full max-w-lg space-y-4 text-center">
		<p class="text-6xl font-bold opacity-30">{status}</p>
		<h1 class="text-2xl font-bold">
			{isNotFound ? "That page doesn't exist" : "Something went wrong"}
		</h1>
		{#if !isNotFound}
			<p class="font-mono text-xs opacity-70">{message}</p>
		{/if}
		<div class="flex flex-wrap items-center justify-center gap-3 pt-2">
			<a
				class="rounded-lg px-4 py-2 text-sm font-medium"
				style="background:#4f46e5;color:#fff;"
				href="/"
			>
				Back to Serene Pub
			</a>
			<a class="rounded-lg px-4 py-2 text-sm underline" href="/docs">
				Documentation
			</a>
		</div>
	</div>
</div>
