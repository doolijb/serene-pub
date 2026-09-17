<script lang="ts">
	/**
	 * The administration shell — every admin page lives inside this layout,
	 * below the app's main navigation, inside the center content pane.
	 *
	 * ## Where the section list lives
	 *
	 * The section list is a **sidebar view** in the shell
	 * (`components/sidebars/AdminSidebar.svelte`), opened by the rail's Admin
	 * item and again on the way INTO `/admin*`, so admin navigates the way the
	 * rest of the app does instead of growing a second navigation surface —
	 * a container-query pill bar / side rail — inside this layout. What is
	 * left here is the page itself.
	 *
	 * The content pane stays a container (`content`) and stays named that:
	 * admin pages size their form grids and split panes against the PANE's
	 * width, which is not the viewport's — the shell's sidebar takes 400px off
	 * it, and a page that measured the window would lay out for space it does
	 * not have. Those `@container content (...)` rules are the reason this
	 * element cannot become a plain `<main>`.
	 *
	 * Admin-only. This gate is for the person; the check in every socket
	 * handler is the one that matters.
	 */
	import { getContext, onMount, setContext } from "svelte"
	import { goto } from "$app/navigation"
	import * as Icons from "@lucide/svelte"
	import { appVersionDisplay } from "$lib/shared/constants/version"
	import {
		ADMIN_INTEREST_CONTEXT,
		interestContextValue
	} from "$lib/client/sockets/interest.svelte"

	let { children } = $props()

	const userCtx: { user: SelectUser } = getContext("userCtx")

	onMount(() => {
		if (!userCtx.user?.isAdmin) goto("/")
	})

	/**
	 * The admin-only half of the interest registry, provided HERE and nowhere
	 * else (socket-interest plan, ruling 6b): a restricted interest key is
	 * declared from inside this tree, which already turns non-admins away, so
	 * the context simply does not exist anywhere a non-admin can reach. The
	 * registry refuses restricted keys for a non-admin regardless, and the
	 * server's sync handler drops them — three checks, of which the handlers'
	 * own are the boundary. Same three functions as the app-wide `interest`
	 * context; the difference is where it can be got from.
	 */
	setContext(ADMIN_INTEREST_CONTEXT, interestContextValue())
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

	<main class="admin-content">
		{@render children?.()}
	</main>
</div>

<style>
	/* Content pane: its own container so pages respond to PANE width */
	.admin-content {
		container-type: inline-size;
		container-name: content;
		min-width: 0;
	}
</style>
