import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const repoRoot = path.resolve(__dirname, "..");
const distDir = path.join(repoRoot, "dist");

async function safeRemove(target) {
  await fs.rm(target, { recursive: true, force: true });
}

async function copyDir(source, destination) {
  await fs.mkdir(destination, { recursive: true });
  await fs.cp(source, destination, { recursive: true });
}

async function main() {
  await safeRemove(distDir);
  await fs.mkdir(distDir, { recursive: true });

  const indexPath = path.join(repoRoot, "index.html");
  await fs.copyFile(indexPath, path.join(distDir, "index.html"));

  const assetsPath = path.join(repoRoot, "assets");
  await copyDir(assetsPath, path.join(distDir, "assets"));

  const srcPath = path.join(repoRoot, "src");
  await copyDir(srcPath, path.join(distDir, "src"));

  console.log("Built static site to dist/.");
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});

