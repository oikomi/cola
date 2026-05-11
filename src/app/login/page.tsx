import Image from "next/image";
import { LogInIcon, ShieldCheckIcon } from "lucide-react";

import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { buttonVariants } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { normalizeNextPath } from "@/server/auth/config";

export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string; next?: string }>;
}) {
  const params = await searchParams;
  const next = normalizeNextPath(params.next);
  const loginHref = `/api/auth/feishu/start?next=${encodeURIComponent(next)}`;

  return (
    <main className="bg-background text-foreground min-h-dvh px-4 py-6">
      <div className="mx-auto flex min-h-[calc(100dvh-3rem)] w-full max-w-[1120px] items-center justify-center">
        <section className="grid w-full overflow-hidden rounded-[var(--radius-shell)] border border-border bg-card shadow-[0_24px_80px_rgba(15,23,42,0.12)] md:grid-cols-[minmax(0,1fr)_390px]">
          <div className="relative hidden min-h-[520px] overflow-hidden bg-[linear-gradient(135deg,#102033_0%,#0c1724_52%,#12251f_100%)] md:block">
            <div className="absolute inset-0 bg-[radial-gradient(circle_at_20%_18%,rgba(125,211,252,0.22),transparent_28%),radial-gradient(circle_at_82%_72%,rgba(52,211,153,0.2),transparent_30%),linear-gradient(rgba(255,255,255,0.055)_1px,transparent_1px),linear-gradient(90deg,rgba(255,255,255,0.045)_1px,transparent_1px)] bg-[length:auto,auto,36px_36px,36px_36px]" />
            <div className="relative flex h-full flex-col justify-between p-9 text-white">
              <div className="flex items-center gap-3">
                <Image
                  src="/xdream-cloud-mark.svg"
                  alt="XDream Cloud"
                  width={48}
                  height={48}
                  priority
                  className="rounded-[10px] shadow-[0_16px_36px_rgba(0,0,0,0.25)] ring-1 ring-white/16"
                />
                <div>
                  <p className="text-[10px] font-semibold tracking-[0.32em] text-sky-100/62 uppercase">
                    XDREAM
                  </p>
                  <h1 className="mt-1 text-[22px] leading-none font-semibold">
                    Cloud Console
                  </h1>
                </div>
              </div>

              <div className="max-w-[420px]">
                <div className="mb-4 inline-flex items-center gap-2 rounded-full border border-white/12 bg-white/8 px-3 py-1 text-xs text-slate-100/82">
                  <ShieldCheckIcon data-icon="inline-start" />
                  飞书企业身份认证
                </div>
                <h2 className="text-[34px] leading-tight font-semibold tracking-normal text-white">
                  进入 Cola 控制面
                </h2>
                <p className="mt-4 text-sm leading-6 text-slate-200/72">
                  使用企业飞书账号访问虚拟 Office、训练作业、推理部署和 CMDB 运维入口。
                </p>
              </div>
            </div>
          </div>

          <div className="flex min-h-[520px] flex-col justify-center gap-6 px-6 py-8 sm:px-10">
            <div className="md:hidden">
              <Image
                src="/xdream-cloud-mark.svg"
                alt="XDream Cloud"
                width={44}
                height={44}
                priority
                className="rounded-[10px] shadow-[0_12px_28px_rgba(15,23,42,0.18)] ring-1 ring-border"
              />
            </div>

            <div>
              <p className="text-xs font-semibold tracking-[0.24em] text-muted-foreground uppercase">
                Secure Sign In
              </p>
              <h2 className="mt-2 text-[28px] leading-tight font-semibold tracking-normal">
                使用飞书登录
              </h2>
              <p className="mt-3 text-sm leading-6 text-muted-foreground">
                登录成功后会返回刚才访问的页面。未被允许的飞书租户或被禁用账号不能进入系统。
              </p>
            </div>

            {params.error ? (
              <Alert variant="destructive">
                <AlertTitle>登录失败</AlertTitle>
                <AlertDescription>{params.error}</AlertDescription>
              </Alert>
            ) : null}

            <a
              href={loginHref}
              className={cn(buttonVariants({ size: "lg" }), "h-11 w-full")}
            >
                <LogInIcon data-icon="inline-start" />
                使用飞书登录
            </a>

            <p className="text-xs leading-5 text-muted-foreground">
              首次登录会自动创建 Cola 用户；管理员可以通过环境变量指定初始 admin。
            </p>
          </div>
        </section>
      </div>
    </main>
  );
}
