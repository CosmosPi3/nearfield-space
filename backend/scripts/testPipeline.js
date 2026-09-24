#!/usr/bin/env node
// Standalone one-track pipeline harness: yt-dlp -> ffmpeg -> decode -> Meyda -> print vector.
// Usage: node scripts/testPipeline.js <source_url>   (YouTube/Bandcamp/SoundCloud)
const { extractAudioSamples } = require('../src/services/youtubeExtractor');
const { extractTextureFeatures } = require('../src/services/featureExtractor');

const sourceUrl = process.argv[2] || 'https://www.youtube.com/watch?v=FkUd5C8ApdI'; // Joy Orbison - Hyph Mngo

(async () => {
  console.log(`[${sourceUrl}] extracting audio...`);
  const { segments, sampleRate, duration, viewCount } = await extractAudioSamples(sourceUrl);
  const totalSamples = segments.reduce((sum, s) => sum + s.length, 0);
  console.log(`[${sourceUrl}] ${segments.length} segment(s), ${totalSamples} samples total @ ${sampleRate}Hz, duration=${duration}s, views=${viewCount}`);

  const result = extractTextureFeatures(segments);
  console.log(`[${sourceUrl}] tempoBpm=${result.tempoBpm.toFixed(1)} energyValence=${result.energyValence.toFixed(3)}`);
  console.log(`[${sourceUrl}] centroid.mean=${result.features.centroid.mean.toFixed(1)}Hz flatness.mean=${result.features.flatness.mean.toFixed(4)} rms.mean=${result.rms.mean.toFixed(4)}`);
  console.log(`[${sourceUrl}] vector (${result.vector.length} dims):`, JSON.stringify(result.vector.map((v) => Number(v.toFixed(4)))));
})().catch((err) => {
  console.error(`[${sourceUrl}] FAILED: ${err.code || 'ERROR'} - ${err.message}`);
  if (err.cause?.stderr) console.error(err.cause.stderr.slice(0, 500));
  process.exit(1);
});
