/** 🚧 Advanced controls (2026-11-10): whether this person shows the less everyday controls on sessions, lorebooks and characters. A preference, never a permission. Off when the settings haven't arrived. */
export function showsAdvancedControls(
	settings: { showAdvancedControls?: boolean } | null | undefined
): boolean {
	return settings?.showAdvancedControls ?? false
}
