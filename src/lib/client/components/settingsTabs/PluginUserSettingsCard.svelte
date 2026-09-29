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
	import { toaster } from "$lib/client/utils/toaster"
	import { i18nTextIn } from "$lib/shared/i18n/i18nText"
	import PluginSettingsFields from "./PluginSettingsFields.svelte"

	const socket = useTypedSocket()

	let plugins = $state<Sockets.PluginUserSettings.List.Response["plugins"]>(
		[]
	)
	/** Unsaved edits per plugin — only touched fields are sent. */
	let drafts = $state<Record<string, Record<string, unknown>>>({})
	let errors = $state<Record<string, string | null>>({})
	/** Saves in flight, so their answers can be acknowledged. */
	let pending = $state(0)
	let dirty = $derived(
		Object.values(drafts).some((d) => Object.keys(d).length > 0)
	)

	function handleList(res: Sockets.PluginUserSettings.List.Response) {
		plugins = res.plugins
		// A fresh view supersedes every draft: it reflects the save that just
		// landed, or the card was just opened.
		drafts = {}
		if (pending > 0) {
			pending -= 1
			if (pending === 0) {
				errors = {}
				toaster.success({ title: "Settings saved" })
			}
		}
	}
	function handleSetError(res: Sockets.PluginUserSettings.Set.Response) {
		if (res.error) errors[res.pluginId] = res.error
		pending = Math.max(0, pending - 1)
	}

	$effect(() => requestWithInterest("pluginUserSettings:list", {}, handleList))
	useInterest<"pluginUserSettings:set:error">(
		"pluginUserSettings:set:error",
		handleSetError
	)

	function edit(pluginId: string, key: string, value: unknown) {
		drafts[pluginId] = { ...(drafts[pluginId] ?? {}), [key]: value }
	}
	/** One Save for the card: each plugin with edits is written on its own. */
	function save() {
		for (const [pluginId, draft] of Object.entries(drafts)) {
			if (!Object.keys(draft).length) continue
			pending += 1
			socket.emit("pluginUserSettings:set", { pluginId, values: draft })
		}
	}
	/** Clear the person's own value, so they read the instance's again. */
	function useDefault(pluginId: string, key: string) {
		pending += 1
		socket.emit("pluginUserSettings:set", {
			pluginId,
			values: { [key]: null }
		})
	}
	const nameOf = (name: unknown) =>
		i18nTextIn(name as any) ?? String(name ?? "")
</script>

{#if plugins.length}
	<div class="card preset-filled-surface-100-900 p-4">
		<h3 class="mb-2 text-sm font-medium">Extension settings</h3>
		<p class="text-surface-700-300 mb-3 text-sm">
			Choices these extensions let each person make. They apply to you
			only.
		</p>
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
							own.has(key) ? null : "Using the default for everyone."}
					/>
					{#if p.settings.own.length}
						<div class="flex flex-wrap gap-2">
							{#each p.settings.own as key (key)}
								<button
									type="button"
									class="btn btn-sm preset-tonal"
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
					disabled={!dirty || pending > 0}
					onclick={save}
				>
					Save
				</button>
			</div>
		</div>
	</div>
{/if}
