export type ParsedKasmVncConnections = {
  activeConnectionIds: string[];
  activeConnectionCount: number;
};

export type ParsedTcpConnection = {
  state: string;
  localAddress: string;
  peerAddress: string;
};

const KASMVNC_ACCEPTED_CONNECTION_PATTERN = /Connections:\s+accepted:\s+(\S+)/;
const KASMVNC_CLOSED_CONNECTION_PATTERN = /Connections:\s+closed:\s+(\S+)/;

function parseConnectionId(line: string, pattern: RegExp) {
  return pattern.exec(line)?.[1] ?? null;
}

export function parseKasmVncActiveConnections(
  logText: string,
): ParsedKasmVncConnections {
  const activeConnectionIds = new Set<string>();

  for (const line of logText.split(/\r?\n/)) {
    const acceptedConnectionId = parseConnectionId(
      line,
      KASMVNC_ACCEPTED_CONNECTION_PATTERN,
    );
    if (acceptedConnectionId) {
      activeConnectionIds.add(acceptedConnectionId);
      continue;
    }

    const closedConnectionId = parseConnectionId(
      line,
      KASMVNC_CLOSED_CONNECTION_PATTERN,
    );
    if (closedConnectionId) {
      activeConnectionIds.delete(closedConnectionId);
    }
  }

  return {
    activeConnectionIds: [...activeConnectionIds],
    activeConnectionCount: activeConnectionIds.size,
  };
}

function localAddressUsesPort(localAddress: string, port: number) {
  return (
    localAddress.endsWith(`:${port}`) ||
    localAddress.endsWith(`]:${port}`) ||
    localAddress.includes(`.${port}`)
  );
}

export function parseEstablishedTcpConnections(
  ssOutput: string,
  port: number,
): ParsedTcpConnection[] {
  return ssOutput
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
    .flatMap((line) => {
      const columns = line.split(/\s+/);
      const state = columns[0];
      const localAddress = columns[3];
      const peerAddress = columns[4];

      if (
        state !== "ESTAB" ||
        !localAddress ||
        !peerAddress ||
        !localAddressUsesPort(localAddress, port)
      ) {
        return [];
      }

      return [{ state, localAddress, peerAddress }];
    });
}
