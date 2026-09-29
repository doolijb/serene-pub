<script lang="ts">
	/**
	 * Settings → Data: the backups an owner can see without breaking anything.
	 *
	 * Deliberately small. Restore is not here and will not be: putting a
	 * different database under a running app with live sockets on it is not
	 * something a settings panel gets to do, and the state where restoring is
	 * the right answer is one this panel cannot be reached in — the app does not
	 * start. Restore lives on `/recovery` and in `npm run db:recover`.
	 *
	 * What is here is the pair ruling 3 asked for: **Back up now**, because an
	 * owner about to try something should be able to take one without waiting
	 * for the daily check or a version upgrade; and **Delete**, because nothing
	 * culls backups ever, so the disk is the owner's to reclaim.
	 *
	 * The two *policies* — daily on/off, include user files — are not here.
	 * They are instance-wide settings and live with the rest of those in
	 * /admin/data; what this panel carries of them is the one-shot
	 * override beside Back up now, which is a decision about this backup
	 * rather than about every future one.
	 *
	 * The second list — databases set aside by a recovery — is here for the same
	 * reason: those directories are kept forever by design, and `/recovery` (the
	 * only other place they are listed) is unreachable the moment the instance
	 * works again. Without this, the honest "nothing is ever deleted" promise
	 * would leave tens of gigabytes with no way to find them.
	 */
	import { getContext } from "svelte"
	import * as Icons from "@lucide/svelte"
	import { toaster } from "$lib/client/utils/toaster"
	import { useTypedSocket } from "$lib/client/sockets/loadSockets.client"
	import { getInterestContext } from "$lib/client/sockets/interest.svelte"

	const socket = useTypedSocket()
	/**
	 * The app-wide context, not the admin one: this tab lives in the ordinary
	 * Settings sidebar (`SettingsSidebar`), not under `/admin`, where
	 * `adminInterest` does not exist. `backups:` is RESTRICTED interest all the
	 * same, so for a non-admin every declare below is refused and no request
	 * leaves at all — which matches the panel they see ("Backups are managed by
	 * an administrator") rather than asking for an Unauthorized error to toast.
	 */
	const interest = getInterestContext()
	let userCtx: UserCtx = $state(getContext("userCtx"))

	let listing = $state<Sockets.Backups.List.Response | null>(null)
	let loading = $state(true)
	let busy = $state(false)
	/**
	 * The one-shot override beside **Back up now**.
	 *
	 * Deliberately not seeded from the stored setting and deliberately reset
	 * after each press: it means "include user files in *this* backup", and a
	 * checkbox that silently stayed ticked would quietly turn a per-backup
	 * choice into the policy that lives in /admin/data.
	 */
	let includeUserFilesOnce = $state(false)

	function handleList(res: Sockets.Backups.List.Response) {
		listing = res
		loading = false
		busy = false
	}

	function handleCreated(res: Sockets.Backups.Create.Response) {
		busy = false
		includeUserFilesOnce = false
		toaster.success({
			title: `Backed up to ${res.backup.name}`,
			description: res.backup.hasUsers
				? `With ${formatBytes(res.backup.usersBytes)} of user files beside it.`
				: undefined
		})
	}

	function handleDeleted() {
		busy = false
	}

	function handleError(res: Sockets.ErrorResponse) {
		loading = false
		busy = false
		toaster.error({ title: res.error })
	}

	const ERROR_EVENTS = [
		"backups:list:error",
		"backups:create:error",
		"backups:delete:error"
	] as const

	// Declared at initialisation and released on destroy, by the registry. The
	// three success events are gated, so the server runs no `listBackups` for a
	// tab nobody has open.
	interest.useInterest<"backups:create">("backups:create", handleCreated)
	interest.useInterest<"backups:delete">("backups:delete", handleDeleted)
	for (const event of ERROR_EVENTS)
		interest.useInterest<"backups:list:error">(event, handleError)

	$effect(() => {
		// The list interest and the request that fills it, in one: the sync
		// naming `backups:list` leaves before the request, so the handler
		// answering it already sees the key.
		return interest.requestWithInterest("backups:list", {}, handleList)
	})

	function backUpNow() {
		busy = true
		// Sent only when ticked. Absent means "whatever the setting says",
		// which is the difference between an override and a second policy.
		socket.emit(
			"backups:create",
			includeUserFilesOnce ? { includeUserFiles: true } : {}
		)
	}

	function deleteBackup(name: string, hasUsers: boolean) {
		// A backup is the only copy of whatever is not in the live database, so
		// the confirmation says the one thing that matters: this one is not a
		// move like everything else in recovery, it is a delete.
		if (
			!confirm(
				`Delete the backup "${name}"?\n\n` +
					`This removes the file permanently — it is not moved aside, and it cannot be undone.` +
					(hasUsers
						? `\n\nThe user files archived with it go too; a copy of your media that belongs to no backup would never be listed again.`
						: "")
			)
		)
			return
		busy = true
		socket.emit("backups:delete", { name, kind: "backup" })
	}

	function deleteSetAside(name: string, bytes: number) {
		if (
			!confirm(
				`Delete "${name}" and everything in it?\n\n` +
					`This is a database Serene Pub set aside during a recovery — ${formatBytes(bytes)}. ` +
					`It is the only copy of whatever was in it, and it may still be repairable. This cannot be undone.`
			)
		)
			return
		busy = true
		socket.emit("backups:delete", { name, kind: "setAside" })
	}

	function formatBytes(bytes: number): string {
		if (bytes < 1024) return `${bytes} B`
		if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`
		if (bytes < 1024 * 1024 * 1024)
			return `${(bytes / 1024 / 1024).toFixed(1)} MB`
		return `${(bytes / 1024 / 1024 / 1024).toFixed(2)} GB`
	}

	function formatWhen(iso: string): string {
		const at = new Date(iso)
		return Number.isNaN(at.getTime()) ? iso : at.toLocaleString()
	}
</script>

<div class="flex flex-col gap-4">
	{#if !userCtx.user?.isAdmin}
		<div class="panel-card">
			<p class="text-surface-700-300 text-sm">
				Backups are managed by an administrator.
			</p>
		</div>
	{:else}
		<div class="panel-card">
			<h3 id="backups-list" class="mb-2 text-sm font-medium">Backups</h3>
			<p class="text-surface-700-300 mb-3 text-sm">
				A backup is a copy of the whole database. One is taken daily,
				and one before a version upgrade changes anything — nothing is
				ever deleted on its own, so these stay until you remove them.
				Whether backups happen daily, and whether they carry your media
				and avatars, are set in Admin › Data and backups.
			</p>
			<p class="text-surface-700-300 mb-3 text-sm">
				To put one of these back, Serene Pub has to be stopped: run
				<code class="font-mono text-xs">
					npm run db:recover -- --list
				</code>
				, or start the app and use the recovery page it shows you if the
				database will not open.
			</p>

			<label class="mb-3 flex w-fit items-center gap-2 text-sm">
				<input
					type="checkbox"
					class="checkbox"
					bind:checked={includeUserFilesOnce}
					disabled={busy}
				/>
				Include user files (media and avatars) in this backup
			</label>

			<button
				type="button"
				data-field="backup-now"
				class="btn preset-filled-primary-500 w-fit"
				onclick={backUpNow}
				disabled={busy}
			>
				{#if busy}
					<Icons.Loader2 size={16} class="animate-spin" />
					Working…
				{:else}
					<Icons.DatabaseBackup size={16} />
					Back up now
				{/if}
			</button>

			{#if loading}
				<p class="text-surface-700-300 mt-4 text-sm">Loading…</p>
			{:else if listing && listing.backups.length === 0}
				<p class="text-surface-700-300 mt-4 text-sm italic">
					There are no backups yet.
				</p>
			{:else if listing}
				<ul class="mt-4 flex flex-col gap-2">
					{#each listing.backups as backup (backup.name)}
						<li
							class="bg-surface-50-950 flex flex-wrap items-center justify-between gap-2 rounded-[10px] px-3 py-2"
						>
							<div class="min-w-0">
								<div class="font-mono text-xs break-all">
									{backup.name}
								</div>
								<div class="text-surface-700-300 text-xs">
									{formatBytes(backup.bytes)} · {formatWhen(
										backup.modifiedAt
									)}
									{#if !backup.hasMeta}
										· no meta.json
									{/if}
									{#if backup.hasUsers}
										· + {formatBytes(backup.usersBytes)} user
										files
									{/if}
								</div>
							</div>
							<button
								type="button"
								class="btn preset-tonal-error btn-sm"
								onclick={() =>
									deleteBackup(backup.name, backup.hasUsers)}
								disabled={busy}
								aria-label={`Delete backup ${backup.name}`}
							>
								<Icons.Trash2 size={14} />
								Delete
							</button>
						</li>
					{/each}
				</ul>
			{/if}

			{#if listing}
				<p class="text-surface-700-300 mt-3 text-xs">
					Stored in
					<span class="font-mono break-all">
						{listing.backupsDir}
					</span>
				</p>
			{/if}
		</div>

		{#if listing && listing.setAside.length > 0}
			<div class="panel-card">
				<h3 id="set-aside" class="mb-2 text-sm font-medium">Databases set aside</h3>
				<p class="text-surface-700-300 mb-3 text-sm">
					When a database will not open, Serene Pub moves it aside
					rather than deleting it. These are those copies. They may
					still be repairable, so they are kept until you decide
					otherwise.
				</p>
				<ul class="flex flex-col gap-2">
					{#each listing.setAside as dir (dir.name)}
						<li
							class="bg-surface-50-950 flex flex-wrap items-center justify-between gap-2 rounded-[10px] px-3 py-2"
						>
							<div class="min-w-0">
								<div class="font-mono text-xs break-all">
									{dir.name}
								</div>
								<div class="text-surface-700-300 text-xs">
									{formatBytes(dir.bytes)} · {formatWhen(
										dir.modifiedAt
									)}
									·
									{dir.kind === "broken"
										? "set aside by a recovery"
										: "a restore that did not open"}
								</div>
							</div>
							<button
								type="button"
								class="btn preset-tonal-error btn-sm"
								onclick={() =>
									deleteSetAside(dir.name, dir.bytes)}
								disabled={busy}
								aria-label={`Delete set-aside database ${dir.name}`}
							>
								<Icons.Trash2 size={14} />
								Delete
							</button>
						</li>
					{/each}
				</ul>
			</div>
		{/if}
	{/if}
</div>
