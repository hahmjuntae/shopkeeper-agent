import { routeAgentRequest } from "agents";
import { AIChatAgent } from "@cloudflare/ai-chat";
import { streamText, convertToModelMessages, tool, isStepCount } from "ai";
import { createGoogleGenerativeAI } from "@ai-sdk/google";
import { z } from "zod";
import * as pp from "./paypal";

type Env = pp.PayPalEnv & {
  GEMINI_API_KEY: string;
  GEMINI_MODEL?: string;
  PUBLIC_URL?: string;
};

const SYSTEM = `You are Shopkeeper, a billing assistant for a one-person business.
You act on the owner's PayPal sandbox account through tools.
Rules:
- Use tools for every number. Never invent invoice ids, amounts, or links.
- Before you send an invoice, restate customer, items, total, and due date in one line.
- Refunds and cancellations need the owner's approval. The UI asks for it.
- Answer in short sentences. Show money as "USD 120.00".`;

// 무료 등급 503(수요 과다) 대비, 앞 모델 실패 시 다음 모델로 폴백
const MODELS = ["gemini-3.5-flash", "gemini-3.8-flash", "gemini-3.1-flash-lite", "gemini-3.5-flash-lite", "gemini-flash-latest"];

function fallbackModel(google: ReturnType<typeof createGoogleGenerativeAI>, first?: string) {
  const ids = [...new Set([first, ...MODELS].filter(Boolean) as string[])];
  const models = ids.map((id) => google(id));
  const head = models[0];
  const attempt = async <T>(run: (m: typeof head) => PromiseLike<T>): Promise<T> => {
    let last: unknown;
    for (const m of models) {
      try {
        return await run(m);
      } catch (e) {
        last = e;
        console.warn("shopkeeper model fallback", m.modelId, String((e as Error)?.message ?? e).slice(0, 120));
      }
    }
    throw last;
  };
  return {
    specificationVersion: head.specificationVersion,
    provider: head.provider,
    modelId: ids.join(" > "),
    supportedUrls: head.supportedUrls,
    doGenerate: (o: any) => attempt((m) => m.doGenerate(o)),
    doStream: (o: any) => attempt((m) => m.doStream(o))
  } as typeof head;
}

export class ShopkeeperAgent extends AIChatAgent<Env> {
  maxPersistedMessages = 200;

  async onChatMessage() {
    const env = this.env;
    const google = createGoogleGenerativeAI({ apiKey: env.GEMINI_API_KEY });
    const money = z.object({ value: z.number().positive(), currency: z.string().length(3) });

    const tools = {
      sendInvoice: tool({
        description: "Create a PayPal invoice and email it to the customer.",
        inputSchema: z.object({
          customerEmail: z.string().email(),
          customerName: z.string().optional(),
          currency: z.string().length(3).default("USD"),
          items: z
            .array(z.object({ name: z.string(), quantity: z.number().positive(), unitAmount: z.number().positive() }))
            .min(1),
          dueDate: z.string().describe("YYYY-MM-DD").optional(),
          note: z.string().optional()
        }),
        execute: (d) => pp.createAndSendInvoice(env, d)
      }),
      listInvoices: tool({
        description: "List recent invoices. Optional status filter: DRAFT, SENT, PAID, CANCELLED, PARTIALLY_PAID.",
        inputSchema: z.object({ status: z.string().optional() }),
        execute: ({ status }) => pp.listInvoices(env, status)
      }),
      remindInvoice: tool({
        description: "Send a payment reminder for an unpaid invoice.",
        inputSchema: z.object({ invoiceId: z.string(), note: z.string().optional() }),
        execute: ({ invoiceId, note }) => pp.remindInvoice(env, invoiceId, note)
      }),
      cancelInvoice: tool({
        description: "Cancel a sent invoice.",
        inputSchema: z.object({ invoiceId: z.string(), note: z.string().optional() }),
        needsApproval: async () => true,
        execute: ({ invoiceId, note }) => pp.cancelInvoice(env, invoiceId, note)
      }),
      createPaymentLink: tool({
        description: "Create a one-time PayPal checkout link for a quick sale.",
        inputSchema: z.object({ description: z.string(), amount: z.number().positive(), currency: z.string().length(3).default("USD") }),
        execute: (p) => pp.createPaymentLink(env, { ...p, returnUrl: `${env.PUBLIC_URL ?? "http://localhost:8788"}/paid` })
      }),
      capturePayment: tool({
        description: "Capture a checkout order after the buyer approved it.",
        inputSchema: z.object({ orderId: z.string() }),
        execute: ({ orderId }) => pp.captureOrder(env, orderId)
      }),
      refundPayment: tool({
        description: "Refund a captured payment, fully or partly.",
        inputSchema: z.object({ captureId: z.string(), amount: money.optional(), reason: z.string().optional() }),
        needsApproval: async () => true,
        execute: ({ captureId, amount, reason }) => pp.refundCapture(env, captureId, amount, reason)
      })
    };

    const result = streamText({
      model: fallbackModel(google, env.GEMINI_MODEL),
      maxRetries: 0,
      system: `${SYSTEM}\nToday is ${new Date().toISOString().slice(0, 10)}. Resolve relative dates like "Friday" from today.`,
      messages: await convertToModelMessages(this.messages),
      tools,
      stopWhen: isStepCount(6),
      onError: ({ error }) => console.error("shopkeeper stream", String((error as Error)?.message ?? error))
    });
    return result.toUIMessageStreamResponse();
  }
}

// 구매자 승인 뒤 PayPal 복귀 주소, 주문 캡처 후 영수증 표시
async function paid(url: URL, env: Env) {
  const orderId = url.searchParams.get("token");
  if (!orderId) return new Response("Missing order", { status: 400 });
  let body: string;
  try {
    const r = await pp.captureOrder(env, orderId);
    const amt = r.amount ? `${r.amount.currency_code} ${r.amount.value}` : "";
    body = `<h1>Payment received</h1><p>Order <code>${esc(orderId)}</code> is ${esc(r.status)}.</p><p>${esc(amt)}</p><p>Capture id <code>${esc(r.captureId ?? "")}</code>. Shopkeeper can refund it from the chat.</p>`;
  } catch (e) {
    body = `<h1>Payment not captured</h1><p>${esc(String((e as Error).message))}</p>`;
  }
  return new Response(`<!doctype html><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Shopkeeper receipt</title><link rel="stylesheet" href="/app.css"><div class="receipt">${body}<p><a href="/">Back to Shopkeeper</a></p></div>`, {
    headers: { "content-type": "text/html; charset=utf-8" }
  });
}

function esc(s: string) {
  return s.replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]!);
}

export default {
  async fetch(request: Request, env: Env) {
    const url = new URL(request.url);
    if (url.pathname === "/paid") return paid(url, env);
    return (await routeAgentRequest(request, env)) ?? new Response("Not found", { status: 404 });
  }
} satisfies ExportedHandler<Env>;
