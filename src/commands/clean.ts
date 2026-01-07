import { rm } from "fs/promises";
import { existsSync } from "fs";
import { getPackagesDir, getReposDir, listSources } from "../lib/git.js";
import { updateAgentsMd } from "../lib/agents.js";
import type { Ecosystem } from "../types.js";

export interface CleanOptions {
  cwd?: string;
  /** Only clean packages (all ecosystems) */
  packages?: boolean;
  /** Only clean repos */
  repos?: boolean;
  /** Only clean specific ecosystem */
  ecosystem?: Ecosystem;
}

/**
 * Remove all fetched packages and/or repositories
 */
export async function cleanCommand(options: CleanOptions = {}): Promise<void> {
  const cwd = options.cwd || process.cwd();
  const cleanPackages =
    options.packages || (!options.packages && !options.repos);
  const cleanRepos =
    options.repos || (!options.packages && !options.repos && !options.ecosystem);

  let packagesRemoved = 0;
  let reposRemoved = 0;

  // Get current counts before cleaning
  const sources = await listSources(cwd);

  if (cleanPackages) {
    if (options.ecosystem) {
      // Clean specific ecosystem only
      const ecosystemDir = getPackagesDir(cwd, options.ecosystem);
      if (existsSync(ecosystemDir)) {
        packagesRemoved = sources.packages[options.ecosystem].length;
        await rm(ecosystemDir, { recursive: true, force: true });
        console.log(
          `✓ Removed ${packagesRemoved} ${options.ecosystem} package(s)`,
        );
      } else {
        console.log(`No ${options.ecosystem} packages to remove`);
      }
    } else {
      // Clean all ecosystems
      const ecosystems: Ecosystem[] = ["npm", "pypi", "crates"];
      for (const ecosystem of ecosystems) {
        const ecosystemDir = getPackagesDir(cwd, ecosystem);
        if (existsSync(ecosystemDir)) {
          const count = sources.packages[ecosystem].length;
          packagesRemoved += count;
          await rm(ecosystemDir, { recursive: true, force: true });
          if (count > 0) {
            console.log(`✓ Removed ${count} ${ecosystem} package(s)`);
          }
        }
      }

      if (packagesRemoved === 0) {
        console.log("No packages to remove");
      }
    }
  }

  if (cleanRepos) {
    const reposDir = getReposDir(cwd);
    if (existsSync(reposDir)) {
      reposRemoved = sources.repos.length;
      await rm(reposDir, { recursive: true, force: true });
      console.log(`✓ Removed ${reposRemoved} repo(s)`);
    } else {
      console.log("No repos to remove");
    }
  }

  const totalRemoved = packagesRemoved + reposRemoved;

  if (totalRemoved > 0) {
    // Update sources.json and AGENTS.md
    const remainingSources = await listSources(cwd);
    await updateAgentsMd(remainingSources, cwd);

    const totalRemaining =
      Object.values(remainingSources.packages).reduce(
        (sum, arr) => sum + arr.length,
        0,
      ) + remainingSources.repos.length;

    if (totalRemaining === 0) {
      console.log("✓ Updated sources.json");
    }
  }

  console.log(`\nCleaned ${totalRemoved} source(s)`);
}
