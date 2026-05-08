import http from "node:http";
import fs from "node:fs/promises";
import path from "node:path";

const rootDir = path.resolve(process.argv[2] ?? ".");
const port = Number(process.argv[3] ?? 4173);

const mimeTypes = new Map([
  [".html", "text/html; charset=utf-8"],
  [".css", "text/css; charset=utf-8"],
  [".js", "text/javascript; charset=utf-8"],
  [".mjs", "text/javascript; charset=utf-8"],
  [".json", "application/json; charset=utf-8"],
  [".svg", "image/svg+xml"],
  [".png", "image/png"],
  [".jpg", "image/jpeg"],
  [".jpeg", "image/jpeg"],
  [".webp", "image/webp"],
  [".ico", "image/x-icon"],
]);

function sanitizePath(urlPath) {
  const decoded = decodeURIComponent(urlPath.split("?")[0]);
  const normalized = path.posix.normalize(decoded).replace(/^(\.\.(\/|\\|$))+/, "");
  return normalized === "/" ? "/index.html" : normalized;
}

async function readFileOrNull(targetPath) {
  try {
    return await fs.readFile(targetPath);
  } catch {
    return null;
  }
}

const server = http.createServer(async (req, res) => {
  const safePath = sanitizePath(req.url ?? "/");
  const filePath = path.join(rootDir, safePath);

  let file = await readFileOrNull(filePath);
  let statusCode = 200;

  if (!file && !safePath.endsWith(".html")) {
    file = await readFileOrNull(path.join(rootDir, "index.html"));
    statusCode = file ? 200 : 404;
  }

  if (!file) {
    res.writeHead(404, { "content-type": "text/plain; charset=utf-8" });
    res.end("Not found");
    return;
  }

  const contentType = mimeTypes.get(path.extname(filePath)) ?? "application/octet-stream";
  res.writeHead(statusCode, {
    "content-type": contentType,
    "cache-control": "no-store",
  });
  res.end(file);
});

server.listen(port, "127.0.0.1", () => {
  console.log(`Serving ${rootDir} on http://127.0.0.1:${port}`);
});

