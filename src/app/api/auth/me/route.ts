import { NextResponse, type NextRequest } from "next/server";

import { requireRouteUser } from "@/server/auth/http";

export const runtime = "nodejs";

export async function GET(request: NextRequest) {
  const auth = await requireRouteUser(request);
  if (auth.response) return auth.response;

  return NextResponse.json({
    user: {
      id: auth.user.id,
      avatarUrl: auth.user.avatarUrl,
      email: auth.user.email,
      name: auth.user.name,
      role: auth.user.role,
      tenantKey: auth.user.tenantKey,
    },
  });
}

