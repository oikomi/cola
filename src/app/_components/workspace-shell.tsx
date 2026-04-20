"use client";

import {
  LoaderCircleIcon,
  MonitorSmartphoneIcon,
  PlusIcon,
  Trash2Icon,
} from "lucide-react";
import { useState } from "react";

import { ProductAreaHeader } from "@/app/_components/product-area-header";
import { Badge } from "@/components/ui/badge";
import { Button, buttonVariants } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { api, type RouterOutputs } from "@/trpc/react";
import { cn } from "@/lib/utils";

type WorkspaceRow = RouterOutputs["workspace"]["list"]["items"][number];

function FormField({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) {
  return (
    <label className="grid gap-2">
      <span className="text-[11px] font-medium tracking-[0.28em] text-[#6f83a3] uppercase">
        {label}
      </span>
      {children}
    </label>
  );
}

function statusTone(status: WorkspaceRow["status"]) {
  switch (status) {
    case "running":
      return "bg-[#edf9f3] text-[#0f6a3c]";
    case "starting":
      return "bg-[#fff4dd] text-[#8b5b10]";
    case "error":
      return "bg-[#fff1f2] text-[#b42318]";
    default:
      return "bg-[#f5f5f4] text-[#44403c]";
  }
}

function statusLabel(status: WorkspaceRow["status"]) {
  switch (status) {
    case "running":
      return "运行中";
    case "starting":
      return "启动中";
    case "error":
      return "异常";
    default:
      return status;
  }
}

function specLabel(workspace: WorkspaceRow) {
  return `${workspace.gpu} GPU · ${workspace.cpu} CPU · ${workspace.memory}`;
}

export function WorkspaceShell() {
  const utils = api.useUtils();
  const [isCreateOpen, setIsCreateOpen] = useState(false);
  const [feedback, setFeedback] = useState<string | null>(null);
  const [draft, setDraft] = useState({
    name: "",
    cpu: "4",
    memoryGi: "16",
    gpu: "0",
  });

  const workspaceQuery = api.workspace.list.useQuery(undefined, {
    refetchOnWindowFocus: false,
  });

  const createWorkspace = api.workspace.create.useMutation({
    onSuccess: async () => {
      await utils.workspace.list.invalidate();
      setFeedback("远程桌面已提交创建。");
      setIsCreateOpen(false);
      setDraft({
        name: "",
        cpu: "4",
        memoryGi: "16",
        gpu: "0",
      });
    },
    onError: (error) => setFeedback(error.message),
  });

  const deleteWorkspace = api.workspace.delete.useMutation({
    onSuccess: async () => {
      await utils.workspace.list.invalidate();
      setFeedback("远程桌面已删除。");
    },
    onError: (error) => setFeedback(error.message),
  });

  const rows = workspaceQuery.data?.items ?? [];
  const capabilityReason = workspaceQuery.data?.reason ?? null;
  const available = workspaceQuery.data?.available ?? true;

  const handleCreate = async () => {
    const memoryGi = Number.parseInt(draft.memoryGi, 10);
    const gpu = Number.parseInt(draft.gpu, 10);

    await createWorkspace.mutateAsync({
      name: draft.name,
      cpu: draft.cpu,
      memoryGi,
      gpu,
    });
  };

  const handleDelete = async (name: string) => {
    if (typeof window !== "undefined") {
      const confirmed = window.confirm(`确认删除远程桌面 ${name}？`);
      if (!confirmed) return;
    }

    await deleteWorkspace.mutateAsync({ name });
  };

  return (
    <div className="min-h-dvh bg-[linear-gradient(180deg,#f5f8ff_0%,#edf2fc_44%,#e8edf8_100%)] text-[#142033]">
      <div className="mx-auto max-w-[1520px] px-3 py-3 md:px-5 md:py-4">
        <ProductAreaHeader />

        <section className="mt-6 rounded-[32px] border border-[#d8e3f5] bg-white/88 shadow-[0_24px_90px_rgba(59,87,126,0.12)]">
          <div className="flex flex-col gap-4 border-b border-[#e3ebf8] px-5 py-5 md:flex-row md:items-center md:justify-between md:px-6">
            <div className="flex items-start gap-4">
              <div className="flex size-12 items-center justify-center rounded-[18px] bg-[#173255] text-white">
                <MonitorSmartphoneIcon className="size-5" />
              </div>
              <div>
                <p className="text-[11px] tracking-[0.3em] text-[#7385a3] uppercase">
                  Remote Desktop
                </p>
                <h1 className="mt-1 text-3xl font-semibold tracking-[-0.05em] text-[#152133]">
                  远程桌面列表
                </h1>
                <p className="mt-2 text-sm leading-6 text-[#5b6d89]">
                  页面只保留简单 list 和三类动作：创建、删除、登录。
                </p>
              </div>
            </div>

            <div className="flex flex-wrap items-center gap-3">
              <Badge
                className={cn(
                  "border-0 hover:bg-inherit",
                  available
                    ? "bg-[#eef4ff] text-[#32527a]"
                    : "bg-[#fff1f2] text-[#b42318]",
                )}
              >
                {available ? "K8s 已连接" : "K8s 不可用"}
              </Badge>
              <Button
                className="h-10 rounded-full bg-[#173255] px-4 text-white hover:bg-[#10233b]"
                disabled={!available}
                onClick={() => setIsCreateOpen(true)}
              >
                <PlusIcon data-icon="inline-start" />
                创建远程桌面
              </Button>
            </div>
          </div>

          {capabilityReason ? (
            <div className="border-b border-[#f0d8d8] bg-[#fff8f8] px-5 py-4 text-sm leading-6 text-[#8f2d2d] md:px-6">
              {capabilityReason}
            </div>
          ) : null}

          {feedback ? (
            <div className="border-b border-[#e3ebf8] bg-[#f8fbff] px-5 py-4 text-sm leading-6 text-[#38506f] md:px-6">
              {feedback}
            </div>
          ) : null}

          <div className="px-5 py-5 md:px-6">
            <div className="hidden rounded-[20px] border border-[#e7edf8] bg-[#f6f9ff] px-4 py-3 text-[11px] font-medium tracking-[0.18em] text-[#71839f] uppercase md:grid md:grid-cols-[minmax(0,1.2fr)_160px_180px_minmax(0,1fr)_120px_220px] md:items-center md:gap-4">
              <span>名称</span>
              <span>状态</span>
              <span>规格</span>
              <span>节点 / 地址</span>
              <span>更新时间</span>
              <span>操作</span>
            </div>

            <div className="mt-3 space-y-3">
              {workspaceQuery.isLoading ? (
                <div className="rounded-[24px] border border-[#e3ebf8] bg-white px-4 py-8 text-center text-sm text-[#5f7594]">
                  <LoaderCircleIcon className="mx-auto mb-3 animate-spin" />
                  正在读取远程桌面列表...
                </div>
              ) : null}

              {!workspaceQuery.isLoading && rows.length === 0 ? (
                <div className="rounded-[24px] border border-dashed border-[#d9e4f5] bg-[#f8fbff] px-4 py-8 text-center">
                  <p className="text-base font-medium text-[#1d314d]">
                    还没有远程桌面
                  </p>
                  <p className="mt-2 text-sm leading-6 text-[#62738d]">
                    先创建一个远程桌面，再进行登录或删除。
                  </p>
                </div>
              ) : null}

              {rows.map((workspace) => (
                <div
                  key={workspace.id}
                  className="rounded-[24px] border border-[#e3ebf8] bg-white px-4 py-4 shadow-[0_14px_40px_rgba(72,101,140,0.06)]"
                >
                  <div className="grid gap-4 md:grid-cols-[minmax(0,1.2fr)_160px_180px_minmax(0,1fr)_120px_220px] md:items-center">
                    <div>
                      <p className="text-lg font-semibold tracking-[-0.03em] text-[#152133]">
                        {workspace.name}
                      </p>
                      <p className="mt-1 text-sm leading-6 text-[#62738d]">
                        Workspace ID: {workspace.id}
                      </p>
                    </div>

                    <div>
                      <p className="text-[11px] tracking-[0.22em] text-[#8da0bc] uppercase md:hidden">
                        状态
                      </p>
                      <span
                        className={`inline-flex rounded-full px-2.5 py-1 text-xs font-semibold ${statusTone(workspace.status)}`}
                      >
                        {statusLabel(workspace.status)}
                      </span>
                    </div>

                    <div>
                      <p className="text-[11px] tracking-[0.22em] text-[#8da0bc] uppercase md:hidden">
                        规格
                      </p>
                      <p className="text-sm font-medium text-[#20324c]">
                        {specLabel(workspace)}
                      </p>
                    </div>

                    <div>
                      <p className="text-[11px] tracking-[0.22em] text-[#8da0bc] uppercase md:hidden">
                        节点 / 地址
                      </p>
                      <p className="text-sm font-medium text-[#20324c]">
                        {workspace.nodeName ?? "-"}
                      </p>
                      <p className="mt-1 text-sm break-all text-[#62738d]">
                        {workspace.endpoint ?? "-"}
                      </p>
                    </div>

                    <div>
                      <p className="text-[11px] tracking-[0.22em] text-[#8da0bc] uppercase md:hidden">
                        更新时间
                      </p>
                      <p className="text-sm font-medium text-[#20324c]">
                        {workspace.updatedAt ?? "-"}
                      </p>
                    </div>

                    <div className="flex flex-wrap gap-2">
                      {workspace.loginUrl ? (
                        <a
                          href={workspace.loginUrl}
                          target="_blank"
                          rel="noreferrer"
                          className={cn(
                            buttonVariants({ variant: "outline" }),
                            "h-9 rounded-full border-[#c9d7ee] bg-[#f8fbff] px-4 text-[#173255] hover:bg-white",
                          )}
                        >
                          登录
                        </a>
                      ) : (
                        <Button
                          variant="outline"
                          className="h-9 rounded-full border-[#c9d7ee] bg-[#f8fbff] px-4 text-[#173255] hover:bg-white"
                          disabled
                        >
                          登录
                        </Button>
                      )}
                      <Button
                        variant="outline"
                        className="h-9 rounded-full border-[#e7cfc7] bg-[#fff7f4] px-3 text-[#9b3d20] hover:bg-white"
                        disabled={deleteWorkspace.isPending}
                        onClick={() => void handleDelete(workspace.name)}
                      >
                        {deleteWorkspace.isPending ? (
                          <LoaderCircleIcon className="animate-spin" />
                        ) : (
                          <Trash2Icon className="size-4" />
                        )}
                        删除
                      </Button>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          </div>
        </section>

        <Dialog open={isCreateOpen} onOpenChange={setIsCreateOpen}>
          <DialogContent className="border-[#d8e3f5] bg-[#f9fbff] sm:max-w-lg">
            <DialogHeader>
              <DialogTitle>创建远程桌面</DialogTitle>
              <DialogDescription>
                直接指定 CPU、Memory、GPU，然后在 Kubernetes 中创建远程桌面。
              </DialogDescription>
            </DialogHeader>

            <div className="grid gap-4">
              <FormField label="名称">
                <Input
                  className="bg-white"
                  placeholder="例如：alice 或 ml-batch-01"
                  value={draft.name}
                  onChange={(event) =>
                    setDraft((current) => ({
                      ...current,
                      name: event.target.value.trim().toLowerCase(),
                    }))
                  }
                />
              </FormField>

              <div className="grid gap-4 md:grid-cols-3">
                <FormField label="CPU">
                  <Input
                    className="bg-white"
                    inputMode="decimal"
                    value={draft.cpu}
                    onChange={(event) =>
                      setDraft((current) => ({
                        ...current,
                        cpu: event.target.value,
                      }))
                    }
                  />
                </FormField>

                <FormField label="Memory Gi">
                  <Input
                    className="bg-white"
                    inputMode="numeric"
                    value={draft.memoryGi}
                    onChange={(event) =>
                      setDraft((current) => ({
                        ...current,
                        memoryGi: event.target.value,
                      }))
                    }
                  />
                </FormField>

                <FormField label="GPU">
                  <Input
                    className="bg-white"
                    inputMode="numeric"
                    value={draft.gpu}
                    onChange={(event) =>
                      setDraft((current) => ({
                        ...current,
                        gpu: event.target.value,
                      }))
                    }
                  />
                </FormField>
              </div>
            </div>

            <DialogFooter className="bg-[#f3f7ff]">
              <Button variant="outline" onClick={() => setIsCreateOpen(false)}>
                取消
              </Button>
              <Button
                className="bg-[#173255] text-white hover:bg-[#10233b]"
                disabled={
                  createWorkspace.isPending ||
                  !available ||
                  draft.name.length < 2
                }
                onClick={() => void handleCreate()}
              >
                {createWorkspace.isPending ? (
                  <LoaderCircleIcon
                    className="animate-spin"
                    data-icon="inline-start"
                  />
                ) : (
                  <PlusIcon data-icon="inline-start" />
                )}
                创建远程桌面
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      </div>
    </div>
  );
}
