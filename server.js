const http = require("http");
const fs = require("fs");
const fsp = require("fs/promises");
const path = require("path");
const https = require("https");
const crypto = require("crypto");
const { URL } = require("url");
const { Pool } = require("pg");

loadEnvFile(path.join(__dirname, ".env"));

const HOST = "0.0.0.0";
const PORT = Number(process.env.PORT || 4173);
const ROOT = __dirname;
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
const APP_SESSION_COOKIE = "buildr2_app_session";
const ADMIN_ENABLED = ADMIN_USERS.size > 0;
const adminSessions = new Map();
const APP_SESSION_MAX_AGE = 60 * 60 * 24 * 30;

const pool = new Pool(buildPgConfig());

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

    if (requestUrl.pathname.startsWith("/api/auth/")) {
      await handleAppAuthRequest(req, res, requestUrl);
      return;
    }

    if (requestUrl.pathname === "/api/workspace") {
      await handleWorkspaceRequest(req, res);
      return;
    }

    if (requestUrl.pathname.startsWith("/api/admin/")) {
      await handleAdminApiRequest(req, res, requestUrl);
      return;
    }

    await serveStatic(req, res, requestUrl);
  } catch (error) {
    console.error(error);
    sendJson(res, 500, {
      error: "server_error",
      message: error.message
    });
  }
});

start().catch((error) => {
  console.error("Failed to start Buildr2:", error);
  process.exit(1);
});

async function start() {
  await ensureDatabase();
  server.listen(PORT, HOST, () => {
    console.log(`Buildr2 server running at http://localhost:${PORT}`);
    console.log(`Postgres workspace storage enabled.`);
    if (ADMIN_ENABLED) {
      console.log(`Admin enabled for: ${Array.from(ADMIN_USERS).join(", ")}`);
    } else {
      console.log("Admin disabled. Set ADMIN_USERS to enable /old_admin.");
    }
  });
}

async function handleAppAuthRequest(req, res, requestUrl) {
  if (requestUrl.pathname === "/api/auth/session" && req.method === "GET") {
    const session = await getAppSession(req);
    sendJson(res, 200, {
      authenticated: Boolean(session),
      user: session
        ? {
            id: `google:${session.googleSub}`,
            name: session.name,
            email: session.email,
            mode: "google"
          }
        : null,
      clientIdConfigured: Boolean(GOOGLE_CLIENT_ID)
    });
    return;
  }

  if (requestUrl.pathname === "/api/auth/google" && req.method === "POST") {
    if (!GOOGLE_CLIENT_ID) {
      sendJson(res, 400, {
        error: "missing_google_client_id",
        message: "Set GOOGLE_CLIENT_ID on the server."
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

    const profile = await verifyGoogleCredential(credential, GOOGLE_CLIENT_ID);
    const user = await upsertUserFromGoogleProfile(profile);
    const sessionToken = crypto.randomBytes(32).toString("hex");
    await createAppSession(user.id, sessionToken);

    setCookie(res, APP_SESSION_COOKIE, sessionToken, {
      httpOnly: true,
      sameSite: "Lax",
      path: "/",
      maxAge: APP_SESSION_MAX_AGE
    });

    sendJson(res, 200, {
      ok: true,
      user: {
        id: `google:${user.google_sub}`,
        name: user.name,
        email: user.email,
        mode: "google"
      }
    });
    return;
  }

  if (requestUrl.pathname === "/api/auth/logout" && req.method === "POST") {
    const token = getCookies(req)[APP_SESSION_COOKIE];
    if (token) {
      await deleteAppSession(token);
    }

    clearCookie(res, APP_SESSION_COOKIE, {
      path: "/"
    });

    sendJson(res, 200, {
      ok: true
    });
    return;
  }

  sendJson(res, 405, {
    error: "method_not_allowed",
    message: "Unsupported auth request."
  });
}

async function handleWorkspaceRequest(req, res) {
  const session = await requireAppSession(req, res);
  if (!session) {
    return;
  }

  if (req.method === "GET") {
    const workspace = await readWorkspaceForUser(session.userId);
    sendJson(res, 200, workspace);
    return;
  }

  if (req.method === "PUT") {
    const payload = await readJsonBody(req);
    const workspace = {
      droids: Array.isArray(payload.droids) ? payload.droids : [],
      activeDroidId: payload.activeDroidId ?? null,
      activeSectionId: payload.activeSectionId ?? null
    };

    await writeWorkspaceForUser(session.userId, workspace);
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

    const profile = await verifyGoogleCredential(credential, ADMIN_GOOGLE_CLIENT_ID);
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

  if (pathname === "/old_admin") {
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

async function ensureDatabase() {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS users (
      id BIGSERIAL PRIMARY KEY,
      google_sub TEXT NOT NULL UNIQUE,
      email TEXT NOT NULL,
      name TEXT NOT NULL,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS app_sessions (
      token TEXT PRIMARY KEY,
      user_id BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      expires_at TIMESTAMPTZ NOT NULL
    )
  `);

  await pool.query(`
    CREATE INDEX IF NOT EXISTS app_sessions_user_id_idx
    ON app_sessions(user_id)
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS workspaces (
      user_id BIGINT PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
      workspace JSONB NOT NULL DEFAULT '{"droids":[],"activeDroidId":null,"activeSectionId":null}'::jsonb,
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `);

  await pool.query(`
    DELETE FROM app_sessions
    WHERE expires_at < NOW()
  `);
}

async function upsertUserFromGoogleProfile(profile) {
  const googleSub = String(profile.sub || "").trim();
  const email = String(profile.email || "").trim().toLowerCase();
  const name = String(profile.name || email).trim();

  if (!googleSub || !email) {
    throw new Error("Google profile is missing required identity fields.");
  }

  const result = await pool.query(
    `
      INSERT INTO users (google_sub, email, name, updated_at)
      VALUES ($1, $2, $3, NOW())
      ON CONFLICT (google_sub)
      DO UPDATE SET
        email = EXCLUDED.email,
        name = EXCLUDED.name,
        updated_at = NOW()
      RETURNING id, google_sub, email, name
    `,
    [googleSub, email, name]
  );

  return result.rows[0];
}

async function createAppSession(userId, token) {
  await pool.query(
    `
      INSERT INTO app_sessions (token, user_id, expires_at)
      VALUES ($1, $2, NOW() + ($3 * INTERVAL '1 second'))
    `,
    [token, userId, APP_SESSION_MAX_AGE]
  );
}

async function deleteAppSession(token) {
  await pool.query("DELETE FROM app_sessions WHERE token = $1", [token]);
}

async function getAppSession(req) {
  const token = getCookies(req)[APP_SESSION_COOKIE];
  if (!token) {
    return null;
  }

  const result = await pool.query(
    `
      SELECT
        users.id AS user_id,
        users.google_sub,
        users.email,
        users.name
      FROM app_sessions
      JOIN users ON users.id = app_sessions.user_id
      WHERE app_sessions.token = $1
        AND app_sessions.expires_at > NOW()
      LIMIT 1
    `,
    [token]
  );

  if (!result.rows.length) {
    return null;
  }

  return {
    userId: result.rows[0].user_id,
    googleSub: result.rows[0].google_sub,
    email: result.rows[0].email,
    name: result.rows[0].name
  };
}

async function requireAppSession(req, res) {
  const session = await getAppSession(req);
  if (!session) {
    sendJson(res, 401, {
      error: "unauthorized",
      message: "Google sign-in is required."
    });
    return null;
  }

  return session;
}

async function readWorkspaceForUser(userId) {
  const result = await pool.query(
    `
      SELECT workspace
      FROM workspaces
      WHERE user_id = $1
      LIMIT 1
    `,
    [userId]
  );

  return result.rows[0]?.workspace ?? emptyWorkspace();
}

async function writeWorkspaceForUser(userId, workspace) {
  await pool.query(
    `
      INSERT INTO workspaces (user_id, workspace, updated_at)
      VALUES ($1, $2::jsonb, NOW())
      ON CONFLICT (user_id)
      DO UPDATE SET
        workspace = EXCLUDED.workspace,
        updated_at = NOW()
    `,
    [userId, JSON.stringify(workspace)]
  );
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

async function verifyGoogleCredential(credential, expectedAudience) {
  const tokenInfo = await fetchJson(
    `https://oauth2.googleapis.com/tokeninfo?id_token=${encodeURIComponent(credential)}`
  );

  if (tokenInfo.aud !== expectedAudience) {
    throw new Error("Google token audience does not match the configured client id.");
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

function buildPgConfig() {
  if (process.env.DATABASE_URL) {
    return {
      connectionString: process.env.DATABASE_URL
    };
  }

  return {
    host: process.env.PGHOST || "127.0.0.1",
    port: Number(process.env.PGPORT || 5432),
    database: process.env.PGDATABASE || "buildr2",
    user: process.env.PGUSER || "buildr2",
    password: process.env.PGPASSWORD || "buildr2"
  };
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
