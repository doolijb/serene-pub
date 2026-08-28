import { redirect } from "@sveltejs/kit"

/** The admin index is Settings — there is no dashboard page yet. */
export const load = () => {
	redirect(307, "/admin/settings")
}
