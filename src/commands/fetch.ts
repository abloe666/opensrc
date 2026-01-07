import {
  detectInputType,
  parsePackageSpec,
  resolvePackage,
} from "../lib/registries/index.js";
import { parseRepoSpec, resolveRepo } from "../lib/repo.js";
import { detectInstalledVersion } from "../lib/version.js";
import {
  fetchSource,
  fetchRepoSource,
  packageExists,
  repoExists,
  listSources,
  getPackageInfo,
  getRepoInfo,
  getPackageRelativePath,
  getRepoRelativePath,
} from "../lib/git.js";
import { ensureGitignore } from "../lib/gitignore.js";
import { ensureTsconfigExclude } from "../lib/tsconfig.js";
import { updateAgentsMd, updatePackageIndex } from "../lib/agents.js";
import {
  getFileModificationPermission,
  setFileModificationPermission,
} from "../lib/settings.js";
import { confirm } from "../lib/prompt.js";
import type { FetchResult, Ecosystem } from "../types.js";

export interface FetchOptions {
  cwd?: string;
  /** Override file modification permission: true = allow, false = deny, undefined = prompt */
  allowModifications?: boolean;
}

/**
 * Check if file modifications are allowed
 */
async function checkFileModificationPermission(
  cwd: string,
  cliOverride?: boolean,
): Promise<boolean> {
  if (cliOverride !== undefined) {
    await setFileModificationPermission(cliOverride, cwd);
    if (cliOverride) {
      console.log("✓ File modifications enabled (--modify)");
    } else {
      console.log("✗ File modifications disabled (--modify=false)");
    }
    return cliOverride;
  }

  const storedPermission = await getFileModificationPermission(cwd);
  if (storedPermission !== undefined) {
    return storedPermission;
  }

  console.log(
    "\nopensrc can update the following files for better integration:",
  );
  console.log("  • .gitignore - add opensrc/ to ignore list");
  console.log("  • tsconfig.json - exclude opensrc/ from compilation");
  console.log("  • AGENTS.md - add source code reference section\n");

  const allowed = await confirm("Allow opensrc to modify these files?");

  await setFileModificationPermission(allowed, cwd);

  if (allowed) {
    console.log("✓ Permission granted - saved to opensrc/settings.json\n");
  } else {
    console.log("✗ Permission denied - saved to opensrc/settings.json\n");
  }

  return allowed;
}

/**
 * Get ecosystem display name
 */
function getEcosystemLabel(ecosystem: Ecosystem): string {
  switch (ecosystem) {
    case "npm":
      return "npm";
    case "pypi":
      return "PyPI";
    case "crates":
      return "crates.io";
  }
}

/**
 * Fetch a git repository
 */
async function fetchRepoInput(spec: string, cwd: string): Promise<FetchResult> {
  const repoSpec = parseRepoSpec(spec);

  if (!repoSpec) {
    return {
      package: spec,
      version: "",
      path: "",
      success: false,
      error: `Invalid repository format: ${spec}`,
    };
  }

  const displayName = `${repoSpec.host}/${repoSpec.owner}/${repoSpec.repo}`;
  console.log(
    `\nFetching ${repoSpec.owner}/${repoSpec.repo} from ${repoSpec.host}...`,
  );

  try {
    // Check if already exists with the same ref
    if (repoExists(displayName, cwd)) {
      const existing = await getRepoInfo(displayName, cwd);
      if (existing && repoSpec.ref && existing.version === repoSpec.ref) {
        console.log(`  ✓ Already up to date (${repoSpec.ref})`);
        return {
          package: displayName,
          version: existing.version,
          path: getRepoRelativePath(displayName),
          success: true,
        };
      } else if (existing) {
        console.log(
          `  → Updating ${existing.version} → ${repoSpec.ref || "default branch"}`,
        );
      }
    }

    // Resolve repo info from API
    console.log(`  → Resolving repository...`);
    const resolved = await resolveRepo(repoSpec);
    console.log(`  → Found: ${resolved.repoUrl}`);
    console.log(`  → Ref: ${resolved.ref}`);

    // Fetch the source
    console.log(`  → Cloning at ${resolved.ref}...`);
    const result = await fetchRepoSource(resolved, cwd);

    if (result.success) {
      console.log(`  ✓ Saved to opensrc/${result.path}`);
      if (result.error) {
        console.log(`  ⚠ ${result.error}`);
      }
    } else {
      console.log(`  ✗ Failed: ${result.error}`);
    }

    return result;
  } catch (err) {
    const errorMessage = err instanceof Error ? err.message : String(err);
    console.log(`  ✗ Error: ${errorMessage}`);
    return {
      package: displayName,
      version: "",
      path: "",
      success: false,
      error: errorMessage,
    };
  }
}

/**
 * Fetch a package from any ecosystem
 */
async function fetchPackageInput(
  spec: string,
  cwd: string,
): Promise<FetchResult> {
  const packageSpec = parsePackageSpec(spec);
  const { ecosystem, name } = packageSpec;
  let { version } = packageSpec;

  const ecosystemLabel = getEcosystemLabel(ecosystem);
  console.log(`\nFetching ${name} from ${ecosystemLabel}...`);

  try {
    // For npm, try to detect installed version if not specified
    if (!version && ecosystem === "npm") {
      const installedVersion = await detectInstalledVersion(name, cwd);
      if (installedVersion) {
        version = installedVersion;
        console.log(`  → Detected installed version: ${version}`);
      } else {
        console.log(`  → No installed version found, using latest`);
      }
    } else if (!version) {
      console.log(`  → Using latest version`);
    } else {
      console.log(`  → Using specified version: ${version}`);
    }

    // Check if already exists with the same version
    if (packageExists(name, cwd, ecosystem)) {
      const existing = await getPackageInfo(name, cwd, ecosystem);
      if (existing && existing.version === version) {
        console.log(`  ✓ Already up to date (${version})`);
        return {
          package: name,
          version: existing.version,
          path: existing.path,
          success: true,
          ecosystem,
        };
      } else if (existing) {
        console.log(
          `  → Updating ${existing.version} → ${version || "latest"}`,
        );
      }
    }

    // Resolve package info from registry
    console.log(`  → Resolving repository...`);
    const resolved = await resolvePackage({
      ecosystem,
      name,
      version,
    });
    console.log(`  → Found: ${resolved.repoUrl}`);

    if (resolved.repoDirectory) {
      console.log(`  → Monorepo path: ${resolved.repoDirectory}`);
    }

    // Fetch the source
    console.log(`  → Cloning at ${resolved.gitTag}...`);
    const result = await fetchSource(resolved, cwd);

    if (result.success) {
      console.log(`  ✓ Saved to opensrc/${result.path}`);
      if (result.error) {
        console.log(`  ⚠ ${result.error}`);
      }
    } else {
      console.log(`  ✗ Failed: ${result.error}`);
    }

    return result;
  } catch (err) {
    const errorMessage = err instanceof Error ? err.message : String(err);
    console.log(`  ✗ Error: ${errorMessage}`);
    return {
      package: name,
      version: "",
      path: "",
      success: false,
      error: errorMessage,
      ecosystem,
    };
  }
}

/**
 * Merge new results into existing sources
 */
function mergeResults(
  existing: {
    packages: Record<Ecosystem, Array<{ name: string; version: string; path: string; fetchedAt: string; ecosystem: Ecosystem }>>;
    repos: Array<{ name: string; version: string; path: string; fetchedAt: string }>;
  },
  results: FetchResult[],
): {
  packages: Record<Ecosystem, Array<{ name: string; version: string; path: string; fetchedAt: string; ecosystem: Ecosystem }>>;
  repos: Array<{ name: string; version: string; path: string; fetchedAt: string }>;
} {
  const now = new Date().toISOString();

  for (const result of results) {
    if (!result.success) continue;

    if (result.ecosystem) {
      // It's a package
      const ecosystem = result.ecosystem;
      const idx = existing.packages[ecosystem].findIndex(
        (p) => p.name === result.package,
      );
      const entry = {
        name: result.package,
        version: result.version,
        path: result.path,
        fetchedAt: now,
        ecosystem,
      };

      if (idx >= 0) {
        existing.packages[ecosystem][idx] = entry;
      } else {
        existing.packages[ecosystem].push(entry);
      }
    } else {
      // It's a repo
      const idx = existing.repos.findIndex((r) => r.name === result.package);
      const entry = {
        name: result.package,
        version: result.version,
        path: result.path,
        fetchedAt: now,
      };

      if (idx >= 0) {
        existing.repos[idx] = entry;
      } else {
        existing.repos.push(entry);
      }
    }
  }

  return existing;
}

/**
 * Fetch source code for one or more packages or repositories
 */
export async function fetchCommand(
  packages: string[],
  options: FetchOptions = {},
): Promise<FetchResult[]> {
  const cwd = options.cwd || process.cwd();
  const results: FetchResult[] = [];

  // Check if we're allowed to modify files
  const canModifyFiles = await checkFileModificationPermission(
    cwd,
    options.allowModifications,
  );

  if (canModifyFiles) {
    const gitignoreUpdated = await ensureGitignore(cwd);
    if (gitignoreUpdated) {
      console.log("✓ Added opensrc/ to .gitignore");
    }

    const tsconfigUpdated = await ensureTsconfigExclude(cwd);
    if (tsconfigUpdated) {
      console.log("✓ Added opensrc/ to tsconfig.json exclude");
    }
  }

  for (const spec of packages) {
    const inputType = detectInputType(spec);

    if (inputType === "repo") {
      const result = await fetchRepoInput(spec, cwd);
      results.push(result);
    } else {
      const result = await fetchPackageInput(spec, cwd);
      results.push(result);
    }
  }

  // Summary
  const successful = results.filter((r) => r.success).length;
  const failed = results.filter((r) => !r.success).length;

  console.log(`\nDone: ${successful} succeeded, ${failed} failed`);

  // Update sources.json with all fetched sources
  if (successful > 0) {
    const existingSources = await listSources(cwd);
    const mergedSources = mergeResults(existingSources, results);

    if (canModifyFiles) {
      const agentsUpdated = await updateAgentsMd(mergedSources, cwd);
      if (agentsUpdated) {
        console.log("✓ Updated AGENTS.md");
      }
    } else {
      await updatePackageIndex(mergedSources, cwd);
    }
  }

  return results;
}
