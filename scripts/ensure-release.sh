#!/usr/bin/env bash
# scripts/ensure-release.sh <tag> — make sure the GitHub release for <tag> exists.
#
# release.yml, docker.yml and build-android.yml all attach to ONE release per
# tag, and any of them may get there first, so each calls this before
# uploading. A missing release is created as a DRAFT: title and pre-release flag
# from scripts/release-meta.mjs, body from docs/release-notes/<version>.md (links
# pointed at the tagged blob) or GitHub's generated notes when there is none.
# release.yml's last job publishes the draft once every desktop build is up;
# until then only collaborators can see it.
#
# Needs: gh, node, GH_TOKEN, GH_REPO (owner/repo). Never interpolate the tag
# into a workflow's run: body — pass it in through env and "$VAR".
set -euo pipefail

TAG="${1:?usage: scripts/ensure-release.sh <tag>}"
cd "$(dirname "$0")/.."

if gh release view "$TAG" > /dev/null 2>&1; then
	echo "release $TAG already exists"
	exit 0
fi

# GITHUB_OUTPUT is unset for these calls so they do not leak into the caller's step outputs.
META="$(env -u GITHUB_OUTPUT node scripts/release-meta.mjs classify "$TAG")"
TITLE="$(sed -n 's/^title=//p' <<< "$META")"
PRERELEASE="$(sed -n 's/^prerelease=//p' <<< "$META")"

NOTES="${RUNNER_TEMP:-${TMPDIR:-/tmp}}/release-notes-$$.md"
ARGS=(--draft --verify-tag --title "$TITLE")
if [ "$PRERELEASE" = "true" ]; then ARGS+=(--prerelease); fi
if [ "$(env -u GITHUB_OUTPUT node scripts/release-meta.mjs notes "$TAG" "$NOTES")" = "notes=docs" ]; then
	ARGS+=(--notes-file "$NOTES")
else
	ARGS+=(--generate-notes)
fi

if gh release create "$TAG" "${ARGS[@]}"; then
	echo "created draft release $TAG ($TITLE, pre-release: $PRERELEASE)"
else
	# Another workflow created it between our view and create: that one is ours too.
	sleep 5
	gh release view "$TAG" > /dev/null
	echo "release $TAG was created by another workflow"
fi
