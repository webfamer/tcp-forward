const fs = require("fs");
const http = require("http");
const net = require("net");
const path = require("path");

const PUBLIC_DIR = path.join(__dirname, "public");
const LISTEN_PORT = 7777;
const STATIC_FILES = {
  "/": { filePath: path.join(PUBLIC_DIR, "index.html"), contentType: "text/html; charset=utf-8" },
  "/admin.css": { filePath: path.join(PUBLIC_DIR, "admin.css"), contentType: "text/css; charset=utf-8" },
  "/admin.js": {
    filePath: path.join(PUBLIC_DIR, "admin.js"),
    contentType: "application/javascript; charset=utf-8",
  },
};

function parseInteger(value, fieldName, { min, max }) {
  const parsed = Number.parseInt(value, 10);

  if (!Number.isInteger(parsed)) {
    throw new Error(`${fieldName} must be an integer`);
  }

  if (typeof min === "number" && parsed < min) {
    throw new Error(`${fieldName} must be >= ${min}`);
  }

  if (typeof max === "number" && parsed > max) {
    throw new Error(`${fieldName} must be <= ${max}`);
  }

  return parsed;
}

function parseTargetString(target, index) {
  const trimmed = String(target || "").trim();

  if (!trimmed) {
    throw new Error(`target ${index + 1} is empty`);
  }

  const separatorIndex = trimmed.lastIndexOf(":");

  if (separatorIndex <= 0 || separatorIndex === trimmed.length - 1) {
    throw new Error(`target ${index + 1} must be in host:port format`);
  }

  const targetHost = trimmed.slice(0, separatorIndex).trim();
  const targetPort = parseInteger(trimmed.slice(separatorIndex + 1), `target ${index + 1} port`, {
    min: 1,
    max: 65535,
  });

  if (!targetHost) {
    throw new Error(`target ${index + 1} host is required`);
  }

  return {
    targetHost,
    targetPort,
    target: `${targetHost}:${targetPort}`,
  };
}

function normalizeTargets(targets) {
  if (!Array.isArray(targets)) {
    throw new Error("targets must be an array");
  }

  const normalizedTargets = targets
    .map((target) => String(target || "").trim())
    .filter((target) => target.length > 0);

  if (normalizedTargets.length === 0) {
    throw new Error("at least one target is required");
  }

  return normalizedTargets;
}

function parseTargets(targets) {
  return normalizeTargets(targets).map(parseTargetString);
}

function readStartupConfig() {
  const configPath = process.env.CONFIG_PATH || path.join(__dirname, "forwarder-config.json");

  return {
    listenHost: process.env.LISTEN_HOST || "0.0.0.0",
    listenPort: LISTEN_PORT,
    targetHost: process.env.TARGET_HOST || "127.0.0.1",
    targetPort: parseInteger(process.env.TARGET_PORT || "8080", "TARGET_PORT", {
      min: 1,
      max: 65535,
    }),
    connectTimeoutMs: parseInteger(
      process.env.CONNECT_TIMEOUT_MS || "10000",
      "CONNECT_TIMEOUT_MS",
      { min: 1 },
    ),
    adminHost: process.env.ADMIN_HOST || "127.0.0.1",
    adminPort: parseInteger(process.env.ADMIN_PORT || "3000", "ADMIN_PORT", {
      min: 1,
      max: 65535,
    }),
    configPath,
  };
}

function createDefaultTargets(baseConfig) {
  return [`${baseConfig.targetHost}:${baseConfig.targetPort}`];
}

function loadSavedTargets(configPath, fallbackTargets) {
  try {
    const raw = JSON.parse(fs.readFileSync(configPath, "utf8"));

    if (Array.isArray(raw)) {
      return normalizeTargets(raw);
    }

    if (Array.isArray(raw.targets)) {
      return normalizeTargets(raw.targets);
    }

    if (Array.isArray(raw.routes)) {
      return normalizeTargets(
        raw.routes.map((route) => `${route.targetHost}:${route.targetPort}`),
      );
    }

    if (raw && typeof raw === "object" && raw.targetHost) {
      return normalizeTargets([`${raw.targetHost}:${raw.targetPort}`]);
    }
  } catch (error) {
    if (error.code !== "ENOENT") {
      console.error(`[config-load-error] ${error.message}`);
    }
  }

  return fallbackTargets;
}

function saveTargetsConfig(configPath, targets) {
  fs.mkdirSync(path.dirname(configPath), { recursive: true });
  fs.writeFileSync(configPath, `${JSON.stringify({ targets }, null, 2)}\n`, "utf8");
}

function formatSocket(socket) {
  return `${socket.remoteAddress || "unknown"}:${socket.remotePort || "unknown"}`;
}

function readRequestBody(request) {
  return new Promise((resolve, reject) => {
    let body = "";

    request.setEncoding("utf8");

    request.on("data", (chunk) => {
      body += chunk;

      if (body.length > 1024 * 32) {
        reject(new Error("request body too large"));
        request.destroy();
      }
    });

    request.on("end", () => resolve(body));
    request.on("error", reject);
  });
}

function sendJson(response, statusCode, payload) {
  response.writeHead(statusCode, {
    "Content-Type": "application/json; charset=utf-8",
    "Cache-Control": "no-store",
  });
  response.end(`${JSON.stringify(payload)}\n`);
}

function sendStaticFile(response, filePath, contentType) {
  try {
    const content = fs.readFileSync(filePath);
    response.writeHead(200, {
      "Content-Type": contentType,
      "Cache-Control": "no-store",
    });
    response.end(content);
  } catch (error) {
    sendJson(response, 500, { error: `Failed to load static asset: ${error.message}` });
  }
}

function getAdminMeta(baseConfig, runtimeState) {
  return {
    listenHost: baseConfig.listenHost,
    listenPort: baseConfig.listenPort,
    adminAddress: `${baseConfig.adminHost}:${baseConfig.adminPort}`,
    connectTimeoutMs: baseConfig.connectTimeoutMs,
    configPath: baseConfig.configPath,
    targetCount: runtimeState.targets.length,
  };
}

function createProxyServer(runtimeState, baseConfig) {
  const server = net.createServer((clientSocket) => {
    const activeTargets = runtimeState.parsedTargets.map((target) => ({
      ...target,
      socket: net.createConnection({
        host: target.targetHost,
        port: target.targetPort,
      }),
    }));
    const primaryTarget = activeTargets[0];
    const clientLabel = formatSocket(clientSocket);
    let closed = false;

    console.log(
      `[connect] ${baseConfig.listenHost}:${baseConfig.listenPort} ${clientLabel} -> ${activeTargets
        .map((target) => target.target)
        .join(", ")}`,
    );

    function closeAll(reason, error) {
      if (closed) {
        return;
      }

      closed = true;

      if (error) {
        console.error(
          `[${reason}] ${baseConfig.listenHost}:${baseConfig.listenPort} ${clientLabel}: ${error.message}`,
        );
      } else {
        console.log(`[${reason}] ${baseConfig.listenHost}:${baseConfig.listenPort} ${clientLabel}`);
      }

      clientSocket.destroy();
      activeTargets.forEach((target) => target.socket.destroy());
    }

    clientSocket.on("error", (error) => closeAll("client-error", error));
    clientSocket.on("close", () => closeAll("client-close"));

    activeTargets.forEach((target, index) => {
      target.socket.on("error", (error) => closeAll(`target-${index + 1}-error`, error));
      target.socket.setTimeout(baseConfig.connectTimeoutMs, () => {
        closeAll(
          `target-${index + 1}-timeout`,
          new Error(`connect timeout after ${baseConfig.connectTimeoutMs}ms`),
        );
      });
      target.socket.on("connect", () => {
        target.socket.setTimeout(0);
      });
      target.socket.on("close", () => {
        if (index === 0) {
          closeAll("primary-target-close");
        }
      });
      target.socket.resume();
    });

    clientSocket.on("data", (chunk) => {
      activeTargets.forEach((target) => {
        if (!target.socket.destroyed) {
          target.socket.write(chunk);
        }
      });
    });

    primaryTarget.socket.on("data", (chunk) => {
      if (!clientSocket.destroyed) {
        clientSocket.write(chunk);
      }
    });
  });

  server.on("error", (error) => {
    console.error(
      `[proxy-server-error] ${baseConfig.listenHost}:${baseConfig.listenPort} ${error.message}`,
    );
    process.exitCode = 1;
  });

  return server;
}

function listenServer(server, host, port) {
  return new Promise((resolve, reject) => {
    function handleError(error) {
      server.off("listening", handleListening);
      reject(error);
    }

    function handleListening() {
      server.off("error", handleError);
      resolve();
    }

    server.once("error", handleError);
    server.once("listening", handleListening);
    server.listen(port, host);
  });
}

function closeServer(server) {
  return new Promise((resolve) => {
    if (!server || !server.listening) {
      resolve();
      return;
    }

    server.close(() => resolve());
  });
}

function updateTargets(runtimeState, nextTargets) {
  runtimeState.targets = normalizeTargets(nextTargets);
  runtimeState.parsedTargets = parseTargets(runtimeState.targets);
}

function parseConfigPayload(payload) {
  if (Array.isArray(payload.targets)) {
    return normalizeTargets(payload.targets);
  }

  if (payload.targetHost || payload.targetPort) {
    return normalizeTargets([`${payload.targetHost}:${payload.targetPort}`]);
  }

  throw new Error("targets is required");
}

function createConfigResponse(runtimeState, baseConfig) {
  return {
    targets: runtimeState.targets,
    listenPort: baseConfig.listenPort,
    primaryReplyTarget: runtimeState.targets[0],
  };
}

function createAdminServer(runtimeState, baseConfig) {
  return http.createServer(async (request, response) => {
    const url = new URL(request.url, `http://${request.headers.host || "localhost"}`);
    const staticFile = request.method === "GET" ? STATIC_FILES[url.pathname] : null;

    if (staticFile) {
      sendStaticFile(response, staticFile.filePath, staticFile.contentType);
      return;
    }

    if (url.pathname === "/api/meta" && request.method === "GET") {
      sendJson(response, 200, { meta: getAdminMeta(baseConfig, runtimeState) });
      return;
    }

    if (url.pathname === "/api/config" && request.method === "GET") {
      sendJson(response, 200, { config: createConfigResponse(runtimeState, baseConfig) });
      return;
    }

    if (url.pathname === "/api/config" && request.method === "POST") {
      try {
        const body = await readRequestBody(request);
        const payload = JSON.parse(body || "{}");
        const nextTargets = parseConfigPayload(payload);

        updateTargets(runtimeState, nextTargets);
        saveTargetsConfig(baseConfig.configPath, runtimeState.targets);

        console.log(`[config-updated] ${runtimeState.targets.length} target(s) active`);
        sendJson(response, 200, { config: createConfigResponse(runtimeState, baseConfig) });
      } catch (error) {
        sendJson(response, 400, { error: error.message });
      }

      return;
    }

    sendJson(response, 404, { error: "Not found" });
  });
}

function shutdownServers(signal, adminServer, proxyServer) {
  console.log(`[shutdown] received ${signal}`);

  Promise.all([closeServer(adminServer), closeServer(proxyServer)]).then(() => {
    console.log("[shutdown] all servers closed");
    process.exit(0);
  });
}

async function start() {
  const baseConfig = readStartupConfig();
  const fallbackTargets = createDefaultTargets(baseConfig);
  const runtimeState = {
    targets: [],
    parsedTargets: [],
  };

  updateTargets(runtimeState, loadSavedTargets(baseConfig.configPath, fallbackTargets));

  const proxyServer = createProxyServer(runtimeState, baseConfig);
  await listenServer(proxyServer, baseConfig.listenHost, baseConfig.listenPort);

  console.log(
    `TCP forwarder listening on ${baseConfig.listenHost}:${baseConfig.listenPort} -> ${runtimeState.targets.join(", ")}`,
  );

  const adminServer = createAdminServer(runtimeState, baseConfig);
  await listenServer(adminServer, baseConfig.adminHost, baseConfig.adminPort);
  console.log(`Admin page listening on http://${baseConfig.adminHost}:${baseConfig.adminPort}`);

  adminServer.on("error", (error) => {
    console.error(`[admin-server-error] ${error.message}`);
    process.exitCode = 1;
  });

  process.on("SIGINT", () => shutdownServers("SIGINT", adminServer, proxyServer));
  process.on("SIGTERM", () => shutdownServers("SIGTERM", adminServer, proxyServer));

  return { adminServer, proxyServer, runtimeState, baseConfig };
}

if (require.main === module) {
  start().catch((error) => {
    console.error(`[startup-error] ${error.message}`);
    process.exit(1);
  });
}

module.exports = {
  closeServer,
  createAdminServer,
  createConfigResponse,
  createDefaultTargets,
  createProxyServer,
  getAdminMeta,
  listenServer,
  loadSavedTargets,
  normalizeTargets,
  parseConfigPayload,
  parseInteger,
  parseTargetString,
  parseTargets,
  readStartupConfig,
  saveTargetsConfig,
  shutdownServers,
  start,
  updateTargets,
};
