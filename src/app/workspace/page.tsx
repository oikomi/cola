import { MonitorSmartphoneIcon, PlusIcon, Trash2Icon } from "lucide-react";

import { ProductAreaHeader } from "@/app/_components/product-area-header";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";

const workspaceRows = [
  {
    id: "alice",
    name: "alice",
    status: "running",
    spec: "1 GPU · 8 CPU · 32 GB",
    node: "rw-gpu-178",
    endpoint: "alice.workspace.example.com",
    updatedAt: "04/20 18:20",
  },
  {
    id: "design-lab",
    name: "design-lab",
    status: "starting",
    spec: "0 GPU · 4 CPU · 16 GB",
    node: "rw-cpu-014",
    endpoint: "design-lab.workspace.example.com",
    updatedAt: "04/20 17:56",
  },
  {
    id: "ml-batch-02",
    name: "ml-batch-02",
    status: "stopped",
    spec: "2 GPU · 16 CPU · 64 GB",
    node: "rw-gpu-205",
    endpoint: "-",
    updatedAt: "04/20 16:41",
  },
] as const;

function statusTone(status: (typeof workspaceRows)[number]["status"]) {
  switch (status) {
    case "running":
      return "bg-[#edf9f3] text-[#0f6a3c]";
    case "starting":
      return "bg-[#fff4dd] text-[#8b5b10]";
    case "stopped":
      return "bg-[#f2f4f7] text-[#344054]";
    default:
      return "bg-[#f5f5f4] text-[#44403c]";
  }
}

function statusLabel(status: (typeof workspaceRows)[number]["status"]) {
  switch (status) {
    case "running":
      return "运行中";
    case "starting":
      return "启动中";
    case "stopped":
      return "已停止";
    default:
      return status;
  }
}

export default function WorkspacePage() {
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
              <Badge className="border-0 bg-[#eef4ff] text-[#32527a] hover:bg-[#eef4ff]">
                当前为前端占位列表
              </Badge>
              <Button className="h-10 rounded-full bg-[#173255] px-4 text-white hover:bg-[#10233b]">
                <PlusIcon data-icon="inline-start" />
                创建远程桌面
              </Button>
            </div>
          </div>

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
              {workspaceRows.map((workspace) => (
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
                        {workspace.spec}
                      </p>
                    </div>

                    <div>
                      <p className="text-[11px] tracking-[0.22em] text-[#8da0bc] uppercase md:hidden">
                        节点 / 地址
                      </p>
                      <p className="text-sm font-medium text-[#20324c]">
                        {workspace.node}
                      </p>
                      <p className="mt-1 text-sm text-[#62738d]">
                        {workspace.endpoint}
                      </p>
                    </div>

                    <div>
                      <p className="text-[11px] tracking-[0.22em] text-[#8da0bc] uppercase md:hidden">
                        更新时间
                      </p>
                      <p className="text-sm font-medium text-[#20324c]">
                        {workspace.updatedAt}
                      </p>
                    </div>

                    <div className="flex flex-wrap gap-2">
                      <Button
                        variant="outline"
                        className="h-9 rounded-full border-[#c9d7ee] bg-[#f8fbff] px-4 text-[#173255] hover:bg-white"
                      >
                        登录
                      </Button>
                      <Button
                        variant="outline"
                        className="h-9 rounded-full border-[#e7cfc7] bg-[#fff7f4] px-3 text-[#9b3d20] hover:bg-white"
                      >
                        <Trash2Icon className="size-4" />
                        删除
                      </Button>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          </div>
        </section>
      </div>
    </div>
  );
}
