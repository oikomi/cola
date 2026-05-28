import { createEnv } from "@t3-oss/env-nextjs";
import { z } from "zod";

export const env = createEnv({
  /**
   * Specify your server-side environment variables schema here. This way you can ensure the app
   * isn't built with invalid env vars.
   */
  server: {
    DATABASE_URL: z.string().url(),
    AUTH_ADMIN_FEISHU_OPEN_IDS: z.string().optional(),
    AUTH_ALLOWED_TENANT_KEYS: z.string().optional(),
    AUTH_COOKIE_SECURE: z
      .enum(["true", "false"])
      .optional()
      .default(process.env.NODE_ENV === "production" ? "true" : "false"),
    AUTH_PUBLIC_BASE_URL: z.string().url().optional(),
    AUTH_SESSION_SECRET: z.string().min(32).optional(),
    FEISHU_APP_ID: z.string().optional(),
    FEISHU_APP_SECRET: z.string().optional(),
    FEISHU_REDIRECT_URI: z.string().url().optional(),
    GITLAB_URL: z.string().url().optional(),
    GITLAB_API_TOKEN: z.string().optional(),
    COLA_HERMES_GITLAB_URL: z.string().url().optional(),
    COLA_HERMES_GITLAB_USERNAME: z.string().optional(),
    COLA_HERMES_GITLAB_TOKEN: z.string().optional(),
    NODE_ENV: z
      .enum(["development", "test", "production"])
      .default("development"),
  },

  /**
   * Specify your client-side environment variables schema here. This way you can ensure the app
   * isn't built with invalid env vars. To expose them to the client, prefix them with
   * `NEXT_PUBLIC_`.
   */
  client: {
    NEXT_PUBLIC_OPENCLAW_NATIVE_URL: z.string().url().optional(),
    NEXT_PUBLIC_HERMES_NATIVE_URL: z.string().url().optional(),
    NEXT_PUBLIC_UNSLOTH_STUDIO_URL: z.string().url().optional(),
    NEXT_PUBLIC_K8S_DASHBOARD_URL: z.string().url().optional(),
    NEXT_PUBLIC_HAMI_WEBUI_URL: z.string().url().optional(),
  },

  /**
   * You can't destruct `process.env` as a regular object in the Next.js edge runtimes (e.g.
   * middlewares) or client-side so we need to destruct manually.
   */
  runtimeEnv: {
    DATABASE_URL: process.env.DATABASE_URL,
    AUTH_ADMIN_FEISHU_OPEN_IDS: process.env.AUTH_ADMIN_FEISHU_OPEN_IDS,
    AUTH_ALLOWED_TENANT_KEYS: process.env.AUTH_ALLOWED_TENANT_KEYS,
    AUTH_COOKIE_SECURE: process.env.AUTH_COOKIE_SECURE,
    AUTH_PUBLIC_BASE_URL: process.env.AUTH_PUBLIC_BASE_URL,
    AUTH_SESSION_SECRET: process.env.AUTH_SESSION_SECRET,
    FEISHU_APP_ID: process.env.FEISHU_APP_ID,
    FEISHU_APP_SECRET: process.env.FEISHU_APP_SECRET,
    FEISHU_REDIRECT_URI: process.env.FEISHU_REDIRECT_URI,
    GITLAB_URL: process.env.GITLAB_URL,
    GITLAB_API_TOKEN: process.env.GITLAB_API_TOKEN,
    COLA_HERMES_GITLAB_URL: process.env.COLA_HERMES_GITLAB_URL,
    COLA_HERMES_GITLAB_USERNAME: process.env.COLA_HERMES_GITLAB_USERNAME,
    COLA_HERMES_GITLAB_TOKEN: process.env.COLA_HERMES_GITLAB_TOKEN,
    NODE_ENV: process.env.NODE_ENV,
    NEXT_PUBLIC_OPENCLAW_NATIVE_URL:
      process.env.NEXT_PUBLIC_OPENCLAW_NATIVE_URL,
    NEXT_PUBLIC_HERMES_NATIVE_URL: process.env.NEXT_PUBLIC_HERMES_NATIVE_URL,
    NEXT_PUBLIC_UNSLOTH_STUDIO_URL: process.env.NEXT_PUBLIC_UNSLOTH_STUDIO_URL,
    NEXT_PUBLIC_K8S_DASHBOARD_URL: process.env.NEXT_PUBLIC_K8S_DASHBOARD_URL,
    NEXT_PUBLIC_HAMI_WEBUI_URL: process.env.NEXT_PUBLIC_HAMI_WEBUI_URL,
  },
  /**
   * Run `build` or `dev` with `SKIP_ENV_VALIDATION` to skip env validation. This is especially
   * useful for Docker builds.
   */
  skipValidation: !!process.env.SKIP_ENV_VALIDATION,
  /**
   * Makes it so that empty strings are treated as undefined. `SOME_VAR: z.string()` and
   * `SOME_VAR=''` will throw an error.
   */
  emptyStringAsUndefined: true,
});
