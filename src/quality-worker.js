import { analyzeFrame } from "./quality/analyzer.js";
import { DEFAULT_CONFIG } from "./quality/config.js";

self.addEventListener("message", (event) => {
  const message = event.data;
  if (!message || message.type !== "analyze") return;

  const { frame, config, template } = message;
  if (!frame || !frame.buffer) return;

  const data = new Uint8ClampedArray(frame.buffer);
  const report = analyzeFrame(
    { width: frame.width, height: frame.height, data, timestamp: frame.timestamp },
    { config: config ?? DEFAULT_CONFIG, template: template ?? null },
  );

  self.postMessage({ type: "report", report });
});

