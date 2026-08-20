const assert = require("node:assert/strict");
const test = require("node:test");

const { expandRule, groupRoutes } = require("./public/route-form");

test("expands one form rule with multiple addresses into backend routes", () => {
  assert.deepEqual(
    expandRule({
      name: "机房温度",
      deviceType: "five-road-temp",
      deviceAddresses: ["60003", "60004", "60003"],
      primary: "127.0.0.1:9001",
      mirrors: ["127.0.0.1:9002"],
    }),
    [
      {
        name: "机房温度",
        frameType: "ECCN",
        dataType: "02",
        deviceAddress: "60003",
        primary: "127.0.0.1:9001",
        mirrors: ["127.0.0.1:9002"],
        replyPolicy: "none",
      },
      {
        name: "机房温度",
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
      name: "主机上报",
      frameType: "HOST",
      dataType: "01",
      deviceAddress: "1001",
      primary: "127.0.0.1:9001",
      mirrors: [],
      replyPolicy: "none",
    },
    {
      name: "主机上报",
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
      name: "主机上报",
      deviceTypes: ["host"],
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

test("does not merge routes that have different editable names", () => {
  const groups = groupRoutes([
    {
      name: "规则甲",
      frameType: "HOST",
      dataType: "01",
      deviceAddress: "1001",
      primary: "127.0.0.1:9001",
      mirrors: [],
    },
    {
      name: "规则乙",
      frameType: "HOST",
      dataType: "01",
      deviceAddress: "1002",
      primary: "127.0.0.1:9001",
      mirrors: [],
    },
  ]);

  assert.deepEqual(groups.map((group) => group.name), ["规则甲", "规则乙"]);
});

test("expands multiple device types across every selected address", () => {
  const routes = expandRule({
    name: "机房设备",
    deviceTypes: ["host", "sensor"],
    deviceAddresses: ["1001", "1002"],
    primary: "127.0.0.1:9001",
    mirrors: [],
  });

  assert.deepEqual(
    routes.map((route) => [route.frameType, route.dataType, route.deviceAddress]),
    [
      ["HOST", "01", "1001"],
      ["HOST", "01", "1002"],
      ["HOST", "02", "1001"],
      ["HOST", "02", "1002"],
    ],
  );
  assert.deepEqual(groupRoutes(routes), [
    {
      name: "机房设备",
      deviceTypes: ["host", "sensor"],
      deviceAddresses: ["1001", "1002"],
      primary: "127.0.0.1:9001",
      mirrors: [],
    },
  ]);
});

test("keeps same-name device types separate when their address sets differ", () => {
  const groups = groupRoutes([
    {
      name: "机房设备",
      frameType: "HOST",
      dataType: "01",
      deviceAddress: "1001",
      primary: "127.0.0.1:9001",
      mirrors: [],
    },
    {
      name: "机房设备",
      frameType: "HOST",
      dataType: "02",
      deviceAddress: "1002",
      primary: "127.0.0.1:9001",
      mirrors: [],
    },
  ]);

  assert.deepEqual(groups.map((group) => group.deviceTypes), [["host"], ["sensor"]]);
});
