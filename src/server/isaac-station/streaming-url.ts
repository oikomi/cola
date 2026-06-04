export const ISAAC_STATION_WEBRTC_PORT = 8211;

export function buildIsaacStationStreamingUrl(params: {
  nodeIp?: string | null;
  port?: number;
}) {
  if (!params.nodeIp) return null;
  const port = params.port ?? ISAAC_STATION_WEBRTC_PORT;
  return `http://${params.nodeIp}:${port}/streaming/webrtc-client?server=${encodeURIComponent(params.nodeIp)}`;
}
