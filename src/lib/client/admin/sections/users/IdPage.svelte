<script lang="ts">
	/**
	 * One account's dedicated change page: `UserForm` — the same form the
	 * Users panel renders — pointed at this row. The list arrives over the
	 * same admin-gated `users:list` the changelist uses.
	 */
	import { adminGoto as goto, adminUnsavedEdits } from "$lib/client/admin/adminRouter.svelte"
	import { adminPage as page } from "$lib/client/admin/adminRouter.svelte"
	import * as Icons from "@lucide/svelte"
	import { getContext } from "svelte"
	import { ADMIN_SPLIT } from "$lib/client/components/admin/AdminSplit.svelte"
	import { useTypedSocket } from "$lib/client/sockets/loadSockets.client"
	import { getInterestContext } from "$lib/client/sockets/interest.svelte"
	import UserForm from "$lib/client/components/userForms/UserForm.svelte"
	import DetailHero from "$lib/client/components/panels/DetailHero.svelte"

	const socket = useTypedSocket()
	const interest = getInterestContext()

	let clearingTotp = $state(false)

	function clearTotp() {
		if (
			!confirm(
				"Clear two-factor authentication for this user and sign out all of their sessions?"
			)
		)
			return
		clearingTotp = true
		socket.emit("totp:adminClear", { userId: Number(id) })
	}
	let id = $derived(Number(page.params.id))

	let users: SelectUser[] = $state([])
	let loading = $state(true)
	let user = $derived(users.find((u) => u.id === id))

	function handleList(res: Sockets.Users.List.Response) {
		users = res.users
		loading = false
	}

	/**
	 * The roster this form picks its row out of, asked for and listened for in
	 * one. BARE — `users:list` has no `SCOPED_EVENTS` entry, so a key naming
	 * the id would match nothing; the `find` below is the filter. STANDING,
	 * because the server re-emits the list after every account write, which is
	 * how this form shows what it just saved.
	 */
	$effect(() => interest.requestWithInterest("users:list", {}, handleList))

	const done = () => goto("/admin/users")
	let formDirty = $state(false)
	adminUnsavedEdits(() => formDirty)

	const split = getContext<{ mode: "desk" | "compact" } | undefined>(
		ADMIN_SPLIT
	)
</script>

{#if split?.mode !== "desk"}
	<a
		href="/admin/users"
		class="text-surface-600-400 hover:text-surface-950-50 mb-3 inline-flex items-center gap-1 self-start text-[13px]"
	>
		<Icons.ChevronLeft size={14} /> Back to users
	</a>
{/if}

<DetailHero
	class="mb-4"
	headingLevel={2}
	title={user?.username ?? "User"}
	letter={user?.username ?? "U"}
	subtitle={user
		? `${user.isAdmin ? "Admin" : "Member"}${user.createdAt ? ` · created ${user.createdAt}` : ""}`
		: undefined}
/>

{#if loading}
	<p class="text-surface-600-400 text-sm">Loading…</p>
{:else if !user}
	<div class="panel-card text-surface-600-400 py-8 text-center text-sm">
		This user no longer exists.
		<a class="underline" href="/admin/users">Back to the list</a>
		.
	</div>
{:else}
	{#key id}
		<div class="flex max-w-[820px] flex-col gap-4">
			<div class="panel-card">
				<!-- A save stays on the account (the list is beside it at desk
				     width); Cancel goes back. -->
				<UserForm {user} onCancel={done} bind:dirty={formDirty} />
			</div>

			<!-- Tier 2 recovery (26 §10): the ordinary "lost my phone and my
		     codes" case, which should not need filesystem access. -->
			<div class="panel-card space-y-2">
				<h3 class="text-sm font-semibold">Two-factor authentication</h3>
				<p class="text-surface-600-400 text-sm">
					If this user has lost both their authenticator and their
					recovery codes, clearing their second factor lets them sign
					in with their password alone. All of their sessions are
					signed out at the same time — leaving them active would keep
					them authenticated under a guarantee that no longer holds.
				</p>
				<button
					type="button"
					class="btn btn-sm preset-tonal-error"
					disabled={clearingTotp}
					onclick={clearTotp}
				>
					Clear two-factor for this user
				</button>
			</div>
		</div>
	{/key}
{/if}
