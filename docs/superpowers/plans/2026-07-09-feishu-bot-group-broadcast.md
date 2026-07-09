# Feishu Bot Group Broadcast Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Send Hermes task result cards to every Feishu group that has invited the Xdream-cloud app bot.

**Architecture:** Replace webhook-only group delivery with app-bot chat discovery plus interactive-card delivery. Keep personal open_id notifications unchanged, and keep webhook delivery only as a fallback when app credentials are absent.

**Tech Stack:** TypeScript, Node test runner, Feishu OpenAPI, existing `src/server/office/feishu-notifier.ts`.

---

### Task 1: App-Bot Group Card Broadcast

**Files:**

- Modify: `src/server/office/feishu-notifier.ts`
- Test: `src/server/office/feishu-notifier.test.ts`

- [x] **Step 1: Write failing tests**

Update group notification tests so `notifyHermesTaskResultToFeishu()` uses `FEISHU_APP_ID` and `FEISHU_APP_SECRET` to fetch a tenant token, list bot groups through `/im/v1/chats`, and send an interactive card to each returned `chat_id`.

- [x] **Step 2: Verify failure**

Run: `node --test src/server/office/feishu-notifier.test.ts`

Expected: the new app-bot broadcast test fails because the implementation still requires `COLA_HERMES_FEISHU_WEBHOOK_URL`.

- [x] **Step 3: Implement minimal broadcast**

Add `listFeishuBotGroupChatIds()` and `sendFeishuChatCard()` helpers in `src/server/office/feishu-notifier.ts`. Change `notifyHermesTaskResultToFeishu()` to prefer app credentials and send to listed groups; fall back to the existing webhook path when app credentials are unavailable.

- [x] **Step 4: Verify**

Run:

```bash
node --test src/server/office/feishu-notifier.test.ts
npm exec tsc -- --noEmit
npm exec prettier -- --check src/server/office/feishu-notifier.ts src/server/office/feishu-notifier.test.ts
```

Expected: all commands exit 0.
