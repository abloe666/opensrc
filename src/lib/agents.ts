import { readFile, writeFile } from "fs/promises";
import { join } from "path";
import { existsSync } from "fs";
import type { Ecosystem } from "../types.js";

const AGENTS_FILE = "AGENTS.md";
const OPENSRC_DIR = "opensrc";
const SOURCES_FILE = "sources.json";
const SECTION_START = "## Source Code Reference";
const SECTION_MARKER = "<!-- opensrc:start -->";
const SECTION_END_MARKER = "<!-- opensrc:end -->";

/**
 * The static AGENTS.md section that points to the index file
 */
const STATIC_SECTION = `
${SECTION_MARKER}

${SECTION_START}

Source code for dependencies is available in \`opensrc/\` for deeper understanding of implementation details.

See \`opensrc/sources.json\` for the list of available packages and their versions.

Use this source code when you need to understand how a package works internally, not just its types/interface.

### Fetching Additional Source Code

To fetch source code for a package or repository you need to understand, run:

\`\`\`bash
opensrc <package>           # npm package (e.g., opensrc zod)
opensrc pypi:<package>      # Python package (e.g., opensrc pypi:requests)
opensrc crates:<package>    # Rust crate (e.g., opensrc crates:serde)
opensrc <owner>/<repo>      # GitHub repo (e.g., opensrc vercel/ai)
\`\`\`

${SECTION_END_MARKER}
`;

export interface SourceEntry {
  name: string;
  version: string;
  path: string;
  fetchedAt: string;
  ecosystem?: Ecosystem;
}

export interface SourcesIndex {
  repos: SourceEntry[];
  packages: Record<Ecosystem, SourceEntry[]>;
  updatedAt: string;
}

/**
 * Update the sources.json file in opensrc/
 */
export async function updatePackageIndex(
  sources: {
    packages: Record<Ecosystem, SourceEntry[]>;
    repos: SourceEntry[];
  },
  cwd: string = process.cwd(),
): Promise<void> {
  const opensrcDir = join(cwd, OPENSRC_DIR);
  const sourcesPath = join(opensrcDir, SOURCES_FILE);

  const totalPackages = Object.values(sources.packages).reduce(
    (sum, arr) => sum + arr.length,
    0,
  );

  if (totalPackages === 0 && sources.repos.length === 0) {
    // Remove index file if no sources
    if (existsSync(sourcesPath)) {
      const { rm } = await import("fs/promises");
      await rm(sourcesPath, { force: true });
    }
    return;
  }

  const index: SourcesIndex = {
    repos: sources.repos.map((r) => ({
      name: r.name,
      version: r.version,
      path: r.path,
      fetchedAt: r.fetchedAt,
    })),
    packages: {
      npm: sources.packages.npm.map((p) => ({
        name: p.name,
        version: p.version,
        path: p.path,
        fetchedAt: p.fetchedAt,
      })),
      pypi: sources.packages.pypi.map((p) => ({
        name: p.name,
        version: p.version,
        path: p.path,
        fetchedAt: p.fetchedAt,
      })),
      crates: sources.packages.crates.map((p) => ({
        name: p.name,
        version: p.version,
        path: p.path,
        fetchedAt: p.fetchedAt,
      })),
    },
    updatedAt: new Date().toISOString(),
  };

  // Remove empty ecosystem arrays from output for cleaner JSON
  const cleanIndex: Record<string, unknown> = {
    repos: index.repos,
    packages: {} as Record<string, SourceEntry[]>,
    updatedAt: index.updatedAt,
  };

  for (const [eco, packages] of Object.entries(index.packages)) {
    if (packages.length > 0) {
      (cleanIndex.packages as Record<string, SourceEntry[]>)[eco] = packages;
    }
  }

  // If no packages at all, remove the packages key
  if (Object.keys(cleanIndex.packages as object).length === 0) {
    delete cleanIndex.packages;
  }

  // If no repos, remove the repos key
  if ((cleanIndex.repos as SourceEntry[]).length === 0) {
    delete cleanIndex.repos;
  }

  await writeFile(sourcesPath, JSON.stringify(cleanIndex, null, 2), "utf-8");
}

/**
 * Check if AGENTS.md has an opensrc section
 */
export async function hasOpensrcSection(
  cwd: string = process.cwd(),
): Promise<boolean> {
  const agentsPath = join(cwd, AGENTS_FILE);

  if (!existsSync(agentsPath)) {
    return false;
  }

  try {
    const content = await readFile(agentsPath, "utf-8");
    return content.includes(SECTION_MARKER);
  } catch {
    return false;
  }
}

/**
 * Ensure AGENTS.md has the static opensrc section
 */
export async function ensureAgentsMd(
  cwd: string = process.cwd(),
): Promise<boolean> {
  const agentsPath = join(cwd, AGENTS_FILE);

  // Already has section
  if (await hasOpensrcSection(cwd)) {
    return false;
  }

  let content = "";

  if (existsSync(agentsPath)) {
    content = await readFile(agentsPath, "utf-8");
    // Ensure there's a newline at the end before we append
    if (content.length > 0 && !content.endsWith("\n")) {
      content += "\n";
    }
  } else {
    // Create new file
    content = `# AGENTS.md

Instructions for AI coding agents working with this codebase.
`;
  }

  content += STATIC_SECTION;

  await writeFile(agentsPath, content, "utf-8");
  return true;
}

/**
 * Update AGENTS.md and the package index
 */
export async function updateAgentsMd(
  sources: {
    packages: Record<Ecosystem, SourceEntry[]>;
    repos: SourceEntry[];
  },
  cwd: string = process.cwd(),
): Promise<boolean> {
  // Always update the index file
  await updatePackageIndex(sources, cwd);

  // Only add section to AGENTS.md if there are sources and section doesn't exist
  const totalPackages = Object.values(sources.packages).reduce(
    (sum, arr) => sum + arr.length,
    0,
  );

  if (totalPackages > 0 || sources.repos.length > 0) {
    return ensureAgentsMd(cwd);
  }

  return false;
}

/**
 * Remove the opensrc section from AGENTS.md
 */
export async function removeOpensrcSection(
  cwd: string = process.cwd(),
): Promise<boolean> {
  const agentsPath = join(cwd, AGENTS_FILE);

  if (!existsSync(agentsPath)) {
    return false;
  }

  try {
    const content = await readFile(agentsPath, "utf-8");

    if (!content.includes(SECTION_MARKER)) {
      return false;
    }

    const startIdx = content.indexOf(SECTION_MARKER);
    const endIdx = content.indexOf(SECTION_END_MARKER);

    if (startIdx === -1 || endIdx === -1) {
      return false;
    }

    const before = content.slice(0, startIdx).trimEnd();
    const after = content.slice(endIdx + SECTION_END_MARKER.length).trimStart();

    let newContent = before;
    if (after) {
      newContent += "\n\n" + after;
    }

    // Clean up multiple consecutive newlines
    newContent = newContent.replace(/\n{3,}/g, "\n\n").trim() + "\n";

    await writeFile(agentsPath, newContent, "utf-8");
    return true;
  } catch {
    return false;
  }
}

// Legacy interface for backwards compatibility
export interface PackageIndex {
  packages: SourceEntry[];
  updatedAt: string;
}
