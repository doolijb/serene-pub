<script lang="ts">
	import * as Icons from "@lucide/svelte"
	import { avatarSrc } from "$lib/client/utils/media"
	import PanelNavHeader from "$lib/client/components/panels/PanelNavHeader.svelte"
	import DetailHero from "$lib/client/components/panels/DetailHero.svelte"
	import { roleWord } from "$lib/client/admin/sections/users/usersAdmin"

	interface Props {
		user: SelectUser
		isCurrentUserAdmin: boolean
		/**
		 * Back to the list. Omitted when the list is already on screen beside
		 * this panel (a view in desk mode), where a "back" that goes nowhere
		 * visible is only a button to explain.
		 */
		onBack?: () => void
		onEdit: () => void
		/**
		 * Delete this account (the host confirms). Omitted where it may not
		 * be offered — for a member, and on an admin's own account, which
		 * the server refuses to delete.
		 */
		onDelete?: () => void
	}

	let { user, isCurrentUserAdmin, onBack, onEdit, onDelete }: Props = $props()

	const name = $derived(user.displayName || user.username)
</script>

<!-- The nav header says the kind; the hero says which one (§6.3, §6.4). -->
<div class="flex min-h-0 flex-1 flex-col gap-3">
	<PanelNavHeader
		title="User"
		{onBack}
		backLabel="Back to users"
		actionsLabel="User"
		menuItems={[
			onDelete && {
				label: "Delete",
				icon: Icons.Trash2,
				destructive: true,
				onSelect: onDelete
			}
		]}
	/>

	<div class="flex min-h-0 flex-1 flex-col gap-4 overflow-y-auto">
		<DetailHero
			title={name}
			subtitle="@{user.username}"
			meta={roleWord(user)}
			image={avatarSrc(user, { full: true })}
			letter={name}
			actions={isCurrentUserAdmin ? heroActions : undefined}
		/>

		<!-- Details -->
		<!-- Side by side once the detail has the room (notes 14). -->
		<section class="grid max-w-3xl gap-3 @xl/detail:grid-cols-2">
			<div class="space-y-1">
				<p class="text-surface-600-400 text-xs font-semibold">
					Username
				</p>
				<p class="text-sm">{user.username}</p>
			</div>
			{#if user.displayName}
				<div class="space-y-1">
					<p class="text-surface-600-400 text-xs font-semibold">
						Display name
					</p>
					<p class="text-sm">{user.displayName}</p>
				</div>
			{/if}
		</section>
	</div>
</div>

<!-- The detail's one primary, labelled and filled, under the hero (§6.3). -->
{#snippet heroActions()}
	<button
		type="button"
		class="btn btn-sm preset-filled-primary-500"
		onclick={onEdit}
	>
		<Icons.Pencil size={16} aria-hidden="true" />
		Edit
	</button>
{/snippet}
