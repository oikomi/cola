import { db } from "@/server/db";
import { getOfficeRealtimeVersion } from "@/server/office/snapshot";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const encoder = new TextEncoder();

function encodeSse(event: string, data: unknown) {
  return encoder.encode(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
}

export async function GET(request: Request) {
  let interval: ReturnType<typeof setInterval> | undefined;
  let closed = false;

  const stream = new ReadableStream<Uint8Array>({
    start(controller: ReadableStreamDefaultController<Uint8Array>) {
      const safeEnqueue = (event: string, data: unknown) => {
        if (closed) return false;

        try {
          controller.enqueue(encodeSse(event, data));
          return true;
        } catch {
          closed = true;
          if (interval) clearInterval(interval);
          return false;
        }
      };

      const close = () => {
        if (closed) return;
        closed = true;
        if (interval) clearInterval(interval);

        try {
          controller.close();
        } catch {
          // The stream may already be closed if the client disconnected.
        }
      };

      const tick = async () => {
        try {
          if (closed) return;
          const nextVersion = await getOfficeRealtimeVersion(db);
          if (closed) return;

          if (nextVersion !== latestVersion) {
            latestVersion = nextVersion;
            safeEnqueue("snapshot", {
              version: nextVersion,
              updatedAt: new Date().toISOString(),
            });
            return;
          }

          safeEnqueue("heartbeat", {
            version: latestVersion,
            at: new Date().toISOString(),
          });
        } catch (error) {
          safeEnqueue("error", {
            message:
              error instanceof Error ? error.message : "office stream failed",
          });
        }
      };

      request.signal.addEventListener("abort", () => {
        close();
      });

      let latestVersion = "initializing";
      void (async () => {
        try {
          latestVersion = await getOfficeRealtimeVersion(db);
          if (closed) return;

          safeEnqueue("snapshot", {
            version: latestVersion,
            connectedAt: new Date().toISOString(),
          });
        } catch (error) {
          safeEnqueue("error", {
            message:
              error instanceof Error ? error.message : "office stream failed",
          });
        }
      })();

      interval = setInterval(() => {
        void tick();
      }, 3000);
    },
    cancel() {
      if (interval) clearInterval(interval);
      closed = true;
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
    },
  });
}
