const http = require("http");
const fs = require("fs");
const fsp = require("fs/promises");
const path = require("path");
const { URL } = require("url");

const HOST = "0.0.0.0";
const PORT = Number(process.env.PORT || 4173);
const ROOT = __dirname;
const STORAGE_DIR = path.join(ROOT, "data", "storage");
const STORAGE_FILE = path.join(STORAGE_DIR, "workspaces.json");

const MIME_TYPES = {
  ".css": "text/css; charset=utf-8",
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".svg": "image/svg+xml; charset=utf-8",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".ico": "image/x-icon"
};

const server = http.createServer(async (req, res) => {
  try {
    const requestUrl = new URL(req.url, `http://${req.headers.host}`);

    if (requestUrl.pathname.startsWith("/api/workspaces/")) {
      await handleWorkspaceRequest(req, res, requestUrl);
      return;
    }

    await serveStatic(req, res, requestUrl);
  } catch (error) {
    sendJson(res, 500, {
      error: "server_error",
      message: error.message
    });
  }
});

server.listen(PORT, HOST, () => {
  console.log(`Buildr2 server running at http://localhost:${PORT}`);
});

async function handleWorkspaceRequest(req, res, requestUrl) {
  const profileId = decodeURIComponent(requestUrl.pathname.replace("/api/workspaces/", "")).trim();
  if (!profileId) {
    sendJson(res, 400, {
      error: "invalid_profile",
      message: "Profile id is required."
    });
    return;
  }

  if (req.method === "GET") {
    const db = await readDatabase();
    sendJson(res, 200, db.workspaces[profileId] ?? emptyWorkspace());
    return;
  }

  if (req.method === "PUT") {
    const payload = await readJsonBody(req);
    const db = await readDatabase();
    db.workspaces[profileId] = {
      droids: Array.isArray(payload.droids) ? payload.droids : [],
      activeDroidId: payload.activeDroidId ?? null,
      activeSectionId: payload.activeSectionId ?? null,
      updatedAt: new Date().toISOString()
    };

    await writeDatabase(db);
    sendJson(res, 200, {
      ok: true
    });
    return;
  }

  sendJson(res, 405, {
    error: "method_not_allowed",
    message: "Use GET or PUT."
  });
}

async function serveStatic(req, res, requestUrl) {
  if (req.method !== "GET" && req.method !== "HEAD") {
    sendJson(res, 405, {
      error: "method_not_allowed",
      message: "Only GET and HEAD are supported for static files."
    });
    return;
  }

  let pathname = requestUrl.pathname;
  if (pathname === "/") {
    pathname = "/index.html";
  }

  const filePath = path.normalize(path.join(ROOT, pathname));
  if (!filePath.startsWith(ROOT)) {
    res.writeHead(403);
    res.end("Forbidden");
    return;
  }

  let stat;
  try {
    stat = await fsp.stat(filePath);
  } catch {
    res.writeHead(404);
    res.end("Not found");
    return;
  }

  if (stat.isDirectory()) {
    res.writeHead(404);
    res.end("Not found");
    return;
  }

  const ext = path.extname(filePath).toLowerCase();
  const contentType = MIME_TYPES[ext] ?? "application/octet-stream";
  res.writeHead(200, {
    "Content-Type": contentType,
    "Content-Length": stat.size
  });

  if (req.method === "HEAD") {
    res.end();
    return;
  }

  fs.createReadStream(filePath).pipe(res);
}

async function readDatabase() {
  await fsp.mkdir(STORAGE_DIR, {
    recursive: true
  });

  try {
    const raw = await fsp.readFile(STORAGE_FILE, "utf8");
    return JSON.parse(raw);
  } catch (error) {
    if (error.code !== "ENOENT") {
      throw error;
    }

    const initial = {
      workspaces: {}
    };
    await writeDatabase(initial);
    return initial;
  }
}

async function writeDatabase(db) {
  await fsp.mkdir(STORAGE_DIR, {
    recursive: true
  });

  await fsp.writeFile(STORAGE_FILE, JSON.stringify(db, null, 2));
}

function emptyWorkspace() {
  return {
    droids: [],
    activeDroidId: null,
    activeSectionId: null
  };
}

function sendJson(res, statusCode, payload) {
  const body = JSON.stringify(payload);
  res.writeHead(statusCode, {
    "Content-Type": "application/json; charset=utf-8",
    "Content-Length": Buffer.byteLength(body)
  });
  res.end(body);
}

async function readJsonBody(req) {
  const chunks = [];
  for await (const chunk of req) {
    chunks.push(chunk);
  }

  if (!chunks.length) {
    return {};
  }

  return JSON.parse(Buffer.concat(chunks).toString("utf8"));
}
