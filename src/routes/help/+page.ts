import { redirect } from "@sveltejs/kit"
import type { PageLoad } from "./$types"

/** `/help` was the Help view's address before it took `/docs`; keep old links working. */
export const load: PageLoad = () => {
	redirect(308, "/docs")
}
