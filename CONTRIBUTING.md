# Contributing

Thank you for helping improve 3D Device Mockup Studio. Bug fixes, tests,
documentation, accessibility improvements, device integrations, and focused
feature proposals are welcome.

By participating, you agree to follow the [Code of Conduct](CODE_OF_CONDUCT.md).

## Development setup

Node.js 22 and npm are recommended.

```bash
npm ci
npm run dev
```

Before opening a pull request, run the same checks as CI:

```bash
npm test
npm run build
npm run lint
```

Lint warnings that already exist do not block a contribution, but new warnings
should not be introduced.

## Start with an issue when appropriate

Small fixes can go directly to a pull request. Open an issue before investing
in a large feature, data-format change, dependency replacement, or UI redesign
so the scope and tradeoffs can be discussed first.

When reporting a bug, include:

- Browser and operating-system versions
- GPU information when the problem is rendering-related
- Exact reproduction steps
- Expected and actual behavior
- A minimal `.mockup` project when it can be shared safely
- Console output or a short recording when useful

Do not attach private screenshots, recordings, project files, or licensed
models unless you have permission to share them publicly.

## Architecture guardrails

Several constraints are central to reliable, frame-accurate export:

1. Scene state must be a pure function of the project and timeline time.
   Animation must not accumulate frame deltas or depend on wall-clock time.
2. Preview and export must consume the same `sampleTimeline` output and shared
   Three.js scene. Avoid export-only animation or material behavior.
3. Project documents must remain JSON-serializable. Do not place Three.js
   objects, functions, DOM objects, or live media elements in the schema.
4. Device-specific behavior belongs in manifests and measured metadata rather
   than conditional branches spread through the renderer.
5. Per-axis Euler rotation is intentional. Replacing it with quaternion slerp
   breaks multi-turn animations such as a 720-degree spin.
6. Browser codec support must be feature-detected. PNG sequence export remains
   the guaranteed fallback.

Read [CONTEXT.md](CONTEXT.md) before changing the renderer, device loading,
screen mapping, timeline, or export pipeline. It records measured failure modes
that are easy to reintroduce.

## Adding or changing a device

Every device contribution must include:

- A manifest entry with measured body and screen dimensions
- Correct screen material identification and orientation
- A source URL, creator, license, and required attribution
- A SHA-256 checksum for the distributed GLB
- Confirmation that modification and raw redistribution are permitted
- Tests for manifest integrity, screen mapping, and ground-plane clearance

Record provenance in [ASSETS.md](ASSETS.md) and attribution in
[THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md). Do not submit an asset copied
from a marketplace, manufacturer, or another project without a compatible
license or written permission.

Use the existing measurement script when preparing a GLB:

```bash
node scripts/measure-device.mjs path/to/device.glb
```

## Pull requests

Keep pull requests focused and explain the user-visible outcome. Include:

- Why the change is needed
- Important implementation or compatibility decisions
- Tests added or updated
- Before/after images or recordings for visual changes
- Browser checks performed for media or export changes
- Any effect on project-file compatibility or asset licensing

Avoid unrelated formatting or dependency updates in the same pull request.
Generated build output and local research caches should not be committed.

## Licensing contributions

Source-code contributions are submitted under the repository's
[Apache License 2.0](LICENSE). Third-party assets retain their own licenses and
must satisfy the separate provenance requirements above.
