import { spawn } from 'node:child_process';
import { mkdir, rm, stat, writeFile } from 'node:fs/promises';
import { createWriteStream } from 'node:fs';
import { join } from 'node:path';

/**
 * Records a Playwright page through the CDP screencast API and renders the frames with ffmpeg.
 *
 * CDP only pushes a frame when the page actually repaints, so the capture is variable-rate.
 * The frame timestamps are therefore kept and replayed through an ffmpeg concat playlist with
 * per-frame durations, which keeps typing and terminal output at their real speed instead of
 * stretching or compressing them to a fixed frame rate.
 */

const FRAME_FORMAT = 'jpeg';
const FRAME_QUALITY = 92;
const FRAME_FILE_PREFIX = 'frame-';
const FRAME_INDEX_PADDING = 6;
const TRAILING_FRAME_SECONDS = 0.6;
const MAXIMUM_FRAME_GAP_SECONDS = 2;
/** How long the frame before a paused stretch is held, standing in for the skipped time. */
const SEGMENT_CUT_SECONDS = 0.8;

const VIDEO_FRAME_RATE = 30;
const VIDEO_CRF = 20;

/** WeChat rejects images above 10 MB, so the ladder stays under that with room to spare. */
const GIF_SIZE_LIMIT_BYTES = 9 * 1024 * 1024;
const GIF_QUALITY_LADDER = [
  { frameRate: 14, width: 1000 },
  { frameRate: 12, width: 900 },
  { frameRate: 10, width: 800 },
  { frameRate: 8, width: 700 },
  { frameRate: 6, width: 620 },
];

const ffmpegExecutable = process.env.FFMPEG_PATH ?? 'ffmpeg';

/**
 * Starts a screencast. The returned handle writes frames to disk as they arrive so that long
 * recordings do not accumulate base64 payloads in memory.
 */
export async function startRecording(page, { frameDirectory, maxWidth, maxHeight }) {
  await mkdir(frameDirectory, { recursive: true });

  const session = await page.context().newCDPSession(page);
  const screencastOptions = {
    format: FRAME_FORMAT,
    quality: FRAME_QUALITY,
    maxWidth,
    maxHeight,
    everyNthFrame: 1,
  };
  const frames = [];
  const pendingWrites = [];
  /** Frame indices that begin a segment, so the pause is replayed as a short cut. */
  const segmentStarts = new Set();
  let stopped = false;
  let paused = false;

  session.on('Page.screencastFrame', (event) => {
    if (stopped || paused) {
      return;
    }
    const index = frames.length;
    const fileName = `${FRAME_FILE_PREFIX}${String(index).padStart(FRAME_INDEX_PADDING, '0')}.jpg`;
    frames.push({ fileName, timestamp: event.metadata.timestamp });
    pendingWrites.push(
      writeFile(join(frameDirectory, fileName), Buffer.from(event.data, 'base64')),
    );
    // Acknowledging is what asks WebView2 for the next frame; without it the stream stalls.
    session.send('Page.screencastFrameAck', { sessionId: event.sessionId }).catch(() => undefined);
  });

  await session.send('Page.startScreencast', screencastOptions);

  return {
    /**
     * Stops capturing without ending the recording.
     * Used to skip over long unattended stretches — an Agent working for three minutes is real,
     * but nobody watches three minutes of a blinking cursor, and the blinking keeps producing
     * frames so it cannot be compressed away afterwards.
     */
    async pause() {
      if (paused || stopped) {
        return;
      }
      paused = true;
      await session.send('Page.stopScreencast').catch(() => undefined);
    },
    async resume() {
      if (!paused || stopped) {
        return;
      }
      paused = false;
      segmentStarts.add(frames.length);
      await session.send('Page.startScreencast', screencastOptions);
    },
    async stop() {
      stopped = true;
      await session.send('Page.stopScreencast').catch(() => undefined);
      await session.detach().catch(() => undefined);
      await Promise.all(pendingWrites);
      if (frames.length === 0) {
        throw new Error('The screencast produced no frames.');
      }
      const playlistPath = await writeConcatPlaylist(frameDirectory, frames, segmentStarts);
      return { frameDirectory, playlistPath, frameCount: frames.length };
    },
  };
}

/** Renders an H.264 MP4 suitable for the website, WeChat Channels and release notes. */
export async function renderVideo({ frameDirectory, playlistPath }, outputPath) {
  await runFfmpeg(
    [
      '-y',
      '-f',
      'concat',
      '-safe',
      '0',
      '-i',
      playlistPath,
      '-vf',
      `fps=${VIDEO_FRAME_RATE},scale=trunc(iw/2)*2:trunc(ih/2)*2`,
      '-c:v',
      'libx264',
      '-preset',
      'slow',
      '-crf',
      String(VIDEO_CRF),
      '-pix_fmt',
      'yuv420p',
      '-movflags',
      '+faststart',
      outputPath,
    ],
    frameDirectory,
  );
  return { path: outputPath, bytes: (await stat(outputPath)).size };
}

/**
 * Renders a GIF, stepping down frame rate and width until it fits the size limit.
 * Terminal output is high-contrast text on a flat background, so a diff-based palette keeps it
 * readable at far smaller sizes than a naive single-palette encode.
 */
export async function renderAnimatedGif(
  { frameDirectory, playlistPath },
  outputPath,
  { sizeLimitBytes = GIF_SIZE_LIMIT_BYTES } = {},
) {
  const palettePath = join(frameDirectory, 'palette.png');
  let lastAttempt;

  for (const { frameRate, width } of GIF_QUALITY_LADDER) {
    const scaleFilter = `fps=${frameRate},scale=${width}:-1:flags=lanczos`;
    await runFfmpeg(
      [
        '-y',
        '-f',
        'concat',
        '-safe',
        '0',
        '-i',
        playlistPath,
        '-vf',
        `${scaleFilter},palettegen=stats_mode=diff`,
        palettePath,
      ],
      frameDirectory,
    );
    await runFfmpeg(
      [
        '-y',
        '-f',
        'concat',
        '-safe',
        '0',
        '-i',
        playlistPath,
        '-i',
        palettePath,
        '-lavfi',
        `${scaleFilter}[x];[x][1:v]paletteuse=dither=bayer:bayer_scale=3:diff_mode=rectangle`,
        '-loop',
        '0',
        outputPath,
      ],
      frameDirectory,
    );

    const bytes = (await stat(outputPath)).size;
    lastAttempt = { path: outputPath, bytes, frameRate, width };
    if (bytes <= sizeLimitBytes) {
      return lastAttempt;
    }
  }

  return { ...lastAttempt, exceedsSizeLimit: true };
}

export async function discardFrames(frameDirectory) {
  await rm(frameDirectory, { recursive: true, force: true });
}

/**
 * Writes an ffconcat playlist that replays the captured timestamps.
 * A stalled page can leave a multi-second gap between frames; those are clamped so a pause while
 * an Agent thinks does not turn into a frozen clip.
 */
async function writeConcatPlaylist(frameDirectory, frames, segmentStarts = new Set()) {
  const playlistPath = join(frameDirectory, 'frames.ffconcat');
  const stream = createWriteStream(playlistPath);
  stream.write('ffconcat version 1.0\n');

  for (let index = 0; index < frames.length; index += 1) {
    const current = frames[index];
    const next = frames[index + 1];
    let duration;
    if (!next) {
      duration = TRAILING_FRAME_SECONDS;
    } else if (segmentStarts.has(index + 1)) {
      // The gap here is however long the recording was paused; hold the last frame briefly
      // instead so the skip reads as a cut rather than a freeze.
      duration = SEGMENT_CUT_SECONDS;
    } else {
      duration = Math.min(
        Math.max(next.timestamp - current.timestamp, 0),
        MAXIMUM_FRAME_GAP_SECONDS,
      );
    }
    stream.write(`file '${current.fileName}'\nduration ${duration.toFixed(4)}\n`);
  }
  // The concat demuxer ignores the final duration unless the last frame is repeated.
  stream.write(`file '${frames[frames.length - 1].fileName}'\n`);

  await new Promise((resolveEnd, rejectEnd) => {
    stream.on('error', rejectEnd);
    stream.end(resolveEnd);
  });
  return playlistPath;
}

function runFfmpeg(args, workingDirectory) {
  return new Promise((resolveRun, rejectRun) => {
    const child = spawn(ffmpegExecutable, ['-hide_banner', '-loglevel', 'error', ...args], {
      cwd: workingDirectory,
      windowsHide: true,
    });
    const stderrChunks = [];
    child.stderr.on('data', (chunk) => stderrChunks.push(chunk));
    child.on('error', (error) =>
      rejectRun(new Error(`Could not run ffmpeg (${ffmpegExecutable}): ${error.message}`)),
    );
    child.on('close', (code) => {
      if (code === 0) {
        resolveRun();
        return;
      }
      rejectRun(new Error(`ffmpeg exited with ${code}: ${Buffer.concat(stderrChunks)}`));
    });
  });
}
