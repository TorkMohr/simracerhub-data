import { chromium } from "playwright";
import { writeFile } from "node:fs/promises";

const seasonId = process.env.SEASON_ID || "28433";

const standingsUrl =
  `https://www.simracerhub.com/season_standings.php?season_id=${seasonId}`;

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

  // Give the standings table time to load.
  await page.waitForTimeout(12000);

  let standingsTable = null;
  let standingsFrameUrl = "";

  // Search the main page and any frames for the correct table.
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
    const rows = Array.from(table.querySelectorAll("tr"));

    return rows
      .map((row) => {
        const cells = Array.from(
          row.querySelectorAll("th, td")
        );

        return cells.map((cell) => ({
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

  const output = {
    seasonId,
    source: standingsUrl,
    tableFrame: standingsFrameUrl,
    updatedAt: new Date().toISOString(),
    headers: tableData[0],
    rows: tableData.slice(1)
  };

  await writeFile(
    "standings-raw.json",
    JSON.stringify(output, null, 2)
  );

  console.log(
    `Success: saved ${output.rows.length} standings rows.`
  );
} finally {
  await browser.close();
}
