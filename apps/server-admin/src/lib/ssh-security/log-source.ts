import { existsSync, readFileSync, statSync, type Stats } from "node:fs";
import { spawn } from "node:child_process";
import { createInterface } from "node:readline";
import { gunzipSync } from "node:zlib";
import { promisify } from "node:util";
import { execFile as execFileCallback } from "node:child_process";
import { parseSSHLogMessage } from "./log-parser";
import type { SSHLogSourceKind, SSHLoginLogEntry } from "./types";

const execFile = promisify(execFileCallback);

const AUTH_LOG_CANDIDATES = [
  "/var/log/auth.log",
  "/var/log/auth.log.1",
  "/var/log/auth.log.1.gz",
];

const SYSLOG_MONTHS: Record<string, number> = {
  Jan: 0,
  Feb: 1,
  Mar: 2,
  Apr: 3,
  May: 4,
  Jun: 5,
  Jul: 6,
  Aug: 7,
  Sep: 8,
  Oct: 9,
  Nov: 10,
  Dec: 11,
};

export interface SSHLogFollowHandle {
  source: Exclude<SSHLogSourceKind, "unavailable">;
  stop: () => void;
}

const isSSHServiceMessage = (message: string): boolean =>
  /\bsshd(?:\[\d+\])?:\s+/i.test(message);

const parseSyslogLine = (
  line: string,
): { happenedAt: string; message: string } | null => {
  const match = line.match(
    /^([A-Z][a-z]{2})\s+(\d{1,2})\s+(\d{2}):(\d{2}):(\d{2})\s+\S+\s+(.*)$/,
  );
  if (!match) return null;

  const month = SYSLOG_MONTHS[match[1] ?? ""];
  if (month === undefined) return null;

  const now = new Date();
  const date = new Date(
    now.getFullYear(),
    month,
    Number.parseInt(match[2] ?? "1", 10),
    Number.parseInt(match[3] ?? "0", 10),
    Number.parseInt(match[4] ?? "0", 10),
    Number.parseInt(match[5] ?? "0", 10),
  );
  if (date.getTime() > now.getTime() + 24 * 3600 * 1000) {
    date.setFullYear(date.getFullYear() - 1);
  }

  return {
    happenedAt: date.toISOString(),
    message: match[6] ?? "",
  };
};

const journalTimestampToIso = (value: unknown): string => {
  const micros = Number.parseInt(String(value ?? ""), 10);
  if (Number.isFinite(micros) && micros > 0) {
    return new Date(Math.floor(micros / 1000)).toISOString();
  }
  return new Date().toISOString();
};

const parseJournalLine = (line: string): SSHLoginLogEntry | null => {
  try {
    const item = JSON.parse(line) as {
      MESSAGE?: unknown;
      __REALTIME_TIMESTAMP?: unknown;
    };
    const message = String(item.MESSAGE ?? "");
    if (!message) return null;
    return parseSSHLogMessage({
      message,
      happenedAt: journalTimestampToIso(item.__REALTIME_TIMESTAMP),
      source: "journal",
    });
  } catch {
    return null;
  }
};

const commandAvailable = async (command: string): Promise<boolean> => {
  try {
    await execFile(command, ["--version"], {
      timeout: 1500,
      windowsHide: true,
    });
    return true;
  } catch {
    return false;
  }
};

const readAuthLogFile = (path: string): string => {
  const buffer = readFileSync(path);
  if (path.endsWith(".gz")) {
    return gunzipSync(buffer).toString("utf-8");
  }
  return buffer.toString("utf-8");
};

const authLogStats = (path: string): Stats | null => {
  try {
    return statSync(path);
  } catch {
    return null;
  }
};

export class SSHLogSource {
  async detect(): Promise<SSHLogSourceKind> {
    if (await commandAvailable("journalctl")) {
      return "journal";
    }

    if (AUTH_LOG_CANDIDATES.some((path) => existsSync(path))) {
      return "auth.log";
    }

    return "unavailable";
  }

  async queryRecent(limit = 500): Promise<SSHLoginLogEntry[]> {
    if (await commandAvailable("journalctl")) {
      try {
        const { stdout } = await execFile(
          "journalctl",
          [
            "-u",
            "ssh.service",
            "-u",
            "sshd.service",
            "--output=json",
            "--reverse",
            "--no-pager",
            "-n",
            String(Math.max(limit, 100)),
          ],
          {
            timeout: 5000,
            maxBuffer: 10 * 1024 * 1024,
            windowsHide: true,
          },
        );
        return stdout
          .split(/\r?\n/)
          .map((line) => line.trim())
          .filter(Boolean)
          .map(parseJournalLine)
          .filter((entry): entry is SSHLoginLogEntry => entry !== null);
      } catch (error) {
        console.warn("[ssh-security] journalctl query failed:", error);
      }
    }

    return this.queryAuthLog(limit);
  }

  queryAuthLog(limit = 500): SSHLoginLogEntry[] {
    const files = AUTH_LOG_CANDIDATES.filter((path) => existsSync(path)).sort(
      (left, right) =>
        (authLogStats(right)?.mtimeMs ?? 0) -
        (authLogStats(left)?.mtimeMs ?? 0),
    );
    const entries: SSHLoginLogEntry[] = [];

    for (const file of files) {
      let content = "";
      try {
        content = readAuthLogFile(file);
      } catch (error) {
        console.warn(`[ssh-security] failed to read ${file}:`, error);
        continue;
      }

      const lines = content.split(/\r?\n/).reverse();
      for (const line of lines) {
        if (!isSSHServiceMessage(line)) continue;
        const parsed = parseSyslogLine(line);
        if (!parsed) continue;
        const entry = parseSSHLogMessage({
          message: parsed.message,
          happenedAt: parsed.happenedAt,
          source: "auth.log",
        });
        if (!entry) continue;
        entries.push(entry);
        if (entries.length >= limit) return entries;
      }
    }

    return entries;
  }

  async follow(
    onEntry: (entry: SSHLoginLogEntry) => void | Promise<void>,
  ): Promise<SSHLogFollowHandle | null> {
    if (await commandAvailable("journalctl")) {
      const child = spawn(
        "journalctl",
        [
          "-u",
          "ssh.service",
          "-u",
          "sshd.service",
          "--output=json",
          "--follow",
          "--since=now",
        ],
        {
          stdio: ["ignore", "pipe", "pipe"],
        },
      );
      const reader = createInterface({ input: child.stdout });
      reader.on("line", (line) => {
        const entry = parseJournalLine(line);
        if (!entry) return;
        void onEntry(entry);
      });
      child.stderr?.on("data", (chunk) => {
        const text = String(chunk || "").trim();
        if (text) console.warn("[ssh-security] journalctl:", text);
      });
      return {
        source: "journal",
        stop: () => {
          reader.close();
          child.kill("SIGTERM");
        },
      };
    }

    if (!existsSync("/var/log/auth.log")) {
      return null;
    }

    const child = spawn("tail", ["-F", "/var/log/auth.log"], {
      stdio: ["ignore", "pipe", "pipe"],
    });
    const reader = createInterface({ input: child.stdout });
    reader.on("line", (line) => {
      if (!isSSHServiceMessage(line)) return;
      const parsed = parseSyslogLine(line);
      if (!parsed) return;
      const entry = parseSSHLogMessage({
        message: parsed.message,
        happenedAt: parsed.happenedAt,
        source: "auth.log",
      });
      if (!entry) return;
      void onEntry(entry);
    });
    child.stderr?.on("data", (chunk) => {
      const text = String(chunk || "").trim();
      if (text) console.warn("[ssh-security] tail:", text);
    });

    return {
      source: "auth.log",
      stop: () => {
        reader.close();
        child.kill("SIGTERM");
      },
    };
  }
}

export const sshLogSource = new SSHLogSource();
