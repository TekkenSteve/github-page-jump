#!/usr/bin/env node
/**
 * Verifies that the package and manifest versions stay in lockstep.
 *
 * Releases are triggered by `package.json#version`, so a mismatch would publish
 * an archive whose manifest reports a different version than its tag.
 */

import { readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = resolve(fileURLToPath(new URL("..", import.meta.url)));
const SEMVER = /^\d+\.\d+\.\d+(?:-[\w.-]+)?$/;

const { version: packageVersion } = JSON.parse(readFileSync(join(ROOT, "package.json"), "utf8"));
const { version: manifestVersion } = JSON.parse(readFileSync(join(ROOT, "manifest.json"), "utf8"));

/** @type {string[]} */
const problems = [];

if (!SEMVER.test(String(packageVersion))) {
  problems.push(`package.json#version "${packageVersion}" is not valid semver`);
}

if (!SEMVER.test(String(manifestVersion))) {
  problems.push(`manifest.json#version "${manifestVersion}" is not valid semver`);
}

if (packageVersion !== manifestVersion) {
  problems.push(
    `version mismatch: package.json is "${packageVersion}" but manifest.json is "${manifestVersion}"`
  );
}

if (problems.length > 0) {
  problems.forEach((problem) => process.stderr.write(`error: ${problem}\n`));
  process.exit(1);
}

process.stdout.write(`version ok: ${packageVersion}\n`);
