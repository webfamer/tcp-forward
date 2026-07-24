"use strict";

const FRAME_HEADERS = Object.freeze({
  FUSE: "4D4D5A5A",
  DLZJ: "444C5A4A",
  ECCN: "4543434E",
  IOTD: "494F5444",
});

const HEADER_BUFFERS = Object.freeze(
  Object.values(FRAME_HEADERS).map((header) => Buffer.from(header, "hex")),
);

const FUSE_FRAME_LENGTH = 242;
const COMMON_LENGTH_OFFSET = 14;
const COMMON_HEADER_LENGTH = 16;
const COMMON_FRAME_TAIL_LENGTH = 1;
const SENSOR_FRAME_TAIL_LENGTH = 2;
const IOTD_LENGTH_OFFSET = 8;
const IOTD_HEADER_LENGTH = 10;
const DEFAULT_MAX_FRAME_LENGTH = 8192;

class FrameRouter {
  constructor(options = {}) {
    this.maxFrameLength = options.maxFrameLength || DEFAULT_MAX_FRAME_LENGTH;
    this.buffer = Buffer.alloc(0);
  }

  push(chunk) {
    if (!Buffer.isBuffer(chunk)) {
      chunk = Buffer.from(chunk);
    }

    if (chunk.length === 0) {
      return [];
    }

    this.buffer = this.buffer.length === 0 ? chunk : Buffer.concat([this.buffer, chunk]);

    const frames = [];

    while (this.buffer.length > 0) {
      if (!this.alignToFrameHeader()) {
        break;
      }

      const frameLength = this.readFrameLength();

      if (frameLength === null) {
        break;
      }

      if (frameLength === false || frameLength > this.maxFrameLength) {
        this.buffer = this.buffer.subarray(1);
        continue;
      }

      if (this.buffer.length < frameLength) {
        break;
      }

      const frame = this.buffer.subarray(0, frameLength);
      if (!hasValidFrameTail(frame)) {
        this.buffer = this.buffer.subarray(1);
        continue;
      }

      frames.push({
        frame: Buffer.from(frame),
        meta: classifyFrame(frame),
      });
      this.buffer = this.buffer.subarray(frameLength);
    }

    return frames;
  }

  reset() {
    this.buffer = Buffer.alloc(0);
  }

  getBufferedLength() {
    return this.buffer.length;
  }

  alignToFrameHeader() {
    const firstHeaderIndex = findFirstHeaderIndex(this.buffer);

    if (firstHeaderIndex === 0) {
      return true;
    }

    if (firstHeaderIndex > 0) {
      this.buffer = this.buffer.subarray(firstHeaderIndex);
      return true;
    }

    const suffixLength = getHeaderPrefixSuffixLength(this.buffer);
    this.buffer =
      suffixLength > 0 ? this.buffer.subarray(this.buffer.length - suffixLength) : Buffer.alloc(0);
    return false;
  }

  readFrameLength() {
    const frameHeader = readFrameHeader(this.buffer);

    if (frameHeader === FRAME_HEADERS.FUSE) {
      return FUSE_FRAME_LENGTH;
    }

    if (frameHeader === FRAME_HEADERS.DLZJ) {
      if (this.buffer.length < COMMON_HEADER_LENGTH) {
        return null;
      }

      const typeByte = this.buffer[6];
      const dataLength = this.buffer.readUInt16BE(COMMON_LENGTH_OFFSET);

      if (typeByte === 0x01) {
        const frameLength = COMMON_HEADER_LENGTH + dataLength + COMMON_FRAME_TAIL_LENGTH;

        return frameLength === 66 || frameLength === 71 ? frameLength : false;
      }

      if (typeByte === 0x02) {
        return COMMON_HEADER_LENGTH + dataLength + SENSOR_FRAME_TAIL_LENGTH;
      }

      return false;
    }

    if (frameHeader === FRAME_HEADERS.ECCN) {
      if (this.buffer.length < COMMON_HEADER_LENGTH) {
        return null;
      }

      const typeByte = this.buffer[6];

      if (typeByte !== 0x01 && typeByte !== 0x02) {
        return false;
      }

      const dataLength = this.buffer.readUInt16BE(COMMON_LENGTH_OFFSET);
      return COMMON_HEADER_LENGTH + dataLength + COMMON_FRAME_TAIL_LENGTH;
    }

    if (frameHeader === FRAME_HEADERS.IOTD) {
      if (this.buffer.length < IOTD_HEADER_LENGTH) {
        return null;
      }

      const dataLength = this.buffer.readUInt16BE(IOTD_LENGTH_OFFSET);
      return IOTD_HEADER_LENGTH + dataLength + COMMON_FRAME_TAIL_LENGTH;
    }

    return false;
  }
}

function createFrameRouter(options) {
  return new FrameRouter(options);
}

function classifyFrame(frame) {
  const frameHeader = readFrameHeader(frame);
  let frameType;
  let deviceAddress;
  let dataType;

  if (frameHeader === FRAME_HEADERS.FUSE) {
    frameType = "FUSE";
    deviceAddress = readUInt16Decimal(frame, 57);
    dataType = readByteHex(frame, 59);
  } else if (frameHeader === FRAME_HEADERS.DLZJ) {
    frameType = "HOST";
    deviceAddress = readUInt16Decimal(frame, 4);
    dataType = readByteHex(frame, 6);
  } else if (frameHeader === FRAME_HEADERS.ECCN) {
    frameType = "ECCN";
    deviceAddress = readUInt16Decimal(frame, 4);
    dataType = readByteHex(frame, 6);
  } else if (frameHeader === FRAME_HEADERS.IOTD) {
    frameType = "IOTD";
    deviceAddress = readUInt16Decimal(frame, 4);
    dataType = "*";
  } else {
    frameType = "unknown";
    deviceAddress = "";
    dataType = "";
  }

  return {
    frameHeader,
    frameType,
    deviceAddress,
    dataType,
    routeKey: `${frameType}:${deviceAddress}:${dataType}`,
  };
}

function readFrameHeader(buffer) {
  if (buffer.length < 4) {
    return "";
  }

  return buffer.subarray(0, 4).toString("hex").toUpperCase();
}

function readUInt16Decimal(buffer, offset) {
  if (buffer.length < offset + 2) {
    return "";
  }

  return String(buffer.readUInt16BE(offset));
}

function hasValidFrameTail(frame) {
  const frameHeader = readFrameHeader(frame);

  if (frameHeader === FRAME_HEADERS.FUSE) {
    return true;
  }

  if (frameHeader === FRAME_HEADERS.DLZJ && frame[6] === 0x02) {
    return frame.length >= 2 && frame.subarray(frame.length - 2).equals(Buffer.from("FCFC", "hex"));
  }

  return frame.length >= 1 && frame[frame.length - 1] === 0xfc;
}

function readByteHex(buffer, offset) {
  if (buffer.length < offset + 1) {
    return "";
  }

  return buffer.subarray(offset, offset + 1).toString("hex").toUpperCase();
}

function findFirstHeaderIndex(buffer) {
  let firstIndex = -1;

  for (const header of HEADER_BUFFERS) {
    const index = buffer.indexOf(header);

    if (index !== -1 && (firstIndex === -1 || index < firstIndex)) {
      firstIndex = index;
    }
  }

  return firstIndex;
}

function getHeaderPrefixSuffixLength(buffer) {
  const maxLength = Math.min(3, buffer.length);

  for (let length = maxLength; length > 0; length -= 1) {
    const suffix = buffer.subarray(buffer.length - length);

    if (HEADER_BUFFERS.some((header) => header.subarray(0, length).equals(suffix))) {
      return length;
    }
  }

  return 0;
}

module.exports = {
  FrameRouter,
  createFrameRouter,
  classifyFrame,
  FRAME_HEADERS,
};
