# Real-Time KYC Document Quality Detection

A privacy-first browser prototype for validating identity document capture quality before submission. It detects blur, glare, framing/cropping, resolution, exposure, contrast, and skew while the user is capturing a document, then guides them toward a usable image.

## Run Locally

```bash
npm install
npm run dev
```

Open `http://127.0.0.1:4173`. Camera access requires a secure context; localhost is accepted by modern browsers. The upload path works everywhere and is used by automated tests.

## Verification

```bash
npm run test
npm run build
npm run smoke
```

The unit suite uses synthetic image fixtures, so no real KYC documents or personal data are required. The smoke test builds the app, verifies the denied-camera fallback, validates an uploaded sample document, captures the crop preview, and checks the mobile layout for horizontal overflow.

## Architecture

- `src/main.js` owns camera/upload state, canvas capture, UI rendering, local exports, and stability gating.
- `src/quality-worker.js` runs analysis off the main thread.
- `src/quality/analyzer.js` contains deterministic image-quality checks and report aggregation.
- `src/quality/config.js` centralizes thresholds and weights.
- `src/quality/stability.js` prevents submission from one transient good frame.

All document frames stay in the browser. The app performs no OCR, extracts no PII, sends no telemetry, and uploads no image data.

## Document Templates

Document template samples (for validity and side classification) live under `assets/templates/`.

- National ID templates: `assets/templates/national_id/`
- Expected files:
  - `assets/templates/national_id/front.jpg`
  - `assets/templates/national_id/back.jpg`
  - `assets/templates/national_id/template.json`

## Quality Checks

- **Blur:** Laplacian variance over grayscale luminance.
- **Glare:** bright, low-saturation pixel ratio plus largest connected hotspot.
- **Framing/cropping:** Sobel edge bounds, visible margins, fill coverage, and document aspect plausibility.
- **Resolution:** minimum effective analysis-frame dimensions.
- **Exposure:** luminance mean thresholds for under/overexposure.
- **Contrast:** luminance p95-p5 dynamic range.
- **Skew:** dominant edge angle folded into the document alignment range.

Reports use:

```js
FrameInput = { width, height, data, timestamp }
QualityReport = { status, score, checks, guidance, documentBounds, crop, capturedAt }
QualityCheck = { id, label, status, score, metric, threshold, message }
```

## Tuning Guide

Adjust thresholds in `src/quality/config.js`.

- Increase `blur.passVariance` if too many soft images pass.
- Lower `glare.failRatio` or `glare.failClusterRatio` if reflective IDs still pass.
- Increase `framing.passMargin` if operators want more background around the document.
- Relax `framing.minAspect` and `framing.maxAspect` for additional document shapes.
- Increase `stability.requiredPasses` for stricter live capture.

## Render Deployment

`render.yaml` defines a static site:

- Build command: `npm install && npm run build`
- Publish directory: `dist`

After pushing to GitHub, GitLab, or Bitbucket, create a Render Blueprint from the repository or create a static site manually with the same build settings.

## Demo Script

1. Start the app and click **Start camera**.
2. Move the document until the guide reports a clear, centered image.
3. Watch the quality checklist update for blur, glare, framing, exposure, contrast, resolution, and alignment.
4. Wait for the stable-frame gate to pass.
5. Capture the validated crop.
6. Export the local JSON quality report.
