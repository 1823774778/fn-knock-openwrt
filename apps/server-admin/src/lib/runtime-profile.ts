import { existsSync, readFileSync } from "node:fs";

export type DeploymentTarget = "fpk" | "docker" | "dev";

export interface RuntimeProfile {
  deployment_target: DeploymentTarget;
  is_docker: boolean;
  is_linux: boolean;
  is_root_process: boolean;
}

export interface RuntimeCapabilities {
  direct_mode_available: boolean;
  host_firewall_available: boolean;
  smart_connect_available: boolean;
  system_clock_sync_available: boolean;
  self_update_available: boolean;
  terminal_available: boolean;
  shared_root_available: boolean;
}

export type RuntimeCapabilityKey = keyof RuntimeCapabilities;

let cachedRuntimeProfile: RuntimeProfile | null = null;

const normalizeDeploymentTarget = (
  value: string | undefined,
): DeploymentTarget | null => {
  const normalized = value?.trim().toLowerCase();
  if (normalized === "docker") return "docker";
  if (normalized === "fpk") return "fpk";
  if (normalized === "dev" || normalized === "development") return "dev";
  return null;
};

const detectDockerByCgroup = (): boolean => {
  try {
    const cgroup = readFileSync("/proc/1/cgroup", "utf-8");
    return /(docker|containerd|kubepods|podman)/i.test(cgroup);
  } catch {
    return false;
  }
};

const detectDeploymentTarget = (): DeploymentTarget => {
  const explicitTarget = normalizeDeploymentTarget(
    process.env.FN_KNOCK_RUNTIME_TARGET,
  );
  if (explicitTarget) {
    return explicitTarget;
  }

  if (existsSync("/.dockerenv") || detectDockerByCgroup()) {
    return "docker";
  }

  if (
    process.env.TRIM_APPDEST ||
    process.env.TRIM_PKGVAR ||
    process.env.TRIM_SERVICE_PORT
  ) {
    return "fpk";
  }

  return "dev";
};

const isRootProcess = (): boolean => {
  if (typeof process.getuid !== "function") {
    return false;
  }

  try {
    return process.getuid() === 0;
  } catch {
    return false;
  }
};

const hasSharedRoot = (): boolean => {
  const candidates = [
    process.env.FN_KNOCK_ROOT_SHARE_DIR,
    process.env.FN_KNOCK_CERT_SHARE_DIR,
  ]
    .map((value) => value?.trim() || "")
    .filter(Boolean);

  return candidates.some((candidate) => existsSync(candidate));
};

export const getRuntimeProfile = (): RuntimeProfile => {
  if (cachedRuntimeProfile) {
    return cachedRuntimeProfile;
  }

  const deploymentTarget = detectDeploymentTarget();
  cachedRuntimeProfile = {
    deployment_target: deploymentTarget,
    is_docker: deploymentTarget === "docker",
    is_linux: process.platform === "linux",
    is_root_process: isRootProcess(),
  };

  return cachedRuntimeProfile;
};

export const getRuntimeCapabilities = (
  profile: RuntimeProfile = getRuntimeProfile(),
): RuntimeCapabilities => {
  const hostRuntimeAvailable =
    profile.deployment_target !== "docker" &&
    profile.is_linux &&
    profile.is_root_process;

  return {
    direct_mode_available: hostRuntimeAvailable,
    host_firewall_available: hostRuntimeAvailable,
    smart_connect_available: hostRuntimeAvailable,
    system_clock_sync_available: hostRuntimeAvailable,
    self_update_available: profile.deployment_target === "fpk",
    terminal_available: profile.deployment_target !== "docker",
    shared_root_available: hasSharedRoot(),
  };
};

export const getCapabilityUnavailableMessage = (
  capability: RuntimeCapabilityKey,
  profile: RuntimeProfile = getRuntimeProfile(),
): string => {
  switch (capability) {
    case "direct_mode_available":
      if (profile.is_docker) {
        return "Docker 部署不支持宿主机直连防火墙模式";
      }
      if (!profile.is_linux) {
        return "当前运行环境不支持宿主机直连防火墙模式";
      }
      return "当前进程没有宿主机直连防火墙能力";
    case "host_firewall_available":
      if (profile.is_docker) {
        return "Docker 部署不支持宿主机防火墙管理";
      }
      if (!profile.is_linux) {
        return "当前运行环境不支持宿主机防火墙管理";
      }
      return "当前进程没有宿主机防火墙管理能力";
    case "smart_connect_available":
      if (profile.is_docker) {
        return "Docker 部署暂不支持 Smart Connect，它依赖宿主机 dnsmasq 与 53 端口";
      }
      if (!profile.is_linux) {
        return "当前运行环境暂不支持 Smart Connect";
      }
      return "当前进程没有 Smart Connect 所需的宿主机管理能力";
    case "system_clock_sync_available":
      if (profile.is_docker) {
        return "Docker 部署不支持宿主机系统时间同步";
      }
      if (!profile.is_linux) {
        return "当前运行环境不支持系统时间同步";
      }
      return "当前进程没有系统时间同步所需的宿主机权限";
    case "self_update_available":
      if (profile.is_docker) {
        return "Docker 部署不支持应用内 FPK 更新，请通过拉取新镜像升级";
      }
      return "当前部署形态不支持应用内更新";
    case "terminal_available":
      if (profile.is_docker) {
        return "Docker 部署不支持 Web 终端";
      }
      return "当前运行环境不支持 Web 终端";
    case "shared_root_available":
      return "当前运行环境没有可用的共享目录挂载";
    default:
      return "当前运行环境不支持该能力";
  }
};
