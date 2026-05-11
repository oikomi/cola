import { LockKeyholeIcon, ShieldCheckIcon, UserCogIcon } from "lucide-react";

import { PermissionManagementPanel } from "@/app/_components/permission-management-panel";
import {
  ModuleHero,
  ModuleMetricCard,
  ModulePageShell,
  ModuleSection,
} from "@/app/_components/module-shell";
import { Badge } from "@/components/ui/badge";

export default function PermissionsPage() {
  return (
    <ModulePageShell>
      <ModuleHero
        eyebrow="Access Control"
        title="权限管理"
        description="管理飞书登录用户的角色和账号状态。管理员负责授权；操作员负责创建和删除资源；只读用户只能查看系统状态。"
        icon={UserCogIcon}
        badges={
          <>
            <Badge className="border border-sky-200 bg-sky-50 text-sky-700">
              用户授权
            </Badge>
            <Badge className="border border-emerald-200 bg-emerald-50 text-emerald-700">
              角色分级
            </Badge>
          </>
        }
        size="compact"
      >
        <div className="grid gap-3 md:grid-cols-3">
          <ModuleMetricCard
            size="compact"
            label="Admin"
            value="管理员"
            description="可管理用户权限，也具备操作员能力。"
            icon={ShieldCheckIcon}
          />
          <ModuleMetricCard
            size="compact"
            label="Operator"
            value="操作员"
            description="可创建、删除、发布和启动运行资源。"
            icon={UserCogIcon}
          />
          <ModuleMetricCard
            size="compact"
            label="Viewer"
            value="只读用户"
            description="只能查看控制台，不允许写入资源。"
            icon={LockKeyholeIcon}
          />
        </div>
      </ModuleHero>

      <ModuleSection
        title="用户与角色"
        description="权限修改会立即写入数据库；禁用用户会撤销该用户已有登录会话。"
        density="compact"
      >
        <PermissionManagementPanel />
      </ModuleSection>
    </ModulePageShell>
  );
}
