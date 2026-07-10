# Frontend Visual System Phase One Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a quiet, laptop-first shadcn operations console for the shared shell, login, Virtual Office, Training, and CMDB without changing their server contracts or operational side effects.

**Architecture:** Add missing shadcn primitives first, then introduce small shared presentation components and a responsive application chrome. Keep every module's queries, mutations, permissions, and lifecycle in its existing controller; extract only pure view models and presentational panels before changing layout. Verify visual behavior with source-contract tests, pure model tests, browser interaction, and production checks.

**Tech Stack:** Next.js 15, React 19, TypeScript, Tailwind CSS 4, shadcn `base-nova` with Base UI, Lucide, Node test runner, tRPC, PixiJS, GSAP.

---

## File Structure

- `src/styles/globals.css`: semantic color, radius, density, canvas, and reduced-motion tokens.
- `src/components/ui/{tabs,tooltip,dropdown-menu,checkbox,field,empty,collapsible}.tsx`: registry-generated shadcn primitives.
- `src/app/_components/operations-ui.tsx`: page header, metric strip, toolbar, status badge, and compact empty state.
- `src/app/_components/app-navigation.tsx`: product-area metadata and reusable desktop/mobile navigation.
- `src/app/_components/admin-chrome.tsx`: responsive shell, top bar, desktop sidebar, and mobile Sheet.
- `src/app/_components/current-user-badge.tsx`: fetched user identity rendered through a shadcn DropdownMenu.
- `src/app/login/page.tsx`: restrained Feishu sign-in surface.
- `src/app/_components/office-beta-view-model.ts`: pure Office metrics and selection presentation.
- `src/app/_components/office-beta-agent-list.tsx`: compact agent list connected through callbacks only.
- `src/app/_components/office-beta-agent-detail.tsx`: selected-agent detail shared by the desktop rail and smaller-screen Sheet.
- `src/app/_components/office-beta-shell.tsx`: Office controller, Pixi scene, mutations, dialogs, and responsive composition.
- `src/app/_components/training-model.ts`: pure validation, labels, metrics, filtering, and action-state helpers.
- `src/app/_components/training-tables.tsx`: Studio, run, and JupyterLab tables with responsive columns.
- `src/app/_components/training-shell.tsx`: Training queries, mutations, drafts, dialogs, and composition.
- `src/app/_components/cmdb/cmdb-view-model.ts`: pure CMDB parsing and presentation helpers.
- `src/app/_components/cmdb/cmdb-assets-panel.tsx`: asset table/mobile rows and expansion content.
- `src/app/_components/cmdb/cmdb-projects-panel.tsx`: project table, release-history disclosure, and row operations.
- `src/app/_components/cmdb/cmdb-topic-releases-panel.tsx`: local plans and triggered release groups.
- `src/app/_components/cmdb-shell.tsx`: CMDB controller, terminal lifecycle, mutations, dialogs, and composition.

### Task 1: Install the Missing shadcn Primitives

**Files:**

- Modify: `.gitignore`
- Create: `src/components/ui/tabs.tsx`
- Create: `src/components/ui/tooltip.tsx`
- Create: `src/components/ui/dropdown-menu.tsx`
- Create: `src/components/ui/checkbox.tsx`
- Create: `src/components/ui/field.tsx`
- Create: `src/components/ui/empty.tsx`
- Create: `src/components/ui/collapsible.tsx`
- Test: `src/app/_components/ui-primitives.test.ts`

- [ ] **Step 1: Write the failing registry-presence test**

```ts
import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import test from "node:test";

const components = [
  "tabs",
  "tooltip",
  "dropdown-menu",
  "checkbox",
  "field",
  "empty",
  "collapsible",
];

for (const component of components) {
  void test(`shadcn ${component} primitive is installed`, () => {
    assert.equal(
      existsSync(
        new URL(`../../components/ui/${component}.tsx`, import.meta.url),
      ),
      true,
    );
  });
}
```

- [ ] **Step 2: Run the test and confirm the missing primitives fail**

Run: `node --test src/app/_components/ui-primitives.test.ts`

Expected: seven failures because the registry files do not exist.

- [ ] **Step 3: Add the components through the local shadcn CLI**

Run:

```bash
npm exec shadcn -- add tabs tooltip dropdown-menu checkbox field empty collapsible --yes
```

Expected: the seven files are added under `src/components/ui/` using the existing `base-nova`, Base UI, Lucide, and CSS-variable configuration from `components.json`.

- [ ] **Step 4: Ignore visual-companion session output**

Append this exact entry to `.gitignore`:

```gitignore
.superpowers/
```

- [ ] **Step 5: Format and verify the primitives**

Run:

```bash
npm exec prettier -- --write src/components/ui/tabs.tsx src/components/ui/tooltip.tsx src/components/ui/dropdown-menu.tsx src/components/ui/checkbox.tsx src/components/ui/field.tsx src/components/ui/empty.tsx src/components/ui/collapsible.tsx src/app/_components/ui-primitives.test.ts
node --test src/app/_components/ui-primitives.test.ts
npm run typecheck
```

Expected: seven tests pass and TypeScript exits 0.

- [ ] **Step 6: Commit the primitive foundation**

```bash
git add .gitignore src/components/ui/tabs.tsx src/components/ui/tooltip.tsx src/components/ui/dropdown-menu.tsx src/components/ui/checkbox.tsx src/components/ui/field.tsx src/components/ui/empty.tsx src/components/ui/collapsible.tsx src/app/_components/ui-primitives.test.ts
git commit -m "feat: add shadcn operations primitives"
```

### Task 2: Establish Semantic Tokens and Shared Operations Components

**Files:**

- Modify: `src/styles/globals.css`
- Create: `src/app/_components/operations-ui.tsx`
- Test: `src/app/_components/operations-ui-layout.test.ts`

- [ ] **Step 1: Write the failing shared-layout contract tests**

```ts
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const source = readFileSync(
  new URL("./operations-ui.tsx", import.meta.url),
  "utf8",
);

void test("shared operations components expose stable slots", () => {
  assert.match(source, /data-slot="operations-page-header"/);
  assert.match(source, /data-slot="metric-strip"/);
  assert.match(source, /data-slot="data-toolbar"/);
  assert.match(source, /data-slot="operations-empty-state"/);
});

void test("metric strip supports four and five columns only at laptop width", () => {
  assert.match(source, /xl:grid-cols-4/);
  assert.match(source, /xl:grid-cols-5/);
  assert.doesNotMatch(source, /md:grid-cols-4/);
  assert.doesNotMatch(source, /md:grid-cols-5/);
});
```

- [ ] **Step 2: Run the test and confirm it fails because the shared file is absent**

Run: `node --test src/app/_components/operations-ui-layout.test.ts`

Expected: failure with `ENOENT` for `operations-ui.tsx`.

- [ ] **Step 3: Replace decorative globals with the approved semantic palette**

Set the light tokens in `:root` to this palette and remove `.control-shell-scan` plus its keyframes:

```css
:root {
  --background: oklch(0.965 0.004 250);
  --foreground: oklch(0.22 0.014 255);
  --card: oklch(0.995 0.002 250);
  --card-foreground: oklch(0.22 0.014 255);
  --popover: oklch(0.995 0.002 250);
  --popover-foreground: oklch(0.22 0.014 255);
  --primary: oklch(0.48 0.12 250);
  --primary-foreground: oklch(0.985 0.002 250);
  --secondary: oklch(0.94 0.006 250);
  --secondary-foreground: oklch(0.29 0.016 255);
  --muted: oklch(0.94 0.006 250);
  --muted-foreground: oklch(0.51 0.014 255);
  --accent: oklch(0.93 0.018 78);
  --accent-foreground: oklch(0.38 0.075 63);
  --destructive: oklch(0.59 0.19 27);
  --border: oklch(0.87 0.008 250);
  --input: oklch(0.89 0.008 250);
  --ring: oklch(0.58 0.09 250);
  --radius: 0.5rem;
  --radius-control: 6px;
  --radius-card: 8px;
  --radius-shell: 8px;
  --sidebar: oklch(0.245 0.018 250);
  --sidebar-foreground: oklch(0.95 0.004 250);
  --sidebar-primary: oklch(0.76 0.115 78);
  --sidebar-primary-foreground: oklch(0.22 0.018 250);
  --sidebar-accent: oklch(0.32 0.02 250);
  --sidebar-accent-foreground: oklch(0.98 0.002 250);
  --sidebar-border: oklch(1 0 0 / 12%);
  --sidebar-ring: oklch(0.74 0.08 78);
}
```

Replace the body grid/gradient background with a stable canvas:

```css
body {
  margin: 0;
  min-height: 100vh;
  background: var(--background);
  color: var(--foreground);
}
```

- [ ] **Step 4: Implement the shared operations surface**

Create `operations-ui.tsx` with these exact public types and slots:

```tsx
import type { LucideIcon } from "lucide-react";
import type { ReactNode } from "react";

import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";

export type StatusTone = "neutral" | "info" | "success" | "warning" | "danger";

const statusToneClasses: Record<StatusTone, string> = {
  neutral: "border-border bg-muted text-muted-foreground",
  info: "border-blue-200 bg-blue-50 text-blue-700",
  success: "border-emerald-200 bg-emerald-50 text-emerald-700",
  warning: "border-amber-200 bg-amber-50 text-amber-800",
  danger: "border-red-200 bg-red-50 text-red-700",
};

const metricColumnClasses = {
  1: "xl:grid-cols-1",
  2: "xl:grid-cols-2",
  3: "xl:grid-cols-3",
  4: "xl:grid-cols-4",
  5: "xl:grid-cols-5",
} as const;

export function PageHeader(props: {
  eyebrow?: string;
  title: string;
  description: string;
  icon?: LucideIcon;
  badges?: ReactNode;
  actions?: ReactNode;
  className?: string;
}) {
  const Icon = props.icon;
  return (
    <header
      data-slot="operations-page-header"
      className={cn(
        "flex min-w-0 flex-col gap-4 lg:flex-row lg:items-start lg:justify-between",
        props.className,
      )}
    >
      <div className="flex min-w-0 items-start gap-3">
        {Icon ? (
          <span className="bg-accent text-accent-foreground flex size-9 shrink-0 items-center justify-center rounded-[var(--radius-card)]">
            <Icon className="size-4" />
          </span>
        ) : null}
        <div className="min-w-0">
          {props.eyebrow ? (
            <p className="text-muted-foreground text-[10px] font-semibold uppercase">
              {props.eyebrow}
            </p>
          ) : null}
          <div className="mt-1 flex flex-wrap items-center gap-2">
            <h1 className="font-heading text-foreground text-2xl leading-tight font-semibold">
              {props.title}
            </h1>
            {props.badges}
          </div>
          <p className="text-muted-foreground mt-1 max-w-3xl text-sm leading-5">
            {props.description}
          </p>
        </div>
      </div>
      {props.actions ? (
        <div className="flex shrink-0 flex-wrap gap-2 lg:justify-end">
          {props.actions}
        </div>
      ) : null}
    </header>
  );
}

export function MetricStrip(props: {
  items: Array<{ label: string; value: ReactNode; detail?: ReactNode }>;
  className?: string;
}) {
  const columnCount = Math.min(
    5,
    Math.max(1, props.items.length),
  ) as keyof typeof metricColumnClasses;

  return (
    <div
      data-slot="metric-strip"
      className={cn(
        "bg-card grid grid-cols-2 overflow-hidden rounded-[var(--radius-card)] border",
        metricColumnClasses[columnCount],
        props.className,
      )}
    >
      {props.items.map((item) => (
        <div
          key={item.label}
          className="border-border min-w-0 border-r border-b px-4 py-3 xl:border-b-0"
        >
          <p className="text-muted-foreground truncate text-[11px]">
            {item.label}
          </p>
          <p className="text-foreground mt-1 text-xl leading-none font-semibold">
            {item.value}
          </p>
          {item.detail ? (
            <p className="text-muted-foreground mt-1 truncate text-[11px]">
              {item.detail}
            </p>
          ) : null}
        </div>
      ))}
    </div>
  );
}

export function DataToolbar(props: {
  children: ReactNode;
  className?: string;
}) {
  return (
    <div
      data-slot="data-toolbar"
      className={cn(
        "bg-card flex min-w-0 flex-col gap-2 border-y px-3 py-2 sm:flex-row sm:items-center sm:justify-between",
        props.className,
      )}
    >
      {props.children}
    </div>
  );
}

export function StatusBadge(props: {
  children: ReactNode;
  tone?: StatusTone;
  className?: string;
}) {
  return (
    <Badge
      variant="outline"
      className={cn(
        statusToneClasses[props.tone ?? "neutral"],
        props.className,
      )}
    >
      {props.children}
    </Badge>
  );
}

export function EmptyState(props: {
  title: string;
  description: string;
  action?: ReactNode;
  className?: string;
}) {
  return (
    <div
      data-slot="operations-empty-state"
      className={cn(
        "bg-muted/45 flex min-h-36 flex-col items-center justify-center border-y px-6 py-8 text-center",
        props.className,
      )}
    >
      <p className="text-foreground text-sm font-semibold">{props.title}</p>
      <p className="text-muted-foreground mt-1 max-w-xl text-sm">
        {props.description}
      </p>
      {props.action ? <div className="mt-4">{props.action}</div> : null}
    </div>
  );
}
```

- [ ] **Step 5: Format and verify the shared surface**

Run:

```bash
npm exec prettier -- --write src/styles/globals.css src/app/_components/operations-ui.tsx src/app/_components/operations-ui-layout.test.ts
node --test src/app/_components/operations-ui-layout.test.ts
npm run typecheck
```

Expected: two tests pass and TypeScript exits 0.

- [ ] **Step 6: Commit the visual system**

```bash
git add src/styles/globals.css src/app/_components/operations-ui.tsx src/app/_components/operations-ui-layout.test.ts
git commit -m "feat: establish operations visual system"
```

### Task 3: Rebuild the Responsive Application Chrome

**Files:**

- Create: `src/app/_components/app-navigation.tsx`
- Modify: `src/app/_components/admin-chrome.tsx:1-344`
- Modify: `src/app/_components/current-user-badge.tsx:1-89`
- Modify: `src/app/_components/logout-button.tsx:11-60`
- Modify: `src/app/_components/module-shell.tsx:8-380`
- Test: `src/app/_components/admin-chrome-layout.test.ts`

- [ ] **Step 1: Write failing shell invariants**

```ts
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const chrome = readFileSync(
  new URL("./admin-chrome.tsx", import.meta.url),
  "utf8",
);
const navigation = readFileSync(
  new URL("./app-navigation.tsx", import.meta.url),
  "utf8",
);

void test("full navigation starts at ordinary laptop width", () => {
  assert.match(chrome, /xl:grid-cols-\[220px_minmax\(0,1fr\)\]/);
  assert.match(chrome, /md:grid-cols-\[64px_minmax\(0,1fr\)\]/);
  assert.doesNotMatch(chrome, /2xl:grid-cols/);
});

void test("mobile navigation uses a shadcn Sheet", () => {
  assert.match(chrome, /<Sheet/);
  assert.match(chrome, /aria-label="打开产品导航"/);
});

void test("compact navigation uses shadcn Tooltip", () => {
  assert.match(navigation, /<Tooltip/);
  assert.match(navigation, /aria-current=\{active \? "page"/);
});

void test("the decorative sidebar scan is removed", () => {
  assert.doesNotMatch(chrome, /control-shell-scan/);
});
```

- [ ] **Step 2: Run the tests and verify the new shell contract fails**

Run: `node --test src/app/_components/admin-chrome-layout.test.ts`

Expected: failure because `app-navigation.tsx` does not exist and the shell still expands at `2xl`.

- [ ] **Step 3: Extract reusable product navigation**

Move `areaIcons`, `areaChrome`, grouping metadata, and `ProductAreaNavItem` from `admin-chrome.tsx` into `app-navigation.tsx`. Export this stable interface:

```tsx
export function AppNavigation(props: {
  activeArea: ProductAreaKey;
  compact?: boolean;
  onNavigate?: () => void;
});
```

Render full links when `compact` is false. When `compact` is true, wrap each icon link in generated `Tooltip`, keep the `aria-label`, and render title plus description inside `TooltipContent`. Use a 3px amber left marker and subtle amber surface only for `aria-current="page"`; remove colored dots, radial gradients, glow shadows, and continuous animation.

- [ ] **Step 4: Compose desktop, rail, and mobile shells from one navigation**

Replace the outer structure in `AdminChrome` with these layout contracts:

```tsx
<div className="bg-background text-foreground min-h-dvh md:h-dvh md:overflow-hidden">
  <div className="grid min-h-dvh grid-rows-[auto_minmax(0,1fr)] md:h-dvh md:grid-cols-[64px_minmax(0,1fr)] md:grid-rows-1 xl:grid-cols-[220px_minmax(0,1fr)]">
    <aside className="bg-sidebar text-sidebar-foreground hidden min-h-0 flex-col border-r md:flex">
      <div className="flex h-14 shrink-0 items-center justify-center border-b px-3 xl:justify-start">
        <Image
          src="/xdream-cloud-mark.svg"
          alt="XDream Cloud"
          width={34}
          height={34}
          priority
        />
        <div className="ml-2 hidden min-w-0 xl:block">
          <p className="text-[9px] font-semibold text-white/55 uppercase">
            XDREAM
          </p>
          <p className="truncate text-sm font-semibold text-white">
            Cloud Console
          </p>
        </div>
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto py-2 xl:hidden">
        <AppNavigation activeArea={activeArea} compact />
      </div>
      <div className="hidden min-h-0 flex-1 overflow-y-auto py-2 xl:block">
        <AppNavigation activeArea={activeArea} />
      </div>
      <CurrentUserBadge />
    </aside>
    <main className="bg-background min-h-0 min-w-0">
      <div className="flex h-full min-h-0 flex-col">
        <header className="bg-card/95 sticky top-0 z-20 flex h-12 shrink-0 items-center justify-between border-b px-3 backdrop-blur md:px-4">
          <div className="flex min-w-0 items-center gap-2">
            <Sheet>
              <SheetTrigger
                render={
                  <Button
                    variant="ghost"
                    size="icon-sm"
                    className="md:hidden"
                  />
                }
              >
                <MenuIcon />
                <span className="sr-only">打开产品导航</span>
              </SheetTrigger>
              <SheetContent side="left" className="w-[280px] p-0">
                <SheetHeader className="border-b">
                  <SheetTitle>XDream Cloud</SheetTitle>
                  <SheetDescription>产品区域导航</SheetDescription>
                </SheetHeader>
                <AppNavigation activeArea={activeArea} />
                <CurrentUserBadge />
              </SheetContent>
            </Sheet>
            <span className="text-muted-foreground text-xs">平台</span>
            <ChevronRightIcon className="text-muted-foreground size-3" />
            <span className="truncate text-sm font-medium">
              {activeAreaMeta.title}
            </span>
          </div>
          <span className="text-muted-foreground hidden text-xs sm:block">
            XDream Cloud
          </span>
        </header>
        <div className="scrollbar-none min-h-0 flex-1 overflow-y-auto px-3 py-4 md:px-4 xl:px-5">
          {children}
        </div>
      </div>
    </main>
  </div>
</div>
```

Use the imports required by the shown structure: Next `Image`, Lucide `ChevronRightIcon` and `MenuIcon`, shadcn Button/Sheet, `AppNavigation`, and `CurrentUserBadge`.

- [ ] **Step 5: Convert current-user actions to DropdownMenu**

Keep the existing `/api/auth/me` fetch and error Toast exactly. Render avatar/name as a generated `DropdownMenuTrigger`, show role/email in `DropdownMenuLabel`, and render `LogoutButton` through `DropdownMenuItem`. Use responsive classes inside `CurrentUserBadge` so the `md` rail shows only the avatar, `xl` shows full identity, and the mobile Sheet shows full identity. Keep the logout POST, redirect, refresh, pending state, and error behavior unchanged.

- [ ] **Step 6: Flatten shared module framing without breaking existing call sites**

Keep `ModulePageShell`, `ModuleHero`, `ModuleMetricCard`, `ModuleSection`, and `ModuleEmptyState` exports. Make `ModulePageShell` use `gap-4`; delegate the `ModuleHero` title/action area to `PageHeader`; remove the outer hero card border and shadow; reduce `ModuleSection` to a single border surface; make `ModuleEmptyState` delegate to shared `EmptyState`. Do not alter component props in this task.

- [ ] **Step 7: Format and verify the shell**

Run:

```bash
npm exec prettier -- --write src/app/_components/app-navigation.tsx src/app/_components/admin-chrome.tsx src/app/_components/current-user-badge.tsx src/app/_components/logout-button.tsx src/app/_components/module-shell.tsx src/app/_components/admin-chrome-layout.test.ts
node --test src/app/_components/admin-chrome-layout.test.ts
npm run typecheck
npm run lint
```

Expected: four tests pass; TypeScript and ESLint exit 0.

- [ ] **Step 8: Commit the responsive shell**

```bash
git add src/app/_components/app-navigation.tsx src/app/_components/admin-chrome.tsx src/app/_components/current-user-badge.tsx src/app/_components/logout-button.tsx src/app/_components/module-shell.tsx src/app/_components/admin-chrome-layout.test.ts
git commit -m "feat: rebuild responsive application chrome"
```

### Task 4: Refine the Feishu Login Experience

**Files:**

- Modify: `src/app/login/page.tsx:18-100`
- Test: `src/app/login/login-layout.test.ts`

- [ ] **Step 1: Write failing responsive login contracts**

```ts
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const source = readFileSync(new URL("./page.tsx", import.meta.url), "utf8");

void test("mobile login fits in one stable surface", () => {
  assert.match(source, /min-h-\[min\(560px,calc\(100dvh-2rem\)\)\]/);
  assert.match(source, /max-w-\[1040px\]/);
});

void test("login removes decorative radial and grid effects", () => {
  assert.doesNotMatch(source, /radial-gradient/);
  assert.doesNotMatch(source, /36px_36px/);
});

void test("Feishu remains the only primary sign-in action", () => {
  assert.equal((source.match(/使用飞书登录/g) ?? []).length, 2);
});
```

- [ ] **Step 2: Run the test and confirm the current decorative layout fails**

Run: `node --test src/app/login/login-layout.test.ts`

Expected: at least the first two tests fail.

- [ ] **Step 3: Implement the restrained login layout**

Keep `normalizeNextPath`, the Feishu start URL, and `LoginErrorToast` unchanged. Use `max-w-[1040px]`, an 8px border radius, a flat charcoal left panel at `md+`, and a `min-h-[min(560px,calc(100dvh-2rem))]` sign-in surface. Remove radial/grid effects, shorten the body copy, keep one `Button`-styled Feishu link, and retain the first-login administrator note as muted text. On mobile, show the logo, `XDream Cloud`, sign-in title, description, button, and note in that order without a nested card.

- [ ] **Step 4: Format and verify login**

Run:

```bash
npm exec prettier -- --write src/app/login/page.tsx src/app/login/login-layout.test.ts
node --test src/app/login/login-layout.test.ts
npm run typecheck
```

Expected: three tests pass and TypeScript exits 0.

- [ ] **Step 5: Commit login polish**

```bash
git add src/app/login/page.tsx src/app/login/login-layout.test.ts
git commit -m "feat: refine Feishu login experience"
```

### Task 5: Lock Virtual Office Presentation Behavior

**Files:**

- Create: `src/app/_components/office-beta-view-model.ts`
- Test: `src/app/_components/office-beta-view-model.test.ts`
- Modify: `src/app/_components/office-beta-shell.tsx:1288-1324,2315-2341,2545-2600`

- [ ] **Step 1: Write failing Office view-model tests**

Create tests for these public functions:

```ts
import assert from "node:assert/strict";
import test from "node:test";

import {
  buildOfficeStats,
  canCancelOfficeTask,
  officeAgentStatusTone,
  officeDeviceStatusTone,
} from "./office-beta-view-model.ts";

void test("Office metrics count active work without changing task semantics", () => {
  const stats = buildOfficeStats({
    agents: [{ id: "a1" }, { id: "a2" }],
    zones: [
      { activeCount: 1, workstationCapacity: 3, workstationMax: 5 },
      { activeCount: 1, workstationCapacity: 2, workstationMax: 4 },
    ],
    tasks: [
      { status: "running" },
      { status: "completed" },
      { status: "failed" },
      { status: "canceled" },
    ],
    devices: [{ status: "online" }, { status: "busy" }, { status: "offline" }],
  });

  assert.deepEqual(stats, [
    { label: "人物", value: "2", detail: "2 活跃" },
    { label: "工位", value: "5/9", detail: "已启用" },
    { label: "任务", value: "1", detail: "进行中" },
    { label: "设备", value: "2/3", detail: "可用" },
  ]);
});

void test("only non-terminal tasks can be canceled", () => {
  assert.equal(canCancelOfficeTask("running"), true);
  assert.equal(canCancelOfficeTask("completed"), false);
  assert.equal(canCancelOfficeTask("failed"), false);
  assert.equal(canCancelOfficeTask("canceled"), false);
});

void test("Office statuses map to semantic shared tones", () => {
  assert.equal(officeAgentStatusTone("executing"), "success");
  assert.equal(officeAgentStatusTone("waiting_device"), "warning");
  assert.equal(officeAgentStatusTone("blocked"), "danger");
  assert.equal(officeDeviceStatusTone("busy"), "info");
  assert.equal(officeDeviceStatusTone("unhealthy"), "danger");
});
```

- [ ] **Step 2: Run the test and confirm the model module is missing**

Run: `node --test src/app/_components/office-beta-view-model.test.ts`

Expected: failure with `ERR_MODULE_NOT_FOUND`.

- [ ] **Step 3: Extract the pure view model**

Implement `buildOfficeStats`, `canCancelOfficeTask`, `officeAgentStatusTone`, and `officeDeviceStatusTone` in `office-beta-view-model.ts`. Type `buildOfficeStats` with structural `Pick` inputs so it accepts the existing `OfficeSnapshot` without importing a client runtime. Replace the corresponding inline count and raw status-class logic in `OfficeBetaShell`; do not alter queries, SSE, Pixi, GSAP, draft state, mutation payloads, confirmation text, or workspace popup ordering.

- [ ] **Step 4: Run the Office unit contracts**

Run:

```bash
node --test src/app/_components/office-beta-view-model.test.ts src/app/_components/office-agent-defaults.test.ts src/app/_components/isaac-copy.test.ts
npm run typecheck
```

Expected: all tests pass and TypeScript exits 0.

- [ ] **Step 5: Commit the Office behavior lock**

```bash
git add src/app/_components/office-beta-view-model.ts src/app/_components/office-beta-view-model.test.ts src/app/_components/office-beta-shell.tsx
git commit -m "refactor: extract Office presentation model"
```

### Task 6: Recompose Virtual Office Around the Canvas

**Files:**

- Create: `src/app/_components/office-beta-agent-list.tsx`
- Create: `src/app/_components/office-beta-agent-detail.tsx`
- Modify: `src/app/_components/office-beta-shell.tsx:2602-3532`
- Modify: `src/styles/globals.css:223-258`
- Test: `src/app/_components/office-beta-layout.test.ts`

- [ ] **Step 1: Write failing Office layout contracts**

```ts
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const source = readFileSync(
  new URL("./office-beta-shell.tsx", import.meta.url),
  "utf8",
);

void test("Office gives the canvas a laptop-first three-column workspace", () => {
  assert.match(source, /xl:grid-cols-\[190px_minmax\(0,1fr\)_280px\]/);
  assert.match(source, /min-h-\[420px\]/);
  assert.doesNotMatch(source, /office-beta-title text-4xl/);
});

void test("Office uses shared header and metric strip", () => {
  assert.match(source, /<PageHeader/);
  assert.match(source, /<MetricStrip/);
});

void test("selected details use an integrated rail and responsive Sheet", () => {
  assert.match(source, /<OfficeBetaAgentDetail/);
  assert.match(source, /<Sheet/);
});
```

- [ ] **Step 2: Run the test and confirm the old hero/canvas composition fails**

Run: `node --test src/app/_components/office-beta-layout.test.ts`

Expected: three failures.

- [ ] **Step 3: Build a compact agent list with no Pixi hover coupling**

`OfficeBetaAgentList` receives `agents`, `selectedAgentId`, and `onSelect`. It renders a `ScrollArea` list with role, engine, and semantic `StatusBadge`, using a native button per row. Do not connect row hover to the Pixi hover state because the current scene rebuilds on hover changes.

- [ ] **Step 4: Extract selected-agent detail without moving business handlers**

`OfficeBetaAgentDetail` receives the already-derived agent, task, device, owner, and booleans plus callbacks for task creation, cancel, workspace open, and delete. Render the existing facts and all existing commands with shadcn Button and StatusBadge. The component must not import tRPC, the Office store, or server services.

- [ ] **Step 5: Recompose the page**

Replace the oversized green/brown hero with `PageHeader`, keep “添加人物” as the only primary action, and place “下发任务” plus “添加工位” as secondary buttons. Render `MetricStrip` immediately below. Use this responsive workspace:

```tsx
<div className="grid min-h-[420px] flex-1 gap-3 lg:grid-cols-[190px_minmax(0,1fr)] xl:grid-cols-[190px_minmax(0,1fr)_280px]">
  <OfficeBetaAgentList
    agents={liveSnapshot.agents}
    selectedAgentId={selectedAgentId}
    onSelect={setSelectedAgentId}
  />
  <div className="bg-muted relative min-h-[420px] min-w-0 overflow-hidden rounded-[var(--radius-card)] border">
    <div ref={canvasHostRef} className="h-full min-h-[420px] w-full" />
  </div>
  <aside className="hidden min-h-0 border-l xl:block">
    {selectedAgent ? (
      <OfficeBetaAgentDetail
        agent={selectedAgent}
        task={selectedTask}
        device={selectedDevice}
        canCancelTask={selectedTaskCanCancel}
        onCreateTask={() => setIsCreateTaskOpen(true)}
        onCancelTask={() => void handleCancelSelectedTask()}
        onOpenWorkspace={() => void openNativePage()}
        onDeleteAgent={() => void handleDeleteAgent()}
      />
    ) : null}
  </aside>
</div>
```

Below `xl`, open the same detail component inside a right `Sheet` when an agent is selected. Keep empty Office, snapshot time, camera controls, read-only Alert, and all three dialogs. Convert dialog backgrounds and footers to semantic tokens; give the task dialog a fixed header/body/footer grid at 768px height.

- [ ] **Step 6: Remove the Office-specific laptop override block**

Delete `.laptop-compact-office` rules from `globals.css`; the grid and stable canvas minimum now own the layout.

- [ ] **Step 7: Format and verify Office**

Run:

```bash
npm exec prettier -- --write src/app/_components/office-beta-agent-list.tsx src/app/_components/office-beta-agent-detail.tsx src/app/_components/office-beta-shell.tsx src/app/_components/office-beta-layout.test.ts src/styles/globals.css
node --test src/app/_components/office-beta-view-model.test.ts src/app/_components/office-beta-layout.test.ts src/app/_components/office-agent-defaults.test.ts
npm run typecheck
npm run lint
```

Expected: Office tests pass and static checks exit 0.

- [ ] **Step 8: Commit the Office workspace**

```bash
git add src/app/_components/office-beta-agent-list.tsx src/app/_components/office-beta-agent-detail.tsx src/app/_components/office-beta-shell.tsx src/app/_components/office-beta-layout.test.ts src/styles/globals.css
git commit -m "feat: recompose Virtual Office workspace"
```

### Task 7: Lock Training Validation and Presentation Semantics

**Files:**

- Create: `src/app/_components/training-model.ts`
- Test: `src/app/_components/training-model.test.ts`
- Modify: `src/app/_components/training-shell.tsx:55-281,336-387,1676-1799`

- [ ] **Step 1: Write failing Training model tests**

```ts
import assert from "node:assert/strict";
import test from "node:test";

import {
  buildTrainingMetrics,
  parseNotebookPublicPort,
  runStatusTone,
  sanitizeDnsNameInput,
} from "./training-model.ts";

void test("runtime names are normalized to DNS-safe input", () => {
  assert.equal(sanitizeDnsNameInput(" My_Run__01 "), "my-run-01-");
});

void test("JupyterLab public ports preserve the current safety rules", () => {
  assert.equal(parseNotebookPublicPort("1024"), 1024);
  assert.equal(parseNotebookPublicPort("65535"), 65535);
  assert.ok(Number.isNaN(parseNotebookPublicPort("8888")));
  assert.ok(Number.isNaN(parseNotebookPublicPort("1023")));
});

void test("training metrics keep total requested GPU semantics", () => {
  assert.deepEqual(
    buildTrainingMetrics({
      studios: [{ status: "running" }, { status: "starting" }],
      runs: [
        { status: "running", nodeCount: 2, gpusPerNode: 4 },
        { status: "failed", nodeCount: 1, gpusPerNode: 2 },
      ],
      labs: [
        { status: "running", gpuCount: 1 },
        { status: "error", gpuCount: 0 },
      ],
    }),
    [
      { label: "Studio", value: "1/2" },
      { label: "训练运行", value: "1/2" },
      { label: "GPU 申请", value: "10" },
      { label: "Lab", value: "1/2" },
      { label: "GPU Lab", value: "1" },
    ],
  );
});

void test("run status uses shared semantic tones", () => {
  assert.equal(runStatusTone("running"), "info");
  assert.equal(runStatusTone("completed"), "success");
  assert.equal(runStatusTone("failed"), "danger");
  assert.equal(runStatusTone("draft"), "warning");
});
```

- [ ] **Step 2: Run the test and confirm the model module is missing**

Run: `node --test src/app/_components/training-model.test.ts`

Expected: failure with `ERR_MODULE_NOT_FOUND`.

- [ ] **Step 3: Extract pure helpers without changing payloads**

Move DNS sanitization, integer/port parsing, time labels, runtime/run labels and tones, runtime specification labels, and five-metric calculation to `training-model.ts`. Import `formatGpuAllocationLabel` through the Node-test-compatible relative path `../../lib/gpu-allocation.ts`. Keep validation ranges and multi-node memory-mode prohibition byte-for-byte equivalent. Keep all three 8-second queries, default drafts, image fallback effects, mutation payload transforms, invalidation, Toast text, confirmation text, and run action matrix in `TrainingShell`.

- [ ] **Step 4: Verify model behavior and static types**

Run:

```bash
node --test src/app/_components/training-model.test.ts
npm run typecheck
```

Expected: four tests pass and TypeScript exits 0.

- [ ] **Step 5: Commit Training behavior extraction**

```bash
git add src/app/_components/training-model.ts src/app/_components/training-model.test.ts src/app/_components/training-shell.tsx
git commit -m "refactor: extract Training presentation model"
```

### Task 8: Convert Training to shadcn Tabs and Dense Tables

**Files:**

- Create: `src/app/_components/training-tables.tsx`
- Modify: `src/app/_components/training-shell.tsx:283-1594,2135-2562`
- Test: `src/app/_components/training-layout.test.ts`

- [ ] **Step 1: Write failing Training layout contracts**

```ts
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const shell = readFileSync(
  new URL("./training-shell.tsx", import.meta.url),
  "utf8",
);
const tables = readFileSync(
  new URL("./training-tables.tsx", import.meta.url),
  "utf8",
);

void test("Training uses shared page and metric surfaces", () => {
  assert.match(shell, /<PageHeader/);
  assert.match(shell, /<MetricStrip/);
  assert.doesNotMatch(shell, /<TrainingStatusStrip/);
});

void test("Training environment switching uses shadcn Tabs", () => {
  assert.match(shell, /<Tabs/);
  assert.match(shell, /<TabsList/);
  assert.match(shell, /<TabsContent/);
  assert.doesNotMatch(shell, /role="tablist"/);
});

void test("Training lists use semantic shadcn tables", () => {
  assert.match(tables, /<Table/);
  assert.match(tables, /<StatusBadge/);
  assert.match(tables, /hidden lg:table-cell/);
});

void test("Training row details use a shadcn Sheet without new log calls", () => {
  assert.match(shell, /<Sheet/);
  assert.doesNotMatch(shell, /inspectStudioRun/);
});
```

- [ ] **Step 2: Run the tests and confirm the table module and shadcn Tabs are absent**

Run: `node --test src/app/_components/training-layout.test.ts`

Expected: failure with `ENOENT` and old tab markup mismatch.

- [ ] **Step 3: Build focused presentational tables**

Create Studio, training-run, and JupyterLab tables in `training-tables.tsx`. Each receives rows and callback props; no component imports `api`. Show name/title, semantic status, runtime/specification, GPU, updated time, and actions. Hide specification and timestamp cells below `lg`, keep row names wrapping safely, expose icon-only commands through Tooltip, and preserve every open/publish/submit/stop/delete action. A run-row detail command sets a selected row in `TrainingShell` and opens a right shadcn Sheet containing only data already returned by `listStudioRuns`.

- [ ] **Step 4: Recompose the Training page**

Use `PageHeader` with “提交训练” as the sole primary action; refresh and environment creation are secondary. Render the five values through `MetricStrip`. Replace manual environment tabs with controlled generated `Tabs value={activeWorkspaceTab}`. Within Studio, render the runtime table and run table as separate unframed sections; within JupyterLab, render the Lab table with its port controls. Add local search over run title/model/dataset and status Tabs for run rows only; do not alter query inputs or server filtering.

- [ ] **Step 5: Normalize loading, error, and empty states**

Use shadcn `Alert` plus query `refetch()` for each read failure, shared `EmptyState` for true empty lists, and table-shaped `Skeleton` rows while loading. Keep Toast for mutations. Do not call `inspectStudioRun` or add new log/cluster requests.

- [ ] **Step 6: Make dialog body scrolling stable on 768px-high screens**

Apply `grid max-h-[calc(100dvh-2rem)] grid-rows-[auto_minmax(0,1fr)_auto] overflow-hidden p-0` to runtime and run dialogs; place form content in `ScrollArea`, and keep footer buttons visible. Replace raw checkboxes with shadcn Checkbox and custom field wrappers with generated Field components while preserving names, labels, validation, and state updates.

- [ ] **Step 7: Format and verify Training**

Run:

```bash
npm exec prettier -- --write src/app/_components/training-tables.tsx src/app/_components/training-shell.tsx src/app/_components/training-layout.test.ts
node --test src/app/_components/training-model.test.ts src/app/_components/training-layout.test.ts
npm run typecheck
npm run lint
```

Expected: Training tests pass and static checks exit 0.

- [ ] **Step 8: Commit the Training workspace**

```bash
git add src/app/_components/training-tables.tsx src/app/_components/training-shell.tsx src/app/_components/training-layout.test.ts
git commit -m "feat: rebuild Training workspace tables"
```

### Task 9: Lock CMDB Parsing and Local-Plan Behavior

**Files:**

- Create: `src/app/_components/cmdb/cmdb-view-model.ts`
- Test: `src/app/_components/cmdb/cmdb-view-model.test.ts`
- Modify: `src/app/_components/cmdb-shell.tsx:204-567`

- [ ] **Step 1: Write failing CMDB pure-model tests**

```ts
import assert from "node:assert/strict";
import test from "node:test";

import {
  normalizeTargetAssetNames,
  parseAssetRoles,
  parseSshPort,
  parseStoredTopicReleasePlans,
  parseVariables,
} from "./cmdb-view-model.ts";

void test("CMDB variable parsing ignores comments and incomplete pairs", () => {
  assert.deepEqual(parseVariables("A=1\n# note\nB = two\nEMPTY=\nNOVALUE"), {
    A: "1",
    B: "two",
  });
});

void test("asset roles and targets are normalized without Kubernetes input", () => {
  assert.deepEqual(parseAssetRoles("web, gpu\nweb"), ["web", "gpu"]);
  assert.deepEqual(
    normalizeTargetAssetNames(
      [" host-a ", "__unassigned__", "host-a"],
      "host-b",
    ),
    ["host-a", "host-b"],
  );
});

void test("SSH port parsing preserves current bounds", () => {
  assert.equal(parseSshPort(""), 22);
  assert.equal(parseSshPort("65535"), 65535);
  assert.equal(parseSshPort("0"), null);
  assert.equal(parseSshPort("abc"), null);
});

void test("malformed local release plans are dropped safely", () => {
  assert.deepEqual(parseStoredTopicReleasePlans("not-json"), []);
  assert.deepEqual(
    parseStoredTopicReleasePlans(JSON.stringify([{ topic: "missing id" }])),
    [],
  );
});
```

- [ ] **Step 2: Run the tests and confirm the extracted module is absent**

Run: `node --test src/app/_components/cmdb/cmdb-view-model.test.ts`

Expected: failure with `ERR_MODULE_NOT_FOUND`.

- [ ] **Step 3: Extract CMDB pure helpers**

Move the `TopicReleasePlan` structural type, `isRecord`, `serializeVariables`, `parseVariables`, `parseStoredTopicReleasePlans`, `serializeAssetRoles`, `parseAssetRoles`, `normalizeTargetAssetNames`, and `parseSshPort` into `cmdb/cmdb-view-model.ts`. Keep `UNASSIGNED_VALUE` as a private constant in that module, export the exact functions used by tests, and import them back into `CmdbShell`. Preserve the `cola.cmdb.topicReleasePlans` key, draft defaults, remote operation checks, polling, terminal protocol, and all mutation inputs. Do not import Kubernetes configuration into this module.

- [ ] **Step 4: Verify CMDB model behavior**

Run:

```bash
node --test src/app/_components/cmdb/cmdb-view-model.test.ts src/server/cmdb/deploy-architecture.test.ts
npm run typecheck
```

Expected: tests pass and TypeScript exits 0.

- [ ] **Step 5: Commit the CMDB behavior lock**

```bash
git add src/app/_components/cmdb/cmdb-view-model.ts src/app/_components/cmdb/cmdb-view-model.test.ts src/app/_components/cmdb-shell.tsx
git commit -m "refactor: extract CMDB view model"
```

### Task 10: Rebuild CMDB Navigation and Data Panels

**Files:**

- Create: `src/app/_components/cmdb/cmdb-assets-panel.tsx`
- Create: `src/app/_components/cmdb/cmdb-projects-panel.tsx`
- Create: `src/app/_components/cmdb/cmdb-topic-releases-panel.tsx`
- Modify: `src/app/_components/cmdb-shell.tsx:5162-6252`
- Test: `src/app/_components/cmdb/cmdb-layout.test.ts`

- [ ] **Step 1: Write failing CMDB layout contracts**

```ts
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const shell = readFileSync(
  new URL("../cmdb-shell.tsx", import.meta.url),
  "utf8",
);
const assets = readFileSync(
  new URL("./cmdb-assets-panel.tsx", import.meta.url),
  "utf8",
);
const projects = readFileSync(
  new URL("./cmdb-projects-panel.tsx", import.meta.url),
  "utf8",
);

void test("CMDB top-level switching uses controlled shadcn Tabs", () => {
  assert.match(shell, /<Tabs/);
  assert.match(shell, /value=\{activeArea\}/);
  assert.doesNotMatch(shell, /role="tablist"/);
});

void test("asset and project tables are available at laptop width", () => {
  assert.match(assets, /hidden lg:block/);
  assert.match(projects, /hidden lg:block/);
  assert.doesNotMatch(assets, /2xl:block/);
  assert.doesNotMatch(projects, /2xl:block/);
});

void test("row commands use shadcn DropdownMenu", () => {
  assert.match(assets, /<DropdownMenu/);
  assert.match(projects, /<DropdownMenu/);
});
```

- [ ] **Step 2: Run the tests and confirm the panel files are missing**

Run: `node --test src/app/_components/cmdb/cmdb-layout.test.ts`

Expected: failure with `ENOENT`.

- [ ] **Step 3: Recompose the CMDB header and area navigation**

Use `PageHeader`, a four-value `MetricStrip`, and controlled shadcn Tabs for assets, projects, and topic releases. Keep current counters, manual refresh, “新增资产”, “纳管项目”, and “主题发布” handlers. Choose one primary action based on active tab; place other commands in outline buttons or DropdownMenu. Keep dashboard error, offline, loading, and GitLab token Alerts directly below the toolbar.

- [ ] **Step 4: Extract the assets panel**

At `lg+`, use a compact shadcn Table for asset, connectivity, roles/architecture, referenced services, and updated time. Keep service expansion with Collapsible and all SSH/edit/delete commands. At smaller widths, render a single-layer mobile row list. Pass rows, expansion state, and callbacks from `CmdbShell`; the panel must not call APIs or read cluster data.

- [ ] **Step 5: Extract the projects panel**

At `lg+`, use a stable table for project, deploy target and assets, health, latest release, and row actions. Preserve release history expansion, Docker monitor, remote terminal, GitLab, release, edit, and delete. Put low-frequency commands in DropdownMenu with accessible labels; keep disabled reasons available through Tooltip. Retain the “only recent 8 per project” behavior and do not imply full history.

- [ ] **Step 6: Flatten topic releases**

Move local pending plans and triggered release groups into `cmdb-topic-releases-panel.tsx`. Use two labeled, un-nested sections so local plans are visually distinct from server records. Preserve localStorage persistence, project selection, trigger, retry, cancel, delete, and recent-12-record limits.

- [ ] **Step 7: Format and verify CMDB panels**

Run:

```bash
npm exec prettier -- --write src/app/_components/cmdb/cmdb-assets-panel.tsx src/app/_components/cmdb/cmdb-projects-panel.tsx src/app/_components/cmdb/cmdb-topic-releases-panel.tsx src/app/_components/cmdb-shell.tsx src/app/_components/cmdb/cmdb-layout.test.ts
node --test src/app/_components/cmdb/cmdb-view-model.test.ts src/app/_components/cmdb/cmdb-layout.test.ts
npm run typecheck
npm run lint
```

Expected: CMDB tests pass and static checks exit 0.

- [ ] **Step 8: Commit the CMDB data workspace**

```bash
git add src/app/_components/cmdb src/app/_components/cmdb-shell.tsx
git commit -m "feat: rebuild CMDB data workspace"
```

### Task 11: Normalize CMDB Dialogs Without Touching Remote Lifecycles

**Files:**

- Modify: `src/app/_components/cmdb-shell.tsx:6254-8527`
- Test: `src/app/_components/cmdb/cmdb-dialog-layout.test.ts`

- [ ] **Step 1: Write failing dialog-layout contracts**

```ts
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const source = readFileSync(
  new URL("../cmdb-shell.tsx", import.meta.url),
  "utf8",
);

void test("large CMDB dialogs keep headers and footers visible", () => {
  const stableDialogGrids =
    source.match(/grid-rows-\[auto_minmax\(0,1fr\)_auto\]/g) ?? [];
  assert.ok(stableDialogGrids.length >= 4);
});

void test("CMDB forms use shadcn Field and Checkbox", () => {
  assert.match(source, /<Field/);
  assert.match(source, /<Checkbox/);
});

void test("terminal lifecycle endpoints remain present", () => {
  assert.match(source, /\/api\/cmdb\/terminal-session/);
  assert.match(source, /method: "DELETE"/);
});
```

- [ ] **Step 2: Run the tests and confirm current form/dialog markup fails**

Run: `node --test src/app/_components/cmdb/cmdb-dialog-layout.test.ts`

Expected: the Field/Checkbox and stable-grid tests fail; terminal contract passes.

- [ ] **Step 3: Normalize asset, project, and release dialogs**

Use a fixed `DialogHeader`, scrollable body, and `DialogFooter` for asset, project, single-release, and topic-release dialogs. Replace custom field wrappers and raw checkboxes with generated Field and Checkbox while keeping every input value, name, draft update, validation message, pending disablement, and submit handler unchanged. Keep the project form's basic/deploy/observe/variables navigation as shadcn Tabs.

- [ ] **Step 4: Limit terminal work to visual chrome**

Apply the same header/body/footer spacing and semantic colors to health, operation, and terminal dialogs. Do not extract or change the terminal hook in this phase. Preserve REST create/input/resize/delete, SSE parsing, 16ms input batching, 120ms resize batching, output limit, maximize state, and close cleanup.

- [ ] **Step 5: Format and verify CMDB dialogs**

Run:

```bash
npm exec prettier -- --write src/app/_components/cmdb-shell.tsx src/app/_components/cmdb/cmdb-dialog-layout.test.ts
node --test src/app/_components/cmdb/cmdb-view-model.test.ts src/app/_components/cmdb/cmdb-layout.test.ts src/app/_components/cmdb/cmdb-dialog-layout.test.ts src/server/cmdb/deploy-architecture.test.ts
npm run typecheck
npm run lint
```

Expected: all focused tests and static checks pass.

- [ ] **Step 6: Commit CMDB dialog polish**

```bash
git add src/app/_components/cmdb-shell.tsx src/app/_components/cmdb/cmdb-dialog-layout.test.ts
git commit -m "feat: normalize CMDB dialogs"
```

### Task 12: End-to-End Verification and Laptop Experience Pass

**Files:**

- Modify only files implicated by verified defects from this task.

- [ ] **Step 1: Run all automated frontend and behavior checks**

Run:

```bash
node --test src/app/_components/*.test.ts src/app/login/*.test.ts src/app/_components/cmdb/*.test.ts
npm run typecheck
npm run lint
npm run format:check
npm run build
```

Expected: all commands exit 0. If a pre-existing unrelated test fails, record the exact command and failure before making any change.

- [ ] **Step 2: Start the local application without modifying remote code**

Run: `./restart.sh -f`

Expected: the local control plane is available at `http://localhost:50038`. Read any displayed Kubernetes facts only from existing application APIs or `infra/k8s/cluster`; do not edit cluster manifests.

- [ ] **Step 3: Verify the shared shell and login at four viewports**

Use the browser testing skill at `1366x768`, `1440x900`, `1024x768`, and `390x844`. Capture screenshots of login, Virtual Office, Training, and CMDB. Check that full navigation appears at `>=1280`, the icon rail and Tooltip work at `1024`, mobile Sheet navigation works at `390`, text does not overlap, and no page-level horizontal scrollbar appears.

- [ ] **Step 4: Exercise safe Virtual Office paths**

Verify empty/read-only/populated rendering, list-to-map selection, camera zoom/reset/drag, detail close, dialog validation, SSE live/reconnect indicator, and workspace popup handling. Do not submit create/delete/cancel operations against a real environment; open confirmation dialogs and cancel, or use a local mock response.

- [ ] **Step 5: Exercise safe Training paths**

Verify loading/error/empty/populated tables, search, status Tabs, environment Tabs, long values, 80-row scrolling, all status-dependent action visibility, Lab port validation, dialog focus return, and drafts surviving an 8-second refresh. Do not create, submit, stop, or delete real cluster workloads during visual QA.

- [ ] **Step 6: Exercise safe CMDB paths**

Verify three area Tabs, asset service expansion, project release-history expansion, local topic-plan persistence, all form panels and validation, viewer disabled/error states, terminal dialog layout, and confirmation cancel paths. Never trigger SSH login/test, release, stop, Docker cleanup, remote terminal creation, or destructive deletion against a real asset.

- [ ] **Step 7: Inspect runtime quality**

For every viewport and target page, inspect browser console errors, failed network requests, focus rings, keyboard Tabs, dialog scroll/focus behavior, reduced-motion behavior, and dynamic content layout shift. Use screenshot comparison and a CSS color scan to confirm the result is not dominated by one hue and has no nested-card regressions.

- [ ] **Step 8: Fix only reproduced defects and rerun the relevant checks**

For each defect, add or tighten the smallest source/pure-model test that reproduces it, run the failing test, patch the responsible file, rerun the focused test, then rerun Step 1.

- [ ] **Step 9: Close the verification loop**

If Step 8 exposes a defect, return to the owning task, add the exact failing test and file there, and commit the focused fix with that task's file list. If no defect is reproduced, leave the worktree unchanged rather than creating an empty verification commit.
