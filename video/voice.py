# scenes.json 문장별 Kokoro 음성 생성(kokoro-venv 전용)
import json, sys, numpy as np, soundfile as sf
from kokoro import KPipeline
scenes, outdir, voice = sys.argv[1], sys.argv[2], sys.argv[3] if len(sys.argv) > 3 else "af_heart"
pipe = KPipeline(lang_code="a", repo_id="hexgrad/Kokoro-82M")
for i, s in enumerate(json.load(open(scenes)), 1):
    audio = np.concatenate([a for _, _, a in pipe(s.get("say", s["text"]), voice=voice, speed=1.0)])
    sf.write(f"{outdir}/{i:02d}.wav", audio, 24000)
    print(i, f"{len(audio)/24000:.1f}s", flush=True)
