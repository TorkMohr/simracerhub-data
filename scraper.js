import { chromium } from "playwright";
import { writeFile } from "node:fs/promises";

const seasonId = process.env.SEASON_ID || "28433";

const standingsUrl =
  `https://www.simracerhub.com/season_standings.php?season_id=${seasonId}`;

const raceResultsUrl =
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

function parseRaceDateIso(value = "") {
  const match = value.match(
    /\b(\d{2})\/(\d{2})\/(\d{4})\b/
  );

  if (!match) {
    return null;
  }

  const [, month, day, year] = match;

  return `${year}-${month}-${day}`;
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
  console.log(
    "Opening the season race-results page..."
  );

  await page.goto(raceResultsUrl, {
    waitUntil: "domcontentloaded",
    timeout: 90000
  });

  await page.waitForTimeout(8000);

   /*
   * SimRacerHub may present the race picker as
   * links, dropdown options, or data attributes.
   */
  const scheduleLinks = await page.evaluate(() => {
    const elements = Array.from(
      document.querySelectorAll(
        "a, option, [data-href], [data-url]"
      )
    );

    return elements
      .map((element) => {
        const text = (
          element.innerText ||
          element.textContent ||
          ""
        )
          .replace(/\s+/g, " ")
          .trim();

        // Ignore anything that is not a numbered race.
        if (!/Race\s+\d+/i.test(text)) {
          return null;
        }

        const rawValue =
          element.getAttribute("href") ||
          element.getAttribute("value") ||
          element.getAttribute("data-href") ||
          element.getAttribute("data-url") ||
          "";

        if (!rawValue) {
          return null;
        }

        let href = "";

        try {
          /*
           * Some dropdowns store only the numeric
           * schedule ID instead of a complete URL.
           */
          if (/^\d+$/.test(rawValue)) {
            href = new URL(
              `season_race.php?schedule_id=${rawValue}`,
              window.location.href
            ).href;
          } else if (
            rawValue.includes("schedule_id=")
          ) {
            href = new URL(
              rawValue,
              window.location.href
            ).href;
          } else {
            return null;
          }
        } catch {
          return null;
        }

        return {
          text,
          href
        };
      })
      .filter(Boolean);
  });

  console.log(
    `Found ${scheduleLinks.length} race-link candidates.`
  );

  const uniqueLinks = Array.from(
    new Map(
      scheduleLinks.map((link) => [
        link.href,
        link
      ])
    ).values()
  );

  const today = new Date()
    .toISOString()
    .slice(0, 10);

  const pointRaces = uniqueLinks
    .map((link) => {
      const raceNumberMatch = link.text.match(
        /Race\s+(\d+)/i
      );

      return {
        ...link,

        raceNumber: raceNumberMatch
          ? Number(raceNumberMatch[1])
          : null,

        raceDate: parseRaceDateIso(link.text)
      };
    })
    .filter((race) => {
      return (
        race.raceNumber !== null &&
        race.raceNumber !== 1 &&
        race.raceDate &&
        race.raceDate <= today
      );
    })
    .sort((first, second) =>
      first.raceNumber - second.raceNumber
    );

  console.log(
    `Found ${pointRaces.length} scheduled point races through ${today}.`
  );

  const lapsLedByDriver = new Map();
  const includedRaces = [];

  for (const race of pointRaces) {
    console.log(
      `Reading Race ${race.raceNumber}: ${race.text}`
    );

    try {
      await page.goto(race.href, {
        waitUntil: "domcontentloaded",
        timeout: 90000
      });

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

          label: race.text,

          source: race.href
        });
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
    .filter((entry) =>
      entry.position > 0 && entry.driver
    );

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
