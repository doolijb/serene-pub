<script lang="ts">
	/**
	 * Admin › Users: the changelist (note 37, Django admin). Every account on
	 * the instance with its role, last sign-in and age; filters by role and
	 * sign-in; "Delete selected users…" deactivates (your own is kept). A row
	 * opens its change form at `/admin/users/<id>`; Invites is a page of the
	 * section (`/admin/users/invites`).
	 *
	 * The section exists only while accounts do. With accounts off the
	 * instance is single-user — the nav already hides this section, and this
	 * gate covers the direct address: no `users:*` emit fires, and the server
	 * refuses those handlers regardless (`requireAccountsEnabled`).
	 */
	import { getContext } from "svelte"
	import * as Icons from "@lucide/svelte"
	import { useTypedSocket } from "$lib/client/sockets/typedSocket"
	import { getInterestContext, useInterest } from "$lib/client/sockets/interest.svelte"
	import { toaster } from "$lib/client/utils/toaster"
	import { docsHref } from "$lib/shared/utils/docsHref"
	import AdminPageHeader from "$lib/client/components/admin/AdminPageHeader.svelte"
	import AdminChangelist from "$lib/client/components/admin/AdminChangelist.svelte"
	import type {
		AdminBulkAction,
		AdminChangelistColumn,
		AdminChangelistFilter
	} from "$lib/client/components/admin/changelist"
	import { USER_NOUN, roleWord, userDeletion } from "./usersAdmin"

	const socket = useTypedSocket()
	const interest = getInterestContext()
	const systemSettingsCtx: SystemSettingsCtx = getContext("systemSettingsCtx")
	const userCtx: UserCtx = getContext("userCtx")
	const selfId = $derived(userCtx?.user?.id ?? null)
	const accountsOff = $derived(systemSettingsCtx?.settings?.isAccountsEnabled === false)

	let rows = $state<SelectUser[]>([])
	let loading = $state(true)
	/**
	 * The roster, asked for and listened for in one. BARE and STANDING: the
	 * server re-emits it after every account write. The app-wide interest
	 * context — `users:` is a mixed family; the handler's admin check is the
	 * boundary. Never asked while accounts are off.
	 */
	$effect(() => {
		if (accountsOff) return
		return interest.requestWithInterest("users:list", {}, (res) => {
			rows = res.users
			loading = false
		})
	})

	let deleting = $state(0)
	useInterest<"users:delete">("users:delete", () => {
		if (!deleting) return
		if (--deleting === 0) {
			toaster.success({ title: "Deleted" })
			socket.emit("users:list", {})
		}
	})
	useInterest<"users:delete:error">("users:delete:error", (res) => {
		if (!deleting) return
		deleting--
		toaster.error({ title: res.error ?? "The account was not deleted." })
	})

	const when = (v: string | Date | null | undefined) =>
		v ? new Date(v).toLocaleDateString() : ""

	const columns: AdminChangelistColumn<SelectUser>[] = [
		{
			key: "username",
			label: "Username",
			primary: true,
			text: (r) => r.username + (r.id === selfId ? " (you)" : ""),
			sortValue: (r) => r.username
		},
		{
			key: "displayName",
			label: "Display name",
			text: (r) => r.displayName ?? "",
			sortValue: (r) => r.displayName
		},
		{
			key: "role",
			label: "Role",
			text: roleWord,
			sortValue: (r) => (r.isAdmin ? 0 : 1)
		},
		{
			key: "lastLogin",
			label: "Last sign-in",
			text: (r) => when(r.lastLoginAt) || "Never",
			sortValue: (r) => (r.lastLoginAt ? new Date(r.lastLoginAt).getTime() : null)
		},
		{
			key: "created",
			label: "Created",
			text: (r) => when(r.createdAt),
			sortValue: (r) => (r.createdAt ? new Date(r.createdAt).getTime() : null),
			hideWhenStacked: true
		}
	]

	const filters: AdminChangelistFilter<SelectUser>[] = [
		{
			key: "role",
			label: "Role",
			values: (r) => (r.isAdmin ? "admin" : "member"),
			optionLabel: (v) => (v === "admin" ? "Administrator" : "Member"),
			order: ["admin", "member"]
		},
		{
			key: "signedIn",
			label: "Signed in",
			values: (r) => (r.lastLoginAt ? "yes" : "never"),
			optionLabel: (v) => (v === "yes" ? "Has signed in" : "Never signed in"),
			order: ["yes", "never"]
		}
	]

	const bulkActions: AdminBulkAction<SelectUser>[] = [
		{
			key: "delete",
			label: "Delete selected users…",
			icon: Icons.Trash2,
			destructive: true,
			confirm: (selected) => userDeletion(selected, selfId),
			run: (selected) => {
				const ids = selected.filter((u) => u.id !== selfId).map((u) => u.id)
				deleting += ids.length
				for (const id of ids) socket.emit("users:delete", { id })
			}
		}
	]
</script>

{#if accountsOff}
	<AdminPageHeader
		title="Users"
		doc={docsHref("users-and-accounts", "the-users-view")}
		purpose="Accounts on this pub and their roles."
	/>
	<p class="text-surface-700-300 flex max-w-[820px] items-center gap-2 text-sm">
		<span class="bg-surface-500 size-2 shrink-0 rounded-full" aria-hidden="true"></span>
		Accounts are off, so this pub is single-user and has no roster to manage.
		<a href="/admin/general" class="anchor">Turn accounts on in General</a>
	</p>
{:else}
	<AdminChangelist
		title="Users"
		doc={docsHref("users-and-accounts", "the-users-view")}
		purpose="Accounts on this pub and their roles. Invite people or add an account yourself."
		{rows}
		rowKey={(r) => r.id}
		{columns}
		{filters}
		{bulkActions}
		{loading}
		noun={USER_NOUN}
		searchText={(r) => `${r.username} ${r.displayName ?? ""} ${roleWord(r)}`}
		rowHref={(r) => `/admin/users/${r.id}`}
		addHref="/admin/users/new"
		defaultSort="username"
		emptyIcon={Icons.Users}
		emptyMessage="No users."
	>
		{#snippet headerActions()}
			<a class="btn btn-sm preset-tonal-surface" href="/admin/users/invites">
				<Icons.UserPlus size={16} aria-hidden="true" /> Invites
			</a>
		{/snippet}
	</AdminChangelist>
{/if}
