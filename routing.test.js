const assert = require("node:assert/strict");
const test = require("node:test");

const { parseTargetString } = require("./index");
const {
  legacyTargetsToRoutingConfig,
  listRoutingTargets,
  matchRoute,
  normalizeRoutingConfig,
} = require("./routing");

test("converts legacy target lists to a no-reply default route", () => {
  const config = legacyTargetsToRoutingConfig(
    ["127.0.0.1:9001", "127.0.0.1:9002"],
    parseTargetString,
  );

  assert.deepEqual(config, {
    routes: [],
    defaultRoute: {
      frameType: "*",
      deviceAddress: "*",
      dataType: "*",
      primary: "127.0.0.1:9001",
      mirrors: ["127.0.0.1:9002"],
      replyPolicy: "none",
    },
  });
});

test("matches the most specific route before wildcard routes", () => {
  const config = normalizeRoutingConfig(
    {
      routes: [
        {
          frameType: "ECCN",
          deviceAddress: "*",
          dataType: "02",
          primary: "127.0.0.1:9001",
        },
        {
          frameType: "ECCN",
          deviceAddress: "1001",
          dataType: "02",
          primary: "127.0.0.1:9002",
        },
      ],
      defaultRoute: {
        primary: "127.0.0.1:9090",
      },
    },
    parseTargetString,
  );

  assert.equal(
    matchRoute(config, {
      frameType: "ECCN",
      deviceAddress: "1001",
      dataType: "02",
    }).primary,
    "127.0.0.1:9002",
  );
  assert.equal(
    matchRoute(config, {
      frameType: "ECCN",
      deviceAddress: "1002",
      dataType: "02",
    }).primary,
    "127.0.0.1:9001",
  );
  assert.equal(
    matchRoute(config, {
      frameType: "FUSE",
      deviceAddress: "3001",
      dataType: "01",
    }).primary,
    "127.0.0.1:9090",
  );
});

test("deduplicates upstream targets across routes", () => {
  const config = normalizeRoutingConfig(
    {
      routes: [
        {
          frameType: "HOST",
          primary: "127.0.0.1:9001",
          mirrors: ["127.0.0.1:9002"],
        },
        {
          frameType: "ECCN",
          primary: "127.0.0.1:9001",
        },
      ],
    },
    parseTargetString,
  );

  assert.deepEqual(listRoutingTargets(config), ["127.0.0.1:9001", "127.0.0.1:9002"]);
});

test("rejects reply policies that could send upstream data back to devices", () => {
  assert.throws(
    () =>
      normalizeRoutingConfig(
        {
          routes: [
            {
              frameType: "ECCN",
              primary: "127.0.0.1:9001",
              replyPolicy: "primary",
            },
          ],
        },
        parseTargetString,
      ),
    /replyPolicy must be none/,
  );
});

test("canonicalizes target ports before building the socket lookup key", () => {
  const config = normalizeRoutingConfig(
    {
      routes: [
        {
          frameType: "ECCN",
          primary: "127.0.0.1:09001",
          mirrors: ["127.0.0.1:09002"],
        },
      ],
    },
    parseTargetString,
  );

  assert.equal(config.routes[0].primary, "127.0.0.1:9001");
  assert.deepEqual(config.routes[0].mirrors, ["127.0.0.1:9002"]);
  assert.deepEqual(listRoutingTargets(config), ["127.0.0.1:9001", "127.0.0.1:9002"]);
});
