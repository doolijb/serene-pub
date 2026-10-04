<script lang="ts">
	import * as Icons from "@lucide/svelte"
	import PanelNavHeader from "$lib/client/components/panels/PanelNavHeader.svelte"
	import DetailHero from "$lib/client/components/panels/DetailHero.svelte"

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
	}

	let { user, isCurrentUserAdmin, onBack, onEdit }: Props = $props()
</script>

<div class="flex h-full flex-col gap-0 overflow-hidden">
	<!-- Header -->
	<div class="shrink-0 pb-3">
		<PanelNavHeader
			title="User"
			{onBack}
			backLabel="Back to users"
		>
			{#snippet primaryAction()}
				{#if isCurrentUserAdmin}
					<button
						type="button"
						class="btn btn-sm preset-filled-primary-500 shrink-0 p-2"
						onclick={onEdit}
						title="Edit user"
						aria-label="Edit user"
					>
						<Icons.Pencil size={16} aria-hidden="true" />
					</button>
				{/if}
			{/snippet}
		</PanelNavHeader>
	</div>

	<div class="flex flex-1 flex-col gap-4 overflow-y-auto">
		<DetailHero
			title="User"
			subtitle={user.displayName ? `@${user.username}` : undefined}
			letter={user.displayName || user.username}
		>
			{#snippet chips()}
				<span
					class="{user.isAdmin
						? 'preset-tonal-primary'
						: 'preset-tonal-surface'} rounded px-2 py-0.5 text-xs font-medium"
				>
					{user.isAdmin ? "Admin" : "User"}
				</span>
			{/snippet}
		</DetailHero>

		<!-- Details -->
		<!-- Side by side once the detail has the room (notes 14). -->
		<section class="grid max-w-3xl gap-3 @xl/detail:grid-cols-2">
			<div class="space-y-1">
				<p
					class="text-surface-600-400 text-xs font-semibold"
				>
					Username
				</p>
				<p class="text-sm">{user.username}</p>
			</div>
			{#if user.displayName}
				<div class="space-y-1">
					<p
						class="text-surface-600-400 text-xs font-semibold"
					>
						Display name
					</p>
					<p class="text-sm">{user.displayName}</p>
				</div>
			{/if}
		</section>
	</div>
</div>
