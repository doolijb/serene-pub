/**
 * 🚧 Whether this person's **lore write mode** is Off (plan A22) — what a
 * review screen that saves into a lorebook (summarize, compile, graph build)
 * reads to say, before any work, that its save would be refused.
 *
 * Resolved here from the two settings rows the shell already holds, by the
 * shared rule (`effectiveLoreWriteMode`) — never from a copy the server
 * resolved once, which an admin moving the pub default would leave
 * stale. The person is the book's owner on every screen that asks: those
 * screens are owner-only.
 *
 * Call during component setup (it reads context).
 */

import { getContext } from "svelte"
import { effectiveLoreWriteMode } from "$lib/shared/lorebooks/loreWriteMode"

export function useLoreWritesOff(): { readonly off: boolean } {
	const user = getContext<UserSettingsCtx | undefined>("userSettingsCtx")
	const pub = getContext<SystemSettingsCtx | undefined>("systemSettingsCtx")
	return {
		get off() {
			return (
				effectiveLoreWriteMode(
					user?.settings?.loreWriteMode,
					pub?.settings?.loreWriteModeDefault
				) === "off"
			)
		}
	}
}
