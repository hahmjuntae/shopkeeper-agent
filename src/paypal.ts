// PayPal sandbox REST 클라이언트, 자격 증명은 호출자 주입 기준

export type PayPalEnv = {
  PAYPAL_CLIENT_ID: string;
  PAYPAL_CLIENT_SECRET: string;
  PAYPAL_BASE?: string;
};

const SANDBOX = "https://api-m.sandbox.paypal.com";

type Token = { value: string; expiresAt: number };
let cached: Token | null = null;

async function token(env: PayPalEnv): Promise<string> {
  if (cached && cached.expiresAt > Date.now() + 60_000) return cached.value;
  const res = await fetch(`${env.PAYPAL_BASE ?? SANDBOX}/v1/oauth2/token`, {
    method: "POST",
    headers: {
      Authorization: "Basic " + btoa(`${env.PAYPAL_CLIENT_ID}:${env.PAYPAL_CLIENT_SECRET}`),
      "Content-Type": "application/x-www-form-urlencoded"
    },
    body: "grant_type=client_credentials"
  });
  if (!res.ok) throw new Error(`PayPal auth failed: ${res.status}`);
  const data = (await res.json()) as { access_token: string; expires_in: number };
  cached = { value: data.access_token, expiresAt: Date.now() + data.expires_in * 1000 };
  return cached.value;
}

export async function call<T = any>(
  env: PayPalEnv,
  method: string,
  path: string,
  body?: unknown
): Promise<T> {
  const res = await fetch(`${env.PAYPAL_BASE ?? SANDBOX}${path}`, {
    method,
    headers: {
      Authorization: `Bearer ${await token(env)}`,
      "Content-Type": "application/json",
      Prefer: "return=representation"
    },
    body: body === undefined ? undefined : JSON.stringify(body)
  });
  const text = await res.text();
  const data = text ? JSON.parse(text) : {};
  if (!res.ok) {
    const detail = data?.details?.[0]?.description ?? data?.message ?? text.slice(0, 200);
    throw new Error(`PayPal ${method} ${path} failed (${res.status}): ${detail}`);
  }
  return data as T;
}

export type InvoiceLine = { name: string; quantity: number; unitAmount: number };

export type InvoiceDraft = {
  customerEmail: string;
  customerName?: string;
  currency: string;
  items: InvoiceLine[];
  dueDate?: string;
  note?: string;
};

export async function createAndSendInvoice(env: PayPalEnv, d: InvoiceDraft) {
  const { invoice_number } = await call<{ invoice_number: string }>(
    env, "POST", "/v2/invoicing/generate-next-invoice-number"
  );
  const draft = await call(env, "POST", "/v2/invoicing/invoices", {
    detail: {
      invoice_number,
      currency_code: d.currency,
      note: d.note,
      payment_term: d.dueDate ? { due_date: d.dueDate } : undefined
    },
    primary_recipients: [
      {
        billing_info: {
          email_address: d.customerEmail,
          name: d.customerName ? { full_name: d.customerName } : undefined
        }
      }
    ],
    items: d.items.map((i) => ({
      name: i.name,
      quantity: String(i.quantity),
      unit_amount: { currency_code: d.currency, value: i.unitAmount.toFixed(2) }
    }))
  });
  const id: string = draft.id;
  const sent = await call(env, "POST", `/v2/invoicing/invoices/${id}/send`, {
    send_to_invoicer: false,
    send_to_recipient: true
  });
  return { id, number: invoice_number, payLink: sent?.href ?? null };
}

export async function listInvoices(env: PayPalEnv, status?: string) {
  const data = await call(env, "GET", "/v2/invoicing/invoices?page_size=50&total_required=true");
  const items = (data.items ?? []).map((i: any) => ({
    id: i.id,
    number: i.detail?.invoice_number,
    status: i.status,
    customer: i.primary_recipients?.[0]?.billing_info?.email_address,
    amount: i.amount?.value,
    currency: i.amount?.currency_code,
    due: i.detail?.payment_term?.due_date ?? null,
    created: i.detail?.metadata?.create_time
  }));
  return status ? items.filter((i: any) => i.status === status) : items;
}

export async function remindInvoice(env: PayPalEnv, id: string, note?: string) {
  await call(env, "POST", `/v2/invoicing/invoices/${id}/remind`, {
    note,
    send_to_invoicer: false,
    send_to_recipient: true
  });
  return { id, reminded: true };
}

export async function cancelInvoice(env: PayPalEnv, id: string, note?: string) {
  await call(env, "POST", `/v2/invoicing/invoices/${id}/cancel`, {
    note,
    send_to_invoicer: false,
    send_to_recipient: true
  });
  return { id, cancelled: true };
}

export async function createPaymentLink(
  env: PayPalEnv,
  p: { description: string; amount: number; currency: string; returnUrl: string }
) {
  const order = await call(env, "POST", "/v2/checkout/orders", {
    intent: "CAPTURE",
    purchase_units: [
      { description: p.description, amount: { currency_code: p.currency, value: p.amount.toFixed(2) } }
    ],
    payment_source: {
      paypal: {
        experience_context: { return_url: p.returnUrl, cancel_url: p.returnUrl, user_action: "PAY_NOW" }
      }
    }
  });
  const approve = order.links?.find((l: any) => l.rel === "payer-action" || l.rel === "approve");
  return { orderId: order.id, status: order.status, payLink: approve?.href ?? null };
}

export async function captureOrder(env: PayPalEnv, orderId: string) {
  const r = await call(env, "POST", `/v2/checkout/orders/${orderId}/capture`, {});
  const cap = r.purchase_units?.[0]?.payments?.captures?.[0];
  return { orderId, status: r.status, captureId: cap?.id, amount: cap?.amount };
}

export async function refundCapture(
  env: PayPalEnv,
  captureId: string,
  amount?: { value: number; currency: string },
  reason?: string
) {
  const r = await call(env, "POST", `/v2/payments/captures/${captureId}/refund`, {
    amount: amount ? { value: amount.value.toFixed(2), currency_code: amount.currency } : undefined,
    note_to_payer: reason
  });
  return { refundId: r.id, status: r.status, amount: r.amount };
}
