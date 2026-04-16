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
      const close = () => {
        if (closed) return;
        closed = true;
        if (interval) clearInterval(interval);
        controller.close();
      };

      const tick = async () => {
        try {
          const nextVersion = await getOfficeRealtimeVersion(db);

          if (nextVersion !== latestVersion) {
            latestVersion = nextVersion;
            controller.enqueue(
              encodeSse("snapshot", {
                version: nextVersion,
                updatedAt: new Date().toISOString(),
              }),
            );
            return;
          }

          controller.enqueue(
            encodeSse("heartbeat", {
              version: latestVersion,
              at: new Date().toISOString(),
            }),
          );
        } catch (error) {
          controller.enqueue(
            encodeSse("error", {
              message:
                error instanceof Error ? error.message : "office stream failed",
            }),
          );
        }
      };

      request.signal.addEventListener("abort", () => {
        close();
      });

      let latestVersion = "initializing";
      void (async () => {
        latestVersion = await getOfficeRealtimeVersion(db);
        controller.enqueue(
          encodeSse("snapshot", {
            version: latestVersion,
            connectedAt: new Date().toISOString(),
          }),
        );
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
