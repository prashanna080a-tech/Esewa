import { chromium } from "playwright";
import { spawn } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const repoRoot = path.resolve(__dirname, "..");

function wait(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function waitForServer(url, timeoutMs = 8000) {
  const startedAt = Date.now();
  while (Date.now() - startedAt < timeoutMs) {
    try {
      const response = await fetch(url, { cache: "no-store" });
      if (response.ok) return;
    } catch {
      // ignore
    }
    await wait(150);
  }
  throw new Error(`Server did not respond at ${url}`);
}

async function ensureChromiumInstalled(error) {
  const message = String(error?.message ?? "");
  if (!message.includes("Executable doesn't exist") && !message.includes("playwright install")) return false;

  console.log("Playwright browser missing; installing Chromium...");
  await new Promise((resolve, reject) => {
    const installer = spawn(
      process.platform === "win32" ? "npx.cmd" : "npx",
      ["playwright", "install", "chromium"],
      { cwd: repoRoot, stdio: "inherit" },
    );
    installer.on("error", reject);
    installer.on("exit", (code) => (code === 0 ? resolve() : reject(new Error(`playwright install exited ${code}`))));
  });
  return true;
}

async function main() {
  const server = spawn(process.execPath, [path.join(repoRoot, "scripts/serve.mjs"), "dist", "4173"], {
    cwd: repoRoot,
    stdio: "inherit",
  });

  const baseUrl = "http://127.0.0.1:4173";
  try {
    await waitForServer(baseUrl);

    let browser;
    try {
      browser = await chromium.launch();
    } catch (error) {
      const installed = await ensureChromiumInstalled(error);
      if (!installed) throw error;
      browser = await chromium.launch();
    }
    const page = await browser.newPage({ viewport: { width: 375, height: 720 } });
    await page.goto(baseUrl, { waitUntil: "networkidle" });

    await page.waitForSelector("[data-testid=app]");

    const samplePath = path.join(repoRoot, "assets/sample-document.svg");
    await page.setInputFiles("[data-testid=file-input]", samplePath);

    await page.waitForSelector("[data-testid=status-pill].pass, [data-testid=status-pill].warn, [data-testid=status-pill].fail");
    await page.waitForSelector("[data-testid=capture-button]:not([disabled])");
    await page.click("[data-testid=capture-button]");

    await page.waitForSelector("[data-testid=preview-canvas]");
    const previewSize = await page.evaluate(() => {
      const canvas = document.querySelector("[data-testid=preview-canvas]");
      return { width: canvas.width, height: canvas.height };
    });
    if (!previewSize.width || !previewSize.height) {
      throw new Error("Preview canvas was not populated.");
    }

    const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
    if (overflow > 1) {
      throw new Error(`Mobile layout has horizontal overflow (${overflow}px).`);
    }

    await browser.close();
    console.log("Smoke test passed.");
  } finally {
    server.kill("SIGTERM");
  }
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
