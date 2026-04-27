import { readFile, readdir } from "node:fs/promises";
import { basename, dirname, isAbsolute, join, resolve } from "node:path";

export interface SSHPortResolution {
  ports: number[];
  source: "sshd_config" | "default";
  files: string[];
}

export const DEFAULT_SSH_PORTS = [22];

const DEFAULT_SSHD_CONFIG_PATH =
  process.env.SSHD_CONFIG_PATH?.trim() || "/etc/ssh/sshd_config";
const CACHE_TTL_MS = 30_000;

const normalizePort = (value: unknown): number | null => {
  const port = Number.parseInt(String(value ?? ""), 10);
  if (!Number.isInteger(port) || port <= 0 || port > 65535) return null;
  return port;
};

const normalizePorts = (ports: Iterable<unknown>): number[] => {
  const normalized = [...new Set([...ports].map(normalizePort).filter(Boolean))]
    .filter((port): port is number => typeof port === "number")
    .sort((left, right) => left - right);
  return normalized.length > 0 ? normalized : [...DEFAULT_SSH_PORTS];
};

const stripInlineComment = (line: string): string => {
  let quote: "'" | '"' | null = null;
  for (let index = 0; index < line.length; index += 1) {
    const char = line[index];
    if ((char === "'" || char === '"') && line[index - 1] !== "\\") {
      quote = quote === char ? null : quote || char;
      continue;
    }
    if (char === "#" && !quote) {
      return line.slice(0, index).trim();
    }
  }
  return line.trim();
};

const tokenizeConfigLine = (line: string): string[] => {
  const clean = stripInlineComment(line);
  if (!clean) return [];
  return (
    clean.match(/(?:[^\s"']+|"[^"]*"|'[^']*')+/g)?.map((token) => {
      if (
        (token.startsWith('"') && token.endsWith('"')) ||
        (token.startsWith("'") && token.endsWith("'"))
      ) {
        return token.slice(1, -1);
      }
      return token;
    }) ?? []
  );
};

const wildcardToRegExp = (pattern: string): RegExp => {
  const escaped = pattern
    .replace(/[.+^${}()|[\]\\]/g, "\\$&")
    .replace(/\*/g, ".*")
    .replace(/\?/g, ".");
  return new RegExp(`^${escaped}$`);
};

const hasWildcard = (value: string): boolean => /[*?]/.test(value);

const expandIncludePattern = async (
  pattern: string,
  baseDir: string,
): Promise<string[]> => {
  const resolvedPattern = isAbsolute(pattern)
    ? pattern
    : resolve(baseDir, pattern);

  if (!hasWildcard(resolvedPattern)) {
    try {
      await readFile(resolvedPattern, "utf8");
      return [resolvedPattern];
    } catch {
      return [];
    }
  }

  const directory = dirname(resolvedPattern);
  if (hasWildcard(directory)) return [];

  const namePattern = basename(resolvedPattern);
  const matcher = wildcardToRegExp(namePattern);
  try {
    const entries = await readdir(directory, { withFileTypes: true });
    return entries
      .filter((entry) => entry.isFile() && matcher.test(entry.name))
      .map((entry) => join(directory, entry.name))
      .sort((left, right) => left.localeCompare(right));
  } catch {
    return [];
  }
};

export class SSHPortResolver {
  private cache: { expiresAt: number; result: SSHPortResolution } | null = null;

  async resolve(
    options: { refresh?: boolean } = {},
  ): Promise<SSHPortResolution> {
    if (!options.refresh && this.cache && this.cache.expiresAt > Date.now()) {
      return this.cache.result;
    }

    const visited = new Set<string>();
    const files = new Set<string>();
    const ports = new Set<number>();
    await this.collectPortsFromFile(
      DEFAULT_SSHD_CONFIG_PATH,
      visited,
      files,
      ports,
    );

    const result: SSHPortResolution = {
      ports: normalizePorts(ports),
      source: ports.size > 0 ? "sshd_config" : "default",
      files: [...files],
    };
    this.cache = {
      expiresAt: Date.now() + CACHE_TTL_MS,
      result,
    };
    return result;
  }

  private async collectPortsFromFile(
    filePath: string,
    visited: Set<string>,
    files: Set<string>,
    ports: Set<number>,
  ): Promise<void> {
    const normalizedPath = resolve(filePath);
    if (visited.has(normalizedPath)) return;
    visited.add(normalizedPath);

    let content = "";
    try {
      content = await readFile(normalizedPath, "utf8");
      files.add(normalizedPath);
    } catch {
      return;
    }

    const baseDir = dirname(normalizedPath);
    for (const line of content.split(/\r?\n/)) {
      const tokens = tokenizeConfigLine(line);
      const directive = tokens[0]?.toLowerCase();
      if (!directive) continue;
      if (directive === "match") break;

      if (directive === "include") {
        for (const pattern of tokens.slice(1)) {
          const includedFiles = await expandIncludePattern(pattern, baseDir);
          for (const includedFile of includedFiles) {
            await this.collectPortsFromFile(
              includedFile,
              visited,
              files,
              ports,
            );
          }
        }
        continue;
      }

      if (directive === "port") {
        const port = normalizePort(tokens[1]);
        if (port) ports.add(port);
      }
    }
  }
}

export const sshPortResolver = new SSHPortResolver();
