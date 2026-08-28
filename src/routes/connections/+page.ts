import { redirect } from "@sveltejs/kit"

/** Re-homed under the administration shell. */
export const load = () => {
	redirect(301, "/admin/connections")
}
