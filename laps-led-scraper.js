import { chromium } from "playwright";
import {
  readFile,
  writeFile
} from "node:fs/promises";

const seasonId = "28433";

/*
 * Points races only.
 *
 * Excluded:
 * - Daytona Duel: 346264
 * - All-Star Race: 355088
 */
const raceEntries = [
  ["346265", "2026-02-18", "Daytona"],
  ["346266", "2026-02-25", "EchoPark"],
  ["346267", "2026-03-04", "COTA"],
  ["346268", "2026-03-11", "Phoenix"],
  ["354790", "2026-03-18", "Las Vegas"],
  ["355080", "2026-03-25", "Darlington"],
  ["355081", "2026-04-01", "Martinsville"],
  ["355082", "2026-04-15", "Bristol"],
  ["355083", "2026-04-22", "Kansas"],
  ["355085", "2026-04-29", "Talladega"],
  ["355086", "2026-05-06", "Texas"],
  ["355087", "2026-05-13", "Watkins Glen"],
  ["355089", "2026-05-27", "Charlotte"],
  ["355090", "2026-06-03", "Nashville"],
  ["355091", "2026-06-10", "Michigan"],
  ["356644", "2026-06-17", "Pocono"],
  ["356645", "2026-06-24", "San Diego"],
  ["356646", "2026-07-01", "Sonoma"],
  ["356647", "2026-07-08", "Chicagoland"],
  ["356648", "2026-07-15", "EchoPark"],
  ["356649", "2026-07-22", "North Wilkesboro"],
  ["356650", "2026-07-29", "Indianapolis"],
  ["356652", "2026-08-12", "Iowa"],
  ["356653", "2026-08-19", "Richmond"],
  ["356654", "2026-08-26", "New Hampshire"],
  ["356655", "2026-09-02", "Daytona"],
  ["356656", "2026-09-09", "Darlington"],
  ["356658", "2026-09-16", "World Wide Technology"],
  ["356659", "2026-09-23", "Bristol"],
  ["356660", "2026-09-30", "Kansas"],
  ["356661", "2026-10-07", "Las Vegas"],
  ["356663", "2026-10-14", "Charlotte"],
  ["356664", "2026-10-21", "Phoenix"],
  ["356665", "2026-10-28", "Talladega"],
  ["356666", "2026-11-04", "Martinsville"],
  ["356667", "2026-11-11", "Homestead-Miami"]
];

const seasonPointRaces = raceEntries.map(
  ([scheduleId, raceDate, trackName], index) => ({
    simRacerHubRaceNumber: index + 2,
    scheduleId,
    raceDate,
    trackName,
    source:
      `https://www.simracerhub.com/season_race.php?schedule_id=${scheduleId}`
  })
);

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

function findColumn(headers, ...possibleNames) {
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

async function findRaceResultsTable(page) {
  for (const frame of page.frames()) {
    const tables = frame.locator("table");
    const tableCount = await tables.count();

    for (let index = 0; index < tableCount; index++) {
      const table = tables.nth(index);

      let tableText = "";

      try {
        tableText = normalizeHeader(
          await table.innerText()
        );
      } catch {
        continue;
      }

      if (
        tableText.includes("DRIVER") &&
        tableText.includes("TOT PTS") &&
        tableText.includes("LAPS LED") &&
        tableText.includes("FASTEST LAP")
      ) {
        return table;
      }
    }
  }

  return null;
}

async function loadRaceResultsTable(page, race) {
  const maximumAttempts = 2;

  for (
    let attempt = 1;
    attempt <= maximumAttempts;
    attempt++
  ) {
    console.log(
      `Opening Race ${race.simRacerHubRaceNumber}: ` +
      `${race.trackName} — attempt ${attempt}`
    );

    await page.goto(race.source, {
      waitUntil: "domcontentloaded",
      timeout: 90000
    });

    /*
     * Poll for up to about 24 seconds.
     */
    for (let check = 1; check <= 12; check++) {
      const table = await findRaceResultsTable(page);

      if (table) {
        return table;
      }

      await page.waitForTimeout(2000);
    }

    console.log(
      `Results table was not found for ${race.trackName} ` +
      `on attempt ${attempt}.`
    );
  }

  return null;
}

const standingsData = JSON.parse(
  await readFile("standings.json", "utf8")
);

if (
  String(standingsData.seasonId) !==
  String(seasonId)
) {
  throw new Error(
    `standings.json is for season ${standingsData.seasonId}, ` +
    `but this script expects season ${seasonId}.`
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

  const today = new Date()
    .toISOString()
    .slice(0, 10);

  const eligibleRaces = seasonPointRaces.filter(
    (race) => race.raceDate <= today
  );

  console.log(
    `Checking ${eligibleRaces.length} points races through ${today}.`
  );

  const lapsLedByDriver = new Map();
  const includedRaces = [];
  const skippedRaces = [];

  for (const race of eligibleRaces) {
    try {
      const resultsTable =
        await loadRaceResultsTable(page, race);

      if (!resultsTable) {
        skippedRaces.push({
          ...race,
          reason: "No completed results table found"
        });

        console.log(
          `Skipping ${race.trackName}: no completed results found.`
        );

        continue;
      }

      const tableData = await readTable(
        resultsTable
      );

      if (tableData.length < 2) {
        skippedRaces.push({
          ...race,
          reason: "Results table contained no driver rows"
        });

        continue;
      }

      const headers = tableData[0].map(
        (cell) => normalizeHeader(cell.text)
      );

      const driverColumn = findColumn(
        headers,
        "DRIVER"
      );

      const lapsLedColumn = findColumn(
        headers,
        "LAPS LED"
      );

      if (
        driverColumn === -1 ||
        lapsLedColumn === -1
      ) {
        skippedRaces.push({
          ...race,
          reason: "Required columns were missing"
        });

        continue;
      }

      let driversRead = 0;

      for (const row of tableData.slice(1)) {
        const driver = cleanText(
          getCell(row, driverColumn).text
        );

        if (!driver) {
          continue;
        }

        const driverKey =
          normalizeDriverName(driver);

        const lapsLed = parseNumber(
          getCell(row, lapsLedColumn).text
        );

        lapsLedByDriver.set(
          driverKey,
          (
            lapsLedByDriver.get(driverKey) || 0
          ) + lapsLed
        );

        driversRead++;
      }

      if (driversRead > 0) {
        includedRaces.push({
          ...race,
          driversRead
        });

        console.log(
          `Included ${race.trackName}: read ${driversRead} drivers.`
        );
      }
    } catch (error) {
      skippedRaces.push({
        ...race,
        reason: error.message
      });

      console.warn(
        `${race.trackName} could not be read: ${error.message}`
      );
    }
  }

  /*
   * Do not overwrite standings.json with zero totals
   * when no historical race was successfully read.
   */
  if (includedRaces.length === 0) {
    throw new Error(
      "No completed race results were successfully read. " +
      "standings.json was not changed."
    );
  }

  const totalLapsLed = Array.from(
    lapsLedByDriver.values()
  ).reduce(
    (total, lapsLed) => total + lapsLed,
    0
  );

  if (totalLapsLed === 0) {
    throw new Error(
      "Race pages were read, but the total laps led was zero. " +
      "standings.json was not changed."
    );
  }

  const enrichedStandings =
    standingsData.standings.map((entry) => {
      const driverKey =
        normalizeDriverName(entry.driver);

      return {
        ...entry,

        lapsLed:
          lapsLedByDriver.get(driverKey) || 0
      };
    });

  const lapsLedUpdatedAt =
    new Date().toISOString();

  const output = {
    ...standingsData,

    standingsUpdatedAt:
      standingsData.updatedAt,

    updatedAt:
      lapsLedUpdatedAt,

    lapsLedUpdatedAt,

    lapsLedRaceCount:
      includedRaces.length,

    lapsLedRacesIncluded:
      includedRaces,

    lapsLedRacesSkipped:
      skippedRaces,

    standings:
      enrichedStandings
  };

  await writeFile(
    "standings.json",
    JSON.stringify(output, null, 2)
  );

  console.log(
    `Success: laps led totaled from ` +
    `${includedRaces.length} completed points races.`
  );

  console.log(
    `Skipped ${skippedRaces.length} races.`
  );

  console.log(
    `Season laps led total: ${totalLapsLed}.`
  );
} finally {
  await browser.close();
}
