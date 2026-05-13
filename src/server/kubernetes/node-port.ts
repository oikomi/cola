import type { V1Service } from "@kubernetes/client-node";

export function collectUsedNodePorts(services: V1Service[]) {
  const ports = new Set<number>();

  for (const service of services) {
    for (const port of service.spec?.ports ?? []) {
      if (typeof port.nodePort === "number") {
        ports.add(port.nodePort);
      }
    }
  }

  return ports;
}

export function resolveAvailableNodePort(input: {
  services: V1Service[];
  start: number;
  end: number;
  errorMessage: string;
}) {
  const usedPorts = collectUsedNodePorts(input.services);

  for (let candidate = input.start; candidate <= input.end; candidate += 1) {
    if (!usedPorts.has(candidate)) return candidate;
  }

  throw new Error(input.errorMessage);
}
