<script lang="ts">
	/**
	 * The administration shell — every admin page lives inside this layout,
	 * below the app's main navigation, inside the center content pane.
	 *
	 * All responsive behavior is driven by CSS **container queries** on the
	 * shell's own root, never viewport media queries: the app already toggles
	 * the center pane between centered and full width (and sidebars shrink it
	 * further), so the pane's width — not the window's — is the truth.
	 *
	 *   <  760px container → horizontal, scrollable pill bar
	 *   >= 760px container → sticky vertical side rail
	 *   >= 1280px          → wider rail with section group labels
	 *
	 * The content pane is itself a container (`admin-content`) so page
	 * internals (form grids, split panes) can respond to the *pane's* width,
	 * which differs from the admin's once the rail appears.
	 *
	 * Admin-only. This gate is for the person; the check in every socket
	 * handler is the one that matters.
	 */
	import { getContext, onMount } from "svelte"
	import { goto } from "$app/navigation"
	import { page } from "$app/state"
	import * as Icons from "@lucide/svelte"
	import { appVersionDisplay } from "$lib/shared/constants/version"

	let { children } = $props()

	const userCtx: { user: SelectUser } = getContext("userCtx")
	const systemSettingsCtx: SystemSettingsCtx = getContext("systemSettingsCtx")

	onMount(() => {
		if (!userCtx.user?.isAdmin) goto("/")
	})

	// The nav model: groups → items. Icons come from the app's lucide set.
	const NAV: Array<{
		group: string
		items: Array<{ href: string; label: string; icon: keyof typeof Icons }>
	}> = [
		{
			group: "System",
			items: [
				{
					href: "/admin/settings",
					label: "Settings",
					icon: "Settings"
				},
				{ href: "/admin/servers", label: "Servers", icon: "Server" },
				{
					href: "/admin/sampling",
					label: "Sampling",
					icon: "SlidersHorizontal"
				},
				{
					href: "/admin/connections",
					label: "Connections",
					icon: "Cable"
				}
			]
		},
		{
			group: "Access",
			items: [{ href: "/admin/users", label: "Users", icon: "Users" }]
		},
		{
			group: "Sessions",
			items: [
				{
					href: "/admin/session-genres",
					label: "Genres",
					icon: "Shapes"
				},
				{
					href: "/admin/session-presets",
					label: "Presets",
					icon: "Ticket"
				},
				{
					href: "/admin/sessions",
					label: "Sessions",
					icon: "MessagesSquare"
				}
			]
		},
		{
			group: "Content",
			items: [
				{
					href: "/admin/pipelines",
					label: "Pipelines",
					icon: "Workflow"
				},
				{
					href: "/admin/configurations",
					label: "Configurations",
					icon: "SlidersVertical"
				},
				{
					href: "/admin/prompts",
					label: "Prompts",
					icon: "MessageSquareText"
				},
				{
					href: "/admin/context-templates",
					label: "Context templates",
					icon: "LayoutTemplate"
				},
				{
					href: "/admin/variable-templates",
					label: "Variable templates",
					icon: "Braces"
				},
				{
					href: "/admin/scripts",
					label: "Scripts",
					icon: "SquareCode"
				},
				{ href: "/admin/plugins", label: "Plugins", icon: "Puzzle" }
			]
		}
	]

	// With accounts off there is no roster to manage: the Users section (and
	// its handlers, server-side) exists only when accounts do. Filtering the
	// nav model keeps empty groups from rendering a bare label.
	let nav = $derived(
		systemSettingsCtx?.settings?.isAccountsEnabled === false
			? NAV.map((s) => ({
					...s,
					items: s.items.filter((i) => i.href !== "/admin/users")
				})).filter((s) => s.items.length > 0)
			: NAV
	)

	let path = $derived(page.url.pathname)
	const isActive = (href: string) =>
		path === href || path.startsWith(href + "/")
</script>

<div class="admin-root p-4">
	<header class="mb-4 flex flex-wrap items-center gap-3">
		<div>
			<p class="text-surface-600-400 text-xs">
				<a href="/" class="hover:underline">Home</a>
				/
				<strong>Administration</strong>
			</p>
			<h1 class="flex items-center gap-2 text-2xl font-semibold">
				<Icons.ShieldCheck size={24} class="text-primary-500" />
				Administration
			</h1>
		</div>
		<div class="flex-1"></div>
		<span
			class="preset-tonal-surface rounded-full px-2.5 py-0.5 font-mono text-xs"
		>
			{appVersionDisplay}
		</span>
	</header>

	<div class="admin-body">
		<nav class="admin-nav" aria-label="Admin sections">
			<ul>
				{#each nav as section (section.group)}
					<li class="nav-group-label" aria-hidden="true">
						{section.group}
					</li>
					{#each section.items as item (item.href)}
						{@const IconCmp = Icons[item.icon] as any}
						<li>
							<a
								href={item.href}
								aria-current={isActive(item.href)
									? "page"
									: undefined}
								class={isActive(item.href)
									? "preset-filled-primary-500"
									: "nav-idle"}
							>
								<IconCmp size={17} />
								<span>{item.label}</span>
							</a>
						</li>
					{/each}
				{/each}
			</ul>
		</nav>

		<main class="admin-content">
			{@render children?.()}
		</main>
	</div>
</div>

<style>
	.admin-root {
		container-type: inline-size;
		container-name: admin;
	}
	.admin-body {
		display: flex;
		flex-direction: column;
		gap: 1rem;
		align-items: stretch;
	}

	/* Pill bar (default, narrow container) */
	.admin-nav ul {
		display: flex;
		gap: 0.35rem;
		list-style: none;
		margin: 0;
		padding: 0.3rem;
		overflow-x: auto;
		scroll-snap-type: x proximity;
		-webkit-overflow-scrolling: touch;
		border-radius: 0.85rem;
		/* Skeleton v5 tokens are complete colors (oklch); use them directly,
		   with color-mix for alpha. Dark mode is [data-mode="dark"] on <html>. */
		background: var(--color-surface-100);
		border: 1px solid
			color-mix(in oklab, var(--color-surface-300) 50%, transparent);
	}
	:global([data-mode="dark"]) .admin-nav ul {
		background: var(--color-surface-900);
		border-color: color-mix(
			in oklab,
			var(--color-surface-700) 50%,
			transparent
		);
	}
	.admin-nav ul::-webkit-scrollbar {
		height: 6px;
	}
	.admin-nav a {
		display: flex;
		align-items: center;
		gap: 0.45rem;
		padding: 0.45rem 0.8rem;
		border-radius: 0.55rem;
		font-size: 0.84rem;
		font-weight: 560;
		white-space: nowrap;
		scroll-snap-align: start;
	}
	.admin-nav a.nav-idle {
		color: var(--color-surface-600);
	}
	:global([data-mode="dark"]) .admin-nav a.nav-idle {
		color: var(--color-surface-300);
	}
	.admin-nav a.nav-idle:hover {
		background: color-mix(
			in oklab,
			var(--color-surface-500) 15%,
			transparent
		);
	}
	.nav-group-label {
		display: none;
	}

	/* Content pane: its own container so pages respond to PANE width */
	.admin-content {
		container-type: inline-size;
		container-name: content;
		min-width: 0;
		flex: 1;
	}

	/* admin >= 760px: nav becomes a sticky vertical side rail */
	@container admin (min-width: 760px) {
		.admin-body {
			flex-direction: row;
			gap: 1.25rem;
		}
		.admin-nav {
			flex: none;
			width: 198px;
			position: sticky;
			top: 0.5rem;
			align-self: flex-start;
		}
		.admin-nav ul {
			flex-direction: column;
			overflow: visible;
			padding: 0.4rem;
			gap: 0.15rem;
		}
		.admin-nav a {
			padding: 0.5rem 0.7rem;
		}
	}

	/* admin >= 1280px: wider rail + section group labels appear */
	@container admin (min-width: 1280px) {
		.admin-nav {
			width: 230px;
		}
		.nav-group-label {
			display: block;
			font-size: 0.68rem;
			font-weight: 650;
			text-transform: uppercase;
			letter-spacing: 0.08em;
			padding: 0.7rem 0.7rem 0.25rem;
			color: var(--color-surface-500);
		}
	}
</style>
