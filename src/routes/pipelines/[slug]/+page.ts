import { redirect } from "@sveltejs/kit"

/** Re-homed under the administration shell. */
export const load = ({ params }: { params: { slug: string } }) => {
	redirect(301, `/admin/pipelines/${encodeURIComponent(params.slug)}`)
}
