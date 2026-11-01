/**
 * The package upload's wire contract (K6): Admin › Plugins sends a package
 * zip to the pub over plain HTTP, in pieces, and the server installs it from
 * disk. Pieces, not one body, because the server framework caps every request
 * body at `BODY_SIZE_LIMIT` (512K unless the operator raised it) and a package
 * may be hundreds of MB; each piece fits under that cap, so no setting has to
 * move for an upload to work, over LAN http or behind a proxy.
 *
 * Three requests, all to {@link PLUGIN_PACKAGE_UPLOAD_PATH}, each answered with
 * JSON — `{ error }` with a 4xx/5xx status when refused:
 * 1. **Start**: `POST` with no query, headers {@link PLUGIN_PACKAGE_FILENAME_HEADER}
 *    and {@link PLUGIN_PACKAGE_SIZE_HEADER}, empty body → {@link PackageUploadStart}.
 * 2. **Piece**: `PUT ?upload=<id>&offset=<bytes so far>`, body at most
 *    `pieceBytes` raw bytes → {@link PackageUploadPiece}.
 * 3. **Finish**: `POST ?upload=<id>`, empty body → the install's answer
 *    (`Sockets.Plugins.InstallLocal.Response`). The upload is gone afterwards,
 *    installed or refused.
 */

/** Where Admin › Plugins sends a package zip. */
export const PLUGIN_PACKAGE_UPLOAD_PATH = "/api/admin/plugins/package"

/** The chosen file's name, `encodeURIComponent`-encoded; for messages only. */
export const PLUGIN_PACKAGE_FILENAME_HEADER = "x-package-filename"

/** The whole file's size in bytes, sent on start so an oversize package is refused before any piece. */
export const PLUGIN_PACKAGE_SIZE_HEADER = "x-package-size"

/** The answer to a start: the upload's id and the most bytes one piece may carry. */
export interface PackageUploadStart {
	upload: string
	pieceBytes: number
}

/** The answer to a piece: the bytes the server holds for this upload so far. */
export interface PackageUploadPiece {
	received: number
}
