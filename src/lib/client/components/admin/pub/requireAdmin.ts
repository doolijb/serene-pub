import { toaster } from "$lib/client/utils/toaster"

/**
 * The client-side courtesy check every Instance card makes before a write.
 * The server's own handlers hold the real boundary; this only turns a doomed
 * click into a toast instead of a silent refusal.
 */
export function requireAdmin(user: { isAdmin?: boolean } | null | undefined) {
	if (user?.isAdmin) return true
	toaster.error({
		title: "Access denied",
		description: "Admin privileges required"
	})
	return false
}
