import {
  removePackageSource,
  removeRepoSource,
  packageExists,
  repoExists,
  listSources,
} from "../lib/git.js";
import { updateAgentsMd } from "../lib/agents.js";
import { isRepoSpec } from "../lib/repo.js";
import { detectEcosystem } from "../lib/registries/index.js";
import type { Ecosystem } from "../types.js";

export interface RemoveOptions {
  cwd?: string;
}

/**
 * Remove source code for one or more packages or repositories
 */
export async function removeCommand(
  items: string[],
  options: RemoveOptions = {},
): Promise<void> {
  const cwd = options.cwd || process.cwd();
  let removed = 0;
  let notFound = 0;

  for (const item of items) {
    // Check if it's a repo or package based on format
    const isRepo = isRepoSpec(item) || item.includes("/");

    if (isRepo && !item.includes(":")) {
      // Try to remove as repo first (unless it has an ecosystem prefix)
      // Convert formats like "vercel/vercel" to "github.com/vercel/vercel" if needed
      let displayName = item;
      if (item.split("/").length === 2 && !item.startsWith("http")) {
        displayName = `github.com/${item}`;
      }

      if (!repoExists(displayName, cwd)) {
        // Try the item as-is (might already be full path like github.com/owner/repo)
        if (repoExists(item, cwd)) {
          displayName = item;
        } else {
          // Maybe it's a package with a / in the name (scoped)?
          // Check all ecosystems
          let found = false;
          const ecosystems: Ecosystem[] = ["npm", "pypi", "crates"];
          for (const ecosystem of ecosystems) {
            if (packageExists(item, cwd, ecosystem)) {
              const success = await removePackageSource(item, cwd, ecosystem);
              if (success) {
                console.log(`  ✓ Removed ${item} (${ecosystem})`);
                removed++;
                found = true;
                break;
              }
            }
          }

          if (!found) {
            console.log(`  ⚠ ${item} not found`);
            notFound++;
          }
          continue;
        }
      }

      const success = await removeRepoSource(displayName, cwd);

      if (success) {
        console.log(`  ✓ Removed ${displayName}`);
        removed++;
      } else {
        console.log(`  ✗ Failed to remove ${displayName}`);
      }
    } else {
      // Remove as package - detect ecosystem from prefix or default to npm
      const { ecosystem, cleanSpec } = detectEcosystem(item);

      if (!packageExists(cleanSpec, cwd, ecosystem)) {
        // Try other ecosystems if default didn't work
        let found = false;
        const ecosystems: Ecosystem[] = ["npm", "pypi", "crates"];
        for (const eco of ecosystems) {
          if (eco !== ecosystem && packageExists(cleanSpec, cwd, eco)) {
            const success = await removePackageSource(cleanSpec, cwd, eco);
            if (success) {
              console.log(`  ✓ Removed ${cleanSpec} (${eco})`);
              removed++;
              found = true;
              break;
            }
          }
        }

        if (!found) {
          console.log(`  ⚠ ${cleanSpec} not found`);
          notFound++;
        }
        continue;
      }

      const success = await removePackageSource(cleanSpec, cwd, ecosystem);

      if (success) {
        console.log(`  ✓ Removed ${cleanSpec} (${ecosystem})`);
        removed++;
      } else {
        console.log(`  ✗ Failed to remove ${cleanSpec}`);
      }
    }
  }

  console.log(
    `\nRemoved ${removed} source(s)${notFound > 0 ? `, ${notFound} not found` : ""}`,
  );

  // Update AGENTS.md with remaining sources (or remove section if empty)
  if (removed > 0) {
    const remainingSources = await listSources(cwd);
    const agentsUpdated = await updateAgentsMd(remainingSources, cwd);
    if (agentsUpdated) {
      const totalRemaining =
        Object.values(remainingSources.packages).reduce(
          (sum, arr) => sum + arr.length,
          0,
        ) + remainingSources.repos.length;
      if (totalRemaining === 0) {
        console.log("✓ Removed opensrc section from AGENTS.md");
      } else {
        console.log("✓ Updated AGENTS.md");
      }
    }
  }
}
