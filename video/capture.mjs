// 배포된 Shopkeeper 화면을 대화 단계마다 캡처하는 녹화 스크립트(ego-browser nodejs 전용)
const fs = await import("node:fs");
const root = "/Users/hahmjuntae/Desktop/workspace/personal/hackathons/paypal-shopkeeper/video/frames/";
fs.rmSync(root, { recursive: true, force: true });
fs.mkdirSync(root, { recursive: true });
const BUYER = "sb-5bhvq53806573@personal.example.com";
const STEPS = [
  { name: "invoice", say: `Invoice ${BUYER} for 2 hours of tutoring at USD 45 per hour, due Friday` },
  { name: "unpaid", say: "Which invoices are still unpaid?" },
  { name: "remind", say: "Send a friendly reminder for the tutoring invoice you just sent" },
  { name: "link", say: "Make a USD 9.50 payment link for a sticker pack" },
  { name: "cancel", say: "Cancel the tutoring invoice. The customer paid in cash.", approve: true },
];
const task = await taskSpace(94);
const p = task.page("p1");
await p.goto("https://shopkeeper-agent.graphite-site.workers.dev/");
await p.evaluate(() => localStorage.clear());
await p.goto("https://shopkeeper-agent.graphite-site.workers.dev/");
await p.cdp("Emulation.setDeviceMetricsOverride", { width: 1440, height: 810, deviceScaleFactor: 4 / 3, mobile: false });
await p.waitForTimeout(2500);
const log = [];
let dir = root + "intro/";
let n = 0;
const shot = async (tag) => {
  fs.mkdirSync(dir, { recursive: true });
  n += 1;
  const file = `${String(n).padStart(3, "0")}.png`;
  const r = await p.cdp("Page.captureScreenshot", { format: "png" });
  fs.writeFileSync(dir + file, Buffer.from(r.data, "base64"));
  return file;
};
const busy = () => p.evaluate(() => [...document.querySelectorAll(".muted")].some((e) => e.textContent.includes("Working")));
const sig = () => p.evaluate(() => document.querySelector(".log, main")?.innerText.length ?? document.body.innerText.length);
// 응답 글자 수가 바뀐 뒤 세 번 연속 그대로이고 작업 중 표시가 없을 때 완료로 판정
const waitDone = async (before) => {
  let last = before, same = 0;
  for (let i = 0; i < 120; i++) {
    await p.waitForTimeout(800);
    await shot("run");
    if (await p.evaluate(() => !!document.querySelector(".approve button.primary"))) return "approval";
    const now = await sig();
    const b = await busy();
    const lastIsBot = await p.evaluate(() => [...document.querySelectorAll(".msg")].filter((e) => !e.querySelector(".muted"))?.at(-1)?.classList.contains("assistant"));
    same = now === last && now !== before && !b && lastIsBot ? same + 1 : 0;
    last = now;
    if (same >= 3) return "done";
  }
  return "timeout";
};
await shot("empty");
for (const s of STEPS) {
  dir = root + s.name + "/";
  n = 0;
  await p.fill("css:input[aria-label=Message]", s.say);
  await shot("typed");
  const before = await sig();
  await p.press("css:input[aria-label=Message]", "Enter");
  let end = await waitDone(before);
  if (end === "approval" && s.approve) {
    await shot("card");
    await p.waitForTimeout(1500);
    await shot("card");
    const b2 = await sig();
    await p.click("css:.approve button.primary", { label: "Approve" });
    end = await waitDone(b2);
  }
  const err = await p.evaluate(() => document.querySelector(".err")?.textContent || "");
  log.push({ step: s.name, end, frames: n, err });
  await shot("hold");
}
await p.cdp("Emulation.clearDeviceMetricsOverride");
fs.writeFileSync(root + "log.json", JSON.stringify(log, null, 1));
console.log(JSON.stringify(log));
