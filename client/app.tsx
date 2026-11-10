import { createRoot } from "react-dom/client";
import { useEffect, useRef, useState } from "react";
import { useAgent } from "agents/react";
import { useAgentChat } from "@cloudflare/ai-chat/react";

const LABEL: Record<string, string> = {
  sendInvoice: "Send invoice",
  listInvoices: "List invoices",
  remindInvoice: "Send reminder",
  cancelInvoice: "Cancel invoice",
  createPaymentLink: "Create payment link",
  capturePayment: "Capture payment",
  refundPayment: "Refund payment"
};

const STARTERS = [
  "Invoice dana@example.com for 2 hours of tutoring at USD 45 per hour, due Friday",
  "Which invoices are still unpaid?",
  "Make a USD 9.50 payment link for a sticker pack",
  "Send a friendly reminder for my oldest unpaid invoice"
];

// 세션마다 별도 Durable Object 대상, 심사위원 간 대화 섞임 방지
function sessionName() {
  try {
    const k = "shopkeeper-session";
    let v = localStorage.getItem(k);
    if (!v) {
      v = crypto.randomUUID();
      localStorage.setItem(k, v);
    }
    return v;
  } catch {
    return crypto.randomUUID();
  }
}

function money(v: any) {
  if (!v) return "";
  if (typeof v === "object" && "value" in v) return `${v.currency_code ?? v.currency ?? ""} ${Number(v.value).toFixed(2)}`;
  return String(v);
}

function Output({ name, out }: { name: string; out: any }) {
  if (out == null) return null;
  if (Array.isArray(out)) {
    if (!out.length) return <p className="muted">No results.</p>;
    return (
      <table className="rows">
        <thead>
          <tr><th>Invoice</th><th>Customer</th><th>Total</th><th>Due</th><th>Status</th></tr>
        </thead>
        <tbody>
          {out.slice(0, 8).map((r: any, i: number) => (
            <tr key={r.id ?? i}>
              <td className="num">{r.number ?? r.id}</td>
              <td>{r.customer ?? r.recipient ?? ""}</td>
              <td className="num">{r.currency ? `${r.currency} ${Number(r.amount).toFixed(2)}` : money(r.amount)}</td>
              <td className="num">{r.due ?? ""}</td>
              <td><span className={`pill ${String(r.status).toLowerCase()}`}>{r.status}</span></td>
            </tr>
          ))}
        </tbody>
      </table>
    );
  }
  const link = out.payLink ?? out.link;
  const rows = Object.entries(out).filter(([k, v]) => k !== "payLink" && k !== "link" && typeof v !== "object");
  return (
    <div>
      <dl className="kv">
        {rows.map(([k, v]) => (
          <div key={k}><dt>{k}</dt><dd className="num">{String(v)}</dd></div>
        ))}
      </dl>
      {link && <a className="paylink" href={link} target="_blank" rel="noreferrer">Open PayPal checkout</a>}
    </div>
  );
}

function ToolPart({ part, onApprove }: { part: any; onApprove: (id: string, ok: boolean) => void }) {
  const name = part.type.replace(/^tool-/, "");
  const label = LABEL[name] ?? name;
  const state: string = part.state;
  const input = part.input ?? {};
  return (
    <div className={`tool ${state}`}>
      <div className="tool-head">
        <span className="tool-name">{label}</span>
        <span className="tool-state">
          {state === "output-available" ? "done" : state === "approval-requested" ? "needs your OK" : state === "output-error" ? "failed" : state === "output-denied" ? "declined" : "working"}
        </span>
      </div>
      {state === "approval-requested" && (
        <div className="approve">
          <p>
            {name === "refundPayment"
              ? `Refund ${input.amount ? money(input.amount) : "the full amount"} on capture ${input.captureId}?`
              : `Cancel invoice ${input.invoiceId}?`}
          </p>
          <div className="btns">
            <button className="primary" onClick={() => onApprove(part.approval.id, true)}>Approve</button>
            <button onClick={() => onApprove(part.approval.id, false)}>Decline</button>
          </div>
        </div>
      )}
      {state === "output-available" && <Output name={name} out={part.output} />}
      {state === "output-error" && <p className="err">{part.errorText}</p>}
    </div>
  );
}

function App() {
  const agent = useAgent({ agent: "ShopkeeperAgent", name: sessionName() });
  const { messages, sendMessage, addToolApprovalResponse, clearHistory, status } = useAgentChat({ agent });
  const [text, setText] = useState("");
  const end = useRef<HTMLDivElement>(null);
  useEffect(() => { end.current?.scrollIntoView({ behavior: "smooth" }); }, [messages]);
  const busy = status === "submitted" || status === "streaming";

  const send = (t: string) => {
    const v = t.trim();
    if (!v || busy) return;
    sendMessage({ role: "user", parts: [{ type: "text", text: v }] });
    setText("");
  };

  return (
    <div className="shell">
      <header>
        <div>
          <h1>Shopkeeper</h1>
          <p>Billing assistant for one-person businesses. Runs on the PayPal sandbox.</p>
        </div>
        <button className="ghost" onClick={clearHistory}>New chat</button>
      </header>
      <main>
        {messages.length === 0 && (
          <section className="empty">
            <p>Tell Shopkeeper what you sold. It writes the invoice, sends it, and follows up.</p>
            <div className="starters">
              {STARTERS.map((s) => (
                <button key={s} onClick={() => send(s)}>{s}</button>
              ))}
            </div>
          </section>
        )}
        {messages.map((m) => (
          <div key={m.id} className={`msg ${m.role}`}>
            {m.parts.map((p: any, i: number) =>
              p.type === "text" ? (
                <p key={i} className="text">{p.text}</p>
              ) : p.type.startsWith("tool-") ? (
                <ToolPart key={i} part={p} onApprove={(id, ok) => addToolApprovalResponse({ id, approved: ok })} />
              ) : null
            )}
          </div>
        ))}
        {busy && <div className="msg assistant"><p className="muted">Working…</p></div>}
        {status === "error" && <div className="msg assistant"><p className="err">The AI model is busy right now. Send the message again in a moment.</p></div>}
        <div ref={end} />
      </main>
      <form
        onSubmit={(e) => {
          e.preventDefault();
          send(text);
        }}
      >
        <input value={text} onChange={(e) => setText(e.target.value)} placeholder="Invoice Sam for a logo, USD 120, due next Monday" aria-label="Message" />
        <button className="primary" disabled={busy || !text.trim()}>Send</button>
      </form>
    </div>
  );
}

createRoot(document.getElementById("root")!).render(<App />);
