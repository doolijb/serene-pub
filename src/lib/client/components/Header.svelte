<script lang="ts">
	import * as Icons from "@lucide/svelte"
	import Avatar from "$lib/client/components/Avatar.svelte"
	import { getContext, tick } from "svelte"
	// Rolled up or not (note 29): a per-device shell preference.
	import { shellPrefs } from "$lib/client/shell/shellPrefs.svelte"
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

	/**
	 * The header furled (next-pass note 29, 2026-10-02): the bar rolls up
	 * and a faint button in the same top-right band brings it back. Focus
	 * follows the press to the control that now stands in its place, so a
	 * keyboard never lands on nothing.
	 */
	const furled = $derived(shellPrefs.headerFurled)
	let furlButton = $state<HTMLButtonElement | null>(null)
	let unfurlButton = $state<HTMLButtonElement | null>(null)
	async function setFurled(next: boolean) {
		shellPrefs.setHeaderFurled(next)
		await tick()
		;(next ? unfurlButton : furlButton)?.focus()
	}

	/** The face's accessible name, carrying the turn when it holds one. */
	function faceLabel(member: OpenSessionCastMember): string {
		return member.isNext ? `${member.name}, up next` : member.name
	}
</script>

{#if furled}
	<!-- Furled: no bar, no band, no Jump pill. One faint tab hanging from
	     the middle of the top edge, clear of both corners; brighter under
	     the pointer or the keyboard and a 44px target on touch. -->
	<div class="sp-head-furled">
		<button
			bind:this={unfurlButton}
			type="button"
			class="sp-head-unfurl btn-icon hover:preset-tonal focus-visible:preset-tonal text-surface-600-400"
			aria-label="Show the session header"
			title="Show the session header"
			aria-expanded="false"
			onclick={() => void setFurled(false)}
		>
			<Icons.ChevronDown size={14} aria-hidden="true" />
		</button>
	</div>
{:else}
	<header class="sp-head-host w-full">
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
								<!-- The app's one avatar (STYLE-GUIDE §6.4): xs, round —
							     a face among faces — ringed in the bar's ground,
							     which is what separates one from the next. -->
								<Avatar
									src={member.avatarSrc ?? undefined}
									name={faceLabel(member)}
									size="xs"
									fallback="initial"
									kind={member.isPersona
										? "persona"
										: "character"}
									class="ring-2 ring-[var(--sp-head-ground)]"
								/>
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
					<span class="hidden text-sm font-medium lg:inline">
						Layout
					</span>
				</button>

				<!-- Roll the bar up (note 29): the quietest control here, last, at
			     the top right. -->
				<button
					bind:this={furlButton}
					type="button"
					class="btn-icon hover:preset-tonal focus-visible:preset-tonal text-surface-500 size-8 shrink-0 pointer-coarse:size-11"
					aria-label="Hide the session header"
					title="Hide the session header"
					aria-expanded="true"
					onclick={() => void setFurled(true)}
				>
					<Icons.ChevronsUp size={16} aria-hidden="true" />
				</button>
			</div>
		</div>
	</header>
{/if}

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
	   `messages.stage` part), centred in the bar so the two line up. `min-inline-size:
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
		display: flex;
		flex: none;
	}
	/* Each face after the first overlaps by 40% of its width, as
	   `AvatarStack` does. */
	.sp-head-face + .sp-head-face {
		margin-inline-start: -10px;
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

	/* Measured against the BAR, not the window: a docked view takes 400px
	   off it on a wide screen, where a viewport rule would never fire.
	   Below 1040px of bar there is no room to centre the name over the
	   story — the mirror spacer takes as much as the buttons do and squeezes
	   the name to nothing — so the row starts at the edge. Below 640px the
	   genre steps out too; the name and faces identify the session. */
	.sp-head-host {
		container: sp-head / inline-size;
	}
	@container sp-head (width < 1040px) {
		.sp-head-lead {
			display: none;
		}
		.sp-head-row {
			margin-inline: 0;
		}
	}
	@container sp-head (width < 640px) {
		.sp-head-genre {
			display: none;
		}
	}

	/* Furled: a zero-height row, so the session takes the whole height, with
	   the way back as a small tab hanging from the middle of the top edge —
	   clear of both corners, which belong to the sides' own controls (and to
	   the Jump pill, which steps out while furled: Layout's
	   `sessionHeaderFurled`). */
	.sp-head-furled {
		position: relative;
		block-size: 0;
		z-index: 20;
	}
	.sp-head-unfurl {
		position: absolute;
		inset-block-start: 0;
		inset-inline-start: 50%;
		translate: -50% 0;
		inline-size: 3rem;
		block-size: 1.25rem;
		min-block-size: 0;
		border-start-start-radius: 0;
		border-start-end-radius: 0;
		border-end-start-radius: 0.5rem;
		border-end-end-radius: 0.5rem;
		background: var(--color-surface-200-800);
		opacity: 0.5;
		transition: opacity 150ms;
	}
	.sp-head-unfurl:hover,
	.sp-head-unfurl:focus-visible {
		opacity: 1;
	}
	@media (pointer: coarse) {
		/* 44px wide, 28px seen, with the target grown to 44px tall below it. */
		.sp-head-unfurl {
			inline-size: 2.75rem;
			block-size: 1.75rem;
			opacity: 0.75;
		}
		.sp-head-unfurl::after {
			content: "";
			position: absolute;
			inset: 0 0 -1rem 0;
		}
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
