# `@serene-pub/conformance`

Fifteen executable requirements a Serene Pub executor must satisfy. Run by SP Core against
its own implementation, and by any alternate host.

**Plugin authors do not need this package.** It answers "does this host obey the laws?" —
for "does my hook behave, and did my change alter what gets sent?", use
`@serene-pub/sdk/testing`.

Each requirement names what breaks when it fails, in user-visible terms, so a red result is
a bug report rather than a number.
