"use client";

import {
  AlertTriangleIcon,
  ArrowLeftIcon,
  LoaderCircleIcon,
  PlayIcon,
  RadioTowerIcon,
  SquareIcon,
} from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button, buttonVariants } from "@/components/ui/button";
import { cn } from "@/lib/utils";

type StreamEventLike = {
  action?: string;
  status?: string;
  info?: unknown;
};

type ViewerStats = {
  codec?: string;
  fps?: number;
  rtd?: number;
  currentBitrate?: number;
  streamingResolutionWidth?: number;
  streamingResolutionHeight?: number;
};

type StreamStatsLike = {
  data?: {
    stats?: ViewerStats;
  };
};

type ViewerStatus = "idle" | "connecting" | "streaming" | "stopped" | "error";

type ParsedEndpoint = {
  host: string;
  port: number;
  value: string;
};

function parseEndpoint(value: string | null): ParsedEndpoint | null {
  const raw = value?.trim();
  if (!raw) return null;

  const withProtocol = /^[a-z][a-z0-9+.-]*:\/\//i.test(raw)
    ? raw
    : `tcp://${raw}`;

  try {
    const url = new URL(withProtocol);
    const host = url.hostname.trim();
    const port = Number(url.port.length > 0 ? url.port : "8011");

    if (!host || !Number.isInteger(port) || port <= 0 || port > 65_535) {
      return null;
    }

    return {
      host,
      port,
      value: `${host}:${port}`,
    };
  } catch {
    return null;
  }
}

function eventInfoText(event: StreamEventLike) {
  if (typeof event.info === "string") return event.info;
  if (event.info instanceof Error) return event.info.message;
  if (event.info) return JSON.stringify(event.info);

  return (
    [event.action, event.status].filter(Boolean).join(" / ") || "未知状态"
  );
}

function useElementSize<T extends HTMLElement>() {
  const ref = useRef<T | null>(null);
  const [size, setSize] = useState({ width: 1280, height: 720 });

  useEffect(() => {
    const element = ref.current;
    if (!element) return;

    const updateSize = () => {
      const bounds = element.getBoundingClientRect();
      setSize({
        width: Math.max(640, Math.floor(bounds.width)),
        height: Math.max(360, Math.floor(bounds.height)),
      });
    };

    updateSize();
    const observer = new ResizeObserver(updateSize);
    observer.observe(element);

    return () => observer.disconnect();
  }, []);

  return { ref, size };
}

export function IsaacWebrtcViewer() {
  const { ref: stageRef, size } = useElementSize<HTMLDivElement>();
  const sizeRef = useRef(size);
  const [status, setStatus] = useState<ViewerStatus>("idle");
  const [message, setMessage] = useState("等待连接");
  const [stats, setStats] = useState<ViewerStats | null>(null);
  const [searchParams, setSearchParams] = useState<URLSearchParams | null>(null);

  useEffect(() => {
    setSearchParams(new URLSearchParams(window.location.search));
  }, []);

  useEffect(() => {
    sizeRef.current = size;
  }, [size]);

  const endpoint = useMemo(
    () => parseEndpoint(searchParams?.get("endpoint") ?? null),
    [searchParams],
  );
  const rawResourceName = searchParams?.get("name")?.trim();
  const resourceName =
    rawResourceName && rawResourceName.length > 0 ? rawResourceName : "Isaac";
  const resourceKind =
    searchParams?.get("kind") === "lab" ? "Isaac Lab" : "Isaac Sim";

  const disconnect = useCallback(async () => {
    try {
      const { AppStreamer } = await import("@nvidia/ov-web-rtc");
      await AppStreamer.terminate(false).catch(() => undefined);
      setStatus("stopped");
      setMessage("画面连接已断开");
    } catch (error) {
      setStatus("error");
      setMessage(error instanceof Error ? error.message : "断开连接失败");
    }
  }, []);

  const connect = useCallback(async () => {
    if (!endpoint) {
      setStatus("error");
      setMessage("连接地址无效");
      return;
    }

    setStatus("connecting");
    setMessage(`正在连接 ${endpoint.value}`);
    setStats(null);

    try {
      const { AppStreamer, EventStatus, LogLevel, StreamType } = await import(
        "@nvidia/ov-web-rtc"
      );

      await AppStreamer.terminate(false).catch(() => undefined);
      const targetSize = sizeRef.current;

      await AppStreamer.connect({
        streamSource: StreamType.DIRECT,
        logLevel: LogLevel.WARN,
        streamConfig: {
          server: endpoint.host,
          signalingServer: endpoint.host,
          signalingPort: endpoint.port,
          mediaServer: endpoint.host,
          mediaPort: endpoint.port,
          videoElementId: "isaac-webrtc-video",
          audioElementId: "isaac-webrtc-audio",
          width: Math.min(1920, targetSize.width),
          height: Math.min(1080, targetSize.height),
          fps: 60,
          fitStreamResolution: true,
          onStart: (event: StreamEventLike) => {
            if (event.status === EventStatus.ERROR) {
              setStatus("error");
              setMessage(eventInfoText(event));
              return;
            }

            setStatus("streaming");
            setMessage("WebRTC 画面已连接");
          },
          onStop: (event: StreamEventLike) => {
            setStatus("stopped");
            setMessage(eventInfoText(event));
          },
          onTerminate: (event: StreamEventLike) => {
            setStatus("stopped");
            setMessage(eventInfoText(event));
          },
          onStreamStats: (event: StreamStatsLike) => {
            setStats(event.data?.stats ?? null);
          },
        },
      });
    } catch (error) {
      setStatus("error");
      setMessage(
        error instanceof Error
          ? error.message
          : eventInfoText(error as StreamEventLike),
      );
    }
  }, [endpoint]);

  useEffect(() => {
    if (!searchParams) return;

    void connect();

    return () => {
      void import("@nvidia/ov-web-rtc").then(({ AppStreamer }) =>
        AppStreamer.terminate(false).catch(() => undefined),
      );
    };
  }, [connect, searchParams]);

  return (
    <main className="min-h-dvh bg-[#0b1118] text-white">
      <div className="flex min-h-dvh flex-col">
        <header className="flex min-h-14 flex-wrap items-center justify-between gap-2 border-b border-white/10 bg-[#111a24] px-3 py-2 sm:px-4">
          <div className="flex min-w-0 items-center gap-2">
            <span className="flex size-8 shrink-0 items-center justify-center rounded-[8px] border border-cyan-300/25 bg-cyan-300/10 text-cyan-200">
              <RadioTowerIcon className="size-4" />
            </span>
            <div className="min-w-0">
              <h1 className="truncate text-sm leading-5 font-semibold tracking-normal">
                {resourceKind} · {resourceName}
              </h1>
              <p className="truncate font-mono text-[12px] leading-4 text-slate-300">
                {endpoint?.value ?? "连接地址无效"}
              </p>
            </div>
          </div>

          <div className="flex items-center gap-1.5">
            <a
              href="/isaac"
              className={cn(
                buttonVariants({ size: "sm", variant: "outline" }),
                "h-8 rounded-[8px] border-white/15 bg-white/5 px-2.5 text-[12px] text-slate-100 hover:bg-white/10 hover:text-white",
              )}
            >
              <ArrowLeftIcon data-icon="inline-start" />
              返回 Isaac
            </a>
            <Button
              size="sm"
              variant="outline"
              className="h-8 rounded-[8px] border-white/15 bg-white/5 px-2.5 text-[12px] text-slate-100 hover:bg-white/10 hover:text-white"
              disabled={status === "connecting" || !endpoint}
              onClick={() => void connect()}
            >
              {status === "connecting" ? (
                <LoaderCircleIcon
                  className="animate-spin"
                  data-icon="inline-start"
                />
              ) : (
                <PlayIcon data-icon="inline-start" />
              )}
              连接
            </Button>
            <Button
              size="sm"
              variant="outline"
              className="h-8 rounded-[8px] border-white/15 bg-white/5 px-2.5 text-[12px] text-slate-100 hover:bg-white/10 hover:text-white"
              onClick={() => void disconnect()}
            >
              <SquareIcon data-icon="inline-start" />
              断开
            </Button>
          </div>
        </header>

        <section className="grid min-h-0 flex-1 grid-rows-[minmax(0,1fr)_auto]">
          <div
            ref={stageRef}
            className="relative min-h-[calc(100dvh-9.25rem)] overflow-hidden bg-black"
          >
            <video
              id="isaac-webrtc-video"
              className="h-full w-full bg-black object-contain"
              autoPlay
              playsInline
              muted
              tabIndex={0}
            />
            <audio id="isaac-webrtc-audio" autoPlay />

            {status !== "streaming" ? (
              <div className="absolute inset-0 flex items-center justify-center bg-black/72 p-4">
                <div className="w-full max-w-lg rounded-[8px] border border-white/12 bg-[#101923]/94 p-4 shadow-[0_18px_60px_rgba(0,0,0,0.35)]">
                  <div className="flex items-start gap-3">
                    <span className="mt-0.5 flex size-8 shrink-0 items-center justify-center rounded-[8px] bg-cyan-300/10 text-cyan-200">
                      {status === "error" ? (
                        <AlertTriangleIcon className="size-4 text-amber-300" />
                      ) : status === "connecting" ? (
                        <LoaderCircleIcon className="size-4 animate-spin" />
                      ) : (
                        <RadioTowerIcon className="size-4" />
                      )}
                    </span>
                    <div className="min-w-0">
                      <p className="text-sm font-semibold">
                        {status === "error"
                          ? "连接失败"
                          : status === "connecting"
                            ? "正在建立 WebRTC 连接"
                            : "WebRTC Viewer"}
                      </p>
                      <p className="mt-1 break-words text-[13px] leading-5 text-slate-300">
                        {message}
                      </p>
                    </div>
                  </div>
                </div>
              </div>
            ) : null}
          </div>

          <footer className="grid gap-2 border-t border-white/10 bg-[#111a24] px-3 py-2 text-[12px] text-slate-300 sm:grid-cols-[minmax(0,1fr)_auto] sm:items-center sm:px-4">
            <div className="min-w-0 truncate">
              状态：{message}
              {stats
                ? ` · ${stats.codec ?? "codec"} · ${stats.fps ?? 0} FPS · ${
                    stats.streamingResolutionWidth ?? "-"
                  }x${stats.streamingResolutionHeight ?? "-"}`
                : ""}
            </div>
            <div className="font-mono text-slate-400">
              {stats?.currentBitrate
                ? `${stats.currentBitrate.toFixed(1)} Mbps`
                : "等待统计"}
              {stats?.rtd ? ` · ${Math.round(stats.rtd)} ms` : ""}
            </div>
          </footer>
        </section>

        {!endpoint ? (
          <Alert className="fixed right-3 bottom-3 left-3 border-amber-200 bg-amber-50 text-amber-900 sm:left-auto sm:w-[420px]">
            <AlertTriangleIcon className="size-4" />
            <AlertTitle>连接地址无效</AlertTitle>
            <AlertDescription>
              请从 Isaac 页面打开 WebRTC 任务，或在 URL 中提供 endpoint 参数。
            </AlertDescription>
          </Alert>
        ) : null}
      </div>
    </main>
  );
}
