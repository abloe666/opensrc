import { listSources } from "../lib/git.js";
import type { Ecosystem } from "../types.js";

export interface ListOptions {
  cwd?: string;
  json?: boolean;
}

const ECOSYSTEM_LABELS: Record<Ecosystem, string> = {
  npm: "npm",
  pypi: "PyPI",
  crates: "crates.io",
};

/**
 * List all fetched package sources
 */
export async function listCommand(options: ListOptions = {}): Promise<void> {
  const cwd = options.cwd || process.cwd();
  const sources = await listSources(cwd);

  const totalPackages = Object.values(sources.packages).reduce(
    (sum, arr) => sum + arr.length,
    0,
  );
  const totalCount = totalPackages + sources.repos.length;

  if (totalCount === 0) {
    console.log("No sources fetched yet.");
    console.log(
      "\nUse `opensrc <package>` to fetch source code for a package.",
    );
    console.log("Use `opensrc <owner>/<repo>` to fetch a GitHub repository.");
    console.log("\nSupported ecosystems:");
    console.log("  • npm:      opensrc zod, opensrc npm:react");
    console.log("  • PyPI:     opensrc pypi:requests");
    console.log("  • crates:   opensrc crates:serde");
    return;
  }

  if (options.json) {
    console.log(JSON.stringify(sources, null, 2));
    return;
  }

  // Display packages by ecosystem
  const ecosystems: Ecosystem[] = ["npm", "pypi", "crates"];
  let hasDisplayedPackages = false;

  for (const ecosystem of ecosystems) {
    const packages = sources.packages[ecosystem];
    if (packages.length === 0) continue;

    if (hasDisplayedPackages) {
      console.log(""); // Add spacing between ecosystems
    }

    console.log(`${ECOSYSTEM_LABELS[ecosystem]} Packages:\n`);
    hasDisplayedPackages = true;

    for (const source of packages) {
      const date = new Date(source.fetchedAt);
      const formattedDate = date.toLocaleDateString("en-US", {
        year: "numeric",
        month: "short",
        day: "numeric",
      });

      console.log(`  ${source.name}@${source.version}`);
      console.log(`    Path: opensrc/${source.path}`);
      console.log(`    Fetched: ${formattedDate}`);
      console.log("");
    }
  }

  // Display repos
  if (sources.repos.length > 0) {
    if (hasDisplayedPackages) {
      console.log(""); // Add spacing between sections
    }
    console.log("Repositories:\n");

    for (const source of sources.repos) {
      const date = new Date(source.fetchedAt);
      const formattedDate = date.toLocaleDateString("en-US", {
        year: "numeric",
        month: "short",
        day: "numeric",
      });

      console.log(`  ${source.name}@${source.version}`);
      console.log(`    Path: opensrc/${source.path}`);
      console.log(`    Fetched: ${formattedDate}`);
      console.log("");
    }
  }

  // Summary by ecosystem
  const packageCounts = ecosystems
    .map((eco) => {
      const count = sources.packages[eco].length;
      return count > 0 ? `${count} ${ECOSYSTEM_LABELS[eco]}` : null;
    })
    .filter(Boolean)
    .join(", ");

  const summary = [
    packageCounts ? `${totalPackages} package(s) (${packageCounts})` : null,
    sources.repos.length > 0 ? `${sources.repos.length} repo(s)` : null,
  ]
    .filter(Boolean)
    .join(", ");

  console.log(`Total: ${summary}`);
}
