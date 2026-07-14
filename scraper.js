import { chromium } from "playwright";
import { writeFile } from "node:fs/promises";

const seasonId = process.env.SEASON_ID || "28433";

const standingsUrl =
  `https://www.simracerhub.com/season_standings.php?season_id=${seasonId}`;

function cleanText(value = "") {
  return value.replace(/\s+/g, " ").trim();
}

function normalizeHeader(value = "") {
  return cleanText(value).toUpperCase();
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

const browser = await chromium.launch({
  headless: true
});

try {
  const page = await browser.newPage({
    viewport: {
      width: 1800,
      height: 1200
    }
  });

  console.log(`Opening ${standingsUrl}`);

  await page.goto(standingsUrl, {
    waitUntil: "domcontentloaded",
    timeout: 90000
  });

  await page.waitForTimeout(12000);

  let standingsTable = null;
  let standingsFrameUrl = "";

  for (const frame of page.frames()) {
    const tables = frame.locator("table");
    const tableCount = await tables.count();

    console.log(
      `Checking ${tableCount} tables in frame: ${frame.url()}`
    );

    for (let i = 0; i < tableCount; i++) {
      const table = tables.nth(i);
      const tableText = await table.innerText();

      const normalizedText = tableText
        .replace(/\s+/g, " ")
        .toUpperCase();

      if (
        normalizedText.includes("DRIVER") &&
        normalizedText.includes("TOT PTS") &&
        normalizedText.includes("BEH CUT")
      ) {
        standingsTable = table;
        standingsFrameUrl = frame.url();
        break;
      }
    }

    if (standingsTable) {
      break;
    }
  }

  if (!standingsTable) {
    await page.screenshot({
      path: "standings-debug.png",
      fullPage: true
    });

    throw new Error(
      "Could not find the SimRacerHub standings table."
    );
  }

  const tableData = await standingsTable.evaluate((table) => {
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
      "The standings table was found, but it contained no driver rows."
    );
  }

  const rawOutput = {
    seasonId,
    source: standingsUrl,
    tableFrame: standingsFrameUrl,
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

  function findColumn(...possibleNames) {
    return headers.findIndex((header) =>
      possibleNames.includes(header)
    );
  }

  const columns = {
    position: findColumn("POS", "POSITION"),
    change: findColumn("CHG", "CHANGE"),
    driver: findColumn("DRIVER"),
    points: findColumn("TOT PTS", "TOTAL POINTS"),
    behindCut: findColumn("BEH CUT", "BEHIND CUT"),
    wins: findColumn("WINS"),
    bonusPoints: findColumn("BNS PTS", "BONUS PTS"),
    behindNext: findColumn("BEH NEXT", "BEHIND NEXT"),
    starts: findColumn("STARTS"),
    provisionals: findColumn("PROV", "PROVISIONALS"),
    top5: findColumn("T-5", "TOP 5"),
    top10: findColumn("T-10", "TOP 10"),
    poles: findColumn("POLES"),
    incidents: findColumn("INCS", "INCIDENTS"),
    team: findColumn("TEAM")
  };

  if (
    columns.position === -1 ||
    columns.driver === -1 ||
    columns.points === -1
  ) {
    throw new Error(
      `Required columns were not found. Headers: ${headers.join(", ")}`
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
          getCell(row, columns.bonusPoints).text
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
          getCell(row, columns.behindCut).text
        ),

        behindNext: parseOptionalNumber(
          getCell(row, columns.behindNext).text
        ),

        provisionals: parseNumber(
          getCell(row, columns.provisionals).text
        ),

        incidents: parseNumber(
          getCell(row, columns.incidents).text
        ),

        team: cleanText(
          getCell(row, columns.team).text
        )
      };
    })
    .filter((entry) =>
      entry.position > 0 && entry.driver
    );

  const cleanOutput = {
    seasonId,
    source: standingsUrl,
    updatedAt: new Date().toISOString(),
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
