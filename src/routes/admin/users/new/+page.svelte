<script lang="ts">
	/** The new-account page: `UserForm` in create mode. */
	import { goto } from "$app/navigation"
	import * as Icons from "@lucide/svelte"
	import UserForm from "$lib/client/components/userForms/UserForm.svelte"

	const done = () => goto("/admin/users")
</script>

<div class="mb-4 flex flex-wrap items-center gap-3">
	<div class="min-w-0 flex-1">
		<p class="text-surface-600-400 text-xs">
			<a href="/admin/users" class="hover:underline">Users</a>
			/ <strong>New</strong>
		</p>
		<h2 class="flex items-center gap-2 text-lg font-semibold">
			<Icons.Users size={20} /> New user
		</h2>
	</div>
	<a class="btn btn-sm preset-tonal-surface" href="/admin/users">
		<Icons.ArrowLeft size={16} /> Back to list
	</a>
</div>

<div
	class="form-max card preset-tonal p-4 shadow-sm"
>
	<UserForm onSave={done} onCancel={done} />
</div>

<style>
	.form-max {
		max-width: 40rem;
	}
</style>
