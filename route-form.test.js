const assert = require("node:assert/strict");
const test = require("node:test");

const { expandRule, groupRoutes } = require("./public/route-form");

test("expands one form rule with multiple addresses into backend routes", () => {
  assert.deepEqual(
    expandRule({
      deviceType: "five-road-temp",
      deviceAddresses: ["60003", "60004", "60003"],
      primary: "127.0.0.1:9001",
      mirrors: ["127.0.0.1:9002"],
    }),
    [
      {
        frameType: "ECCN",
        dataType: "02",
        deviceAddress: "60003",
        primary: "127.0.0.1:9001",
        mirrors: ["127.0.0.1:9002"],
        replyPolicy: "none",
      },
      {
        frameType: "ECCN",
        dataType: "02",
        deviceAddress: "60004",
        primary: "127.0.0.1:9001",
        mirrors: ["127.0.0.1:9002"],
        replyPolicy: "none",
      },
    ],
  );
});

test("groups equivalent backend routes back into one multi-address form rule", () => {
  const groups = groupRoutes([
    {
      frameType: "HOST",
      dataType: "01",
      deviceAddress: "1001",
      primary: "127.0.0.1:9001",
      mirrors: [],
      replyPolicy: "none",
    },
    {
      frameType: "HOST",
      dataType: "01",
      deviceAddress: "1002",
      primary: "127.0.0.1:9001",
      mirrors: [],
      replyPolicy: "none",
    },
  ]);

  assert.deepEqual(groups, [
    {
      deviceType: "host",
      deviceAddresses: ["1001", "1002"],
      primary: "127.0.0.1:9001",
      mirrors: [],
    },
  ]);
});

test("maps frame-only device types without exposing internal data bytes", () => {
  assert.deepEqual(
    expandRule({
      deviceType: "fuse",
      deviceAddresses: ["*"],
      primary: "127.0.0.1:9001",
      mirrors: [],
    })[0],
    {
      frameType: "FUSE",
      dataType: "*",
      deviceAddress: "*",
      primary: "127.0.0.1:9001",
      mirrors: [],
      replyPolicy: "none",
    },
  );
});
