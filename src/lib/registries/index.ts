import type { Ecosystem, PackageSpec, ResolvedPackage } from "../../types.js";
import { parseNpmSpec, resolveNpmPackage } from "./npm.js";
import { parsePyPISpec, resolvePyPIPackage } from "./pypi.js";
import { parseCratesSpec, resolveCrate } from "./crates.js";
import { isRepoSpec } from "../repo.js";

export { resolveNpmPackage } from "./npm.js";
export { resolvePyPIPackage } from "./pypi.js";
export { resolveCrate } from "./crates.js";

/**
 * Ecosystem prefixes for explicit specification
 */
const ECOSYSTEM_PREFIXES: Record<string, Ecosystem> = {
  "npm:": "npm",
  "pypi:": "pypi",
  "pip:": "pypi",
  "python:": "pypi",
  "crates:": "crates",
  "cargo:": "crates",
  "rust:": "crates",
};

/**
 * Detect the ecosystem from a package specifier
 * Returns the ecosystem and the cleaned spec (without prefix)
 */
export function detectEcosystem(spec: string): {
  ecosystem: Ecosystem;
  cleanSpec: string;
} {
  const trimmed = spec.trim();

  // Check for explicit prefix
  for (const [prefix, ecosystem] of Object.entries(ECOSYSTEM_PREFIXES)) {
    if (trimmed.toLowerCase().startsWith(prefix)) {
      return {
        ecosystem,
        cleanSpec: trimmed.slice(prefix.length),
      };
    }
  }

  // Default to npm if no prefix
  return {
    ecosystem: "npm",
    cleanSpec: trimmed,
  };
}

/**
 * Parse a package specifier with ecosystem detection
 */
export function parsePackageSpec(spec: string): PackageSpec {
  const { ecosystem, cleanSpec } = detectEcosystem(spec);

  let name: string;
  let version: string | undefined;

  switch (ecosystem) {
    case "npm":
      ({ name, version } = parseNpmSpec(cleanSpec));
      break;
    case "pypi":
      ({ name, version } = parsePyPISpec(cleanSpec));
      break;
    case "crates":
      ({ name, version } = parseCratesSpec(cleanSpec));
      break;
  }

  return { ecosystem, name, version };
}

/**
 * Resolve a package to its repository information
 */
export async function resolvePackage(
  spec: PackageSpec,
): Promise<ResolvedPackage> {
  const { ecosystem, name, version } = spec;

  switch (ecosystem) {
    case "npm":
      return resolveNpmPackage(name, version);
    case "pypi":
      return resolvePyPIPackage(name, version);
    case "crates":
      return resolveCrate(name, version);
  }
}

/**
 * Detect whether the input is a package or a repo
 */
export function detectInputType(
  spec: string,
): "package" | "repo" {
  const trimmed = spec.trim();

  // Check for explicit ecosystem prefix -> package
  for (const prefix of Object.keys(ECOSYSTEM_PREFIXES)) {
    if (trimmed.toLowerCase().startsWith(prefix)) {
      return "package";
    }
  }

  // Check if it looks like a repo spec
  if (isRepoSpec(trimmed)) {
    return "repo";
  }

  // Default to package
  return "package";
}

