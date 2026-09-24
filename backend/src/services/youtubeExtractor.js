const { execFile } = require('child_process');
const { promisify } = require('util');
const fs = require('fs');
const wav = require('node-wav');
const { SAMPLE_RATE, SEGMENT_SECONDS, SEGMENT_COUNT, EXTRACTION_TIMEOUT_MS } = require('../config');
const { newTempPath } = require('../utils/tempFiles');
const { AppError } = require('../utils/errors');

const execFileAsync = promisify(execFile);

// Deliberately restricted to the platforms this app actually supports —
// yt-dlp itself understands thousands of sites, but we only want to accept
// what we intend to (this list mirrors the "paste a link" search feature).
// A source URL ultimately comes from user input, so it's validated before
// ever reaching a shell-out (execFile with an argv array is already immune
// to injection regardless, but rejecting unexpected hosts keeps scope tight).
const ALLOWED_HOSTS = [/(?:^|\.)youtube\.com$/i, /^youtu\.be$/i, /(?:^|\.)bandcamp\.com$/i, /(?:^|\.)soundcloud\.com$/i];

// YouTube's signature deciphering requires a JS runtime; Node is already a
// hard dependency of this app, so point yt-dlp at it instead of also
// requiring Deno on every host this runs on.
const JS_RUNTIME_ARGS = ['--js-runtimes', 'node'];

function assertValidSourceUrl(rawUrl) {
  let url;
  try {
    url = new URL(rawUrl);
  } catch {
    throw new AppError('BAD_REQUEST', 'Invalid source URL');
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') {
    throw new AppError('BAD_REQUEST', 'Invalid source URL');
  }
  if (!ALLOWED_HOSTS.some((pattern) => pattern.test(url.hostname))) {
    throw new AppError('BAD_REQUEST', 'Only YouTube, Bandcamp, and SoundCloud links are supported for direct extraction');
  }
  return url.toString();
}

function mapYtdlpError(err) {
  const msg = `${err.stderr || err.message || ''}`;
  if (/video (is )?unavailable|private video|not available|removed by the uploader|content isn.t available|account associated with this video has been terminated|track.*not.*available/i.test(msg)) {
    return new AppError('VIDEO_UNAVAILABLE', 'Source is unavailable or private', { cause: err });
  }
  if (err.killed || err.signal === 'SIGTERM') {
    return new AppError('EXTRACTION_FAILED', 'yt-dlp timed out', { retryable: true, cause: err });
  }
  return new AppError('EXTRACTION_FAILED', `yt-dlp failed: ${msg.slice(0, 300)}`, { retryable: true, cause: err });
}

async function probeDurationAndViews(sourceUrl) {
  const url = assertValidSourceUrl(sourceUrl);
  let stdout;
  try {
    ({ stdout } = await execFileAsync('yt-dlp', [
      ...JS_RUNTIME_ARGS,
      '--no-playlist', '--skip-download',
      '--print', '%(duration)s|%(view_count)s',
      url,
    ], { timeout: EXTRACTION_TIMEOUT_MS }));
  } catch (err) {
    throw mapYtdlpError(err);
  }

  const [durationStr, viewCountStr] = stdout.trim().split('|');
  const duration = parseFloat(durationStr);
  const viewCount = parseInt(viewCountStr, 10);
  if (!Number.isFinite(duration) || duration <= 0) {
    throw new AppError('VIDEO_UNAVAILABLE', `No usable duration for ${sourceUrl}`);
  }
  return { duration, viewCount: Number.isFinite(viewCount) ? viewCount : null };
}

// Used only for manually-added tracks (no cosine.club record to name them
// from) — title/uploader stand in for track/artist.
async function probeMetadata(sourceUrl) {
  const url = assertValidSourceUrl(sourceUrl);
  let stdout;
  try {
    ({ stdout } = await execFileAsync('yt-dlp', [
      ...JS_RUNTIME_ARGS,
      '--no-playlist', '--skip-download',
      '--print', '%(title)s|||%(uploader)s',
      url,
    ], { timeout: EXTRACTION_TIMEOUT_MS }));
  } catch (err) {
    throw mapYtdlpError(err);
  }
  const [title, uploader] = stdout.trim().split('|||');
  return { title: title || null, uploader: uploader || null };
}

// Two segments centered at the quarter and three-quarter points, for better
// structural coverage (verse vs. chorus, etc.) than one continuous window.
// Falls back to a single centered window when the track is too short to fit
// two well-separated SEGMENT_SECONDS-length windows without overlapping.
function computeSegments(duration) {
  if (duration <= SEGMENT_SECONDS) return [{ start: 0, end: duration }];

  const totalCoverage = SEGMENT_SECONDS * SEGMENT_COUNT;
  const minDurationForSplit = totalCoverage + SEGMENT_SECONDS; // leaves a real gap between the two windows
  if (duration < minDurationForSplit) {
    const start = Math.max(0, duration / 2 - Math.min(duration, totalCoverage) / 2);
    const end = Math.min(start + totalCoverage, duration);
    return [{ start, end }];
  }

  const centers = [duration / 4, (3 * duration) / 4];
  return centers.map((center) => {
    const start = Math.max(0, center - SEGMENT_SECONDS / 2);
    const end = Math.min(start + SEGMENT_SECONDS, duration);
    return { start, end };
  });
}

async function downloadSegmentAsWav(sourceUrl, start, end) {
  const url = assertValidSourceUrl(sourceUrl);
  const wavPath = newTempPath('wav');
  const outputTemplate = wavPath.replace(/\.wav$/, '.%(ext)s');
  const section = `*${start}-${end}`;

  try {
    // One yt-dlp call does section-cut + resample + mono + wav conversion together.
    await execFileAsync('yt-dlp', [
      ...JS_RUNTIME_ARGS,
      '--no-playlist',
      '--download-sections', section,
      '-f', 'bestaudio/best',
      '-x', '--audio-format', 'wav',
      '--postprocessor-args', `ffmpeg:-ar ${SAMPLE_RATE} -ac 1`,
      '-o', outputTemplate,
      url,
    ], { timeout: EXTRACTION_TIMEOUT_MS, maxBuffer: 10 * 1024 * 1024 });
  } catch (err) {
    throw mapYtdlpError(err);
  }

  if (!fs.existsSync(wavPath)) {
    throw new AppError('EXTRACTION_FAILED', 'yt-dlp did not produce the expected wav file');
  }
  return wavPath;
}

function decodeWav(wavPath) {
  const buffer = fs.readFileSync(wavPath);
  const { sampleRate, channelData } = wav.decode(buffer);
  if (sampleRate !== SAMPLE_RATE) {
    throw new AppError('EXTRACTION_FAILED', `Unexpected sample rate ${sampleRate}, expected ${SAMPLE_RATE}`);
  }
  return channelData[0]; // mono guaranteed by -ac 1
}

// Full pipeline: probe -> download each segment -> decode -> always delete the temp files.
// Segments are downloaded sequentially (no concurrency cap exists for yt-dlp
// calls elsewhere in this app, so keep resource usage predictable here too).
async function extractAudioSamples(sourceUrl) {
  const { duration, viewCount } = await probeDurationAndViews(sourceUrl);
  const ranges = computeSegments(duration);

  const segments = [];
  for (const { start, end } of ranges) {
    const wavPath = await downloadSegmentAsWav(sourceUrl, start, end);
    try {
      segments.push(decodeWav(wavPath));
    } finally {
      fs.rmSync(wavPath, { force: true });
    }
  }

  return { segments, sampleRate: SAMPLE_RATE, duration, viewCount };
}

module.exports = { extractAudioSamples, probeMetadata };
