<script lang="ts">
	/**
	 * Admin › Users › Invites: issue and revoke invites. A page of the Users
	 * section (breadcrumb Admin › People › Users › Invites), not an object
	 * kind of its own, so it is `InvitePanel` under the section's header.
	 */
	import AdminPageHeader from "$lib/client/components/admin/AdminPageHeader.svelte"
	import InvitePanel from "$lib/client/components/userForms/InvitePanel.svelte"
</script>

<AdminPageHeader
	title="Invites"
	purpose="Links that let someone make their own account on this pub. Revoke one to stop it working."
/>

<div class="panel-card max-w-[820px]">
	<InvitePanel />
</div>
