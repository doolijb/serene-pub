<script lang="ts">
	import * as Icons from "@lucide/svelte"
	import Avatar from "$lib/client/components/Avatar.svelte"
	import RowMenu, {
		type RowMenuEntries
	} from "$lib/client/components/menus/RowMenu.svelte"
	import { getContext, tick } from "svelte"
	import { SESSION_ARCHIVE_LABELS } from "$lib/shared/sessions/archive"
	// Rolled up or not (note 29): a per-device shell preference.
	import { shellPrefs } from "$lib/client/shell/shellPrefs.svelte"
	// The way into the session layout editor: this bar's Layout button asks,
	// SessionLayout answers. See layoutEditor.svelte.ts.
	import { requestLayoutEditor } from "$lib/client/sessionLayout/layoutEditor.svelte"
	import { useSessionFullscreen } from "$lib/client/sessions/fullscreen.svelte"
	// The zone switch (PLAN 2026-11-05 D11): Left · Middle · Right, drawn here
	// on a desktop while the sides do not fit; the phone's is a row of the
	// session's own. SessionLayout publishes its state (sessionZones) — it is a
	// sibling of this component under <main>, not a descendant.
	import ZoneSwitch from "$lib/client/sessionLayout/ZoneSwitch.svelte"

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
	 *  - the Layout button, one of the ways into the session layout editor,
	 *    with the narrow menu's and the full-screen menu's *Customize
	 *    layout* — shown with advanced controls on (🚧 2026-11-10); with it
	 *    off a person keeps the layout they have. It only asks
	 *    (`requestLayoutEditor`); the session answers, and while its desktop
	 *    editor is open this header is not rendered at all — the toolbar has
	 *    taken the band.
	 *  - the Full screen button (Ctrl+Shift+F), beside Layout; the corner
	 *    control (FullscreenExit) is the way out.
	 *  - the mobile session-panels button, which is the ONLY way into a narrow
	 *    session's side widgets.
	 *
	 * The identity arrives by the same route: the session route writes
	 * `openSessionCtx` (src/app.d.ts), and this reads it.
	 */
	const openSessionCtx = getContext<OpenSessionCtx | undefined>(
		"openSessionCtx"
	)
	const panelsCtx = getContext<PanelsCtx | undefined>("panelsCtx")

	/**
	 * 🚧 **Session settings**, from inside the session (2026-10-18, the
	 * 100-turn walk #26: Honour mode, How strict and the Rules options lived
	 * behind Sessions → ⋮ → Edit → Settings, and nobody found them). The
	 * Sessions view opens on this session's edit form, at its Settings tab
	 * — the one place they are kept.
	 */
	function openSessionSettings() {
		const id = openSessionCtx?.sessionId
		if (!panelsCtx || id == null) return
		panelsCtx.digest.sessionId = id
		panelsCtx.digest.sessionTab = "settings"
		panelsCtx.openPanel({ key: "sessions", toggle: false })
	}


	/** Five faces read as a stack at a glance; more reads as a list. */
	const CAST_SHOWN = 5

	/**
	 * The session's one-line **header notice** (PLAN-core-widgets §3.16), the
	 * stale-preset notice today: the page writes it, with its own dismiss.
	 */
	const notice = $derived(openSessionCtx?.headerNotice ?? null)

	const sessionName = $derived(openSessionCtx?.sessionName ?? null)
	const genreName = $derived(openSessionCtx?.genreName ?? null)
	const branchMark = $derived(openSessionCtx?.branchOfLabel ?? null)
	const archived = $derived(openSessionCtx?.archived === true)
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

	/**
	 * 🚧 **Back · Forward · Regenerate** (RF fix 5): the story's history, one turn at a
	 * time — icon buttons at the head of the trailing cluster since
	 * polish parity L1 (2026-10-24; they were a row of their own above the
	 * log). The page writes what they read and do (`openSessionCtx.rewind`);
	 * absent, they are not drawn. Greyed, never disabled (the chips' rule):
	 * `aria-disabled` keeps each reachable, its reason in the title and, for
	 * a screen reader, an sr-only note; the press is guarded.
	 */
	const rewind = $derived(openSessionCtx?.rewind ?? null)
	const rewindId = $props.id()
	const backTitle = $derived(
		rewind?.back.reason
			? `Back one turn — ${rewind.back.reason}`
			: rewind?.back.takes
				? `Back: ${rewind.back.takes}`
				: "Back one turn"
	)
	const forwardTitle = $derived(
		rewind?.forward.reason
			? `Forward one turn — ${rewind.forward.reason}`
			: rewind?.aheadText
				? `Forward one turn (${rewind.aheadText})`
				: "Forward one turn"
	)
	const regenerateTitle = $derived(
		rewind?.regenerate?.reason
			? `Regenerate the last turn — ${rewind.regenerate.reason}`
			: "Regenerate the last turn"
	)

	/**
	 * The phone's one `⋯` (polish parity L8, 2026-10-24): below 640px of bar
	 * the trailing cluster is the panels button, this menu and the furl, so
	 * the session's name keeps the room. It holds what the wide bar draws as
	 * buttons — Back and Forward (greyed with their reason, never hidden),
	 * Settings, Layout (only with advanced controls on, 🚧 2026-11-10) —
	 * and the same handlers run either way.
	 */
	const phoneMenu = $derived<RowMenuEntries>([
		rewind && {
			label: "Back one turn",
			icon: Icons.Undo2,
			disabled: rewind.back.disabled,
			title: backTitle,
			onSelect: () => rewind.goBack()
		},
		rewind && {
			label: "Forward one turn",
			icon: Icons.Redo2,
			disabled: rewind.forward.disabled,
			title: forwardTitle,
			onSelect: () => rewind.goForward()
		},
		rewind?.regenerate && {
			label: "Regenerate the last turn",
			icon: Icons.RefreshCw,
			disabled: rewind.regenerate.disabled,
			title: regenerateTitle,
			onSelect: () => rewind.regenerate!.press()
		},
		rewind && { separator: true },
		openSessionCtx?.sessionId != null &&
			!!panelsCtx && {
				label: "Session settings",
				icon: Icons.Settings,
				onSelect: openSessionSettings
			},
		{
			label: "Customize layout",
			icon: Icons.LayoutDashboard,
			onSelect: () => requestLayoutEditor()
		},
		openSessionCtx?.sessionId != null && {
			label: "Full screen",
			icon: Icons.Maximize,
			onSelect: () => enterFullscreen()
		}
	])

	/** Into full screen for the open session (SHAPES L1). */
	function enterFullscreen() {
		const id = openSessionCtx?.sessionId
		if (id == null) return
		useSessionFullscreen(id).enter()
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
		>
			<!-- The identity, at the bar's leading edge (owner 2026-11-12); the
		     buttons take the trailing one. -->
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
				{#if branchMark}
					<span class="sp-head-genre" data-branch-of>
						<Icons.GitBranch
							size={12}
							class="inline align-[-1px]"
							aria-hidden="true"
						/>
						{branchMark}
					</span>
				{/if}
				{#if archived}
					<span class="sp-head-genre" data-archived>
						<Icons.Archive
							size={12}
							class="inline align-[-1px]"
							aria-hidden="true"
						/>
						{SESSION_ARCHIVE_LABELS.mark}
					</span>
				{/if}
			</div>

			<!-- The trailing cluster. -->
			<div class="sp-head-tools">
				{#if rewind}
					<!-- 🚧 Back · Forward: the session owner's, first in the
					     cluster, nearest the story's name. On a phone they are
					     the first two items of the ⋯ below (`sp-head-wide`). -->
					<span class="sp-head-wide sp-head-group">
						<button
							type="button"
							class="btn-icon hover:preset-tonal focus-visible:preset-tonal text-foreground aria-disabled:text-surface-500 size-11 shrink-0 aria-disabled:cursor-default [&>svg]:size-5"
							aria-label="Back one turn"
							title={backTitle}
							aria-disabled={rewind.back.disabled}
							aria-describedby={rewind.back.reason ||
							rewind.back.takes
								? `${rewindId}-back`
								: undefined}
							data-header-rewind="back"
							onclick={(e) =>
								rewind.back.disabled
									? e.preventDefault()
									: rewind.goBack()}
						>
							<Icons.Undo2 aria-hidden="true" />
						</button>
						{#if rewind.back.reason}
							<span id="{rewindId}-back" class="sr-only">
								{rewind.back.reason}
							</span>
						{:else if rewind.back.takes}
							<span id="{rewindId}-back" class="sr-only">
								Back: {rewind.back.takes}
							</span>
						{/if}
						<button
							type="button"
							class="btn-icon hover:preset-tonal focus-visible:preset-tonal text-foreground aria-disabled:text-surface-500 size-11 shrink-0 aria-disabled:cursor-default [&>svg]:size-5"
							aria-label="Forward one turn"
							title={forwardTitle}
							aria-disabled={rewind.forward.disabled}
							aria-describedby={rewind.forward.reason ||
							rewind.aheadText
								? `${rewindId}-forward`
								: undefined}
							data-header-rewind="forward"
							onclick={(e) =>
								rewind.forward.disabled
									? e.preventDefault()
									: rewind.goForward()}
						>
							<Icons.Redo2 aria-hidden="true" />
						</button>
						{#if rewind.forward.reason || rewind.aheadText}
							<span id="{rewindId}-forward" class="sr-only">
								{rewind.forward.reason ?? rewind.aheadText}
							</span>
						{/if}
						{#if rewind.regenerate}
							<button
								type="button"
								class="btn-icon hover:preset-tonal focus-visible:preset-tonal text-foreground aria-disabled:text-surface-500 size-11 shrink-0 aria-disabled:cursor-default [&>svg]:size-5"
								aria-label="Regenerate the last turn"
								title={regenerateTitle}
								aria-disabled={rewind.regenerate.disabled}
								aria-describedby={rewind.regenerate.reason
									? `${rewindId}-regenerate`
									: undefined}
								data-header-rewind="regenerate"
								onclick={(e) =>
									rewind.regenerate!.disabled
										? e.preventDefault()
										: rewind.regenerate!.press()}
							>
								<Icons.RefreshCw aria-hidden="true" />
							</button>
							{#if rewind.regenerate.reason}
								<span
									id="{rewindId}-regenerate"
									class="sr-only"
								>
									{rewind.regenerate.reason}
								</span>
							{/if}
						{/if}
					</span>
				{/if}
				<!-- The zone switch, desktop only (D11): it draws nothing while the
				     sides fit. The phone's is the session's own row under this bar. -->
				<div class="hidden shrink-0 items-center lg:flex">
					<ZoneSwitch />
				</div>

				<!-- 🚧 The session's settings, at every width (2026-10-18):
				     the Sessions view's edit form on its Settings tab. -->
				{#if openSessionCtx?.sessionId != null && panelsCtx}
					<button
						type="button"
						class="sp-head-wide sp-head-quiet btn hover:preset-tonal focus-visible:preset-tonal text-foreground sp-head-labelled flex h-11 min-w-11 shrink-0 items-center justify-center gap-1.5 px-0 [&>svg]:size-5"
						aria-label="Session settings"
						title="Session settings"
						onclick={openSessionSettings}
					>
						<Icons.Settings aria-hidden="true" />
						<span class="sp-head-label text-sm font-medium">
							Settings
						</span>
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
					class="sp-head-wide sp-head-quiet btn hover:preset-tonal focus-visible:preset-tonal text-foreground sp-head-labelled flex h-11 min-w-11 shrink-0 items-center justify-center gap-1.5 px-0 [&>svg]:size-5"
					aria-label="Customize layout"
					title="Customize layout"
					onclick={() => requestLayoutEditor()}
				>
					<Icons.LayoutDashboard aria-hidden="true" />
					<span class="sp-head-label text-sm font-medium">
						Layout
					</span>
				</button>

				{#if openSessionCtx?.sessionId != null}
					<button
						type="button"
						class="sp-head-wide sp-head-quiet btn hover:preset-tonal focus-visible:preset-tonal text-foreground sp-head-labelled flex h-11 min-w-11 shrink-0 items-center justify-center gap-1.5 px-0 [&>svg]:size-5"
						aria-label="Full screen (Ctrl+Shift+F)"
						title="Full screen (Ctrl+Shift+F)"
						onclick={enterFullscreen}
					>
						<Icons.Maximize aria-hidden="true" />
						<span class="sp-head-label text-sm font-medium">
							Full screen
						</span>
					</button>
				{/if}

				<!-- The phone's ⋯ (L8): Back, Forward, Settings and Layout as
				     items, drawn only below 640px of bar (`sp-head-narrow`). -->
				<span class="sp-head-narrow sp-head-group">
					<RowMenu
						label="Session"
						triggerLabel="More actions for {sessionName ??
							'this session'}"
						triggerTitle="More actions"
						triggerClass="btn-icon hover:preset-tonal focus-visible:preset-tonal text-foreground size-11 shrink-0 [&>svg]:size-5"
						horizontal
						width={220}
						items={phoneMenu}
					/>
				</span>

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
		<!-- The notice slot: one line under the bar, on the same measure,
		     dismissible for this view (the page keeps the flag). Said, not
		     announced: it is true from the moment the session opens. -->
		{#if notice}
			<div
				class="preset-tonal-warning sp-head-notice flex items-center gap-2 px-4 py-1 text-sm lg:rounded-lg"
				role="status"
				data-header-notice
			>
				<Icons.Replace size={16} class="shrink-0" aria-hidden="true" />
				<p class="min-w-0 flex-1 truncate" title={notice.text}>
					{notice.text}
				</p>
				{#if notice.link}
					<a class="shrink-0 underline" href={notice.link.href}>
						{notice.link.label}
					</a>
				{/if}
				{#if notice.action}
					<button
						type="button"
						class="btn btn-sm preset-tonal shrink-0"
						data-header-notice-action
						onclick={() => notice?.action?.press()}
					>
						{notice.action.label}
					</button>
				{/if}
				<button
					type="button"
					class="btn-icon btn-icon-sm hover:preset-tonal shrink-0 pointer-coarse:size-11"
					title="Dismiss"
					aria-label="Dismiss this notice"
					onclick={() => notice?.dismiss()}
				>
					<Icons.X size={14} aria-hidden="true" />
				</button>
			</div>
		{/if}
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

	/* The trailing cluster: the buttons, at the bar's trailing edge. */
	.sp-head-tools {
		display: flex;
		align-items: center;
		gap: 0.5rem;
		flex: none;
	}

	/* The identity starts at the bar's leading edge and takes the room the
	   cluster leaves (owner 2026-11-12). `min-inline-size: 0` is what makes a
	   tight window ellipsize the name instead of pushing into the buttons. */
	.sp-head-row {
		display: flex;
		align-items: center;
		flex: 1 1 auto;
		min-inline-size: 0;
		/* The identity never paints over the cluster: when the name's floor
		   and the stack's first face are wider than the room left beside the
		   buttons, the row clips at its own edge instead of overflowing onto
		   Back (2026-10-30: a ten-face cast covered Back at 1280 with the dock
		   open). The block padding keeps the faces' 2px ring and the next dot
		   inside the clip. */
		overflow: hidden;
		padding-block: 4px;
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
	   Below 640px the genre steps out; the name and faces identify the
	   session. */
	.sp-head-host {
		container: sp-head / inline-size;
	}
	/* A wrapper that only groups controls for the rules below; its children
	   sit in the cluster's own flex row. Before them, so they win. */
	.sp-head-group {
		display: contents;
	}
	/* The phone (L8): the genre steps out, Back · Forward · Settings · Layout
	   fold into one ⋯, and the name keeps the room. The cast stack gives way
	   first — it clips to its first face — so the name is cut only when it is
	   wider than the row less one 24px face, which at 412px is well past 12
	   characters. */
	/* A Half-width pane (640–960px): the
	   trailing cluster still takes ~520px, so the identity has ~150–400px.
	   Give way in the same order as the phone — the genre steps out, the cast
	   clips to its first face — and the name keeps at least six rems, so it
	   never collapses to nothing beside a whole cluster of icons. */
	@container sp-head (width < 960px) {
		.sp-head-genre {
			display: none;
		}
		.sp-head-name {
			flex: 1 1 auto;
			min-inline-size: 6rem;
		}
		.sp-head-cast {
			flex: 0 1 auto;
			min-inline-size: calc(24px + 4px);
			overflow: hidden;
			padding: 2px;
			margin-inline-start: calc(0.5rem - 2px);
		}
	}
	@container sp-head (width < 640px) {
		.sp-head-genre,
		.sp-head-wide {
			display: none;
		}
		.sp-head-name {
			flex: 0 0 auto;
			max-inline-size: calc(100% - 2.375rem);
		}
		.sp-head-cast {
			flex: 0 1 auto;
			min-inline-size: calc(24px + 4px);
			overflow: hidden;
			/* Room for the faces' 2px ring, which the clip would cut. */
			padding: 2px;
			margin-inline-start: calc(0.5rem - 2px);
		}
	}
	@container sp-head (width >= 640px) {
		.sp-head-narrow {
			display: none;
		}
	}
	/* The cluster's words (Settings, Layout, Full screen) by the BAR's width,
	   like every rule here, never the window's: with the dock open a 1280px
	   window leaves an 816px bar, where three words took the identity's room.
	   Below 1040px of bar the buttons are their icons, named by their
	   `aria-label` and `title` as before. */
	.sp-head-label {
		display: none;
	}
	@container sp-head (width >= 1040px) {
		.sp-head-label {
			display: inline;
		}
		.sp-head-labelled {
			padding-inline: 0.625rem;
		}
	}

	/* Settings, Layout and Full screen wait quietly beside the story: muted
	   until the pointer is over one or the keyboard is on it, then at full
	   strength. Only where there is a pointer to hover with: a touch screen
	   draws them at full strength. The fade is motion, so it is off under
	   reduced motion (the change of strength stays). */
	@media (hover: hover) {
		.sp-head-quiet {
			opacity: 0.5;
		}
		.sp-head-quiet:hover,
		.sp-head-quiet:focus-visible {
			opacity: 1;
		}
	}
	@media (hover: hover) and (prefers-reduced-motion: no-preference) {
		.sp-head-quiet {
			transition: opacity var(--transition-duration-base) ease-out;
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
		transition: opacity var(--transition-duration-fast);
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

	/* The notice slot: one line under the bar, a hair apart from it. */
	.sp-head-notice {
		margin-block-start: 0.25rem;
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
