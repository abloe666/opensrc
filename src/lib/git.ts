import { simpleGit, SimpleGit } from "simple-git";
import { rm, mkdir, readFile } from "fs/promises";
import { join } from "path";
import { existsSync } from "fs";
import type {
  ResolvedPackage,
  ResolvedRepo,
  FetchResult,
  Ecosystem,
} from "../types.js";

const OPENSRC_DIR = "opensrc";
const PACKAGES_DIR = "packages";
const REPOS_DIR = "repos";
const SOURCES_FILE = "sources.json";

/**
 * Get the opensrc directory path
 */
export function getOpensrcDir(cwd: string = process.cwd()): string {
  return join(cwd, OPENSRC_DIR);
}

/**
 * Get the packages directory path for a specific ecosystem
 */
export function getPackagesDir(
  cwd: string = process.cwd(),
  ecosystem?: Ecosystem,
): string {
  const base = join(getOpensrcDir(cwd), PACKAGES_DIR);
  return ecosystem ? join(base, ecosystem) : base;
}

/**
 * Get the repos directory path
 */
export function getReposDir(cwd: string = process.cwd()): string {
  return join(getOpensrcDir(cwd), REPOS_DIR);
}

/**
 * Get the path where a package's source will be stored
 */
export function getPackagePath(
  packageName: string,
  cwd: string = process.cwd(),
  ecosystem: Ecosystem = "npm",
): string {
  return join(getPackagesDir(cwd, ecosystem), packageName);
}

/**
 * Get the relative path for a package (for sources.json)
 */
export function getPackageRelativePath(
  packageName: string,
  ecosystem: Ecosystem = "npm",
): string {
  return `${PACKAGES_DIR}/${ecosystem}/${packageName}`;
}

/**
 * Get the path where a repo's source will be stored
 */
export function getRepoPath(
  displayName: string,
  cwd: string = process.cwd(),
): string {
  return join(getReposDir(cwd), displayName);
}

/**
 * Get the relative path for a repo (for sources.json)
 */
export function getRepoRelativePath(displayName: string): string {
  return `${REPOS_DIR}/${displayName}`;
}

/**
 * Read the sources.json file
 */
async function readSourcesJson(cwd: string): Promise<{
  packages?: Record<string, Array<{ name: string; version: string; path: string; fetchedAt: string }>>;
  repos?: Array<{ name: string; version: string; path: string; fetchedAt: string }>;
} | null> {
  const sourcesPath = join(getOpensrcDir(cwd), SOURCES_FILE);
  
  if (!existsSync(sourcesPath)) {
    return null;
  }

  try {
    const content = await readFile(sourcesPath, "utf-8");
    return JSON.parse(content);
  } catch {
    return null;
  }
}

/**
 * Check if a package source already exists
 */
export function packageExists(
  packageName: string,
  cwd: string = process.cwd(),
  ecosystem: Ecosystem = "npm",
): boolean {
  return existsSync(getPackagePath(packageName, cwd, ecosystem));
}

/**
 * Check if a repo source already exists
 */
export function repoExists(
  displayName: string,
  cwd: string = process.cwd(),
): boolean {
  return existsSync(getRepoPath(displayName, cwd));
}

/**
 * Get package info from sources.json
 */
export async function getPackageInfo(
  packageName: string,
  cwd: string = process.cwd(),
  ecosystem: Ecosystem = "npm",
): Promise<{ name: string; version: string; path: string; fetchedAt: string } | null> {
  const sources = await readSourcesJson(cwd);
  if (!sources?.packages?.[ecosystem]) {
    return null;
  }
  
  return sources.packages[ecosystem].find(p => p.name === packageName) || null;
}

/**
 * Get repo info from sources.json
 */
export async function getRepoInfo(
  displayName: string,
  cwd: string = process.cwd(),
): Promise<{ name: string; version: string; path: string; fetchedAt: string } | null> {
  const sources = await readSourcesJson(cwd);
  if (!sources?.repos) {
    return null;
  }
  
  return sources.repos.find(r => r.name === displayName) || null;
}

/**
 * Try to clone at a specific tag, with fallbacks
 */
async function cloneAtTag(
  git: SimpleGit,
  repoUrl: string,
  targetPath: string,
  version: string,
): Promise<{ success: boolean; tag?: string; error?: string }> {
  const tagsToTry = [`v${version}`, version, `${version}`];

  for (const tag of tagsToTry) {
    try {
      await git.clone(repoUrl, targetPath, [
        "--depth",
        "1",
        "--branch",
        tag,
        "--single-branch",
      ]);
      return { success: true, tag };
    } catch {
      continue;
    }
  }

  // If no tag worked, clone default branch with a warning
  try {
    await git.clone(repoUrl, targetPath, ["--depth", "1"]);
    return {
      success: true,
      tag: "HEAD",
      error: `Could not find tag for version ${version}, cloned default branch instead`,
    };
  } catch (err) {
    return {
      success: false,
      error: `Failed to clone repository: ${err instanceof Error ? err.message : String(err)}`,
    };
  }
}

/**
 * Clone a repository at a specific ref (branch, tag, or commit)
 */
async function cloneAtRef(
  git: SimpleGit,
  repoUrl: string,
  targetPath: string,
  ref: string,
): Promise<{ success: boolean; ref?: string; error?: string }> {
  try {
    await git.clone(repoUrl, targetPath, [
      "--depth",
      "1",
      "--branch",
      ref,
      "--single-branch",
    ]);
    return { success: true, ref };
  } catch {
    // Ref might be a commit or doesn't exist as a branch/tag
  }

  // Clone default branch
  try {
    await git.clone(repoUrl, targetPath, ["--depth", "1"]);
    return {
      success: true,
      ref: "HEAD",
      error: `Could not find ref "${ref}", cloned default branch instead`,
    };
  } catch (err) {
    return {
      success: false,
      error: `Failed to clone repository: ${err instanceof Error ? err.message : String(err)}`,
    };
  }
}

/**
 * Fetch source code for a resolved package
 */
export async function fetchSource(
  resolved: ResolvedPackage,
  cwd: string = process.cwd(),
): Promise<FetchResult> {
  const git = simpleGit();
  const packagePath = getPackagePath(resolved.name, cwd, resolved.ecosystem);
  const packagesDir = getPackagesDir(cwd, resolved.ecosystem);

  // Ensure packages directory exists
  if (!existsSync(packagesDir)) {
    await mkdir(packagesDir, { recursive: true });
  }

  // Remove existing if present
  if (existsSync(packagePath)) {
    await rm(packagePath, { recursive: true, force: true });
  }

  // Ensure parent directory exists for scoped packages
  const parentDir = join(packagePath, "..");
  if (!existsSync(parentDir)) {
    await mkdir(parentDir, { recursive: true });
  }

  // Clone the repository
  const cloneResult = await cloneAtTag(
    git,
    resolved.repoUrl,
    packagePath,
    resolved.version,
  );

  if (!cloneResult.success) {
    return {
      package: resolved.name,
      version: resolved.version,
      path: getPackageRelativePath(resolved.name, resolved.ecosystem),
      success: false,
      error: cloneResult.error,
      ecosystem: resolved.ecosystem,
    };
  }

  // Remove .git directory to save space and avoid confusion
  const gitDir = join(packagePath, ".git");
  if (existsSync(gitDir)) {
    await rm(gitDir, { recursive: true, force: true });
  }

  // Determine the actual source path (for monorepos)
  let relativePath = getPackageRelativePath(resolved.name, resolved.ecosystem);
  if (resolved.repoDirectory) {
    relativePath = `${relativePath}/${resolved.repoDirectory}`;
  }

  return {
    package: resolved.name,
    version: resolved.version,
    path: relativePath,
    success: true,
    error: cloneResult.error,
    ecosystem: resolved.ecosystem,
  };
}

/**
 * Fetch source code for a resolved repository
 */
export async function fetchRepoSource(
  resolved: ResolvedRepo,
  cwd: string = process.cwd(),
): Promise<FetchResult> {
  const git = simpleGit();
  const repoPath = getRepoPath(resolved.displayName, cwd);
  const reposDir = getReposDir(cwd);

  // Ensure repos directory exists
  if (!existsSync(reposDir)) {
    await mkdir(reposDir, { recursive: true });
  }

  // Remove existing if present
  if (existsSync(repoPath)) {
    await rm(repoPath, { recursive: true, force: true });
  }

  // Ensure parent directories exist (for host/owner structure)
  const parentDir = join(repoPath, "..");
  if (!existsSync(parentDir)) {
    await mkdir(parentDir, { recursive: true });
  }

  // Clone the repository
  const cloneResult = await cloneAtRef(
    git,
    resolved.repoUrl,
    repoPath,
    resolved.ref,
  );

  if (!cloneResult.success) {
    return {
      package: resolved.displayName,
      version: resolved.ref,
      path: getRepoRelativePath(resolved.displayName),
      success: false,
      error: cloneResult.error,
    };
  }

  // Remove .git directory to save space and avoid confusion
  const gitDir = join(repoPath, ".git");
  if (existsSync(gitDir)) {
    await rm(gitDir, { recursive: true, force: true });
  }

  return {
    package: resolved.displayName,
    version: resolved.ref,
    path: getRepoRelativePath(resolved.displayName),
    success: true,
    error: cloneResult.error,
  };
}

/**
 * Remove source code for a package
 */
export async function removePackageSource(
  packageName: string,
  cwd: string = process.cwd(),
  ecosystem: Ecosystem = "npm",
): Promise<boolean> {
  const packagePath = getPackagePath(packageName, cwd, ecosystem);

  if (!existsSync(packagePath)) {
    return false;
  }

  await rm(packagePath, { recursive: true, force: true });

  // Clean up empty parent directories (for scoped packages)
  if (packageName.startsWith("@")) {
    const scopeDir = join(
      getPackagesDir(cwd, ecosystem),
      packageName.split("/")[0],
    );
    try {
      const { readdir } = await import("fs/promises");
      const contents = await readdir(scopeDir);
      if (contents.length === 0) {
        await rm(scopeDir, { recursive: true, force: true });
      }
    } catch {
      // Ignore errors cleaning up scope dir
    }
  }

  return true;
}

/**
 * Remove source code for a repo
 */
export async function removeRepoSource(
  displayName: string,
  cwd: string = process.cwd(),
): Promise<boolean> {
  const repoPath = getRepoPath(displayName, cwd);

  if (!existsSync(repoPath)) {
    return false;
  }

  await rm(repoPath, { recursive: true, force: true });

  // Clean up empty parent directories (host/owner)
  const parts = displayName.split("/");
  if (parts.length === 3) {
    const { readdir } = await import("fs/promises");
    const reposDir = getReposDir(cwd);

    // Try to clean up owner directory
    const ownerDir = join(reposDir, parts[0], parts[1]);
    try {
      const ownerContents = await readdir(ownerDir);
      if (ownerContents.length === 0) {
        await rm(ownerDir, { recursive: true, force: true });
      }
    } catch {
      // Ignore errors
    }

    // Try to clean up host directory
    const hostDir = join(reposDir, parts[0]);
    try {
      const hostContents = await readdir(hostDir);
      if (hostContents.length === 0) {
        await rm(hostDir, { recursive: true, force: true });
      }
    } catch {
      // Ignore errors
    }
  }

  return true;
}

/**
 * @deprecated Use removePackageSource instead
 */
export async function removeSource(
  packageName: string,
  cwd: string = process.cwd(),
): Promise<boolean> {
  return removePackageSource(packageName, cwd, "npm");
}

/**
 * List all fetched sources from sources.json
 */
export async function listSources(cwd: string = process.cwd()): Promise<{
  packages: Record<
    Ecosystem,
    Array<{
      name: string;
      version: string;
      path: string;
      fetchedAt: string;
      ecosystem: Ecosystem;
    }>
  >;
  repos: Array<{
    name: string;
    version: string;
    path: string;
    fetchedAt: string;
  }>;
}> {
  const sources = await readSourcesJson(cwd);
  
  const result: {
    packages: Record<Ecosystem, Array<{
      name: string;
      version: string;
      path: string;
      fetchedAt: string;
      ecosystem: Ecosystem;
    }>>;
    repos: Array<{
      name: string;
      version: string;
      path: string;
      fetchedAt: string;
    }>;
  } = {
    packages: {
      npm: [],
      pypi: [],
      crates: [],
    },
    repos: [],
  };

  if (!sources) {
    return result;
  }

  // Map packages with ecosystem
  if (sources.packages) {
    for (const ecosystem of ["npm", "pypi", "crates"] as Ecosystem[]) {
      if (sources.packages[ecosystem]) {
        result.packages[ecosystem] = sources.packages[ecosystem].map(p => ({
          ...p,
          ecosystem,
        }));
      }
    }
  }

  // Copy repos
  if (sources.repos) {
    result.repos = sources.repos;
  }

  return result;
}
