import { chromium } from "playwright";
import { writeFile } from "node:fs/promises";

const seasonId = process.env.SEASON_ID || "28433";

const standingsUrl =
  `https://www.simracerhub.com/season_standings.php?season_id=${seasonId}`;

/*
 * Permanent SimRacerHub schedule IDs for the
 * 2026 Moonshiners GMD Cup Series.
 *
 * Excluded from points-race laps-led totals:
 * - Daytona Duel: schedule_id 346264
 * - All-Star Race: schedule_id 355088
 *
 * The schedule IDs do not run in perfect numerical order,
 * so each race is listed individually.
 */
const seasonPointRaces = [
  {
    raceNumber: 2,
    raceDate: "2026-02-18",
    scheduleId: "346265",
    label: "Daytona International Speedway"
  },
  {
    raceNumber: 3,
    raceDate: "2026-02-25",
    scheduleId: "346266",
    label: "EchoPark Speedway"
  },
  {
    raceNumber: 4,
    raceDate: "2026-03-04",
    scheduleId: "346267",
    label: "Circuit of the Americas"
  },
  {
    raceNumber: 5,
    raceDate: "2026-03-11",
    scheduleId: "346268",
    label: "Phoenix Raceway"
  },
  {
    raceNumber: 6,
    raceDate: "2026-03-18",
    scheduleId: "354790",
    label: "Las Vegas Motor Speedway"
  },
  {
    raceNumber: 7,
    raceDate: "2026-03-25",
    scheduleId: "355080",
    label: "Darlington Raceway"
  },
  {
    raceNumber: 8,
    raceDate: "2026-04-01",
    scheduleId: "355081",
    label: "Martinsville Speedway"
  },
  {
    raceNumber: 9,
    raceDate: "2026-04-15",
    scheduleId: "355082",
    label: "Bristol Motor Speedway"
  },
  {
    raceNumber: 10,
    raceDate: "2026-04-22",
    scheduleId: "355083",
    label: "Kansas Speedway"
  },
  {
    raceNumber: 11,
    raceDate: "2026-04-29",
    scheduleId: "355085",
    label: "Talladega Superspeedway"
  },
  {
    raceNumber: 12,
    raceDate: "2026-05-06",
    scheduleId: "355086",
    label: "Texas Motor Speedway"
  },
  {
    raceNumber: 13,
    raceDate: "2026-05-13",
    scheduleId: "355087",
    label: "Watkins Glen International"
  },
  {
    raceNumber: 14,
    raceDate: "2026-05-27",
    scheduleId: "355089",
    label: "Charlotte Motor Speedway"
  },
  {
    raceNumber: 15,
    raceDate: "2026-06-03",
    scheduleId: "355090",
    label: "Nashville Superspeedway"
  },
  {
    raceNumber: 16,
    raceDate: "2026-06-10",
    scheduleId: "355091",
    label: "Michigan International Speedway"
  },
  {
    raceNumber: 17,
    raceDate: "2026-06-17",
    scheduleId: "356644",
    label: "Pocono Raceway"
  },
  {
    raceNumber: 18,
    raceDate: "2026-06-24",
    scheduleId: "356645",
    label: "San Diego"
  },
  {
    raceNumber: 19,
    raceDate: "2026-07-01",
    scheduleId: "356646",
    label: "Sonoma Raceway"
  },
  {
    raceNumber: 20,
    raceDate: "2026-07-08",
    scheduleId: "356647",
    label: "Chicagoland Speedway"
  },
  {
    raceNumber: 21,
    raceDate: "2026-07-15",
    scheduleId: "356648",
    label: "EchoPark Speedway"
  },
  {
    raceNumber: 22,
    raceDate: "2026-07-22",
    scheduleId: "356649",
    label: "North Wilkesboro Speedway"
  },
  {
    raceNumber: 23,
    raceDate: "2026-07-29",
    scheduleId: "356650",
    label: "Indianapolis Motor Speedway"
  },
  {
    raceNumber: 24,
    raceDate: "2026-08-12",
    scheduleId: "356652",
    label: "Iowa Speedway"
  },
  {
    raceNumber: 25,
    raceDate: "2026-08-19",
    scheduleId: "356653",
    label: "Richmond Raceway"
  },
  {
    raceNumber: 26,
    raceDate: "2026-08-26",
    scheduleId: "356654",
    label: "New Hampshire Motor Speedway"
  },
  {
    raceNumber: 27,
    raceDate: "2026-09-02",
    scheduleId: "356655",
    label: "Daytona International Speedway"
  },
  {
    raceNumber: 28,
    raceDate: "2026-09-09",
    scheduleId: "356656",
    label: "Darlington Raceway"
  },
  {
    raceNumber: 29,
    raceDate: "2026-09-16",
    scheduleId: "356658",
    label: "World Wide Technology Raceway"
  },
  {
    raceNumber: 30,
    raceDate: "2026-09-23",
    scheduleId: "356659",
    label: "Bristol Motor Speedway"
  },
  {
    raceNumber: 31,
    raceDate: "2026-09-30",
    scheduleId: "356660",
    label: "Kansas Speedway"
  },
  {
    raceNumber: 32,
    raceDate: "2026-10-07",
    scheduleId: "356661",
    label: "Las Vegas Motor Speedway"
  },
  {
    raceNumber: 33,
    raceDate: "2026-10-14",
    scheduleId: "356663",
    label: "Charlotte Motor Speedway"
  },
  {
    raceNumber: 34,
    raceDate: "2026-10-21",
    scheduleId: "356664",
    label: "Phoenix Raceway"
  },
  {
    raceNumber: 35,
    raceDate: "2026-10-28",
    scheduleId: "356665",
    label: "Talladega Superspeedway"
  },
  {
    raceNumber: 36,
    raceDate: "2026-11-04",
    scheduleId: "356666",
    label: "Martinsville Speedway"
  },
  {
    raceNumber: 37,
    raceDate: "2026-11-11",
    scheduleId: "356667",
    label: "Homestead-Miami Speedway"
  }
];

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

function parseOptionalNumber(value = "") {
  const cleaned = cleanText(value);

  if (
    !cleaned ||
    cleaned === "-" ||
    cleaned === "–" ||
    cleaned === "—"
  ) {
    return null;
  }

  return parseNumber(cleaned);
}

function parseChange(cell) {
  const text = cleanText(cell?.text || "");
  const html = String(cell?.html || "").toLowerCase();

  if (
    !text ||
    text === "-" ||
    text === "–" ||
    text === "—"
  ) {
    return 0;
  }

  const amount = Math.abs(parseNumber(text));

  if (
    html.includes("std-status-chg-down") ||
    html.includes("caret-down")
  ) {
    return -amount;
  }

  if (
    html.includes("std-status-chg-up") ||
    html.includes("caret-up")
  ) {
    return amount;
  }

  return parseNumber(text);
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

async function findStandingsTable(page) {
  for (const frame of page.frames()) {
    const tables = frame.locator("table");
    const tableCount = await tables.count();

    for (
      let index = 0;
      index < tableCount;
      index++
    ) {
      const table = tables.nth(index);

      const tableText = normalizeHeader(
        await table.innerText()
      );

      if (
        tableText.includes("DRIVER") &&
        tableText.includes("TOT PTS") &&
        tableText.includes("BEH CUT")
      ) {
        return {
          table,
          frameUrl: frame.url()
        };
      }
    }
  }

  return null;
}

async function findRaceResultsTable(page) {
  for (const frame of page.frames()) {
    const tables = frame.locator("table");
    const tableCount = await tables.count();

    for (
      let index = 0;
      index < tableCount;
      index++
    ) {
      const table = tables.nth(index);

      const tableText = normalizeHeader(
        await table.innerText()
      );

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

async function collectSeasonLapsLed(page) {
  const today = new Date()
    .toISOString()
    .slice(0, 10);

  /*
   * Only attempt to read races scheduled for today
   * or earlier. Future races are ignored.
   */
  const eligibleRaces = seasonPointRaces.filter(
    (race) => race.raceDate <= today
  );

  console.log(
    `Found ${eligibleRaces.length} scheduled point races through ${today}.`
  );

  const lapsLedByDriver = new Map();
  const includedRaces = [];

  for (const race of eligibleRaces) {
    const raceUrl =
      `https://www.simracerhub.com/season_race.php?schedule_id=${race.scheduleId}`;

    console.log(
      `Reading Race ${race.raceNumber}: ${race.label} (${race.raceDate})`
    );

    try {
      await page.goto(raceUrl, {
        waitUntil: "domcontentloaded",
        timeout: 90000
      });

      /*
       * Give SimRacerHub time to render the results table.
       */
      await page.waitForTimeout(2500);

      const resultsTable =
        await findRaceResultsTable(page);

      if (!resultsTable) {
        console.log(
          `Skipping Race ${race.raceNumber}: no completed results table found.`
        );

        continue;
      }

      const tableData = await readTable(
        resultsTable
      );

      if (tableData.length < 2) {
        console.log(
          `Skipping Race ${race.raceNumber}: no driver rows found.`
        );

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
        console.log(
          `Skipping Race ${race.raceNumber}: DRIVER or LAPS LED column missing.`
        );

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
          simRacerHubRaceNumber:
            race.raceNumber,

          raceDate: race.raceDate,

          label: race.label,

          scheduleId: race.scheduleId,

          source: raceUrl
        });

        console.log(
          `Included Race ${race.raceNumber}: read ${driversRead} drivers.`
        );
      }
    } catch (error) {
      console.warn(
        `Race ${race.raceNumber} could not be read: ${error.message}`
      );
    }
  }

  return {
    lapsLedByDriver,
    includedRaces
  };
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

  console.log(`Opening ${standingsUrl}`);

  await page.goto(standingsUrl, {
    waitUntil: "domcontentloaded",
    timeout: 90000
  });

  /*
   * Give SimRacerHub time to render the standings.
   */
  await page.waitForTimeout(12000);

  const standingsTableResult =
    await findStandingsTable(page);

  if (!standingsTableResult) {
    await page.screenshot({
      path: "standings-debug.png",
      fullPage: true
    });

    throw new Error(
      "Could not find the SimRacerHub standings table."
    );
  }

  const tableData = await readTable(
    standingsTableResult.table
  );

  if (tableData.length < 2) {
    throw new Error(
      "The standings table was found, but it contained no driver rows."
    );
  }

  const rawOutput = {
    seasonId,

    source: standingsUrl,

    tableFrame:
      standingsTableResult.frameUrl,

    updatedAt: new Date().toISOString(),

    headers: tableData[0],

    rows: tableData.slice(1)
  };

  await writeFile(
    "standings-raw.json",
    JSON.stringify(rawOutput, null, 2)
  );

  const headers = tableData[0].map((cell) =>
    normalizeHeader(cell.text)
  );

  const columns = {
    position: findColumn(
      headers,
      "POS",
      "POSITION"
    ),

    change: findColumn(
      headers,
      "CHG",
      "CHANGE"
    ),

    driver: findColumn(
      headers,
      "DRIVER"
    ),

    points: findColumn(
      headers,
      "TOT PTS",
      "TOTAL POINTS"
    ),

    behindCut: findColumn(
      headers,
      "BEH CUT",
      "BEHIND CUT"
    ),

    wins: findColumn(
      headers,
      "WINS"
    ),

    bonusPoints: findColumn(
      headers,
      "BNS PTS",
      "BONUS PTS"
    ),

    behindNext: findColumn(
      headers,
      "BEH NEXT",
      "BEHIND NEXT"
    ),

    starts: findColumn(
      headers,
      "STARTS"
    ),

    provisionals: findColumn(
      headers,
      "PROV",
      "PROVISIONALS"
    ),

    top5: findColumn(
      headers,
      "T-5",
      "TOP 5"
    ),

    top10: findColumn(
      headers,
      "T-10",
      "TOP 10"
    ),

    poles: findColumn(
      headers,
      "POLES"
    ),

    incidents: findColumn(
      headers,
      "INCS",
      "INCIDENTS"
    ),

    team: findColumn(
      headers,
      "TEAM"
    )
  };

  if (
    columns.position === -1 ||
    columns.driver === -1 ||
    columns.points === -1
  ) {
    throw new Error(
      `Required standings columns were not found. Headers: ${headers.join(
        ", "
      )}`
    );
  }

  const baseStandings = tableData
    .slice(1)
    .map((row) => {
      const position = parseNumber(
        getCell(
          row,
          columns.position
        ).text
      );

      const driver = cleanText(
        getCell(
          row,
          columns.driver
        ).text
      );

      return {
        position,

        change: parseChange(
          getCell(row, columns.change)
        ),

        driver,

        wins: parseNumber(
          getCell(row, columns.wins).text
        ),

        bonusPoints: parseNumber(
          getCell(
            row,
            columns.bonusPoints
          ).text
        ),

        top5: parseNumber(
          getCell(row, columns.top5).text
        ),

        top10: parseNumber(
          getCell(row, columns.top10).text
        ),

        poles: parseNumber(
          getCell(row, columns.poles).text
        ),

        starts: parseNumber(
          getCell(row, columns.starts).text
        ),

        points: parseNumber(
          getCell(row, columns.points).text
        ),

        behindCut: parseNumber(
          getCell(
            row,
            columns.behindCut
          ).text
        ),

        behindNext: parseOptionalNumber(
          getCell(
            row,
            columns.behindNext
          ).text
        ),

        provisionals: parseNumber(
          getCell(
            row,
            columns.provisionals
          ).text
        ),

        incidents: parseNumber(
          getCell(
            row,
            columns.incidents
          ).text
        ),

        team: cleanText(
          getCell(row, columns.team).text
        )
      };
    })
    .filter(
      (entry) =>
        entry.position > 0 &&
        entry.driver
    );

  /*
   * Open every completed points race and total
   * each driver's season-long laps led.
   */
  const lapsLedData =
    await collectSeasonLapsLed(page);

  const standings = baseStandings.map(
    (entry) => {
      const driverKey =
        normalizeDriverName(entry.driver);

      return {
        position: entry.position,

        change: entry.change,

        driver: entry.driver,

        wins: entry.wins,

        bonusPoints: entry.bonusPoints,

        lapsLed:
          lapsLedData.lapsLedByDriver.get(
            driverKey
          ) || 0,

        top5: entry.top5,

        top10: entry.top10,

        poles: entry.poles,

        starts: entry.starts,

        points: entry.points,

        behindCut: entry.behindCut,

        behindNext: entry.behindNext,

        provisionals: entry.provisionals,

        incidents: entry.incidents,

        team: entry.team
      };
    }
  );

  const cleanOutput = {
    seasonId,

    source: standingsUrl,

    updatedAt: new Date().toISOString(),

    driverCount: standings.length,

    lapsLedRaceCount:
      lapsLedData.includedRaces.length,

    lapsLedRacesIncluded:
      lapsLedData.includedRaces,

    standings
  };

  await writeFile(
    "standings.json",
    JSON.stringify(cleanOutput, null, 2)
  );

  console.log(
    `Success: saved ${standings.length} drivers to standings.json`
  );

  console.log(
    `Laps led were totaled from ${lapsLedData.includedRaces.length} completed point races.`
  );
} finally {
  await browser.close();
}
