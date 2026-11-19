<script lang="ts">
	/**
	 * Extension settings that are each person's own — the fields a plugin
	 * declares `scope: 'user'`. Every signed-in person sees this card for the
	 * switched-on plugins that declare one; the instance's values, and every
	 * other field, stay on the admin plugins page.
	 *
	 * A field the person has not set shows the instance's value (or the
	 * declared default), which is what their hooks read until they save one of
	 * their own. "Use the default" clears theirs.
	 *
	 * Renders nothing when no plugin declares a user-scoped field.
	 */
	import {
		requestWithInterest,
		useInterest
	} from "$lib/client/sockets/interest.svelte"
	import { useTypedSocket } from "$lib/client/sockets/loadSockets.client"
	import { notify } from "$lib/client/utils/notify"
	import { i18nTextIn } from "$lib/shared/i18n/i18nText"
	import PluginSettingsFields from "./PluginSettingsFields.svelte"
	import SettingCard from "./SettingCard.svelte"

	const socket = useTypedSocket()

	let plugins = $state<Sockets.PluginUserSettings.List.Response["plugins"]>(
		[]
	)
	/** Unsaved edits per plugin — only touched fields are sent. */
	let drafts = $state<Record<string, Record<string, unknown>>>({})
	let errors = $state<Record<string, string | null>>({})
	/** Saves in flight, per plugin, so each answer is acknowledged on its own. */
	let pending = $state<Record<string, number>>({})
	/**
	 * One round is the saves in flight from the moment the first one is sent
	 * until the last answers: "Settings saved" is said only of a round in
	 * which something saved and nothing failed.
	 */
	let roundSaved = 0
	let roundFailed = false
	let anyPending = $derived(Object.values(pending).some((n) => n > 0))
	let dirty = $derived(
		Object.values(drafts).some((d) => Object.keys(d).length > 0)
	)

	/** One answer in for a plugin; ends the round when it was the last. */
	function answered(pluginId: string, saved: boolean) {
		const left = (pending[pluginId] ?? 0) - 1
		if (left > 0) pending[pluginId] = left
		else delete pending[pluginId]
		if (saved) roundSaved += 1
		else roundFailed = true
		endRound()
	}
	function endRound() {
		if (Object.keys(pending).length) return
		if (roundSaved > 0 && !roundFailed)
			notify.success({
				source: "socket:pluginUserSettings:list",
				title: "Settings saved"
			})
		roundSaved = 0
		roundFailed = false
	}

	/** A fresh view replaces what is shown; drafts and errors are not its to touch. */
	function handleList(res: Sockets.PluginUserSettings.List.Response) {
		plugins = res.plugins
	}
	/**
	 * A save landed. Another tab's save is not this tab's pending, so it
	 * leaves this tab's typed values alone.
	 */
	function handleSet(res: Sockets.PluginUserSettings.Set.Response) {
		if (!pending[res.pluginId]) return
		answered(res.pluginId, true)
		if (!pending[res.pluginId]) {
			delete drafts[res.pluginId]
			delete errors[res.pluginId]
		}
	}
	/**
	 * A refusal keeps the typed values and names why. The socket layer's
	 * generic refusal names no plugin: every save still in flight failed.
	 */
	function handleSetError(res: Sockets.PluginUserSettings.Set.Response) {
		const failed = res.pluginId ? [res.pluginId] : Object.keys(pending)
		for (const pluginId of failed) {
			if (!pending[pluginId]) continue
			if (res.error) errors[pluginId] = res.error
			if (res.pluginId) answered(pluginId, false)
			else {
				delete pending[pluginId]
				roundFailed = true
			}
		}
		if (!res.pluginId) endRound()
	}

	$effect(() =>
		requestWithInterest("pluginUserSettings:list", {}, handleList)
	)
	useInterest<"pluginUserSettings:set">("pluginUserSettings:set", handleSet)
	useInterest<"pluginUserSettings:set:error">(
		"pluginUserSettings:set:error",
		handleSetError
	)

	function edit(pluginId: string, key: string, value: unknown) {
		drafts[pluginId] = { ...(drafts[pluginId] ?? {}), [key]: value }
	}
	/** A (re)send for a plugin: its old error is being retried. */
	function send(pluginId: string, values: Record<string, unknown>) {
		pending[pluginId] = (pending[pluginId] ?? 0) + 1
		delete errors[pluginId]
		socket.emit("pluginUserSettings:set", { pluginId, values })
	}
	/** One Save for the card: each plugin with edits is written on its own. */
	function save() {
		for (const [pluginId, draft] of Object.entries(drafts)) {
			if (!Object.keys(draft).length) continue
			send(pluginId, draft)
		}
	}
	/** Clear the person's own value, so they read the instance's again. */
	function useDefault(pluginId: string, key: string) {
		send(pluginId, { [key]: null })
	}
	const nameOf = (name: unknown) =>
		i18nTextIn(name as any) ?? String(name ?? "")
</script>

{#if plugins.length}
	<SettingCard
		title="Extension settings"
		titleId="user-extension-settings-heading"
		help="Choices these extensions let each person make; they apply to you only."
		layout="stack"
	>
		<div class="flex flex-col gap-6">
			{#each plugins as p (p.pluginId)}
				{@const own = new Set(p.settings.own)}
				<section
					class="flex flex-col gap-3"
					aria-labelledby={`user-plugin-${p.pluginId}`}
				>
					<h4 id={`user-plugin-${p.pluginId}`} class="font-semibold">
						{nameOf(p.name)}
					</h4>
					<PluginSettingsFields
						schema={p.settings.schema}
						values={p.settings.values}
						draft={drafts[p.pluginId] ?? {}}
						idPrefix={`user-plugin-setting-${p.pluginId}`}
						onEdit={(key, value) => edit(p.pluginId, key, value)}
						note={(key) =>
							own.has(key)
								? null
								: "Using the default for everyone."}
					/>
					{#if p.settings.own.length}
						<div class="flex flex-wrap gap-2">
							{#each p.settings.own as key (key)}
								<button
									type="button"
									class="btn btn-sm preset-tonal"
									disabled={!!pending[p.pluginId]}
									onclick={() => useDefault(p.pluginId, key)}
								>
									Use the default for {i18nTextIn(
										p.settings.schema[key]?.label
									) ?? key}
								</button>
							{/each}
						</div>
					{/if}
					{#if errors[p.pluginId]}
						<p class="text-error-600-400 text-sm" role="alert">
							{errors[p.pluginId]}
						</p>
					{/if}
				</section>
			{/each}
			<div>
				<button
					type="button"
					class="btn preset-filled-primary-500"
					disabled={!dirty || anyPending}
					onclick={save}
				>
					Save
				</button>
			</div>
		</div>
	</SettingCard>
{/if}
