<script lang="ts">
	/**
	 * `/admin/...` are the Admin view's addresses, not pages (ruled
	 * 2026-09-27: admin is purely the sidebar view and Focus). Loading one
	 * renders nothing here: the shell opens the Admin view in Focus at that
	 * section (`Layout.svelte`, "Focus has an address"; `adminRouter`).
	 *
	 * The admin check here only turns a non-administrator away from the
	 * address; every admin socket handler checks again, and that is the
	 * boundary.
	 */
	import { getContext, onMount } from "svelte"
	import { goto } from "$app/navigation"

	let { children } = $props()

	const userCtx: { user: SelectUser } = getContext("userCtx")

	onMount(() => {
		if (!userCtx.user?.isAdmin) goto("/")
	})
</script>

{@render children?.()}
