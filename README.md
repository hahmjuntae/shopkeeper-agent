# Shopkeeper

Shopkeeper is a billing assistant for one-person businesses. You tell it what you sold in plain words. It writes the PayPal invoice, sends it, follows up on unpaid invoices, and makes quick checkout links. Refunds and cancellations wait for your approval.

Live demo: https://shopkeeper-agent.graphite-site.workers.dev (PayPal sandbox, no real money)

## The problem

A tutor, a freelance designer, or a market stall owner gets paid in many small jobs. Each job needs an invoice, a due date, and often a reminder. The PayPal dashboard can do all of this. Each job takes many screens and form fields. Many owners skip the reminder. Then the money comes late.

Shopkeeper turns one sentence into the correct PayPal call:

| You say | Shopkeeper does |
|---|---|
| "Invoice dana@example.com for 2 hours of tutoring at USD 45 per hour, due Friday" | Creates invoice, sends it, shows number, total, and due date |
| "Which invoices are still unpaid?" | Lists invoices with status and due date |
| "Send a friendly reminder for my oldest unpaid invoice" | Finds the invoice and sends a PayPal reminder |
| "Make a USD 9.50 payment link for a sticker pack" | Creates a checkout order and gives the payer link |
| "Cancel invoice 0002, the customer paid in cash" | Asks you to approve, then cancels |
| "Refund USD 5 of that sale" | Asks you to approve, then refunds the capture |

## How it works

```
Browser (React)
  └─ WebSocket ─ ShopkeeperAgent (Cloudflare Durable Object, AIChatAgent)
                   ├─ Gemini (AI SDK streamText with tools)
                   └─ PayPal REST API (sandbox)
                        ├─ Invoicing v2: create, send, list, remind, cancel
                        ├─ Orders v2: create checkout order, capture
                        └─ Payments v2: refund capture
```

- Each browser session gets its own agent instance. The agent keeps the chat history in Durable Object storage.
- The model must use a tool for every amount, id, and link. The system prompt forbids made-up numbers.
- `cancelInvoice` and `refundPayment` have `needsApproval`. The model cannot run them until you click Approve.
- After the payer approves a checkout link, PayPal returns to `/paid`. The worker captures the order and shows a receipt.
- The free Gemini tier sometimes returns "high demand" errors. The agent then tries the next model in a fixed list.

## Built with

| Part | Project | License |
|---|---|---|
| Agent runtime | [cloudflare/agents](https://github.com/cloudflare/agents) (`AIChatAgent`, `useAgentChat`) | MIT |
| Model and tool calls | [vercel/ai](https://github.com/vercel/ai) with `@ai-sdk/google` | Apache-2.0 |
| UI | React 19 | MIT |
| Payments | PayPal REST APIs, sandbox | PayPal developer terms |

## Run it yourself

1. Create a PayPal sandbox REST app at https://developer.paypal.com. Use a US sandbox business account, because Invoicing needs it.
2. Get a free Gemini API key at https://aistudio.google.com.
3. Install packages.

   ```sh
   npm install
   ```

4. Create `.dev.vars` in the project root.

   ```sh
   PAYPAL_CLIENT_ID=...
   PAYPAL_CLIENT_SECRET=...
   GEMINI_API_KEY=...
   PUBLIC_URL=http://localhost:8788
   ```

5. Start the app. Then open http://localhost:8788.

   ```sh
   npm run dev
   ```

To deploy, run `npm run deploy` and set the same four values with `npx wrangler secret put <NAME>`.

## Tests

`test/sandbox.smoke.ts` calls the real sandbox. It creates, lists, reminds, and cancels an invoice. It also creates a checkout order.

```sh
PAYPAL_CLIENT_ID=... PAYPAL_CLIENT_SECRET=... BUYER_EMAIL=... node test/sandbox.smoke.ts
```

## What I built during the hackathon

I wrote all code in this repository during the PayPal AI Hackathon submission period (November 2026). I used AI coding assistants (Claude) to write and review parts of the code.

## Limits and next steps

- Sandbox only. A live version needs PayPal live credentials and an owner login.
- One owner per deployment. Multi-tenant use needs OAuth with each owner's PayPal account.
- The free model tier can be slow when demand is high. A paid model tier removes the fallback wait.
- Next: a weekly digest of unpaid invoices, and recurring invoices for monthly clients.

## License

MIT
