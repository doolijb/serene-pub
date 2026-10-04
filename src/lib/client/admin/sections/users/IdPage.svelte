<script lang="ts">
	/**
	 * Admin › Users › one account: the change form, pointed at this row. The
	 * row comes from the admin-gated `users:list` (BARE: it has no scoped
	 * key, so the `find` is the filter; STANDING: the server re-emits it
	 * after every account write).
	 */
	import * as Icons from "@lucide/svelte"
	import { adminPage } from "$lib/client/admin/adminRouter.svelte"
	import { getInterestContext } from "$lib/client/sockets/interest.svelte"
	import UserChangeForm from "./UserChangeForm.svelte"

	const interest = getInterestContext()
	const id = $derived(Number(adminPage.params.id))
	let users = $state<SelectUser[]>([])
	let loading = $state(true)
	const user = $derived(users.find((u) => u.id === id))
	$effect(() =>
		interest.requestWithInterest("users:list", {}, (res) => {
			users = res.users
			loading = false
		})
	)
</script>

{#if loading}
	<div class="text-surface-600-400 flex items-center justify-center gap-2 py-16 text-sm" role="status">
		<Icons.LoaderCircle size={16} class="animate-spin" aria-hidden="true" />
		Loading account…
	</div>
{:else if !user}
	<div class="m-auto flex flex-col items-center gap-3 py-16 text-center">
		<p class="text-surface-600-400 text-sm">There is no user {id}.</p>
		<a href="/admin/users" class="btn btn-sm preset-tonal-surface">All users</a>
	</div>
{:else}
	{#key id}
		<UserChangeForm {user} />
	{/key}
{/if}
