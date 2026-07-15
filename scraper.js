import { chromium } from "playwright";
import { writeFile } from "node:fs/promises";

const seasonId = process.env.SEASON_ID || "28433";

const standingsUrl =
  `https://www.simracerhub.com/season_standings.php?season_id=${seasonId}`;

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

async function loadStandingsTable(page) {
  const maximumAttempts = 3;

  for (
    let attempt = 1;
    attempt <= maximumAttempts;
    attempt++
  ) {
    console.log(
      `Loading standings — attempt ${attempt} of ${maximumAttempts}`
    );

    await page.goto(standingsUrl, {
      waitUntil: "domcontentloaded",
      timeout: 90000
    });

    /*
     * Poll for up to 60 seconds. This is more reliable
     * than waiting a fixed number of seconds once.
     */
    for (let check = 1; check <= 20; check++) {
      const standingsTable =
        await findStandingsTable(page);

      if (standingsTable) {
        console.log(
          `Standings table found on check ${check}.`
        );

        return standingsTable;
      }

      console.log(
        `Standings table not ready — check ${check} of 20.`
      );

      await page.waitForTimeout(3000);
    }

    if (attempt < maximumAttempts) {
      console.log(
        "Standings did not load. Retrying with a fresh page load."
      );
    }
  }

  await page.screenshot({
    path: "standings-debug.png",
    fullPage: true
  });

  throw new Error(
    "Could not find the SimRacerHub standings table after three attempts."
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

  console.log(`Opening ${standingsUrl}`);

  const standingsTableResult =
    await loadStandingsTable(page);

  const tableData = await readTable(
    standingsTableResult.table
  );

  if (tableData.length < 2) {
    throw new Error(
      "The standings table was found, but it contained no driver rows."
    );
  }

  const updatedAt = new Date().toISOString();

  const rawOutput = {
    seasonId,
    source: standingsUrl,
    tableFrame: standingsTableResult.frameUrl,
    updatedAt,
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

  const standings = tableData
    .slice(1)
    .map((row) => {
      const position = parseNumber(
        getCell(row, columns.position).text
      );

      const driver = cleanText(
        getCell(row, columns.driver).text
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

  if (standings.length === 0) {
    throw new Error(
      "No driver standings were read."
    );
  }

  const cleanOutput = {
    seasonId,
    source: standingsUrl,
    updatedAt,
    driverCount: standings.length,
    standings
  };

  await writeFile(
    "standings.json",
    JSON.stringify(cleanOutput, null, 2)
  );

  console.log(
    `Success: saved ${standings.length} drivers to standings.json`
  );
} finally {
  await browser.close();
}
