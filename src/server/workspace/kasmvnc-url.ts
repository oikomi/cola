const KASMVNC_CLIENT_PARAMS: Record<string, string> = {
  autoconnect: "1",
  path: "websockify",
  resize: "remote",
  clipboard_up: "true",
  clipboard_down: "true",
  clipboard_seamless: "true",
  show_control_bar: "true",
};

export function buildKasmVncClientUrl(baseUrl: string) {
  const url = new URL("/vnc.html", baseUrl);
  for (const [key, value] of Object.entries(KASMVNC_CLIENT_PARAMS)) {
    url.searchParams.set(key, value);
  }
  return url.toString();
}
