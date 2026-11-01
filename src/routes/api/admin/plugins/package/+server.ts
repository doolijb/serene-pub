/**
 * Install a plugin package zip uploaded from Admin › Plugins, in pieces: `POST`
 * starts an upload (or, with `?upload=`, finishes it and installs), `PUT` adds
 * one piece. Pieces because the framework caps every request body at
 * `BODY_SIZE_LIMIT`. Admin-only; everything is in
 * `$lib/server/plugins/packageUpload.ts`.
 */
import type { RequestHandler } from "./$types"
import {
	handlePackagePiece,
	handlePackagePost
} from "$lib/server/plugins/packageUpload"

export const POST: RequestHandler = (event) => handlePackagePost(event)
export const PUT: RequestHandler = (event) => handlePackagePiece(event)
