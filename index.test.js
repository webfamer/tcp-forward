const fs = require("fs");
const net = require("net");
const os = require("os");
const path = require("path");
const test = require("node:test");
const assert = require("node:assert/strict");

const {
  closeServer,
  createAdminServer,
  createProxyServer,
  readStartupConfig,
  updateTargets,
} = require("./index");

async function listen(server, port = 0) {
  await new Promise((resolve, reject) => {
    server.listen(port, "127.0.0.1", (error) => {
      if (error) {
        reject(error);
        return;
      }

      resolve();
    });
  });

  return server.address().port;
}

test("serves simplified admin frontend assets", async () => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "tcp-forward-static-test-"));
  const logPath = path.join(tempDir, "static.txt");
  const runtimeState = {
    targets: ["127.0.0.1:9001"],
    parsedTargets: [],
  };
  fs.writeFileSync(logPath, "log line 1\n", "utf8");
  const baseConfig = {
    listenHost: "127.0.0.1",
    listenPort: 7777,
    adminHost: "127.0.0.1",
    adminPort: 0,
    connectTimeoutMs: 10000,
    configPath: "/tmp/forwarder-config.json",
    logPath,
  };
  const server = createAdminServer(runtimeState, baseConfig);
  const port = await listen(server);

  try {
    const page = await fetch(`http://127.0.0.1:${port}/`).then((response) => response.text());
    const script = await fetch(`http://127.0.0.1:${port}/admin.js`).then((response) => response.text());
    const staticLogResponse = await fetch(`http://127.0.0.1:${port}/static.txt`);
    const staticLog = await staticLogResponse.text();
    const typoLogResponse = await fetch(`http://127.0.0.1:${port}/staic.txt`);
    const typoLog = await typoLogResponse.text();

    assert.match(page, /固定监听 7777/);
    assert.match(page, /textarea/);
    assert.match(script, /split\("\\n"\)/);
    assert.match(staticLogResponse.headers.get("content-type") || "", /^text\/html/);
    assert.match(staticLog, /<pre>log line 1\n<\/pre>/);
    assert.match(typoLog, /<pre>log line 1\n<\/pre>/);
  } finally {
    await closeServer(server);
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
});

test("reads and writes target list config", async () => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "tcp-forward-test-"));
  const configPath = path.join(tempDir, "forwarder-config.json");
  const runtimeState = {
    targets: ["127.0.0.1:9001"],
    parsedTargets: [],
  };
  updateTargets(runtimeState, runtimeState.targets);

  const baseConfig = {
    listenHost: "127.0.0.1",
    listenPort: 7777,
    adminHost: "127.0.0.1",
    adminPort: 0,
    connectTimeoutMs: 10000,
    configPath,
  };
  const server = createAdminServer(runtimeState, baseConfig);
  const port = await listen(server);

  try {
    const metaResponse = await fetch(`http://127.0.0.1:${port}/api/meta`);
    const metaPayload = await metaResponse.json();
    const initialConfigResponse = await fetch(`http://127.0.0.1:${port}/api/config`);
    const initialConfigPayload = await initialConfigResponse.json();
    const response = await fetch(`http://127.0.0.1:${port}/api/config`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        targets: ["127.0.0.1:9101", "127.0.0.1:9102"],
      }),
    });
    const payload = await response.json();
    const saved = JSON.parse(fs.readFileSync(configPath, "utf8"));

    assert.equal(metaResponse.status, 200);
    assert.deepEqual(metaPayload.meta, {
      listenHost: "127.0.0.1",
      listenPort: 7777,
      adminAddress: "127.0.0.1:0",
      connectTimeoutMs: 10000,
      configPath,
      targetCount: 1,
    });
    assert.equal(initialConfigResponse.status, 200);
    assert.deepEqual(initialConfigPayload.config, {
      listenPort: 7777,
      primaryReplyTarget: "127.0.0.1:9001",
      targets: ["127.0.0.1:9001"],
    });
    assert.equal(response.status, 200);
    assert.deepEqual(payload.config.targets, ["127.0.0.1:9101", "127.0.0.1:9102"]);
    assert.deepEqual(saved, {
      targets: ["127.0.0.1:9101", "127.0.0.1:9102"],
    });
  } finally {
    await closeServer(server);
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
});

test("forwards client data to all targets and replies from the first target", async () => {
  const received = [[], []];
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "tcp-forward-log-test-"));
  const logPath = path.join(tempDir, "static.txt");
  const upstreamServers = [0, 1].map((index) =>
    net.createServer((socket) => {
      socket.on("data", (chunk) => {
        received[index].push(chunk.toString());

        if (index === 0) {
          socket.write("pong");
        }
      });
    }),
  );

  const upstreamPorts = [];
  for (const upstreamServer of upstreamServers) {
    upstreamPorts.push(await listen(upstreamServer));
  }

  const runtimeState = {
    targets: upstreamPorts.map((port) => `127.0.0.1:${port}`),
    parsedTargets: [],
  };
  updateTargets(runtimeState, runtimeState.targets);

  const baseConfig = {
    listenHost: "127.0.0.1",
    listenPort: 7777,
    adminHost: "127.0.0.1",
    adminPort: 0,
    connectTimeoutMs: 10000,
    configPath: "/tmp/forwarder-config.json",
    logPath,
  };
  const proxyServer = createProxyServer(runtimeState, baseConfig);
  const proxyPort = await listen(proxyServer);

  try {
    const reply = await new Promise((resolve, reject) => {
      const client = net.createConnection({ host: "127.0.0.1", port: proxyPort });
      let data = "";

      client.on("connect", () => {
        client.write("ping");
      });
      client.on("data", (chunk) => {
        data += chunk.toString();
        client.end();
      });
      client.on("end", () => resolve(data));
      client.on("error", reject);
    });

    assert.equal(reply, "pong");
    assert.deepEqual(received[0], ["ping"]);
    assert.deepEqual(received[1], ["ping"]);
    const logLine = fs.readFileSync(logPath, "utf8").trim();

    assert.match(logLine, /^\[\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\+08:00] \[client-data]/);
    assert.match(
      logLine,
      new RegExp(`targets=127\\.0\\.0\\.1:${upstreamPorts[0]}, 127\\.0\\.0\\.1:${upstreamPorts[1]}`),
    );
    assert.match(logLine, /utf8="ping"/);
    assert.match(logLine, /hex=70696e67/);
  } finally {
    await closeServer(proxyServer);
    await Promise.all(upstreamServers.map((server) => closeServer(server)));
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
});

test("logs binary payloads without mojibake utf8 output", async () => {
  const received = [[], []];
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "tcp-forward-binary-log-test-"));
  const logPath = path.join(tempDir, "static.txt");
  const payload = Buffer.from("4543434eea640201000d69805b59", "hex");
  const upstreamServers = [0, 1].map((index) =>
    net.createServer((socket) => {
      socket.on("data", (chunk) => {
        received[index].push(chunk);

        if (index === 0) {
          socket.write("pong");
        }
      });
    }),
  );

  const upstreamPorts = [];
  for (const upstreamServer of upstreamServers) {
    upstreamPorts.push(await listen(upstreamServer));
  }

  const runtimeState = {
    targets: upstreamPorts.map((port) => `127.0.0.1:${port}`),
    parsedTargets: [],
  };
  updateTargets(runtimeState, runtimeState.targets);

  const baseConfig = {
    listenHost: "127.0.0.1",
    listenPort: 7777,
    adminHost: "127.0.0.1",
    adminPort: 0,
    connectTimeoutMs: 10000,
    configPath: "/tmp/forwarder-config.json",
    logPath,
  };
  const proxyServer = createProxyServer(runtimeState, baseConfig);
  const proxyPort = await listen(proxyServer);

  try {
    const reply = await new Promise((resolve, reject) => {
      const client = net.createConnection({ host: "127.0.0.1", port: proxyPort });
      let data = "";

      client.on("connect", () => {
        client.write(payload);
      });
      client.on("data", (chunk) => {
        data += chunk.toString();
        client.end();
      });
      client.on("end", () => resolve(data));
      client.on("error", reject);
    });

    assert.equal(reply, "pong");
    assert.deepEqual(received[0], [payload]);
    assert.deepEqual(received[1], [payload]);
    const logLine = fs.readFileSync(logPath, "utf8").trim();

    assert.match(
      logLine,
      new RegExp(`targets=127\\.0\\.0\\.1:${upstreamPorts[0]}, 127\\.0\\.0\\.1:${upstreamPorts[1]}`),
    );
    assert.match(logLine, /utf8="\[binary data]"/);
    assert.match(logLine, /hex=4543434eea640201000d69805b59/);
  } finally {
    await closeServer(proxyServer);
    await Promise.all(upstreamServers.map((server) => closeServer(server)));
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
});

test("reads listen port from LISTEN_PORT for process managers", () => {
  const originalEnv = {
    LISTEN_HOST: process.env.LISTEN_HOST,
    LISTEN_PORT: process.env.LISTEN_PORT,
    TARGET_HOST: process.env.TARGET_HOST,
    TARGET_PORT: process.env.TARGET_PORT,
    CONNECT_TIMEOUT_MS: process.env.CONNECT_TIMEOUT_MS,
    ADMIN_HOST: process.env.ADMIN_HOST,
    ADMIN_PORT: process.env.ADMIN_PORT,
    CONFIG_PATH: process.env.CONFIG_PATH,
    LOG_PATH: process.env.LOG_PATH,
  };

  process.env.LISTEN_HOST = "0.0.0.0";
  process.env.LISTEN_PORT = "7777";
  process.env.TARGET_HOST = "127.0.0.1";
  process.env.TARGET_PORT = "9001";
  process.env.CONNECT_TIMEOUT_MS = "5000";
  process.env.ADMIN_HOST = "0.0.0.0";
  process.env.ADMIN_PORT = "3010";
  process.env.CONFIG_PATH = "/tmp/pm2-forwarder-config.json";
  process.env.LOG_PATH = "/tmp/pm2-static.txt";

  try {
    const config = readStartupConfig();

    assert.equal(config.listenHost, "0.0.0.0");
    assert.equal(config.listenPort, 7777);
    assert.equal(config.targetHost, "127.0.0.1");
    assert.equal(config.targetPort, 9001);
    assert.equal(config.connectTimeoutMs, 5000);
    assert.equal(config.adminHost, "0.0.0.0");
    assert.equal(config.adminPort, 3010);
    assert.equal(config.configPath, "/tmp/pm2-forwarder-config.json");
    assert.equal(config.logPath, "/tmp/pm2-static.txt");
  } finally {
    for (const [key, value] of Object.entries(originalEnv)) {
      if (typeof value === "undefined") {
        delete process.env[key];
      } else {
        process.env[key] = value;
      }
    }
  }
});
