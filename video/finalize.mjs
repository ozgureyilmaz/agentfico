#!/usr/bin/env node
import { spawnSync } from "node:child_process";
import { readFileSync, statSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";

const root = resolve(import.meta.dirname, "..");
const out = join(root, "video/out");
const manifest = JSON.parse(
  readFileSync(join(out, "capture-manifest.json"), "utf8"),
);
if (!manifest.segments?.length) throw new Error("No recorded scenes to render");
if (manifest.blocked_external_origins?.length) {
  throw new Error(
    `Unexpected external origins were requested: ${manifest.blocked_external_origins.join(", ")}`,
  );
}
if (manifest.console_errors?.length) {
  throw new Error(
    `Browser console errors were captured: ${manifest.console_errors.join(" | ")}`,
  );
}

const ffmpeg = process.env.FFMPEG ?? "ffmpeg";
const ffprobe = process.env.FFPROBE ?? "ffprobe";
const transition = Number(manifest.transition_seconds ?? 0.35);
const targetDuration = Number(manifest.duration_seconds);
const width = Number(manifest.viewport?.width ?? 1920);
const height = Number(manifest.viewport?.height ?? 1080);
const fps = Number(manifest.fps ?? 30);
const destination = join(out, "agentfico-demo.mp4");
const args = ["-hide_banner", "-y", "-loglevel", "warning"];
for (const segment of manifest.segments) args.push("-i", segment.file);
args.push(
  "-f",
  "lavfi",
  "-t",
  String(targetDuration),
  "-i",
  "anullsrc=channel_layout=stereo:sample_rate=48000",
);

const filters = [];
for (let index = 0; index < manifest.segments.length; index += 1) {
  const scene = manifest.segments[index];
  const duration = Number(scene.source_seconds);
  filters.push(
    `[${index}:v]fps=${fps},scale=${width}:${height}:force_original_aspect_ratio=decrease,pad=${width}:${height}:(ow-iw)/2:(oh-ih)/2:color=0xe7eaf3,tpad=stop_mode=clone:stop_duration=1,trim=duration=${duration.toFixed(3)},setpts=PTS-STARTPTS,setsar=1,format=yuv420p,settb=1/${fps}[v${index}]`,
  );
}
let previous = "v0";
let visibleOffset = Number(manifest.segments[0].visible_seconds);
for (let index = 1; index < manifest.segments.length; index += 1) {
  const next = `mix${index}`;
  filters.push(
    `[${previous}][v${index}]xfade=transition=fade:duration=${transition.toFixed(3)}:offset=${visibleOffset.toFixed(3)}[${next}]`,
  );
  previous = next;
  visibleOffset += Number(manifest.segments[index].visible_seconds);
}
filters.push(
  `[${manifest.segments.length}:a]atrim=duration=${targetDuration},asetpts=PTS-STARTPTS,aresample=48000[aout]`,
);
args.push(
  "-filter_complex",
  filters.join(";"),
  "-map",
  `[${previous}]`,
  "-map",
  "[aout]",
  "-t",
  String(targetDuration),
  "-r",
  String(fps),
  "-c:v",
  "libx264",
  "-preset",
  "medium",
  "-crf",
  "22",
  "-profile:v",
  "high",
  "-pix_fmt",
  "yuv420p",
  "-c:a",
  "aac",
  "-b:a",
  "96k",
  "-ar",
  "48000",
  "-ac",
  "2",
  "-movflags",
  "+faststart",
  "-metadata",
  "title=AgentFICO · Trust, made legible",
  "-metadata",
  "comment=Local fixture demonstration with a silent stereo track",
  destination,
);

const rendered = spawnSync(ffmpeg, args, { cwd: root, encoding: "utf8" });
if (rendered.status !== 0) {
  throw new Error(
    `ffmpeg failed (${rendered.status}): ${rendered.stderr || rendered.stdout}`,
  );
}
const probe = spawnSync(
  ffprobe,
  [
    "-v",
    "error",
    "-show_entries",
    "format=duration,size:stream=codec_name,width,height,r_frame_rate,sample_rate,channels",
    "-of",
    "json",
    destination,
  ],
  { cwd: root, encoding: "utf8" },
);
if (probe.status !== 0) throw new Error(`ffprobe failed: ${probe.stderr}`);
const data = JSON.parse(probe.stdout);
const video = data.streams.find((stream) => stream.codec_name === "h264");
const audio = data.streams.find((stream) => stream.codec_name === "aac");
const duration = Number(data.format.duration);
const size = statSync(destination).size;
if (
  !video ||
  video.width !== width ||
  video.height !== height ||
  video.r_frame_rate !== `${fps}/1`
) {
  throw new Error(`Rendered video metadata failed: ${JSON.stringify(video)}`);
}
if (
  !audio ||
  Number(audio.sample_rate) !== 48000 ||
  Number(audio.channels) !== 2
) {
  throw new Error(
    `Rendered audio track metadata failed: ${JSON.stringify(audio)}`,
  );
}
if (Math.abs(duration - targetDuration) > 0.05) {
  throw new Error(`Expected ${targetDuration}s runtime, got ${duration}s`);
}
const metadata = {
  file: destination,
  runtime_seconds: duration,
  resolution: `${width}x${height}`,
  frame_rate: video.r_frame_rate,
  video_codec: video.codec_name,
  audio_codec: audio.codec_name,
  audio_sample_rate: Number(audio.sample_rate),
  audio_channels: Number(audio.channels),
  audio_content: "silent stereo track",
  file_size_bytes: size,
  file_size_mib: Number((size / (1024 * 1024)).toFixed(2)),
  segment_count: manifest.segments.length,
  transition_seconds: transition,
  source: "local AgentFICO app and recorded fixtures",
};
writeFileSync(
  join(out, "render-metadata.json"),
  JSON.stringify(metadata, null, 2),
);
console.log(JSON.stringify(metadata, null, 2));
