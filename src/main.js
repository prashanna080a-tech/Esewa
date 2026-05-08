import { DEFAULT_CONFIG } from "./quality/config.js";
import { createStabilityGate } from "./quality/stability.js";

const elements = {
  startCamera: document.getElementById("start-camera"),
  stopCamera: document.getElementById("stop-camera"),
  fileInput: document.getElementById("file-input"),
  video: document.getElementById("video"),
  uploadPreview: document.getElementById("upload-preview"),
  overlay: document.getElementById("overlay"),
  analysisCanvas: document.getElementById("analysis-canvas"),
  captureCanvas: document.getElementById("capture-canvas"),
  stage: document.getElementById("stage"),
  emptyState: document.getElementById("empty-state"),
  captureButton: document.getElementById("capture-button"),
  captureState: document.getElementById("capture-state"),
  statusPill: document.getElementById("status-pill"),
  scoreValue: document.getElementById("score-value"),
  guidance: document.getElementById("guidance"),
  checksList: document.getElementById("checks-list"),
  previewCanvas: document.getElementById("preview-canvas"),
  previewEmpty: document.getElementById("preview-empty"),
  downloadImage: document.getElementById("download-image"),
  exportReport: document.getElementById("export-report"),
};

const worker = new Worker(new URL("./quality-worker.js", import.meta.url), { type: "module" });
const stabilityGate = createStabilityGate(DEFAULT_CONFIG.stability);

let stream = null;
let analysisTimer = null;
let lastReport = null;
let lastFrame = null;
let sourceMode = "idle"; // idle | camera | upload
let lastUploadUrl = null;

function setCaptureEnabled(enabled) {
  elements.captureButton.disabled = !enabled;
}

function setExportEnabled(enabled) {
  elements.downloadImage.disabled = !enabled;
  elements.exportReport.disabled = !enabled;
}

function setStatus(status) {
  elements.statusPill.className = `status-pill ${status}`;
  elements.statusPill.textContent = status === "idle" ? "Idle" : status;
}

function scoreToRing(score) {
  if (score == null || Number.isNaN(score)) return "--";
  return String(Math.round(score * 100));
}

function renderChecks(checks) {
  elements.checksList.innerHTML = "";
  for (const check of checks) {
    const item = document.createElement("li");
    item.className = `check-item ${check.status}`;

    const details = document.createElement("div");
    const title = document.createElement("strong");
    title.textContent = check.label;
    const message = document.createElement("span");
    message.textContent = check.message;
    details.append(title, message);

    const tag = document.createElement("div");
    tag.className = "check-tag";
    tag.textContent = check.status;

    item.append(details, tag);
    elements.checksList.append(item);
  }
}

function drawOverlay(report) {
  const canvas = elements.overlay;
  const rect = elements.stage.getBoundingClientRect();
  canvas.width = Math.round(rect.width * devicePixelRatio);
  canvas.height = Math.round(rect.height * devicePixelRatio);
  const context = canvas.getContext("2d");
  context.clearRect(0, 0, canvas.width, canvas.height);

  if (!report?.crop || !lastFrame) return;

  const sx = report.crop.x / lastFrame.width;
  const sy = report.crop.y / lastFrame.height;
  const sw = report.crop.width / lastFrame.width;
  const sh = report.crop.height / lastFrame.height;
  const x = sx * canvas.width;
  const y = sy * canvas.height;
  const w = sw * canvas.width;
  const h = sh * canvas.height;

  context.save();
  context.lineWidth = Math.max(2, 3 * devicePixelRatio);
  context.strokeStyle = report.status === "pass" ? "rgba(33,212,154,0.95)" : "rgba(255,176,32,0.9)";
  context.shadowColor = "rgba(109,141,255,0.45)";
  context.shadowBlur = 12 * devicePixelRatio;
  context.strokeRect(x, y, w, h);
  context.restore();
}

function stopAnalysisLoop() {
  if (analysisTimer) {
    clearInterval(analysisTimer);
    analysisTimer = null;
  }
}

function startAnalysisLoop() {
  stopAnalysisLoop();
  const intervalMs = Math.max(90, Math.round(1000 / DEFAULT_CONFIG.analysis.fps));
  analysisTimer = setInterval(captureAndAnalyze, intervalMs);
}

function updateCaptureState(report, stableState) {
  if (sourceMode === "camera") {
    if (!report) {
      elements.captureState.textContent = "Waiting for a clear document.";
      setCaptureEnabled(false);
      return;
    }

    if (report.status !== "pass") {
      elements.captureState.textContent = "Fix the highlighted issue to enable capture.";
      setCaptureEnabled(false);
      return;
    }

    if (!stableState.isSatisfied) {
      elements.captureState.textContent = `Hold steady (${stableState.passCount}/${DEFAULT_CONFIG.stability.requiredPasses}).`;
      setCaptureEnabled(false);
      return;
    }

    elements.captureState.textContent = "Stable frame captured. Tap capture.";
    setCaptureEnabled(true);
    return;
  }

  if (sourceMode === "upload") {
    if (!report) {
      elements.captureState.textContent = "Upload an image to validate quality.";
      setCaptureEnabled(false);
      return;
    }

    if (report.status === "fail") {
      elements.captureState.textContent = "Upload a clearer image to continue.";
      setCaptureEnabled(false);
      return;
    }

    elements.captureState.textContent = "Validated upload ready. Tap capture.";
    setCaptureEnabled(true);
    return;
  }

  elements.captureState.textContent = "Start camera or upload an image.";
  setCaptureEnabled(false);
}

function showPreviewCanvas(show) {
  elements.previewCanvas.style.display = show ? "block" : "none";
  elements.previewEmpty.style.display = show ? "none" : "block";
}

function showUploadPreview(show) {
  elements.uploadPreview.style.display = show ? "block" : "none";
  elements.video.style.display = show ? "none" : "block";
}

function showEmptyState(show) {
  elements.emptyState.style.display = show ? "grid" : "none";
}

async function startCamera() {
  stopCamera();
  sourceMode = "camera";
  stabilityGate.reset();
  setExportEnabled(false);
  showPreviewCanvas(false);
  showUploadPreview(false);

  try {
    stream = await navigator.mediaDevices.getUserMedia({
      video: { facingMode: "environment" },
      audio: false,
    });
  } catch (error) {
    sourceMode = "idle";
    setStatus("idle");
    elements.guidance.textContent = "Camera permission denied. Upload an image instead.";
    showEmptyState(true);
    return;
  }

  elements.video.srcObject = stream;
  await elements.video.play();
  elements.startCamera.disabled = true;
  elements.stopCamera.disabled = false;
  showEmptyState(false);
  startAnalysisLoop();
}

function stopCamera() {
  stopAnalysisLoop();
  lastReport = null;
  lastFrame = null;
  if (lastUploadUrl) {
    URL.revokeObjectURL(lastUploadUrl);
    lastUploadUrl = null;
  }
  elements.uploadPreview.src = "";
  setCaptureEnabled(false);
  setExportEnabled(false);
  setStatus("idle");
  elements.scoreValue.textContent = "--";
  elements.guidance.textContent = "Start camera or upload an image.";
  elements.checksList.innerHTML = "";
  drawOverlay(null);
  showPreviewCanvas(false);
  showEmptyState(true);

  if (stream) {
    for (const track of stream.getTracks()) track.stop();
  }

  stream = null;
  elements.video.srcObject = null;
  elements.startCamera.disabled = false;
  elements.stopCamera.disabled = true;
  sourceMode = "idle";
}

function createAnalysisFrameFromVideo() {
  const video = elements.video;
  const width = video.videoWidth;
  const height = video.videoHeight;
  if (!width || !height) return null;

  let targetWidth = width;
  let targetHeight = height;
  const scale = Math.min(DEFAULT_CONFIG.analysis.maxWidth / width, DEFAULT_CONFIG.analysis.maxHeight / height, 1);
  targetWidth = Math.round(width * scale);
  targetHeight = Math.round(height * scale);

  const canvas = elements.analysisCanvas;
  canvas.width = targetWidth;
  canvas.height = targetHeight;
  const context = canvas.getContext("2d", { willReadFrequently: true });
  context.drawImage(video, 0, 0, targetWidth, targetHeight);
  const imageData = context.getImageData(0, 0, targetWidth, targetHeight);
  return {
    width: targetWidth,
    height: targetHeight,
    buffer: imageData.data.buffer,
    timestamp: Date.now(),
  };
}

function createAnalysisFrameFromImage(image) {
  const width = image.naturalWidth;
  const height = image.naturalHeight;
  if (!width || !height) return null;

  let targetWidth = width;
  let targetHeight = height;
  const scale = Math.min(DEFAULT_CONFIG.analysis.maxWidth / width, DEFAULT_CONFIG.analysis.maxHeight / height, 1);
  targetWidth = Math.round(width * scale);
  targetHeight = Math.round(height * scale);

  const canvas = elements.analysisCanvas;
  canvas.width = targetWidth;
  canvas.height = targetHeight;
  const context = canvas.getContext("2d", { willReadFrequently: true });
  context.drawImage(image, 0, 0, targetWidth, targetHeight);
  const imageData = context.getImageData(0, 0, targetWidth, targetHeight);
  return {
    width: targetWidth,
    height: targetHeight,
    buffer: imageData.data.buffer,
    timestamp: Date.now(),
  };
}

function captureAndAnalyze() {
  if (sourceMode !== "camera") return;
  if (!elements.video.videoWidth || !elements.video.videoHeight) return;

  const frame = createAnalysisFrameFromVideo();
  if (!frame) return;
  lastFrame = frame;

  worker.postMessage(
    { type: "analyze", frame, config: DEFAULT_CONFIG },
    [frame.buffer],
  );
}

function updateUIFromReport(report) {
  lastReport = report;
  setStatus(report.status);
  elements.scoreValue.textContent = scoreToRing(report.score);
  elements.guidance.textContent = report.guidance;
  renderChecks(report.checks);
  drawOverlay(report);

  const stableState = sourceMode === "camera" ? stabilityGate.observe(report) : { passCount: 0, isSatisfied: true };
  updateCaptureState(report, stableState);
}

function captureValidatedCrop() {
  if (!lastReport || !lastReport.crop) return;

  const preview = elements.previewCanvas;
  const context = preview.getContext("2d");
  const crop = lastReport.crop;

  if (sourceMode === "camera") {
    const analysisCanvas = elements.analysisCanvas;
    preview.width = crop.width;
    preview.height = crop.height;
    context.drawImage(
      analysisCanvas,
      crop.x,
      crop.y,
      crop.width,
      crop.height,
      0,
      0,
      crop.width,
      crop.height,
    );
  } else if (sourceMode === "upload") {
    const capture = elements.captureCanvas;
    preview.width = crop.width;
    preview.height = crop.height;
    context.drawImage(capture, crop.x, crop.y, crop.width, crop.height, 0, 0, crop.width, crop.height);
  }

  showPreviewCanvas(true);
  setExportEnabled(true);
}

function downloadPreviewImage() {
  const canvas = elements.previewCanvas;
  canvas.toBlob((blob) => {
    if (!blob) return;
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = "kyc-crop.png";
    link.click();
    setTimeout(() => URL.revokeObjectURL(url), 5000);
  }, "image/png");
}

function exportReport() {
  if (!lastReport) return;
  const payload = JSON.stringify(lastReport, null, 2);
  const blob = new Blob([payload], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = "quality-report.json";
  link.click();
  setTimeout(() => URL.revokeObjectURL(url), 5000);
}

async function handleUpload(file) {
  if (!file) return;

  stopCamera();
  sourceMode = "upload";
  stabilityGate.reset();
  setExportEnabled(false);
  showPreviewCanvas(false);

  if (lastUploadUrl) URL.revokeObjectURL(lastUploadUrl);
  const url = URL.createObjectURL(file);
  lastUploadUrl = url;
  const image = new Image();
  image.decoding = "async";
  image.src = url;
  await image.decode().catch(() => null);

  elements.uploadPreview.src = url;
  showUploadPreview(true);
  showEmptyState(false);

  const frame = createAnalysisFrameFromImage(image);
  if (!frame) return;
  lastFrame = frame;

  const captureCanvas = elements.captureCanvas;
  captureCanvas.width = frame.width;
  captureCanvas.height = frame.height;
  captureCanvas.getContext("2d").drawImage(image, 0, 0, frame.width, frame.height);

  worker.postMessage(
    { type: "analyze", frame, config: DEFAULT_CONFIG },
    [frame.buffer],
  );
}

worker.addEventListener("message", (event) => {
  const message = event.data;
  if (!message || message.type !== "report") return;
  updateUIFromReport(message.report);
});

elements.startCamera.addEventListener("click", startCamera);
elements.stopCamera.addEventListener("click", stopCamera);
elements.captureButton.addEventListener("click", captureValidatedCrop);
elements.downloadImage.addEventListener("click", downloadPreviewImage);
elements.exportReport.addEventListener("click", exportReport);
elements.fileInput.addEventListener("change", (event) => handleUpload(event.target.files?.[0]));

setStatus("idle");
setCaptureEnabled(false);
setExportEnabled(false);
showPreviewCanvas(false);
