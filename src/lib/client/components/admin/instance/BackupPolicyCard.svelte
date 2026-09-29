<script lang="ts">
	/**
	 * The two instance-wide backup policies (ruled 2026-09-10): daily on/off
	 * and whether user files ride along. The list, Back up now and Delete are
	 * `DataSettingsTab`, which the Data page shows beneath this card.
	 */
	import { getContext } from "svelte"
	import { useTypedSocket } from "$lib/client/sockets/loadSockets.client"
	import SettingSwitch from "./SettingSwitch.svelte"
	import { requireAdmin } from "./requireAdmin"

	const socket = useTypedSocket()
	let systemSettingsCtx: SystemSettingsCtx = $state(
		getContext("systemSettingsCtx")
	)
	let userCtx: UserCtx = $state(getContext("userCtx"))

	function save(next: {
		backupDaily?: boolean
		backupIncludeUserFiles?: boolean
	}) {
		if (!requireAdmin(userCtx.user)) return
		socket?.emit("systemSettings:updateBackupSettings", next)
	}
</script>

<section class="panel-card flex flex-col gap-3" aria-labelledby="backup-policy-heading">
	<h2 id="backup-policy-heading" class="text-sm font-medium">
		Backup policy
	</h2>
	<SettingSwitch
		name="backup-daily"
		label="Back up daily"
		checked={systemSettingsCtx.settings?.backupDaily ?? true}
		onCheckedChange={(e) => save({ backupDaily: e.checked })}
	/>
	<p class="text-surface-600-400 text-sm">
		Takes a copy of the database once a day, on top of the one always
		taken before a version upgrade. Backups are never deleted on their own
		— remove one from the list below.
	</p>
	<SettingSwitch
		name="backup-include-user-files"
		label="Include user files"
		checked={systemSettingsCtx.settings?.backupIncludeUserFiles ?? false}
		onCheckedChange={(e) => save({ backupIncludeUserFiles: e.checked })}
	/>
	<p class="text-surface-600-400 text-sm">
		Archives media and avatars beside each backup, so a restored database
		still has the images it points at — this makes backups much larger,
		which is why it is off by default.
	</p>
</section>
