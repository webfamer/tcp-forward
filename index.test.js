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
  createConfigResponse,
  getAdminMeta,
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
  const runtimeState = {
    targets: ["127.0.0.1:9001"],
    parsedTargets: [],
  };
  const baseConfig = {
    listenHost: "127.0.0.1",
    listenPort: 7777,
    adminHost: "127.0.0.1",
    adminPort: 0,
    connectTimeoutMs: 10000,
    configPath: "/tmp/forwarder-config.json",
  };
  const server = createAdminServer(runtimeState, baseConfig);
  const port = await listen(server);

  try {
    const page = await fetch(`http://127.0.0.1:${port}/`).then((response) => response.text());
    const script = await fetch(`http://127.0.0.1:${port}/admin.js`).then((response) => response.text());

    assert.match(page, /固定监听 7777/);
    assert.match(page, /textarea/);
    assert.match(script, /split\("\\n"\)/);
  } finally {
    await closeServer(server);
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
    const meta = getAdminMeta(baseConfig, runtimeState);
    const initialConfig = createConfigResponse(runtimeState, baseConfig);
    const response = await fetch(`http://127.0.0.1:${port}/api/config`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        targets: ["127.0.0.1:9101", "127.0.0.1:9102"],
      }),
    });
    const payload = await response.json();
    const saved = JSON.parse(fs.readFileSync(configPath, "utf8"));

    assert.deepEqual(meta, {
      listenHost: "127.0.0.1",
      listenPort: 7777,
      adminAddress: "127.0.0.1:0",
      connectTimeoutMs: 10000,
      configPath,
      targetCount: 1,
    });
    assert.deepEqual(initialConfig, {
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
  } finally {
    await closeServer(proxyServer);
    await Promise.all(upstreamServers.map((server) => closeServer(server)));
  }
});
