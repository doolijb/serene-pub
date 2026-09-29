<script lang="ts">
	/** The new-account page: `UserForm` in create mode. */
	import { adminGoto as goto, adminUnsavedEdits } from "$lib/client/admin/adminRouter.svelte"
	import * as Icons from "@lucide/svelte"
	import { getContext } from "svelte"
	import { ADMIN_SPLIT } from "$lib/client/components/admin/AdminSplit.svelte"
	import UserForm from "$lib/client/components/userForms/UserForm.svelte"

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

<h2
	class="text-surface-950-50 mb-4 [font-family:var(--typo-heading--font-family)] text-base font-semibold"
>
	New user
</h2>

<div class="panel-card max-w-[820px]">
	<UserForm onSave={done} onCancel={done} bind:dirty={formDirty} />
</div>
