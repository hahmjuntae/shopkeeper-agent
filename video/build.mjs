// scenes.json 문장별 Kokoro 음성과 실제 화면 캡처를 MP4 하나로 합치는 스크립트
// 실행 기준: node video/build.mjs [출력.mp4] (video/out/work/NN.wav 선행 필요)
import fs from "node:fs";
import path from "node:path";
import { execFileSync } from "node:child_process";

const dir = path.dirname(new URL(import.meta.url).pathname);
const out = path.resolve(process.argv[2] ?? path.join(dir, "out", "shopkeeper-demo.mp4"));
const scenes = JSON.parse(fs.readFileSync(path.join(dir, "scenes.json"), "utf8"));
const work = path.join(dir, "out", "work");
const GAP = 0.6; // 문장 사이 쉼 기준, 초 단위
const HOLD = { 4: 1.0, 9: 1.2, 11: 1.0 }; // 결과 화면 머무름 기준
// 1920x1080 프레임 안 확대 영역 기준(x, y, w, h)
const CROPS = {};

const run = (cmd, args) => execFileSync(cmd, args, { stdio: ["ignore", "pipe", "pipe"] }).toString();
const duration = (f) => Number(run("ffprobe", ["-v", "error", "-show_entries", "format=duration", "-of", "csv=p=0", f]).trim());
const lastFrame = (name) => fs.readdirSync(path.join(dir, "frames", name)).filter((f) => f.endsWith(".png")).sort().at(-1);

function framePath(spec) {
  let [file, crop] = spec.split("@");
  const [folder, base] = file.split("/");
  if (base === "LAST") file = `${folder}/${lastFrame(folder)}`;
  const src = path.join(dir, "frames", file);
  if (!fs.existsSync(src)) throw new Error(`missing frame ${src}`);
  if (!crop) return src;
  const [x, y, w, h] = CROPS[crop];
  const dst = path.join(work, `${file.replace(/\W/g, "_")}-${crop}.png`);
  run("ffmpeg", ["-y", "-loglevel", "error", "-i", src, "-vf", `crop=${w}:${h}:${x}:${y},scale=1920:1080:flags=lanczos`, dst]);
  return dst;
}

const clips = [];
const srt = [];
let t = 0;
const stamp = (s) => new Date(s * 1000).toISOString().slice(11, 23).replace(".", ",");
scenes.forEach((scene, k) => {
  const n = k + 1;
  const id = String(n).padStart(2, "0");
  const wav = path.join(work, `${id}.wav`);
  const speech = duration(wav);
  const d = speech + GAP + (HOLD[n] ?? 0);
  const frames = scene.frames.map(framePath);
  const list = path.join(work, `${id}-frames.txt`);
  const each = d / frames.length;
  fs.writeFileSync(list, frames.map((f) => `file '${f}'\nduration ${each.toFixed(3)}`).join("\n") + `\nfile '${frames.at(-1)}'\n`);
  const clip = path.join(work, `${id}.mp4`);
  run("ffmpeg", ["-y", "-loglevel", "error", "-f", "concat", "-safe", "0", "-i", list, "-i", wav,
    "-af", `apad=pad_dur=${(d - speech).toFixed(3)}`, "-t", d.toFixed(3),
    "-vf", "scale=1920:1080:flags=lanczos,format=yuv420p,fps=30", "-c:v", "libx264", "-preset", "medium", "-crf", "18",
    "-c:a", "aac", "-ar", "48000", "-ac", "2", "-b:a", "160k", clip]);
  clips.push(clip);
  srt.push(`${n}\n${stamp(t)} --> ${stamp(t + speech)}\n${scene.text}\n`);
  t += d;
});
const all = path.join(work, "clips.txt");
fs.writeFileSync(all, clips.map((c) => `file '${c}'`).join("\n"));
fs.mkdirSync(path.dirname(out), { recursive: true });
run("ffmpeg", ["-y", "-loglevel", "error", "-f", "concat", "-safe", "0", "-i", all, "-c", "copy", "-movflags", "+faststart", out]);
fs.writeFileSync(out.replace(/\.mp4$/, ".srt"), srt.join("\n"));
console.log(JSON.stringify({ out, scenes: scenes.length, seconds: Number(duration(out).toFixed(1)) }));
