import { existsSync } from "node:fs";
import {
  copyFile,
  mkdir,
  readdir,
  readFile,
  rename,
  stat,
} from "node:fs/promises";
import { homedir } from "node:os";
import {
  basename,
  dirname,
  isAbsolute,
  join,
  relative,
  resolve,
} from "node:path";

import type {
  AgentConfigFile,
  AgentConfigUpdateResult,
  AgentHarnessConfig,
  AgentHarnessConfigId,
  AgentHarnessesSnapshot,
  AgentSkillCopyResult,
  AgentSkillEntry,
} from "../../shared/rpc-types";

interface ConfigFileDescriptor {
  id: string;
  label: string;
  relativePath: string;
}

interface HarnessDescriptor {
  id: AgentHarnessConfigId;
  label: string;
  rootPath: string;
  configFiles: ConfigFileDescriptor[];
  skillPath: string;
  skillSearchRoots: string[];
}

const MAX_CONFIG_BYTES = 256 * 1024;
const MAX_SKILL_SEARCH_DEPTH = 5;

const homePath = homedir();

const HARNESSES: HarnessDescriptor[] = [
  {
    id: "claude-code",
    label: "Claude Code",
    rootPath: join(homePath, ".claude"),
    configFiles: [
      {
        id: "claude-settings",
        label: "Settings",
        relativePath: "settings.json",
      },
      { id: "claude-memory", label: "Memory", relativePath: "CLAUDE.md" },
    ],
    skillPath: join(homePath, ".claude", "skills"),
    skillSearchRoots: [
      join(homePath, ".claude", "skills"),
      join(homePath, ".claude", "plugins"),
    ],
  },
  {
    id: "codex",
    label: "Codex",
    rootPath: join(homePath, ".codex"),
    configFiles: [
      { id: "codex-config", label: "Config", relativePath: "config.toml" },
      { id: "codex-agents", label: "Agent Guide", relativePath: "AGENTS.md" },
    ],
    skillPath: join(homePath, ".codex", "skills"),
    skillSearchRoots: [
      join(homePath, ".codex", "skills"),
      join(homePath, ".codex", "plugins"),
    ],
  },
  {
    id: "opencode",
    label: "OpenCode",
    rootPath: join(homePath, ".config", "opencode"),
    configFiles: [
      { id: "opencode-json", label: "Config", relativePath: "opencode.json" },
      {
        id: "opencode-config",
        label: "Alt Config",
        relativePath: "config.json",
      },
      {
        id: "opencode-agents",
        label: "Agent Guide",
        relativePath: "AGENTS.md",
      },
    ],
    skillPath: join(homePath, ".config", "opencode", "skills"),
    skillSearchRoots: [join(homePath, ".config", "opencode", "skills")],
  },
  {
    id: "pi",
    label: "Pi",
    rootPath: join(homePath, ".pi", "agent"),
    configFiles: [
      { id: "pi-settings", label: "Settings", relativePath: "settings.json" },
    ],
    skillPath: join(homePath, ".pi", "skills"),
    skillSearchRoots: [join(homePath, ".pi", "skills")],
  },
];

const descriptorById = new Map(
  HARNESSES.map((harness) => [harness.id, harness])
);

const isInsideHome = (path: string): boolean => {
  const resolvedPath = resolve(path);
  const resolvedHome = resolve(homePath);
  const pathFromHome = relative(resolvedHome, resolvedPath);
  return (
    pathFromHome === "" ||
    (!pathFromHome.startsWith("..") && !isAbsolute(pathFromHome))
  );
};

const getDescriptor = (harnessId: AgentHarnessConfigId): HarnessDescriptor => {
  const descriptor = descriptorById.get(harnessId);
  if (!descriptor) {
    throw new Error(`Unknown harness: ${harnessId}`);
  }
  return descriptor;
};

const getAllowedConfigPaths = (descriptor: HarnessDescriptor): Set<string> =>
  new Set(
    descriptor.configFiles.map((file) =>
      resolve(descriptor.rootPath, file.relativePath)
    )
  );

const readConfigFile = async (
  descriptor: HarnessDescriptor,
  file: ConfigFileDescriptor
): Promise<AgentConfigFile> => {
  const path = resolve(descriptor.rootPath, file.relativePath);

  if (!isInsideHome(path)) {
    return {
      id: file.id,
      label: file.label,
      path,
      relativePath: file.relativePath,
      exists: false,
      sizeBytes: null,
      updatedAt: null,
      content: "",
      readOnly: true,
      error: "Path is outside the user home directory.",
    };
  }

  try {
    const fileStat = await stat(path);
    if (fileStat.size > MAX_CONFIG_BYTES) {
      return {
        id: file.id,
        label: file.label,
        path,
        relativePath: file.relativePath,
        exists: true,
        sizeBytes: fileStat.size,
        updatedAt: fileStat.mtimeMs,
        content: "",
        readOnly: true,
        error: "File is too large to edit in Daedux.",
      };
    }

    return {
      id: file.id,
      label: file.label,
      path,
      relativePath: file.relativePath,
      exists: true,
      sizeBytes: fileStat.size,
      updatedAt: fileStat.mtimeMs,
      content: await readFile(path, "utf8"),
      readOnly: false,
    };
  } catch (error) {
    if (error instanceof Error && "code" in error && error.code === "ENOENT") {
      return {
        id: file.id,
        label: file.label,
        path,
        relativePath: file.relativePath,
        exists: false,
        sizeBytes: null,
        updatedAt: null,
        content: "",
        readOnly: false,
      };
    }

    return {
      id: file.id,
      label: file.label,
      path,
      relativePath: file.relativePath,
      exists: false,
      sizeBytes: null,
      updatedAt: null,
      content: "",
      readOnly: true,
      error: error instanceof Error ? error.message : String(error),
    };
  }
};

const parseSkillMetadata = async (
  skillPath: string
): Promise<{ displayName: string; description: string | null }> => {
  const fallbackName = basename(skillPath);

  try {
    const skillMd = await readFile(join(skillPath, "SKILL.md"), "utf8");
    const frontmatterMatch = /^---\n([\s\S]*?)\n---/.exec(skillMd);
    const frontmatter = frontmatterMatch?.[1];
    if (frontmatter === undefined || frontmatter.length === 0) {
      return { displayName: fallbackName, description: null };
    }

    const fields = new Map<string, string>();
    for (const line of frontmatter.split("\n")) {
      const separatorIndex = line.indexOf(":");
      if (separatorIndex === -1) {
        continue;
      }

      const key = line.slice(0, separatorIndex).trim();
      const value = line
        .slice(separatorIndex + 1)
        .trim()
        .replaceAll(/^"|"$/g, "");
      fields.set(key, value);
    }

    return {
      displayName: fields.get("name") ?? fallbackName,
      description: fields.get("description") ?? null,
    };
  } catch {
    return { displayName: fallbackName, description: null };
  }
};

const findSkillsInRoot = async (
  sourceRoot: string,
  currentPath: string,
  depth: number
): Promise<AgentSkillEntry[]> => {
  if (depth < 0 || !existsSync(currentPath)) {
    return [];
  }

  let entries;
  try {
    entries = await readdir(currentPath, { withFileTypes: true });
  } catch {
    return [];
  }

  if (entries.some((entry) => entry.isFile() && entry.name === "SKILL.md")) {
    const skillStat = await stat(currentPath).catch(() => null);
    const metadata = await parseSkillMetadata(currentPath);
    return [
      {
        name: basename(currentPath),
        displayName: metadata.displayName,
        description: metadata.description,
        path: currentPath,
        sourceRoot,
        updatedAt: skillStat?.mtimeMs ?? null,
      },
    ];
  }

  const nestedSkills = await Promise.all(
    entries
      .filter((entry) => entry.isDirectory())
      .filter((entry) => entry.name !== "node_modules" && entry.name !== ".git")
      .map(async (entry) =>
        findSkillsInRoot(sourceRoot, join(currentPath, entry.name), depth - 1)
      )
  );

  return nestedSkills.flat();
};

const listSkills = async (
  descriptor: HarnessDescriptor
): Promise<AgentSkillEntry[]> => {
  const skillGroups = await Promise.all(
    descriptor.skillSearchRoots
      .filter((root) => isInsideHome(root))
      .map(async (root) => findSkillsInRoot(root, root, MAX_SKILL_SEARCH_DEPTH))
  );
  const skills = skillGroups.flat();
  return skills.toSorted((a, b) =>
    a.displayName.localeCompare(b.displayName, undefined, {
      sensitivity: "base",
    })
  );
};

const buildHarnessSnapshot = async (
  descriptor: HarnessDescriptor
): Promise<AgentHarnessConfig> => {
  const [configFiles, skills] = await Promise.all([
    Promise.all(
      descriptor.configFiles.map(async (file) =>
        readConfigFile(descriptor, file)
      )
    ),
    listSkills(descriptor),
  ]);

  return {
    id: descriptor.id,
    label: descriptor.label,
    rootPath: descriptor.rootPath,
    exists: existsSync(descriptor.rootPath),
    configFiles,
    skillPath: descriptor.skillPath,
    skillPathExists: existsSync(descriptor.skillPath),
    skills,
  };
};

export const getAgentHarnessesSnapshot =
  async (): Promise<AgentHarnessesSnapshot> => ({
    homePath,
    harnesses: await Promise.all(HARNESSES.map(buildHarnessSnapshot)),
  });

export const updateAgentConfigFile = async ({
  harnessId,
  path,
  content,
}: {
  harnessId: AgentHarnessConfigId;
  path: string;
  content: string;
}): Promise<AgentConfigUpdateResult> => {
  const descriptor = getDescriptor(harnessId);
  const resolvedPath = resolve(path);
  const allowedConfigPaths = getAllowedConfigPaths(descriptor);

  if (!isInsideHome(resolvedPath) || !allowedConfigPaths.has(resolvedPath)) {
    throw new Error(
      "Daedux can only edit known config files for this harness."
    );
  }

  await mkdir(dirname(resolvedPath), { recursive: true });
  const tempPath = `${resolvedPath}.daedux-${Date.now()}.tmp`;
  await Bun.write(tempPath, content);
  await rename(tempPath, resolvedPath);

  return {
    success: true,
    path: resolvedPath,
    updatedAt: Date.now(),
  };
};

const copyDirectory = async (sourcePath: string, targetPath: string) => {
  await mkdir(targetPath, { recursive: true });
  const entries = await readdir(sourcePath, { withFileTypes: true });

  await Promise.all(
    entries.map(async (entry) => {
      const sourceEntryPath = join(sourcePath, entry.name);
      const targetEntryPath = join(targetPath, entry.name);

      if (entry.isDirectory()) {
        await copyDirectory(sourceEntryPath, targetEntryPath);
        return;
      }

      if (entry.isFile()) {
        await copyFile(sourceEntryPath, targetEntryPath);
      }
    })
  );
};

export const copyAgentSkill = async ({
  sourcePath,
  targetHarnessId,
  overwrite = false,
}: {
  sourcePath: string;
  targetHarnessId: AgentHarnessConfigId;
  overwrite?: boolean;
}): Promise<AgentSkillCopyResult> => {
  const targetDescriptor = getDescriptor(targetHarnessId);
  const snapshot = await getAgentHarnessesSnapshot();
  const allKnownSkills = new Map(
    snapshot.harnesses.flatMap((harness) =>
      harness.skills.map((skill) => [resolve(skill.path), skill])
    )
  );
  const sourceSkill = allKnownSkills.get(resolve(sourcePath));

  if (!sourceSkill) {
    throw new Error("Source skill is not part of a known harness skill path.");
  }

  if (!existsSync(join(sourceSkill.path, "SKILL.md"))) {
    throw new Error("Source skill must contain a SKILL.md file.");
  }

  if (!isInsideHome(targetDescriptor.skillPath)) {
    throw new Error("Target skill path is outside the user home directory.");
  }

  const targetPath = join(targetDescriptor.skillPath, sourceSkill.name);
  if (existsSync(targetPath) && !overwrite) {
    return {
      status: "conflict",
      skillName: sourceSkill.displayName,
      sourcePath: sourceSkill.path,
      targetPath,
      message:
        "A skill with this folder name already exists in the target harness.",
    };
  }

  if (existsSync(targetPath) && overwrite) {
    throw new Error("Replacing existing skills is not available in this MVP.");
  }

  await copyDirectory(sourceSkill.path, targetPath);

  return {
    status: "copied",
    skillName: sourceSkill.displayName,
    sourcePath: sourceSkill.path,
    targetPath,
    message: `${sourceSkill.displayName} was copied to ${targetDescriptor.label}.`,
  };
};
