# Security policy

## Supported versions

This project is currently pre-release. Security fixes are applied to the
latest code on the default branch; older commits and unofficial deployments
are not maintained as separate supported versions.

## Reporting a vulnerability

Please do not disclose a suspected vulnerability in a public issue,
discussion, or pull request.

Use GitHub's private vulnerability reporting flow from the repository's
**Security** tab and select **Report a vulnerability**. Repository owners
should enable **Private vulnerability reporting** before making the project
public.

If that form is unavailable, use a private contact method listed on the
repository owner's GitHub profile. If no private method is available, open a
minimal issue asking for a private security contact without including exploit
details, sensitive files, or personal information.

A useful report includes:

- A description of the issue and its potential impact
- Reproduction steps or a minimal proof of concept
- Affected browsers, operating systems, and versions
- Whether a malicious `.mockup`, image, video, or GLB is required
- Any suggested mitigation

Reports will be handled on a best-effort basis while the project is in alpha.
The maintainers will avoid publishing identifying details without the
reporter's permission and will coordinate disclosure after a fix is available.

## Relevant security boundaries

The application processes untrusted project archives, images, videos, and 3D
models in the browser. Particularly relevant reports include:

- Script injection or unsafe HTML generated from project-controlled values
- Path traversal, decompression bombs, or excessive allocation from `.mockup`
  archives
- Persistent exposure of user media outside the expected browser origin
- Prototype pollution or schema-confusion issues during project migration
- Browser or GPU denial of service beyond documented export-size limitations
- Dependency vulnerabilities reachable through normal application use

Unsupported codecs, expected browser feature differences, and crashes caused
only by intentionally extreme export settings are usually bugs rather than
security vulnerabilities, unless they cross a trust boundary or expose data.
