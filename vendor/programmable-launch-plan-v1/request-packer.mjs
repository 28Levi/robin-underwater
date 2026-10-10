#!/usr/bin/env node
// Manifest digest: sha256:3cd25308629f932d6a75e4a7694e6bcb67e4471fd2c1782d3b11ba5a7e3f8b61
// Offline declarations only. No network, compilation, signing or production authority.
/* Bundled dependency licenses
viem
MIT License

Copyright (c) 2023-present weth, LLC

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.


abitype
MIT License

Copyright (c) 2022-present weth, LLC

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.


@noble/hashes
The MIT License (MIT)

Copyright (c) 2022 Paul Miller (https://paulmillr.com)

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the “Software”), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in
all copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED “AS IS”, WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN
THE SOFTWARE.
*/
var __getOwnPropNames = Object.getOwnPropertyNames;
var __esm = (fn, res, err) => function() {
  if (err) throw err[0];
  try {
    return fn && (res = (0, fn[__getOwnPropNames(fn)[0]])(fn = 0)), res;
  } catch (e) {
    throw err = [e], e;
  }
};

// node_modules/viem/_esm/utils/data/isHex.js
function isHex(value, { strict = !0 } = {}) {
  return !value || typeof value != "string" ? !1 : strict ? /^0x[0-9a-fA-F]*$/.test(value) : value.startsWith("0x");
}
var init_isHex = __esm({
  "node_modules/viem/_esm/utils/data/isHex.js"() {
  }
});

// node_modules/viem/_esm/utils/data/size.js
function size(value) {
  return isHex(value, { strict: !1 }) ? Math.ceil((value.length - 2) / 2) : value.length;
}
var init_size = __esm({
  "node_modules/viem/_esm/utils/data/size.js"() {
    init_isHex();
  }
});

// node_modules/viem/_esm/errors/version.js
var version, init_version = __esm({
  "node_modules/viem/_esm/errors/version.js"() {
    version = "2.55.5";
  }
});

// node_modules/viem/_esm/errors/base.js
function walk(err, fn) {
  return fn?.(err) ? err : err && typeof err == "object" && "cause" in err && err.cause !== void 0 ? walk(err.cause, fn) : fn ? null : err;
}
var errorConfig, BaseError, init_base = __esm({
  "node_modules/viem/_esm/errors/base.js"() {
    init_version();
    errorConfig = {
      getDocsUrl: ({ docsBaseUrl, docsPath = "", docsSlug }) => docsPath ? `${docsBaseUrl ?? "https://viem.sh"}${docsPath}${docsSlug ? `#${docsSlug}` : ""}` : void 0,
      version: `viem@${version}`
    }, BaseError = class _BaseError extends Error {
      constructor(shortMessage, args = {}) {
        let details = args.cause instanceof _BaseError ? args.cause.details : args.cause?.message ? args.cause.message : args.details, docsPath = args.cause instanceof _BaseError && args.cause.docsPath || args.docsPath, docsUrl = errorConfig.getDocsUrl?.({ ...args, docsPath }), message = [
          shortMessage || "An error occurred.",
          "",
          ...args.metaMessages ? [...args.metaMessages, ""] : [],
          ...docsUrl ? [`Docs: ${docsUrl}`] : [],
          ...details ? [`Details: ${details}`] : [],
          ...errorConfig.version ? [`Version: ${errorConfig.version}`] : []
        ].join(`
`);
        super(message, args.cause ? { cause: args.cause } : void 0), Object.defineProperty(this, "details", {
          enumerable: !0,
          configurable: !0,
          writable: !0,
          value: void 0
        }), Object.defineProperty(this, "docsPath", {
          enumerable: !0,
          configurable: !0,
          writable: !0,
          value: void 0
        }), Object.defineProperty(this, "metaMessages", {
          enumerable: !0,
          configurable: !0,
          writable: !0,
          value: void 0
        }), Object.defineProperty(this, "shortMessage", {
          enumerable: !0,
          configurable: !0,
          writable: !0,
          value: void 0
        }), Object.defineProperty(this, "version", {
          enumerable: !0,
          configurable: !0,
          writable: !0,
          value: void 0
        }), Object.defineProperty(this, "name", {
          enumerable: !0,
          configurable: !0,
          writable: !0,
          value: "BaseError"
        }), this.details = details, this.docsPath = docsPath, this.metaMessages = args.metaMessages, this.name = args.name ?? this.name, this.shortMessage = shortMessage, this.version = version;
      }
      walk(fn) {
        return walk(this, fn);
      }
    };
  }
});

// node_modules/viem/_esm/errors/abi.js
var AbiEncodingArrayLengthMismatchError, AbiEncodingBytesSizeMismatchError, AbiEncodingLengthMismatchError, InvalidAbiEncodingTypeError, InvalidArrayError, init_abi = __esm({
  "node_modules/viem/_esm/errors/abi.js"() {
    init_size();
    init_base();
    AbiEncodingArrayLengthMismatchError = class extends BaseError {
      constructor({ expectedLength, givenLength, type }) {
        super([
          `ABI encoding array length mismatch for type ${type}.`,
          `Expected length: ${expectedLength}`,
          `Given length: ${givenLength}`
        ].join(`
`), { name: "AbiEncodingArrayLengthMismatchError" });
      }
    }, AbiEncodingBytesSizeMismatchError = class extends BaseError {
      constructor({ expectedSize, value }) {
        super(`Size of bytes "${value}" (bytes${size(value)}) does not match expected size (bytes${expectedSize}).`, { name: "AbiEncodingBytesSizeMismatchError" });
      }
    }, AbiEncodingLengthMismatchError = class extends BaseError {
      constructor({ expectedLength, givenLength }) {
        super([
          "ABI encoding params/values length mismatch.",
          `Expected length (params): ${expectedLength}`,
          `Given length (values): ${givenLength}`
        ].join(`
`), { name: "AbiEncodingLengthMismatchError" });
      }
    }, InvalidAbiEncodingTypeError = class extends BaseError {
      constructor(type, { docsPath }) {
        super([
          `Type "${type}" is not a valid encoding type.`,
          "Please provide a valid ABI type."
        ].join(`
`), { docsPath, name: "InvalidAbiEncodingType" });
      }
    }, InvalidArrayError = class extends BaseError {
      constructor(value) {
        super([`Value "${value}" is not a valid array.`].join(`
`), {
          name: "InvalidArrayError"
        });
      }
    };
  }
});

// node_modules/viem/_esm/errors/data.js
var SliceOffsetOutOfBoundsError, SizeExceedsPaddingSizeError, init_data = __esm({
  "node_modules/viem/_esm/errors/data.js"() {
    init_base();
    SliceOffsetOutOfBoundsError = class extends BaseError {
      constructor({ offset, position, size: size2 }) {
        super(`Slice ${position === "start" ? "starting" : "ending"} at offset "${offset}" is out-of-bounds (size: ${size2}).`, { name: "SliceOffsetOutOfBoundsError" });
      }
    }, SizeExceedsPaddingSizeError = class extends BaseError {
      constructor({ size: size2, targetSize, type }) {
        super(`${type.charAt(0).toUpperCase()}${type.slice(1).toLowerCase()} size (${size2}) exceeds padding size (${targetSize}).`, { name: "SizeExceedsPaddingSizeError" });
      }
    };
  }
});

// node_modules/viem/_esm/utils/data/pad.js
function pad(hexOrBytes, { dir, size: size2 = 32 } = {}) {
  return typeof hexOrBytes == "string" ? padHex(hexOrBytes, { dir, size: size2 }) : padBytes(hexOrBytes, { dir, size: size2 });
}
function padHex(hex_, { dir, size: size2 = 32 } = {}) {
  if (size2 === null)
    return hex_;
  let hex2 = hex_.replace("0x", "");
  if (hex2.length > size2 * 2)
    throw new SizeExceedsPaddingSizeError({
      size: Math.ceil(hex2.length / 2),
      targetSize: size2,
      type: "hex"
    });
  return `0x${hex2[dir === "right" ? "padEnd" : "padStart"](size2 * 2, "0")}`;
}
function padBytes(bytes, { dir, size: size2 = 32 } = {}) {
  if (size2 === null)
    return bytes;
  if (bytes.length > size2)
    throw new SizeExceedsPaddingSizeError({
      size: bytes.length,
      targetSize: size2,
      type: "bytes"
    });
  let paddedBytes = new Uint8Array(size2);
  for (let i = 0; i < size2; i++) {
    let padEnd = dir === "right";
    paddedBytes[padEnd ? i : size2 - i - 1] = bytes[padEnd ? i : bytes.length - i - 1];
  }
  return paddedBytes;
}
var init_pad = __esm({
  "node_modules/viem/_esm/utils/data/pad.js"() {
    init_data();
  }
});

// node_modules/viem/_esm/errors/encoding.js
var IntegerOutOfRangeError, SizeOverflowError, init_encoding = __esm({
  "node_modules/viem/_esm/errors/encoding.js"() {
    init_base();
    IntegerOutOfRangeError = class extends BaseError {
      constructor({ max, min, signed, size: size2, value }) {
        super(`Number "${value}" is not in safe ${size2 ? `${size2 * 8}-bit ${signed ? "signed" : "unsigned"} ` : ""}integer range ${max ? `(${min} to ${max})` : `(above ${min})`}`, { name: "IntegerOutOfRangeError" });
      }
    }, SizeOverflowError = class extends BaseError {
      constructor({ givenSize, maxSize }) {
        super(`Size cannot exceed ${maxSize} bytes. Given size: ${givenSize} bytes.`, { name: "SizeOverflowError" });
      }
    };
  }
});

// node_modules/viem/_esm/utils/encoding/fromHex.js
function assertSize(hexOrBytes, { size: size2 }) {
  if (size(hexOrBytes) > size2)
    throw new SizeOverflowError({
      givenSize: size(hexOrBytes),
      maxSize: size2
    });
}
var init_fromHex = __esm({
  "node_modules/viem/_esm/utils/encoding/fromHex.js"() {
    init_encoding();
    init_size();
  }
});

// node_modules/viem/_esm/utils/encoding/toHex.js
function toHex(value, opts = {}) {
  return typeof value == "number" || typeof value == "bigint" ? numberToHex(value, opts) : typeof value == "string" ? stringToHex(value, opts) : typeof value == "boolean" ? boolToHex(value, opts) : bytesToHex(value, opts);
}
function boolToHex(value, opts = {}) {
  let hex2 = `0x${Number(value)}`;
  return typeof opts.size == "number" ? (assertSize(hex2, { size: opts.size }), pad(hex2, { size: opts.size })) : hex2;
}
function bytesToHex(value, opts = {}) {
  let string = "";
  for (let i = 0; i < value.length; i++)
    string += hexes[value[i]];
  let hex2 = `0x${string}`;
  return typeof opts.size == "number" ? (assertSize(hex2, { size: opts.size }), pad(hex2, { dir: "right", size: opts.size })) : hex2;
}
function numberToHex(value_, opts = {}) {
  let { signed, size: size2 } = opts, value = BigInt(value_), maxValue;
  size2 ? signed ? maxValue = (1n << BigInt(size2) * 8n - 1n) - 1n : maxValue = 2n ** (BigInt(size2) * 8n) - 1n : typeof value_ == "number" && (maxValue = BigInt(Number.MAX_SAFE_INTEGER));
  let minValue = typeof maxValue == "bigint" && signed ? -maxValue - 1n : 0;
  if (maxValue && value > maxValue || value < minValue) {
    let suffix = typeof value_ == "bigint" ? "n" : "";
    throw new IntegerOutOfRangeError({
      max: maxValue ? `${maxValue}${suffix}` : void 0,
      min: `${minValue}${suffix}`,
      signed,
      size: size2,
      value: `${value_}${suffix}`
    });
  }
  let hex2 = `0x${(signed && value < 0 ? (1n << BigInt(size2 * 8)) + BigInt(value) : value).toString(16)}`;
  return size2 ? pad(hex2, { size: size2 }) : hex2;
}
function stringToHex(value_, opts = {}) {
  let value = encoder.encode(value_);
  return bytesToHex(value, opts);
}
var hexes, encoder, init_toHex = __esm({
  "node_modules/viem/_esm/utils/encoding/toHex.js"() {
    init_encoding();
    init_pad();
    init_fromHex();
    hexes = /* @__PURE__ */ Array.from({ length: 256 }, (_v, i) => i.toString(16).padStart(2, "0"));
    encoder = /* @__PURE__ */ new TextEncoder();
  }
});

// node_modules/viem/_esm/utils/encoding/toBytes.js
function toBytes(value, opts = {}) {
  return typeof value == "number" || typeof value == "bigint" ? numberToBytes(value, opts) : typeof value == "boolean" ? boolToBytes(value, opts) : isHex(value) ? hexToBytes(value, opts) : stringToBytes(value, opts);
}
function boolToBytes(value, opts = {}) {
  let bytes = new Uint8Array(1);
  return bytes[0] = Number(value), typeof opts.size == "number" ? (assertSize(bytes, { size: opts.size }), pad(bytes, { size: opts.size })) : bytes;
}
function charCodeToBase16(char) {
  if (char >= charCodeMap.zero && char <= charCodeMap.nine)
    return char - charCodeMap.zero;
  if (char >= charCodeMap.A && char <= charCodeMap.F)
    return char - (charCodeMap.A - 10);
  if (char >= charCodeMap.a && char <= charCodeMap.f)
    return char - (charCodeMap.a - 10);
}
function hexToBytes(hex_, opts = {}) {
  let hex2 = hex_;
  opts.size && (assertSize(hex2, { size: opts.size }), hex2 = pad(hex2, { dir: "right", size: opts.size }));
  let hexString = hex2.slice(2);
  hexString.length % 2 && (hexString = `0${hexString}`);
  let length = hexString.length / 2, bytes = new Uint8Array(length);
  for (let index = 0, j = 0; index < length; index++) {
    let nibbleLeft = charCodeToBase16(hexString.charCodeAt(j++)), nibbleRight = charCodeToBase16(hexString.charCodeAt(j++));
    if (nibbleLeft === void 0 || nibbleRight === void 0)
      throw new BaseError(`Invalid byte sequence ("${hexString[j - 2]}${hexString[j - 1]}" in "${hexString}").`);
    bytes[index] = nibbleLeft * 16 + nibbleRight;
  }
  return bytes;
}
function numberToBytes(value, opts) {
  let hex2 = numberToHex(value, opts);
  return hexToBytes(hex2);
}
function stringToBytes(value, opts = {}) {
  let bytes = encoder2.encode(value);
  return typeof opts.size == "number" ? (assertSize(bytes, { size: opts.size }), pad(bytes, { dir: "right", size: opts.size })) : bytes;
}
var encoder2, charCodeMap, init_toBytes = __esm({
  "node_modules/viem/_esm/utils/encoding/toBytes.js"() {
    init_base();
    init_isHex();
    init_pad();
    init_fromHex();
    init_toHex();
    encoder2 = /* @__PURE__ */ new TextEncoder();
    charCodeMap = {
      zero: 48,
      nine: 57,
      A: 65,
      F: 70,
      a: 97,
      f: 102
    };
  }
});

// node_modules/@noble/hashes/esm/_u64.js
function fromBig(n, le = !1) {
  return le ? { h: Number(n & U32_MASK64), l: Number(n >> _32n & U32_MASK64) } : { h: Number(n >> _32n & U32_MASK64) | 0, l: Number(n & U32_MASK64) | 0 };
}
function split(lst, le = !1) {
  let len = lst.length, Ah = new Uint32Array(len), Al = new Uint32Array(len);
  for (let i = 0; i < len; i++) {
    let { h, l } = fromBig(lst[i], le);
    [Ah[i], Al[i]] = [h, l];
  }
  return [Ah, Al];
}
var U32_MASK64, _32n, rotlSH, rotlSL, rotlBH, rotlBL, init_u64 = __esm({
  "node_modules/@noble/hashes/esm/_u64.js"() {
    U32_MASK64 = /* @__PURE__ */ BigInt(4294967295), _32n = /* @__PURE__ */ BigInt(32);
    rotlSH = (h, l, s) => h << s | l >>> 32 - s, rotlSL = (h, l, s) => l << s | h >>> 32 - s, rotlBH = (h, l, s) => l << s - 32 | h >>> 64 - s, rotlBL = (h, l, s) => h << s - 32 | l >>> 64 - s;
  }
});

// node_modules/@noble/hashes/esm/utils.js
function isBytes(a) {
  return a instanceof Uint8Array || ArrayBuffer.isView(a) && a.constructor.name === "Uint8Array";
}
function anumber(n) {
  if (!Number.isSafeInteger(n) || n < 0)
    throw new Error("positive integer expected, got " + n);
}
function abytes(b, ...lengths) {
  if (!isBytes(b))
    throw new Error("Uint8Array expected");
  if (lengths.length > 0 && !lengths.includes(b.length))
    throw new Error("Uint8Array expected of length " + lengths + ", got length=" + b.length);
}
function aexists(instance, checkFinished = !0) {
  if (instance.destroyed)
    throw new Error("Hash instance has been destroyed");
  if (checkFinished && instance.finished)
    throw new Error("Hash#digest() has already been called");
}
function aoutput(out, instance) {
  abytes(out);
  let min = instance.outputLen;
  if (out.length < min)
    throw new Error("digestInto() expects output buffer of length at least " + min);
}
function u32(arr) {
  return new Uint32Array(arr.buffer, arr.byteOffset, Math.floor(arr.byteLength / 4));
}
function clean(...arrays) {
  for (let i = 0; i < arrays.length; i++)
    arrays[i].fill(0);
}
function byteSwap(word) {
  return word << 24 & 4278190080 | word << 8 & 16711680 | word >>> 8 & 65280 | word >>> 24 & 255;
}
function byteSwap32(arr) {
  for (let i = 0; i < arr.length; i++)
    arr[i] = byteSwap(arr[i]);
  return arr;
}
function utf8ToBytes(str2) {
  if (typeof str2 != "string")
    throw new Error("string expected");
  return new Uint8Array(new TextEncoder().encode(str2));
}
function toBytes2(data) {
  return typeof data == "string" && (data = utf8ToBytes(data)), abytes(data), data;
}
function createHasher(hashCons) {
  let hashC = (msg) => hashCons().update(toBytes2(msg)).digest(), tmp = hashCons();
  return hashC.outputLen = tmp.outputLen, hashC.blockLen = tmp.blockLen, hashC.create = () => hashCons(), hashC;
}
var isLE, swap32IfBE, Hash, init_utils = __esm({
  "node_modules/@noble/hashes/esm/utils.js"() {
    /*! noble-hashes - MIT License (c) 2022 Paul Miller (paulmillr.com) */
    isLE = new Uint8Array(new Uint32Array([287454020]).buffer)[0] === 68;
    swap32IfBE = isLE ? (u) => u : byteSwap32;
    Hash = class {
    };
  }
});

// node_modules/@noble/hashes/esm/sha3.js
function keccakP(s, rounds = 24) {
  let B = new Uint32Array(10);
  for (let round = 24 - rounds; round < 24; round++) {
    for (let x = 0; x < 10; x++)
      B[x] = s[x] ^ s[x + 10] ^ s[x + 20] ^ s[x + 30] ^ s[x + 40];
    for (let x = 0; x < 10; x += 2) {
      let idx1 = (x + 8) % 10, idx0 = (x + 2) % 10, B0 = B[idx0], B1 = B[idx0 + 1], Th = rotlH(B0, B1, 1) ^ B[idx1], Tl = rotlL(B0, B1, 1) ^ B[idx1 + 1];
      for (let y = 0; y < 50; y += 10)
        s[x + y] ^= Th, s[x + y + 1] ^= Tl;
    }
    let curH = s[2], curL = s[3];
    for (let t = 0; t < 24; t++) {
      let shift = SHA3_ROTL[t], Th = rotlH(curH, curL, shift), Tl = rotlL(curH, curL, shift), PI = SHA3_PI[t];
      curH = s[PI], curL = s[PI + 1], s[PI] = Th, s[PI + 1] = Tl;
    }
    for (let y = 0; y < 50; y += 10) {
      for (let x = 0; x < 10; x++)
        B[x] = s[y + x];
      for (let x = 0; x < 10; x++)
        s[y + x] ^= ~B[(x + 2) % 10] & B[(x + 4) % 10];
    }
    s[0] ^= SHA3_IOTA_H[round], s[1] ^= SHA3_IOTA_L[round];
  }
  clean(B);
}
var _0n, _1n, _2n, _7n, _256n, _0x71n, SHA3_PI, SHA3_ROTL, _SHA3_IOTA, IOTAS, SHA3_IOTA_H, SHA3_IOTA_L, rotlH, rotlL, Keccak, gen, keccak_256, init_sha3 = __esm({
  "node_modules/@noble/hashes/esm/sha3.js"() {
    init_u64();
    init_utils();
    _0n = BigInt(0), _1n = BigInt(1), _2n = BigInt(2), _7n = BigInt(7), _256n = BigInt(256), _0x71n = BigInt(113), SHA3_PI = [], SHA3_ROTL = [], _SHA3_IOTA = [];
    for (let round = 0, R = _1n, x = 1, y = 0; round < 24; round++) {
      [x, y] = [y, (2 * x + 3 * y) % 5], SHA3_PI.push(2 * (5 * y + x)), SHA3_ROTL.push((round + 1) * (round + 2) / 2 % 64);
      let t = _0n;
      for (let j = 0; j < 7; j++)
        R = (R << _1n ^ (R >> _7n) * _0x71n) % _256n, R & _2n && (t ^= _1n << (_1n << /* @__PURE__ */ BigInt(j)) - _1n);
      _SHA3_IOTA.push(t);
    }
    IOTAS = split(_SHA3_IOTA, !0), SHA3_IOTA_H = IOTAS[0], SHA3_IOTA_L = IOTAS[1], rotlH = (h, l, s) => s > 32 ? rotlBH(h, l, s) : rotlSH(h, l, s), rotlL = (h, l, s) => s > 32 ? rotlBL(h, l, s) : rotlSL(h, l, s);
    Keccak = class _Keccak extends Hash {
      // NOTE: we accept arguments in bytes instead of bits here.
      constructor(blockLen, suffix, outputLen, enableXOF = !1, rounds = 24) {
        if (super(), this.pos = 0, this.posOut = 0, this.finished = !1, this.destroyed = !1, this.enableXOF = !1, this.blockLen = blockLen, this.suffix = suffix, this.outputLen = outputLen, this.enableXOF = enableXOF, this.rounds = rounds, anumber(outputLen), !(0 < blockLen && blockLen < 200))
          throw new Error("only keccak-f1600 function is supported");
        this.state = new Uint8Array(200), this.state32 = u32(this.state);
      }
      clone() {
        return this._cloneInto();
      }
      keccak() {
        swap32IfBE(this.state32), keccakP(this.state32, this.rounds), swap32IfBE(this.state32), this.posOut = 0, this.pos = 0;
      }
      update(data) {
        aexists(this), data = toBytes2(data), abytes(data);
        let { blockLen, state } = this, len = data.length;
        for (let pos = 0; pos < len; ) {
          let take = Math.min(blockLen - this.pos, len - pos);
          for (let i = 0; i < take; i++)
            state[this.pos++] ^= data[pos++];
          this.pos === blockLen && this.keccak();
        }
        return this;
      }
      finish() {
        if (this.finished)
          return;
        this.finished = !0;
        let { state, suffix, pos, blockLen } = this;
        state[pos] ^= suffix, (suffix & 128) !== 0 && pos === blockLen - 1 && this.keccak(), state[blockLen - 1] ^= 128, this.keccak();
      }
      writeInto(out) {
        aexists(this, !1), abytes(out), this.finish();
        let bufferOut = this.state, { blockLen } = this;
        for (let pos = 0, len = out.length; pos < len; ) {
          this.posOut >= blockLen && this.keccak();
          let take = Math.min(blockLen - this.posOut, len - pos);
          out.set(bufferOut.subarray(this.posOut, this.posOut + take), pos), this.posOut += take, pos += take;
        }
        return out;
      }
      xofInto(out) {
        if (!this.enableXOF)
          throw new Error("XOF is not possible for this instance");
        return this.writeInto(out);
      }
      xof(bytes) {
        return anumber(bytes), this.xofInto(new Uint8Array(bytes));
      }
      digestInto(out) {
        if (aoutput(out, this), this.finished)
          throw new Error("digest() was already called");
        return this.writeInto(out), this.destroy(), out;
      }
      digest() {
        return this.digestInto(new Uint8Array(this.outputLen));
      }
      destroy() {
        this.destroyed = !0, clean(this.state);
      }
      _cloneInto(to) {
        let { blockLen, suffix, outputLen, rounds, enableXOF } = this;
        return to || (to = new _Keccak(blockLen, suffix, outputLen, enableXOF, rounds)), to.state32.set(this.state32), to.pos = this.pos, to.posOut = this.posOut, to.finished = this.finished, to.rounds = rounds, to.suffix = suffix, to.outputLen = outputLen, to.enableXOF = enableXOF, to.destroyed = this.destroyed, to;
      }
    }, gen = (suffix, blockLen, outputLen) => createHasher(() => new Keccak(blockLen, suffix, outputLen)), keccak_256 = gen(1, 136, 256 / 8);
  }
});

// node_modules/viem/_esm/utils/hash/keccak256.js
function keccak256(value, to_) {
  let to = to_ || "hex", bytes = keccak_256(isHex(value, { strict: !1 }) ? toBytes(value) : value);
  return to === "bytes" ? bytes : toHex(bytes);
}
var init_keccak256 = __esm({
  "node_modules/viem/_esm/utils/hash/keccak256.js"() {
    init_sha3();
    init_isHex();
    init_toBytes();
    init_toHex();
  }
});

// node_modules/viem/_esm/errors/address.js
var InvalidAddressError, init_address = __esm({
  "node_modules/viem/_esm/errors/address.js"() {
    init_base();
    InvalidAddressError = class extends BaseError {
      constructor({ address: address2 }) {
        super(`Address "${address2}" is invalid.`, {
          metaMessages: [
            "- Address must be a hex value of 20 bytes (40 hex characters).",
            "- Address must match its checksum counterpart."
          ],
          name: "InvalidAddressError"
        });
      }
    };
  }
});

// node_modules/viem/_esm/utils/lru.js
var LruMap, init_lru = __esm({
  "node_modules/viem/_esm/utils/lru.js"() {
    LruMap = class extends Map {
      constructor(size2) {
        super(), Object.defineProperty(this, "maxSize", {
          enumerable: !0,
          configurable: !0,
          writable: !0,
          value: void 0
        }), this.maxSize = size2;
      }
      get(key) {
        let value = super.get(key);
        return super.has(key) && (super.delete(key), super.set(key, value)), value;
      }
      set(key, value) {
        if (super.has(key) && super.delete(key), super.set(key, value), this.maxSize && this.size > this.maxSize) {
          let firstKey = super.keys().next().value;
          firstKey !== void 0 && super.delete(firstKey);
        }
        return this;
      }
    };
  }
});

// node_modules/viem/_esm/utils/address/getAddress.js
function checksumAddress(address_, chainId) {
  if (checksumAddressCache.has(`${address_}.${chainId}`))
    return checksumAddressCache.get(`${address_}.${chainId}`);
  let hexAddress = chainId ? `${chainId}${address_.toLowerCase()}` : address_.substring(2).toLowerCase(), hash = keccak256(stringToBytes(hexAddress), "bytes"), address2 = (chainId ? hexAddress.substring(`${chainId}0x`.length) : hexAddress).split("");
  for (let i = 0; i < 40; i += 2)
    hash[i >> 1] >> 4 >= 8 && address2[i] && (address2[i] = address2[i].toUpperCase()), (hash[i >> 1] & 15) >= 8 && address2[i + 1] && (address2[i + 1] = address2[i + 1].toUpperCase());
  let result = `0x${address2.join("")}`;
  return checksumAddressCache.set(`${address_}.${chainId}`, result), result;
}
function getAddress(address2, chainId) {
  if (!isAddress(address2, { strict: !1 }))
    throw new InvalidAddressError({ address: address2 });
  return checksumAddress(address2, chainId);
}
var checksumAddressCache, init_getAddress = __esm({
  "node_modules/viem/_esm/utils/address/getAddress.js"() {
    init_address();
    init_toBytes();
    init_keccak256();
    init_lru();
    init_isAddress();
    checksumAddressCache = /* @__PURE__ */ new LruMap(8192);
  }
});

// node_modules/viem/_esm/utils/address/isAddress.js
function isAddress(address2, options) {
  let { strict = !0 } = options ?? {}, cacheKey = `${address2}.${strict}`;
  if (isAddressCache.has(cacheKey))
    return isAddressCache.get(cacheKey);
  let result = addressRegex.test(address2) ? address2.toLowerCase() === address2 ? !0 : strict ? checksumAddress(address2) === address2 : !0 : !1;
  return isAddressCache.set(cacheKey, result), result;
}
var addressRegex, isAddressCache, init_isAddress = __esm({
  "node_modules/viem/_esm/utils/address/isAddress.js"() {
    init_lru();
    init_getAddress();
    addressRegex = /^0x[a-fA-F0-9]{40}$/, isAddressCache = /* @__PURE__ */ new LruMap(8192);
  }
});

// node_modules/viem/_esm/utils/data/concat.js
function concat(values) {
  return typeof values[0] == "string" ? concatHex(values) : concatBytes(values);
}
function concatBytes(values) {
  let length = 0;
  for (let arr of values)
    length += arr.length;
  let result = new Uint8Array(length), offset = 0;
  for (let arr of values)
    result.set(arr, offset), offset += arr.length;
  return result;
}
function concatHex(values) {
  return `0x${values.reduce((acc, x) => acc + x.replace("0x", ""), "")}`;
}
var init_concat = __esm({
  "node_modules/viem/_esm/utils/data/concat.js"() {
  }
});

// node_modules/viem/_esm/utils/data/slice.js
function slice(value, start, end, { strict } = {}) {
  return isHex(value, { strict: !1 }) ? sliceHex(value, start, end, {
    strict
  }) : sliceBytes(value, start, end, {
    strict
  });
}
function assertStartOffset(value, start) {
  if (typeof start == "number" && start > 0 && start > size(value) - 1)
    throw new SliceOffsetOutOfBoundsError({
      offset: start,
      position: "start",
      size: size(value)
    });
}
function assertEndOffset(value, start, end) {
  if (typeof start == "number" && typeof end == "number" && size(value) !== end - start)
    throw new SliceOffsetOutOfBoundsError({
      offset: end,
      position: "end",
      size: size(value)
    });
}
function sliceBytes(value_, start, end, { strict } = {}) {
  assertStartOffset(value_, start);
  let value = value_.slice(start, end);
  return strict && assertEndOffset(value, start, end), value;
}
function sliceHex(value_, start, end, { strict } = {}) {
  assertStartOffset(value_, start);
  let value = `0x${value_.replace("0x", "").slice((start ?? 0) * 2, (end ?? value_.length) * 2)}`;
  return strict && assertEndOffset(value, start, end), value;
}
var init_slice = __esm({
  "node_modules/viem/_esm/utils/data/slice.js"() {
    init_data();
    init_isHex();
    init_size();
  }
});

// node_modules/viem/_esm/utils/regex.js
var integerRegex, init_regex = __esm({
  "node_modules/viem/_esm/utils/regex.js"() {
    integerRegex = /^(u?int)(8|16|24|32|40|48|56|64|72|80|88|96|104|112|120|128|136|144|152|160|168|176|184|192|200|208|216|224|232|240|248|256)?$/;
  }
});

// node_modules/viem/_esm/utils/abi/encodeAbiParameters.js
function encodeAbiParameters(params, values) {
  if (params.length !== values.length)
    throw new AbiEncodingLengthMismatchError({
      expectedLength: params.length,
      givenLength: values.length
    });
  let preparedParams = prepareParams({
    params,
    values
  });
  return encodeParams(preparedParams);
}
function prepareParams({ params, values }) {
  let preparedParams = [];
  for (let i = 0; i < params.length; i++)
    preparedParams.push(prepareParam({ param: params[i], value: values[i] }));
  return preparedParams;
}
function prepareParam({ param, value }) {
  let arrayComponents = getArrayComponents(param.type);
  if (arrayComponents) {
    let [length, type] = arrayComponents;
    return encodeArray(value, { length, param: { ...param, type } });
  }
  if (param.type === "tuple")
    return encodeTuple(value, {
      param
    });
  if (param.type === "address")
    return encodeAddress(value);
  if (param.type === "bool")
    return encodeBool(value);
  if (param.type.startsWith("uint") || param.type.startsWith("int")) {
    let signed = param.type.startsWith("int"), [, , size2 = "256"] = integerRegex.exec(param.type) ?? [];
    return encodeNumber(value, {
      signed,
      size: Number(size2)
    });
  }
  if (param.type.startsWith("bytes"))
    return encodeBytes(value, { param });
  if (param.type === "string")
    return encodeString(value);
  throw new InvalidAbiEncodingTypeError(param.type, {
    docsPath: "/docs/contract/encodeAbiParameters"
  });
}
function encodeParams(preparedParams) {
  let staticSize = 0;
  for (let i = 0; i < preparedParams.length; i++) {
    let { dynamic, encoded } = preparedParams[i];
    dynamic ? staticSize += 32 : staticSize += size(encoded);
  }
  let staticParams = [], dynamicParams = [], dynamicSize = 0;
  for (let i = 0; i < preparedParams.length; i++) {
    let { dynamic, encoded } = preparedParams[i];
    dynamic ? (staticParams.push(numberToHex(staticSize + dynamicSize, { size: 32 })), dynamicParams.push(encoded), dynamicSize += size(encoded)) : staticParams.push(encoded);
  }
  return concatHex([...staticParams, ...dynamicParams]);
}
function encodeAddress(value) {
  if (!isAddress(value))
    throw new InvalidAddressError({ address: value });
  return { dynamic: !1, encoded: padHex(value.toLowerCase()) };
}
function encodeArray(value, { length, param }) {
  let dynamic = length === null;
  if (!Array.isArray(value))
    throw new InvalidArrayError(value);
  if (!dynamic && value.length !== length)
    throw new AbiEncodingArrayLengthMismatchError({
      expectedLength: length,
      givenLength: value.length,
      type: `${param.type}[${length}]`
    });
  let dynamicChild = value.length === 0 && isDynamicType(param), preparedParams = [];
  for (let i = 0; i < value.length; i++) {
    let preparedParam = prepareParam({ param, value: value[i] });
    preparedParam.dynamic && (dynamicChild = !0), preparedParams.push(preparedParam);
  }
  if (dynamic || dynamicChild) {
    let data = encodeParams(preparedParams);
    if (dynamic) {
      let length2 = numberToHex(preparedParams.length, { size: 32 });
      return {
        dynamic: !0,
        encoded: concatHex([length2, data])
      };
    }
    if (dynamicChild)
      return { dynamic: !0, encoded: data };
  }
  return {
    dynamic: !1,
    encoded: concatHex(preparedParams.map(({ encoded }) => encoded))
  };
}
function encodeBytes(value, { param }) {
  let [, paramSize] = param.type.split("bytes"), bytesSize = size(value);
  if (!paramSize) {
    let value_ = value;
    return bytesSize % 32 !== 0 && (value_ = padHex(value_, {
      dir: "right",
      size: Math.ceil((value.length - 2) / 2 / 32) * 32
    })), {
      dynamic: !0,
      encoded: concatHex([
        padHex(numberToHex(bytesSize, { size: 32 })),
        value_
      ])
    };
  }
  if (bytesSize !== Number.parseInt(paramSize, 10))
    throw new AbiEncodingBytesSizeMismatchError({
      expectedSize: Number.parseInt(paramSize, 10),
      value
    });
  return { dynamic: !1, encoded: padHex(value, { dir: "right" }) };
}
function encodeBool(value) {
  if (typeof value != "boolean")
    throw new BaseError(`Invalid boolean value: "${value}" (type: ${typeof value}). Expected: \`true\` or \`false\`.`);
  return { dynamic: !1, encoded: padHex(boolToHex(value)) };
}
function encodeNumber(value, { signed, size: size2 = 256 }) {
  if (typeof size2 == "number") {
    let max = 2n ** (BigInt(size2) - (signed ? 1n : 0n)) - 1n, min = signed ? -max - 1n : 0n;
    if (value > max || value < min)
      throw new IntegerOutOfRangeError({
        max: max.toString(),
        min: min.toString(),
        signed,
        size: size2 / 8,
        value: value.toString()
      });
  }
  return {
    dynamic: !1,
    encoded: numberToHex(value, {
      size: 32,
      signed
    })
  };
}
function encodeString(value) {
  let hexValue = stringToHex(value), partsLength = Math.ceil(size(hexValue) / 32), parts = [];
  for (let i = 0; i < partsLength; i++)
    parts.push(padHex(slice(hexValue, i * 32, (i + 1) * 32), {
      dir: "right"
    }));
  return {
    dynamic: !0,
    encoded: concatHex([
      padHex(numberToHex(size(hexValue), { size: 32 })),
      ...parts
    ])
  };
}
function encodeTuple(value, { param }) {
  let dynamic = !1, preparedParams = [];
  for (let i = 0; i < param.components.length; i++) {
    let param_ = param.components[i], index = Array.isArray(value) ? i : param_.name, preparedParam = prepareParam({
      param: param_,
      value: value[index]
    });
    preparedParams.push(preparedParam), preparedParam.dynamic && (dynamic = !0);
  }
  return {
    dynamic,
    encoded: dynamic ? encodeParams(preparedParams) : concatHex(preparedParams.map(({ encoded }) => encoded))
  };
}
function getArrayComponents(type) {
  let matches = type.match(/^(.*)\[(\d+)?\]$/);
  return matches ? (
    // Return `null` if the array is dynamic.
    [matches[2] ? Number(matches[2]) : null, matches[1]]
  ) : void 0;
}
function isDynamicType(param) {
  let { type } = param;
  if (type === "string" || type === "bytes" || type.endsWith("[]"))
    return !0;
  if (type === "tuple")
    return param.components.some(isDynamicType);
  let arrayComponents = getArrayComponents(type);
  return arrayComponents ? isDynamicType({ ...param, type: arrayComponents[1] }) : !1;
}
var init_encodeAbiParameters = __esm({
  "node_modules/viem/_esm/utils/abi/encodeAbiParameters.js"() {
    init_abi();
    init_address();
    init_base();
    init_encoding();
    init_isAddress();
    init_concat();
    init_pad();
    init_size();
    init_slice();
    init_toHex();
    init_regex();
  }
});

// node_modules/viem/_esm/errors/cursor.js
var NegativeOffsetError, PositionOutOfBoundsError, RecursiveReadLimitExceededError, init_cursor = __esm({
  "node_modules/viem/_esm/errors/cursor.js"() {
    init_base();
    NegativeOffsetError = class extends BaseError {
      constructor({ offset }) {
        super(`Offset \`${offset}\` cannot be negative.`, {
          name: "NegativeOffsetError"
        });
      }
    }, PositionOutOfBoundsError = class extends BaseError {
      constructor({ length, position }) {
        super(`Position \`${position}\` is out of bounds (\`0 < position < ${length}\`).`, { name: "PositionOutOfBoundsError" });
      }
    }, RecursiveReadLimitExceededError = class extends BaseError {
      constructor({ count, limit }) {
        super(`Recursive read limit of \`${limit}\` exceeded (recursive read count: \`${count}\`).`, { name: "RecursiveReadLimitExceededError" });
      }
    };
  }
});

// node_modules/viem/_esm/utils/cursor.js
function createCursor(bytes, { recursiveReadLimit = 8192 } = {}) {
  let cursor = Object.create(staticCursor);
  return cursor.bytes = bytes, cursor.dataView = new DataView(bytes.buffer ?? bytes, bytes.byteOffset, bytes.byteLength), cursor.positionReadCount = /* @__PURE__ */ new Map(), cursor.recursiveReadLimit = recursiveReadLimit, cursor;
}
var staticCursor, init_cursor2 = __esm({
  "node_modules/viem/_esm/utils/cursor.js"() {
    init_cursor();
    staticCursor = {
      bytes: new Uint8Array(),
      dataView: new DataView(new ArrayBuffer(0)),
      position: 0,
      positionReadCount: /* @__PURE__ */ new Map(),
      recursiveReadCount: 0,
      recursiveReadLimit: Number.POSITIVE_INFINITY,
      assertReadLimit() {
        if (this.recursiveReadCount >= this.recursiveReadLimit)
          throw new RecursiveReadLimitExceededError({
            count: this.recursiveReadCount + 1,
            limit: this.recursiveReadLimit
          });
      },
      assertPosition(position) {
        if (position < 0 || position > this.bytes.length - 1)
          throw new PositionOutOfBoundsError({
            length: this.bytes.length,
            position
          });
      },
      decrementPosition(offset) {
        if (offset < 0)
          throw new NegativeOffsetError({ offset });
        let position = this.position - offset;
        this.assertPosition(position), this.position = position;
      },
      getReadCount(position) {
        return this.positionReadCount.get(position || this.position) || 0;
      },
      incrementPosition(offset) {
        if (offset < 0)
          throw new NegativeOffsetError({ offset });
        let position = this.position + offset;
        this.assertPosition(position), this.position = position;
      },
      inspectByte(position_) {
        let position = position_ ?? this.position;
        return this.assertPosition(position), this.bytes[position];
      },
      inspectBytes(length, position_) {
        let position = position_ ?? this.position;
        return this.assertPosition(position + length - 1), this.bytes.subarray(position, position + length);
      },
      inspectUint8(position_) {
        let position = position_ ?? this.position;
        return this.assertPosition(position), this.bytes[position];
      },
      inspectUint16(position_) {
        let position = position_ ?? this.position;
        return this.assertPosition(position + 1), this.dataView.getUint16(position);
      },
      inspectUint24(position_) {
        let position = position_ ?? this.position;
        return this.assertPosition(position + 2), (this.dataView.getUint16(position) << 8) + this.dataView.getUint8(position + 2);
      },
      inspectUint32(position_) {
        let position = position_ ?? this.position;
        return this.assertPosition(position + 3), this.dataView.getUint32(position);
      },
      pushByte(byte) {
        this.assertPosition(this.position), this.bytes[this.position] = byte, this.position++;
      },
      pushBytes(bytes) {
        this.assertPosition(this.position + bytes.length - 1), this.bytes.set(bytes, this.position), this.position += bytes.length;
      },
      pushUint8(value) {
        this.assertPosition(this.position), this.bytes[this.position] = value, this.position++;
      },
      pushUint16(value) {
        this.assertPosition(this.position + 1), this.dataView.setUint16(this.position, value), this.position += 2;
      },
      pushUint24(value) {
        this.assertPosition(this.position + 2), this.dataView.setUint16(this.position, value >> 8), this.dataView.setUint8(this.position + 2, value & 255), this.position += 3;
      },
      pushUint32(value) {
        this.assertPosition(this.position + 3), this.dataView.setUint32(this.position, value), this.position += 4;
      },
      readByte() {
        this.assertReadLimit(), this._touch();
        let value = this.inspectByte();
        return this.position++, value;
      },
      readBytes(length, size2) {
        this.assertReadLimit(), this._touch();
        let value = this.inspectBytes(length);
        return this.position += size2 ?? length, value;
      },
      readUint8() {
        this.assertReadLimit(), this._touch();
        let value = this.inspectUint8();
        return this.position += 1, value;
      },
      readUint16() {
        this.assertReadLimit(), this._touch();
        let value = this.inspectUint16();
        return this.position += 2, value;
      },
      readUint24() {
        this.assertReadLimit(), this._touch();
        let value = this.inspectUint24();
        return this.position += 3, value;
      },
      readUint32() {
        this.assertReadLimit(), this._touch();
        let value = this.inspectUint32();
        return this.position += 4, value;
      },
      get remaining() {
        return this.bytes.length - this.position;
      },
      setPosition(position) {
        let oldPosition = this.position;
        return this.assertPosition(position), this.position = position, () => this.position = oldPosition;
      },
      _touch() {
        if (this.recursiveReadLimit === Number.POSITIVE_INFINITY)
          return;
        let count = this.getReadCount();
        this.positionReadCount.set(this.position, count + 1), count > 0 && this.recursiveReadCount++;
      }
    };
  }
});

// src/client/custom-launch-plan-packer-cli-v1.ts
import { constants } from "node:fs";
import { open } from "node:fs/promises";
import { pathToFileURL } from "node:url";

// src/launch/canonical-v1.ts
import { createHash } from "node:crypto";

// node_modules/viem/_esm/utils/encoding/toRlp.js
init_base();
init_cursor2();
init_toBytes();
init_toHex();
function toRlp(bytes, to = "hex") {
  let encodable = getEncodable(bytes), cursor = createCursor(new Uint8Array(encodable.length));
  return encodable.encode(cursor), to === "hex" ? bytesToHex(cursor.bytes) : cursor.bytes;
}
function getEncodable(bytes) {
  return Array.isArray(bytes) ? getEncodableList(bytes.map((x) => getEncodable(x))) : getEncodableBytes(bytes);
}
function getEncodableList(list) {
  let bodyLength = list.reduce((acc, x) => acc + x.length, 0), sizeOfBodyLength = getSizeOfLength(bodyLength);
  return {
    length: bodyLength <= 55 ? 1 + bodyLength : 1 + sizeOfBodyLength + bodyLength,
    encode(cursor) {
      bodyLength <= 55 ? cursor.pushByte(192 + bodyLength) : (cursor.pushByte(247 + sizeOfBodyLength), sizeOfBodyLength === 1 ? cursor.pushUint8(bodyLength) : sizeOfBodyLength === 2 ? cursor.pushUint16(bodyLength) : sizeOfBodyLength === 3 ? cursor.pushUint24(bodyLength) : cursor.pushUint32(bodyLength));
      for (let { encode } of list)
        encode(cursor);
    }
  };
}
function getEncodableBytes(bytesOrHex) {
  let bytes = typeof bytesOrHex == "string" ? hexToBytes(bytesOrHex) : bytesOrHex, sizeOfBytesLength = getSizeOfLength(bytes.length);
  return {
    length: bytes.length === 1 && bytes[0] < 128 ? 1 : bytes.length <= 55 ? 1 + bytes.length : 1 + sizeOfBytesLength + bytes.length,
    encode(cursor) {
      bytes.length === 1 && bytes[0] < 128 ? cursor.pushBytes(bytes) : bytes.length <= 55 ? (cursor.pushByte(128 + bytes.length), cursor.pushBytes(bytes)) : (cursor.pushByte(183 + sizeOfBytesLength), sizeOfBytesLength === 1 ? cursor.pushUint8(bytes.length) : sizeOfBytesLength === 2 ? cursor.pushUint16(bytes.length) : sizeOfBytesLength === 3 ? cursor.pushUint24(bytes.length) : cursor.pushUint32(bytes.length), cursor.pushBytes(bytes));
    }
  };
}
function getSizeOfLength(length) {
  if (length < 2 ** 8)
    return 1;
  if (length < 2 ** 16)
    return 2;
  if (length < 2 ** 24)
    return 3;
  if (length < 2 ** 32)
    return 4;
  throw new BaseError("Length is too large.");
}

// node_modules/viem/_esm/utils/address/getContractAddress.js
init_concat();

// node_modules/viem/_esm/utils/data/isBytes.js
function isBytes2(value) {
  return !value || typeof value != "object" || !("BYTES_PER_ELEMENT" in value) ? !1 : value.BYTES_PER_ELEMENT === 1 && value.constructor.name === "Uint8Array";
}

// node_modules/viem/_esm/utils/address/getContractAddress.js
init_pad();
init_slice();
init_toBytes();
init_keccak256();
init_getAddress();
function getContractAddress(opts) {
  return opts.opcode === "CREATE2" ? getCreate2Address(opts) : getCreateAddress(opts);
}
function getCreateAddress(opts) {
  let from = toBytes(getAddress(opts.from)), nonce = toBytes(opts.nonce);
  return nonce[0] === 0 && (nonce = new Uint8Array([])), getAddress(`0x${keccak256(toRlp([from, nonce], "bytes")).slice(26)}`);
}
function getCreate2Address(opts) {
  let from = toBytes(getAddress(opts.from)), salt = pad(isBytes2(opts.salt) ? opts.salt : toBytes(opts.salt), {
    size: 32
  }), bytecodeHash = "bytecodeHash" in opts ? isBytes2(opts.bytecodeHash) ? opts.bytecodeHash : toBytes(opts.bytecodeHash) : keccak256(opts.bytecode, "bytes");
  return getAddress(slice(keccak256(concat([toBytes("0xff"), from, salt, bytecodeHash])), 12));
}

// node_modules/viem/_esm/index.js
init_encodeAbiParameters();
init_getAddress();
init_isAddress();
init_keccak256();

// src/launch/canonical-v1.ts
var ADDRESS = /^0x[0-9a-fA-F]{40}$/u, HEX_DATA = /^0x(?:[0-9a-fA-F]{2})*$/u;
var UINT256_MAX = (1n << 256n) - 1n, UINT64_MAX = (1n << 64n) - 1n, HOOK_PERMISSION_BITS = /* @__PURE__ */ Object.freeze({
  beforeInitialize: 13,
  afterInitialize: 12,
  beforeAddLiquidity: 11,
  afterAddLiquidity: 10,
  beforeRemoveLiquidity: 9,
  afterRemoveLiquidity: 8,
  beforeSwap: 7,
  afterSwap: 6,
  beforeDonate: 5,
  afterDonate: 4,
  beforeSwapReturnDelta: 3,
  afterSwapReturnDelta: 2,
  afterAddLiquidityReturnDelta: 1,
  afterRemoveLiquidityReturnDelta: 0
}), HOOK_PERMISSIONS_IN_BIT_ORDER = /* @__PURE__ */ Object.freeze(
  Object.keys(HOOK_PERMISSION_BITS)
);
function canonicalAddress(value, label) {
  if (typeof value != "string" || !ADDRESS.test(value) || !isAddress(value))
    throw new TypeError(`${label} must be an EVM address`);
  return getAddress(value);
}
function canonicalHex(value, label, allowEmpty = !0) {
  if (typeof value != "string" || !HEX_DATA.test(value) || !allowEmpty && value.length === 2)
    throw new TypeError(`${label} must be even-length hex data`);
  return value.toLowerCase();
}
function sha256CanonicalJson(value) {
  let json = canonicalJson(value);
  return `sha256:${createHash("sha256").update(json, "utf8").digest("hex")}`;
}
function canonicalJson(value) {
  return JSON.stringify(canonicalJsonValue(value));
}
function canonicalJsonValue(value) {
  if (value === null || typeof value == "string" || typeof value == "boolean") return value;
  if (typeof value == "number") {
    if (!Number.isSafeInteger(value)) throw new TypeError("canonical JSON numbers must be safe integers");
    return value;
  }
  if (Array.isArray(value)) return value.map(canonicalJsonValue);
  if (typeof value == "object") {
    let result = {};
    for (let key of Object.keys(value).sort(compareUtf8)) {
      let candidate = value[key];
      if (candidate === void 0) throw new TypeError("canonical JSON cannot contain undefined");
      result[key] = canonicalJsonValue(candidate);
    }
    return result;
  }
  throw new TypeError("value is outside canonical JSON");
}
function deepFreeze(value) {
  if (value !== null && typeof value == "object" && !Object.isFrozen(value))
    for (let child of Object.values(value)) deepFreeze(child);
  return value;
}
function compareUtf8(left, right) {
  return Buffer.compare(Buffer.from(left, "utf8"), Buffer.from(right, "utf8"));
}

// src/verification/strict-json-v4.ts
var StrictJsonV4Error = class extends SyntaxError {
  offset;
  constructor(message, offset) {
    super(`${message} at character offset ${offset}`), this.name = "StrictJsonV4Error", this.offset = offset;
  }
};
function assertUnicodeScalars(value, offset) {
  for (let index = 0; index < value.length; index += 1) {
    let current = value.charCodeAt(index);
    if (current >= 55296 && current <= 56319) {
      let next = value.charCodeAt(index + 1);
      if (!(next >= 56320 && next <= 57343))
        throw new StrictJsonV4Error("lone high surrogate is forbidden", offset + index);
      index += 1;
    } else if (current >= 56320 && current <= 57343)
      throw new StrictJsonV4Error("lone low surrogate is forbidden", offset + index);
  }
}
var StrictJsonV4Parser = class {
  constructor(source, maximumDepth) {
    this.source = source;
    this.maximumDepth = maximumDepth;
  }
  source;
  maximumDepth;
  index = 0;
  parse() {
    this.skipWhitespace();
    let result = this.parseValue(0);
    if (this.skipWhitespace(), this.index !== this.source.length)
      throw new StrictJsonV4Error("unexpected trailing input", this.index);
    return result;
  }
  parseValue(depth) {
    if (depth > this.maximumDepth)
      throw new StrictJsonV4Error("maximum JSON depth exceeded", this.index);
    let current = this.source[this.index];
    if (current === "{") return this.parseObject(depth + 1);
    if (current === "[") return this.parseArray(depth + 1);
    if (current === '"') return this.parseString();
    if (current === "t") return this.parseLiteral("true", !0);
    if (current === "f") return this.parseLiteral("false", !1);
    if (current === "n") return this.parseLiteral("null", null);
    if (current === "-" || current !== void 0 && current >= "0" && current <= "9")
      return this.parseNumber();
    throw new StrictJsonV4Error("expected JSON value", this.index);
  }
  parseObject(depth) {
    this.index += 1, this.skipWhitespace();
    let result = /* @__PURE__ */ Object.create(null), keys = /* @__PURE__ */ new Set();
    if (this.source[this.index] === "}")
      return this.index += 1, result;
    for (; this.index < this.source.length; ) {
      if (this.source[this.index] !== '"')
        throw new StrictJsonV4Error("expected object property", this.index);
      let offset = this.index, key = this.parseString();
      if (keys.has(key)) throw new StrictJsonV4Error("duplicate object property", offset);
      if (keys.add(key), this.skipWhitespace(), this.source[this.index] !== ":")
        throw new StrictJsonV4Error("expected ':' after object property", this.index);
      if (this.index += 1, this.skipWhitespace(), Object.defineProperty(result, key, {
        value: this.parseValue(depth),
        enumerable: !0,
        configurable: !1,
        writable: !1
      }), this.skipWhitespace(), this.source[this.index] === "}")
        return this.index += 1, result;
      if (this.source[this.index] !== ",")
        throw new StrictJsonV4Error("expected ',' or '}'", this.index);
      this.index += 1, this.skipWhitespace();
    }
    throw new StrictJsonV4Error("unterminated object", this.index);
  }
  parseArray(depth) {
    this.index += 1, this.skipWhitespace();
    let result = [];
    if (this.source[this.index] === "]")
      return this.index += 1, result;
    for (; this.index < this.source.length; ) {
      if (result.push(this.parseValue(depth)), this.skipWhitespace(), this.source[this.index] === "]")
        return this.index += 1, result;
      if (this.source[this.index] !== ",")
        throw new StrictJsonV4Error("expected ',' or ']'", this.index);
      this.index += 1, this.skipWhitespace();
    }
    throw new StrictJsonV4Error("unterminated array", this.index);
  }
  parseString() {
    let start = this.index;
    for (this.index += 1; this.index < this.source.length; ) {
      let current = this.source.charCodeAt(this.index);
      if (current === 34) {
        this.index += 1;
        let decoded;
        try {
          decoded = JSON.parse(this.source.slice(start, this.index));
        } catch {
          throw new StrictJsonV4Error("invalid JSON string", start);
        }
        if (typeof decoded != "string") throw new StrictJsonV4Error("invalid JSON string", start);
        return assertUnicodeScalars(decoded, start), decoded;
      }
      if (current < 32) throw new StrictJsonV4Error("unescaped control character", this.index);
      if (current === 92) {
        let escape = this.source[this.index + 1];
        if (escape === void 0 || !'"\\/bfnrtu'.includes(escape))
          throw new StrictJsonV4Error("invalid JSON escape", this.index);
        if (this.index += 2, escape === "u") {
          let hex2 = this.source.slice(this.index, this.index + 4);
          if (!/^[0-9a-fA-F]{4}$/u.test(hex2))
            throw new StrictJsonV4Error("invalid Unicode escape", this.index);
          this.index += 4;
        }
        continue;
      }
      this.index += 1;
    }
    throw new StrictJsonV4Error("unterminated string", start);
  }
  parseNumber() {
    let match = /^-?(?:0|[1-9][0-9]*)(?:\.[0-9]+)?(?:[eE][+-]?[0-9]+)?/u.exec(
      this.source.slice(this.index)
    );
    if (match === null) throw new StrictJsonV4Error("invalid JSON number", this.index);
    let start = this.index;
    this.index += match[0].length;
    let value = Number(match[0]);
    if (!Number.isFinite(value)) throw new StrictJsonV4Error("non-finite JSON number", start);
    return value;
  }
  parseLiteral(token, value) {
    if (!this.source.startsWith(token, this.index))
      throw new StrictJsonV4Error(`expected ${token}`, this.index);
    return this.index += token.length, value;
  }
  skipWhitespace() {
    for (; this.index < this.source.length; ) {
      let current = this.source.charCodeAt(this.index);
      if (current !== 32 && current !== 9 && current !== 10 && current !== 13) return;
      this.index += 1;
    }
  }
};
function parseStrictJsonV4(source, options) {
  if (!Number.isSafeInteger(options.maximumBytes) || options.maximumBytes < 1)
    throw new TypeError("maximumBytes must be a positive safe integer");
  let maximumDepth = options.maximumDepth ?? 128;
  if (!Number.isSafeInteger(maximumDepth) || maximumDepth < 1)
    throw new TypeError("maximumDepth must be a positive safe integer");
  if (Buffer.byteLength(source, "utf8") > options.maximumBytes)
    throw new StrictJsonV4Error("JSON byte limit exceeded", 0);
  return new StrictJsonV4Parser(source, maximumDepth).parse();
}

// src/domain/custom-launch-plan-contract-v1.ts
import { createHash as createHash2 } from "node:crypto";

// src/domain/types-custom-launch-plan-v1.ts
var CUSTOM_LAUNCH_PLAN_VERSION_V1 = "programmable.custom-launch-plan.v1";
var CUSTOM_LAUNCH_OPEN_PROVENANCE_POLICY_V1 = "programmable.custom-launch-policy.provenance.v1";

// src/domain/custom-launch-trade-fee-v2.ts
var CUSTOM_LAUNCH_ROUTED_TRADE_FEE_V2 = /* @__PURE__ */ Object.freeze({
  policyVersion: "programmable.routed-swap-fee.v2",
  rateBps: 30,
  ratePercent: "0.30%",
  appliesTo: "programmable-routed-open-provenance-trades",
  basis: "gross-output-credit",
  currency: "swap-output-asset",
  rounding: "floor-once-per-swap",
  recipient: "0xD88539d3c4C460136a733A3Fd60cf6BF269079da",
  collection: "atomic-output-transfer-in-swap",
  historicalSignedFeeObligations: "preserved",
  verifiedExistingPoolFee: "no-additional-route-fee",
  externalTradeFeeGuaranteed: !1
});

// src/domain/custom-launch-plan-contract-v1.ts
var CUSTOM_LAUNCH_LIMITS_V1 = deepFreeze({
  requestBytes: 16 * 1024 * 1024,
  jsonDepth: 64,
  components: 16,
  compilationUnits: 16,
  ownerResourceBytes: 64 * 1024 * 1024,
  ownerResponseBytes: 65 * 1024 * 1024,
  publicProjectionResponseBytes: 16 * 1024 * 1024,
  actions: 64,
  markets: 16,
  dependencies: 64,
  effects: 256,
  claims: 64,
  initCodeBytes: 49152,
  runtimeBytes: 24576,
  calldataBytes: 131072,
  compilationInputBytes: 5242880,
  identifierBytes: 256,
  listPageSize: 25
}), CUSTOM_LAUNCH_POLICY_VERSION_V1 = "programmable.custom-launch-policy.v1", CUSTOM_LAUNCH_FEE_POLICY_VERSION_V1 = "programmable.custom-launch-fee.v1", CUSTOM_LAUNCH_CONTRACT_BASE_V1 = "/v4/chains/4663/custom-launch-contract", str = (maxLength = 256) => ({ type: "string", maxLength }), literal = (value) => ({ const: value }), enumOf = (...values) => ({ enum: values }), ref = (name) => ({ $ref: `#/$defs/${name}` }), array = (items, maxItems, minItems = 0) => ({ type: "array", items, minItems, maxItems }), object = (properties, optional = []) => ({
  type: "object",
  properties,
  required: Object.keys(properties).filter((key) => !optional.includes(key)),
  additionalProperties: !1
}), jsonObject = { type: "object", additionalProperties: !0 }, identifier = { type: "string", pattern: "^[A-Za-z0-9][A-Za-z0-9._:@/+\\-]{0,255}$" }, uint = { type: "string", pattern: "^(?:0|[1-9][0-9]*)$", maxLength: 78, "x-uintBits": 256 }, uint64 = { ...uint, maxLength: 20, "x-uintBits": 64 }, hex = { type: "string", pattern: "^0x(?:[0-9a-f]{2})*$", maxLength: 2 + CUSTOM_LAUNCH_LIMITS_V1.calldataBytes * 2 }, hex32 = { type: "string", pattern: "^0x[0-9a-f]{64}$" }, address = { type: "string", pattern: "^0x[0-9a-fA-F]{40}$", "x-canonical": "address" }, sha = { type: "string", pattern: "^sha256:[0-9a-f]{64}$" }, integer = (minimum, maximum) => ({ type: "integer", minimum, maximum }), baseAction = {
  actionId: { ...identifier, pattern: "^(?!platform:)[A-Za-z0-9][A-Za-z0-9._:@/+\\-]{0,255}$" },
  dependsOn: array(identifier, 64),
  authority: ref("authority"),
  preconditions: array(identifier, 256),
  postconditions: array(identifier, 256)
}, action = (kind, fields) => object({ ...baseAction, kind: literal(kind), ...fields }), effect = (kind, fields) => object({
  effectId: identifier,
  criticality: enumOf("critical", "optional", "observed"),
  kind: literal(kind),
  ...fields
}), CUSTOM_LAUNCH_PLAN_SCHEMA_V1 = deepFreeze({
  $schema: "https://json-schema.org/draft/2020-12/schema",
  $id: "https://api.programmable.market/v4/chains/4663/custom-launch-contract/schema.json",
  title: "Programmable Custom Launch Plan V1",
  ...object({
    schemaVersion: literal("programmable.custom-launch-plan.v1"),
    manifestDigest: sha,
    admissionPolicy: literal(CUSTOM_LAUNCH_OPEN_PROVENANCE_POLICY_V1),
    chainId: uint64,
    controller: ref("controller"),
    executor: enumOf("atomic_graph_v2", "controller_multi_step_v1", "observe_and_stamp_v1", "atomic_execute_and_stamp_v2"),
    verificationBundle: ref("verificationBundle"),
    components: array(ref("component"), 16, 1),
    actions: array(ref("action"), 64, 1),
    markets: array(ref("market"), 16),
    hookBindings: array(ref("hookBinding"), 16),
    dependencies: array(ref("dependency"), 64),
    expectedEffects: array(ref("effect"), 256),
    budgets: object({ maxTotalValue: uint, maxTotalGas: uint, validAfter: uint64, deadline: uint64 }),
    feeObligations: array(ref("feeObligation"), 64),
    claimDescriptors: array(ref("claimDescriptor"), 64),
    distributionPreferences: array(object({ provider: enumOf("hooklist", "uniswap_api", "uniswap_labs"), optedIn: { type: "boolean" } }), 3),
    publication: ref("publication")
  }, ["publication", "admissionPolicy"]),
  $defs: {
    addressRef: { oneOf: [object({ address }), object({ componentId: identifier })] },
    controller: object({
      address,
      kind: enumOf("eoa", "delegated_eoa_v1", "erc1271", "smart_account"),
      runtimeCodeHash: hex32,
      authoritySnapshot: jsonObject
    }, ["runtimeCodeHash", "authoritySnapshot"]),
    component: object({
      componentId: identifier,
      artifactId: identifier,
      expectedAddress: address,
      runtimeCodeHash: hex32,
      tags: array(str(), 64)
    }, ["tags"]),
    call: object({ target: ref("addressRef"), data: hex, value: uint, gasLimit: uint }),
    eoaCreation: object({ target: { type: "null" }, data: { ...hex, minLength: 4, maxLength: 2 + CUSTOM_LAUNCH_LIMITS_V1.initCodeBytes * 2 }, value: uint, gasLimit: uint }),
    authority: { oneOf: [object({ kind: literal("controller") }), object({ kind: literal("platform"), binding: literal("launch_stamp"), operation: literal("stampPlanV1") })] },
    action: { oneOf: [
      action("deployCreate2", {
        componentId: identifier,
        factory: ref("addressRef"),
        salt: hex32,
        initCode: { ...hex, minLength: 4, maxLength: 2 + CUSTOM_LAUNCH_LIMITS_V1.initCodeBytes * 2 },
        execution: ref("call")
      }),
      action("deployCreate", { componentId: identifier, parent: ref("addressRef"), nonce: uint64, execution: ref("call") }),
      action("deployEoaCreate", { componentId: identifier, nonce: uint64, execution: ref("eoaCreation") }),
      action("useExisting", { componentId: identifier }),
      action("call", { execution: ref("call") }),
      action("initializePool", { marketId: identifier, sqrtPriceX96: { ...uint, "x-uintBits": 160 }, execution: ref("call") }),
      action("provideLiquidity", { marketId: identifier, execution: ref("call") }),
      action("verifyEffect", { effectId: identifier })
    ] },
    market: object({
      marketId: identifier,
      kind: literal("uniswap_v4"),
      poolManager: address,
      currency0: ref("addressRef"),
      currency1: ref("addressRef"),
      fee: integer(0, 8388608),
      tickSpacing: integer(1, 32767),
      hooks: ref("addressRef")
    }),
    hookBinding: object({
      componentId: identifier,
      poolManager: address,
      permissions: integer(0, 16383),
      callbackAbi: array(jsonObject, 256),
      hookDataSchema: jsonObject
    }, ["hookDataSchema"]),
    dependency: object({ dependencyId: identifier, chainId: uint64, address, runtimeCodeHash: hex32, authoritySnapshot: jsonObject }, ["authoritySnapshot"]),
    effect: { oneOf: [
      effect("runtime", { target: ref("addressRef"), runtimeCodeHash: hex32 }),
      effect("callResult", { target: ref("addressRef"), data: hex, expected: hex }),
      effect("storage", { target: ref("addressRef"), slot: hex32, expected: hex32 }),
      effect("balance", { target: ref("addressRef"), asset: address, minimum: uint, maximum: uint }),
      effect("child", { componentId: identifier, runtimeCodeHash: hex32, derivation: { oneOf: [
        object({ kind: literal("create"), parent: ref("addressRef"), nonce: uint64 }),
        object({ kind: literal("create2"), parent: ref("addressRef"), salt: hex32, initCodeHash: hex32 })
      ] } })
    ] },
    witness: object({
      kind: enumOf("request", "source", "compiler", "runtime", "runtime_trace", "chain_read", "policy", "provider"),
      ref: str(2048),
      details: jsonObject
    }),
    feeObligation: object({
      obligationId: identifier,
      mode: enumOf("pool_enforced", "programmable_routed", "not_applicable"),
      policyVersion: literal(CUSTOM_LAUNCH_FEE_POLICY_VERSION_V1),
      rateBps: enumOf(20, 0),
      scope: enumOf("proven_pool_paths", "programmable_built_or_routed_qualifying_swaps", "no_qualifying_swap_flow"),
      recipient: { oneOf: [address, { type: "null" }] },
      marketIds: array(identifier, 16),
      enforcementWitness: ref("witness")
    }, ["enforcementWitness"]),
    claimDescriptor: object({
      claimId: identifier,
      chainId: uint64,
      asset: address,
      accrualContract: address,
      read: object({ data: hex, resultType: literal("uint256") }),
      claim: object({ data: hex, value: literal("0") }),
      requiredController: address,
      beneficiary: address,
      immutableRecipient: { oneOf: [address, { type: "null" }] },
      runtimeCodeHash: hex32,
      proof: ref("witness")
    }),
    publication: object({
      visibility: enumOf("listed", "unlisted"),
      name: str(256),
      symbol: str(64),
      description: str(16384),
      imageUrl: str(2048),
      primaryComponentId: identifier,
      primaryMarketId: identifier,
      links: array(str(2048), 16)
    }, ["name", "symbol", "description", "imageUrl", "primaryComponentId", "primaryMarketId", "links"]),
    verificationBundle: object({
      schemaVersion: literal("programmable.exact-source-verification-bundle.v2"),
      compilationUnits: array(ref("compilationUnit"), 16, 1),
      components: array(ref("artifact"), 16, 1)
    }),
    compilationUnit: object({
      compilationUnitId: identifier,
      compilerVersion: { type: "string", pattern: "^0\\.[0-9]+\\.[0-9]+\\+commit\\.[0-9a-f]{8}$" },
      standardJsonInputBase64: { ...str(6990508), minLength: 4, "x-canonical": "base64" },
      standardJsonInputSha256: sha
    }),
    artifact: object({
      targetId: identifier,
      compilationUnitId: identifier,
      sourcePath: str(4096),
      contractName: identifier,
      constructorArguments: hex,
      runtimeMaterialization: ref("runtimeMaterialization")
    }),
    runtimeMaterialization: object({
      immutableReferences: array(object({
        immutableId: uint,
        ranges: array(object({ start: integer(0, 24576), length: literal(32) }), 1024)
      }), 1024),
      runtimeImmutables: array({ oneOf: [
        object({ immutableId: uint, abiType: literal("address"), target: identifier }),
        object({ immutableId: uint, abiType: str(256), literal: { oneOf: [{ type: "string" }, { type: "boolean" }] } })
      ] }, 1024),
      deployedRuntimeCodeBase64: { ...str(32768), minLength: 4, "x-canonical": "base64" },
      deployedRuntimeCodeHash: hex32
    })
  }
}), outputRef = (name) => ({ $ref: `#/components/schemas/${name}` }), inputRef = (name) => ({ $ref: `#/components/schemas/CustomLaunchPlanV1/$defs/${name}` }), nullable = (value) => ({ oneOf: [value, { type: "null" }] }), timestamp = { type: "string", format: "date-time" }, findings = { type: "array", items: outputRef("CustomLaunchFindingV1") }, claims = { type: "array", items: outputRef("CustomLaunchClaimV1") }, availabilityState = enumOf("disabled", "canary", "active", "degraded"), CUSTOM_LAUNCH_RESPONSE_SCHEMAS_V1 = deepFreeze({
  CustomLaunchManualReviewV1: object({
    schemaVersion: literal("programmable.custom-launch-manual-review.v1"),
    reviewId: identifier,
    subjectHash: sha,
    chainId: enumOf("1", "4663"),
    controller: address,
    state: enumOf("pending", "approved", "rejected", "expired"),
    revision: { type: "integer", minimum: 1 },
    submittedAt: timestamp,
    approvedAt: nullable(timestamp),
    expiresAt: nullable(timestamp),
    reason: nullable(str(2e3)),
    requiresRepack: { type: "boolean" },
    reviewDueAt: timestamp,
    reviewOverdue: { type: "boolean" },
    launchRequestedAt: nullable(timestamp),
    launchDeadline: nullable(timestamp)
  }, ["requiresRepack", "reviewDueAt", "reviewOverdue", "launchRequestedAt", "launchDeadline"]),
  CustomLaunchFindingV1: object({
    code: str(),
    stage: str(),
    blockingAxis: nullable(enumOf("launchEligibility", "assurance", "distribution", "lifecycle")),
    invariant: str(2048),
    jsonPointer: str(4096),
    actual: {},
    constraint: jsonObject,
    witness: inputRef("witness"),
    repair: object({
      action: enumOf("replace_value", "repack", "change_contract", "inspect", "retry", "none"),
      value: {},
      patch: { type: "array", items: jsonObject }
    }, ["value", "patch"]),
    retry: object({ mode: enumOf("same_request", "repack_new_idempotency", "poll", "change_contract", "operator_retry"), sameBytesAllowed: { type: "boolean" } }),
    resumeUrl: str(2048),
    documentationUrl: str(2048)
  }),
  CustomLaunchClaimV1: object({
    claimType: str(),
    subject: str(2048),
    observedValue: {},
    status: enumOf("verified", "unresolved", "disclosed"),
    witness: inputRef("witness"),
    assessor: str(),
    assessorVersion: str(),
    validAt: timestamp,
    blockNumber: nullable(uint64)
  }),
  CustomLaunchDistributionV1: object({
    programmableRouting: enumOf("untested", "compatible", "adapter_required", "incompatible"),
    uniswapApi: enumOf("not_requested", "pending", "available", "unavailable"),
    uniswapLabsRouting: enumOf("unknown", "automatic", "review_required", "allowed", "unavailable"),
    hooklist: enumOf("not_requested", "queued", "submitted", "merged", "rejected")
  }),
  CustomLaunchPreflightV1: object({
    schemaVersion: literal("programmable.custom-launch-plan-preflight.v1"),
    requestId: str(),
    planHash: sha,
    manifestDigest: sha,
    launchEligibility: object({ status: enumOf("ready", "action_required", "analysis_pending"), hardBlockers: findings }),
    findings,
    assurance: object({ level: enumOf("provenance_only", "provenance_verified", "properties_verified"), claims })
  }),
  CustomLaunchAdmissionV1: object({
    schemaVersion: literal("programmable.custom-launch-plan-admission.v1"),
    planHash: sha,
    rawRequestSha256: sha,
    manifestDigest: sha,
    principalId: str(),
    controller: address,
    chainId: uint64,
    evidenceDigest: sha,
    issuerVersion: str(),
    issuerKeyId: str(),
    issuedAt: timestamp,
    expiresAt: timestamp,
    assuranceClaims: claims,
    receiptHash: sha,
    signature: str(4096)
  }),
  CustomLaunchWalletStepV1: object({
    stepId: identifier,
    actionIds: array(identifier, 64),
    status: enumOf("pending", "wallet_action_ready", "broadcast", "mined", "final", "failed"),
    controller: inputRef("controller"),
    transaction: object({
      chainId: uint64,
      from: address,
      to: nullable(address),
      data: hex,
      value: uint,
      gasLimit: uint,
      nonce: uint64,
      deadline: uint64
    }),
    transactionDigest: sha,
    preconditions: array(identifier, 256),
    postconditions: array(identifier, 256),
    transactionHash: nullable(hex32)
  }),
  CustomLaunchPlanReplanBindingV1: object({
    schemaVersion: literal("programmable.custom-launch-plan-replan.v1"),
    previousPlanId: identifier,
    previousPlanHash: sha,
    previousRawRequestSha256: sha,
    previousManifestDigest: sha,
    chainId: uint64,
    controller: address,
    finalizedPrefix: array(object({
      stepId: identifier,
      transactionDigest: sha,
      transactionHash: hex32,
      evidenceHash: sha,
      inclusion: object({
        chainId: uint64,
        transactionHash: hex32,
        blockNumber: uint64,
        blockHash: hex32,
        blockTimestamp: uint64,
        transactionIndex: uint64
      })
    }), CUSTOM_LAUNCH_LIMITS_V1.actions),
    bindingHash: sha
  }),
  CustomLaunchPlanResourceV1: object({
    schemaVersion: literal("programmable.custom-launch-plan-resource.v1"),
    planId: identifier,
    requestId: str(),
    principalId: str(),
    planHash: sha,
    rawRequestSha256: sha,
    manifestDigest: sha,
    plan: outputRef("CustomLaunchPlanV1"),
    status: enumOf(
      "accepted",
      "preflight_complete",
      "launch_ready",
      "action_required",
      "analysis_pending",
      "reserved",
      "wallet_action_ready",
      "broadcast",
      "mined",
      "final",
      "source_verified",
      "indexed",
      "publicly_visible",
      "expired"
    ),
    preflight: nullable(outputRef("CustomLaunchPreflightV1")),
    admission: nullable(outputRef("CustomLaunchAdmissionV1")),
    steps: array(outputRef("CustomLaunchWalletStepV1"), CUSTOM_LAUNCH_LIMITS_V1.actions + 1),
    walletAuthorization: object({ stampPreparation: jsonObject, controllerPrefix: jsonObject }),
    admissionEvidence: jsonObject,
    replan: outputRef("CustomLaunchPlanReplanBindingV1"),
    manualReview: outputRef("CustomLaunchManualReviewV1"),
    distribution: outputRef("CustomLaunchDistributionV1"),
    createdAt: timestamp,
    updatedAt: timestamp,
    resumeUrl: str(2048)
  }, ["walletAuthorization", "admissionEvidence", "replan", "manualReview"]),
  CustomLaunchPlanListV1: object({
    schemaVersion: literal("programmable.custom-launch-plan-list.v1"),
    chainId: uint64,
    plans: array(outputRef("CustomLaunchPlanResourceV1"), CUSTOM_LAUNCH_LIMITS_V1.listPageSize),
    nextCursor: nullable(str(2048))
  }),
  CustomLaunchPlanErrorsV1: object({
    schemaVersion: literal("programmable.custom-launch-plan-errors.v1"),
    requestId: nullable(str()),
    policyVersion: literal(CUSTOM_LAUNCH_POLICY_VERSION_V1),
    manifestDigest: sha,
    findings
  }),
  CustomLaunchCapabilitiesV1: object({
    schemaVersion: literal("programmable.custom-launch-capabilities.v1"),
    chainId: uint64,
    manifestDigest: sha,
    launchContract: str(2048),
    limits: jsonObject,
    actions: array(str(), 8),
    executors: array(str(), 4),
    feeModes: jsonObject,
    currentTradeFeePolicy: jsonObject,
    feeModesScope: str(),
    availability: object({ state: availabilityState, manifestDigest: sha, operations: { type: "object", additionalProperties: object({ state: availabilityState, reasons: { type: "array", items: str() } }) }, bindings: jsonObject }),
    compatibility: jsonObject
  }, ["currentTradeFeePolicy", "feeModesScope"]),
  CustomLaunchCredentialV1: object({
    schemaVersion: literal("programmable.custom-launch-credential.v1"),
    chainId: uint64,
    controller: nullable(address),
    credentialId: str(),
    credentialKind: enumOf("wallet-api-key", "partner-root", "partner-subkey"),
    scopes: { type: "array", items: str() },
    limits: jsonObject,
    manifestDigest: sha,
    requestSchemaVersion: literal("programmable.custom-launch-plan.v1")
  }),
  LaunchProjectionV1: object({
    schemaVersion: literal("programmable.launch-projection.v1"),
    sourceVersion: enumOf("router_v1", "multi_role_v2", "custom_launch_plan_v1"),
    launchId: identifier,
    chainId: uint64,
    controller: address,
    createdAt: timestamp,
    finalizedAt: nullable(timestamp),
    manifestDigest: nullable(sha),
    planHash: nullable(sha),
    components: array(inputRef("component"), CUSTOM_LAUNCH_LIMITS_V1.components),
    markets: array(inputRef("market"), CUSTOM_LAUNCH_LIMITS_V1.markets),
    primaryComponentId: nullable(identifier),
    primaryMarketId: nullable(identifier),
    publication: nullable(inputRef("publication")),
    assuranceClaims: claims,
    claimDescriptors: array(inputRef("claimDescriptor"), CUSTOM_LAUNCH_LIMITS_V1.claims),
    distribution: outputRef("CustomLaunchDistributionV1"),
    sourceVerification: enumOf("pending", "verified", "partial", "failed"),
    finality: object({
      status: enumOf("pending", "final"),
      transactionHashes: array(hex32, CUSTOM_LAUNCH_LIMITS_V1.actions + 1),
      blockNumber: nullable(uint64),
      blockHash: nullable(hex32),
      witness: nullable(inputRef("witness"))
    })
  }),
  LaunchProjectionPageV1: object({
    schemaVersion: literal("programmable.launch-projection-page.v1"),
    launches: array(outputRef("LaunchProjectionV1"), CUSTOM_LAUNCH_LIMITS_V1.listPageSize),
    nextCursor: nullable(str(2048))
  })
}), CUSTOM_LAUNCH_RESPONSE_VERSION_HEADER_V1 = "Programmable-Launch-Response-Version", CUSTOM_LAUNCH_WALLET_ORIGIN_V1 = "https://programmable.market", CUSTOM_LAUNCH_RESPONSE_SCHEMAS_V1_1 = deepFreeze({
  CustomLaunchPlanResourceV1_1: {
    ...CUSTOM_LAUNCH_RESPONSE_SCHEMAS_V1.CustomLaunchPlanResourceV1,
    properties: {
      ...CUSTOM_LAUNCH_RESPONSE_SCHEMAS_V1.CustomLaunchPlanResourceV1.properties,
      walletUrl: {
        type: "string",
        format: "uri",
        maxLength: 2048,
        description: "Fixed Programmable website handoff; conveys no authorization. Present only for response version 1.1."
      }
    }
  },
  CustomLaunchPlanListV1_1: object({
    schemaVersion: literal("programmable.custom-launch-plan-list.v1"),
    chainId: uint64,
    plans: array(outputRef("CustomLaunchPlanResourceV1_1"), CUSTOM_LAUNCH_LIMITS_V1.listPageSize),
    nextCursor: nullable(str(2048))
  }),
  CustomLaunchWalletPlanListV1_1: object({
    schemaVersion: literal("programmable.custom-launch-plan-list.v1"),
    plans: array(outputRef("CustomLaunchPlanResourceV1_1"), CUSTOM_LAUNCH_LIMITS_V1.listPageSize),
    nextCursor: nullable(str(2048))
  }),
  CustomLaunchWalletPlanProofReceiptV1_1: object({
    schemaVersion: literal("programmable.custom-launch-plan-step-proof.v1"),
    planId: identifier,
    stepId: identifier,
    transactionHash: hex32,
    accepted: literal(!0),
    authoritative: literal(!1),
    acceptedAt: timestamp,
    resumeUrl: str(2048),
    walletUrl: { type: "string", format: "uri", maxLength: 2048 }
  }, ["walletUrl"])
}), CUSTOM_LAUNCH_ATOMIC_RESPONSE_VERSION_V2 = "1.2", CUSTOM_LAUNCH_RESPONSE_SCHEMAS_V1_2 = deepFreeze({
  CustomLaunchPlanContinuationV1: object({
    schemaVersion: literal("programmable.custom-launch-plan-continuation.v1"),
    status: literal("replan_required"),
    originalManifestDigest: sha,
    currentManifestDigest: sha,
    replanUrl: { ...str(2048), pattern: "^/v4/chains/4663/custom-launch-plans/[A-Za-z0-9][A-Za-z0-9._:-]{0,127}:replan$" }
  }),
  CustomLaunchWalletStepV1_2: {
    ...CUSTOM_LAUNCH_RESPONSE_SCHEMAS_V1.CustomLaunchWalletStepV1,
    properties: {
      ...CUSTOM_LAUNCH_RESPONSE_SCHEMAS_V1.CustomLaunchWalletStepV1.properties,
      actionIds: array(identifier, CUSTOM_LAUNCH_LIMITS_V1.actions + 1),
      transaction: object({
        chainId: uint64,
        from: address,
        to: nullable(address),
        data: { ...hex, maxLength: 2 + 11e5 * 2 },
        value: uint,
        gasLimit: uint,
        nonce: uint64,
        deadline: uint64
      })
    }
  },
  CustomLaunchPlanResourceV1_2: {
    ...CUSTOM_LAUNCH_RESPONSE_SCHEMAS_V1_1.CustomLaunchPlanResourceV1_1,
    properties: {
      ...CUSTOM_LAUNCH_RESPONSE_SCHEMAS_V1_1.CustomLaunchPlanResourceV1_1.properties,
      steps: array(outputRef("CustomLaunchWalletStepV1_2"), CUSTOM_LAUNCH_LIMITS_V1.actions + 1),
      walletAuthorization: { oneOf: [
        object({ stampPreparation: jsonObject, controllerPrefix: jsonObject }),
        object({ atomicPreparation: jsonObject, executionOrder: jsonObject })
      ] },
      continuation: {
        ...outputRef("CustomLaunchPlanContinuationV1"),
        description: "Derived advice for a historical plan without a current signed next step. Does not change or authorize any original bytes; unresolved wallet sends take precedence."
      },
      walletUrl: {
        type: "string",
        format: "uri",
        maxLength: 2048,
        description: "Fixed Programmable website handoff; conveys no authorization."
      }
    }
  },
  CustomLaunchPlanListV1_2: object({
    schemaVersion: literal("programmable.custom-launch-plan-list.v1"),
    chainId: uint64,
    plans: array(outputRef("CustomLaunchPlanResourceV1_2"), CUSTOM_LAUNCH_LIMITS_V1.listPageSize),
    nextCursor: nullable(str(2048))
  }),
  CustomLaunchWalletPlanListV1_2: object({
    schemaVersion: literal("programmable.custom-launch-plan-list.v1"),
    plans: array(outputRef("CustomLaunchPlanResourceV1_2"), CUSTOM_LAUNCH_LIMITS_V1.listPageSize),
    nextCursor: nullable(str(2048))
  }),
  CustomLaunchWalletPlanProofReceiptV1_2: CUSTOM_LAUNCH_RESPONSE_SCHEMAS_V1_1.CustomLaunchWalletPlanProofReceiptV1_1
}), invariantDefinitions = {
  open_provenance: "The explicit provenance policy requires listed Programmable publication and empty fee obligations. It imposes no contract safety or economic assessment.",
  request_integrity: "The exact bounded UTF-8 JSON request obeys this version's published grammar and commitments.",
  chain_binding: "Every action, dependency and claim is bound to the requested supported chain.",
  controller_binding: "Only the credential-bound controller may authorize the exact transaction.",
  window: "The immutable validity window has a deadline strictly after validAfter.",
  budget: "The aggregate exact action value and gas remain inside the declared budgets.",
  source_binding: "Every declared component binds an exact compilation unit, source and constructor/runtime materialization.",
  runtime_binding: "Declared, compiled and observed critical runtime hashes agree.",
  hook_permissions: "Declared permission bits match the address. Legacy policy V1 also checks return-delta dependencies; open provenance relies on actual requested execution.",
  callback_abi: "Legacy policy V1 requires enabled callbacks to have the exact selector and return shape. Open provenance does not impose callback ABI recognition.",
  callback_authority: "Legacy policy V1 requires effectful callbacks to reject other callers. Open provenance does not assess callback authentication.",
  action_binding: "Action references resolve to the immutable ordered graph and execution bytes.",
  platform_authority: "Platform authority is restricted to one terminal call with the released launch_stamp target, stampPlanV1 operation, empty data and zero value; the issuer fills the bound stamp after the final controller prefix.",
  effect_binding: "Completion effects bind their exact criticality, targets and observed values.",
  dependency_binding: "Existing dependencies bind the exact address, runtime and authority snapshot.",
  fee_obligation: "Legacy policy V1 applies 20 bps to declared pool paths or Programmable-routed swaps; no-swap is not_applicable. Open provenance requires no fee obligation.",
  execution: "Exact controller transaction simulation and finalized execution preserve all bound effects.",
  availability: "Missing analysis, adapter or provider evidence is pending and retryable, never an unsafe judgment.",
  manifest: "The operation uses artifacts generated from the same immutable manifest digest.",
  idempotency: "Changed bytes use a new idempotency key; retries and successor plans preserve existing immutable reservations.",
  distribution: "Open provenance requires listed Programmable publication; legacy publication is optional. External submissions remain optional and require stored opt-in."
}, codeDefinitions = {
  PLAN_OPEN_PROVENANCE_BINDING_INVALID: ["open_provenance", "preflight.bindings", "repack_new_idempotency"],
  PLAN_REQUEST_INVALID: ["request_integrity", "preflight.parse", "repack_new_idempotency"],
  PLAN_FIELD_INVALID: ["request_integrity", "preflight.schema", "repack_new_idempotency"],
  PLAN_NON_CANONICAL: ["request_integrity", "preflight.parse", "repack_new_idempotency"],
  PLAN_LIMIT_EXCEEDED: ["request_integrity", "preflight.schema", "repack_new_idempotency"],
  PLAN_MANIFEST_MISMATCH: ["manifest", "preflight.contract", "repack_new_idempotency"],
  PLAN_CHAIN_BINDING_INVALID: ["chain_binding", "preflight.bindings", "repack_new_idempotency"],
  PLAN_CHAIN_NOT_ALLOWED: ["chain_binding", "authentication", "operator_retry"],
  PLAN_CONTROLLER_BINDING_INVALID: ["controller_binding", "preflight.bindings", "repack_new_idempotency"],
  PLAN_WINDOW_INVALID: ["window", "preflight.bindings", "repack_new_idempotency"],
  PLAN_BUDGET_EXCEEDED: ["budget", "preflight.bindings", "repack_new_idempotency"],
  PLAN_SOURCE_BINDING_INVALID: ["source_binding", "preflight.source", "repack_new_idempotency"],
  PLAN_COMPILER_UNAVAILABLE: ["availability", "preflight.source", "operator_retry"],
  PLAN_RUNTIME_BINDING_INVALID: ["runtime_binding", "preflight.source", "change_contract"],
  PLAN_HOOK_PERMISSIONS_INVALID: ["hook_permissions", "preflight.policy", "repack_new_idempotency"],
  PLAN_CALLBACK_ABI_INVALID: ["callback_abi", "preflight.policy", "change_contract"],
  PLAN_CALLBACK_AUTHORITY_INVALID: ["callback_authority", "preflight.policy", "change_contract"],
  PLAN_ACTION_BINDING_INVALID: ["action_binding", "preflight.bindings", "repack_new_idempotency"],
  PLAN_PLATFORM_AUTHORITY_INVALID: ["platform_authority", "preflight.policy", "repack_new_idempotency"],
  PLAN_EFFECT_BINDING_INVALID: ["effect_binding", "preflight.bindings", "repack_new_idempotency"],
  PLAN_DEPENDENCY_BINDING_INVALID: ["dependency_binding", "preflight.bindings", "repack_new_idempotency"],
  PLAN_FEE_OBLIGATION_INVALID: ["fee_obligation", "preflight.policy", "repack_new_idempotency"],
  PLAN_EXECUTION_REVERTED: ["execution", "preflight.simulation", "change_contract"],
  PLAN_EXECUTION_EVIDENCE_INVALID: ["execution", "preflight.simulation", "repack_new_idempotency"],
  PLAN_PROVIDER_UNAVAILABLE: ["availability", "preflight.provider", "same_request"],
  PLAN_ANALYSIS_PENDING: ["availability", "preflight.analysis", "poll"],
  EXECUTION_ADAPTER_UNAVAILABLE: ["availability", "preflight.execution", "operator_retry"],
  PLAN_ADMISSION_PENDING: ["availability", "admission", "poll"],
  PLAN_OPERATION_DISABLED: ["availability", "admission", "operator_retry"],
  PLAN_ARTIFACT_DRIFT: ["manifest", "discovery", "operator_retry"],
  PLAN_IDEMPOTENCY_INVALID: ["idempotency", "admission", "repack_new_idempotency"],
  PLAN_NOT_FOUND: ["controller_binding", "read", "same_request"],
  PLAN_CREDENTIAL_INVALID: ["controller_binding", "authentication", "same_request"],
  PLAN_SCOPE_INVALID: ["controller_binding", "authentication", "same_request"],
  PLAN_RATE_LIMITED: ["availability", "authentication", "same_request"],
  PLAN_PUBLICATION_INVALID: ["distribution", "publication", "repack_new_idempotency"]
}, CUSTOM_LAUNCH_ERROR_CATALOG_V1 = deepFreeze(Object.fromEntries(Object.entries(codeDefinitions).map(([code, [property, stage, retryMode]]) => [code, {
  code,
  invariant: `${property === "open_provenance" ? CUSTOM_LAUNCH_OPEN_PROVENANCE_POLICY_V1 : CUSTOM_LAUNCH_POLICY_VERSION_V1}#${property}`,
  description: invariantDefinitions[property],
  stage,
  retryMode,
  blockingAxis: property === "availability" ? "lifecycle" : property === "distribution" ? "distribution" : "launchEligibility",
  witnessSchema: "request|source|compiler|runtime|runtime_trace|chain_read|policy|provider + ref + details"
}]))), artifactDefinitions = [
  ["manifest.json", "application/json"],
  ["schema.json", "application/schema+json"],
  ["openapi.json", "application/json"],
  ["errors.json", "application/json"],
  ["capabilities.json", "application/json"],
  ["discovery.json", "application/json"],
  ["guide.md", "text/markdown"],
  ["agent-setup.md", "text/markdown"],
  ["agent-setup.json", "application/json"],
  ["reference.json", "application/json"],
  ["request-packer.mjs", "text/javascript"],
  ["artifact-index.json", "application/json"]
], CUSTOM_LAUNCH_MANIFEST_V1 = deepFreeze({
  schemaVersion: "programmable.custom-launch-contract.v1",
  requestSchemaVersion: "programmable.custom-launch-plan.v1",
  proofSchemaVersion: "programmable.custom-launch-plan-step-proof.v1",
  projectionSchemaVersion: "programmable.launch-projection.v1",
  policyVersion: CUSTOM_LAUNCH_POLICY_VERSION_V1,
  feePolicyVersion: CUSTOM_LAUNCH_FEE_POLICY_VERSION_V1,
  packerVersion: "1.4.2",
  openapiVersion: "4.6.2",
  admissionPolicies: {
    recommendedForNewPlans: CUSTOM_LAUNCH_OPEN_PROVENANCE_POLICY_V1,
    requestField: "admissionPolicy",
    omitted: CUSTOM_LAUNCH_POLICY_VERSION_V1,
    openProvenance: {
      version: CUSTOM_LAUNCH_OPEN_PROVENANCE_POLICY_V1,
      feeObligations: [],
      tradeFeePolicy: CUSTOM_LAUNCH_ROUTED_TRADE_FEE_V2,
      contractSafetyAssessment: "not_required",
      economicAssessment: "not_required",
      callbackSafetyAssessment: "not_required",
      bondingCurve: "not_required",
      liquidityLock: "not_required",
      publicationVisibility: "listed",
      stamp: "required",
      sourceRuntimeBinding: "required",
      exactAuthorizedExecution: "required",
      finalizedPublication: "required"
    }
  },
  routeId: "custom-launch-plan:create:v1",
  chains: ["4663"],
  limits: CUSTOM_LAUNCH_LIMITS_V1,
  digestDomains: {
    occurrence: "programmable.custom-launch-plan-occurrence.v1",
    launchId: "programmable.custom-launch-plan-launch-id.v1",
    controllerPrefix: "programmable.custom-launch-plan-controller-prefix.v1",
    effects: "programmable.custom-launch-plan-effects.v1",
    sourcePublication: "programmable.custom-launch-plan-source-publication.v1",
    signerPolicy: "programmable.custom-launch-plan-signer-policy.v1",
    staticPolicy: CUSTOM_LAUNCH_POLICY_VERSION_V1,
    replan: "programmable.custom-launch-plan-replan.v1",
    feeObligations: "programmable.custom-launch-plan-fee-obligations.v1",
    stampNonce: "programmable.custom-launch-plan-stamp-nonce.v1",
    occurrenceFields: ["planHash", "kind", "id"],
    launchIdFields: ["chainId", "controller", "planHash"],
    controllerAddressNormalization: "lowercase",
    controllerPrefixFields: ["chainId", "controller", "planHash", "compilationDigest", "policyBindingHash", "steps", "finality"],
    stepFields: ["stepId", "transactionDigest", "transactionHash"],
    stampNonceFields: ["planHash", "prefixDigest", "issuedAt"],
    executionEvidenceHash: "finalized_controller_prefix_excluding_own_stamp",
    framing: "utf8_domain_nul_canonical_json_sha256"
  },
  executors: ["atomic_graph_v2", "controller_multi_step_v1", "observe_and_stamp_v1", "atomic_execute_and_stamp_v2"],
  atomicExecution: {
    executor: "atomic_execute_and_stamp_v2",
    bindingId: "launch_atomic_v2",
    selector: "0x506aba45",
    envelopeSchema: "programmable.custom-launch-plan-atomic-envelope.v2",
    signerPolicySchema: "programmable.custom-launch-plan-signer-policy.v2",
    domain: { name: "ProgrammableLaunchPlanAtomic", version: "2", chainId: "released_chain", verifyingContract: "released_executor" },
    orderType: "ProgrammableLaunchPlanAtomicOrderV2",
    signature: "separate_platform_signature_over_safe_message",
    projectCaller: "released_executor",
    graphAuthorizedLauncher: "released_executor",
    graphSalt: "rederive_from_exact_launcher",
    responseVersion: CUSTOM_LAUNCH_ATOMIC_RESPONSE_VERSION_V2,
    walletConfirmations: 1,
    maximumCalls: 32,
    maximumCallDataBytes: 1048576,
    maximumEnvelopeBytes: 11e5,
    maximumComponents: 64,
    maximumMarkets: 32,
    maximumSignatureBytes: 16384,
    maximumValiditySeconds: 86400,
    directEoaCreation: "unsupported",
    explicitStampPlaceholder: "unsupported",
    replay: "preserve_original_wallet_attempt",
    actionPreconditions: "first_project_call_group_entry_only",
    actionPostconditions: "atomic_completion",
    nonExecutionChecks: "leading_entry_trailing_completion_intermediate_rejected",
    verifyEffect: "includes_effect_id_at_declared_boundary",
    callCoalescing: "directly_adjacent_identical_deployments_only",
    callGasLimit: "total_callee_budget_including_value_stipend",
    minimumValueCallGas: "2300",
    nonceDomain: "programmable.custom-launch-plan-atomic-nonce.v2",
    nonceFields: ["planHash", "issuedAt"],
    orderValidity: "exact_plan_valid_after_and_deadline",
    finality: "one_exact_transaction_and_occurrence_readback",
    futureTransactionHashInOrder: !1,
    legacyAtomicGraph: "unchanged_may_require_separate_stamp",
    deployment: "requires_released_runtime_and_source_evidence"
  },
  actions: ["deployCreate2", "deployCreate", "deployEoaCreate", "useExisting", "call", "initializePool", "provideLiquidity", "verifyEffect"],
  reservedActionIdPrefixes: ["platform:"],
  explicitStampPlaceholder: {
    kind: "call",
    authority: { kind: "platform", binding: "launch_stamp", operation: "stampPlanV1" },
    terminal: !0,
    target: "released_launch_stamp",
    data: "0x",
    value: "0",
    finalBytesAuthority: "protected_issuer_after_final_controller_prefix"
  },
  hookPermissionBits: HOOK_PERMISSION_BITS,
  sourceSchemaVersion: "programmable.exact-source-verification-bundle.v2",
  invariants: invariantDefinitions,
  errors: CUSTOM_LAUNCH_ERROR_CATALOG_V1,
  schema: CUSTOM_LAUNCH_PLAN_SCHEMA_V1,
  responseSchemas: { ...CUSTOM_LAUNCH_RESPONSE_SCHEMAS_V1, ...CUSTOM_LAUNCH_RESPONSE_SCHEMAS_V1_1, ...CUSTOM_LAUNCH_RESPONSE_SCHEMAS_V1_2 },
  responseContract: {
    header: CUSTOM_LAUNCH_RESPONSE_VERSION_HEADER_V1,
    default: "1.0",
    supported: ["1.0", "1.1", "1.2"],
    metadataOnly: !0,
    persistedPlanUnchanged: !0,
    versions: {
      "1.0": { resourceSchema: "CustomLaunchPlanResourceV1", listSchema: "CustomLaunchPlanListV1", walletUrl: "omitted" },
      "1.1": { resourceSchema: "CustomLaunchPlanResourceV1_1", listSchema: "CustomLaunchPlanListV1_1", walletUrl: "website_handoff" },
      "1.2": {
        resourceSchema: "CustomLaunchPlanResourceV1_2",
        listSchema: "CustomLaunchPlanListV1_2",
        walletUrl: "website_handoff",
        atomicAuthorization: "explicit_execution_order",
        requiredForExecutor: "atomic_execute_and_stamp_v2",
        continuation: {
          schema: "CustomLaunchPlanContinuationV1",
          optional: !0,
          meaning: "historical_plan_requires_explicit_replan",
          originalSignedSubjectsUnchanged: !0,
          unresolvedWalletSendPrecedence: !0,
          automaticReplan: !1
        }
      }
    },
    walletOrigin: CUSTOM_LAUNCH_WALLET_ORIGIN_V1,
    walletPath: "/developers/api-keys?view=history&chainId={chainId}&launchId={planId}",
    walletAdmin: {
      path: "/v4/chains/4663/wallet-admin/custom-launch-plans",
      authentication: "existing_signed_website_bff_v2_and_active_wallet_owner",
      operations: ["list", "read", "proof_hint"],
      resourceSchema: "CustomLaunchPlanResourceV1_1",
      listSchema: "CustomLaunchWalletPlanListV1_1",
      proofSchema: "CustomLaunchWalletPlanProofReceiptV1_1",
      proofMeaning: "non_authoritative_discovery_hint",
      legacyResponseUnchanged: !0,
      atomicResponseVersion: CUSTOM_LAUNCH_ATOMIC_RESPONSE_VERSION_V2,
      atomicResourceSchema: "CustomLaunchPlanResourceV1_2",
      atomicListSchema: "CustomLaunchWalletPlanListV1_2",
      atomicProofSchema: "CustomLaunchWalletPlanProofReceiptV1_2"
    },
    resumeUrl: "api_status_path",
    location: "api_status_path"
  },
  directEoaCreation: {
    action: "deployEoaCreate",
    version: "programmable.custom-launch-action.eoa-create.v1",
    executionTarget: null,
    controllerKinds: ["eoa", "delegated_eoa_v1"],
    executor: "controller_multi_step_v1",
    address: "CREATE(controller, exact_transaction_nonce)",
    sourceRewrite: !1
  },
  delegatedEoaController: {
    kind: "delegated_eoa_v1",
    authoritySchema: "programmable.delegated-eoa-authority.v1",
    authorityFields: ["schemaVersion", "chainId", "delegate", "delegateRuntimeCodeHash"],
    controllerRuntimeCodeHash: "keccak256(0xef0100 || delegate)",
    delegateRuntimeBinding: "required",
    transactionEnvelopes: ["legacy", "eip2930", "eip1559"],
    authorizationLists: "unsupported",
    delegationWrites: "unsupported",
    walletUpgrade: "not_required",
    batching: "not_supported"
  },
  crossFieldRules: [
    "unique_ids",
    "earlier_action_dependencies",
    "component_artifact_refs",
    "resolved_address_refs",
    "market_currency_order",
    "chain_equality",
    "runtime_hash_equality",
    "hook_address_bits",
    "legacy_return_delta_dependencies",
    "aggregate_budgets",
    "validity_window",
    "fee_mode_scope_rate_recipient",
    "primary_publication_refs",
    "exact_source_bundle",
    "create_create2_preimages",
    "explicit_open_provenance_policy",
    "eoa_creation_controller_nonce_and_address"
  ],
  feeModes: {
    pool_enforced: { rateBps: 20, scope: "proven_pool_paths", proofRequired: !0 },
    programmable_routed: { rateBps: 20, scope: "programmable_built_or_routed_qualifying_swaps" },
    not_applicable: { rateBps: 0, scope: "no_qualifying_swap_flow", recipient: null },
    launchCharge: "disabled"
  },
  retryModes: ["same_request", "repack_new_idempotency", "poll", "change_contract", "operator_retry"],
  idempotency: {
    domain: "custom-launch-plan:create:v1",
    keyPrefix: "clp-v1-",
    derivesFrom: "rawRequestSha256",
    changedBytes: "new_key",
    ambiguousMutation: "inspect_same_request",
    replan: "immutable_successor_bound_to_final_prefix",
    replay: "read_only_before_current_manifest_and_release_admission",
    replayBindings: ["current_principal", "current_controller", "chainId", "idempotencyKey", "exact_request_bytes", "previousPlanId"]
  },
  availability: { states: ["disabled", "canary", "active", "degraded"], staticArtifactIsReadiness: !1 },
  distribution: {
    launchIndependent: !0,
    submissionRequiresStoredOptIn: !0,
    axes: ["programmableRouting", "uniswapApi", "uniswapLabsRouting", "hooklist"]
  },
  compatibility: { multiRoleV2: "byte_and_meaning_stable", documentationGuideSuffix: ".md", legacyOpenapi: ["4.0.0", "4.1.0"] },
  artifacts: artifactDefinitions.map(([fileName, mediaType]) => ({
    fileName,
    path: `${CUSTOM_LAUNCH_CONTRACT_BASE_V1}/${fileName}`,
    mediaType,
    generator: "scripts/build-custom-launch-contract-v1.mjs",
    generatorVersion: "1.4.2"
  }))
}), CUSTOM_LAUNCH_MANIFEST_DIGEST_V1 = `sha256:${createHash2("sha256").update(CUSTOM_LAUNCH_MANIFEST_V1.schemaVersion).update(Buffer.from([0])).update(canonicalJson(CUSTOM_LAUNCH_MANIFEST_V1)).digest("hex")}`, CUSTOM_LAUNCH_POLICY_DIGEST_V1 = `sha256:${createHash2("sha256").update(CUSTOM_LAUNCH_POLICY_VERSION_V1).update(Buffer.from([0])).update(canonicalJson(invariantDefinitions)).digest("hex")}`;

// src/domain/delegated-eoa-custom-launch-plan-v1.ts
var DELEGATED_EOA_AUTHORITY_VERSION_V1 = "programmable.delegated-eoa-authority.v1";
function isDirectTransactionControllerV1(controller) {
  return controller.kind === "eoa" || controller.kind === "delegated_eoa_v1";
}
function delegatedEoaDesignatorV1(delegate) {
  return `0xef0100${delegate.slice(2).toLowerCase()}`;
}
function parseDelegatedEoaAuthorityV1(controller, chainId) {
  let value = controller.authoritySnapshot;
  if (controller.kind !== "delegated_eoa_v1" || !value || Object.keys(value).sort().join(",") !== "chainId,delegate,delegateRuntimeCodeHash,schemaVersion" || value.schemaVersion !== DELEGATED_EOA_AUTHORITY_VERSION_V1 || value.chainId !== chainId || typeof value.delegate != "string" || !/^0x[0-9a-fA-F]{40}$/u.test(value.delegate) || BigInt(value.delegate) === 0n || typeof value.delegateRuntimeCodeHash != "string" || !/^0x[0-9a-f]{64}$/u.test(value.delegateRuntimeCodeHash) || value.delegateRuntimeCodeHash === keccak256("0x")) throw new TypeError("Delegated EOA authority binding is invalid");
  if (getAddress(value.delegate), controller.runtimeCodeHash !== keccak256(delegatedEoaDesignatorV1(value.delegate)))
    throw new TypeError("Delegated EOA designator hash differs from the exact 23-byte binding");
  return value;
}

// src/domain/execution-atomic-custom-launch-plan-v2.ts
function customLaunchPlanAtomicScheduleV2(plan) {
  if (plan.executor !== "atomic_execute_and_stamp_v2") throw new TypeError("Plan does not select Atomic V2");
  let callActionIndices = [], preconditions = [], postconditions = [], issues = [], first = plan.actions.findIndex((action2) => "execution" in action2), last = plan.actions.findLastIndex((action2) => "execution" in action2);
  for (let [index, action2] of plan.actions.entries()) {
    if (!("execution" in action2)) {
      let checks = [
        ...action2.preconditions,
        ...action2.postconditions,
        ...action2.kind === "verifyEffect" ? [action2.effectId] : []
      ];
      index < first ? preconditions.push(...checks) : index > last ? postconditions.push(...checks) : issues.push({ actionIndex: index, reason: "intermediate_action" });
      continue;
    }
    let prior = plan.actions[index - 1];
    prior && "execution" in prior && ["deployCreate", "deployCreate2"].includes(prior.kind) && ["deployCreate", "deployCreate2"].includes(action2.kind) && canonicalJson(prior.execution) === canonicalJson(action2.execution) || callActionIndices.push(index), callActionIndices.length === 1 ? preconditions.push(...action2.preconditions) : action2.preconditions.length > 0 && issues.push({ actionIndex: index, reason: "intermediate_precondition" }), postconditions.push(...action2.postconditions);
  }
  return postconditions.push(...plan.expectedEffects.filter((effect2) => effect2.criticality === "critical").map((effect2) => effect2.effectId)), { callActionIndices, preconditions: [...new Set(preconditions)], postconditions: [...new Set(postconditions)], issues };
}

// src/domain/request-custom-launch-plan-v1.ts
import { createHash as createHash6 } from "node:crypto";

// src/verification/bundle-v2.ts
import { createHash as createHash4 } from "node:crypto";

// src/domain/json.ts
var FORBIDDEN_OBJECT_KEYS = /* @__PURE__ */ new Set(["__proto__", "constructor", "prototype"]), MAX_JSON_DEPTH = 32;
function assertJsonObject(value, label) {
  if (assertJsonValue(value, label), !isJsonObject(value))
    throw new TypeError(`${label} must be a JSON object`);
}
function assertJsonValue(value, label = "value", depth = 0) {
  if (depth > MAX_JSON_DEPTH)
    throw new TypeError(`${label} exceeds the maximum nesting depth`);
  if (!(value === null || typeof value == "string" || typeof value == "boolean")) {
    if (typeof value == "number") {
      if (!Number.isFinite(value))
        throw new TypeError(`${label} contains a non-finite number`);
      return;
    }
    if (Array.isArray(value)) {
      for (let index = 0; index < value.length; index += 1)
        assertJsonValue(value[index], `${label}[${index}]`, depth + 1);
      return;
    }
    if (!isJsonObject(value))
      throw new TypeError(`${label} must contain only JSON values`);
    for (let [key, child] of Object.entries(value)) {
      if (FORBIDDEN_OBJECT_KEYS.has(key))
        throw new TypeError(`${label} contains a forbidden object key`);
      assertJsonValue(child, `${label}.${key}`, depth + 1);
    }
  }
}
function isJsonObject(value) {
  return typeof value == "object" && value !== null && !Array.isArray(value) && (Object.getPrototypeOf(value) === Object.prototype || Object.getPrototypeOf(value) === null);
}
function canonicalJson2(value) {
  if (value === null || typeof value == "boolean" || typeof value == "string")
    return JSON.stringify(value);
  if (typeof value == "number") {
    if (!Number.isFinite(value))
      throw new TypeError("Cannot canonicalize a non-finite number");
    return JSON.stringify(value);
  }
  return Array.isArray(value) ? `[${value.map((entry) => canonicalJson2(entry)).join(",")}]` : `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${canonicalJson2(value[key])}`).join(",")}}`;
}

// src/verification/bundle-v1.ts
import { createHash as createHash3 } from "node:crypto";
import { TextDecoder as TextDecoder2 } from "node:util";

// src/verification/types-v1.ts
var EXACT_SOURCE_VERIFICATION_BUNDLE_SCHEMA_V1 = "programmable.exact-source-verification-bundle.v1";

// src/verification/bundle-v1.ts
var BUNDLE_KEYS = /* @__PURE__ */ Object.freeze([
  "schemaVersion",
  "compilationUnits",
  "components"
]), COMPILATION_UNIT_KEYS = /* @__PURE__ */ Object.freeze([
  "compilationUnitId",
  "compilerVersion",
  "standardJsonInputBase64",
  "standardJsonInputSha256"
]), COMPONENT_KEYS = /* @__PURE__ */ Object.freeze([
  "targetId",
  "compilationUnitId",
  "sourcePath",
  "contractName",
  "constructorArguments"
]), STANDARD_JSON_KEYS = /* @__PURE__ */ Object.freeze(["language", "sources", "settings"]), SOURCE_KEYS = /* @__PURE__ */ Object.freeze(["content"]), IDENTIFIER = /^[A-Za-z0-9][A-Za-z0-9._:@/+\-]{0,255}$/u, CONTRACT_NAME = /^[A-Za-z_$][A-Za-z0-9_$]{0,127}$/u, COMPILER_VERSION = /^0\.[0-9]+\.[0-9]+\+commit\.[0-9a-f]{8}$/u, SHA256 = /^sha256:[0-9a-f]{64}$/u, MAX_COMPILATION_UNITS = 16, MAX_COMPONENTS = 16, MAX_STANDARD_JSON_INPUT_BYTES = 5242880, MAX_TOTAL_STANDARD_JSON_INPUT_BYTES = 5242880, MAX_STANDARD_JSON_SOURCES = 2048;
function parseExactSourceVerificationBundleV1(value) {
  if (assertExactObject(value, BUNDLE_KEYS, "verificationBundle"), value.schemaVersion !== EXACT_SOURCE_VERIFICATION_BUNDLE_SCHEMA_V1)
    throw new TypeError("verificationBundle schemaVersion is unsupported");
  if (!Array.isArray(value.compilationUnits) || value.compilationUnits.length === 0 || value.compilationUnits.length > MAX_COMPILATION_UNITS)
    throw new TypeError("verificationBundle compilationUnits must contain between 1 and 16 entries");
  if (!Array.isArray(value.components) || value.components.length === 0 || value.components.length > MAX_COMPONENTS)
    throw new TypeError("verificationBundle components must contain between 1 and 16 entries");
  let totalInputBytes = 0, parsedUnits = value.compilationUnits.map((unit, index) => {
    let parsed = parseCompilationUnit(unit, index);
    if (totalInputBytes += parsed.standardJsonInputBytes.byteLength, totalInputBytes > MAX_TOTAL_STANDARD_JSON_INPUT_BYTES)
      throw new TypeError("verificationBundle Standard JSON inputs exceed the aggregate byte limit");
    return parsed;
  });
  assertUtf8SortedUnique(
    parsedUnits.map((unit) => unit.publicUnit.compilationUnitId),
    "verificationBundle compilationUnits"
  );
  let unitsById = new Map(parsedUnits.map((unit) => [
    unit.publicUnit.compilationUnitId,
    unit
  ])), components = value.components.map(
    (component, index) => parseComponent(component, index, unitsById)
  );
  assertUtf8SortedUnique(
    components.map((component) => component.targetId),
    "verificationBundle components"
  );
  let referencedUnits = new Set(components.map((component) => component.compilationUnitId));
  if (referencedUnits.size !== parsedUnits.length || parsedUnits.some((unit) => !referencedUnits.has(unit.publicUnit.compilationUnitId)))
    throw new TypeError("every verificationBundle compilation unit must be referenced");
  let publicBundle = deepFreeze({
    schemaVersion: EXACT_SOURCE_VERIFICATION_BUNDLE_SCHEMA_V1,
    compilationUnits: parsedUnits.map((unit) => unit.publicUnit),
    components
  });
  return /* @__PURE__ */ Object.freeze({
    publicBundle,
    bundleHash: verificationBundleHashV1(publicBundle),
    compilationUnits: /* @__PURE__ */ Object.freeze(parsedUnits)
  });
}
function verificationBundleHashV1(bundle) {
  return `sha256:${createHash3("sha256").update(EXACT_SOURCE_VERIFICATION_BUNDLE_SCHEMA_V1, "utf8").update(Buffer.from([0])).update(canonicalJson2(bundle), "utf8").digest("hex")}`;
}
function parseCompilationUnit(value, index) {
  let label = `verificationBundle compilation unit ${index}`;
  assertExactObject(value, COMPILATION_UNIT_KEYS, label);
  let compilationUnitId = boundedIdentifier(value.compilationUnitId, `${label} compilationUnitId`);
  if (typeof value.compilerVersion != "string" || !COMPILER_VERSION.test(value.compilerVersion))
    throw new TypeError(`${label} compilerVersion must be an exact solc build`);
  if (typeof value.standardJsonInputBase64 != "string")
    throw new TypeError(`${label} Standard JSON input must use canonical base64`);
  let bytes = decodeCanonicalBase64(value.standardJsonInputBase64, label);
  if (bytes.byteLength < 2 || bytes.byteLength > MAX_STANDARD_JSON_INPUT_BYTES)
    throw new TypeError(`${label} Standard JSON input is outside the byte limit`);
  let inputSha256 = sha256Bytes(bytes);
  if (typeof value.standardJsonInputSha256 != "string" || !SHA256.test(value.standardJsonInputSha256) || value.standardJsonInputSha256 !== inputSha256)
    throw new TypeError(`${label} Standard JSON input digest does not match its exact bytes`);
  let standardJsonInput = parseStandardJsonInput(bytes, label), settings = standardJsonInput.settings, optimizerValue = settings.optimizer;
  if (optimizerValue !== void 0 && !isJsonObject(optimizerValue))
    throw new TypeError(`${label} optimizer settings must be an object when present`);
  let evmVersionValue = settings.evmVersion;
  if (evmVersionValue !== void 0 && (typeof evmVersionValue != "string" || evmVersionValue.length < 1 || evmVersionValue.length > 32))
    throw new TypeError(`${label} evmVersion is invalid`);
  let libraries = settings.libraries === void 0 ? /* @__PURE__ */ Object.freeze({}) : parseLibraries(settings.libraries, label), sourcePaths = new Set(Object.keys(standardJsonInput.sources)), publicUnit = deepFreeze({
    compilationUnitId,
    compilerVersion: value.compilerVersion,
    standardJsonInputBase64: value.standardJsonInputBase64,
    standardJsonInputSha256: inputSha256
  }), exactInputBytes = Uint8Array.from(bytes);
  return /* @__PURE__ */ Object.freeze({
    publicUnit,
    get standardJsonInputBytes() {
      return Uint8Array.from(exactInputBytes);
    },
    standardJsonInput,
    settings,
    settingsSha256: sha256CanonicalJson(settings),
    optimizer: optimizerValue ?? null,
    evmVersion: evmVersionValue ?? null,
    libraries,
    sourcePaths
  });
}
function parseComponent(value, index, unitsById) {
  let label = `verificationBundle component ${index}`;
  assertExactObject(value, COMPONENT_KEYS, label);
  let targetId = boundedIdentifier(value.targetId, `${label} targetId`), compilationUnitId = boundedIdentifier(
    value.compilationUnitId,
    `${label} compilationUnitId`
  ), unit = unitsById.get(compilationUnitId);
  if (unit === void 0) throw new TypeError(`${label} references an unknown compilation unit`);
  if (typeof value.sourcePath != "string" || !isSafeSourcePath(value.sourcePath) || !unit.sourcePaths.has(value.sourcePath))
    throw new TypeError(`${label} sourcePath is not an exact Standard JSON source`);
  if (typeof value.contractName != "string" || !CONTRACT_NAME.test(value.contractName))
    throw new TypeError(`${label} contractName is invalid`);
  return deepFreeze({
    targetId,
    compilationUnitId,
    sourcePath: value.sourcePath,
    contractName: value.contractName,
    constructorArguments: canonicalHex(
      value.constructorArguments,
      `${label} constructorArguments`
    )
  });
}
function parseStandardJsonInput(bytes, label) {
  let text;
  try {
    text = new TextDecoder2("utf-8", { fatal: !0 }).decode(bytes);
  } catch {
    throw new TypeError(`${label} Standard JSON input must be valid UTF-8`);
  }
  if (!Buffer.from(text, "utf8").equals(Buffer.from(bytes)))
    throw new TypeError(`${label} Standard JSON input UTF-8 is not canonical`);
  let parsed;
  try {
    parsed = JSON.parse(text);
  } catch {
    throw new TypeError(`${label} Standard JSON input must be valid JSON`);
  }
  if (assertExactObject(parsed, STANDARD_JSON_KEYS, `${label} Standard JSON input`), parsed.language !== "Solidity")
    throw new TypeError(`${label} Standard JSON input language must be Solidity`);
  if (!isJsonObject(parsed.sources))
    throw new TypeError(`${label} Standard JSON input sources must be an object`);
  let sourceEntries = Object.entries(parsed.sources);
  if (sourceEntries.length === 0 || sourceEntries.length > MAX_STANDARD_JSON_SOURCES)
    throw new TypeError(`${label} Standard JSON input sources are outside the count limit`);
  for (let [sourcePath, source] of sourceEntries) {
    if (!isSafeSourcePath(sourcePath))
      throw new TypeError(`${label} Standard JSON input contains an unsafe source path`);
    if (assertExactObject(source, SOURCE_KEYS, `${label} source ${sourcePath}`), typeof source.content != "string")
      throw new TypeError(`${label} source ${sourcePath} must contain exact inline source bytes`);
  }
  if (!isJsonObject(parsed.settings))
    throw new TypeError(`${label} Standard JSON input settings must be an object`);
  return assertJsonObject(parsed, `${label} Standard JSON input`), deepFreeze(parsed);
}
function parseLibraries(value, label) {
  if (!isJsonObject(value)) throw new TypeError(`${label} libraries must be an object`);
  for (let [sourcePath, libraries] of Object.entries(value)) {
    if (!isSafeSourcePath(sourcePath) || !isJsonObject(libraries))
      throw new TypeError(`${label} libraries contain an invalid source path`);
    for (let [libraryName, address2] of Object.entries(libraries))
      if (!CONTRACT_NAME.test(libraryName) || typeof address2 != "string" || !/^0x[0-9a-fA-F]{40}$/u.test(address2))
        throw new TypeError(`${label} libraries contain an invalid link address`);
  }
  return deepFreeze(value);
}
function decodeCanonicalBase64(value, label) {
  if (value.length === 0 || value.length % 4 !== 0)
    throw new TypeError(`${label} Standard JSON input base64 is invalid`);
  if (value.length > Math.ceil(MAX_STANDARD_JSON_INPUT_BYTES / 3) * 4)
    throw new TypeError(`${label} Standard JSON input is outside the byte limit`);
  let padding = value.endsWith("==") ? 2 : value.endsWith("=") ? 1 : 0, dataLength = value.length - padding;
  for (let index = 0; index < dataLength; index += 1) {
    let code = value.charCodeAt(index);
    if (!(code >= 65 && code <= 90 || code >= 97 && code <= 122 || code >= 48 && code <= 57 || code === 43 || code === 47))
      throw new TypeError(`${label} Standard JSON input base64 is invalid`);
  }
  if (padding > 0 && value.slice(dataLength) !== "=".repeat(padding) || dataLength % 4 === 1)
    throw new TypeError(`${label} Standard JSON input base64 is invalid`);
  let decoded = Buffer.from(value, "base64");
  if (decoded.toString("base64") !== value)
    throw new TypeError(`${label} Standard JSON input base64 is not canonical`);
  return decoded;
}
function sha256Bytes(value) {
  return `sha256:${createHash3("sha256").update(value).digest("hex")}`;
}
function assertExactObject(value, expectedKeys, label) {
  if (!isJsonObject(value)) throw new TypeError(`${label} must be an object`);
  let actual = Object.keys(value).sort(compareUtf8), expected = [...expectedKeys].sort(compareUtf8);
  if (actual.length !== expected.length || actual.some((key, index) => key !== expected[index]))
    throw new TypeError(`${label} has unknown or missing fields`);
}
function boundedIdentifier(value, label) {
  if (typeof value != "string" || !IDENTIFIER.test(value))
    throw new TypeError(`${label} must be a bounded identifier`);
  return value;
}
function assertUtf8SortedUnique(values, label) {
  for (let index = 1; index < values.length; index += 1)
    if (compareUtf8(values[index - 1], values[index]) >= 0)
      throw new TypeError(`${label} must be uniquely UTF-8 sorted`);
}
function isSafeSourcePath(path) {
  return path.length === 0 || path.length > 1024 || path !== path.normalize("NFC") || path.startsWith("/") || path.includes("\\") || /[\u0000-\u001f\u007f]/u.test(path) || /%(?:2f|5c)/iu.test(path) ? !1 : path.split("/").every(
    (segment) => segment.length > 0 && segment !== "." && segment !== ".."
  );
}

// src/verification/types-v2.ts
var EXACT_SOURCE_VERIFICATION_BUNDLE_SCHEMA_V2 = "programmable.exact-source-verification-bundle.v2";

// src/verification/bundle-v2.ts
var BUNDLE_KEYS2 = /* @__PURE__ */ Object.freeze(["schemaVersion", "compilationUnits", "components"]), COMPONENT_KEYS2 = /* @__PURE__ */ Object.freeze([
  "targetId",
  "compilationUnitId",
  "sourcePath",
  "contractName",
  "constructorArguments",
  "runtimeMaterialization"
]), MATERIALIZATION_KEYS = /* @__PURE__ */ Object.freeze([
  "immutableReferences",
  "runtimeImmutables",
  "deployedRuntimeCodeBase64",
  "deployedRuntimeCodeHash"
]), REFERENCE_KEYS = /* @__PURE__ */ Object.freeze(["immutableId", "ranges"]), RANGE_KEYS = /* @__PURE__ */ Object.freeze(["start", "length"]), IDENTIFIER2 = /^[A-Za-z0-9][A-Za-z0-9._:@/+\-]{0,255}$/u, IMMUTABLE_ID = /^(?:0|[1-9][0-9]*)$/u, NONZERO_HEX32 = /^0x(?!0{64}$)[0-9a-f]{64}$/u, CANONICAL_UINT = /^(?:0|[1-9][0-9]*)$/u, CANONICAL_INT = /^(?:0|-?[1-9][0-9]*)$/u, MAX_RUNTIME_BYTES = 24576;
function parseExactSourceVerificationBundleV2(value) {
  if (assertExactObject2(value, BUNDLE_KEYS2, "verificationBundle"), value.schemaVersion !== EXACT_SOURCE_VERIFICATION_BUNDLE_SCHEMA_V2)
    throw new TypeError("verificationBundle schemaVersion must be V2");
  if (!Array.isArray(value.components) || value.components.length === 0 || value.components.length > 16)
    throw new TypeError("verificationBundle components must contain between 1 and 16 entries");
  let rawComponents = value.components, legacyShape = {
    schemaVersion: "programmable.exact-source-verification-bundle.v1",
    compilationUnits: value.compilationUnits,
    components: rawComponents.map((component, index) => (assertExactObject2(component, COMPONENT_KEYS2, `verificationBundle component ${index}`), {
      targetId: component.targetId,
      compilationUnitId: component.compilationUnitId,
      sourcePath: component.sourcePath,
      contractName: component.contractName,
      constructorArguments: component.constructorArguments
    }))
  }, parsedV1 = parseExactSourceVerificationBundleV1(legacyShape), runtimeByTarget = /* @__PURE__ */ new Map(), components = parsedV1.publicBundle.components.map((legacy, index) => {
    let raw = rawComponents[index], materialization = parseRuntimeMaterializationV2(
      raw.runtimeMaterialization,
      `verificationBundle component ${index}`
    );
    return runtimeByTarget.set(
      legacy.targetId,
      Uint8Array.from(Buffer.from(materialization.deployedRuntimeCodeBase64, "base64"))
    ), deepFreeze({ ...legacy, runtimeMaterialization: materialization });
  }), publicBundle = deepFreeze({
    schemaVersion: EXACT_SOURCE_VERIFICATION_BUNDLE_SCHEMA_V2,
    compilationUnits: parsedV1.publicBundle.compilationUnits,
    components
  });
  return /* @__PURE__ */ Object.freeze({
    publicBundle,
    bundleHash: verificationBundleHashV2(publicBundle),
    compilationUnits: parsedV1.compilationUnits,
    runtimeByTarget
  });
}
function verificationBundleHashV2(bundle) {
  return `sha256:${createHash4("sha256").update(EXACT_SOURCE_VERIFICATION_BUNDLE_SCHEMA_V2, "utf8").update(Buffer.from([0])).update(canonicalJson2(bundle), "utf8").digest("hex")}`;
}
function parseRuntimeMaterializationV2(value, label) {
  if (assertExactObject2(value, MATERIALIZATION_KEYS, `${label}.runtimeMaterialization`), !Array.isArray(value.immutableReferences) || !Array.isArray(value.runtimeImmutables))
    throw new TypeError(`${label} runtime materialization arrays are invalid`);
  if (typeof value.deployedRuntimeCodeBase64 != "string")
    throw new TypeError(`${label} deployed runtime must be canonical base64`);
  let runtime = decodeCanonicalBase642(value.deployedRuntimeCodeBase64, label);
  if (runtime.byteLength === 0 || runtime.byteLength > MAX_RUNTIME_BYTES)
    throw new TypeError(`${label} deployed runtime is outside the EIP-170 byte limit`);
  let deployedRuntimeCodeHash = keccak256(`0x${runtime.toString("hex")}`);
  if (typeof value.deployedRuntimeCodeHash != "string" || !NONZERO_HEX32.test(value.deployedRuntimeCodeHash) || value.deployedRuntimeCodeHash !== deployedRuntimeCodeHash)
    throw new TypeError(`${label} deployed runtime hash does not match exact bytes`);
  let references = value.immutableReferences.map(
    (entry, index) => parseImmutableReference(entry, runtime.byteLength, `${label}.immutableReferences[${index}]`)
  );
  assertNumericIdOrder(references, `${label}.immutableReferences`);
  let occupied = references.flatMap((entry) => entry.ranges.map((range) => ({
    immutableId: entry.immutableId,
    start: range.start,
    end: range.start + range.length
  }))).sort((left, right) => left.start - right.start || left.end - right.end);
  for (let index = 1; index < occupied.length; index += 1)
    if (occupied[index].start < occupied[index - 1].end)
      throw new TypeError(`${label} immutable compiler ranges overlap`);
  let values = value.runtimeImmutables.map(
    (entry, index) => parseRuntimeImmutable(entry, `${label}.runtimeImmutables[${index}]`)
  );
  if (assertNumericIdOrder(values, `${label}.runtimeImmutables`), values.length !== references.length || values.some((entry, index) => entry.immutableId !== references[index].immutableId))
    throw new TypeError(`${label} runtime immutables do not exactly cover compiler references`);
  return deepFreeze({
    immutableReferences: references,
    runtimeImmutables: values,
    deployedRuntimeCodeBase64: value.deployedRuntimeCodeBase64,
    deployedRuntimeCodeHash
  });
}
function parseImmutableReference(value, runtimeLength, label) {
  if (assertExactObject2(value, REFERENCE_KEYS, label), typeof value.immutableId != "string" || !IMMUTABLE_ID.test(value.immutableId) || !Array.isArray(value.ranges) || value.ranges.length === 0)
    throw new TypeError(`${label} is invalid`);
  let ranges = value.ranges.map((range, index) => {
    if (assertExactObject2(range, RANGE_KEYS, `${label}.ranges[${index}]`), !Number.isSafeInteger(range.start) || range.start < 0 || range.length !== 32 || range.start + 32 > runtimeLength)
      throw new TypeError(`${label}.ranges[${index}] is not an in-bounds 32-byte range`);
    return /* @__PURE__ */ Object.freeze({ start: range.start, length: 32 });
  });
  for (let index = 1; index < ranges.length; index += 1)
    if (ranges[index].start <= ranges[index - 1].start)
      throw new TypeError(`${label}.ranges must be uniquely offset-sorted`);
  return /* @__PURE__ */ Object.freeze({ immutableId: value.immutableId, ranges: /* @__PURE__ */ Object.freeze(ranges) });
}
function parseRuntimeImmutable(value, label) {
  if (!isJsonObject(value)) throw new TypeError(`${label} must be an object`);
  let keys = Object.keys(value).sort(compareUtf8).join(",");
  if (keys !== "abiType,immutableId,literal" && keys !== "abiType,immutableId,target")
    throw new TypeError(`${label} must contain exactly one immutable value source`);
  if (typeof value.immutableId != "string" || !IMMUTABLE_ID.test(value.immutableId))
    throw new TypeError(`${label}.immutableId is invalid`);
  let abiType = staticWordType(value.abiType, `${label}.abiType`);
  if (Object.hasOwn(value, "target")) {
    if (abiType !== "address" || typeof value.target != "string" || !IDENTIFIER2.test(value.target))
      throw new TypeError(`${label}.target requires address and a canonical target ID`);
    return /* @__PURE__ */ Object.freeze({ immutableId: value.immutableId, abiType: "address", target: value.target });
  }
  return /* @__PURE__ */ Object.freeze({
    immutableId: value.immutableId,
    abiType,
    literal: staticWordLiteral(value.literal, abiType, `${label}.literal`)
  });
}
function materializeDeclaredRuntimeV2(materialization, identities, label) {
  let submitted = Buffer.from(materialization.deployedRuntimeCodeBase64, "base64"), template = Buffer.from(submitted);
  for (let reference of materialization.immutableReferences)
    for (let range of reference.ranges) template.fill(0, range.start, range.start + range.length);
  let values = new Map(materialization.runtimeImmutables.map((entry) => [
    entry.immutableId,
    encodeImmutableWord(entry, identities, label)
  ]));
  for (let reference of materialization.immutableReferences) {
    let word = values.get(reference.immutableId);
    for (let range of reference.ranges) word.copy(template, range.start);
  }
  if (!template.equals(submitted))
    throw new TypeError(`${label} immutable values do not reproduce the submitted runtime`);
  return Uint8Array.from(submitted);
}
function encodeImmutableWord(entry, identities, label) {
  let value;
  if ("target" in entry) {
    if (value = identities.get(entry.target), value === void 0) throw new TypeError(`${label} references unknown target ${entry.target}`);
  } else
    value = entry.literal;
  /^(?:u?int)[0-9]+$/u.test(entry.abiType) && (value = BigInt(value));
  let encodeWord = encodeAbiParameters, bytes = Buffer.from(encodeWord(
    [{ type: entry.abiType }],
    [value]
  ).slice(2), "hex");
  if (bytes.byteLength !== 32) throw new TypeError(`${label} immutable is not one ABI word`);
  return bytes;
}
function staticWordType(value, label) {
  if (typeof value != "string") throw new TypeError(`${label} is invalid`);
  if (value === "address" || value === "bool" || /^bytes(?:[1-9]|[12][0-9]|3[0-2])$/u.test(value))
    return value;
  let match = /^(?:u?int)([0-9]+)$/u.exec(value), bits = match === null ? 0 : Number(match[1]);
  if (bits < 8 || bits > 256 || bits % 8 !== 0)
    throw new TypeError(`${label} must be a one-word scalar ABI type`);
  return value;
}
function staticWordLiteral(value, abiType, label) {
  if (abiType === "address") {
    if (typeof value != "string") throw new TypeError(`${label} must be an address`);
    return getAddress(value);
  }
  if (abiType === "bool") {
    if (typeof value != "boolean") throw new TypeError(`${label} must be a boolean`);
    return value;
  }
  let bytes = /^bytes([0-9]+)$/u.exec(abiType);
  if (bytes !== null) {
    let length = Number(bytes[1]);
    if (typeof value != "string" || !new RegExp(`^0x[0-9a-f]{${length * 2}}$`, "u").test(value))
      throw new TypeError(`${label} must be canonical lowercase ${abiType}`);
    return value;
  }
  let unsigned = /^uint([0-9]+)$/u.exec(abiType);
  if (unsigned !== null) {
    if (typeof value != "string" || !CANONICAL_UINT.test(value) || BigInt(value) >= 1n << BigInt(unsigned[1])) throw new TypeError(`${label} is outside ${abiType}`);
    return value;
  }
  let signed = /^int([0-9]+)$/u.exec(abiType), bits = BigInt(signed[1]);
  if (typeof value != "string" || !CANONICAL_INT.test(value) || BigInt(value) < -(1n << bits - 1n) || BigInt(value) >= 1n << bits - 1n)
    throw new TypeError(`${label} is outside ${abiType}`);
  return value;
}
function decodeCanonicalBase642(value, label) {
  if (value.length === 0 || value.length % 4 !== 0 || value.length > 131072)
    throw new TypeError(`${label} deployed runtime base64 is invalid`);
  let decoded = Buffer.from(value, "base64");
  if (decoded.toString("base64") !== value) throw new TypeError(`${label} deployed runtime base64 is not canonical`);
  return decoded;
}
function assertNumericIdOrder(entries, label) {
  for (let index = 1; index < entries.length; index += 1)
    if (BigInt(entries[index - 1].immutableId) >= BigInt(entries[index].immutableId))
      throw new TypeError(`${label} must be uniquely numeric-ID sorted`);
}
function assertExactObject2(value, expectedKeys, label) {
  if (!isJsonObject(value)) throw new TypeError(`${label} must be an object`);
  let actual = Object.keys(value).sort(compareUtf8), expected = [...expectedKeys].sort(compareUtf8);
  if (actual.length !== expected.length || actual.some((key, index) => key !== expected[index]))
    throw new TypeError(`${label} has unknown or missing fields`);
}

// src/domain/errors-custom-launch-plan-v1.ts
import { createHash as createHash5 } from "node:crypto";
function createLaunchFindingV1(input) {
  let definition = CUSTOM_LAUNCH_ERROR_CATALOG_V1[input.code];
  if (definition === void 0) throw new TypeError("Finding code is not published in the launch contract");
  let actual = boundedLaunchActualV1(input.actual), mode = definition.retryMode, retry = input.retry ?? { mode, sameBytesAllowed: mode === "same_request" || mode === "poll" || mode === "operator_retry" };
  if ((retry.mode === "repack_new_idempotency" || retry.mode === "change_contract") && retry.sameBytesAllowed)
    throw new TypeError("Changed bytes cannot reuse an idempotency identity");
  let resumeUrl = input.resumeUrl ?? "/v4/chains/4663/custom-launch-plans:preflight";
  return deepFreeze({
    code: input.code,
    stage: input.stage ?? definition.stage,
    blockingAxis: input.blockingAxis === void 0 ? definition.blockingAxis : input.blockingAxis,
    invariant: definition.invariant,
    jsonPointer: input.jsonPointer,
    actual,
    constraint: input.constraint,
    witness: input.witness ?? { kind: "request", ref: input.jsonPointer || "/", details: { actual, constraint: input.constraint } },
    repair: input.repair ?? { action: mode === "change_contract" ? "change_contract" : mode === "repack_new_idempotency" ? "repack" : mode === "poll" ? "inspect" : "retry" },
    retry,
    resumeUrl,
    documentationUrl: `${CUSTOM_LAUNCH_CONTRACT_BASE_V1}/errors.json#${input.code}`
  });
}
function boundedLaunchActualV1(value) {
  if (value === void 0) return null;
  let serialized;
  try {
    serialized = canonicalJson(value);
  } catch {
    return { kind: typeof value, representable: !1 };
  }
  let bytes = Buffer.from(serialized);
  return bytes.length <= 2048 ? JSON.parse(serialized) : {
    representation: "sha256_of_canonical_json",
    byteLength: bytes.length,
    sha256: `sha256:${createHash5("sha256").update(bytes).digest("hex")}`
  };
}

// src/domain/request-custom-launch-plan-v1.ts
function rawCustomLaunchPlanRequestSha256V1(bytes) {
  return `sha256:${createHash6("sha256").update(bytes).digest("hex")}`;
}
function customLaunchPlanHashV1(plan) {
  return `sha256:${createHash6("sha256").update(CUSTOM_LAUNCH_PLAN_VERSION_V1).update(Buffer.from([0])).update(canonicalJson(plan)).digest("hex")}`;
}
var isObject = (v) => v !== null && typeof v == "object" && !Array.isArray(v), pointerToken = (s) => s.replace(/~/gu, "~0").replace(/\//gu, "~1"), canonicalUint = (v) => typeof v == "string" && /^(?:0|[1-9][0-9]*)$/u.test(v) && v.length <= 78;
function parseCustomLaunchPlanRequestV1(bytes, options) {
  let findings2 = [], rawRequestSha256 = rawCustomLaunchPlanRequestSha256V1(bytes), add = (code, jsonPointer, actual, constraint, repair, blockingAxis) => {
    findings2.push(createLaunchFindingV1({
      code,
      jsonPointer,
      actual,
      constraint,
      ...repair ? { repair } : {},
      ...blockingAxis === void 0 ? {} : { blockingAxis },
      resumeUrl: options.resumeUrl,
      witness: { kind: "request", ref: rawRequestSha256, details: { jsonPointer, constraint } }
    }));
  }, finish = (plan2) => deepFreeze({
    plan: plan2,
    findings: findings2,
    rawRequestSha256,
    planHash: plan2 === null ? null : customLaunchPlanHashV1(plan2)
  });
  if (bytes.byteLength === 0 || bytes.byteLength > CUSTOM_LAUNCH_LIMITS_V1.requestBytes)
    return add("PLAN_LIMIT_EXCEEDED", "", bytes.byteLength, { minimumBytes: 1, maximumBytes: CUSTOM_LAUNCH_LIMITS_V1.requestBytes }), finish(null);
  let value;
  try {
    value = parseStrictJsonV4(new TextDecoder("utf-8", { fatal: !0 }).decode(bytes), {
      maximumBytes: CUSTOM_LAUNCH_LIMITS_V1.requestBytes,
      maximumDepth: CUSTOM_LAUNCH_LIMITS_V1.jsonDepth
    }), value = JSON.parse(JSON.stringify(value));
  } catch {
    return add(
      "PLAN_REQUEST_INVALID",
      "",
      { byteLength: bytes.byteLength, rawRequestSha256 },
      { encoding: "UTF-8", duplicateProperties: !1, maximumDepth: CUSTOM_LAUNCH_LIMITS_V1.jsonDepth }
    ), finish(null);
  }
  try {
    !options.allowNonCanonical && !Buffer.from(bytes).equals(Buffer.from(canonicalJson(value))) && add("PLAN_NON_CANONICAL", "", rawRequestSha256, { encoding: "canonical_json_utf8" }, { action: "repack" });
  } catch {
    return add("PLAN_REQUEST_INVALID", "", null, { numbers: "safe_integers_only" }), finish(null);
  }
  let schemaValid = validate(CUSTOM_LAUNCH_PLAN_SCHEMA_V1, value, "");
  if (!isObject(value)) return finish(null);
  let plan = value;
  if (typeof plan.manifestDigest == "string" && plan.manifestDigest !== (options.manifestDigest ?? CUSTOM_LAUNCH_MANIFEST_DIGEST_V1)) {
    let expected = options.manifestDigest ?? CUSTOM_LAUNCH_MANIFEST_DIGEST_V1;
    add("PLAN_MANIFEST_MISMATCH", "/manifestDigest", plan.manifestDigest, { equals: expected }, { action: "replace_value", value: expected });
  }
  return typeof plan.chainId == "string" && plan.chainId !== options.chainId && add("PLAN_CHAIN_BINDING_INVALID", "/chainId", plan.chainId, { equals: options.chainId }), crossFields(plan), finish(findings2.some((f) => f.blockingAxis === "launchEligibility") ? null : value);
  function validate(schema, candidate, path) {
    if (schema.$ref) return validate(CUSTOM_LAUNCH_PLAN_SCHEMA_V1.$defs[schema.$ref.split("/").at(-1)], candidate, path);
    if (schema.oneOf) {
      let variants = schema.oneOf, matches = variants.filter((s) => isObject(candidate) && s.properties?.kind?.const !== void 0 ? candidate.kind === s.properties.kind.const : isObject(candidate) && s.type === "object" ? s.required.every((k) => Object.hasOwn(candidate, k)) : s.type === "null" ? candidate === null : s.type === typeof candidate);
      return matches.length === 1 ? validate(matches[0], candidate, path) : (add("PLAN_FIELD_INVALID", path, candidate, { oneOf: variants }), !1);
    }
    let valid = !0, fail = (constraint, repair, code = "PLAN_FIELD_INVALID") => {
      add(code, path, candidate, constraint, repair), valid = !1;
    };
    if (Object.hasOwn(schema, "const") && candidate !== schema.const && fail({ equals: schema.const }), schema.enum && !schema.enum.includes(candidate) && fail({ oneOf: schema.enum }), schema.type === "object") {
      if (!isObject(candidate))
        return fail({ type: "object" }), !1;
      for (let key of schema.required ?? []) Object.hasOwn(candidate, key) || (add("PLAN_FIELD_INVALID", `${path}/${pointerToken(key)}`, void 0, { required: !0 }), valid = !1);
      for (let [key, child] of Object.entries(candidate))
        schema.properties?.[key] ? valid = validate(schema.properties[key], child, `${path}/${pointerToken(key)}`) && valid : schema.additionalProperties === !1 && (add("PLAN_FIELD_INVALID", `${path}/${pointerToken(key)}`, child, { additionalProperties: !1 }), valid = !1);
    } else if (schema.type === "array") {
      if (!Array.isArray(candidate))
        return fail({ type: "array" }), !1;
      (candidate.length < (schema.minItems ?? 0) || candidate.length > schema.maxItems) && fail({ minItems: schema.minItems ?? 0, maxItems: schema.maxItems }, void 0, "PLAN_LIMIT_EXCEEDED"), candidate.slice(0, schema.maxItems).forEach((c, i) => {
        valid = validate(schema.items, c, `${path}/${i}`) && valid;
      });
    } else if (schema.type === "string") {
      if (typeof candidate != "string")
        return fail({ type: "string" }), !1;
      if ((schema.maxLength !== void 0 && candidate.length > schema.maxLength || schema.minLength !== void 0 && candidate.length < schema.minLength) && fail({ minLength: schema.minLength ?? 0, maxLength: schema.maxLength ?? 16777216 }), schema.pattern && !new RegExp(schema.pattern, "u").test(candidate) && fail({ pattern: schema.pattern }), schema["x-uintBits"] && canonicalUint(candidate) && BigInt(candidate) >= 1n << BigInt(schema["x-uintBits"]) && fail({ uintBits: schema["x-uintBits"] }), schema["x-canonical"] === "address")
        try {
          canonicalAddress(candidate, path);
        } catch {
          fail({ encoding: "EVM_address_valid_checksum_or_single_case" });
        }
      schema["x-canonical"] === "base64" && Buffer.from(candidate, "base64").toString("base64") !== candidate && fail({ encoding: "canonical_base64" });
    } else schema.type === "integer" ? (!Number.isSafeInteger(candidate) || candidate < schema.minimum || candidate > schema.maximum) && fail({ type: "integer", minimum: schema.minimum, maximum: schema.maximum }) : schema.type && !(schema.type === "null" ? candidate === null : typeof candidate === schema.type) && fail({ type: schema.type });
    return valid;
  }
  function crossFields(p) {
    let openProvenance = p.admissionPolicy === CUSTOM_LAUNCH_OPEN_PROVENANCE_POLICY_V1;
    if (openProvenance && ((!Array.isArray(p.feeObligations) || p.feeObligations.length !== 0) && add(
      "PLAN_OPEN_PROVENANCE_BINDING_INVALID",
      "/feeObligations",
      p.feeObligations,
      { equals: [], admissionPolicy: CUSTOM_LAUNCH_OPEN_PROVENANCE_POLICY_V1 }
    ), (!isObject(p.publication) || p.publication.visibility !== "listed") && add(
      "PLAN_OPEN_PROVENANCE_BINDING_INVALID",
      "/publication/visibility",
      p.publication?.visibility,
      { equals: "listed", required: "programmable_indexing" }
    )), p.controller?.kind === "delegated_eoa_v1")
      try {
        parseDelegatedEoaAuthorityV1(p.controller, p.chainId);
      } catch {
        add(
          "PLAN_CONTROLLER_BINDING_INVALID",
          "/controller",
          p.controller,
          { required: "exact_chain_designator_and_delegate_runtime_snapshot", schemaVersion: "programmable.delegated-eoa-authority.v1" }
        );
      }
    let rows = (key) => Array.isArray(p[key]) ? p[key].map((r) => isObject(r) ? r : /* @__PURE__ */ Object.create(null)) : [], components = rows("components"), actions = rows("actions"), markets = rows("markets"), effects = rows("expectedEffects"), ids = (key, id) => {
      let map = /* @__PURE__ */ new Map();
      return rows(key).forEach((r, i) => {
        typeof r[id] == "string" && (map.has(r[id]) && add("PLAN_ACTION_BINDING_INVALID", `/${key}/${i}/${id}`, r[id], { uniqueWithin: `/${key}` }), map.set(r[id], r));
      }), map;
    }, componentMap = ids("components", "componentId"), marketMap = ids("markets", "marketId"), effectMap = ids("expectedEffects", "effectId");
    ids("actions", "actionId"), ids("dependencies", "dependencyId"), ids("feeObligations", "obligationId"), ids("claimDescriptors", "claimId"), ids("distributionPreferences", "provider");
    let requireRef = (map, v, path, code = "PLAN_ACTION_BINDING_INVALID") => {
      typeof v == "string" && !map.has(v) && add(code, path, v, { memberOf: [...map.keys()] });
    };
    function addressRef(r, path) {
      if (!isObject(r)) return;
      typeof r.componentId == "string" && requireRef(componentMap, r.componentId, `${path}/componentId`);
      let a = r.address ?? componentMap.get(r.componentId)?.expectedAddress;
      try {
        return canonicalAddress(a, path);
      } catch {
        return;
      }
    }
    let visited = /* @__PURE__ */ new Set(), totalValue = 0n, totalGas = 0n, componentActions = /* @__PURE__ */ new Map(), atomicCallCount = 0, atomicCallBytes = 0, priorAtomicCall;
    if (actions.forEach((a, i) => {
      typeof a.actionId == "string" && a.actionId.startsWith("platform:") && add(
        "PLAN_ACTION_BINDING_INVALID",
        `/actions/${i}/actionId`,
        a.actionId,
        { reservedPrefixes: ["platform:"], reason: "server_injected_terminal_step_identity" }
      ), a.authority?.kind === "platform" && (a.kind !== "call" || i !== actions.length - 1 || a.execution?.data !== "0x" || a.execution?.value !== "0") && add(
        "PLAN_PLATFORM_AUTHORITY_INVALID",
        `/actions/${i}`,
        a,
        { kind: "call", terminal: !0, data: "0x", value: "0", target: "released_launch_stamp" }
      ), Array.isArray(a.dependsOn) && a.dependsOn.forEach((d, j) => {
        typeof d == "string" && !visited.has(d) && add("PLAN_ACTION_BINDING_INVALID", `/actions/${i}/dependsOn/${j}`, d, { earlierActionIds: [...visited] });
      }), typeof a.actionId == "string" && visited.add(a.actionId), a.componentId !== void 0 && (requireRef(componentMap, a.componentId, `/actions/${i}/componentId`), ["deployCreate", "deployCreate2", "deployEoaCreate", "useExisting"].includes(a.kind) && (componentActions.has(a.componentId) && add("PLAN_ACTION_BINDING_INVALID", `/actions/${i}/componentId`, a.componentId, { bindingActionsPerComponent: 1 }), componentActions.set(a.componentId, i))), a.marketId !== void 0 && requireRef(marketMap, a.marketId, `/actions/${i}/marketId`), a.effectId !== void 0 && requireRef(effectMap, a.effectId, `/actions/${i}/effectId`);
      for (let kind of ["preconditions", "postconditions"]) Array.isArray(a[kind]) && a[kind].forEach((e, j) => requireRef(effectMap, e, `/actions/${i}/${kind}/${j}`, "PLAN_EFFECT_BINDING_INVALID"));
      if (p.executor === "atomic_execute_and_stamp_v2" && a.authority?.kind !== "controller" && add(
        "PLAN_PLATFORM_AUTHORITY_INVALID",
        `/actions/${i}/authority`,
        a.authority,
        { required: "controller", platformStamp: "included_by_versioned_atomic_executor" }
      ), isObject(a.execution)) {
        addressRef(a.execution.target, `/actions/${i}/execution/target`);
        let atomic = p.executor === "atomic_execute_and_stamp_v2";
        atomic && priorAtomicCall && ["deployCreate", "deployCreate2"].includes(a.kind) && ["deployCreate", "deployCreate2"].includes(priorAtomicCall.kind) && canonicalJson(priorAtomicCall.execution) === canonicalJson(a.execution) || (canonicalUint(a.execution.value) && (totalValue += BigInt(a.execution.value)), canonicalUint(a.execution.gasLimit) && (totalGas += BigInt(a.execution.gasLimit)), atomic && (atomicCallCount++, typeof a.execution.data == "string" && (atomicCallBytes += (a.execution.data.length - 2) / 2), canonicalUint(a.execution.value) && BigInt(a.execution.value) > 0n && canonicalUint(a.execution.gasLimit) && BigInt(a.execution.gasLimit) < 2300n && add(
          "PLAN_BUDGET_EXCEEDED",
          `/actions/${i}/execution/gasLimit`,
          a.execution.gasLimit,
          { minimum: "2300", includesValueStipend: !0 }
        ))), atomic && (priorAtomicCall = a);
      } else priorAtomicCall = void 0;
      a.factory !== void 0 && addressRef(a.factory, `/actions/${i}/factory`), a.parent !== void 0 && addressRef(a.parent, `/actions/${i}/parent`), a.kind === "deployEoaCreate" && (!p.controller || !isDirectTransactionControllerV1(p.controller) || p.executor !== "controller_multi_step_v1" || a.authority?.kind !== "controller" || a.execution?.target !== null) && add(
        "PLAN_ACTION_BINDING_INVALID",
        `/actions/${i}`,
        a,
        { required: "direct_eoa_creation", controllerKinds: ["eoa", "delegated_eoa_v1"], executor: "controller_multi_step_v1", authority: "controller", target: null }
      );
      let c = componentMap.get(a.componentId);
      try {
        let predicted = a.kind === "deployCreate2" ? getCreate2Address({ from: addressRef(a.factory, `/actions/${i}/factory`), salt: a.salt, bytecode: a.initCode }) : a.kind === "deployEoaCreate" && canonicalUint(a.nonce) ? getContractAddress({ from: canonicalAddress(p.controller?.address, "controller"), nonce: BigInt(a.nonce) }) : a.kind === "deployCreate" && canonicalUint(a.nonce) ? getContractAddress({ from: addressRef(a.parent, `/actions/${i}/parent`), nonce: BigInt(a.nonce) }) : void 0;
        predicted && c && canonicalAddress(c.expectedAddress, "expectedAddress") !== predicted && add("PLAN_ACTION_BINDING_INVALID", `/components/${components.indexOf(c)}/expectedAddress`, c.expectedAddress, { equals: predicted, derivedFrom: `/actions/${i}` });
      } catch {
      }
    }), schemaValid && p.executor === "atomic_execute_and_stamp_v2")
      for (let issue of customLaunchPlanAtomicScheduleV2(p).issues)
        add(
          "PLAN_ACTION_BINDING_INVALID",
          `/actions/${issue.actionIndex}`,
          actions[issue.actionIndex],
          { required: "entry_or_completion_checks_only", reason: issue.reason, alternative: "controller_multi_step_v1" }
        );
    if (p.executor === "atomic_execute_and_stamp_v2" && (atomicCallCount < 1 || atomicCallCount > 32 || atomicCallBytes > 1048576) && add(
      "PLAN_ACTION_BINDING_INVALID",
      "/actions",
      { calls: atomicCallCount, bytes: atomicCallBytes },
      { minimumCalls: 1, maximumCalls: 32, maximumCalldataBytes: 1048576 }
    ), isObject(p.budgets)) {
      for (let [name, actual] of [["maxTotalValue", totalValue], ["maxTotalGas", totalGas]])
        canonicalUint(p.budgets[name]) && actual > BigInt(p.budgets[name]) && add("PLAN_BUDGET_EXCEEDED", `/budgets/${name}`, p.budgets[name], { minimum: actual.toString(), aggregate: "all_execution_actions" });
      canonicalUint(p.budgets.validAfter) && canonicalUint(p.budgets.deadline) && BigInt(p.budgets.deadline) <= BigInt(p.budgets.validAfter) && add("PLAN_WINDOW_INVALID", "/budgets/deadline", p.budgets.deadline, { greaterThan: p.budgets.validAfter });
    }
    markets.forEach((m, i) => {
      let a = addressRef(m.currency0, `/markets/${i}/currency0`), b = addressRef(m.currency1, `/markets/${i}/currency1`);
      addressRef(m.hooks, `/markets/${i}/hooks`), a && b && BigInt(a) >= BigInt(b) && add("PLAN_ACTION_BINDING_INVALID", `/markets/${i}/currency1`, b, { greaterThanAddress: a }), Number.isSafeInteger(m.fee) && m.fee > 1e6 && m.fee !== 8388608 && add("PLAN_ACTION_BINDING_INVALID", `/markets/${i}/fee`, m.fee, { staticMaximum: 1e6, dynamicFlag: 8388608 });
    }), rows("hookBindings").forEach((h, i) => {
      requireRef(componentMap, h.componentId, `/hookBindings/${i}/componentId`);
      let c = componentMap.get(h.componentId);
      if (Number.isSafeInteger(h.permissions) && h.permissions >= 0 && h.permissions <= 16383) {
        try {
          let actualMask = Number(BigInt(c?.expectedAddress) & 0x3fffn);
          actualMask !== h.permissions && add("PLAN_HOOK_PERMISSIONS_INVALID", `/hookBindings/${i}/permissions`, h.permissions, { addressBits: actualMask, componentId: h.componentId });
        } catch {
        }
        if (!openProvenance) for (let [delta, callback] of [[3, 7], [2, 6], [1, 10], [0, 8]]) h.permissions & 1 << delta && !(h.permissions & 1 << callback) && add("PLAN_HOOK_PERMISSIONS_INVALID", `/hookBindings/${i}/permissions`, h.permissions, { ifBit: delta, requiredBit: callback });
      }
    });
    for (let key of ["dependencies", "claimDescriptors"]) rows(key).forEach((d, i) => {
      typeof d.chainId == "string" && d.chainId !== p.chainId && add("PLAN_CHAIN_BINDING_INVALID", `/${key}/${i}/chainId`, d.chainId, { equals: p.chainId });
    });
    if (effects.forEach((e, i) => {
      e.target !== void 0 && addressRef(e.target, `/expectedEffects/${i}/target`), e.componentId !== void 0 && requireRef(componentMap, e.componentId, `/expectedEffects/${i}/componentId`, "PLAN_EFFECT_BINDING_INVALID"), isObject(e.derivation) && addressRef(e.derivation.parent, `/expectedEffects/${i}/derivation/parent`), canonicalUint(e.minimum) && canonicalUint(e.maximum) && BigInt(e.minimum) > BigInt(e.maximum) && add("PLAN_EFFECT_BINDING_INVALID", `/expectedEffects/${i}/maximum`, e.maximum, { minimum: e.minimum });
    }), rows("feeObligations").forEach((f, i) => {
      let mode = f.mode, n = mode === "not_applicable", scope = n ? "no_qualifying_swap_flow" : mode === "pool_enforced" ? "proven_pool_paths" : "programmable_built_or_routed_qualifying_swaps";
      ["not_applicable", "pool_enforced", "programmable_routed"].includes(mode) && (f.scope !== scope && add("PLAN_FEE_OBLIGATION_INVALID", `/feeObligations/${i}/scope`, f.scope, { equals: scope }, { action: "replace_value", value: scope }), f.rateBps !== (n ? 0 : 20) && add("PLAN_FEE_OBLIGATION_INVALID", `/feeObligations/${i}/rateBps`, f.rateBps, { equals: n ? 0 : 20 }, { action: "replace_value", value: n ? 0 : 20 }), (n ? f.recipient !== null : f.recipient === null || f.recipient === `0x${"0".repeat(40)}`) && add("PLAN_FEE_OBLIGATION_INVALID", `/feeObligations/${i}/recipient`, f.recipient, { expected: n ? "null" : "nonzero_bound_fee_recipient" })), Array.isArray(f.marketIds) && f.marketIds.forEach((m, j) => requireRef(marketMap, m, `/feeObligations/${i}/marketIds/${j}`, "PLAN_FEE_OBLIGATION_INVALID"));
    }), isObject(p.publication))
      for (let [key, map] of [["primaryComponentId", componentMap], ["primaryMarketId", marketMap]]) typeof p.publication[key] == "string" && !map.has(p.publication[key]) && add(openProvenance ? "PLAN_OPEN_PROVENANCE_BINDING_INVALID" : "PLAN_PUBLICATION_INVALID", `/publication/${key}`, p.publication[key], { memberOf: [...map.keys()] }, void 0, openProvenance ? "launchEligibility" : "distribution");
    if (isObject(p.verificationBundle) && Array.isArray(p.verificationBundle.components)) {
      let artifacts = new Map(p.verificationBundle.components.filter(isObject).map((c) => [c.targetId, c]));
      if (components.forEach((c, i) => requireRef(artifacts, c.artifactId, `/components/${i}/artifactId`, "PLAN_SOURCE_BINDING_INVALID")), !findings2.some((f) => f.jsonPointer.startsWith("/verificationBundle") && f.code === "PLAN_FIELD_INVALID"))
        try {
          let parsed = parseExactSourceVerificationBundleV2(p.verificationBundle), identities = /* @__PURE__ */ new Map();
          components.forEach((c) => {
            try {
              identities.set(c.artifactId, canonicalAddress(c.expectedAddress, "component")), identities.set(c.componentId, canonicalAddress(c.expectedAddress, "component"));
            } catch {
            }
          }), components.forEach((c, i) => {
            let a = parsed.publicBundle.components.find((v) => v.targetId === c.artifactId);
            if (a)
              try {
                let runtime = materializeDeclaredRuntimeV2(a.runtimeMaterialization, identities, c.artifactId), expected = keccak256(runtime);
                expected !== c.runtimeCodeHash && add("PLAN_RUNTIME_BINDING_INVALID", `/components/${i}/runtimeCodeHash`, c.runtimeCodeHash, { equals: expected, artifactId: c.artifactId });
              } catch {
                add("PLAN_SOURCE_BINDING_INVALID", `/verificationBundle/components/${parsed.publicBundle.components.indexOf(a)}/runtimeMaterialization`, { artifactId: c.artifactId }, { expected: "exact_materialized_runtime_and_resolved_immutables" });
              }
          });
        } catch {
          let located = !1;
          p.verificationBundle.components.forEach((a, i) => {
            let units = Array.isArray(p.verificationBundle.compilationUnits) ? p.verificationBundle.compilationUnits.filter((u) => u.compilationUnitId === a.compilationUnitId) : [];
            try {
              parseExactSourceVerificationBundleV2({ schemaVersion: p.verificationBundle.schemaVersion, compilationUnits: units, components: [a] });
            } catch {
              located = !0, add("PLAN_SOURCE_BINDING_INVALID", `/verificationBundle/components/${i}`, { artifactId: a.targetId, compilationUnitId: a.compilationUnitId }, { expected: "exact_canonical_source_compiler_and_runtime_bundle" });
            }
          }), located || add("PLAN_SOURCE_BINDING_INVALID", "/verificationBundle", { compilationUnitCount: p.verificationBundle.compilationUnits?.length, componentCount: artifacts.size }, { expected: "unique_sorted_exact_source_bundle" });
        }
    }
  }
}

// src/client/custom-launch-plan-packer-v1.ts
var CUSTOM_LAUNCH_PACKER_VERSION_V1 = CUSTOM_LAUNCH_MANIFEST_V1.packerVersion;
function packCustomLaunchPlanV1(input, options = { chainId: "4663" }) {
  let parsed = parseCustomLaunchPlanRequestV1(input, { ...options, allowNonCanonical: !0 });
  if (parsed.plan === null) return { request: null, exactRequestBytes: null, report: {
    schemaVersion: "programmable.custom-launch-plan-pack-report.v1",
    manifestDigest: options.manifestDigest ?? CUSTOM_LAUNCH_MANIFEST_DIGEST_V1,
    packerVersion: CUSTOM_LAUNCH_PACKER_VERSION_V1,
    status: "action_required",
    findings: parsed.findings,
    idempotencyKey: null
  } };
  let exactRequestBytes = Uint8Array.from(Buffer.from(canonicalJson(parsed.plan))), canonical = parseCustomLaunchPlanRequestV1(exactRequestBytes, options);
  return { request: canonical.plan, exactRequestBytes, report: {
    schemaVersion: "programmable.custom-launch-plan-pack-report.v1",
    manifestDigest: canonical.plan.manifestDigest,
    packerVersion: CUSTOM_LAUNCH_PACKER_VERSION_V1,
    status: "packed",
    findings: canonical.findings,
    planHash: canonical.planHash,
    rawRequestSha256: canonical.rawRequestSha256,
    idempotencyKey: `clp-v1-${canonical.rawRequestSha256.slice(7)}`,
    byteLength: exactRequestBytes.byteLength,
    validation: "offline_declarations_only",
    compilerExecution: "required_on_server",
    productionAuthority: !1,
    walletSigning: !1
  } };
}
function repairCustomLaunchPlanV1(input, options = { chainId: "4663" }) {
  let parsed = parseCustomLaunchPlanRequestV1(input, { ...options, allowNonCanonical: !0 }), value;
  try {
    value = JSON.parse(JSON.stringify(parseStrictJsonV4(new TextDecoder("utf-8", { fatal: !0 }).decode(input), {
      maximumBytes: CUSTOM_LAUNCH_LIMITS_V1.requestBytes,
      maximumDepth: CUSTOM_LAUNCH_LIMITS_V1.jsonDepth
    })));
  } catch {
    return { appliedRepairs: [], result: packCustomLaunchPlanV1(input, options) };
  }
  let appliedRepairs = [];
  for (let finding of parsed.findings) {
    if (finding.repair.action !== "replace_value" || finding.repair.value === void 0 || !(finding.jsonPointer === "/manifestDigest" || /^\/feeObligations\/[0-9]+\/(?:scope|rateBps)$/u.test(finding.jsonPointer))) continue;
    let tokens = finding.jsonPointer.slice(1).split("/").map((v) => v.replace(/~1/gu, "/").replace(/~0/gu, "~")), current = value;
    for (let token of tokens.slice(0, -1)) current = current[token];
    current[tokens.at(-1)] = finding.repair.value, appliedRepairs.push(finding);
  }
  let repaired = Uint8Array.from(Buffer.from(canonicalJson(value)));
  return { appliedRepairs, result: packCustomLaunchPlanV1(repaired, options) };
}

// src/client/custom-launch-plan-packer-cli-v1.ts
async function runCustomLaunchPlanPackerCliV1(args) {
  let options = /* @__PURE__ */ new Map(), repair = !1;
  for (let i = 0; i < args.length; i++) {
    let arg = args[i];
    if (arg === "--repair" && !repair) {
      repair = !0;
      continue;
    }
    if (!["--input", "--out", "--report"].includes(arg) || options.has(arg) || !args[i + 1] || args[i + 1].startsWith("--")) throw new TypeError("Usage: --input plan.json --out request.canonical.json --report pack-report.json [--repair]");
    options.set(arg, args[++i]);
  }
  if (options.size !== 3) throw new TypeError("Input, output and report paths are required");
  let source = await open(options.get("--input"), constants.O_RDONLY | constants.O_NOFOLLOW), bytes;
  try {
    let stat = await source.stat();
    if (!stat.isFile() || stat.size > CUSTOM_LAUNCH_LIMITS_V1.requestBytes) throw new TypeError("Input is not a bounded regular file");
    if (bytes = await source.readFile(), bytes.length !== stat.size) throw new TypeError("Input changed while reading");
  } finally {
    await source.close();
  }
  let result = repair ? repairCustomLaunchPlanV1(bytes).result : packCustomLaunchPlanV1(bytes), report = await open(options.get("--report"), "wx", 384);
  try {
    await report.writeFile(`${JSON.stringify(result.report, null, 2)}
`);
  } finally {
    await report.close();
  }
  if (result.exactRequestBytes !== null) {
    let output = await open(options.get("--out"), "wx", 384);
    try {
      await output.writeFile(result.exactRequestBytes);
    } finally {
      await output.close();
    }
  }
  return result.exactRequestBytes === null ? 2 : 0;
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href)
  if (process.argv.includes("--version")) process.stdout.write(`programmable.custom-launch-plan-packer.v1 ${CUSTOM_LAUNCH_PACKER_VERSION_V1} ${CUSTOM_LAUNCH_MANIFEST_DIGEST_V1}
`);
  else try {
    process.exitCode = await runCustomLaunchPlanPackerCliV1(process.argv.slice(2));
  } catch {
    process.stderr.write(`PLAN_PACKER_INPUT_INVALID: use --input plan.json --out new-request.json --report new-report.json [--repair]; existing outputs are preserved.
`), process.exitCode = 2;
  }
export {
  runCustomLaunchPlanPackerCliV1
};
