#!/usr/bin/env node
/**
 * Packages the extension into a store-ready ZIP archive.
 *
 * The script uses only Node built-ins so releases never depend on a working
 * `zip` binary or third-party packages.
 */

import { mkdirSync, readdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { join, relative, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { deflateRawSync } from "node:zlib";

const ROOT = resolve(fileURLToPath(new URL("..", import.meta.url)));
const DIST_DIR = join(ROOT, "dist");
const INCLUDED_PATHS = ["manifest.json", "LICENSE", "icons", "src"];
const CRC_TABLE = buildCrcTable();

/**
 * Builds the CRC-32 lookup table used by the ZIP format.
 *
 * @returns {Uint32Array} The 256-entry lookup table.
 */
function buildCrcTable() {
  const table = new Uint32Array(256);

  for (let index = 0; index < 256; index += 1) {
    let value = index;
    for (let bit = 0; bit < 8; bit += 1) {
      value = value & 1 ? 0xedb88320 ^ (value >>> 1) : value >>> 1;
    }
    table[index] = value >>> 0;
  }

  return table;
}

/**
 * Computes the CRC-32 checksum of a buffer.
 *
 * @param {Buffer} buffer The data to checksum.
 * @returns {number} The unsigned CRC-32 value.
 */
function crc32(buffer) {
  let checksum = 0xffffffff;

  for (const byte of buffer) {
    checksum = CRC_TABLE[(checksum ^ byte) & 0xff] ^ (checksum >>> 8);
  }

  return (checksum ^ 0xffffffff) >>> 0;
}

/**
 * Converts a date to the MS-DOS date and time encoding used by ZIP entries.
 *
 * @param {Date} value The timestamp to encode.
 * @returns {{date: number, time: number}} The encoded fields.
 */
function toDosDateTime(value) {
  const year = Math.max(value.getFullYear(), 1980);
  return {
    date: ((year - 1980) << 9) | ((value.getMonth() + 1) << 5) | value.getDate(),
    time: (value.getHours() << 11) | (value.getMinutes() << 5) | (value.getSeconds() >> 1)
  };
}

/**
 * Collects every file that belongs in the release archive.
 *
 * @param {string} target The file or directory to walk.
 * @returns {string[]} Repo-relative POSIX paths.
 */
function collectFiles(target) {
  const absolute = join(ROOT, target);
  if (statSync(absolute).isFile()) {
    return [target];
  }

  return readdirSync(absolute)
    .flatMap((entry) => collectFiles(join(target, entry)))
    .map((entry) => entry.split(sep).join("/"));
}

/**
 * Reads the manifest version used for the archive name.
 *
 * @returns {string} The manifest version.
 */
function readVersion() {
  const manifest = JSON.parse(readFileSync(join(ROOT, "manifest.json"), "utf8"));
  return String(manifest.version);
}

/**
 * Builds a ZIP archive from the collected files.
 *
 * @param {string[]} files Repo-relative POSIX paths.
 * @returns {Buffer} The archive contents.
 */
function createZip(files) {
  /** @type {Buffer[]} */
  const localParts = [];
  /** @type {Buffer[]} */
  const centralParts = [];
  let offset = 0;

  for (const file of files) {
    const buffer = readFileSync(join(ROOT, file));
    const compressed = deflateRawSync(buffer, { level: 9 });
    const name = Buffer.from(file, "utf8");
    const checksum = crc32(buffer);
    const { date, time } = toDosDateTime(statSync(join(ROOT, file)).mtime);

    const localHeader = Buffer.alloc(30);
    localHeader.writeUInt32LE(0x04034b50, 0);
    localHeader.writeUInt16LE(20, 4);
    localHeader.writeUInt16LE(0, 6);
    localHeader.writeUInt16LE(8, 8);
    localHeader.writeUInt16LE(time, 10);
    localHeader.writeUInt16LE(date, 12);
    localHeader.writeUInt32LE(checksum, 14);
    localHeader.writeUInt32LE(compressed.length, 18);
    localHeader.writeUInt32LE(buffer.length, 22);
    localHeader.writeUInt16LE(name.length, 26);
    localHeader.writeUInt16LE(0, 28);

    localParts.push(localHeader, name, compressed);

    const centralHeader = Buffer.alloc(46);
    centralHeader.writeUInt32LE(0x02014b50, 0);
    centralHeader.writeUInt16LE(20, 4);
    centralHeader.writeUInt16LE(20, 6);
    centralHeader.writeUInt16LE(0, 8);
    centralHeader.writeUInt16LE(8, 10);
    centralHeader.writeUInt16LE(time, 12);
    centralHeader.writeUInt16LE(date, 14);
    centralHeader.writeUInt32LE(checksum, 16);
    centralHeader.writeUInt32LE(compressed.length, 20);
    centralHeader.writeUInt32LE(buffer.length, 24);
    centralHeader.writeUInt16LE(name.length, 28);
    centralHeader.writeUInt16LE(0, 30);
    centralHeader.writeUInt16LE(0, 32);
    centralHeader.writeUInt16LE(0, 34);
    centralHeader.writeUInt16LE(0, 36);
    centralHeader.writeUInt32LE(0, 38);
    centralHeader.writeUInt32LE(offset, 42);

    centralParts.push(centralHeader, name);

    offset += localHeader.length + name.length + compressed.length;
  }

  const localBuffer = Buffer.concat(localParts);
  const centralBuffer = Buffer.concat(centralParts);
  const endRecord = Buffer.alloc(22);
  endRecord.writeUInt32LE(0x06054b50, 0);
  endRecord.writeUInt16LE(0, 4);
  endRecord.writeUInt16LE(0, 6);
  endRecord.writeUInt16LE(files.length, 8);
  endRecord.writeUInt16LE(files.length, 10);
  endRecord.writeUInt32LE(centralBuffer.length, 12);
  endRecord.writeUInt32LE(localBuffer.length, 16);
  endRecord.writeUInt16LE(0, 20);

  return Buffer.concat([localBuffer, centralBuffer, endRecord]);
}

// Declaration files exist only for type checking and never ship at runtime.
const files = INCLUDED_PATHS.flatMap(collectFiles)
  .filter((file) => !file.endsWith(".d.ts"))
  .sort();
const version = readVersion();
const archiveName = `github-page-jump-v${version}.zip`;

mkdirSync(DIST_DIR, { recursive: true });
writeFileSync(join(DIST_DIR, archiveName), createZip(files));

process.stdout.write(`Created dist/${archiveName} (${files.length} files)\n`);
files.forEach((file) => process.stdout.write(`  ${relative(ROOT, join(ROOT, file))}\n`));
