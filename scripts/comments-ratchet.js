#!/usr/bin/env node

import { writeFileSync } from "node:fs"
import { dirname, join, resolve } from "node:path"
import { fileURLToPath } from "node:url"
import { computeReport } from "../src/lib/shared/conformance/commentHistoryLib.js"

/**
 * Rewrites `commentHistory.ratchet.json` from the current tree. Run this
 * after fixing flagged comments, once their file's count has gone down, to
 * record the lower number — never run it to paper over a regression.
 */

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..")
const RATCHET_PATH = join(
	ROOT,
	"src/lib/shared/conformance/commentHistory.ratchet.json"
)

const { total, byFile } = computeReport(ROOT)
const sortedByFile = Object.fromEntries(
	Object.entries(byFile).sort(([a], [b]) => a.localeCompare(b))
)

writeFileSync(
	RATCHET_PATH,
	JSON.stringify({ total, byFile: sortedByFile }, null, "\t") + "\n"
)

console.log(
	`Wrote ${RATCHET_PATH}: total=${total} across ${Object.keys(byFile).length} file(s)`
)
