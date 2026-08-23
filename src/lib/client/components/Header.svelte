<script lang="ts">
	import * as Icons from "@lucide/svelte"
	import { getContext, onMount, onDestroy } from "svelte"

	let panelsCtx: PanelsCtx = $state(getContext("panelsCtx"))
	let vectorizationCtx: VectorizationCtx = $state(
		getContext("vectorizationCtx")
	)
	let taskQueueCtx: TaskQueueCtx = $state(getContext("taskQueueCtx"))
	let graphBuildsCtx: GraphBuildsCtx = $state(getContext("graphBuildsCtx"))
	let sceneSummarizesCtx: SceneSummarizesCtx = $state(
		getContext("sceneSummarizesCtx")
	)
	let compileEntriesCtx: CompileEntriesCtx = $state(
		getContext("compileEntriesCtx")
	)
	let userCtx: UserCtx = $state(getContext("userCtx"))

	let reviewCount = $derived(
		(graphBuildsCtx?.activeBuild?.status === "review" ||
		graphBuildsCtx?.activeBuild?.status === "error"
			? 1
			: 0) +
			(sceneSummarizesCtx?.activities?.filter(
				(a) => a.status === "review"
			).length ?? 0) +
			(compileEntriesCtx?.activities?.filter((a) => a.status === "review")
				.length ?? 0)
	)
	let activityBadgeCount = $derived(
		reviewCount + (taskQueueCtx?.tasks?.length ?? 0)
	)

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

<header class="w-full">
	<!-- Height: the mobile bar is sized by the 44px hamburger, so `py-2` made it
	     60px against desktop's 40px. `py-0.5` brings it to 48px — still a full
	     44px tap target, just without the extra 12px of dead band above the
	     chat. Desktop keeps `py-2` and is unchanged.
	     Removed from here: `bg-opacity-25`, a Tailwind v3 class that v4 dropped,
	     so the bar has been fully opaque since the upgrade; and `backdrop-blur`,
	     which had nothing to do — the header is static and content does not
	     scroll beneath it. Also `mx-auto`, inert on a `w-full` box. -->
	<!-- `lg:rounded-b-lg` mirrors the composer's `lg:rounded-t-lg`: this bar and
	     the composer share <main>'s exact horizontal extents, so the chat column
	     now reads as one rounded slab capped top and bottom. Only at lg: — below
	     that the composer isn't rounded either, since the column runs edge to
	     edge. -->
	<div
		class="bg-surface-100-900 relative flex w-full justify-between px-4 py-0.5 lg:rounded-b-lg lg:py-2"
	>
		<!-- Desktop left nav -->
		<nav
			class="hidden flex-1 justify-start gap-2 lg:flex"
			aria-label="Left navigation"
		>
			{#each panelsCtx.getOrderedEntries(panelsCtx.leftNav, panelsCtx.leftNavOrder || []) as [key, item]}
				{#if item?.icon}
					{@const isOpen = panelsCtx.leftPanel === key}
					{@const isVectorizationRunning =
						key === "connections" &&
						vectorizationCtx?.status === "running"}
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
				{:else if item?.imgSrc}
					{@const isOpen = panelsCtx.leftPanel === key}
					<button
						title={item.title}
						onclick={() => panelsCtx.openPanel({ key })}
						aria-pressed={isOpen}
						aria-label="Open {item.title} panel"
						type="button"
					>
						<span
							class="block h-6 w-6 transition-colors {isOpen
								? 'text-primary-800-200'
								: ''} hover:text-primary-500"
							style="background-color: currentColor; mask: url({item.imgSrc}) no-repeat center / contain; -webkit-mask: url({item.imgSrc}) no-repeat center / contain;"
							aria-hidden="true"
						></span>
					</button>
				{/if}
			{/each}
		</nav>

		<!-- Title (centered absolutely for desktop)
		     `items-center` matters below md, where this is still an in-flow flex
		     item: without it the <a> stretched to the full row height and the
		     text rendered at the top of that box, so the title sat high against
		     the hamburger. At md+ the absolute positioning centres it instead. -->
		<div
			class="pointer-events-none ml-2 flex w-auto flex-0 items-center justify-center md:absolute md:top-1/2 md:left-1/2 md:ml-0 md:w-auto md:-translate-x-1/2 md:-translate-y-1/2"
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
			class="hidden flex-1 items-center justify-end gap-2 lg:flex"
			aria-label="Right navigation"
		>
			{#each Object.entries(panelsCtx.rightNav) as [key, item]}
				{#if item?.icon}
					{@const isOpen = panelsCtx.rightPanel === key}
					<button
						class="btn-ghost relative"
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
						{#if key === "activity" && activityBadgeCount > 0}
							<span
								class="bg-warning-500 absolute -top-0.5 -right-0.5 flex h-4 w-4 items-center justify-center rounded-full text-[10px] font-bold text-white"
							>
								{activityBadgeCount > 9
									? "9+"
									: activityBadgeCount}
							</span>
						{/if}
					</button>
				{/if}
			{/each}

			<!--
				Desktop only, and last in the row: it governs how much room the
				page gets rather than opening anything, so it sits after the
				panels it defers to rather than among them.
			-->
			<button
				class="btn-ghost relative"
				title={panelsCtx.wideContent
					? "Standard page width"
					: "Adaptive full page width"}
				onclick={() => (panelsCtx.wideContent = !panelsCtx.wideContent)}
				aria-pressed={panelsCtx.wideContent}
				aria-label={panelsCtx.wideContent
					? "Use the standard content width"
					: "Widen content into unused sidebar space"}
				type="button"
			>
				{#if panelsCtx.wideContent}
					<Icons.Minimize2
						class="text-primary-800-200 hover:text-primary-500 h-5 w-5 transition-colors"
						aria-hidden="true"
					/>
				{:else}
					<Icons.Maximize2
						class="hover:text-primary-500 h-5 w-5 transition-colors"
						aria-hidden="true"
					/>
				{/if}
			</button>
		</nav>

		<!-- `ml-auto` rather than relying on the parent's justify-between: at md+
		     the title becomes absolutely positioned and leaves the flex flow, so
		     this is the only in-flow child left and justify-between parked it
		     against the LEFT edge. The result was a hamburger that sat on the
		     right on phones and jumped to the left on tablets. An auto margin
		     pins it right regardless of how many siblings are in flow. -->
		<div class="ml-auto flex items-center gap-2 lg:hidden">
			<!-- Square 44px: this was 47x39, i.e. under the 44px/48dp minimum on
			     the axis that matters most for a thumb. Icon sized via the
			     arbitrary variant because `btn` drives child svg from
			     --btn-size, which beats a plain `h-6 w-6` here. -->
			<!-- No resting background — the icon alone reads as the control, and a
			     permanent filled box next to a bare title looked heavier than it
			     needed to. The tonal fill now only appears on hover/focus, so
			     it still confirms it's a button when you reach for it. The 44px
			     box is kept regardless: it's the tap target, not decoration. -->
			<button
				class="btn hover:preset-tonal focus-visible:preset-tonal text-foreground flex size-11 items-center justify-center p-0 [&>svg]:size-6"
				aria-label="Open navigation menu"
				onclick={() => {
					panelsCtx.isMobileMenuOpen = true
				}}
				type="button"
				aria-expanded={panelsCtx.isMobileMenuOpen}
			>
				<Icons.Menu aria-hidden="true" />
			</button>
		</div>
	</div>
</header>

<style lang="postcss">
	@reference "tailwindcss";

	header {
		/* justify-content was here too, but this element has exactly one child
		   (the bar below), so it had nothing to distribute. */
		display: flex;
	}
</style>
