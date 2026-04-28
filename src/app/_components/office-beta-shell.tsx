"use client";

import {
  BriefcaseBusinessIcon,
  CpuIcon,
  ExternalLinkIcon,
  LoaderCircleIcon,
  PlusIcon,
  RadarIcon,
  RotateCcwIcon,
  ShieldAlertIcon,
  SparklesIcon,
  Trash2Icon,
  UserRoundPlusIcon,
  UsersIcon,
  ZoomInIcon,
  ZoomOutIcon,
} from "lucide-react";
import * as PIXI from "pixi.js";
import { gsap } from "gsap";
import { startTransition, useEffect, useRef, useState } from "react";

import { AdminChrome } from "@/app/_components/admin-chrome";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { useConfirmDialog } from "@/components/ui/confirm-dialog";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { k8sWorkspaceEngineLabels } from "@/lib/product-areas";
import { useOfficeBetaStore } from "@/lib/office-beta-store";
import { cn, optionLabel } from "@/lib/utils";
import {
  agentRoleValues,
  agentStatusLabels,
  dockerRunnerEngineValues,
  roleLabels,
  zoneLabels,
  type AgentRole,
  type DockerRunnerEngine,
} from "@/server/office/catalog";
import type { OfficeAgent, OfficeSnapshot } from "@/server/office/types";
import { api } from "@/trpc/react";

type Props = {
  snapshot: OfficeSnapshot;
};

type ZoneKey = OfficeSnapshot["zones"][number]["id"];

type ZoneSceneConfig = {
  anchor: { x: number; y: number };
  rugTint: number;
  deskTint: number;
  chairTint: number;
  workstations: ZoneWorkstation[];
  decor: "command" | "product" | "engineering" | "growth" | "people" | "vendor";
};

type SceneAgentPosition = {
  worldX: number;
  worldY: number;
  screenX: number;
  screenY: number;
  workstationIndex: number | null;
};

type ZoneWorkstation = {
  deskX: number;
  deskY: number;
  personX: number;
  personY: number;
};

const TILE_WIDTH = 72;
const TILE_HEIGHT = 36;
const ROOM_WIDTH = 18;
const ROOM_HEIGHT = 13;
const WALL_HEIGHT = 114;
const MIN_CAMERA_SCALE = 0.56;
const MAX_CAMERA_SCALE = 1.18;

const ROLE_COLORS: Record<AgentRole, number> = {
  ceo_office: 0x161310,
  product: 0xffc658,
  engineering: 0x64b6ff,
  operations: 0xb687ff,
  hr: 0xff7ca4,
  procurement: 0xff8d61,
};

const ROLE_LABEL_STYLES: Record<
  AgentRole,
  {
    fill: number;
    text: string;
  }
> = {
  ceo_office: { fill: 0xd0b58c, text: "#2d1a0e" },
  product: { fill: 0xffcf70, text: "#3e2305" },
  engineering: { fill: 0x90d3ff, text: "#0d2b41" },
  operations: { fill: 0xc6a3ff, text: "#311748" },
  hr: { fill: 0xffadc4, text: "#4b1026" },
  procurement: { fill: 0xffb18a, text: "#52200f" },
};

const ZONE_BADGE_STYLES: Record<
  ZoneKey,
  {
    meta: string;
  }
> = {
  command: {
    meta: "#805f4c",
  },
  product: {
    meta: "#966849",
  },
  engineering: {
    meta: "#4e7468",
  },
  growth: {
    meta: "#8d6841",
  },
  people: {
    meta: "#6b5782",
  },
  vendor: {
    meta: "#8b5d4a",
  },
};

const STATUS_GLOWS: Record<OfficeAgent["status"], number> = {
  idle: 0xf5d28a,
  planning: 0xecc870,
  waiting_device: 0xf3a85f,
  executing: 0x7bd8ff,
  waiting_handoff: 0x9be2ca,
  waiting_approval: 0xffb36a,
  blocked: 0xff7b7b,
  error: 0xff5b5b,
};

const ROLE_ICONS: Record<AgentRole, typeof BriefcaseBusinessIcon> = {
  ceo_office: BriefcaseBusinessIcon,
  product: SparklesIcon,
  engineering: CpuIcon,
  operations: RadarIcon,
  hr: UsersIcon,
  procurement: ShieldAlertIcon,
};

const ROLE_HINTS: Record<AgentRole, string> = {
  ceo_office: "负责跨团队编排、升级判断和关键审批。",
  product: "负责需求拆解、优先级整理和交接摘要。",
  engineering: "负责实现、调试、测试和最终交付。",
  operations: "负责活动执行、发布节奏和运营反馈。",
  hr: "负责招聘推进、候选人协同和组织动作。",
  procurement: "负责询价、比价和供应商推进。",
};

const ZONE_KEY_SET = new Set<ZoneKey>([
  "command",
  "product",
  "engineering",
  "growth",
  "people",
  "vendor",
]);
const AGENT_ROLE_SET = new Set<AgentRole>(agentRoleValues);
const DOCKER_RUNNER_ENGINE_SET = new Set<DockerRunnerEngine>(
  dockerRunnerEngineValues,
);

function isZoneKey(value: string): value is ZoneKey {
  return ZONE_KEY_SET.has(value as ZoneKey);
}

function isAgentRole(value: string): value is AgentRole {
  return AGENT_ROLE_SET.has(value as AgentRole);
}

function isDockerRunnerEngine(value: string): value is DockerRunnerEngine {
  return DOCKER_RUNNER_ENGINE_SET.has(value as DockerRunnerEngine);
}

function zoneForRole(role: AgentRole): ZoneKey {
  switch (role) {
    case "operations":
      return "growth";
    case "hr":
      return "people";
    case "procurement":
      return "vendor";
    case "ceo_office":
      return "command";
    case "product":
      return "product";
    case "engineering":
    default:
      return "engineering";
  }
}

const ZONE_SCENE: Record<ZoneKey, ZoneSceneConfig> = {
  command: {
    anchor: { x: 2.4, y: 8.15 },
    rugTint: 0xdcd4ff,
    deskTint: 0x2c3645,
    chairTint: 0x85739d,
    workstations: [
      { deskX: 1.1, deskY: 7.05, personX: 1.68, personY: 7.92 },
      { deskX: 2.32, deskY: 7.72, personX: 2.9, personY: 8.58 },
      { deskX: 1.58, deskY: 8.78, personX: 2.16, personY: 9.64 },
    ],
    decor: "command",
  },
  product: {
    anchor: { x: 4.95, y: 2.45 },
    rugTint: 0xd2dce5,
    deskTint: 0xa97a5d,
    chairTint: 0x846c74,
    workstations: [
      { deskX: 3.55, deskY: 1.55, personX: 4.12, personY: 2.42 },
      { deskX: 5.05, deskY: 1.28, personX: 5.62, personY: 2.14 },
      { deskX: 6.05, deskY: 2.45, personX: 6.62, personY: 3.32 },
      { deskX: 4.55, deskY: 3.05, personX: 5.12, personY: 3.9 },
    ],
    decor: "product",
  },
  engineering: {
    anchor: { x: 8.2, y: 5.9 },
    rugTint: 0xcfe3da,
    deskTint: 0x915e43,
    chairTint: 0x7d6c7a,
    workstations: [
      { deskX: 5.85, deskY: 4.05, personX: 6.42, personY: 4.92 },
      { deskX: 7.45, deskY: 3.82, personX: 8.02, personY: 4.68 },
      { deskX: 9.15, deskY: 4.22, personX: 9.72, personY: 5.08 },
      { deskX: 5.75, deskY: 5.9, personX: 6.32, personY: 6.78 },
      { deskX: 7.5, deskY: 6.05, personX: 8.08, personY: 6.92 },
      { deskX: 9.25, deskY: 6.3, personX: 9.82, personY: 7.18 },
      { deskX: 7.2, deskY: 8.0, personX: 7.78, personY: 8.88 },
    ],
    decor: "engineering",
  },
  growth: {
    anchor: { x: 12.0, y: 2.75 },
    rugTint: 0xffe3a4,
    deskTint: 0x8d694e,
    chairTint: 0x8b6d75,
    workstations: [
      { deskX: 11.05, deskY: 2.0, personX: 11.62, personY: 2.88 },
      { deskX: 12.45, deskY: 2.32, personX: 13.02, personY: 3.18 },
      { deskX: 11.7, deskY: 3.45, personX: 12.28, personY: 4.32 },
    ],
    decor: "growth",
  },
  people: {
    anchor: { x: 10.4, y: 9.15 },
    rugTint: 0xd8d2ef,
    deskTint: 0xaa7a57,
    chairTint: 0x8a7078,
    workstations: [
      { deskX: 9.35, deskY: 8.0, personX: 9.92, personY: 8.86 },
      { deskX: 10.9, deskY: 8.28, personX: 11.48, personY: 9.16 },
      { deskX: 10.0, deskY: 9.28, personX: 10.58, personY: 10.16 },
    ],
    decor: "people",
  },
  vendor: {
    anchor: { x: 12.35, y: 5.9 },
    rugTint: 0xffd5d8,
    deskTint: 0xbd8559,
    chairTint: 0x8b6a74,
    workstations: [
      { deskX: 11.8, deskY: 5.62, personX: 12.38, personY: 6.49 },
      { deskX: 13.0, deskY: 5.9, personX: 13.57, personY: 6.75 },
      { deskX: 12.32, deskY: 6.92, personX: 12.89, personY: 7.78 },
    ],
    decor: "vendor",
  },
};

const AGENT_LAYOUT_OFFSETS = [
  { x: 0, y: 0 },
  { x: -0.55, y: 0.48 },
  { x: 0.62, y: 0.36 },
  { x: -0.78, y: -0.36 },
  { x: 0.86, y: -0.24 },
  { x: -0.15, y: 0.92 },
  { x: 0.3, y: -0.88 },
];

function clamp(value: number, min: number, max: number) {
  return Math.min(Math.max(value, min), max);
}

function getCanvasResolution() {
  if (typeof window === "undefined") return 1;
  return clamp(window.devicePixelRatio || 1, 1, 2);
}

function FormField({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) {
  return (
    <label className="grid gap-2">
      <span className="text-[12px] leading-5 font-medium text-[#7d6858]">
        {label}
      </span>
      {children}
    </label>
  );
}

function compactLabelText(text: string, maxLength: number) {
  if (text.length <= maxLength) return text;
  return `${text.slice(0, Math.max(3, maxLength - 1))}…`;
}

function roleHairTint(role: AgentRole) {
  switch (role) {
    case "product":
      return 0x5f3d29;
    case "engineering":
      return 0x1f2430;
    case "operations":
      return 0x6f4f8d;
    case "hr":
      return 0x7f4a57;
    case "procurement":
      return 0x714a2f;
    case "ceo_office":
      return 0x111111;
    default:
      return 0x3a2c22;
  }
}

function agentWorldHint(agent: OfficeAgent) {
  return {
    x: 1.2 + (agent.x / 100) * (ROOM_WIDTH - 2.4),
    y: 1.15 + (agent.y / 100) * (ROOM_HEIGHT - 2.3),
  };
}

function resolveZoneWorkstations(zone: ZoneSceneConfig, capacity?: number) {
  if (typeof capacity !== "number") {
    return zone.workstations;
  }

  return zone.workstations.slice(
    0,
    Math.max(0, Math.min(zone.workstations.length, capacity)),
  );
}

function isoToScreen(x: number, y: number) {
  return {
    x: (x - y) * (TILE_WIDTH / 2),
    y: (x + y) * (TILE_HEIGHT / 2),
  };
}

function getDefaultSceneAnchor() {
  const floorCenter = isoToScreen(ROOM_WIDTH / 2, ROOM_HEIGHT / 2);
  return {
    x: floorCenter.x,
    y: floorCenter.y - WALL_HEIGHT / 2,
  };
}

function getCameraPose(
  size: { width: number; height: number },
  focused: SceneAgentPosition | null,
) {
  const fitScale = clamp(
    Math.min(size.width / 1240, size.height / 760),
    0.58,
    1.02,
  );
  const baseTarget = {
    x: size.width * (size.width < 900 ? 0.5 : 0.49),
    y: size.height * (size.width < 900 ? 0.52 : 0.49),
  };
  const focusedTarget = {
    x: size.width * (size.width < 900 ? 0.5 : 0.46),
    y: size.height * (size.width < 900 ? 0.48 : 0.44),
  };
  const targetScale = focused
    ? size.width < 900
      ? clamp(fitScale * 0.96, 0.64, 0.82)
      : clamp(fitScale * 1.1, 0.84, 1.12)
    : size.width < 900
      ? clamp(fitScale * 0.92, 0.58, 0.78)
      : fitScale;
  const anchor = focused
    ? { x: focused.screenX, y: focused.screenY }
    : getDefaultSceneAnchor();
  const target = focused ? focusedTarget : baseTarget;

  return {
    scale: targetScale,
    x: target.x - anchor.x * targetScale,
    y: target.y - anchor.y * targetScale,
  };
}

function createText(
  text: string,
  style: Partial<PIXI.TextStyle> = {},
  anchorX = 0,
  anchorY = 0,
) {
  const node = new PIXI.Text({
    text,
    style: {
      fill: "#17120d",
      fontFamily: "Geist, ui-sans-serif, system-ui",
      fontSize: 14,
      fontWeight: "600",
      ...style,
    },
  });
  node.anchor.set(anchorX, anchorY);
  return node;
}

type GraphicsFillState = { color: number; alpha: number };
type GraphicsStrokeState = { width: number; color: number; alpha: number };

const graphicsFillState = new WeakMap<PIXI.Graphics, GraphicsFillState>();
const graphicsStrokeState = new WeakMap<PIXI.Graphics, GraphicsStrokeState>();

function beginFill(graphics: PIXI.Graphics, color: number, alpha = 1) {
  graphicsFillState.set(graphics, { color, alpha });
}

function endFill(graphics: PIXI.Graphics) {
  graphicsFillState.delete(graphics);
}

function lineStyle(
  graphics: PIXI.Graphics,
  width: number,
  color: number,
  alpha = 1,
) {
  graphicsStrokeState.set(graphics, { width, color, alpha });
}

function applyGraphicsPaint(graphics: PIXI.Graphics) {
  const fill = graphicsFillState.get(graphics);
  const stroke = graphicsStrokeState.get(graphics);

  if (fill) {
    graphics.fill(fill);
  }
  if (stroke) {
    graphics.stroke(stroke);
  }
}

function strokePath(graphics: PIXI.Graphics) {
  const stroke = graphicsStrokeState.get(graphics);
  if (stroke) {
    graphics.stroke(stroke);
  }
}

function drawPolygon(
  graphics: PIXI.Graphics,
  points: Array<{ x: number; y: number }>,
) {
  graphics.poly(points.flatMap((point) => [point.x, point.y]));
  applyGraphicsPaint(graphics);
}

function drawRoundedRect(
  graphics: PIXI.Graphics,
  x: number,
  y: number,
  width: number,
  height: number,
  radius: number,
) {
  graphics.roundRect(x, y, width, height, radius);
  applyGraphicsPaint(graphics);
}

function drawRect(
  graphics: PIXI.Graphics,
  x: number,
  y: number,
  width: number,
  height: number,
) {
  graphics.rect(x, y, width, height);
  applyGraphicsPaint(graphics);
}

function drawCircle(
  graphics: PIXI.Graphics,
  x: number,
  y: number,
  radius: number,
) {
  graphics.circle(x, y, radius);
  applyGraphicsPaint(graphics);
}

function drawEllipse(
  graphics: PIXI.Graphics,
  x: number,
  y: number,
  halfWidth: number,
  halfHeight: number,
) {
  graphics.ellipse(x, y, halfWidth, halfHeight);
  applyGraphicsPaint(graphics);
}

function drawIsoBox(
  target: PIXI.Container,
  x: number,
  y: number,
  width: number,
  depth: number,
  height: number,
  colors: {
    top: number;
    left: number;
    right: number;
  },
) {
  const baseA = isoToScreen(x, y);
  const baseB = isoToScreen(x + width, y);
  const baseC = isoToScreen(x + width, y + depth);
  const baseD = isoToScreen(x, y + depth);
  const lift = { x: 0, y: -height };
  const topA = { x: baseA.x + lift.x, y: baseA.y + lift.y };
  const topB = { x: baseB.x + lift.x, y: baseB.y + lift.y };
  const topC = { x: baseC.x + lift.x, y: baseC.y + lift.y };
  const topD = { x: baseD.x + lift.x, y: baseD.y + lift.y };

  const rightFace = new PIXI.Graphics();
  beginFill(rightFace, colors.right);
  drawPolygon(rightFace, [topB, topC, baseC, baseB]);
  endFill(rightFace);

  const leftFace = new PIXI.Graphics();
  beginFill(leftFace, colors.left);
  drawPolygon(leftFace, [topA, topD, baseD, baseA]);
  endFill(leftFace);

  const topFace = new PIXI.Graphics();
  beginFill(topFace, colors.top);
  drawPolygon(topFace, [topA, topB, topC, topD]);
  endFill(topFace);
  lineStyle(topFace, 1, 0x000000, 0.08);
  drawPolygon(topFace, [topA, topB, topC, topD]);

  target.addChild(rightFace, leftFace, topFace);
}

function addMonitorStack(
  layer: PIXI.Container,
  x: number,
  y: number,
  screenTint: number,
  zIndex: number,
  variant: "single" | "dual" | "ultrawide" = "single",
) {
  const monitor = new PIXI.Container();

  if (variant === "dual") {
    drawIsoBox(monitor, x, y, 0.22, 0.12, 16, {
      top: screenTint,
      left: 0x2d3945,
      right: 0x4a5a6a,
    });
    drawIsoBox(monitor, x + 0.28, y + 0.05, 0.22, 0.12, 16, {
      top: screenTint,
      left: 0x2d3945,
      right: 0x4a5a6a,
    });
  } else if (variant === "ultrawide") {
    drawIsoBox(monitor, x, y, 0.42, 0.12, 16, {
      top: screenTint,
      left: 0x2d3945,
      right: 0x4a5a6a,
    });
  } else {
    drawIsoBox(monitor, x, y, 0.22, 0.12, 16, {
      top: screenTint,
      left: 0x2d3945,
      right: 0x4a5a6a,
    });
  }

  monitor.zIndex = zIndex;
  layer.addChild(monitor);
}

function addWorkstationFurniture(
  layer: PIXI.Container,
  zoneId: ZoneKey,
  zone: ZoneSceneConfig,
  workstation: ZoneWorkstation,
  index: number,
) {
  const deskContainer = new PIXI.Container();
  const chair = new PIXI.Graphics();
  const chairPos = isoToScreen(workstation.personX, workstation.personY - 0.06);

  switch (zoneId) {
    case "command":
      drawIsoBox(
        deskContainer,
        workstation.deskX,
        workstation.deskY,
        1.08,
        0.56,
        18,
        {
          top: 0x283240,
          left: 0x161d27,
          right: 0x202a35,
        },
      );
      addMonitorStack(
        layer,
        workstation.deskX + 0.2,
        workstation.deskY + 0.18,
        0x6fe3ff,
        isoToScreen(workstation.deskX + 0.4, workstation.deskY + 0.28).y,
        "dual",
      );
      beginFill(chair, 0x85739d, 0.95);
      drawRoundedRect(chair, chairPos.x - 8, chairPos.y - 8, 14, 15, 4);
      endFill(chair);
      beginFill(chair, 0x6c5961, 0.75);
      drawRect(chair, chairPos.x - 1.5, chairPos.y + 4, 3, 8);
      endFill(chair);
      break;

    case "product": {
      drawIsoBox(
        deskContainer,
        workstation.deskX,
        workstation.deskY,
        1.18,
        0.64,
        18,
        {
          top: 0xb78767,
          left: 0x96694e,
          right: 0x845a42,
        },
      );
      addMonitorStack(
        layer,
        workstation.deskX + 0.18,
        workstation.deskY + 0.18,
        0xdde8f5,
        isoToScreen(workstation.deskX + 0.38, workstation.deskY + 0.28).y,
      );
      const note = new PIXI.Graphics();
      const notePos = isoToScreen(
        workstation.deskX + 0.84,
        workstation.deskY + 0.24,
      );
      beginFill(note, index % 2 === 0 ? 0xffcb6d : 0xff93ac, 0.94);
      drawRoundedRect(note, notePos.x - 5, notePos.y - 10, 10, 8, 2);
      endFill(note);
      note.zIndex = isoToScreen(
        workstation.deskX + 0.88,
        workstation.deskY + 0.28,
      ).y;
      layer.addChild(note);
      beginFill(chair, 0x8b6f79, 0.95);
      drawRoundedRect(chair, chairPos.x - 9, chairPos.y - 8, 15, 14, 4);
      endFill(chair);
      beginFill(chair, 0x6c5961, 0.72);
      drawRect(chair, chairPos.x - 1.5, chairPos.y + 3, 3, 8);
      endFill(chair);
      break;
    }

    case "engineering":
      drawIsoBox(
        deskContainer,
        workstation.deskX,
        workstation.deskY,
        0.88,
        0.52,
        18,
        {
          top: 0x7d5b45,
          left: 0x654837,
          right: 0x5a4031,
        },
      );
      addMonitorStack(
        layer,
        workstation.deskX + 0.12,
        workstation.deskY + 0.16,
        0x5fd4ff,
        isoToScreen(workstation.deskX + 0.3, workstation.deskY + 0.26).y,
        index % 2 === 0 ? "ultrawide" : "single",
      );
      beginFill(chair, 0x6e667d, 0.96);
      drawRoundedRect(chair, chairPos.x - 8, chairPos.y - 8, 14, 15, 4);
      endFill(chair);
      beginFill(chair, 0x545164, 0.78);
      drawRect(chair, chairPos.x - 1.5, chairPos.y + 4, 3, 8);
      endFill(chair);
      break;

    case "growth": {
      drawIsoBox(
        deskContainer,
        workstation.deskX,
        workstation.deskY,
        0.96,
        0.52,
        18,
        {
          top: 0x967055,
          left: 0x79583f,
          right: 0x6c4f39,
        },
      );
      addMonitorStack(
        layer,
        workstation.deskX + 0.16,
        workstation.deskY + 0.16,
        0xffdb77,
        isoToScreen(workstation.deskX + 0.3, workstation.deskY + 0.24).y,
      );
      const mat = new PIXI.Graphics();
      const matPos = isoToScreen(
        workstation.deskX + 0.9,
        workstation.deskY + 0.95,
      );
      beginFill(mat, 0xffdf84, 0.38);
      drawEllipse(mat, matPos.x, matPos.y, 22, 12);
      endFill(mat);
      mat.zIndex = matPos.y - 1;
      layer.addChild(mat);
      beginFill(chair, 0x8b6d75, 0.96);
      drawRoundedRect(chair, chairPos.x - 8, chairPos.y - 8, 14, 15, 4);
      endFill(chair);
      beginFill(chair, 0x6c5961, 0.75);
      drawRect(chair, chairPos.x - 1.5, chairPos.y + 4, 3, 8);
      endFill(chair);
      break;
    }

    case "people":
      drawIsoBox(
        deskContainer,
        workstation.deskX,
        workstation.deskY,
        1.28,
        0.48,
        18,
        {
          top: 0xb58a6c,
          left: 0x946d54,
          right: 0x835f49,
        },
      );
      addMonitorStack(
        layer,
        workstation.deskX + 0.18,
        workstation.deskY + 0.14,
        0xd9e2ef,
        isoToScreen(workstation.deskX + 0.34, workstation.deskY + 0.22).y,
      );
      beginFill(chair, 0x9b7c88, 0.96);
      drawRoundedRect(chair, chairPos.x - 9, chairPos.y - 8, 15, 14, 4);
      endFill(chair);
      beginFill(chair, 0x7b646d, 0.72);
      drawRect(chair, chairPos.x - 1.5, chairPos.y + 3, 3, 8);
      endFill(chair);
      break;

    case "vendor":
      drawIsoBox(
        deskContainer,
        workstation.deskX,
        workstation.deskY,
        1.05,
        0.6,
        18,
        {
          top: 0xc28c62,
          left: 0xa06f4b,
          right: 0x8f6242,
        },
      );
      addMonitorStack(
        layer,
        workstation.deskX + 0.16,
        workstation.deskY + 0.18,
        0xe6e8ed,
        isoToScreen(workstation.deskX + 0.3, workstation.deskY + 0.28).y,
      );
      const parcel = new PIXI.Graphics();
      const parcelPos = isoToScreen(
        workstation.deskX + 0.82,
        workstation.deskY + 0.32,
      );
      beginFill(parcel, 0xd4af85, 0.95);
      drawRoundedRect(parcel, parcelPos.x - 6, parcelPos.y - 9, 11, 8, 2);
      endFill(parcel);
      parcel.zIndex = isoToScreen(
        workstation.deskX + 0.85,
        workstation.deskY + 0.36,
      ).y;
      layer.addChild(parcel);
      beginFill(chair, 0x917079, 0.96);
      drawRoundedRect(chair, chairPos.x - 8, chairPos.y - 8, 14, 14, 4);
      endFill(chair);
      beginFill(chair, 0x6f5861, 0.72);
      drawRect(chair, chairPos.x - 1.5, chairPos.y + 3, 3, 8);
      endFill(chair);
      break;
  }

  deskContainer.zIndex = isoToScreen(
    workstation.deskX + 0.6,
    workstation.deskY + 0.8,
  ).y;
  layer.addChild(deskContainer, chair);
}

function addZoneGround(
  layer: PIXI.Container,
  zoneId: ZoneKey,
  anchor: { x: number; y: number },
  active: boolean,
) {
  const center = isoToScreen(anchor.x, anchor.y);
  const alpha = active ? 0.32 : 0.18;
  const ground = new PIXI.Graphics();

  switch (zoneId) {
    case "command":
      beginFill(ground, 0xe5e1ff, alpha);
      drawEllipse(ground, center.x - 22, center.y + 10, 78, 40);
      endFill(ground);
      break;
    case "product":
      beginFill(ground, 0xdde7f3, alpha);
      drawEllipse(ground, center.x - 4, center.y + 10, 118, 46);
      endFill(ground);
      break;
    case "engineering":
      beginFill(ground, 0xd5ece1, alpha);
      drawEllipse(ground, center.x, center.y + 14, 156, 72);
      endFill(ground);
      beginFill(ground, 0xc0dfd3, active ? 0.22 : 0.1);
      drawEllipse(ground, center.x, center.y + 14, 96, 44);
      endFill(ground);
      break;
    case "growth":
      beginFill(ground, 0xffe3a2, alpha);
      drawEllipse(ground, center.x + 8, center.y + 10, 92, 42);
      endFill(ground);
      break;
    case "people":
      beginFill(ground, 0xe2daf5, alpha);
      drawEllipse(ground, center.x + 10, center.y + 14, 116, 52);
      endFill(ground);
      break;
    case "vendor":
      beginFill(ground, 0xffd8dc, alpha);
      drawEllipse(ground, center.x + 6, center.y + 12, 104, 48);
      endFill(ground);
      break;
  }

  ground.zIndex = center.y - 14;
  layer.addChild(ground);
}

function addSelectedWorkstationGlow(
  layer: PIXI.Container,
  workstation: ZoneWorkstation,
) {
  const pos = isoToScreen(
    workstation.personX - 0.08,
    workstation.personY + 0.02,
  );
  const glow = new PIXI.Graphics();
  beginFill(glow, 0xffe19b, 0.24);
  drawEllipse(glow, pos.x, pos.y + 6, 22, 10);
  endFill(glow);
  lineStyle(glow, 2, 0xffd36b, 0.78);
  drawEllipse(glow, pos.x, pos.y + 6, 14, 6);
  glow.zIndex = pos.y - 1;
  layer.addChild(glow);
}

function addDeskCluster(
  layer: PIXI.Container,
  zone: ZoneSceneConfig,
  zoneId: ZoneKey,
  workstationCapacity: number,
  active = false,
) {
  const workstations = resolveZoneWorkstations(zone, workstationCapacity);
  const rug = new PIXI.Graphics();
  beginFill(rug, zone.rugTint, active ? 0.34 : 0.22);
  const anchorScreen = isoToScreen(zone.anchor.x, zone.anchor.y);
  drawEllipse(
    rug,
    anchorScreen.x,
    anchorScreen.y + 8,
    zoneId === "engineering" ? 160 : zoneId === "vendor" ? 86 : 96,
    zoneId === "engineering" ? 82 : zoneId === "vendor" ? 44 : 50,
  );
  endFill(rug);
  rug.zIndex = anchorScreen.y - 10;
  layer.addChild(rug);

  for (const [index, workstation] of workstations.entries()) {
    addWorkstationFurniture(layer, zoneId, zone, workstation, index);
  }
}

function addZoneDecor(
  layer: PIXI.Container,
  zone: ZoneSceneConfig,
  _zoneId: ZoneKey,
) {
  switch (zone.decor) {
    case "command": {
      const console = new PIXI.Container();
      drawIsoBox(
        console,
        zone.anchor.x - 1.2,
        zone.anchor.y - 1.55,
        1.1,
        0.68,
        44,
        {
          top: 0x161d28,
          left: 0x0d131a,
          right: 0x202b36,
        },
      );
      drawIsoBox(
        console,
        zone.anchor.x - 0.65,
        zone.anchor.y - 1.28,
        0.4,
        0.22,
        56,
        {
          top: 0x46d6ff,
          left: 0x2b87a4,
          right: 0x3bb9d9,
        },
      );
      console.zIndex = isoToScreen(
        zone.anchor.x - 0.15,
        zone.anchor.y - 0.95,
      ).y;
      layer.addChild(console);
      break;
    }
    case "product": {
      const board = new PIXI.Graphics();
      const pos = isoToScreen(zone.anchor.x - 1.7, zone.anchor.y - 1.45);
      beginFill(board, 0xfaf3e5);
      drawRoundedRect(board, pos.x - 24, pos.y - 50, 46, 32, 5);
      endFill(board);
      beginFill(board, 0xffcf69);
      drawRect(board, pos.x - 16, pos.y - 42, 8, 10);
      beginFill(board, 0x87c6ff);
      drawRect(board, pos.x - 4, pos.y - 35, 8, 8);
      beginFill(board, 0xff8fa4);
      drawRect(board, pos.x + 8, pos.y - 41, 8, 9);
      board.zIndex = pos.y - 10;
      layer.addChild(board);
      break;
    }
    case "engineering": {
      const rackA = new PIXI.Container();
      drawIsoBox(
        rackA,
        zone.anchor.x + 1.9,
        zone.anchor.y + 0.8,
        0.55,
        0.7,
        86,
        {
          top: 0x34414d,
          left: 0x1e262d,
          right: 0x28323d,
        },
      );
      rackA.zIndex = isoToScreen(zone.anchor.x + 2.35, zone.anchor.y + 1.5).y;
      layer.addChild(rackA);

      const rackB = new PIXI.Container();
      drawIsoBox(
        rackB,
        zone.anchor.x + 2.7,
        zone.anchor.y + 1.25,
        0.55,
        0.7,
        96,
        {
          top: 0x414e5d,
          left: 0x2a313a,
          right: 0x313b46,
        },
      );
      rackB.zIndex = isoToScreen(zone.anchor.x + 3.15, zone.anchor.y + 1.95).y;
      layer.addChild(rackB);
      break;
    }
    case "growth": {
      const platform = new PIXI.Graphics();
      const pos = isoToScreen(zone.anchor.x + 1.1, zone.anchor.y + 1.1);
      beginFill(platform, 0xffda7d, 0.7);
      drawEllipse(platform, pos.x, pos.y, 44, 21);
      endFill(platform);
      platform.zIndex = pos.y - 2;
      layer.addChild(platform);
      break;
    }
    case "people": {
      const couch = new PIXI.Container();
      drawIsoBox(
        couch,
        zone.anchor.x - 0.85,
        zone.anchor.y + 1.05,
        1.42,
        0.55,
        24,
        {
          top: 0xb29cd6,
          left: 0x8f78b1,
          right: 0x786390,
        },
      );
      couch.zIndex = isoToScreen(zone.anchor.x + 0.2, zone.anchor.y + 1.6).y;
      layer.addChild(couch);
      break;
    }
    case "vendor": {
      const crates = new PIXI.Container();
      drawIsoBox(
        crates,
        zone.anchor.x + 0.82,
        zone.anchor.y - 0.22,
        0.8,
        0.6,
        24,
        {
          top: 0xcf9565,
          left: 0xa3704b,
          right: 0x8d5f3d,
        },
      );
      drawIsoBox(
        crates,
        zone.anchor.x + 1.48,
        zone.anchor.y + 0.18,
        0.52,
        0.52,
        18,
        {
          top: 0xe0b486,
          left: 0xbd9068,
          right: 0xa97a55,
        },
      );
      crates.zIndex = isoToScreen(zone.anchor.x + 1.72, zone.anchor.y + 0.88).y;
      layer.addChild(crates);
      break;
    }
  }
}

function addInteriorPartitions(layer: PIXI.Container) {
  const partitionA = new PIXI.Container();
  drawIsoBox(partitionA, 8.15, 2.25, 4.4, 0.12, 34, {
    top: 0x9f7c69,
    left: 0x876352,
    right: 0x7a594b,
  });
  partitionA.zIndex = isoToScreen(11.8, 2.35).y;
  layer.addChild(partitionA);

  const partitionB = new PIXI.Container();
  drawIsoBox(partitionB, 13.25, 5.35, 0.12, 2.9, 30, {
    top: 0x9f7c69,
    left: 0x876352,
    right: 0x7a594b,
  });
  partitionB.zIndex = isoToScreen(13.35, 7.95).y;
  layer.addChild(partitionB);

  const partitionC = new PIXI.Container();
  drawIsoBox(partitionC, 8.9, 8.95, 4.1, 0.12, 28, {
    top: 0x9f7c69,
    left: 0x876352,
    right: 0x7a594b,
  });
  partitionC.zIndex = isoToScreen(12.2, 9.05).y;
  layer.addChild(partitionC);
}

function addSceneDecor(layer: PIXI.Container) {
  addInteriorPartitions(layer);

  const wallArt = [
    { x: 1.2, y: 1.1, tint: 0xf04f7a },
    { x: 6.8, y: 0.8, tint: 0x7be0d0 },
    { x: 11.1, y: 1.6, tint: 0x68b8ff },
    { x: 14.2, y: 4.6, tint: 0xf5ae5f },
  ];

  for (const art of wallArt) {
    const pos = isoToScreen(art.x, art.y);
    const frame = new PIXI.Graphics();
    beginFill(frame, 0x2a211c);
    drawRoundedRect(frame, pos.x - 9, pos.y - WALL_HEIGHT + 24, 18, 12, 3);
    endFill(frame);
    beginFill(frame, art.tint);
    drawRect(frame, pos.x - 6, pos.y - WALL_HEIGHT + 27, 12, 6);
    endFill(frame);
    frame.zIndex = pos.y - WALL_HEIGHT + 28;
    layer.addChild(frame);
  }

  const plants = [
    { x: 3.4, y: 2.2 },
    { x: 8.8, y: 2.0 },
    { x: 5.3, y: 8.7 },
    { x: 11.9, y: 7.05 },
  ];

  for (const plant of plants) {
    const pos = isoToScreen(plant.x, plant.y);
    const stem = new PIXI.Graphics();
    lineStyle(stem, 2, 0x6ab7a7, 0.95);
    stem.moveTo(pos.x, pos.y - 22);
    stem.lineTo(pos.x, pos.y);
    strokePath(stem);
    beginFill(stem, 0x98e3d1);
    drawEllipse(stem, pos.x - 4, pos.y - 18, 5, 12);
    drawEllipse(stem, pos.x + 4, pos.y - 12, 5, 11);
    endFill(stem);
    stem.zIndex = pos.y;
    layer.addChild(stem);
  }

  const lounge = new PIXI.Container();
  drawIsoBox(lounge, 4.8, 8.6, 1.6, 0.65, 26, {
    top: 0xb9a4d1,
    left: 0x8b75a8,
    right: 0x775e8d,
  });
  drawIsoBox(lounge, 5.9, 9.15, 0.75, 0.5, 18, {
    top: 0xd8cbec,
    left: 0xb0a2ca,
    right: 0x9b8ab7,
  });
  lounge.zIndex = isoToScreen(6.8, 9.8).y;
  layer.addChild(lounge);

  const rack = new PIXI.Container();
  drawIsoBox(rack, 8.6, 8.9, 0.8, 0.8, 78, {
    top: 0x3e4a58,
    left: 0x29333e,
    right: 0x202731,
  });
  rack.zIndex = isoToScreen(9.4, 9.8).y;
  layer.addChild(rack);

  const table = new PIXI.Container();
  drawIsoBox(table, 12.95, 5.22, 1.65, 0.95, 18, {
    top: 0xbe875a,
    left: 0x9c6b49,
    right: 0x8a5938,
  });
  table.zIndex = isoToScreen(14.25, 6.15).y;
  layer.addChild(table);

  const printer = new PIXI.Container();
  drawIsoBox(printer, 13.65, 3.15, 0.9, 0.62, 34, {
    top: 0xe3e7ee,
    left: 0xb9c0cb,
    right: 0xa0a8b4,
  });
  drawIsoBox(printer, 13.9, 3.37, 0.42, 0.2, 46, {
    top: 0x202b36,
    left: 0x171f27,
    right: 0x28323c,
  });
  printer.zIndex = isoToScreen(14.45, 3.8).y;
  layer.addChild(printer);

  const coffee = new PIXI.Container();
  drawIsoBox(coffee, 2.2, 5.55, 0.72, 0.5, 26, {
    top: 0x3f5d57,
    left: 0x28413c,
    right: 0x31504a,
  });
  drawIsoBox(coffee, 2.38, 5.72, 0.32, 0.18, 34, {
    top: 0x78e3c6,
    left: 0x4ab39b,
    right: 0x5bceb1,
  });
  coffee.zIndex = isoToScreen(2.9, 6.05).y;
  layer.addChild(coffee);

  const bench = new PIXI.Container();
  drawIsoBox(bench, 8.6, 10.15, 1.7, 0.42, 14, {
    top: 0x6f523e,
    left: 0x543d2f,
    right: 0x624738,
  });
  bench.zIndex = isoToScreen(9.9, 10.52).y;
  layer.addChild(bench);

  const sideTable = new PIXI.Container();
  drawIsoBox(sideTable, 13.15, 7.55, 0.7, 0.44, 16, {
    top: 0x906955,
    left: 0x714f40,
    right: 0x805b49,
  });
  sideTable.zIndex = isoToScreen(13.75, 7.9).y;
  layer.addChild(sideTable);
}

function buildStatusPill(status: OfficeAgent["status"]) {
  switch (status) {
    case "executing":
      return "bg-[#edf9f3] text-[#0f6a3c]";
    case "planning":
    case "waiting_device":
    case "waiting_approval":
      return "bg-[#fff4dd] text-[#8b5b10]";
    case "waiting_handoff":
      return "bg-[#eef4ff] text-[#3458a4]";
    case "blocked":
    case "error":
      return "bg-[#fff1f2] text-[#b42318]";
    default:
      return "bg-[#f1ece5] text-[#54463a]";
  }
}

function getAgentWorldPosition(
  agent: OfficeAgent,
  index: number,
  workstations: ZoneWorkstation[],
  usedWorkstations: Set<number>,
): SceneAgentPosition {
  const hint = agentWorldHint(agent);

  let pickedStation: ZoneWorkstation | null = null;
  let pickedIndex = -1;
  let closestDistance = Number.POSITIVE_INFINITY;

  for (const [stationIndex, station] of workstations.entries()) {
    if (usedWorkstations.has(stationIndex)) continue;

    const distance = Math.hypot(
      station.personX - hint.x,
      station.personY - hint.y,
    );
    if (distance < closestDistance) {
      closestDistance = distance;
      pickedStation = station;
      pickedIndex = stationIndex;
    }
  }

  let worldX: number;
  let worldY: number;

  if (pickedStation && pickedIndex >= 0) {
    usedWorkstations.add(pickedIndex);
    worldX = pickedStation.personX;
    worldY = pickedStation.personY;
  } else {
    const zone = ZONE_SCENE[agent.zoneId];
    const offset = AGENT_LAYOUT_OFFSETS[index % AGENT_LAYOUT_OFFSETS.length]!;
    const extraOrbit = Math.floor(index / AGENT_LAYOUT_OFFSETS.length) * 0.42;
    worldX =
      hint.x * 0.72 +
      zone.anchor.x * 0.28 +
      offset.x * (0.36 + extraOrbit * 0.14);
    worldY =
      hint.y * 0.72 +
      zone.anchor.y * 0.28 +
      offset.y * (0.36 + extraOrbit * 0.14);
  }

  const screen = isoToScreen(worldX, worldY);

  return {
    worldX,
    worldY,
    screenX: screen.x,
    screenY: screen.y,
    workstationIndex: pickedIndex >= 0 ? pickedIndex : null,
  };
}

function createAgentLabel(
  agent: OfficeAgent,
  selected: boolean,
  hovered: boolean,
  showExpandedName: boolean,
  laneIndex: number,
) {
  const label = new PIXI.Container();
  const emphasized = selected || hovered;
  const palette = ROLE_LABEL_STYLES[agent.role];
  const roleText = createText(
    roleLabels[agent.role],
    {
      fill: palette.text,
      fontSize: 9,
      fontWeight: "800",
      letterSpacing: 0.3,
    },
    0,
    0.5,
  );
  const nameText = createText(
    compactLabelText(agent.name, showExpandedName ? 16 : 12),
    {
      fill: "#fff8ef",
      fontSize: emphasized ? 12 : 11,
      fontWeight: "700",
    },
    0,
    0.5,
  );
  const roleWidth = Math.max(38, roleText.width + 18);
  const width = Math.max(92, roleWidth + nameText.width + 40);
  const height = 30;

  const shadow = new PIXI.Graphics();
  beginFill(shadow, 0x0f0b09, emphasized ? 0.22 : 0.16);
  drawRoundedRect(shadow, -width / 2 + 2, -height / 2 + 3, width, height, 10);
  endFill(shadow);

  const background = new PIXI.Graphics();
  lineStyle(background, 1.5, palette.fill, selected ? 0.34 : 0.22);
  beginFill(background, 0x1c150f, selected ? 0.97 : hovered ? 0.94 : 0.9);
  drawRoundedRect(background, -width / 2, -height / 2, width, height, 10);
  endFill(background);

  const roleChip = new PIXI.Graphics();
  beginFill(roleChip, palette.fill, 0.98);
  drawRoundedRect(roleChip, -width / 2 + 6, -11, roleWidth, 22, 8);
  endFill(roleChip);

  const divider = new PIXI.Graphics();
  beginFill(divider, 0xffffff, 0.08);
  drawRoundedRect(divider, -width / 2 + roleWidth + 14, -8, 1.5, 16, 1);
  endFill(divider);

  const statusHalo = new PIXI.Graphics();
  beginFill(statusHalo, STATUS_GLOWS[agent.status], selected ? 0.22 : 0.15);
  drawCircle(statusHalo, width / 2 - 12, 0, 7);
  endFill(statusHalo);

  const statusDot = new PIXI.Graphics();
  beginFill(statusDot, STATUS_GLOWS[agent.status], 0.98);
  drawCircle(statusDot, width / 2 - 12, 0, 4);
  endFill(statusDot);

  roleText.position.set(-width / 2 + 15, 0);
  nameText.position.set(-width / 2 + roleWidth + 22, 0);

  label.position.set(0, -54 - (laneIndex % 3) * 9 - (selected ? 6 : 0));
  label.alpha = emphasized ? 1 : 0.92;
  label.addChild(
    shadow,
    background,
    roleChip,
    divider,
    statusHalo,
    statusDot,
    roleText,
    nameText,
  );

  return label;
}

function animateCamera(
  world: PIXI.Container,
  size: { width: number; height: number },
  focused: SceneAgentPosition | null,
  cameraTweenRef: React.MutableRefObject<gsap.core.Tween | null>,
) {
  const pose = getCameraPose(size, focused);

  cameraTweenRef.current?.kill();
  cameraTweenRef.current = gsap.to(world, {
    duration: 0.72,
    x: pose.x,
    y: pose.y,
    ease: "power3.out",
  });

  gsap.to(world.scale, {
    duration: 0.72,
    x: pose.scale,
    y: pose.scale,
    ease: "power3.out",
  });
}

function disposeChildren(container: PIXI.Container) {
  const children = container.removeChildren();
  for (const child of children) {
    child.destroy({ children: true });
  }
}

function drawOfficeScene(
  world: PIXI.Container,
  snapshot: OfficeSnapshot,
  selectedAgentId: string | null,
  hoveredAgentId: string | null,
  onSelectAgent: (agentId: string) => void,
  setHoveredAgentId: (agentId: string | null) => void,
  tweenRegistry: React.MutableRefObject<gsap.core.Tween[]>,
  size: { width: number; height: number },
  cameraTweenRef: React.MutableRefObject<gsap.core.Tween | null>,
  followSelection = true,
) {
  for (const tween of tweenRegistry.current) {
    tween.kill();
  }
  tweenRegistry.current = [];
  disposeChildren(world);
  world.sortableChildren = true;

  const floorLayer = new PIXI.Container();
  const objectLayer = new PIXI.Container();
  objectLayer.sortableChildren = true;
  world.addChild(floorLayer, objectLayer);

  const floor = new PIXI.Graphics();
  const floorA = isoToScreen(0, 0);
  const floorB = isoToScreen(ROOM_WIDTH, 0);
  const floorC = isoToScreen(ROOM_WIDTH, ROOM_HEIGHT);
  const floorD = isoToScreen(0, ROOM_HEIGHT);
  const sceneShadow = new PIXI.Graphics();
  beginFill(sceneShadow, 0x4a3528, 0.12);
  drawEllipse(sceneShadow, 90, 542, 650, 156);
  endFill(sceneShadow);
  floorLayer.addChild(sceneShadow);

  beginFill(floor, 0xf0dfc1);
  drawPolygon(floor, [floorA, floorB, floorC, floorD]);
  endFill(floor);
  lineStyle(floor, 3, 0xc9a77f, 0.38);
  drawPolygon(floor, [floorA, floorB, floorC, floorD]);
  floorLayer.addChild(floor);

  for (let row = 1; row < ROOM_HEIGHT; row += 1) {
    const a = isoToScreen(0, row);
    const b = isoToScreen(ROOM_WIDTH, row);
    const line = new PIXI.Graphics();
    lineStyle(line, 1, 0xe1cfaf, 0.42);
    line.moveTo(a.x, a.y);
    line.lineTo(b.x, b.y);
    strokePath(line);
    floorLayer.addChild(line);
  }

  for (let col = 1; col < ROOM_WIDTH; col += 1) {
    const a = isoToScreen(col, 0);
    const b = isoToScreen(col, ROOM_HEIGHT);
    const line = new PIXI.Graphics();
    lineStyle(line, 1, 0xd8c19d, 0.28);
    line.moveTo(a.x, a.y);
    line.lineTo(b.x, b.y);
    strokePath(line);
    floorLayer.addChild(line);
  }

  const topWall = new PIXI.Graphics();
  beginFill(topWall, 0xb98777);
  drawPolygon(topWall, [
    floorA,
    floorB,
    { x: floorB.x, y: floorB.y - WALL_HEIGHT },
    { x: floorA.x, y: floorA.y - WALL_HEIGHT },
  ]);
  endFill(topWall);
  floorLayer.addChild(topWall);

  const rightWall = new PIXI.Graphics();
  beginFill(rightWall, 0xa56f61);
  drawPolygon(rightWall, [
    floorB,
    floorC,
    { x: floorC.x, y: floorC.y - WALL_HEIGHT },
    { x: floorB.x, y: floorB.y - WALL_HEIGHT },
  ]);
  endFill(rightWall);
  floorLayer.addChild(rightWall);

  const trim = new PIXI.Graphics();
  lineStyle(trim, 10, 0x8f6255, 0.92);
  trim.moveTo(floorA.x, floorA.y - WALL_HEIGHT);
  trim.lineTo(floorB.x, floorB.y - WALL_HEIGHT);
  trim.lineTo(floorC.x, floorC.y - WALL_HEIGHT);
  strokePath(trim);
  floorLayer.addChild(trim);

  addSceneDecor(objectLayer);
  const selectedZoneId =
    snapshot.agents.find((agent) => agent.id === selectedAgentId)?.zoneId ??
    null;

  for (const zone of snapshot.zones) {
    addZoneGround(
      objectLayer,
      zone.id,
      ZONE_SCENE[zone.id].anchor,
      selectedZoneId === zone.id,
    );
    addDeskCluster(
      objectLayer,
      ZONE_SCENE[zone.id],
      zone.id,
      zone.workstationCapacity,
      snapshot.agents.some(
        (agent) => agent.id === selectedAgentId && agent.zoneId === zone.id,
      ),
    );
    addZoneDecor(objectLayer, ZONE_SCENE[zone.id], zone.id);

    const zoneAnchor = isoToScreen(
      ZONE_SCENE[zone.id].anchor.x,
      ZONE_SCENE[zone.id].anchor.y,
    );
    const zonePalette = ZONE_BADGE_STYLES[zone.id];

    const zoneMeta = createText(
      `${zone.activeCount}/${zone.headcount} 人 · ${zone.workstationCapacity}/${zone.workstationMax} 位`,
      {
        fill: zonePalette.meta,
        fontSize: 12,
        fontWeight: "700",
      },
      0.5,
      0.5,
    );
    zoneMeta.position.set(
      zoneAnchor.x,
      zoneAnchor.y + (zone.id === "vendor" ? 84 : 92),
    );
    zoneMeta.alpha = 0.56;
    zoneMeta.zIndex = zoneAnchor.y + 4;

    objectLayer.addChild(zoneMeta);
  }

  const agentsByZone = new Map<ZoneKey, OfficeAgent[]>();
  for (const zone of snapshot.zones) {
    agentsByZone.set(zone.id, []);
  }
  for (const agent of snapshot.agents) {
    const list = agentsByZone.get(agent.zoneId);
    if (list) {
      list.push(agent);
    } else {
      agentsByZone.set(agent.zoneId, [agent]);
    }
  }

  let selectedPosition: SceneAgentPosition | null = null;

  for (const zone of snapshot.zones) {
    const zoneAgents = agentsByZone.get(zone.id) ?? [];
    const workstations = resolveZoneWorkstations(
      ZONE_SCENE[zone.id],
      zone.workstationCapacity,
    );
    const usedWorkstations = new Set<number>();

    zoneAgents.forEach((agent, index) => {
      const position = getAgentWorldPosition(
        agent,
        index,
        workstations,
        usedWorkstations,
      );
      const selected = selectedAgentId === agent.id;
      const hovered = hoveredAgentId === agent.id;
      const showExpandedName =
        selected || hovered || (selectedZoneId === zone.id && index === 0);

      if (selected) {
        selectedPosition = position;
        if (position.workstationIndex !== null) {
          const selectedStation = workstations[position.workstationIndex];
          if (selectedStation) {
            addSelectedWorkstationGlow(objectLayer, selectedStation);
          }
        }
      }

      const wrapper = new PIXI.Container();
      wrapper.position.set(position.screenX, position.screenY);
      wrapper.eventMode = "static";
      wrapper.cursor = "pointer";
      wrapper.zIndex = position.screenY;
      const entity = new PIXI.Container();

      const halo = new PIXI.Graphics();
      beginFill(
        halo,
        STATUS_GLOWS[agent.status],
        selected ? 0.26 : hovered ? 0.18 : 0.1,
      );
      drawEllipse(halo, 0, 8, selected ? 28 : 22, selected ? 14 : 10);
      endFill(halo);

      const shadow = new PIXI.Graphics();
      beginFill(shadow, 0x000000, 0.12);
      drawEllipse(shadow, 0, 7, 13, 6);
      endFill(shadow);

      const body = new PIXI.Graphics();
      beginFill(body, ROLE_COLORS[agent.role]);
      drawRoundedRect(body, -7, -22, 14, 24, 5);
      endFill(body);

      const jacket = new PIXI.Graphics();
      beginFill(
        jacket,
        agent.engine === "hermes-agent" ? 0x1d4f91 : 0x1a1f2d,
        0.92,
      );
      drawRoundedRect(jacket, -6, -17, 12, 13, 4);
      endFill(jacket);

      const head = new PIXI.Graphics();
      beginFill(head, 0xffdfc4);
      drawCircle(head, 0, -27, 7);
      endFill(head);

      const hair = new PIXI.Graphics();
      beginFill(hair, roleHairTint(agent.role));
      drawEllipse(hair, 0, -30, 7, 5);
      endFill(hair);

      const legLeft = new PIXI.Graphics();
      beginFill(legLeft, 0x2e3440);
      drawRoundedRect(legLeft, -5, -1, 3, 10, 2);
      endFill(legLeft);

      const legRight = new PIXI.Graphics();
      beginFill(legRight, 0x2e3440);
      drawRoundedRect(legRight, 2, -1, 3, 10, 2);
      endFill(legRight);

      const shoeLeft = new PIXI.Graphics();
      beginFill(shoeLeft, 0xf6f1e8);
      drawRoundedRect(shoeLeft, -6, 8, 5, 3, 2);
      endFill(shoeLeft);

      const shoeRight = new PIXI.Graphics();
      beginFill(shoeRight, 0xf6f1e8);
      drawRoundedRect(shoeRight, 1, 8, 5, 3, 2);
      endFill(shoeRight);

      const armLeft = new PIXI.Graphics();
      beginFill(armLeft, 0x6d5342, 0.95);
      drawRoundedRect(armLeft, -9, -15, 3, 10, 2);
      endFill(armLeft);

      const armRight = new PIXI.Graphics();
      beginFill(armRight, 0x6d5342, 0.95);
      drawRoundedRect(armRight, 6, -15, 3, 10, 2);
      endFill(armRight);

      const pin = new PIXI.Graphics();
      beginFill(pin, selected ? 0xfff0c2 : STATUS_GLOWS[agent.status]);
      drawCircle(pin, 10, -31, 3);
      endFill(pin);

      const engineChip = new PIXI.Graphics();
      beginFill(
        engineChip,
        agent.engine === "hermes-agent" ? 0x7fb3ff : 0x7ce8d0,
        0.95,
      );
      drawRoundedRect(engineChip, -10, -39, 8, 4, 2);
      endFill(engineChip);

      const statusChip = new PIXI.Graphics();
      beginFill(statusChip, STATUS_GLOWS[agent.status], 0.95);
      drawRoundedRect(statusChip, 3, -39, 8, 4, 2);
      endFill(statusChip);

      const icon = createText(
        agent.name.slice(0, 1),
        {
          fill: "#fff7ea",
          fontSize: 10,
          fontWeight: "800",
        },
        0.5,
        0.5,
      );
      icon.position.set(0, -8);

      entity.addChild(
        halo,
        shadow,
        legLeft,
        legRight,
        shoeLeft,
        shoeRight,
        armLeft,
        armRight,
        body,
        jacket,
        head,
        hair,
        pin,
        engineChip,
        statusChip,
        icon,
      );
      wrapper.addChild(
        entity,
        createAgentLabel(agent, selected, hovered, showExpandedName, index),
      );
      objectLayer.addChild(wrapper);

      const driftX = selected ? 0 : 4 + (index % 3) * 2;
      const driftY = selected ? 0 : 3 + (index % 2) * 1.6;
      const movementTimeline = gsap.timeline({
        repeat: -1,
        defaults: { ease: "sine.inOut" },
      });
      movementTimeline
        .to(wrapper, {
          duration: 1.8 + index * 0.08,
          x: position.screenX + driftX,
          y: position.screenY - driftY,
        })
        .to(wrapper, {
          duration: 1.45 + index * 0.06,
          x: position.screenX - driftX * 0.55,
          y: position.screenY + driftY * 0.4,
        })
        .to(wrapper, {
          duration: 1.2,
          x: position.screenX,
          y: position.screenY,
        });
      tweenRegistry.current.push(
        movementTimeline as unknown as gsap.core.Tween,
      );

      if (selected) {
        tweenRegistry.current.push(
          gsap.to(halo.scale, {
            duration: 1.1,
            x: 1.18,
            y: 1.18,
            repeat: -1,
            yoyo: true,
            ease: "sine.inOut",
          }),
        );
      }

      wrapper.on("pointerover", () => {
        setHoveredAgentId(agent.id);
      });
      wrapper.on("pointerout", () => {
        setHoveredAgentId(null);
      });
      wrapper.on("pointertap", () => {
        onSelectAgent(agent.id);
      });
    });
  }

  if (followSelection) {
    animateCamera(world, size, selectedPosition, cameraTweenRef);
  }
}

export function OfficeBetaShell({ snapshot }: Props) {
  const utils = api.useUtils();
  const { confirm, confirmDialog } = useConfirmDialog();
  const lastVersionRef = useRef<string | null>(null);
  const liveSnapshotRef = useRef(snapshot);
  const canvasHostRef = useRef<HTMLDivElement | null>(null);
  const appRef = useRef<PIXI.Application | null>(null);
  const worldRef = useRef<PIXI.Container | null>(null);
  const tweenRegistryRef = useRef<gsap.core.Tween[]>([]);
  const cameraTweenRef = useRef<gsap.core.Tween | null>(null);
  const followSelectionRef = useRef(true);
  const [streamState, setStreamState] = useState<"live" | "reconnecting">(
    "reconnecting",
  );
  const [canvasSize, setCanvasSize] = useState({ width: 1280, height: 760 });
  const [feedback, setFeedback] = useState<string | null>(null);
  const [isCreateAgentOpen, setIsCreateAgentOpen] = useState(false);
  const [isAddWorkstationOpen, setIsAddWorkstationOpen] = useState(false);
  const [agentDraft, setAgentDraft] = useState<{
    name: string;
    role: AgentRole;
    engine: DockerRunnerEngine;
  }>({
    name: "",
    role: "engineering",
    engine: "openclaw",
  });
  const [workstationZoneId, setWorkstationZoneId] =
    useState<ZoneKey>("engineering");

  const selectedAgentId = useOfficeBetaStore((state) => state.selectedAgentId);
  const hoveredAgentId = useOfficeBetaStore((state) => state.hoveredAgentId);
  const setSelectedAgentId = useOfficeBetaStore(
    (state) => state.setSelectedAgentId,
  );
  const setHoveredAgentId = useOfficeBetaStore(
    (state) => state.setHoveredAgentId,
  );
  const selectedAgentIdRef = useRef<string | null>(null);
  const hoveredAgentIdRef = useRef<string | null>(null);
  const pendingSelectedAgentIdRef = useRef<string | null>(null);
  const setSelectedAgentIdRef = useRef(setSelectedAgentId);
  const setHoveredAgentIdRef = useRef(setHoveredAgentId);

  const snapshotQuery = api.office.getSnapshot.useQuery(undefined, {
    initialData: snapshot,
    refetchOnWindowFocus: false,
    refetchOnReconnect: true,
  });
  const getNativeDashboardUrl = api.office.getNativeDashboardUrl.useMutation();
  const createAgent = api.office.createAgent.useMutation({
    onSuccess: (result) => {
      setFeedback(result.message);
      setIsCreateAgentOpen(false);
      setAgentDraft({
        name: "",
        role: "engineering",
        engine: "openclaw",
      });
      pendingSelectedAgentIdRef.current = result.agentId;
      startTransition(() => {
        setSelectedAgentId(result.agentId);
      });
      void utils.office.getSnapshot.invalidate();
    },
    onError: (error) => {
      setFeedback(error.message);
    },
  });
  const addWorkstation = api.office.addWorkstation.useMutation({
    onSuccess: (result) => {
      setFeedback(result.message);
      setIsAddWorkstationOpen(false);
      void utils.office.getSnapshot.invalidate();
    },
    onError: (error) => {
      setFeedback(error.message);
    },
  });
  const deleteAgent = api.office.deleteAgent.useMutation({
    onSuccess: (result) => {
      setFeedback(result.message);
      startTransition(() => {
        if (selectedAgentIdRef.current === result.agentId) {
          setSelectedAgentId(null);
        }
      });
      void utils.office.getSnapshot.invalidate();
    },
    onError: (error) => {
      setFeedback(error.message);
    },
  });
  const liveSnapshot = snapshotQuery.data ?? snapshot;

  liveSnapshotRef.current = liveSnapshot;
  selectedAgentIdRef.current = selectedAgentId;
  hoveredAgentIdRef.current = hoveredAgentId;
  setSelectedAgentIdRef.current = setSelectedAgentId;
  setHoveredAgentIdRef.current = setHoveredAgentId;
  const selectedAgent =
    liveSnapshot.agents.find((agent) => agent.id === selectedAgentId) ?? null;

  useEffect(() => {
    followSelectionRef.current = true;
    pendingSelectedAgentIdRef.current = null;
    selectedAgentIdRef.current = null;
    hoveredAgentIdRef.current = null;
    setHoveredAgentId(null);
    setSelectedAgentId(null);
  }, [setHoveredAgentId, setSelectedAgentId]);

  useEffect(() => {
    if (!selectedAgentId) {
      return;
    }

    if (liveSnapshot.agents.some((agent) => agent.id === selectedAgentId)) {
      if (pendingSelectedAgentIdRef.current === selectedAgentId) {
        pendingSelectedAgentIdRef.current = null;
      }
      return;
    }

    if (pendingSelectedAgentIdRef.current === selectedAgentId) {
      return;
    }

    setSelectedAgentId(null);
  }, [liveSnapshot.agents, selectedAgentId, setSelectedAgentId]);

  useEffect(() => {
    if (!feedback) return;

    const timeout = window.setTimeout(() => setFeedback(null), 3200);
    return () => window.clearTimeout(timeout);
  }, [feedback]);

  useEffect(() => {
    if (liveSnapshot.zones.some((zone) => zone.id === workstationZoneId)) {
      return;
    }

    setWorkstationZoneId(
      selectedAgent?.zoneId ?? liveSnapshot.zones[0]?.id ?? "engineering",
    );
  }, [liveSnapshot.zones, selectedAgent, workstationZoneId]);

  useEffect(() => {
    const host = canvasHostRef.current;
    if (!host) return;

    const observer = new ResizeObserver((entries) => {
      const entry = entries[0];
      if (!entry) return;
      setCanvasSize({
        width: Math.max(320, Math.round(entry.contentRect.width)),
        height: Math.max(380, Math.round(entry.contentRect.height)),
      });
    });

    observer.observe(host);
    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    const host = canvasHostRef.current;
    if (!host) return;

    let destroyed = false;
    let app: PIXI.Application | null = null;

    const setup = async () => {
      const resolution = getCanvasResolution();
      app = new PIXI.Application();
      await app.init({
        antialias: true,
        autoDensity: true,
        backgroundAlpha: 0,
        resolution,
        resizeTo: host,
      });

      if (destroyed) {
        app.destroy(true);
        return;
      }

      appRef.current = app;
      host.replaceChildren(app.canvas);

      const world = new PIXI.Container();
      const initialCanvasSize = {
        width: Math.max(320, Math.round(host.clientWidth)),
        height: Math.max(380, Math.round(host.clientHeight)),
      };
      const initialPose = getCameraPose(initialCanvasSize, null);
      world.position.set(initialPose.x, initialPose.y);
      world.scale.set(initialPose.scale);
      app.stage.addChild(world);
      worldRef.current = world;

      drawOfficeScene(
        world,
        liveSnapshotRef.current,
        selectedAgentIdRef.current,
        hoveredAgentIdRef.current,
        (agentId) => {
          followSelectionRef.current = true;
          setSelectedAgentIdRef.current(agentId);
        },
        setHoveredAgentIdRef.current,
        tweenRegistryRef,
        initialCanvasSize,
        cameraTweenRef,
        followSelectionRef.current,
      );

      const dragState = {
        active: false,
        moved: false,
        startX: 0,
        startY: 0,
        originX: 0,
        originY: 0,
      };

      const onPointerDown = (event: PointerEvent) => {
        dragState.active = true;
        dragState.moved = false;
        dragState.startX = event.clientX;
        dragState.startY = event.clientY;
        dragState.originX = world.x;
        dragState.originY = world.y;
      };

      const onPointerMove = (event: PointerEvent) => {
        if (!dragState.active) return;

        const dx = event.clientX - dragState.startX;
        const dy = event.clientY - dragState.startY;
        if (!dragState.moved && Math.hypot(dx, dy) > 6) {
          dragState.moved = true;
          followSelectionRef.current = false;
        }

        if (!dragState.moved) return;
        world.position.set(dragState.originX + dx, dragState.originY + dy);
      };

      const stopDrag = () => {
        dragState.active = false;
      };

      const onWheel = (event: WheelEvent) => {
        event.preventDefault();
        followSelectionRef.current = false;
        cameraTweenRef.current?.kill();

        const rect = host.getBoundingClientRect();
        const pointerX = event.clientX - rect.left;
        const pointerY = event.clientY - rect.top;
        const currentScale = world.scale.x;
        const nextScale = clamp(
          currentScale * (event.deltaY < 0 ? 1.08 : 0.92),
          MIN_CAMERA_SCALE,
          MAX_CAMERA_SCALE,
        );
        const worldPointX = (pointerX - world.x) / currentScale;
        const worldPointY = (pointerY - world.y) / currentScale;

        world.scale.set(nextScale);
        world.position.set(
          pointerX - worldPointX * nextScale,
          pointerY - worldPointY * nextScale,
        );
      };

      host.addEventListener("pointerdown", onPointerDown);
      host.addEventListener("pointermove", onPointerMove);
      window.addEventListener("pointerup", stopDrag);
      host.addEventListener("wheel", onWheel, { passive: false });

      gsap.fromTo(
        world,
        { alpha: 0, y: world.y + 26 },
        { alpha: 1, y: world.y, duration: 0.9, ease: "power3.out" },
      );

      return () => {
        host.removeEventListener("pointerdown", onPointerDown);
        host.removeEventListener("pointermove", onPointerMove);
        window.removeEventListener("pointerup", stopDrag);
        host.removeEventListener("wheel", onWheel);
      };
    };

    let cleanupInteraction: (() => void) | undefined;
    void setup().then((cleanup) => {
      cleanupInteraction = cleanup ?? undefined;
    });

    return () => {
      const registeredTweens = tweenRegistryRef.current;
      const activeApp = appRef.current;

      destroyed = true;
      cleanupInteraction?.();
      for (const tween of registeredTweens) {
        tween.kill();
      }
      tweenRegistryRef.current = [];
      if (activeApp) {
        activeApp.destroy(true);
      }
      appRef.current = null;
      worldRef.current = null;
      if (host) {
        host.replaceChildren();
      }
    };
  }, []);

  useEffect(() => {
    const world = worldRef.current;
    if (!world || !appRef.current) return;

    drawOfficeScene(
      world,
      liveSnapshot,
      selectedAgentId,
      hoveredAgentId,
      (agentId) => {
        followSelectionRef.current = true;
        setSelectedAgentId(agentId);
      },
      setHoveredAgentId,
      tweenRegistryRef,
      canvasSize,
      cameraTweenRef,
      followSelectionRef.current,
    );
  }, [
    canvasSize,
    hoveredAgentId,
    liveSnapshot,
    selectedAgentId,
    setHoveredAgentId,
    setSelectedAgentId,
  ]);

  useEffect(() => {
    if (typeof window === "undefined") return;

    const eventSource = new EventSource("/api/office/stream");

    const handleSnapshot = (event: MessageEvent<string>) => {
      try {
        const payload = JSON.parse(event.data) as { version?: string };
        if (payload.version && payload.version !== lastVersionRef.current) {
          lastVersionRef.current = payload.version;
          setStreamState("live");
          void utils.office.getSnapshot.invalidate();
        }
      } catch {
        setStreamState("reconnecting");
      }
    };

    const handleHeartbeat = (event: MessageEvent<string>) => {
      try {
        const payload = JSON.parse(event.data) as { version?: string };
        if (payload.version) lastVersionRef.current = payload.version;
        setStreamState("live");
      } catch {
        setStreamState("reconnecting");
      }
    };

    eventSource.addEventListener("snapshot", handleSnapshot as EventListener);
    eventSource.addEventListener("heartbeat", handleHeartbeat as EventListener);
    eventSource.onerror = () => setStreamState("reconnecting");

    return () => eventSource.close();
  }, [utils.office.getSnapshot]);

  const selectedDevice = selectedAgent
    ? (liveSnapshot.devices.find(
        (device) => device.id === selectedAgent.deviceId,
      ) ?? null)
    : null;
  const selectedTask = selectedAgent
    ? (liveSnapshot.tasks.find(
        (task) => task.id === selectedAgent.currentTaskId,
      ) ??
      liveSnapshot.tasks.find(
        (task) => task.ownerAgentId === selectedAgent.id,
      ) ??
      null)
    : null;
  const selectedWorkstationZone =
    liveSnapshot.zones.find((zone) => zone.id === workstationZoneId) ?? null;
  const trimmedAgentName = agentDraft.name.trim();

  const handleCreateAgent = async () => {
    if (liveSnapshot.readOnlyReason) {
      setFeedback(`当前数据源处于回退模式：${liveSnapshot.readOnlyReason}`);
      return;
    }

    if (trimmedAgentName.length < 2) {
      setFeedback("人物名称至少需要 2 个字符。");
      return;
    }

    await createAgent.mutateAsync({
      name: trimmedAgentName,
      role: agentDraft.role,
      engine: agentDraft.engine,
    });
  };

  const handleAddWorkstation = async () => {
    if (liveSnapshot.readOnlyReason) {
      setFeedback(`当前数据源处于回退模式：${liveSnapshot.readOnlyReason}`);
      return;
    }

    await addWorkstation.mutateAsync({
      zoneId: workstationZoneId,
    });
  };

  const handleDeleteAgent = async () => {
    if (!selectedAgent) return;

    if (liveSnapshot.readOnlyReason) {
      setFeedback(`当前数据源处于回退模式：${liveSnapshot.readOnlyReason}`);
      return;
    }

    const confirmed = await confirm({
      title: `确认删除人物 ${selectedAgent.name}？`,
      description: "这会同时清理关联的 runner 资源，且不能自动恢复。",
      confirmLabel: "删除人物",
    });
    if (!confirmed) return;

    await deleteAgent.mutateAsync({
      agentId: selectedAgent.id,
    });
  };

  const openNativePage = async () => {
    if (!selectedAgent || typeof window === "undefined") return;

    const openedWindow = window.open("about:blank", "_blank");
    if (!openedWindow) {
      setFeedback("浏览器阻止了新窗口，请允许弹窗后重试。");
      return;
    }
    openedWindow.opener = null;

    let nativeUrl = selectedDevice?.nativeDashboardUrl ?? null;

    try {
      const refreshed = await getNativeDashboardUrl.mutateAsync({
        agentId: selectedAgent.id,
      });
      nativeUrl = refreshed.url ?? nativeUrl;
    } catch {
      nativeUrl = nativeUrl ?? null;
    }

    if (!nativeUrl) {
      openedWindow.close();
      setFeedback("当前人物的原生页面地址未配置。");
      return;
    }

    openedWindow.location.replace(nativeUrl);
  };

  const zoomCanvas = (factor: number) => {
    const world = worldRef.current;
    const host = canvasHostRef.current;
    if (!world || !host) return;

    followSelectionRef.current = false;
    cameraTweenRef.current?.kill();

    const pointerX = host.clientWidth / 2;
    const pointerY = host.clientHeight / 2;
    const currentScale = world.scale.x;
    const nextScale = clamp(
      currentScale * factor,
      MIN_CAMERA_SCALE,
      MAX_CAMERA_SCALE,
    );
    const worldPointX = (pointerX - world.x) / currentScale;
    const worldPointY = (pointerY - world.y) / currentScale;

    world.scale.set(nextScale);
    world.position.set(
      pointerX - worldPointX * nextScale,
      pointerY - worldPointY * nextScale,
    );
  };

  const resetCanvasCamera = () => {
    const world = worldRef.current;
    if (!world) return;

    followSelectionRef.current = false;
    const pose = getCameraPose(canvasSize, null);
    cameraTweenRef.current?.kill();
    cameraTweenRef.current = gsap.to(world, {
      duration: 0.45,
      x: pose.x,
      y: pose.y,
      ease: "power3.out",
    });
    gsap.to(world.scale, {
      duration: 0.45,
      x: pose.scale,
      y: pose.scale,
      ease: "power3.out",
    });
  };

  const SelectedRoleIcon = selectedAgent
    ? ROLE_ICONS[selectedAgent.role]
    : null;
  const hasAgents = liveSnapshot.agents.length > 0;
  const activeHeadcount = liveSnapshot.zones.reduce(
    (total, zone) => total + zone.activeCount,
    0,
  );
  const workstationCapacity = liveSnapshot.zones.reduce(
    (total, zone) => total + zone.workstationCapacity,
    0,
  );
  const workstationMax = liveSnapshot.zones.reduce(
    (total, zone) => total + zone.workstationMax,
    0,
  );
  const activeTaskCount = liveSnapshot.tasks.filter(
    (task) =>
      task.status !== "completed" &&
      task.status !== "failed" &&
      task.status !== "canceled",
  ).length;
  const liveDeviceCount = liveSnapshot.devices.filter(
    (device) => device.status === "online" || device.status === "busy",
  ).length;
  const snapshotTime = new Date(liveSnapshot.generatedAt).toLocaleString(
    "zh-CN",
    {
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
    },
  );
  const officeStats = [
    {
      label: "人物",
      value: `${liveSnapshot.agents.length}`,
      detail: `${activeHeadcount} 活跃`,
    },
    {
      label: "工位",
      value: `${workstationCapacity}/${workstationMax}`,
      detail: "已启用",
    },
    {
      label: "任务",
      value: `${activeTaskCount}`,
      detail: "进行中",
    },
    {
      label: "设备",
      value: `${liveDeviceCount}/${liveSnapshot.devices.length}`,
      detail: "可用",
    },
  ];

  return (
    <AdminChrome>
      <div className="flex min-h-full flex-col gap-4 xl:h-full xl:min-h-0">
        <div className="relative flex min-h-0 flex-1 flex-col overflow-hidden rounded-[26px] border border-white/80 bg-[linear-gradient(180deg,rgba(248,251,249,0.94)_0%,rgba(235,244,241,0.88)_100%)] px-4 py-4 shadow-[0_28px_80px_rgba(15,23,42,0.1)] backdrop-blur-xl md:px-5 md:py-5">
          <div className="pointer-events-none absolute inset-0 bg-[linear-gradient(120deg,rgba(32,86,75,0.05),transparent_34%,rgba(166,94,32,0.06))]" />

          <div className="relative grid shrink-0 gap-4 xl:grid-cols-[minmax(0,1fr)_auto] xl:items-start">
            <div className="min-w-0">
              <p className="text-[10px] font-semibold tracking-[0.26em] text-[#5e7b70] uppercase">
                2D live view
              </p>
              <div className="mt-2 flex flex-wrap items-end gap-x-3 gap-y-2">
                <h1 className="text-4xl leading-none font-semibold text-[#1e1712] md:text-5xl">
                  虚拟 Office
                </h1>
                <Badge className="mb-1 border border-[#b9d7c8] bg-[#eef8f2] px-2.5 py-1 text-[#28634d]">
                  {liveSnapshot.mode === "database" ? "Database" : "Fallback"}
                </Badge>
              </div>
              <p className="mt-3 max-w-2xl text-sm leading-6 text-[#60706b]">
                实时呈现办公室座席、人物、Runner 和任务流转状态。
              </p>
            </div>

            <div className="flex flex-col gap-3 xl:items-end">
              <div className="flex flex-wrap items-center gap-2 xl:justify-end">
                <Badge
                  className={cn(
                    "gap-2 border px-3 py-1.5",
                    streamState === "live"
                      ? "border-[#b9dfc4] bg-[#eef8f0] text-[#21643b]"
                      : "border-[#ead09f] bg-[#fff5df] text-[#8b5b10]",
                  )}
                >
                  <span
                    className={cn(
                      "size-2 rounded-full",
                      streamState === "live" ? "bg-[#2a9d58]" : "bg-[#c68621]",
                    )}
                  />
                  {streamState === "live" ? "实时同步中" : "正在重连"}
                </Badge>
                <Button
                  variant="outline"
                  className="h-10 rounded-full border-[#cbbf9f] bg-white/84 px-4 text-sm font-medium text-[#24342f] shadow-[0_10px_24px_rgba(56,72,68,0.08)] hover:bg-white"
                  disabled={Boolean(liveSnapshot.readOnlyReason)}
                  onClick={() => {
                    setWorkstationZoneId(
                      selectedAgent?.zoneId ??
                        liveSnapshot.zones[0]?.id ??
                        "engineering",
                    );
                    setIsAddWorkstationOpen(true);
                  }}
                >
                  <PlusIcon data-icon="inline-start" />
                  添加工位
                </Button>
                <Button
                  className="h-10 rounded-full border border-[#9d6a2d] bg-[#92521a] px-4 text-sm font-medium text-[#fffaf0] shadow-[0_14px_28px_rgba(146,82,26,0.22)] hover:bg-[#7e4513]"
                  disabled={Boolean(liveSnapshot.readOnlyReason)}
                  onClick={() => {
                    setIsCreateAgentOpen(true);
                  }}
                >
                  <UserRoundPlusIcon data-icon="inline-start" />
                  添加人物
                </Button>
              </div>
            </div>
          </div>

          <div className="relative mt-4 grid shrink-0 grid-cols-2 gap-2 xl:grid-cols-4">
            {officeStats.map((stat) => (
              <div
                key={stat.label}
                className="flex min-h-14 flex-col items-start justify-between gap-2 rounded-[14px] border border-white/70 bg-white/64 px-3 py-3 shadow-[0_12px_30px_rgba(51,65,85,0.06)] sm:min-h-16 sm:flex-row sm:items-center sm:px-4"
              >
                <div>
                  <p className="text-xs font-medium text-[#66736f]">
                    {stat.label}
                  </p>
                  <p className="mt-1 text-xl leading-none font-semibold text-[#1f2724] md:text-2xl">
                    {stat.value}
                  </p>
                </div>
                <span className="rounded-full bg-[#edf5f1] px-2.5 py-1 text-[11px] font-medium text-[#497566] sm:text-xs">
                  {stat.detail}
                </span>
              </div>
            ))}
          </div>

          <div className="relative mt-4 flex min-h-[520px] flex-1 overflow-hidden rounded-[22px] border border-white/80 bg-[#a98a62] shadow-[inset_0_1px_0_rgba(255,255,255,0.34),0_24px_60px_rgba(62,68,59,0.14)] xl:min-h-0">
            <div
              ref={canvasHostRef}
              className="relative h-full min-h-[520px] w-full bg-[linear-gradient(135deg,#dfe9e4_0%,#c9c0a1_42%,#9b7650_100%)] xl:min-h-0"
            />

            <div className="pointer-events-none absolute inset-0 bg-[linear-gradient(180deg,rgba(255,255,255,0.34),transparent_22%,rgba(74,53,40,0.12)_100%)]" />
            <div className="pointer-events-none absolute inset-x-0 top-0 h-24 bg-[linear-gradient(180deg,rgba(244,249,247,0.46),transparent)]" />

            <div className="absolute top-4 left-4 rounded-[16px] border border-white/76 bg-white/86 px-4 py-3 shadow-[0_18px_36px_rgba(42,53,47,0.14)] backdrop-blur-md">
              <p className="text-[11px] font-semibold tracking-[0.18em] text-[#60756d] uppercase">
                最新快照
              </p>
              <p className="mt-1 text-lg leading-none font-semibold text-[#1f1711]">
                {snapshotTime}
              </p>
            </div>

            <div className="absolute top-4 right-4 flex flex-col items-end gap-2">
              <div className="hidden rounded-[16px] border border-white/70 bg-[#17221f]/82 px-4 py-3 text-white shadow-[0_18px_42px_rgba(15,23,42,0.16)] backdrop-blur-md md:block">
                <p className="text-[11px] font-semibold tracking-[0.18em] text-white/58 uppercase">
                  空间容量
                </p>
                <p className="mt-1 text-lg leading-none font-semibold">
                  {workstationCapacity}/{workstationMax} 工位
                </p>
              </div>

              <div className="flex rounded-full border border-white/72 bg-white/88 p-1 shadow-[0_16px_34px_rgba(42,53,47,0.14)] backdrop-blur-md">
                <Button
                  type="button"
                  variant="ghost"
                  size="icon-sm"
                  className="rounded-full text-[#34443f] hover:bg-[#eaf3ee]"
                  aria-label="缩小办公室视图"
                  title="缩小"
                  onClick={() => zoomCanvas(0.88)}
                >
                  <ZoomOutIcon />
                </Button>
                <Button
                  type="button"
                  variant="ghost"
                  size="icon-sm"
                  className="rounded-full text-[#34443f] hover:bg-[#eaf3ee]"
                  aria-label="适配办公室视图"
                  title="适配视图"
                  onClick={resetCanvasCamera}
                >
                  <RotateCcwIcon />
                </Button>
                <Button
                  type="button"
                  variant="ghost"
                  size="icon-sm"
                  className="rounded-full text-[#34443f] hover:bg-[#eaf3ee]"
                  aria-label="放大办公室视图"
                  title="放大"
                  onClick={() => zoomCanvas(1.14)}
                >
                  <ZoomInIcon />
                </Button>
              </div>
            </div>

            {selectedAgent ? (
              <div className="absolute bottom-4 left-4 w-[min(calc(100%_-_2rem),360px)] rounded-[20px] border border-white/76 bg-[#fffaf4]/92 p-4 shadow-[0_24px_60px_rgba(35,34,28,0.18)] backdrop-blur-md md:p-5">
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <p className="text-2xl font-semibold text-[#24170d]">
                      {selectedAgent.name}
                    </p>
                    <div className="mt-1 flex items-center gap-2 text-sm text-[#6d5544]">
                      {SelectedRoleIcon ? (
                        <SelectedRoleIcon className="size-4" />
                      ) : null}
                      <span>{roleLabels[selectedAgent.role]}</span>
                      <span className="text-[#b99b7c]">/</span>
                      <span>
                        {
                          k8sWorkspaceEngineLabels[
                            selectedAgent.engine ?? "openclaw"
                          ]
                        }
                      </span>
                    </div>
                  </div>

                  <span
                    className={cn(
                      "rounded-full px-2.5 py-1 text-[11px] font-semibold",
                      buildStatusPill(selectedAgent.status),
                    )}
                  >
                    {agentStatusLabels[selectedAgent.status]}
                  </span>
                </div>

                <div className="mt-4 grid grid-cols-2 gap-x-4 gap-y-3 text-sm">
                  <div>
                    <p className="text-[11px] font-semibold tracking-[0.16em] text-[#7f8f87] uppercase">
                      当前任务
                    </p>
                    <p className="mt-1 font-medium text-[#24170d]">
                      {selectedTask?.title ?? "空闲"}
                    </p>
                  </div>
                  <div>
                    <p className="text-[11px] font-semibold tracking-[0.16em] text-[#7f8f87] uppercase">
                      设备状态
                    </p>
                    <p className="mt-1 font-medium text-[#24170d]">
                      {selectedDevice?.status ?? "未绑定"}
                    </p>
                  </div>
                  <div>
                    <p className="text-[11px] font-semibold tracking-[0.16em] text-[#7f8f87] uppercase">
                      引擎
                    </p>
                    <p className="mt-1 font-medium text-[#24170d]">
                      {
                        k8sWorkspaceEngineLabels[
                          selectedAgent.engine ?? "openclaw"
                        ]
                      }
                    </p>
                  </div>
                  <div>
                    <p className="text-[11px] font-semibold tracking-[0.16em] text-[#7f8f87] uppercase">
                      负载
                    </p>
                    <p className="mt-1 font-medium text-[#24170d]">
                      {selectedAgent.energy}%
                    </p>
                  </div>
                </div>

                <p className="mt-4 text-sm leading-6 text-[#6d5544]">
                  {selectedAgent.focus}
                </p>

                <div className="mt-4 flex gap-2">
                  <Button
                    className="flex-1 rounded-full bg-[#e7f1eb] text-[#1f5c46] hover:bg-[#dcebe3]"
                    onClick={() => void openNativePage()}
                  >
                    <ExternalLinkIcon />
                    进入原生页面
                  </Button>
                  <Button
                    variant="outline"
                    className="rounded-full border-rose-200 bg-white/80 text-rose-700 hover:bg-rose-50 hover:text-rose-800"
                    disabled={deleteAgent.isPending}
                    onClick={() => void handleDeleteAgent()}
                  >
                    {deleteAgent.isPending ? (
                      <LoaderCircleIcon className="animate-spin" />
                    ) : (
                      <Trash2Icon />
                    )}
                    删除
                  </Button>
                </div>
              </div>
            ) : hasAgents ? (
              <div className="absolute bottom-4 left-4 rounded-[18px] border border-white/68 bg-white/88 px-4 py-3 text-sm font-medium text-[#3f564e] shadow-[0_18px_38px_rgba(42,53,47,0.12)] backdrop-blur-md">
                当前 {liveSnapshot.agents.length} 位人物在线 · {activeTaskCount}{" "}
                个任务进行中
              </div>
            ) : (
              <div className="absolute bottom-4 left-4 flex max-w-[min(calc(100%_-_2rem),460px)] flex-col gap-3 rounded-[20px] border border-white/70 bg-white/90 p-4 text-sm text-[#40554f] shadow-[0_18px_38px_rgba(42,53,47,0.12)] backdrop-blur-md sm:flex-row sm:items-center sm:justify-between">
                <span className="font-medium">
                  当前还没有人物，办公室处于待编排状态。
                </span>
                <Button
                  size="sm"
                  className="rounded-full bg-[#92521a] text-[#fffaf0] hover:bg-[#7e4513]"
                  disabled={Boolean(liveSnapshot.readOnlyReason)}
                  onClick={() => setIsCreateAgentOpen(true)}
                >
                  <UserRoundPlusIcon data-icon="inline-start" />
                  添加人物
                </Button>
              </div>
            )}
          </div>

          {feedback ? (
            <div className="mt-3 rounded-[20px] border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-950">
              {feedback}
            </div>
          ) : null}

          {liveSnapshot.readOnlyReason ? (
            <div className="mt-3 rounded-[20px] border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-900">
              当前数据源处于回退模式：{liveSnapshot.readOnlyReason}
            </div>
          ) : null}

          <Dialog
            open={isAddWorkstationOpen}
            onOpenChange={setIsAddWorkstationOpen}
          >
            <DialogContent className="border-[#dcc3a2] bg-[#fffaf2] sm:max-w-lg">
              <DialogHeader>
                <DialogTitle>添加工位</DialogTitle>
                <DialogDescription>
                  工位会按当前分区的预设座标逐步启用，新增后办公室场景会立即扩容。
                </DialogDescription>
              </DialogHeader>

              <div className="grid gap-4">
                <FormField label="分区">
                  <Select
                    value={workstationZoneId}
                    onValueChange={(value) => {
                      if (value && isZoneKey(value)) {
                        setWorkstationZoneId(value);
                      }
                    }}
                  >
                    <SelectTrigger className="w-full bg-white">
                      <SelectValue placeholder="选择分区">
                        {() => selectedWorkstationZone?.label ?? "选择分区"}
                      </SelectValue>
                    </SelectTrigger>
                    <SelectContent>
                      <SelectGroup>
                        {liveSnapshot.zones.map((zone) => (
                          <SelectItem key={zone.id} value={zone.id}>
                            {zone.label}
                          </SelectItem>
                        ))}
                      </SelectGroup>
                    </SelectContent>
                  </Select>
                </FormField>

                {selectedWorkstationZone ? (
                  <div className="rounded-[22px] border border-[#ead8c1] bg-white/88 px-4 py-3">
                    <p className="text-sm font-medium text-[#24170d]">
                      {selectedWorkstationZone.label}
                    </p>
                    <p className="mt-1 text-sm text-[#6d5544]">
                      当前已启用 {selectedWorkstationZone.workstationCapacity} /{" "}
                      {selectedWorkstationZone.workstationMax} 个工位。
                    </p>
                    <p className="mt-2 text-xs leading-5 text-[#8b735f]">
                      {selectedWorkstationZone.workstationCapacity >=
                      selectedWorkstationZone.workstationMax
                        ? "该分区的预设工位已经全部启用。"
                        : `还能继续扩容 ${
                            selectedWorkstationZone.workstationMax -
                            selectedWorkstationZone.workstationCapacity
                          } 个工位。`}
                    </p>
                  </div>
                ) : null}
              </div>

              <DialogFooter className="bg-[#fbf2e4]">
                <Button
                  variant="outline"
                  onClick={() => setIsAddWorkstationOpen(false)}
                >
                  取消
                </Button>
                <Button
                  className="border border-[#c9964c] bg-[#a75b16] text-[#fff8ef] hover:bg-[#8f4d12]"
                  disabled={
                    addWorkstation.isPending ||
                    !selectedWorkstationZone ||
                    selectedWorkstationZone.workstationCapacity >=
                      selectedWorkstationZone.workstationMax ||
                    Boolean(liveSnapshot.readOnlyReason)
                  }
                  onClick={() => void handleAddWorkstation()}
                >
                  {addWorkstation.isPending ? (
                    <LoaderCircleIcon
                      className="animate-spin"
                      data-icon="inline-start"
                    />
                  ) : (
                    <PlusIcon data-icon="inline-start" />
                  )}
                  {selectedWorkstationZone &&
                  selectedWorkstationZone.workstationCapacity >=
                    selectedWorkstationZone.workstationMax
                    ? "已到上限"
                    : "新增工位"}
                </Button>
              </DialogFooter>
            </DialogContent>
          </Dialog>

          <Dialog open={isCreateAgentOpen} onOpenChange={setIsCreateAgentOpen}>
            <DialogContent className="border-[#dcc3a2] bg-[#fffaf2] sm:max-w-lg">
              <DialogHeader>
                <DialogTitle>添加人物</DialogTitle>
                <DialogDescription>
                  创建人物会立即落库并触发对应 Runner
                  拉起流程，成功后场景会自动选中它。
                </DialogDescription>
              </DialogHeader>

              <div className="grid gap-4">
                <FormField label="人物名称">
                  <Input
                    className="bg-white"
                    value={agentDraft.name}
                    onChange={(event) =>
                      setAgentDraft((current) => ({
                        ...current,
                        name: event.target.value,
                      }))
                    }
                    placeholder="例如：Luna、Mika、采购官 Zero"
                  />
                </FormField>

                <FormField label="角色">
                  <Select
                    value={agentDraft.role}
                    onValueChange={(value) => {
                      if (!value || !isAgentRole(value)) return;

                      setAgentDraft((current) => ({
                        ...current,
                        role: value,
                      }));
                    }}
                  >
                    <SelectTrigger className="w-full bg-white">
                      <SelectValue placeholder="选择角色">
                        {optionLabel(roleLabels, "选择角色")}
                      </SelectValue>
                    </SelectTrigger>
                    <SelectContent>
                      <SelectGroup>
                        {agentRoleValues.map((role) => (
                          <SelectItem key={role} value={role}>
                            {roleLabels[role]}
                          </SelectItem>
                        ))}
                      </SelectGroup>
                    </SelectContent>
                  </Select>
                </FormField>

                <FormField label="执行引擎">
                  <Select
                    value={agentDraft.engine}
                    onValueChange={(value) => {
                      if (!value || !isDockerRunnerEngine(value)) return;

                      setAgentDraft((current) => ({
                        ...current,
                        engine: value,
                      }));
                    }}
                  >
                    <SelectTrigger className="w-full bg-white">
                      <SelectValue placeholder="选择执行引擎">
                        {optionLabel(k8sWorkspaceEngineLabels, "选择执行引擎")}
                      </SelectValue>
                    </SelectTrigger>
                    <SelectContent>
                      <SelectGroup>
                        {dockerRunnerEngineValues.map((engine) => (
                          <SelectItem key={engine} value={engine}>
                            {k8sWorkspaceEngineLabels[engine]}
                          </SelectItem>
                        ))}
                      </SelectGroup>
                    </SelectContent>
                  </Select>
                </FormField>

                <div className="rounded-[22px] border border-[#ead8c1] bg-white/88 px-4 py-3">
                  <p className="text-sm font-medium text-[#24170d]">
                    {roleLabels[agentDraft.role]}
                  </p>
                  <p className="mt-1 text-sm leading-6 text-[#6d5544]">
                    {ROLE_HINTS[agentDraft.role]}
                  </p>
                  <p className="mt-2 text-xs leading-5 text-[#8b735f]">
                    默认会绑定 {k8sWorkspaceEngineLabels[agentDraft.engine]}{" "}
                    工作区，并按角色进入
                    {zoneLabels[zoneForRole(agentDraft.role)]}。
                  </p>
                </div>
              </div>

              <DialogFooter className="bg-[#fbf2e4]">
                <Button
                  variant="outline"
                  onClick={() => setIsCreateAgentOpen(false)}
                >
                  取消
                </Button>
                <Button
                  className="border border-[#c9964c] bg-[#a75b16] text-[#fff8ef] hover:bg-[#8f4d12]"
                  disabled={
                    createAgent.isPending ||
                    trimmedAgentName.length < 2 ||
                    Boolean(liveSnapshot.readOnlyReason)
                  }
                  onClick={() => void handleCreateAgent()}
                >
                  {createAgent.isPending ? (
                    <LoaderCircleIcon
                      className="animate-spin"
                      data-icon="inline-start"
                    />
                  ) : (
                    <UserRoundPlusIcon data-icon="inline-start" />
                  )}
                  {createAgent.isPending ? "正在创建人物" : "创建人物"}
                </Button>
              </DialogFooter>
            </DialogContent>
          </Dialog>
          {confirmDialog}
        </div>
      </div>
    </AdminChrome>
  );
}
