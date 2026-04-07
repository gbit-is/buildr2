const http = require("http");
const fs = require("fs");
const fsp = require("fs/promises");
const path = require("path");
const https = require("https");
const crypto = require("crypto");
const { URL } = require("url");

loadEnvFile(path.join(__dirname, ".env"));

const HOST = "0.0.0.0";
const PORT = Number(process.env.PORT || 4173);
const ROOT = __dirname;
const STORAGE_DIR = path.join(ROOT, "data", "storage");
const STORAGE_FILE = path.join(STORAGE_DIR, "workspaces.json");
const DROID_TYPES_DIR = path.join(ROOT, "data", "droid-types");
const DROID_TYPES_INDEX_FILE = path.join(DROID_TYPES_DIR, "index.json");
const GOOGLE_CLIENT_ID = process.env.GOOGLE_CLIENT_ID || "";
const ADMIN_USERS = new Set(
  String(process.env.ADMIN_USERS || "")
    .split(",")
    .map((value) => value.trim().toLowerCase())
    .filter(Boolean)
);
const ADMIN_GOOGLE_CLIENT_ID = process.env.ADMIN_GOOGLE_CLIENT_ID || GOOGLE_CLIENT_ID;
const ADMIN_SESSION_COOKIE = "buildr2_admin_session";
const ADMIN_ENABLED = ADMIN_USERS.size > 0;
const adminSessions = new Map();

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

    if (requestUrl.pathname.startsWith("/api/admin/")) {
      await handleAdminApiRequest(req, res, requestUrl);
      return;
    }

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
  if (ADMIN_ENABLED) {
    console.log(`Admin enabled for: ${Array.from(ADMIN_USERS).join(", ")}`);
  } else {
    console.log("Admin disabled. Set ADMIN_USERS to enable /admin.");
  }
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

async function handleAdminApiRequest(req, res, requestUrl) {
  if (!ADMIN_ENABLED) {
    sendJson(res, 404, {
      error: "admin_disabled",
      message: "Admin mode is disabled."
    });
    return;
  }

  if (requestUrl.pathname === "/api/admin/session" && req.method === "GET") {
    const session = getAdminSession(req);
    sendJson(res, 200, {
      adminEnabled: true,
      authenticated: Boolean(session),
      user: session ? { email: session.email, name: session.name } : null,
      clientIdConfigured: Boolean(ADMIN_GOOGLE_CLIENT_ID)
    });
    return;
  }

  if (requestUrl.pathname === "/api/admin/login" && req.method === "POST") {
    if (!ADMIN_GOOGLE_CLIENT_ID) {
      sendJson(res, 400, {
        error: "missing_google_client_id",
        message: "Set ADMIN_GOOGLE_CLIENT_ID or GOOGLE_CLIENT_ID on the server."
      });
      return;
    }

    const payload = await readJsonBody(req);
    const credential = String(payload.credential || "");
    if (!credential) {
      sendJson(res, 400, {
        error: "missing_credential",
        message: "Google credential is required."
      });
      return;
    }

    const profile = await verifyGoogleCredential(credential);
    const email = String(profile.email || "").toLowerCase();
    if (!profile.email_verified || !ADMIN_USERS.has(email)) {
      sendJson(res, 403, {
        error: "forbidden",
        message: "This Google account is not allowed to access admin mode."
      });
      return;
    }

    const sessionToken = crypto.randomBytes(24).toString("hex");
    adminSessions.set(sessionToken, {
      email,
      name: profile.name || email,
      createdAt: Date.now()
    });

    setCookie(res, ADMIN_SESSION_COOKIE, sessionToken, {
      httpOnly: true,
      sameSite: "Lax",
      path: "/",
      maxAge: 60 * 60 * 12
    });

    sendJson(res, 200, {
      ok: true,
      user: {
        email,
        name: profile.name || email
      }
    });
    return;
  }

  if (requestUrl.pathname === "/api/admin/logout" && req.method === "POST") {
    const sessionToken = getCookies(req)[ADMIN_SESSION_COOKIE];
    if (sessionToken) {
      adminSessions.delete(sessionToken);
    }

    clearCookie(res, ADMIN_SESSION_COOKIE, {
      path: "/"
    });

    sendJson(res, 200, {
      ok: true
    });
    return;
  }

  const session = requireAdminSession(req, res);
  if (!session) {
    return;
  }

  if (requestUrl.pathname === "/api/admin/droid-types" && req.method === "GET") {
    const index = await readDroidTypeIndex();
    sendJson(res, 200, {
      items: index
    });
    return;
  }

  if (requestUrl.pathname.startsWith("/api/admin/droid-types/")) {
    const typeId = decodeURIComponent(requestUrl.pathname.replace("/api/admin/droid-types/", "")).trim();
    if (!typeId) {
      sendJson(res, 400, {
        error: "invalid_type_id",
        message: "Droid type id is required."
      });
      return;
    }

    if (req.method === "GET") {
      const config = await readDroidTypeConfig(typeId);
      sendJson(res, 200, config);
      return;
    }

    if (req.method === "PUT") {
      const payload = await readJsonBody(req);
      await writeDroidTypeConfig(typeId, payload);
      sendJson(res, 200, {
        ok: true,
        updatedAt: new Date().toISOString()
      });
      return;
    }
  }

  sendJson(res, 405, {
    error: "method_not_allowed",
    message: "Unsupported admin request."
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

  if (pathname === "/config.js") {
    return serveConfigScript(req, res);
  }

  if (pathname === "/admin") {
    pathname = ADMIN_ENABLED ? "/admin.html" : "/index.html";
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

async function readDroidTypeIndex() {
  const raw = await fsp.readFile(DROID_TYPES_INDEX_FILE, "utf8");
  return JSON.parse(raw);
}

async function readDroidTypeConfig(typeId) {
  const entry = await getDroidTypeIndexEntry(typeId);
  const filePath = resolveDroidTypeFile(entry.file);
  const raw = await fsp.readFile(filePath, "utf8");
  return {
    entry,
    filePath: path.relative(ROOT, filePath),
    config: JSON.parse(raw)
  };
}

async function writeDroidTypeConfig(typeId, payload) {
  const entry = await getDroidTypeIndexEntry(typeId);
  const filePath = resolveDroidTypeFile(entry.file);
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) {
    throw new Error("Config payload must be a JSON object.");
  }

  if (payload.id !== typeId) {
    throw new Error(`Config id must stay in sync with the file entry (${typeId}).`);
  }

  await fsp.writeFile(filePath, `${JSON.stringify(payload, null, 2)}\n`);
}

async function getDroidTypeIndexEntry(typeId) {
  const index = await readDroidTypeIndex();
  const entry = index.find((item) => item.id === typeId);
  if (!entry) {
    throw new Error(`Unknown droid type: ${typeId}`);
  }

  return entry;
}

function resolveDroidTypeFile(relativeFile) {
  const normalized = relativeFile.replace("./", "");
  const filePath = path.normalize(path.join(DROID_TYPES_DIR, normalized));
  if (!filePath.startsWith(DROID_TYPES_DIR)) {
    throw new Error("Invalid droid type file path.");
  }

  return filePath;
}

async function verifyGoogleCredential(credential) {
  const tokenInfo = await fetchJson(
    `https://oauth2.googleapis.com/tokeninfo?id_token=${encodeURIComponent(credential)}`
  );

  if (tokenInfo.aud !== ADMIN_GOOGLE_CLIENT_ID) {
    throw new Error("Google token audience does not match ADMIN_GOOGLE_CLIENT_ID.");
  }

  if (!["accounts.google.com", "https://accounts.google.com"].includes(tokenInfo.iss)) {
    throw new Error("Google token issuer is invalid.");
  }

  if (!tokenInfo.email) {
    throw new Error("Google token did not include an email.");
  }

  return tokenInfo;
}

function fetchJson(url) {
  return new Promise((resolve, reject) => {
    https
      .get(url, (response) => {
        const chunks = [];
        response.on("data", (chunk) => {
          chunks.push(chunk);
        });
        response.on("end", () => {
          const raw = Buffer.concat(chunks).toString("utf8");
          if (response.statusCode < 200 || response.statusCode >= 300) {
            reject(new Error(raw || `HTTP ${response.statusCode}`));
            return;
          }

          try {
            resolve(JSON.parse(raw));
          } catch (error) {
            reject(error);
          }
        });
      })
      .on("error", reject);
  });
}

function getAdminSession(req) {
  const token = getCookies(req)[ADMIN_SESSION_COOKIE];
  if (!token) {
    return null;
  }

  return adminSessions.get(token) ?? null;
}

function requireAdminSession(req, res) {
  const session = getAdminSession(req);
  if (!session) {
    sendJson(res, 401, {
      error: "unauthorized",
      message: "Admin sign-in is required."
    });
    return null;
  }

  return session;
}

function getCookies(req) {
  const raw = req.headers.cookie || "";
  return raw.split(";").reduce((cookies, part) => {
    const [key, ...rest] = part.trim().split("=");
    if (!key) {
      return cookies;
    }

    cookies[key] = decodeURIComponent(rest.join("=") || "");
    return cookies;
  }, {});
}

function setCookie(res, name, value, options = {}) {
  const segments = [`${name}=${encodeURIComponent(value)}`];

  if (options.maxAge) {
    segments.push(`Max-Age=${options.maxAge}`);
  }

  if (options.httpOnly) {
    segments.push("HttpOnly");
  }

  if (options.sameSite) {
    segments.push(`SameSite=${options.sameSite}`);
  }

  segments.push(`Path=${options.path || "/"}`);
  res.setHeader("Set-Cookie", segments.join("; "));
}

function clearCookie(res, name, options = {}) {
  setCookie(res, name, "", {
    ...options,
    maxAge: 0
  });
}

function serveConfigScript(req, res) {
  const script = `window.BUILDR_CONFIG = ${JSON.stringify(
    {
      googleClientId: GOOGLE_CLIENT_ID
    },
    null,
    2
  )};\n`;

  res.writeHead(200, {
    "Content-Type": "text/javascript; charset=utf-8",
    "Content-Length": Buffer.byteLength(script)
  });

  if (req.method === "HEAD") {
    res.end();
    return;
  }

  res.end(script);
}

function loadEnvFile(filePath) {
  try {
    const raw = fs.readFileSync(filePath, "utf8");
    raw.split(/\r?\n/).forEach((line) => {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith("#")) {
        return;
      }

      const separator = trimmed.indexOf("=");
      if (separator === -1) {
        return;
      }

      const key = trimmed.slice(0, separator).trim();
      let value = trimmed.slice(separator + 1).trim();
      if (!key || process.env[key] !== undefined) {
        return;
      }

      if (
        (value.startsWith('"') && value.endsWith('"')) ||
        (value.startsWith("'") && value.endsWith("'"))
      ) {
        value = value.slice(1, -1);
      }

      process.env[key] = value;
    });
  } catch (error) {
    if (error.code !== "ENOENT") {
      throw error;
    }
  }
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
