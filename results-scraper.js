import { chromium } from "playwright";
import {
  mkdir,
  readFile,
  writeFile
} from "node:fs/promises";

const seasonId = process.env.SEASON_ID || "28433";

const resultsUrl =
  `https://www.simracerhub.com/season_race.php?season_id=${seasonId}`;

function cleanText(value = "") {
  return value.replace(/\s+/g, " ").trim();
}

function normalizeHeader(value = "") {
  return cleanText(value)
    .toUpperCase()
    .replace(/[^A-Z0-9#-]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function parseNumber(value = "") {
  const cleaned = cleanText(value)
    .replace(/,/g, "")
    .replace(/[−–—]/g, "-");

  const match = cleaned.match(/[+-]?\d+/);

  return match ? Number(match[0]) : 0;
}

/*
 * Makes track-name comparisons more forgiving.
 *
 * Examples:
 * "EchoPark Speedway (Atlanta)"
 * becomes:
 * "echopark speedway"
 *
 * "Homestead-Miami Speedway"
 * becomes:
 * "homestead miami speedway"
 */
function normalizeTrackName(value = "") {
  return cleanText(value)
    .toLowerCase()
    .replace(/\([^)]*\)/g, " ")
    .replace(/[^a-z0-9]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function tracksMatch(firstTrack, secondTrack) {
  const first = normalizeTrackName(firstTrack);
  const second = normalizeTrackName(secondTrack);

  return (
    first === second ||
    first.includes(second) ||
    second.includes(first)
  );
}

async function readRaceMetadata(page) {
  const bodyText = await page.locator("body").innerText();

  /*
   * Expected SimRacerHub format:
   * Race 20: Chicagoland Speedway Wed 07/08/2026
   */
  const metadataMatch = bodyText.match(
    /Race\s+(\d+)\s*:\s*(.+?)\s+(?:Sun|Mon|Tue|Wed|Thu|Fri|Sat)\s+(\d{2}\/\d{2}\/\d{4})/i
  );

  if (!metadataMatch) {
    throw new Error(
      "Could not identify the race number, track name, and race date."
    );
  }

  const simRacerHubRaceNumber = Number(
    metadataMatch[1]
  );

  const simRacerHubTrackName = cleanText(
    metadataMatch[2]
  );

  const dateText = metadataMatch[3];

  const [month, day, year] = dateText.split("/");

  const raceDate = `${year}-${month}-${day}`;

  /*
   * Find the permanent schedule_id URL for this race.
   * The generic season URL always points to the latest race.
   */
  const scheduleLinks = await page
    .locator(
      'a[href*="season_race.php?schedule_id="]'
    )
    .evaluateAll((links) => {
      return links.map((link) => ({
        text: link.innerText
          .replace(/\s+/g, " ")
          .trim(),

        href: link.href
      }));
    });

  const raceNumberPattern = new RegExp(
    `Race\\s+${simRacerHubRaceNumber}\\s*:`,
    "i"
  );

  const permanentLink = scheduleLinks.find((link) => {
    return (
      raceNumberPattern.test(link.text) &&
      link.text.includes(dateText)
    );
  });

  return {
    simRacerHubRaceNumber,
    simRacerHubTrackName,
    raceDate,

    raceSpecificUrl:
      permanentLink?.href || resultsUrl
  };
}

const eventMap = JSON.parse(
  await readFile("event-map.json", "utf8")
);

if (String(eventMap.seasonId) !== String(seasonId)) {
  throw new Error(
    `event-map.json is for season ${eventMap.seasonId}, but the scraper is using season ${seasonId}.`
  );
}

if (!Array.isArray(eventMap.events)) {
  throw new Error(
    "event-map.json does not contain a valid events list."
  );
}

const browser = await chromium.launch({
  headless: true
});

try {
  const page = await browser.newPage({
    viewport: {
      width: 1900,
      height: 1200
    }
  });

  console.log(`Opening ${resultsUrl}`);

  await page.goto(resultsUrl, {
    waitUntil: "domcontentloaded",
    timeout: 90000
  });

  // Give SimRacerHub time to load the latest results.
  await page.waitForTimeout(12000);

  const raceMetadata = await readRaceMetadata(page);

  console.log(
    `Latest race: ${raceMetadata.simRacerHubTrackName}`
  );

  console.log(
    `Race date: ${raceMetadata.raceDate}`
  );

  console.log(
    `SimRacerHub race number: ${raceMetadata.simRacerHubRaceNumber}`
  );

  /*
   * Date is the primary mapping key.
   */
  const mappedEvent = eventMap.events.find((event) => {
    return event.raceDate === raceMetadata.raceDate;
  });

  let websiteSlug = null;
  let websiteTrackName =
    raceMetadata.simRacerHubTrackName;

  if (mappedEvent) {
    /*
     * Track is the secondary safety check.
     */
    if (
      !tracksMatch(
        mappedEvent.trackName,
        raceMetadata.simRacerHubTrackName
      )
    ) {
      throw new Error(
        [
          `The date ${raceMetadata.raceDate} matched website page`,
          `/results/${mappedEvent.websiteSlug},`,
          `but the track names did not match.`,
          `Event map: ${mappedEvent.trackName}.`,
          `SimRacerHub: ${raceMetadata.simRacerHubTrackName}.`
        ].join(" ")
      );
    }

    websiteSlug = String(
      mappedEvent.websiteSlug
    );

    websiteTrackName = mappedEvent.trackName;

    console.log(
      `Matched website page: /results/${websiteSlug}`
    );
  } else {
    /*
     * This allows the latest feed to continue working
     * when the current race is not included in event-map.json.
     */
    console.warn(
      `No event-map entry was found for ${raceMetadata.raceDate}.`
    );

    console.warn(
      "The latest feed will update, but no permanent numbered race file will be created."
    );
  }

  let resultsTable = null;
  let tableFrameUrl = "";

  // Search the main page and any embedded frames.
  for (const frame of page.frames()) {
    const tables = frame.locator("table");
    const tableCount = await tables.count();

    console.log(
      `Checking ${tableCount} tables in frame: ${frame.url()}`
    );

    for (let i = 0; i < tableCount; i++) {
      const table = tables.nth(i);

      const tableText = normalizeHeader(
        await table.innerText()
      );

      if (
        tableText.includes("DRIVER") &&
        tableText.includes("TOT PTS") &&
        tableText.includes("LAPS LED") &&
        tableText.includes("FASTEST LAP")
      ) {
        resultsTable = table;
        tableFrameUrl = frame.url();
        break;
      }
    }

    if (resultsTable) {
      break;
    }
  }

  if (!resultsTable) {
    await page.screenshot({
      path: "results-debug.png",
      fullPage: true
    });

    throw new Error(
      "Could not find the SimRacerHub race-results table."
    );
  }

  const tableData = await resultsTable.evaluate((table) => {
    return Array.from(table.querySelectorAll("tr"))
      .map((row) => {
        return Array.from(
          row.querySelectorAll("th, td")
        ).map((cell) => ({
          text: cell.innerText
            .replace(/\s+/g, " ")
            .trim(),

          className:
            typeof cell.className === "string"
              ? cell.className
              : "",

          html: cell.innerHTML
        }));
      })
      .filter((row) => row.length > 0);
  });

  if (tableData.length < 2) {
    throw new Error(
      "The race-results table was found, but it contained no driver rows."
    );
  }

  const headers = tableData[0].map((cell) =>
    normalizeHeader(cell.text)
  );

  function findColumn(...possibleNames) {
    return headers.findIndex((header) =>
      possibleNames.includes(header)
    );
  }

  function getCell(row, index) {
    if (index < 0 || !row[index]) {
      return {
        text: "",
        className: "",
        html: ""
      };
    }

    return row[index];
  }

  const columns = {
    finish: findColumn(
      "FIN",
      "FINISH",
      "FINISHING POS"
    ),

    start: findColumn(
      "ST",
      "START",
      "STARTING POS"
    ),

    carNumber: findColumn(
      "CAR #",
      "CAR#",
      "CAR NUMBER"
    ),

    driver: findColumn("DRIVER"),

    interval: findColumn(
      "INT",
      "INTERVAL"
    ),

    totalPoints: findColumn(
      "TOT PTS",
      "TOTAL POINTS"
    ),

    racePoints: findColumn(
      "RACE PTS",
      "RACE POINTS"
    ),

    bonusPoints: findColumn(
      "BNS PTS",
      "BONUS PTS",
      "BONUS POINTS"
    ),

    lapsLed: findColumn("LAPS LED"),

    laps: findColumn("LAPS"),

    fastestLap: findColumn("FASTEST LAP"),

    team: findColumn("TEAM")
  };

  if (
    columns.finish === -1 ||
    columns.driver === -1 ||
    columns.totalPoints === -1
  ) {
    throw new Error(
      `Required columns were not found. Headers: ${headers.join(", ")}`
    );
  }

  const results = tableData
    .slice(1)
    .map((row) => {
      const finishingPosition = parseNumber(
        getCell(row, columns.finish).text
      );

      const rawInterval = cleanText(
        getCell(row, columns.interval).text
      );

      return {
        finishingPosition,

        startingPosition: parseNumber(
          getCell(row, columns.start).text
        ),

        carNumber: cleanText(
          getCell(row, columns.carNumber).text
        ),

        driver: cleanText(
          getCell(row, columns.driver).text
        ),

        team: cleanText(
          getCell(row, columns.team).text
        ),

        interval:
          finishingPosition === 1
            ? "Winner"
            : rawInterval,

        lapsLed: parseNumber(
          getCell(row, columns.lapsLed).text
        ),

        laps: parseNumber(
          getCell(row, columns.laps).text
        ),

        fastestLap: cleanText(
          getCell(row, columns.fastestLap).text
        ),

        points: parseNumber(
          getCell(row, columns.totalPoints).text
        ),

        racePoints: parseNumber(
          getCell(row, columns.racePoints).text
        ),

        bonusPoints: parseNumber(
          getCell(row, columns.bonusPoints).text
        )
      };
    })
    .filter((entry) => {
      return (
        entry.finishingPosition > 0 &&
        entry.driver
      );
    });

  if (results.length === 0) {
    throw new Error(
      "The table was found, but no race results were read."
    );
  }

  const updatedAt = new Date().toISOString();

  const cleanOutput = {
    seasonId,

    websiteSlug,

    websitePath: websiteSlug
      ? `/results/${websiteSlug}`
      : "/results",

    mappingStatus: websiteSlug
      ? "matched"
      : "unmapped",

    simRacerHubRaceNumber:
      raceMetadata.simRacerHubRaceNumber,

    trackName: websiteTrackName,

    simRacerHubTrackName:
      raceMetadata.simRacerHubTrackName,

    raceDate: raceMetadata.raceDate,

    source: raceMetadata.raceSpecificUrl,

    latestResultsSource: resultsUrl,

    updatedAt,

    resultCount: results.length,

    results
  };

  const rawOutput = {
    seasonId,

    websiteSlug,

    simRacerHubRaceNumber:
      raceMetadata.simRacerHubRaceNumber,

    trackName: websiteTrackName,

    simRacerHubTrackName:
      raceMetadata.simRacerHubTrackName,

    raceDate: raceMetadata.raceDate,

    source: raceMetadata.raceSpecificUrl,

    tableFrame: tableFrameUrl,

    updatedAt,

    headers: tableData[0],

    rows: tableData.slice(1)
  };

  await mkdir("race-results", {
    recursive: true
  });

  /*
   * Keep the original files for compatibility.
   */
  await writeFile(
    "results-raw.json",
    JSON.stringify(rawOutput, null, 2)
  );

  await writeFile(
    "results.json",
    JSON.stringify(cleanOutput, null, 2)
  );

  /*
   * This file always contains the newest results.
   */
  await writeFile(
    "race-results/latest.json",
    JSON.stringify(cleanOutput, null, 2)
  );

  /*
   * Only create a permanent numbered file when
   * event-map.json provides a verified destination.
   */
  if (websiteSlug) {
    const permanentFile =
      `race-results/${websiteSlug}.json`;

    await writeFile(
      permanentFile,
      JSON.stringify(cleanOutput, null, 2)
    );

    console.log(
      `Saved permanent race file: ${permanentFile}`
    );
  }

  console.log(
    `Saved ${results.length} drivers to results.json`
  );

  console.log(
    "Updated race-results/latest.json"
  );
} finally {
  await browser.close();
}
