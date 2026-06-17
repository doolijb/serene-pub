<script lang="ts">
	import * as Icons from "@lucide/svelte"
	import { getContext, onMount, onDestroy } from "svelte"

	let panelsCtx: PanelsCtx = $state(getContext("panelsCtx"))
	let vectorizationCtx: VectorizationCtx = $state(getContext("vectorizationCtx"))

	// Prevent body scroll when mobile menu is open
	$effect(() => {
		if (panelsCtx.isMobileMenuOpen) {
			document.body.style.overflow = "hidden"
		} else {
			document.body.style.overflow = ""
		}
	})

	// Close on Escape key
	function handleKeydown(e: KeyboardEvent) {
		if (e.key === "Escape" && panelsCtx.isMobileMenuOpen) {
			panelsCtx.isMobileMenuOpen = false
		}
	}
	onMount(() => {
		window.addEventListener("keydown", handleKeydown)
		return () => window.removeEventListener("keydown", handleKeydown)
	})
</script>

<header class="w-full" role="banner">
	<div
		class="bg-surface-100-900 bg-opacity-25 relative mx-auto flex w-full justify-between px-4 py-2 backdrop-blur"
	>
		<!-- Desktop left nav -->
		<nav
			class="hidden flex-1 justify-start gap-2 lg:flex"
			aria-label="Left navigation"
			role="navigation"
		>
			{#each panelsCtx.getOrderedEntries(panelsCtx.leftNav, panelsCtx.leftNavOrder || []) as [key, item]}
				{#if item?.icon}
					{@const isOpen = panelsCtx.leftPanel === key}
					{@const isVectorizationRunning = key === "vectorization" && vectorizationCtx?.status === "running"}
					<button
						title={item.title}
						onclick={() => panelsCtx.openPanel({ key })}
						aria-pressed={isOpen}
						aria-label="Open {item.title} panel"
						type="button"
					>
						<item.icon
							class="{isOpen
								? 'text-primary-800-200'
								: ''} {isVectorizationRunning
								? 'animate-spin-slow text-success-500'
								: ''} hover:text-primary-500 h-5 w-5 transition-colors"
							aria-hidden="true"
						/>
					</button>
				{/if}
			{/each}
		</nav>

		<!-- Title (centered absolutely for desktop) -->
		<div
			class="pointer-events-none ml-2 flex w-auto flex-0 justify-center md:absolute md:top-1/2 md:left-1/2 md:ml-0 md:w-auto md:-translate-x-1/2 md:-translate-y-1/2"
		>
			<a
				class="text-foreground funnel-display pointer-events-auto text-xl font-bold tracking-tight whitespace-nowrap"
				href="/"
				aria-label="Serene Pub - Home"
			>
				Serene Pub
			</a>
		</div>

		<!-- Desktop right nav -->
		<nav
			class="hidden flex-1 justify-end gap-2 lg:flex"
			aria-label="Right navigation"
			role="navigation"
		>
			{#each Object.entries(panelsCtx.rightNav) as [key, item]}
				{#if item?.icon}
					{@const isOpen = panelsCtx.rightPanel === key}
					<button
						class="btn-ghost"
						title={item.title}
						onclick={() => panelsCtx.openPanel({ key })}
						aria-pressed={isOpen}
						aria-label="Open {item.title} panel"
						type="button"
					>
						<item.icon
							class="{isOpen
								? 'text-primary-800-200'
								: ''} hover:text-primary-500 h-5 w-5 transition-colors"
							aria-hidden="true"
						/>
					</button>
				{/if}
			{/each}
		</nav>

		<div class="flex items-center gap-2 lg:hidden">
			<button
				class="btn preset-tonal"
				aria-label="Open navigation menu"
				onclick={() => {
					panelsCtx.isMobileMenuOpen = true
				}}
				type="button"
				aria-expanded={panelsCtx.isMobileMenuOpen}
			>
				<Icons.Menu
					class="text-foreground h-6 w-6"
					aria-hidden="true"
				/>
			</button>
		</div>
	</div>
</header>

<style lang="postcss">
	@reference "tailwindcss";

	header {
		display: flex;
		justify-content: space-between;
	}
</style>
