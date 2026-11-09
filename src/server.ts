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
        execute: (p) => pp.createPaymentLink(env, { ...p, returnUrl: env.PUBLIC_URL ?? "https://example.com/paid" })
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
      model: google(env.GEMINI_MODEL ?? "gemini-flash-latest"),
      system: SYSTEM,
      messages: await convertToModelMessages(this.messages),
      tools,
      stopWhen: isStepCount(6)
    });
    return result.toUIMessageStreamResponse();
  }
}

export default {
  async fetch(request: Request, env: Env) {
    return (await routeAgentRequest(request, env)) ?? new Response("Not found", { status: 404 });
  }
} satisfies ExportedHandler<Env>;
