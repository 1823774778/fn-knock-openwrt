import { ipLocationRefs, ipLocationService } from "../ip-location";
import {
  applySystemEventIpLocations,
  resolveSystemEventIpFields,
} from "./ip-fields";
import type { SystemEventEnvelope } from "./types";

export const hydrateSystemEventIpLocations = async <
  T extends Pick<SystemEventEnvelope, "id" | "type" | "payload">,
>(
  events: T[],
): Promise<T[]> => {
  if (events.length === 0) return events;

  const refsByIp = new Map<string, Set<string>>();
  const locationMap = new Map<string, string>();

  for (const event of events) {
    for (const field of resolveSystemEventIpFields(event.type, event.payload)) {
      const refs = refsByIp.get(field.normalizedIp) || new Set<string>();
      refs.add(ipLocationRefs.systemEvent(event.id));
      refsByIp.set(field.normalizedIp, refs);
    }
  }

  await Promise.all(
    [...refsByIp.entries()].map(async ([ip, refs]) => {
      const location = await ipLocationService.registerUsage(ip, [...refs]);
      if (location) {
        locationMap.set(ip, location);
      }
    }),
  );

  for (const event of events) {
    applySystemEventIpLocations(event.type, event.payload, (normalizedIp) =>
      locationMap.get(normalizedIp),
    );
  }

  return events;
};
