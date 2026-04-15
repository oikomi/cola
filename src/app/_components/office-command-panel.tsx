"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";

import {
  priorityValues,
  riskLevelValues,
  roleLabels,
  taskTypeValues,
  type ApprovalType,
} from "@/server/office/catalog";
import type { OfficeSnapshot } from "@/server/office/types";
import { api } from "@/trpc/react";

type Props = {
  agents: OfficeSnapshot["agents"];
  tasks: OfficeSnapshot["tasks"];
  approvals: OfficeSnapshot["approvals"];
};

const taskTypeLabels: Record<(typeof taskTypeValues)[number], string> = {
  feature: "功能开发",
  bugfix: "缺陷修复",
  campaign: "运营活动",
  recruiting: "招聘推进",
  procurement: "采购流转",
  coordination: "跨部门协调",
};

const priorityLabels: Record<(typeof priorityValues)[number], string> = {
  low: "低",
  medium: "中",
  high: "高",
  critical: "关键",
};

const riskLabels: Record<(typeof riskLevelValues)[number], string> = {
  low: "低风险",
  medium: "中风险",
  high: "高风险",
};

export function OfficeCommandPanel({ agents, tasks, approvals }: Props) {
  const router = useRouter();
  const [isRefreshing, startTransition] = useTransition();
  const [feedback, setFeedback] = useState<string | null>(null);
  const [form, setForm] = useState({
    title: "",
    taskType: "feature" as (typeof taskTypeValues)[number],
    priority: "medium" as (typeof priorityValues)[number],
    riskLevel: "medium" as (typeof riskLevelValues)[number],
    ownerAgentId: agents.find((agent) => agent.role === "engineering")?.id ?? agents[0]?.id ?? "",
    summary: "",
  });

  const refresh = () => {
    startTransition(() => {
      router.refresh();
    });
  };

  const createTask = api.office.createTask.useMutation({
    onSuccess: () => {
      setFeedback("任务已创建并进入办公室任务流。");
      setForm((current) => ({
        ...current,
        title: "",
        summary: "",
      }));
      refresh();
    },
    onError: (error) => {
      setFeedback(error.message);
    },
  });

  const updateTaskStatus = api.office.updateTaskStatus.useMutation({
    onSuccess: () => {
      setFeedback("任务状态已更新。");
      refresh();
    },
    onError: (error) => {
      setFeedback(error.message);
    },
  });

  const requestApproval = api.office.requestApproval.useMutation({
    onSuccess: () => {
      setFeedback("审批请求已创建。");
      refresh();
    },
    onError: (error) => {
      setFeedback(error.message);
    },
  });

  const resolveApproval = api.office.resolveApproval.useMutation({
    onSuccess: () => {
      setFeedback("审批结果已写入系统。");
      refresh();
    },
    onError: (error) => {
      setFeedback(error.message);
    },
  });

  const hasPendingApproval = (taskId: string) =>
    approvals.some((approval) => approval.taskId === taskId);

  const requestApprovalType = (task: OfficeSnapshot["tasks"][number]): ApprovalType => {
    if (task.type === "procurement") return "vendor_quote";
    if (task.type === "recruiting") return "offer_release";
    return "production_release";
  };

  const approvalTitle = (task: OfficeSnapshot["tasks"][number]) => {
    if (task.type === "procurement") return `采购批准：${task.title}`;
    if (task.type === "recruiting") return `候选人推进批准：${task.title}`;
    return `发布 / 执行批准：${task.title}`;
  };

  const quickActions = tasks.slice(0, 4);
  const busy =
    isRefreshing ||
    createTask.isPending ||
    updateTaskStatus.isPending ||
    requestApproval.isPending ||
    resolveApproval.isPending;

  return (
    <section className="rounded-[28px] border border-white/60 bg-stone-950 px-5 py-5 text-stone-50 shadow-[0_24px_70px_rgba(40,26,14,0.18)]">
      <div className="flex items-center justify-between">
        <div>
          <p className="text-xs uppercase tracking-[0.25em] text-stone-400">
            Command deck
          </p>
          <h2 className="mt-1 text-xl font-semibold">任务与审批指挥台</h2>
        </div>
        <span className="rounded-full bg-white/10 px-3 py-1 text-xs text-stone-200">
          {approvals.length} 项待批
        </span>
      </div>

      <div className="mt-4 rounded-2xl border border-white/10 bg-white/5 p-4">
        <div className="flex items-center justify-between">
          <h3 className="text-sm font-medium text-white">创建新任务</h3>
          <span className="text-xs text-stone-400">先打通最小控制闭环</span>
        </div>

        <form
          className="mt-4 space-y-3"
          onSubmit={(event) => {
            event.preventDefault();
            setFeedback(null);
            createTask.mutate(form);
          }}
        >
          <input
            value={form.title}
            onChange={(event) =>
              setForm((current) => ({ ...current, title: event.target.value }))
            }
            placeholder="例如：补 Virtual Office 审批回放"
            className="w-full rounded-2xl border border-white/10 bg-white/10 px-4 py-3 text-sm text-white outline-none placeholder:text-stone-500"
          />
          <textarea
            value={form.summary}
            onChange={(event) =>
              setForm((current) => ({ ...current, summary: event.target.value }))
            }
            placeholder="任务摘要，建议写清输出物和上下文"
            rows={3}
            className="w-full rounded-2xl border border-white/10 bg-white/10 px-4 py-3 text-sm text-white outline-none placeholder:text-stone-500"
          />
          <div className="grid gap-3 sm:grid-cols-2">
            <select
              value={form.ownerAgentId}
              onChange={(event) =>
                setForm((current) => ({
                  ...current,
                  ownerAgentId: event.target.value,
                }))
              }
              className="rounded-2xl border border-white/10 bg-white/10 px-4 py-3 text-sm text-white outline-none"
            >
              {agents.map((agent) => (
                <option key={agent.id} value={agent.id} className="text-stone-900">
                  {agent.name} / {roleLabels[agent.role]}
                </option>
              ))}
            </select>
            <select
              value={form.taskType}
              onChange={(event) =>
                setForm((current) => ({
                  ...current,
                  taskType: event.target.value as (typeof taskTypeValues)[number],
                }))
              }
              className="rounded-2xl border border-white/10 bg-white/10 px-4 py-3 text-sm text-white outline-none"
            >
              {taskTypeValues.map((taskType) => (
                <option key={taskType} value={taskType} className="text-stone-900">
                  {taskTypeLabels[taskType]}
                </option>
              ))}
            </select>
            <select
              value={form.priority}
              onChange={(event) =>
                setForm((current) => ({
                  ...current,
                  priority: event.target.value as (typeof priorityValues)[number],
                }))
              }
              className="rounded-2xl border border-white/10 bg-white/10 px-4 py-3 text-sm text-white outline-none"
            >
              {priorityValues.map((priority) => (
                <option key={priority} value={priority} className="text-stone-900">
                  优先级：{priorityLabels[priority]}
                </option>
              ))}
            </select>
            <select
              value={form.riskLevel}
              onChange={(event) =>
                setForm((current) => ({
                  ...current,
                  riskLevel: event.target.value as (typeof riskLevelValues)[number],
                }))
              }
              className="rounded-2xl border border-white/10 bg-white/10 px-4 py-3 text-sm text-white outline-none"
            >
              {riskLevelValues.map((riskLevel) => (
                <option key={riskLevel} value={riskLevel} className="text-stone-900">
                  {riskLabels[riskLevel]}
                </option>
              ))}
            </select>
          </div>
          <button
            type="submit"
            disabled={busy || !form.title.trim() || !form.summary.trim()}
            className="w-full rounded-2xl bg-[#f4d89f] px-4 py-3 text-sm font-medium text-stone-900 transition hover:bg-[#f7e1b7] disabled:cursor-not-allowed disabled:opacity-60"
          >
            {createTask.isPending ? "正在创建任务..." : "创建任务"}
          </button>
        </form>
      </div>

      <div className="mt-4 rounded-2xl border border-white/10 bg-white/5 p-4">
        <div className="flex items-center justify-between">
          <h3 className="text-sm font-medium text-white">待审批动作</h3>
          <span className="text-xs text-stone-400">可直接批准或驳回</span>
        </div>
        <div className="mt-4 space-y-3">
          {approvals.length > 0 ? (
            approvals.map((approval) => (
              <div
                key={approval.id}
                className="rounded-2xl border border-white/10 bg-white/5 p-4"
              >
                <p className="text-sm font-medium text-white">{approval.title}</p>
                <p className="mt-2 text-sm leading-6 text-stone-300">
                  {approval.summary}
                </p>
                <div className="mt-3 flex gap-2">
                  <button
                    type="button"
                    disabled={busy}
                    onClick={() =>
                      resolveApproval.mutate({
                        approvalId: approval.id,
                        decision: "approved",
                      })
                    }
                    className="rounded-full bg-emerald-400/20 px-3 py-1.5 text-xs text-emerald-200 transition hover:bg-emerald-400/30 disabled:cursor-not-allowed disabled:opacity-60"
                  >
                    批准
                  </button>
                  <button
                    type="button"
                    disabled={busy}
                    onClick={() =>
                      resolveApproval.mutate({
                        approvalId: approval.id,
                        decision: "rejected",
                      })
                    }
                    className="rounded-full bg-rose-400/20 px-3 py-1.5 text-xs text-rose-200 transition hover:bg-rose-400/30 disabled:cursor-not-allowed disabled:opacity-60"
                  >
                    驳回
                  </button>
                </div>
              </div>
            ))
          ) : (
            <p className="text-sm text-stone-400">当前没有待审批事项。</p>
          )}
        </div>
      </div>

      <div className="mt-4 rounded-2xl border border-white/10 bg-white/5 p-4">
        <div className="flex items-center justify-between">
          <h3 className="text-sm font-medium text-white">任务快控</h3>
          <span className="text-xs text-stone-400">演示最小写操作闭环</span>
        </div>
        <div className="mt-4 space-y-3">
          {quickActions.map((task) => (
            <div
              key={task.id}
              className="rounded-2xl border border-white/10 bg-white/5 p-4"
            >
              <p className="text-sm font-medium text-white">{task.title}</p>
              <p className="mt-1 text-xs text-stone-400">{task.summary}</p>
              <div className="mt-3 flex flex-wrap gap-2">
                {task.status !== "in_progress" &&
                task.status !== "completed" &&
                task.status !== "canceled" ? (
                  <TaskActionButton
                    disabled={busy}
                    label="开始执行"
                    onClick={() =>
                      updateTaskStatus.mutate({
                        taskId: task.id,
                        status: "in_progress",
                      })
                    }
                  />
                ) : null}
                {task.status !== "completed" && task.status !== "canceled" ? (
                  <TaskActionButton
                    disabled={busy}
                    label="标记完成"
                    onClick={() =>
                      updateTaskStatus.mutate({
                        taskId: task.id,
                        status: "completed",
                      })
                    }
                  />
                ) : null}
                {!hasPendingApproval(task.id) &&
                task.riskLevel !== "low" &&
                task.status !== "completed" &&
                task.status !== "canceled" ? (
                  <TaskActionButton
                    disabled={busy}
                    label="请求审批"
                    onClick={() =>
                      requestApproval.mutate({
                        taskId: task.id,
                        approvalType: requestApprovalType(task),
                        title: approvalTitle(task),
                        summary: `由指挥台发起的审批请求：${task.summary}`,
                      })
                    }
                  />
                ) : null}
              </div>
            </div>
          ))}
        </div>
      </div>

      <div className="mt-4 rounded-2xl border border-white/10 bg-white/5 px-4 py-3 text-sm text-stone-300">
        {feedback ?? "现在可以直接在首页创建任务、推进任务状态和处理审批。"}
      </div>
    </section>
  );
}

function TaskActionButton({
  disabled,
  label,
  onClick,
}: {
  disabled: boolean;
  label: string;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      disabled={disabled}
      onClick={onClick}
      className="rounded-full bg-white/10 px-3 py-1.5 text-xs text-stone-200 transition hover:bg-white/20 disabled:cursor-not-allowed disabled:opacity-60"
    >
      {label}
    </button>
  );
}
