import { createHash } from "node:crypto";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { resolve, join } from "node:path";
import { spawnSync } from "node:child_process";

// Reproduce the 2026-09-25 native v0.10.6 recording edit. The source stays local:
// its unused lead-in includes account information and must not be published.
const source = resolve(
  process.argv[2] ?? ".tooling/recording-20260925/native-take-04.mp4",
);
const outputDirectory = resolve(
  process.argv[3] ?? ".tooling/recording-20260925/export",
);
mkdirSync(outputDirectory, { recursive: true });
const sourceSha256 = createHash("sha256")
  .update(readFileSync(source))
  .digest("hex");
if (
  sourceSha256 !==
  "d114f8498ac0c29e470d76432b571f14e9f048fedf10c101aec7572143dfeeb4"
) {
  throw new Error(
    "This edit requires the reviewed original take; review new footage before changing the cuts.",
  );
}
const segments = [
  [98, 107],
  [120, 127],
  [138, 144],
  [156, 160],
  [176, 180],
];
const captions = [
  [
    0,
    4,
    "全局看进度，每个会话都有状态",
    "Track progress across your agent sessions",
  ],
  [
    4,
    9,
    "点提醒，回到对应会话",
    "Click a notification to return to the right session",
  ],
  [9, 16, "补充需求，继续推进", "Add context and keep the conversation moving"],
  [16, 22, "回复后，Agent 继续执行", "Your reply puts the agent back to work"],
  [22, 27, "两个会话，并排查看结果", "Review both sessions side by side"],
  [
    27,
    30,
    "Termexo · 开源 Windows Agent 工作台",
    "Explore the project at github.com/gemron/Termexo",
  ],
];
const assTime = (seconds) =>
  `0:${String(Math.floor(seconds / 60)).padStart(2, "0")}:${String(seconds % 60).padStart(2, "0")}.00`;
const events = captions.flatMap(([start, end, zh, en]) => [
  `Dialogue: 0,${assTime(start)},${assTime(end)},Chinese,,0,0,0,,${zh}`,
  `Dialogue: 0,${assTime(start)},${assTime(end)},English,,0,0,0,,${en}`,
]);
writeFileSync(
  join(outputDirectory, "captions.ass"),
  `[Script Info]
ScriptType: v4.00+
PlayResX: 1440
PlayResY: 1000
WrapStyle: 2

[V4+ Styles]
Format: Name, Fontname, Fontsize, PrimaryColour, SecondaryColour, OutlineColour, BackColour, Bold, Italic, Underline, StrikeOut, ScaleX, ScaleY, Spacing, Angle, BorderStyle, Outline, Shadow, Alignment, MarginL, MarginR, MarginV, Encoding
Style: Chinese,Microsoft YaHei,28,&H00EEF6F2,&H00EEF6F2,&H00131C19,&H00131C19,-1,0,0,0,100,100,0,0,1,0,0,2,180,180,47,1
Style: English,Arial,19,&H00ACBEB5,&H00ACBEB5,&H00131C19,&H00131C19,0,0,0,0,100,100,0,0,1,0,0,2,180,180,19,1
Style: Meta,Microsoft YaHei,14,&H0099B8AA,&H0099B8AA,&H00131C19,&H00131C19,0,0,0,0,100,100,0,0,1,0,0,7,0,0,0,1

[Events]
Format: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text
Dialogue: 0,0:00:00.00,0:00:30.00,Meta,,0,0,0,,{\\pos(22,921)}v0.10.6\\NWindows 实录
Dialogue: 0,0:00:00.00,0:00:30.00,Meta,,0,0,0,,{\\an9\\pos(1418,921)}等待片段已剪去\\NIdle time trimmed
${events.join("\n")}
`,
  "utf8",
);

function run(command, args) {
  const result = spawnSync(command, args, {
    cwd: outputDirectory,
    encoding: "utf8",
    windowsHide: true,
  });
  if (result.status !== 0)
    throw new Error(`${command} failed: ${result.stderr}`);
  return result.stdout;
}
const trims = segments.map(
  ([start, end], index) =>
    `[0:v]trim=start=${start}:end=${end},setpts=PTS-STARTPTS[v${index}]`,
);
const filter = `${trims.join(";")};${segments.map((_, index) => `[v${index}]`).join("")}concat=n=${segments.length}:v=1:a=0,pad=1440:1000:0:0:color=0x0d1b18,drawbox=x=0:y=900:w=iw:h=2:color=0x40725e:t=fill,subtitles=captions.ass,format=yuv420p[out]`;
run("ffmpeg", [
  "-hide_banner",
  "-loglevel",
  "error",
  "-i",
  source,
  "-filter_complex",
  filter,
  "-map",
  "[out]",
  "-an",
  "-c:v",
  "libx264",
  "-preset",
  "slow",
  "-crf",
  "19",
  "-movflags",
  "+faststart",
  "-y",
  "termexo-workbench-demo.mp4",
]);
run("ffmpeg", [
  "-hide_banner",
  "-loglevel",
  "error",
  "-ss",
  "26.5",
  "-i",
  "termexo-workbench-demo.mp4",
  "-frames:v",
  "1",
  "-y",
  "termexo-workbench-demo.png",
]);
const probe = JSON.parse(
  run("ffprobe", [
    "-v",
    "error",
    "-show_entries",
    "format=duration,size:stream=codec_name,width,height,r_frame_rate",
    "-of",
    "json",
    "termexo-workbench-demo.mp4",
  ]),
);
const metadata = {
  recordedAt: "2026-09-25",
  applicationVersion: "0.10.6",
  agent: "Antigravity CLI 1.2.10",
  model: "Gemini 3.8 Flash (High)",
  sourceSha256,
  sourceSegmentsSeconds: segments,
  edits: [
    "Cut waiting intervals",
    "Add bilingual captions outside the native window",
  ],
  description:
    "Two real Antigravity sessions in demo-web; completion notifications, return to session, reply, and split view. No waiting-for-approval claim.",
  ...probe,
};
writeFileSync(
  join(outputDirectory, "recording-metadata.json"),
  `${JSON.stringify(metadata, null, 2)}\n`,
);
console.log(
  JSON.stringify({
    outputDirectory,
    duration: probe.format.duration,
    streams: probe.streams,
  }),
);
