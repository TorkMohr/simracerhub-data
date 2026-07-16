import fs from "node:fs/promises";
import path from "node:path";

const API_KEY = process.env.YOUTUBE_API_KEY;
const PLAYLIST_ID = process.env.YOUTUBE_PLAYLIST_ID;
const OUTPUT_PATH = process.env.BROADCASTS_JSON_PATH || "data/broadcasts.json";

if (!API_KEY) throw new Error("Missing YOUTUBE_API_KEY repository secret.");
if (!PLAYLIST_ID) throw new Error("Missing YOUTUBE_PLAYLIST_ID.");

const API_BASE = "https://www.googleapis.com/youtube/v3";

async function youtubeRequest(endpoint, params) {
  const url = new URL(`${API_BASE}/${endpoint}`);
  for (const [key, value] of Object.entries(params)) {
    if (value !== undefined && value !== null && value !== "") {
      url.searchParams.set(key, String(value));
    }
  }
  url.searchParams.set("key", API_KEY);

  const response = await fetch(url, {
    headers: { Accept: "application/json" },
  });

  if (!response.ok) {
    const body = await response.text();
    throw new Error(`YouTube API ${response.status}: ${body}`);
  }

  return response.json();
}

async function readExisting() {
  try {
    return JSON.parse(await fs.readFile(OUTPUT_PATH, "utf8"));
  } catch {
    return null;
  }
}

function bestThumbnail(thumbnails = {}) {
  return (
    thumbnails.maxres?.url ||
    thumbnails.standard?.url ||
    thumbnails.high?.url ||
    thumbnails.medium?.url ||
    thumbnails.default?.url ||
    null
  );
}

function classifyVideo(video) {
  const content = video?.snippet?.liveBroadcastContent;
  const details = video?.liveStreamingDetails || {};

  if (content === "live") return "live";
  if (content === "upcoming") return "upcoming";
  if (details.actualEndTime) return "replay";
  return "video";
}

function timestampForSort(video) {
  const details = video.liveStreamingDetails || {};
  return (
    details.actualEndTime ||
    details.actualStartTime ||
    details.scheduledStartTime ||
    video.snippet?.publishedAt ||
    "1970-01-01T00:00:00Z"
  );
}

function normalizeVideo(video) {
  const details = video.liveStreamingDetails || {};
  return {
    videoId: video.id,
    title: video.snippet?.title || "Moonshiners Racing League Broadcast",
    description: video.snippet?.description || "",
    status: classifyVideo(video),
    thumbnail: bestThumbnail(video.snippet?.thumbnails),
    publishedAt: video.snippet?.publishedAt || null,
    scheduledStartTime: details.scheduledStartTime || null,
    actualStartTime: details.actualStartTime || null,
    actualEndTime: details.actualEndTime || null,
    embedUrl: `https://www.youtube.com/embed/${video.id}`,
    watchUrl: `https://www.youtube.com/watch?v=${video.id}`,
  };
}

function selectFeatured(videos) {
  const live = videos
    .filter((v) => classifyVideo(v) === "live")
    .sort((a, b) => timestampForSort(b).localeCompare(timestampForSort(a)));
  if (live.length) return live[0];

  const upcoming = videos
    .filter((v) => classifyVideo(v) === "upcoming")
    .sort((a, b) => timestampForSort(a).localeCompare(timestampForSort(b)));
  if (upcoming.length) return upcoming[0];

  const replay = videos
    .filter((v) => classifyVideo(v) === "replay")
    .sort((a, b) => timestampForSort(b).localeCompare(timestampForSort(a)));
  if (replay.length) return replay[0];

  return videos[0] || null;
}

async function fetchVideoDetails(ids) {
  const results = [];

  for (let i = 0; i < ids.length; i += 50) {
    const batch = ids.slice(i, i + 50);
    const response = await youtubeRequest("videos", {
      part: "snippet,liveStreamingDetails,contentDetails,status",
      id: batch.join(","),
      maxResults: 50,
    });
    results.push(...(response.items || []));
  }

  return results;
}

async function fetchPlaylistItems() {
  const items = [];
  let pageToken = "";

  do {
    const response = await youtubeRequest("playlistItems", {
      part: "snippet,contentDetails",
      playlistId: PLAYLIST_ID,
      maxResults: 50,
      pageToken,
    });

    items.push(...(response.items || []));
    pageToken = response.nextPageToken || "";
  } while (pageToken);

  return items
    .filter((item) => {
      const title = item.snippet?.title;
      const videoId = item.contentDetails?.videoId || item.snippet?.resourceId?.videoId;
      return (
        videoId &&
        title &&
        title !== "Deleted video" &&
        title !== "Private video"
      );
    })
    .sort((a, b) => (a.snippet?.position ?? 9999) - (b.snippet?.position ?? 9999));
}

async function main() {
  const existing = await readExisting();

  // Once the existing featured broadcast is already a replay, nothing should
  // change until the next Wednesday playlist checks find a new item.
  // Scheduled Wednesday runs still inspect the playlist so a newly-added
  // upcoming broadcast can be discovered.
  const playlistItems = await fetchPlaylistItems();
  const ids = [...new Set(
    playlistItems.map(
      (item) => item.contentDetails?.videoId || item.snippet?.resourceId?.videoId
    )
  )];

  if (!ids.length) {
    throw new Error("No available videos were found in the configured playlist.");
  }

  const details = await fetchVideoDetails(ids);
  const order = new Map(ids.map((id, index) => [id, index]));
  details.sort((a, b) => (order.get(a.id) ?? 9999) - (order.get(b.id) ?? 9999));

  const featuredRaw = selectFeatured(details);
  if (!featuredRaw) throw new Error("Unable to select a featured broadcast.");

  const replays = details
    .filter((video) => classifyVideo(video) === "replay")
    .sort((a, b) => timestampForSort(b).localeCompare(timestampForSort(a)))
    .map(normalizeVideo);

  const output = {
    schemaVersion: 1,
    playlistId: PLAYLIST_ID,
    lastUpdated: new Date().toISOString(),
    featured: normalizeVideo(featuredRaw),
    recentReplays: replays,
    diagnostics: {
      playlistVideosFound: ids.length,
      completedReplaysFound: replays.length,
      previousFeaturedVideoId: existing?.featured?.videoId || null,
    },
  };

  await fs.mkdir(path.dirname(OUTPUT_PATH), { recursive: true });
  await fs.writeFile(OUTPUT_PATH, `${JSON.stringify(output, null, 2)}\n`, "utf8");

  console.log(`Featured: ${output.featured.status} — ${output.featured.title}`);
  console.log(`Replays: ${output.recentReplays.length}`);
  console.log(`Saved: ${OUTPUT_PATH}`);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
