import { normalizeIp } from "../ip-normalize";
import type { SystemEventType } from "./constants";

export type SystemEventIpFieldDescriptor = {
  ipKey: string;
  locationKey: string;
};

export type SystemEventResolvedIpField = SystemEventIpFieldDescriptor & {
  rawIp: string;
  normalizedIp: string;
};

const DEFAULT_IP_FIELD: SystemEventIpFieldDescriptor = {
  ipKey: "ip",
  locationKey: "ip_location",
};

const getEventIpFieldDescriptors = (
  type: SystemEventType,
): SystemEventIpFieldDescriptor[] => {
  switch (type) {
    case "FN_EVENT_AUTH_SESSION_IP_DRIFT":
      return [
        {
          ipKey: "from_ip",
          locationKey: "from_ip_location",
        },
        {
          ipKey: "to_ip",
          locationKey: "to_ip_location",
        },
      ];
    case "FN_EVENT_AUTH_LOGIN_SUCCESS":
    case "FN_EVENT_AUTH_LOGOUT":
    case "FN_EVENT_AUTH_LOGIN_FAILURE":
    case "FN_EVENT_SECURITY_SCANNER_BLOCKED":
    case "FN_EVENT_GATEWAY_THROTTLE_BLOCKED":
    case "FN_EVENT_WAF_BLOCKED":
    case "FN_EVENT_SSH_LOGIN_SUCCESS":
    case "FN_EVENT_SSH_LOGIN_FAILURE":
    case "FN_EVENT_SSH_IP_BLOCKED":
      return [DEFAULT_IP_FIELD];
    default:
      return [];
  }
};

export const resolveSystemEventIpFields = (
  type: SystemEventType,
  payload: Record<string, unknown>,
): SystemEventResolvedIpField[] =>
  getEventIpFieldDescriptors(type)
    .map((descriptor) => {
      const rawIp = String(payload[descriptor.ipKey] ?? "").trim();
      const normalizedIp = normalizeIp(rawIp);
      if (!rawIp || !normalizedIp) return null;

      return {
        ...descriptor,
        rawIp,
        normalizedIp,
      } satisfies SystemEventResolvedIpField;
    })
    .filter((item): item is SystemEventResolvedIpField => Boolean(item));

export const applySystemEventIpLocations = (
  type: SystemEventType,
  payload: Record<string, unknown>,
  resolveLocation: (normalizedIp: string) => string | undefined,
): boolean => {
  let updated = false;

  for (const field of resolveSystemEventIpFields(type, payload)) {
    if (String(payload[field.locationKey] ?? "").trim()) {
      continue;
    }

    const location = resolveLocation(field.normalizedIp)?.trim();
    if (!location) continue;

    payload[field.locationKey] = location;
    updated = true;
  }

  return updated;
};
