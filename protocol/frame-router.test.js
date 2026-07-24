"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");

const {
  FRAME_HEADERS,
  classifyFrame,
  createFrameRouter,
} = require("./frame-router");

function hex(value) {
  return Buffer.from(value, "hex");
}

function commonFrame(header, addressHex, typeHex, dataLength, tailHex = "FC") {
  const payload = Buffer.alloc(dataLength, 0x11).toString("hex");
  const lengthHex = dataLength.toString(16).padStart(4, "0");

  return hex(`${header}${addressHex}${typeHex}0200016971EA34${lengthHex}${payload}${tailHex}`);
}

function fuseFrame(addressHex = "1234") {
  const frame = Buffer.alloc(242, 0);
  frame.write(FRAME_HEADERS.FUSE, 0, "hex");
  frame.write(addressHex, 57, "hex");
  frame.write("A5", 59, "hex");
  return frame;
}

test("decodes a split fixed-length fuse frame and classifies address from bytes 57-58", () => {
  const router = createFrameRouter();
  const frame = fuseFrame("EA64");

  assert.deepEqual(router.push(frame.subarray(0, 100)), []);
  assert.equal(router.getBufferedLength(), 100);

  const decoded = router.push(frame.subarray(100));

  assert.equal(decoded.length, 1);
  assert.deepEqual(decoded[0].frame, frame);
  assert.deepEqual(decoded[0].meta, {
    frameHeader: FRAME_HEADERS.FUSE,
    frameType: "FUSE",
    deviceAddress: "60004",
    dataType: "A5",
    routeKey: "FUSE:60004:A5",
  });
  assert.equal(router.getBufferedLength(), 0);
});

test("decodes glued DLZJ host and sensor frames using big-endian addresses and data types", () => {
  const router = createFrameRouter();
  const host = commonFrame(FRAME_HEADERS.DLZJ, "EA63", "01", 49);
  const sensor = commonFrame(FRAME_HEADERS.DLZJ, "0039", "02", 0x011b, "FCFC");
  const decoded = router.push(Buffer.concat([host, sensor]));

  assert.equal(host.length, 66);
  assert.equal(sensor.length, 301);
  assert.equal(decoded.length, 2);
  assert.deepEqual(decoded.map((entry) => entry.frame), [host, sensor]);
  assert.deepEqual(decoded.map((entry) => entry.meta), [
    {
      frameHeader: FRAME_HEADERS.DLZJ,
      frameType: "HOST",
      deviceAddress: "60003",
      dataType: "01",
      routeKey: "HOST:60003:01",
    },
    {
      frameHeader: FRAME_HEADERS.DLZJ,
      frameType: "HOST",
      deviceAddress: "57",
      dataType: "02",
      routeKey: "HOST:57:02",
    },
  ]);
});

test("uses the DLZJ host length field to distinguish old 66-byte and new 71-byte frames", () => {
  const router = createFrameRouter();
  const oldHost = commonFrame(FRAME_HEADERS.DLZJ, "EA63", "01", 49);
  const newHost = commonFrame(FRAME_HEADERS.DLZJ, "EA64", "01", 54);
  const decoded = router.push(Buffer.concat([oldHost, newHost]));

  assert.equal(oldHost.length, 66);
  assert.equal(newHost.length, 71);
  assert.equal(decoded.length, 2);
  assert.deepEqual(
    decoded.map((entry) => entry.meta.deviceAddress),
    ["60003", "60004"],
  );
});

test("decodes ECCN and IOTD length-field frames", () => {
  const router = createFrameRouter();
  const eccn = commonFrame(FRAME_HEADERS.ECCN, "EA64", "02", 54);
  const iotd = hex("494F5444EE4900010011110162010100010100FFFFFF096913A519FC");
  const decoded = router.push(Buffer.concat([eccn, iotd]));

  assert.equal(decoded.length, 2);
  assert.equal(decoded[0].frame.length, 71);
  assert.deepEqual(decoded[0].meta, {
    frameHeader: FRAME_HEADERS.ECCN,
    frameType: "ECCN",
    deviceAddress: "60004",
    dataType: "02",
    routeKey: "ECCN:60004:02",
  });
  assert.equal(decoded[1].frame.length, 28);
  assert.deepEqual(decoded[1].meta, {
    frameHeader: FRAME_HEADERS.IOTD,
    frameType: "IOTD",
    deviceAddress: "61001",
    dataType: "*",
    routeKey: "IOTD:61001:*",
  });
});

test("skips garbage before known headers and preserves a partial header across pushes", () => {
  const router = createFrameRouter();
  const host = commonFrame(FRAME_HEADERS.DLZJ, "0001", "01", 49);

  assert.deepEqual(router.push(hex("DEADBEEF444C")), []);

  const decoded = router.push(Buffer.concat([hex("5A4A"), host.subarray(4)]));

  assert.equal(decoded.length, 1);
  assert.deepEqual(decoded[0].frame, host);
  assert.deepEqual(decoded[0].meta, {
    frameHeader: FRAME_HEADERS.DLZJ,
    frameType: "HOST",
    deviceAddress: "1",
    dataType: "01",
    routeKey: "HOST:1:01",
  });
});

test("classifyFrame exposes the minimal route metadata without mutating the frame", () => {
  const frame = commonFrame(FRAME_HEADERS.ECCN, "0002", "01", 54);

  assert.deepEqual(classifyFrame(frame), {
    frameHeader: FRAME_HEADERS.ECCN,
    frameType: "ECCN",
    deviceAddress: "2",
    dataType: "01",
    routeKey: "ECCN:2:01",
  });
});

test("drops frames with an invalid tail and resynchronizes to the next valid header", () => {
  const router = createFrameRouter();
  const invalid = commonFrame(FRAME_HEADERS.ECCN, "0001", "01", 0);
  const valid = commonFrame(FRAME_HEADERS.ECCN, "0002", "01", 0);
  invalid[invalid.length - 1] = 0;

  const decoded = router.push(Buffer.concat([invalid, valid]));

  assert.equal(decoded.length, 1);
  assert.deepEqual(decoded[0].frame, valid);
  assert.equal(decoded[0].meta.deviceAddress, "2");
});
