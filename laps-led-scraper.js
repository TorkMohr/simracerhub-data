import { chromium } from "playwright";
import {
  readFile,
  writeFile
} from "node:fs/promises";

const seasonId = process.env.SEASON_ID || "28433";

const statsUrl =
  `https://www.simracerhub.com/league_stats.php?season_id=${seasonId}`;

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

function normalizeDriverName(value = "") {
  return cleanText(value)
    .toLowerCase()
    .replace(/[’‘]/g, "'")
    .replace(/[^a-z0-9]+/g, " ")
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

function isLapsLedHeader(header = "") {
  const normalized = normalizeHeader(header);

  return (
    normalized === "LED #" ||
    normalized === "LED" ||
    normalized === "LAPS LED" ||
    normalized === "LAPS LED #"
  );
}

async function readTable(table) {
  return table.evaluate((tableElement) => {
    return Array.from(
      tableElement.querySelectorAll("tr")
    )
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
}

async function findStatsTable(page) {
  for (const frame of page.frames()) {
    const tables = frame.locator("table");
    const tableCount = await tables.count();

    for (
      let tableIndex = 0;
      tableIndex < tableCount;
      tableIndex++
    ) {
      const table = tables.nth(tableIndex);

      let tableData;

      try {
        tableData = await readTable(table);
      } catch {
        continue;
      }

      const headerRowIndex = tableData.findIndex(
        (row) => {
          const headers = row.map((cell) =>
            normalizeHeader(cell.text)
          );

          const hasDriver =
            headers.includes("DRIVER");

          const hasLapsLed =
            headers.some((header) =>
              isLapsLedHeader(header)
            );

          return hasDriver && hasLapsLed;
        }
      );

      if (headerRowIndex !== -1) {
        return {
          tableData,
          headerRowIndex,
          frameUrl: frame.url()
        };
      }
    }
  }

  return null;
}

async function loadStatsTable(page) {
  const maximumAttempts = 3;

  for (
    let attempt = 1;
    attempt <= maximumAttempts;
    attempt++
  ) {
    console.log(
      `Loading season stats — attempt ${attempt} of ${maximumAttempts}`
    );

    await page.goto(statsUrl, {
      waitUntil: "domcontentloaded",
      timeout: 90000
    });

    /*
     * Check every three seconds for up to one minute.
     */
    for (let check = 1; check <= 20; check++) {
      const statsTable =
        await findStatsTable(page);

      if (statsTable) {
        console.log(
          `Season stats table found on check ${check}.`
        );

        return statsTable;
      }

      console.log(
        `Season stats table not ready — check ${check} of 20.`
      );

      await page.waitForTimeout(3000);
    }

    if (attempt < maximumAttempts) {
      console.log(
        "Season stats did not load. Retrying the page."
      );
    }
  }

  await page.screenshot({
    path: "stats-debug.png",
    fullPage: true
  });

  throw new Error(
    "Could not find a season statistics table containing DRIVER and LED #."
  );
}

/*
 * Read the standings file created by scraper.js.
 */
const standingsData = JSON.parse(
  await readFile("standings.json", "utf8")
);

if (
  String(standingsData.seasonId) !==
  String(seasonId)
) {
  throw new Error(
    `standings.json belongs to season ${standingsData.seasonId}, ` +
    `but the stats scraper is using season ${seasonId}.`
  );
}

if (!Array.isArray(standingsData.standings)) {
  throw new Error(
    "standings.json does not contain a valid standings array."
  );
}

const browser = await chromium.launch({
  headless: true
});

try {
  const context = await browser.newContext({
    viewport: {
      width: 1900,
      height: 1200
    },

    locale: "en-US",

    userAgent:
      "Mozilla/5.0 (Windows NT 10.0; Win64; x64) " +
      "AppleWebKit/537.36 (KHTML, like Gecko) " +
      "Chrome/126.0.0.0 Safari/537.36"
  });

  const page = await context.newPage();

  page.setDefaultTimeout(15000);

  console.log(`Opening ${statsUrl}`);

  const statsTableResult =
    await loadStatsTable(page);

  const tableData =
    statsTableResult.tableData;

  const headerRow =
    tableData[
      statsTableResult.headerRowIndex
    ];

  const headers = headerRow.map((cell) =>
    normalizeHeader(cell.text)
  );

  console.log(
    `Stats headers found: ${headers.join(", ")}`
  );

  const driverColumn = headers.findIndex(
    (header) => header === "DRIVER"
  );

  const lapsLedColumn = headers.findIndex(
    (header) => isLapsLedHeader(header)
  );

  if (
    driverColumn === -1 ||
    lapsLedColumn === -1
  ) {
    throw new Error(
      `Required stats columns were not found. Headers: ${headers.join(
        ", "
      )}`
    );
  }

  const lapsLedByDriver = new Map();

  const dataRows = tableData.slice(
    statsTableResult.headerRowIndex + 1
  );

  for (const row of dataRows) {
    const driverCell = row[driverColumn];
    const lapsLedCell = row[lapsLedColumn];

    if (!driverCell) {
      continue;
    }

    const driver = cleanText(
      driverCell.text
    );

    if (!driver) {
      continue;
    }

    const driverKey =
      normalizeDriverName(driver);

    const lapsLed = parseNumber(
      lapsLedCell?.text || ""
    );

    /*
     * Each driver should appear once. If SimRacerHub
     * unexpectedly provides duplicates, keep the
     * largest season total instead of adding twice.
     */
    const existingTotal =
      lapsLedByDriver.get(driverKey);

    if (
      existingTotal === undefined ||
      lapsLed > existingTotal
    ) {
      lapsLedByDriver.set(
        driverKey,
        lapsLed
      );
    }
  }

  if (lapsLedByDriver.size === 0) {
    throw new Error(
      "The stats table was found, but no driver laps-led values were read."
    );
  }

  const totalLapsLed = Array.from(
    lapsLedByDriver.values()
  ).reduce(
    (total, value) => total + value,
    0
  );

  if (totalLapsLed === 0) {
    throw new Error(
      "All season laps-led values were zero. standings.json was not changed."
    );
  }

  let matchedDriverCount = 0;

  const unmatchedDrivers = [];

  const enrichedStandings =
    standingsData.standings.map((entry) => {
      const driverKey =
        normalizeDriverName(entry.driver);

      const hasStatsEntry =
        lapsLedByDriver.has(driverKey);

      if (hasStatsEntry) {
        matchedDriverCount++;
      } else {
        unmatchedDrivers.push(
          entry.driver
        );
      }

      return {
        ...entry,

        lapsLed: hasStatsEntry
          ? lapsLedByDriver.get(driverKey)
          : 0
      };
    });

  if (matchedDriverCount === 0) {
    throw new Error(
      "No SimRacerHub statistics drivers matched the standings drivers."
    );
  }

  const updatedAt =
    new Date().toISOString();

  /*
   * Remove metadata left by the older historical-race
   * calculation method, if it exists.
   */
  const {
    lapsLedRaceCount,
    lapsLedRacesIncluded,
    lapsLedRacesSkipped,
    ...baseStandingsData
  } = standingsData;

  const output = {
    ...baseStandingsData,

    standingsUpdatedAt:
      standingsData.updatedAt,

    updatedAt,

    lapsLedUpdatedAt:
      updatedAt,

    lapsLedSource:
      statsUrl,

    lapsLedSourceColumn:
      "Led #",

    lapsLedStatsDriverCount:
      lapsLedByDriver.size,

    lapsLedMatchedDriverCount:
      matchedDriverCount,

    lapsLedUnmatchedDrivers:
      unmatchedDrivers,

    standings:
      enrichedStandings
  };

  await writeFile(
    "standings.json",
    JSON.stringify(output, null, 2)
  );

  console.log(
    `Success: read laps led for ${lapsLedByDriver.size} drivers.`
  );

  console.log(
    `Matched ${matchedDriverCount} of ` +
    `${standingsData.standings.length} standings drivers.`
  );

  console.log(
    `Season laps-led total: ${totalLapsLed}.`
  );

  if (unmatchedDrivers.length > 0) {
    console.log(
      `Drivers without a stats match: ${unmatchedDrivers.join(
        ", "
      )}`
    );
  }
} finally {
  await browser.close();
}
