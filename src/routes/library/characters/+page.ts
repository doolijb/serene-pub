import { redirect } from "@sveltejs/kit"
import type { PageLoad } from "./$types"

/**
 * `/library/characters` was the character library's page before it became the
 * Library view, whose Focus address is `/library`; keep old links working.
 */
export const load: PageLoad = () => {
	redirect(308, "/library")
}
