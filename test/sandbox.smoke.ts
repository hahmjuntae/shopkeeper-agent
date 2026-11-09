// sandbox 실호출 점검, 키는 환경변수 주입 기준
import * as pp from "../src/paypal.ts";
const env = { PAYPAL_CLIENT_ID: process.env.PAYPAL_CLIENT_ID!, PAYPAL_CLIENT_SECRET: process.env.PAYPAL_CLIENT_SECRET! };
const buyer = process.env.BUYER_EMAIL!;
const inv = await pp.createAndSendInvoice(env, {
  customerEmail: buyer, customerName: "Test Buyer", currency: "USD",
  items: [{ name: "Logo design", quantity: 1, unitAmount: 120 }], dueDate: "2026-11-20", note: "Thank you"
});
console.log("invoice", inv.number, inv.id.slice(0, 6), Boolean(inv.payLink));
const sent = await pp.listInvoices(env, "SENT");
console.log("sent count", sent.length, sent.some((i: any) => i.id === inv.id));
console.log("remind", (await pp.remindInvoice(env, inv.id, "Friendly reminder")).reminded);
console.log("cancel", (await pp.cancelInvoice(env, inv.id, "Test cleanup")).cancelled);
const link = await pp.createPaymentLink(env, { description: "Sticker pack", amount: 9.5, currency: "USD", returnUrl: "https://example.com/paid" });
console.log("order", link.status, Boolean(link.payLink));
