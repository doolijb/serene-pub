import { error } from "@sveltejs/kit"
import type { PageLoad } from "./$types"

/**
 * The layout spike is a development-only page (plan P0): it proves the drag
 * gestures on hard-coded zones and ships nothing. Gated in `load` rather than
 * by leaving the route out of the build, so a build that somehow carries it
 * still answers 404 instead of exposing an editor that writes nowhere.
 */
export const load: PageLoad = () => {
	if (!import.meta.env.DEV) error(404, "There is no page here.")
	return {}
}
