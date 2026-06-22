<script lang="ts">
	import * as Icons from "@lucide/svelte"

	interface Props {
		user: SelectUser
		isCurrentUserAdmin: boolean
		onBack: () => void
		onEdit: () => void
	}

	let { user, isCurrentUserAdmin, onBack, onEdit }: Props = $props()
</script>

<div class="flex h-full flex-col gap-0 overflow-hidden">
	<!-- Header -->
	<div class="flex shrink-0 items-center gap-2 pb-3">
		<button class="btn btn-sm preset-tonal-surface p-2" onclick={onBack} title="Back to users">
			<Icons.ChevronLeft size={16} />
		</button>
		<h2 class="flex-1 truncate font-semibold">
			{user.displayName || user.username}
		</h2>
		{#if isCurrentUserAdmin}
			<button class="btn btn-sm preset-filled-primary-500" onclick={onEdit} title="Edit user">
				<Icons.Pencil size={14} /> Edit
			</button>
		{/if}
	</div>

	<div class="flex flex-1 flex-col gap-4 overflow-y-auto">
		<!-- Avatar / initials -->
		<div class="flex items-center gap-3">
			<div class="preset-filled-surface-300-700 flex h-14 w-14 shrink-0 items-center justify-center rounded-full text-xl font-bold">
				{(user.displayName || user.username).charAt(0).toUpperCase()}
			</div>
			<div class="min-w-0">
				<p class="truncate text-lg font-bold">{user.displayName || user.username}</p>
				{#if user.displayName}
					<p class="text-surface-500 truncate text-sm">@{user.username}</p>
				{/if}
			</div>
		</div>

		<!-- Badges -->
		<div class="flex flex-wrap gap-2">
			{#if user.isAdmin}
				<span class="preset-filled-primary-500 rounded px-2 py-0.5 text-xs font-medium">
					Admin
				</span>
			{:else}
				<span class="preset-tonal-surface rounded px-2 py-0.5 text-xs font-medium">
					User
				</span>
			{/if}
		</div>

		<!-- Details -->
		<section class="space-y-3">
			<div class="space-y-1">
				<p class="text-surface-500 text-xs font-semibold uppercase tracking-wide">Username</p>
				<p class="text-sm">{user.username}</p>
			</div>
			{#if user.displayName}
				<div class="space-y-1">
					<p class="text-surface-500 text-xs font-semibold uppercase tracking-wide">Display Name</p>
					<p class="text-sm">{user.displayName}</p>
				</div>
			{/if}
		</section>
	</div>
</div>
