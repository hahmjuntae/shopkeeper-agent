# Shopkeeper

Tagline: For one-person businesses, Shopkeeper turns one sentence into a sent PayPal invoice, a reminder, or a checkout link.

## Inspiration

A tutor or a freelance designer gets paid for many small jobs. Each job needs an invoice, a due date, and often a reminder. The PayPal dashboard can do all of this. But one invoice takes many screens and form fields. Many owners skip the reminder, so the money comes late. I wanted a helper that does the paperwork from one plain sentence.

## What it does

You type what you sold. Shopkeeper calls the PayPal API for you.

- "Invoice dana@example.com for 2 hours of tutoring at USD 45 per hour, due Friday" creates and sends a PayPal invoice.
- "Which invoices are still unpaid?" shows a table with number, customer, total, due date, and status.
- "Send a reminder for my oldest unpaid invoice" finds the invoice and sends a PayPal reminder.
- "Make a USD 9.50 payment link for a sticker pack" creates a checkout order and gives the payer link.
- "Cancel invoice 0002" and "Refund USD 5 of that sale" stop and show an approval card. Nothing happens until you click Approve.

After a buyer pays with the link, PayPal returns to Shopkeeper. Shopkeeper captures the order and shows a receipt.

## How I built it

- Agent: Cloudflare Agents SDK (`AIChatAgent`). Each browser session gets its own Durable Object, and the chat history stays in that object.
- Model: Gemini through the Vercel AI SDK with tool calling. The system prompt tells the model to use a tool for every amount, id, and link.
- PayPal: Invoicing v2 (create, send, list, remind, cancel), Orders v2 (create, capture), and Payments v2 (refund). All calls use the sandbox.
- Safety: `cancelInvoice` and `refundPayment` use `needsApproval`. The model cannot run them without a human click.
- UI: React with a chat view, result tables, and approval cards.

## Challenges I ran into

- The free Gemini tier often returned "high demand" errors, and the chat stopped with no message. I added a model wrapper. It tries the next model in a fixed list, and the UI shows an error if all models fail.
- The PayPal Invoicing API returned 403 for a non-US sandbox business account. A US sandbox business account fixed it.
- Relative dates such as "due Friday" were wrong. The agent now puts the current date in the system prompt.

## Accomplishments that I'm proud of

- The full invoice flow works on the live demo: create, send, list, remind, and cancel with approval.
- The model does not invent invoice numbers or totals. Every number on the screen comes from a PayPal response.

## What I learned

Approval steps make an agent safe enough for money. A short tool list with clear names also gave better results than one large tool.

## What's next for Shopkeeper

- A weekly digest of unpaid invoices.
- Recurring invoices for monthly clients.
- Log in with PayPal, so each owner uses their own account. Today one deployment serves one owner.
- Test the buyer path end to end. I did not test the steps after a buyer pays: order capture and refund.

## Built with

cloudflare-workers, durable-objects, cloudflare-agents, gemini, vercel-ai-sdk, react, typescript, paypal-invoicing, paypal-orders

## AI tools used

- In the product: Gemini models plan the steps and call the PayPal tools.
- During development: I used Claude as a coding assistant to write and review parts of the code.

## Links

- Live demo (sandbox): https://shopkeeper-agent.graphite-site.workers.dev
- Code (MIT): https://github.com/hahmjuntae/shopkeeper-agent
- Video: (YouTube link)

All code is new and was written during the submission period.
