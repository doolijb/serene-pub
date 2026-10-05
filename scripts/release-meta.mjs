#!/usr/bin/env node
// scripts/release-meta.mjs — what a release tag means, for every release workflow.
//
//   node scripts/release-meta.mjs classify <tag>
//       version, base_version, title, prerelease, make_latest, channel, run_tests
//       as key=value lines on stdout, and appended to $GITHUB_OUTPUT when set.
//   node scripts/release-meta.mjs notes <tag> <out-file>
//       The GitHub release body: docs/release-notes/<version>.md with its
//       relative links pointed at the tagged blob, written to <out-file>.
//       Prints notes=docs, or notes=generated (and writes nothing) when the
//       version has no notes file.
//
// One rule for release.yml, docker.yml and build-android.yml, matching the SDK's
// publish.yml: a plain vX.Y.Z is a release; ANY suffix (-pr-N, -rc-N, -alpha,
// -beta, -dev, or a tag that is not a version at all) is a pre-release, which
// never becomes the repository's "Latest" release, never gets the Docker
// `latest` tag, and gets a launcher built with channel=prerelease (it never
// applies an update). Node built-ins only: it runs before `npm install`.
import fs from "node:fs"
import path from "node:path"
import { fileURLToPath } from "node:url"

const appRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..")

/** @param {string} tag */
export function classify(tag) {
	const version = tag.replace(/^v/, "")
	const m = /^(\d+\.\d+\.\d+)(?:-(.+))?$/.exec(version)
	const base = m ? m[1] : ""
	const suffix = m ? (m[2] ?? "") : null
	const prerelease = suffix !== ""
	let title = version
	let runTests = true
	if (suffix === "") title = `${base} Release`
	else if (suffix === "dev") {
		title = `${base} Development Release`
		runTests = false
	} else if (suffix === "beta") title = `${base} Beta Release`
	else if (suffix && /^pr-\d+$/.test(suffix)) {
		title = `${base} Pre-Release Build ${suffix.slice(3)}`
		// Owner 2026-10-05: tests are not required for a -pr-N build; the
		// test job is skipped and the builds do not wait on it.
		runTests = false
	}
	else if (suffix && /^rc-\d+$/.test(suffix))
		title = `${base} Release Candidate ${suffix.slice(3)}`
	// Anything else (an -alpha, a typo, not a version at all) keeps the bare
	// tag as its title and skips the test run, as before: unrecognised tags
	// fail closed into a pre-release.
	else runTests = false
	return {
		version,
		base_version: base,
		title,
		prerelease: String(prerelease),
		make_latest: String(!prerelease),
		channel: prerelease ? "prerelease" : "portable",
		run_tests: String(runTests)
	}
}

/**
 * The release body for `tag`, or null when docs/release-notes/<version>.md
 * does not exist. Relative links resolve against the notes file and become
 * links to that path at the tag, so the body reads the docs as they shipped.
 *
 * @param {string} tag
 * @param {{ server?: string, repo?: string }} [where]
 */
export function releaseBody(tag, where = {}) {
	const version = tag.replace(/^v/, "")
	const rel = `docs/release-notes/${version}.md`
	const file = path.join(appRoot, rel)
	if (!fs.existsSync(file)) return null
	const server =
		where.server || process.env.GITHUB_SERVER_URL || "https://github.com"
	const repo =
		where.repo || process.env.GITHUB_REPOSITORY || "doolijb/serene-pub"
	const blob = `${server}/${repo}/blob/${tag}/`
	return fs
		.readFileSync(file, "utf8")
		.replace(/\]\(([^)\s]+)\)/g, (whole, target) => {
			if (/^([a-z][a-z0-9+.-]*:|#|\/)/i.test(target)) return whole
			return `](${blob}${path.posix.join(path.posix.dirname(rel), target)})`
		})
}

function output(pairs) {
	const lines = Object.entries(pairs).map(([k, v]) => `${k}=${v}`)
	console.log(lines.join("\n"))
	if (process.env.GITHUB_OUTPUT)
		fs.appendFileSync(process.env.GITHUB_OUTPUT, lines.join("\n") + "\n")
}

const isMain =
	process.argv[1] &&
	path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)
if (isMain) {
	const [cmd, tag, out] = process.argv.slice(2)
	if (cmd === "classify" && tag) output(classify(tag))
	else if (cmd === "notes" && tag && out) {
		const body = releaseBody(tag)
		if (body === null) output({ notes: "generated" })
		else {
			fs.mkdirSync(path.dirname(path.resolve(out)), { recursive: true })
			fs.writeFileSync(out, body)
			output({ notes: "docs" })
		}
	} else {
		console.error(
			"usage: node scripts/release-meta.mjs classify <tag> | notes <tag> <out-file>"
		)
		process.exit(1)
	}
}
