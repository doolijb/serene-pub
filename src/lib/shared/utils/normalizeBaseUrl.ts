/**
 * Strips trailing slashes from a connection base URL so callers can safely
 * concatenate a leading-slash path (`normalizeBaseUrl(url) + "/v1/chat/completions"`)
 * regardless of whether the user saved the URL with or without one — a saved
 * `http://host:1234/` and `http://host:1234` must behave identically, not
 * silently produce a double-slash request that some servers 404 on.
 *
 * Returns "" for null/undefined/empty input, so the common
 * `normalizeBaseUrl(connection.baseUrl) || "http://localhost:1234"` fallback
 * pattern still works.
 */
export function normalizeBaseUrl(url: string | null | undefined): string {
	if (!url) return ""
	return url.trim().replace(/\/+$/, "")
}
