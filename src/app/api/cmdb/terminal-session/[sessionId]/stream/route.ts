import { getCmdbTerminalSession } from "@/server/cmdb/terminal-session";
import type { CmdbTerminalSessionEvent } from "@/server/cmdb/terminal-session";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type RouteContext = {
  params: Promise<{
    sessionId: string;
  }>;
};

export async function GET(request: Request, context: RouteContext) {
  const { sessionId } = await context.params;
  const session = getCmdbTerminalSession(sessionId);

  if (!session) {
    return new Response("终端会话不存在。", { status: 404 });
  }

  const encoder = new TextEncoder();
  let cleanup: () => void = () => undefined;

  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      let closed = false;
      let heartbeat: ReturnType<typeof setInterval> | null = null;
      let unsubscribe: (() => void) | null = null;

      const enqueue = (value: string) => {
        if (closed) return;

        try {
          controller.enqueue(encoder.encode(value));
        } catch {
          cleanup();
        }
      };

      const send = (event: CmdbTerminalSessionEvent) => {
        enqueue(`data: ${JSON.stringify(event)}\n\n`);
      };

      cleanup = () => {
        if (closed) return;
        closed = true;
        unsubscribe?.();
        if (heartbeat) clearInterval(heartbeat);
        request.signal.removeEventListener("abort", cleanup);

        try {
          controller.close();
        } catch {
          // The stream may already be closed by the client.
        }
      };

      unsubscribe = session.subscribe(send);
      heartbeat = setInterval(() => enqueue(": keepalive\n\n"), 15_000);
      request.signal.addEventListener("abort", cleanup, { once: true });
    },
    cancel() {
      cleanup();
    },
  });

  return new Response(stream, {
    headers: {
      "cache-control": "no-cache, no-transform",
      connection: "keep-alive",
      "content-type": "text/event-stream; charset=utf-8",
      "x-accel-buffering": "no",
    },
  });
}
