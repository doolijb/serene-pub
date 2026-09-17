<script lang="ts">
	import * as Icons from "@lucide/svelte"
	// Shared hover signal — lets the session's "Layout" pull-tab reveal itself
	// only while this nav bar is hovered. See navHover.svelte.ts.
	import { navHover } from "$lib/client/sessionLayout/navHover.svelte"
	// Mobile side panels (P6, ruled 2026-08-30; revised 2026-09-10). Below
	// 1024px a session's side zones take no layout space; if either side holds
	// widgets they are reached from ONE panels button in this bar, which opens
	// a sheet listing the groups.
	// SessionLayout publishes the counts and the list and renders both sheets —
	// it is a sibling of this component under <main>, not a descendant, so a
	// module singleton is the bridge (exactly as navHover above).
	import {
		mobileSidePanels,
		showsToggles
	} from "$lib/client/sessionLayout/mobileSidePanels.svelte"

	/**
	 * What is left of the app header after the shell redesign (S1).
	 *
	 * The two icon navs, the width toggle and the hamburger all moved out: the
	 * rail down the left edge and the mobile bottom bar are the navigation now,
	 * and the page's own content decides what else belongs at its top. Two
	 * things kept this component alive rather than deleting it:
	 *
	 *  - `navHover`, which is how the session's "Layout" pull-tab knows to show
	 *    itself. It needs a hover region at the top of <main>, and <main> is
	 *    where this renders.
	 *  - the mobile session-panels button, which is the ONLY way into a narrow
	 *    session's side widgets.
	 *
	 * Both are session concerns living in the shell because the two components
	 * are siblings under <main> rather than parent and child.
	 */
</script>

<!-- Hover tracking only (reveals the session Layout tab); the <header> already
     carries an implicit banner role. -->
<!-- svelte-ignore a11y_no_static_element_interactions -->
<header
	class="w-full"
	onmouseenter={() => (navHover.over = true)}
	onmouseleave={() => (navHover.over = false)}
>
	<!-- Height: the mobile bar is sized by the 44px panels button, so `py-2`
	     made it 60px against desktop's 40px. `py-0.5` brings it to 48px — still
	     a full 44px tap target, just without the extra 12px of dead band above
	     the session. Desktop keeps `py-2` and is unchanged.
	     `lg:rounded-b-lg` mirrors the composer's `lg:rounded-t-lg`: this bar and
	     the composer share <main>'s exact horizontal extents, so the session
	     column reads as one rounded slab capped top and bottom. -->
	<div
		class="bg-surface-100-900 relative flex w-full items-center justify-between px-4 py-0.5 lg:rounded-b-lg lg:py-2"
	>
		<a
			class="text-foreground funnel-display text-xl font-bold tracking-tight whitespace-nowrap"
			href="/"
			aria-label="Serene Pub - Home"
		>
			Serene Pub
		</a>

		<!-- The session's panels, mobile only (ruled 2026-09-10): ONE button
		     opening a sheet that lists the side groups. Rendered only while a
		     narrow session actually has a populated side (`showsToggles`), so
		     every other page and every desktop width is untouched. -->
		{#if showsToggles(mobileSidePanels)}
			<button
				class="btn hover:preset-tonal focus-visible:preset-tonal text-foreground flex size-11 items-center justify-center p-0 lg:hidden [&>svg]:size-6"
				class:preset-tonal={mobileSidePanels.menuOpen}
				aria-label="Session panels"
				type="button"
				aria-expanded={mobileSidePanels.menuOpen}
				onclick={(e) =>
					mobileSidePanels.toggleMenu(e.currentTarget as HTMLElement)}
			>
				<Icons.PanelsTopLeft aria-hidden="true" />
			</button>
		{/if}
	</div>
</header>

<style lang="postcss">
	@reference "tailwindcss";

	header {
		/* One child, so column and row are identical here — kept as it was
		   rather than churned, since the child stretches to `w-full` either
		   way. */
		display: flex;
		flex-direction: column;
	}
</style>
