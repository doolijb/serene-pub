<script lang="ts">
	import * as Icons from "@lucide/svelte"
	import { getContext } from "svelte"
	// The way into the session layout editor: this bar's Layout button asks,
	// SessionLayout answers. See layoutEditor.svelte.ts.
	import { requestLayoutEditor } from "$lib/client/sessionLayout/layoutEditor.svelte"
	// Mobile side panels (P6, ruled 2026-08-30; revised 2026-09-10). Below
	// 1024px a session's side zones take no layout space; if either side holds
	// widgets they are reached from ONE panels button in this bar, which opens
	// a sheet listing the groups.
	// SessionLayout publishes the counts and the list and renders both sheets —
	// it is a sibling of this component under <main>, not a descendant, so a
	// module singleton is the bridge (exactly as layoutEditor above).
	import {
		mobileSidePanels,
		showsToggles
	} from "$lib/client/sessionLayout/mobileSidePanels.svelte"

	/**
	 * The session header: the open session's identity, across the top of
	 * `<main>` (STYLE-GUIDE §3.2). It names the session, shows who is in it and
	 * says which genre it is played in, on one 56px row whose inner column takes
	 * the measure the messages take, so the name starts where the story does.
	 *
	 * Rendered only on `/sessions/*`, and it carries two session concerns that
	 * live in the shell because this component and SessionLayout are siblings
	 * under `<main>` rather than parent and child:
	 *
	 *  - the Layout button, which is the ONE way into the session layout
	 *    editor at every width. It only asks (`requestLayoutEditor`); the
	 *    session answers, and while its desktop editor is open this header is
	 *    not rendered at all — the toolbar has taken the band.
	 *  - the mobile session-panels button, which is the ONLY way into a narrow
	 *    session's side widgets.
	 *
	 * The identity arrives by the same route: the session route writes
	 * `openSessionCtx` (src/app.d.ts), and this reads it.
	 */
	const openSessionCtx = getContext<OpenSessionCtx | undefined>(
		"openSessionCtx"
	)

	/**
	 * How wide the trailing button cluster is drawing itself. The identity is
	 * centred on the BAR, not on what is left beside the buttons, so the same
	 * width is mirrored back as a leading spacer — see `.sp-head-lead`.
	 */
	let toolsW = $state(0)

	/** Five faces read as a stack at a glance; more reads as a list. */
	const CAST_SHOWN = 5

	const sessionName = $derived(openSessionCtx?.sessionName ?? null)
	const genreName = $derived(openSessionCtx?.genreName ?? null)
	const cast = $derived((openSessionCtx?.cast ?? []).slice(0, CAST_SHOWN))

	/** The disc a cast member with no portrait gets: their initial. */
	function initial(name: string): string {
		return name.trim().charAt(0).toUpperCase() || "?"
	}

	/** The face's accessible name, carrying the turn when it holds one. */
	function faceLabel(member: OpenSessionCastMember): string {
		return member.isNext ? `${member.name}, up next` : member.name
	}
</script>

<header class="w-full">
	<!-- 56px at every width, which seats both the identity row and the 44px
	     panels button (STYLE-GUIDE §4.2).
	     `lg:rounded-b-lg` mirrors the composer's `lg:rounded-t-lg`: this bar and
	     the composer share <main>'s exact horizontal extents, so the session
	     column reads as one rounded slab capped top and bottom. -->
	<div
		class="bg-surface-100-900 sp-head relative flex w-full items-center gap-2 pl-4 lg:rounded-b-lg"
		style:--sp-head-tools="{toolsW}px"
	>
		<!-- The trailing cluster's width, mirrored. Without it the buttons and
		     the pill's reserve push the identity left and the session's name
		     stops starting where the story does; see `.sp-head-lead`. -->
		<div class="sp-head-lead" aria-hidden="true"></div>
		<!-- The identity, centred on the measure the messages use, so the
		     session's name and the story below it start on the same line. -->
		<div class="sp-head-row">
			{#if sessionName}
				<h1 class="sp-head-name text-surface-950-50">
					{sessionName}
				</h1>
			{/if}

			{#if cast.length}
				<ul class="sp-head-cast" aria-label="Cast">
					{#each cast as member (member.key)}
						<li
							class="sp-head-face"
							data-persona={member.isPersona ? "" : undefined}
						>
							{#if member.avatarSrc}
								<img
									class="sp-head-face-img"
									src={member.avatarSrc}
									alt={faceLabel(member)}
								/>
							{:else}
								<span
									class="sp-head-face-glyph"
									role="img"
									aria-label={faceLabel(member)}
								>
									{initial(member.name)}
								</span>
							{/if}
							<!-- Whose turn it is, said in the face's own
							     accessible name above as well as this dot. -->
							{#if member.isNext}
								<span
									class="sp-head-next"
									aria-hidden="true"
								></span>
							{/if}
						</li>
					{/each}
				</ul>
			{/if}

			{#if genreName}
				<span class="sp-head-genre">{genreName}</span>
			{/if}
		</div>

		<!-- The trailing cluster. Measured, because `.sp-head-lead` mirrors it:
		     the panels button comes and goes with the session's sides. -->
		<div class="sp-head-tools" bind:clientWidth={toolsW}>
			<!-- The session's panels, mobile only (ruled 2026-09-10): ONE
			     button opening a sheet that lists the side groups. Rendered
			     only while a narrow session actually has a populated side
			     (`showsToggles`), so every other page and every desktop width
			     is untouched. -->
			{#if showsToggles(mobileSidePanels)}
				<button
					class="btn hover:preset-tonal focus-visible:preset-tonal text-foreground flex size-11 shrink-0 items-center justify-center p-0 lg:hidden [&>svg]:size-6"
					class:preset-tonal={mobileSidePanels.menuOpen}
					aria-label="Session panels"
					type="button"
					aria-expanded={mobileSidePanels.menuOpen}
					onclick={(e) =>
						mobileSidePanels.toggleMenu(
							e.currentTarget as HTMLElement
						)}
				>
					<Icons.PanelsTopLeft aria-hidden="true" />
				</button>
			{/if}

			<!-- Into the layout editor, at EVERY width (the hover-revealed
			     pull-tab that used to hang under this bar is gone: a touch
			     screen has no hover to reveal it with, and a control nothing
			     announces is a control nobody finds). It only bumps a counter
			     — the open session is the one thing that knows whether it is
			     opening or closing. -->
			<button
				type="button"
				class="btn hover:preset-tonal focus-visible:preset-tonal text-foreground flex h-11 min-w-11 shrink-0 items-center justify-center gap-1.5 px-0 lg:px-2.5 [&>svg]:size-5"
				aria-label="Customize layout"
				title="Customize layout"
				onclick={() => requestLayoutEditor()}
			>
				<Icons.LayoutDashboard aria-hidden="true" />
				<span class="hidden text-sm font-medium lg:inline">Layout</span>
			</button>
		</div>
	</div>
</header>

<style lang="postcss">
	@reference "tailwindcss";

	header {
		/* One child, stretched across the whole bar. */
		display: flex;
		flex-direction: column;
	}

	.sp-head {
		min-block-size: 56px;
		/* The Jump pill is fixed at the window's top-right, in this same 56px
		   band (STYLE-GUIDE §6.8): reserve its measured width plus its 1rem
		   inset and one `gap-1.5`, so the Layout and panels buttons never sit
		   under it — at every width, since the pill is there at every width. */
		padding-inline-end: calc(var(--jump-pill-width, 34px) + 1.375rem);
		/* The bar's own ground, named once so the faces can ring themselves in
		   it and read as separate discs where they overlap. */
		--sp-head-ground: var(--color-surface-100);
	}
	:global([data-mode="dark"]) .sp-head {
		--sp-head-ground: var(--color-surface-900);
	}

	/* The trailing cluster, and the spacer that mirrors it.

	   The identity is centred on the BAR, not on what is left over beside the
	   buttons: with only a trailing cluster the row's auto margins centre it in
	   the remainder, which walks the session's name left of the measure the
	   story below it starts on. So the leading spacer takes exactly what the
	   trailing side takes — the cluster's measured width plus the pill's
	   reserve, less the 1rem `pl-4` this edge already has — and the row's
	   centre is the bar's centre again. */
	.sp-head-tools {
		display: flex;
		align-items: center;
		gap: 0.5rem;
		flex: none;
	}
	.sp-head-lead {
		flex: none;
		inline-size: calc(
			var(--sp-head-tools, 0px) + var(--jump-pill-width, 34px) + 0.375rem
		);
	}

	/* The measure the conversation column takes (see MessagesWidget's
	   `.sp-column`), centred in the bar so the two line up. `min-inline-size:
	   0` is what makes a tight window ellipsize the name instead of pushing
	   into the buttons. */
	.sp-head-row {
		display: flex;
		align-items: center;
		flex: 1;
		inline-size: 100%;
		max-inline-size: calc(var(--sp-measure, 40rem) + 3.5rem);
		margin-inline: auto;
		min-inline-size: 0;
	}

	.sp-head-name {
		flex: 0 1 auto;
		min-inline-size: 0;
		margin: 0;
		font-family: var(--typo-heading--font-family);
		font-size: 1.25rem;
		font-weight: 600;
		line-height: 1.2;
		letter-spacing: -0.01em;
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
	}

	.sp-head-cast {
		display: flex;
		align-items: center;
		flex: none;
		list-style: none;
		margin: 0;
		/* gap-3.5: the name-to-stack gap. Left-aligned group, so this sits on
		   the stack rather than as a uniform `.sp-head-row` gap. */
		margin-inline-start: 0.875rem;
		padding: 0;
	}
	.sp-head-face {
		position: relative;
		flex: none;
		inline-size: 24px;
		block-size: 24px;
		border-radius: 9999px;
		/* Ringed in the bar's ground, which is what separates one overlapping
		   disc from the next. */
		border: 2px solid var(--sp-head-ground);
	}
	.sp-head-face + .sp-head-face {
		margin-inline-start: -8px;
	}
	.sp-head-face-img {
		display: block;
		inline-size: 100%;
		block-size: 100%;
		border-radius: inherit;
		object-fit: cover;
		/* The thumbnail rule (`$lib/shared/media/frame`): keep the top of a
		   portrait, so a face here is cropped as the message log crops it. */
		object-position: top;
	}
	/* The letter disc, tinted by who it is: a surface step for the cast, the
	   primary tint for a character a user voices. */
	.sp-head-face-glyph {
		display: flex;
		align-items: center;
		justify-content: center;
		inline-size: 100%;
		block-size: 100%;
		border-radius: inherit;
		font-family: var(--typo-heading--font-family);
		font-size: 11px;
		font-weight: 600;
		line-height: 1;
		background: var(--color-surface-200);
		color: var(--color-surface-800);
	}
	:global([data-mode="dark"]) .sp-head-face-glyph {
		background: var(--color-surface-800);
		color: var(--color-surface-200);
	}
	.sp-head-face[data-persona] .sp-head-face-glyph {
		background: color-mix(
			in oklab,
			var(--color-primary-500) 14%,
			transparent
		);
		color: var(--color-primary-700);
	}
	:global([data-mode="dark"])
		.sp-head-face[data-persona]
		.sp-head-face-glyph {
		color: var(--color-primary-500);
	}

	/* Who the rotation has queued up. */
	.sp-head-next {
		position: absolute;
		inset-block-end: -1px;
		inset-inline-end: -1px;
		inline-size: 6px;
		block-size: 6px;
		border-radius: 9999px;
		background: var(--color-primary-500);
		box-shadow: 0 0 0 2px var(--sp-head-ground);
	}

	.sp-head-genre {
		flex: none;
		min-inline-size: 0;
		/* gap-2.5: the stack-to-genre gap. */
		margin-inline-start: 0.625rem;
		font-size: 0.75rem;
		line-height: 1.4;
		color: var(--color-surface-500);
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
	}
</style>
