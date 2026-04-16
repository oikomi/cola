import { zoneLabels, type ZoneId } from "@/server/office/catalog";

export const officeHeadline =
  "Virtual Office MVP 正在跑真实数据库模型：产品整理需求，研发占用 Docker runner 执行，运营等待发布摘要，CEO Office 只处理升级与批准。";

export const zonePresentation: Record<
  ZoneId,
  {
    label: string;
    summary: string;
    x: number;
    y: number;
    width: number;
    height: number;
  }
> = {
  command: {
    label: zoneLabels.command,
    summary: "全局视角、审批和异常升级都在这里汇总。",
    x: 6,
    y: 8,
    width: 22,
    height: 26,
  },
  product: {
    label: zoneLabels.product,
    summary: "需求拆解、优先级判断、交接摘要。",
    x: 28,
    y: 6,
    width: 28,
    height: 30,
  },
  engineering: {
    label: zoneLabels.engineering,
    summary: "代码、测试、执行会话和设备调度。",
    x: 18,
    y: 40,
    width: 36,
    height: 32,
  },
  growth: {
    label: zoneLabels.growth,
    summary: "发布说明、活动变更、数据复盘。",
    x: 56,
    y: 14,
    width: 22,
    height: 24,
  },
  people: {
    label: zoneLabels.people,
    summary: "招聘推进、面试反馈、组织节奏。",
    x: 56,
    y: 56,
    width: 20,
    height: 22,
  },
  vendor: {
    label: zoneLabels.vendor,
    summary: "询价、比价、采购建议、供应商状态。",
    x: 76,
    y: 44,
    width: 18,
    height: 24,
  },
};

export const agentPresentation: Record<
  string,
  {
    x: number;
    y: number;
    energy: number;
  }
> = {
  "11111111-1111-4111-8111-111111111111": { x: 12, y: 20, energy: 88 },
  "22222222-2222-4222-8222-222222222222": { x: 40, y: 16, energy: 73 },
  "33333333-3333-4333-8333-333333333333": { x: 32, y: 54, energy: 92 },
  "44444444-4444-4444-8444-444444444444": { x: 66, y: 25, energy: 69 },
  "55555555-5555-4555-8555-555555555555": { x: 62, y: 66, energy: 61 },
  "66666666-6666-4666-8666-666666666666": { x: 84, y: 55, energy: 57 },
};
