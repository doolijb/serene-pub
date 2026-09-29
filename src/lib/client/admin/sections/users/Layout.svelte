<script lang="ts">
	import { docsHref } from "$lib/shared/utils/docsHref"
	/**
	 * Users — the accounts on this instance, as a list beside the account it
	 * opens (`AdminSplit`). The detail is `[id]/+page.svelte` (edit),
	 * `new/+page.svelte` (create) or `invites/+page.svelte` (issue and revoke
	 * invites — something you do *while* looking at the roster, so it opens
	 * beside it rather than on a section of its own).
	 *
	 * The section exists only while accounts do. With accounts off the
	 * instance is single-user — the nav already hides this section, and this
	 * gate covers the direct URL: children never mount (so no users:* emits
	 * fire), and the server refuses those handlers regardless. The real
	 * enforcement is requireAccountsEnabled() in users.ts; this is the door.
	 */
	import { getContext } from "svelte"
	import * as Icons from "@lucide/svelte"
	import { adminGoto as goto } from "$lib/client/admin/adminRouter.svelte"
	import { adminPage as page } from "$lib/client/admin/adminRouter.svelte"
	import { getInterestContext } from "$lib/client/sockets/interest.svelte"
	import AdminList, {
		type AdminColumn
	} from "$lib/client/components/admin/AdminList.svelte"
	import AdminPageHeader from "$lib/client/components/admin/AdminPageHeader.svelte"
	import AdminSplit from "$lib/client/components/admin/AdminSplit.svelte"

	let { children } = $props()
	const systemSettingsCtx: SystemSettingsCtx = getContext("systemSettingsCtx")
	const userCtx: UserCtx = getContext("userCtx")
	const interest = getInterestContext()

	let accountsOff = $derived(
		systemSettingsCtx?.settings?.isAccountsEnabled === false
	)

	type Row = SelectUser
	let rows: Row[] = $state([])
	let loading = $state(true)

	function handleList(res: Sockets.Users.List.Response) {
		rows = res.users
		loading = false
	}

	/**
	 * The roster, asked for and listened for in one. BARE — the accounts are
	 * the instance's, with nothing to scope them to — and STANDING, because
	 * the server re-emits this list as a cascade after every account write, so
	 * a change made in the detail is already here.
	 *
	 * The app-wide interest context, not `adminInterest`: `users:` is a MIXED
	 * family (every account reads its own `users:current`), so this is an
	 * ordinary key and the handler's admin check is the boundary. Never asked
	 * while accounts are off — the server would refuse it.
	 */
	$effect(() => {
		if (accountsOff) return
		return interest.requestWithInterest("users:list", {}, handleList)
	})

	let selectedId = $derived(page.params.id)
	// `new` and `invites` are details too; the split shows them beside the list.
	let hasDetail = $derived(
		!!selectedId ||
			page.url.pathname.endsWith("/new") ||
			page.url.pathname.endsWith("/invites")
	)
	let onInvites = $derived(page.url.pathname.endsWith("/invites"))

	const columns: AdminColumn<Row>[] = [
		{ key: "username", label: "Username", value: (r) => r.username },
		{ key: "role", label: "Role", value: (r) => (r.isAdmin ? 0 : 1) },
		{ key: "createdAt", label: "Created", value: (r) => r.createdAt ?? "" }
	]

	function meta(r: Row): string {
		const parts: string[] = []
		if (r.displayName) parts.push(r.displayName)
		parts.push(r.isAdmin ? "Admin" : "Member")
		if (r.id === userCtx?.user?.id) parts.push("you")
		return parts.join(" · ")
	}
</script>

{#if accountsOff}
	<AdminPageHeader
		title="Users"
		doc={docsHref("users-and-accounts", "the-users-panel")}
		purpose="Accounts on this instance and their roles."
	/>
	<p
		class="text-surface-700-300 flex max-w-[820px] items-center gap-2 text-sm"
	>
		<span
			class="bg-surface-500 size-2 shrink-0 rounded-full"
			aria-hidden="true"
		></span>
		Accounts are off, so this instance is single-user and has no roster to manage.
		<a href="/admin/general" class="anchor">Turn accounts on in General</a>
	</p>
{:else}
	<AdminPageHeader
		title="Users"
		doc={docsHref("users-and-accounts", "the-users-panel")}
		purpose="Accounts on this instance and their roles. Invite people or add an account yourself."
	>
		{#snippet actions()}
			<a
				class="btn btn-sm {onInvites
					? 'preset-tonal-primary'
					: 'preset-tonal-surface'}"
				href="/admin/users/invites"
				aria-current={onInvites ? "page" : undefined}
			>
				<Icons.UserPlus size={16} /> Invites
			</a>
			<a
				class="btn btn-sm preset-filled-primary-500"
				href="/admin/users/new"
			>
				<Icons.Plus size={16} /> New user
			</a>
		{/snippet}
	</AdminPageHeader>

	<AdminSplit {hasDetail} emptyMessage="Pick an account to edit it.">
		{#snippet list()}
			<AdminList
				{rows}
				{columns}
				{loading}
				compact
				rowTitle={(r) => r.username}
				rowMeta={meta}
				isSelected={(r) => String(r.id) === selectedId}
				searchText={(r) => `${r.username} ${r.displayName ?? ""}`}
				searchPlaceholder="Filter users"
				defaultSort="username"
				emptyMessage="No users."
				onRowClick={(r) => goto(`/admin/users/${r.id}`)}
			>
				{#snippet cell(row)}{row.username}{/snippet}
			</AdminList>
		{/snippet}
		<!-- Keyed: SvelteKit reuses the page when only the id changes, and a
		     detail seeds its form once. -->
		{#key page.url.pathname}
			{@render children?.()}
		{/key}
	</AdminSplit>
{/if}
