const Bottleneck = require('bottleneck');
const cosineClient = require('./cosineClient');
const discogsClient = require('./discogsClient');
const { extractAudioSamples, probeMetadata, searchTopResult } = require('./youtubeExtractor');
const { extractTextureFeatures } = require('./featureExtractor');
const { getTrackRecord, saveTrackRecord } = require('../db');
const { AppError } = require('../utils/errors');
const { EXTRACTION_CONCURRENCY } = require('../config');

// Guards concurrent extraction of the same id — two sibling frontier branches
// in one discovery hop can legitimately surface the same new candidate before
// the client-side visited-set update propagates. Shared between cosine.club-
// backed and manually-added tracks since both key off the same id space.
const inFlight = new Map();

// Caps simultaneous yt-dlp/ffmpeg/Meyda pipelines regardless of how many the
// client fires at once — protects a single-vCPU host from a discovery hop
// that surfaces several cache misses at the same time.
const extractionLimiter = new Bottleneck({ maxConcurrent: EXTRACTION_CONCURRENCY });

function recordToResponse(record) {
  return {
    id: record.id,
    name: record.name,
    artist: record.artist,
    track: record.track,
    videoId: record.video_id,
    externalLink: record.external_link,
    source: record.source,
    cached: true,
    vector: JSON.parse(record.vector_json),
    features: JSON.parse(record.features_json),
    tempoBpm: record.tempo_bpm,
    rawTempoBpm: record.raw_tempo_bpm,
    rms: { mean: record.rms_mean, var: record.rms_var },
    energyValence: record.energy_valence,
    viewCount: record.view_count,
    extractedAt: record.extracted_at,
  };
}

function baseRecord(id, track) {
  return {
    id, name: track.name, artist: track.artist, track: track.track,
    videoId: track.videoId, externalLink: track.externalLink, source: track.source,
    viewCount: null,
    extractionStatus: 'failed', lastError: null,
    spectralCentroidMean: null, spectralFlatnessMean: null, tempoBpm: null, rawTempoBpm: null,
    rmsMean: null, rmsVar: null, energyValence: null,
    featuresJson: null, vectorJson: null, extractedAt: null,
  };
}

// Shared by both extraction paths below — only how `track` metadata and the
// audio `sourceUrl` are obtained differs between them.
async function runPipelineAndSave(id, track, sourceUrl) {
  try {
    const { segments, viewCount } = await extractAudioSamples(sourceUrl);
    const result = extractTextureFeatures(segments);

    saveTrackRecord({
      ...baseRecord(id, track),
      viewCount,
      extractionStatus: 'ok',
      spectralCentroidMean: result.features.centroid.mean,
      spectralFlatnessMean: result.features.flatness.mean,
      tempoBpm: result.tempoBpm,
      rawTempoBpm: result.tempoBpmRaw,
      rmsMean: result.rms.mean,
      rmsVar: result.rms.var,
      energyValence: result.energyValence,
      featuresJson: JSON.stringify(result.features),
      vectorJson: JSON.stringify(result.vector),
      extractedAt: new Date().toISOString(),
    });
    return recordToResponse(getTrackRecord(id));
  } catch (err) {
    const appErr = err instanceof AppError
      ? err
      : new AppError('EXTRACTION_FAILED', err.message || 'extraction failed', { retryable: true, cause: err });
    saveTrackRecord({ ...baseRecord(id, track), lastError: appErr.message.slice(0, 500) });
    throw appErr;
  }
}

async function runExtraction(id) {
  const track = await cosineClient.getTrack(id);
  if (!track) throw new AppError('NOT_FOUND', `Track ${id} not found`);

  if (!track.videoId) {
    saveTrackRecord({ ...baseRecord(id, track), lastError: 'No video_id available' });
    throw new AppError('VIDEO_UNAVAILABLE', `Track ${id} has no linked video`);
  }

  return runPipelineAndSave(id, track, `https://www.youtube.com/watch?v=${track.videoId}`);
}

async function getFeatures(id, { refresh = false } = {}) {
  if (!refresh) {
    const existing = getTrackRecord(id);
    if (existing && existing.extraction_status === 'ok') {
      return recordToResponse(existing);
    }
  }

  if (inFlight.has(id)) return inFlight.get(id);

  const promise = extractionLimiter.schedule(() => runExtraction(id)).finally(() => inFlight.delete(id));
  inFlight.set(id, promise);
  return promise;
}

function extractYoutubeVideoId(sourceUrl) {
  try {
    const url = new URL(sourceUrl);
    if (/(?:^|\.)youtube\.com$/i.test(url.hostname)) return url.searchParams.get('v');
    if (/^youtu\.be$/i.test(url.hostname)) return url.pathname.slice(1) || null;
  } catch {
    // fall through
  }
  return null;
}

// Named so the frontend's Bandcamp-link-prioritization logic recognizes a
// manually-added Bandcamp track as already-Bandcamp, rather than redundantly
// offering a "search on Bandcamp" fallback for a link that already is one.
function detectSourceLabel(sourceUrl) {
  try {
    const host = new URL(sourceUrl).hostname;
    if (/(?:^|\.)youtube\.com$/i.test(host) || /^youtu\.be$/i.test(host)) return 'YouTube';
    if (/(?:^|\.)bandcamp\.com$/i.test(host)) return 'Bandcamp';
    if (/(?:^|\.)soundcloud\.com$/i.test(host)) return 'SoundCloud';
  } catch {
    // fall through
  }
  return null;
}

// For tracks not in cosine.club's catalog at all — bypasses it entirely,
// extracting and analyzing directly from a YouTube/Bandcamp/SoundCloud URL.
// These tracks have no cosine.club id, so they can never be a discoverFrom
// seed (nothing to query for similar tracks) — but they're otherwise full
// citizens: real vectors, real distances, real "most similar to pinned" entries.
async function runManualExtraction(id, sourceUrl) {
  const meta = await probeMetadata(sourceUrl);
  const track = {
    videoId: extractYoutubeVideoId(sourceUrl),
    name: [meta.uploader, meta.title].filter(Boolean).join(' - ') || sourceUrl,
    artist: meta.uploader,
    track: meta.title,
    externalLink: sourceUrl,
    source: detectSourceLabel(sourceUrl),
  };
  return runPipelineAndSave(id, track, sourceUrl);
}

async function addManualTrack(sourceUrl) {
  const id = `manual:${sourceUrl}`;
  const existing = getTrackRecord(id);
  if (existing && existing.extraction_status === 'ok') return recordToResponse(existing);

  if (inFlight.has(id)) return inFlight.get(id);

  const promise = extractionLimiter.schedule(() => runManualExtraction(id, sourceUrl)).finally(() => inFlight.delete(id));
  inFlight.set(id, promise);
  return promise;
}

// For a plain-text search that missed cosine.club's catalog entirely — finds
// a release on Discogs (broader/fresher than cosine.club's own curated
// index), resolves that release's artist/track to a YouTube video, then
// extracts from it exactly like a manually-pasted YouTube link would.
// Metadata comes from Discogs (clean "Artist - Track"), not probeMetadata,
// since a YouTube video title/uploader is much noisier.
async function addTrackViaDiscogsFallback(query) {
  const release = await discogsClient.searchTopRelease(query);
  if (!release) throw new AppError('NOT_FOUND', `No Discogs match for "${query}"`);

  const { artist, track: trackTitle } = release;
  const videoId = await searchTopResult([artist, trackTitle].filter(Boolean).join(' '));
  if (!videoId) throw new AppError('NOT_FOUND', `Found "${artist} - ${trackTitle}" on Discogs but no matching YouTube video`);

  const sourceUrl = `https://www.youtube.com/watch?v=${videoId}`;
  const id = `manual:${sourceUrl}`;
  const track = {
    videoId,
    name: [artist, trackTitle].filter(Boolean).join(' - ') || query,
    artist,
    track: trackTitle,
    externalLink: sourceUrl,
    source: 'Discogs',
  };

  // Same id scheme as addManualTrack — a Discogs-resolved video that's
  // already cached (e.g. from a direct paste of the same link) is reused
  // rather than re-extracted.
  const existing = getTrackRecord(id);
  if (existing && existing.extraction_status === 'ok') return recordToResponse(existing);

  if (inFlight.has(id)) return inFlight.get(id);

  const promise = extractionLimiter.schedule(() => runPipelineAndSave(id, track, sourceUrl)).finally(() => inFlight.delete(id));
  inFlight.set(id, promise);
  return promise;
}

module.exports = { getFeatures, addManualTrack, addTrackViaDiscogsFallback };
