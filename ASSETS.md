# Asset policy and inventory

The source code and distributable assets in this repository are licensed
separately. A code license does not grant permission to redistribute device
models, textures, logos, screenshots, or other media.

Only assets marked **Approved** below should be included in a public release.
An **Unverified** status is an audit finding, not an instruction to remove the
asset from the working application. Resolve those entries before publishing.

## Public-release inventory

| Asset | Status | Source / author | License | Notes |
|---|---|---|---|---|
| Procedural phone (`src/scene/Device.tsx`) | Approved | Project source code | Project code license | Generated entirely from Three.js geometry; the public default device. |
| `public/favicon.svg` | Approved | Project source code | Project code license | Original device-and-play-mark icon created for this project. |
| `docs/assets/device-*.mp4` and `docs/assets/device-*.jpg` | Approved | Project maintainer | Project code license | Example exports and derived poster frames supplied for the project documentation. |

## Device model inventory

Three models were matched to their original Sketchfab records using download
metadata preserved by macOS, embedded authorship, and exact mesh/material
counts. Their required attribution is in `THIRD_PARTY_NOTICES.md`.

| Device asset | Source / author | License | SHA-256 of optimized GLB | Status |
|---|---|---|---|---|
| iPhone 17 Pro | [Iphone 17 pro](https://sketchfab.com/3d-models/iphone-17-pro-4aeeeb41f9d14f96bb3f2589edc3edac) by Ibrahim.Bhl | [CC BY 4.0](https://creativecommons.org/licenses/by/4.0/) | `d7089ce39b8e09fe857ab41bc9105e39beb72171bbd8b7e81008afb7e0ad0c4c` | Approved with attribution |
| iPhone 17 Pro Max | [Phone 17 Pro Max](https://sketchfab.com/3d-models/phone-17-pro-max-66809964eff043a39d553c3795995008) by Ranguel | [CC BY 4.0](https://creativecommons.org/licenses/by/4.0/) | `cc32d7479d48f93b320a36cb70fd8354b4f6eb3f939304f65b54f9803a557d17` | Approved with attribution |
| Google Pixel 9 Pro XL | [Google Pixel 9 Pro XL](https://www.blendkit.com/asset-gallery-detail/511e7e71-de38-4d6e-99da-9b34cc4dd738/) by Fiq KM | [Blendkit Royalty Free](https://www.blendkit.com/docs/licenses/), plus creator permission | `f885feb957a3f86e4836af7c7d3100b769cf21a150f4b32f521076b229109684` | Approved for optimized GLB redistribution |
| Samsung Galaxy S26 Ultra | [Samsung S26 Ultra](https://sketchfab.com/3d-models/samsung-s26-ultra-7ff228963ea446f39f46a5541f71e352) by Sagar Modi | [CC BY 4.0](https://creativecommons.org/licenses/by/4.0/) | `6355b5b819b89a2d77b52c9e2802d6e89098f5bfb98b3fbb0948fa92c81a07a0` | Approved with attribution |

### Pixel redistribution note

The original `google_pixel_9xl.glb` was obtained through Google Drive and
matched to the Blendkit listing above. The project maintainer obtained the
creator's permission to redistribute the optimized runtime GLB included in
this repository. The original source file remains local-only and is excluded
from Git.

Brand names identify the local files only; their owners do not sponsor or
endorse this project. Permission to use a product name does not imply
permission to redistribute a third-party 3D model of that product.

## Approval requirements

Before adding an asset to a public release, record all of the following:

1. A stable source URL or an authorship statement from the contributor.
2. The exact asset license and a local copy if the license requires one.
3. Confirmation that modification and redistribution are permitted.
4. Required attribution and notices.
5. The SHA-256 checksum of the distributed file.

If any item is unknown, keep the asset local-only. Prefer original generic
models or assets licensed under CC0, CC BY, or another license whose
redistribution terms are compatible with the project.
