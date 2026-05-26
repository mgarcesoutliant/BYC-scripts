// ======================================
// menu-validator.js
// ======================================

const { chromium } = require("@playwright/test");

const fs = require("fs");
const csv = require("csv-parser");

const createCsvWriter = require("csv-writer").createObjectCsvWriter;

// ======================================
// ENVIRONMENT URL
// ======================================

const BASE_URL = process.env.BASE_URL || "https://uat.thebrokenyolkcafe.com";

const MENU_TYPE = process.env.MENU_TYPE || "main-menu";

const IS_NUTRITION_INFO_PAGE = MENU_TYPE === "nutrition-info";

const MENU_PAGE = IS_NUTRITION_INFO_PAGE
  ? `${BASE_URL}/nutritional-info`
  : MENU_TYPE === "catering"
    ? `${BASE_URL}/catering`
    : `${BASE_URL}/menu/${MENU_TYPE}`;
// ======================================
// INPUT FILE
// ======================================

const INPUT_FILE = process.env.INPUT_FILE || "./input/main-menu.csv";
const NUTRITION_FILE =
  process.env.NUTRITION_FILE || `./input/${MENU_TYPE}-nutrition.csv`;

// ======================================
// OUTPUT PATHS
// ======================================

const FRONT_OUTPUT_DIR = `./output/${MENU_TYPE}/screenshots/front`;

const NUTRITION_OUTPUT_DIR = `./output/${MENU_TYPE}/screenshots/nutrition`;

const OUTPUT_REPORT = `./output/${MENU_TYPE}/report.csv`;

const CATEGORY_REPORT = `./output/${MENU_TYPE}/category-comparison.csv`;

// ======================================
// CREATE OUTPUT FOLDER
// ======================================

if (!fs.existsSync(FRONT_OUTPUT_DIR)) {
  fs.mkdirSync(FRONT_OUTPUT_DIR, {
    recursive: true,
  });
}

if (!fs.existsSync(NUTRITION_OUTPUT_DIR)) {
  fs.mkdirSync(NUTRITION_OUTPUT_DIR, {
    recursive: true,
  });
}

// ======================================
// CLEAN OLD SCREENSHOTS
// ======================================

[FRONT_OUTPUT_DIR, NUTRITION_OUTPUT_DIR].forEach((dir) => {
  if (!fs.existsSync(dir)) return;

  fs.readdirSync(dir).forEach((file) => {
    const filePath = `${dir}/${file}`;

    if (fs.lstatSync(filePath).isFile()) {
      fs.unlinkSync(filePath);
    }
  });
});

// ======================================
// NORMALIZE TEXT
// ======================================

function normalize(text) {
  return (text || "")
    .toLowerCase()
    .replace(/…/g, "...")
    .replace(/[–—-]/g, " ")
    .replace(/\s+/g, " ")
    .replace(/\n/g, " ")
    .trim();
}
function normalizeDescription(text) {
  return normalize(text)
    .replace(/\boz\b/g, "oz")
    .replace(/(\d)\s*oz/g, "$1oz")
    .replace(/[^a-z0-9\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}
function normalizeMenuItem(text) {
  return normalize(text)
    .replace(/[™®]/g, "")
    .replace(/[’']/g, "")
    .replace(/&/g, " and ")
    .replace(/\bo['’]?/g, "o")
    .replace(/\./g, "")
    .replace(/[^a-z0-9\s]/g, " ")
    .replace(/^(the|a|an)\s+/i, "")
    .replace(/\bcali\b/g, "california")
    .replace(/\bclassic\s+/g, "")
    .replace(/\biced\s+/g, "")
    .replace(/\btea latte\b/g, "latte")
    .replace(/\bbiscuits\b/g, "biscuit")
    .replace(/\bpancakes\b/g, "pancake")
    .replace(/\bburgers\b/g, "burger")
    .replace(/\bburritos\b/g, "burrito")
    .replace(/\bomelets\b/g, "omelet")
    .replace(/\bskillets\b/g, "skillet")
    .replace(/\bwaffles\b/g, "waffle")
    .replace(/\blattes\b/g, "latte")
    .replace(/\s+/g, " ")
    .trim();
}

function compactMenuItem(text) {
  return normalizeMenuItem(text).replace(/\s+/g, "");
}
function exactItemKey(text) {
  return normalizeMenuItem(text).replace(/[^a-z0-9]/g, "");
}

function levenshteinDistance(a, b) {
  const matrix = Array.from({ length: b.length + 1 }, (_, i) => [i]);

  for (let j = 0; j <= a.length; j++) {
    matrix[0][j] = j;
  }

  for (let i = 1; i <= b.length; i++) {
    for (let j = 1; j <= a.length; j++) {
      matrix[i][j] =
        b[i - 1] === a[j - 1]
          ? matrix[i - 1][j - 1]
          : Math.min(
              matrix[i - 1][j - 1] + 1,
              matrix[i][j - 1] + 1,
              matrix[i - 1][j] + 1,
            );
    }
  }

  return matrix[b.length][a.length];
}

function tokensCompatible(a, b) {
  if (a === b) return true;

  if (a.length >= 4 && b.length >= 4 && (a.startsWith(b) || b.startsWith(a))) {
    return true;
  }

  if (
    a.length >= 6 &&
    b.length >= 6 &&
    a[0] === b[0] &&
    levenshteinDistance(a, b) <= 1
  ) {
    return true;
  }

  return false;
}

function fuzzyMenuNameMatch(a, b) {
  const aTokens = normalizeMenuItem(a).split(" ").filter(Boolean).sort();

  const bTokens = normalizeMenuItem(b).split(" ").filter(Boolean).sort();

  if (aTokens.length !== bTokens.length) return false;

  return aTokens.every((token, index) =>
    tokensCompatible(token, bTokens[index]),
  );
}

function tokenContainmentMatch(a, b) {
  const aTokens = normalizeMenuItem(a).split(" ").filter(Boolean);
  const bTokens = normalizeMenuItem(b).split(" ").filter(Boolean);

  const shorter = aTokens.length <= bTokens.length ? aTokens : bTokens;
  const longer = aTokens.length > bTokens.length ? aTokens : bTokens;

  return shorter.length > 0 && shorter.every((token) => longer.includes(token));
}

function getMeaningfulMenuTokens(text) {
  return normalizeMenuItem(text)
    .split(" ")
    .filter((token) => token && token.length > 2 && !/^\d+$/.test(token));
}

function reorderedTokenVariantMatch(a, b) {
  const aTokens = getMeaningfulMenuTokens(a);
  const bTokens = getMeaningfulMenuTokens(b);

  if (aTokens.length === 0 || bTokens.length === 0) return false;

  // Prevent partial-size matches like:
  // Gallon Orange Juice -> Orange Juice
  if (aTokens.length !== bTokens.length) return false;

  const aSorted = [...aTokens].sort().join(" ");
  const bSorted = [...bTokens].sort().join(" ");

  return aSorted === bSorted;
}

function normalizeCategory(text) {
  return normalize(text).replace(/[!]/g, "").trim();
}

function normalizeNutritionValue(value) {
  const normalized = String(value || "")
    .toLowerCase()
    .replace("<", "")
    .replace(/(\d),(\d)/g, "$1.$2")
    .replace(/,/g, "")
    .trim();

  if (!normalized || normalized === "n/a" || normalized === "--") {
    return "";
  }

  return normalized;
}

function nutritionValuesMatch(actualValue, expectedValue) {
  const actual = normalizeNutritionValue(actualValue);
  const expected = normalizeNutritionValue(expectedValue);

  if (!actual && !expected) return true;
  if (!actual || !expected) return false;

  if (actual === expected) return true;

  const actualParts = actual.split("/");
  const expectedParts = expected.split("/");

  return actualParts.includes(expected) || expectedParts.includes(actual);
}

const nutritionKeys = [
  ["Calories", "Calories"],
  ["Calories from Fat", "Calories from Fat"],
  ["Total Fat (g)", "Total Fat (g)"],
  ["Sat Fat (g)", "Sat Fat (g)"],
  ["Trans Fat (g)", "Trans Fat (g)"],
  ["Cholesterol (mg)", "Cholest. (mg)"],
  ["Sodium (mg)", "Sodium (mg)"],
  ["Carbs (g)", "Carbs (g)"],
  ["Dietary Fiber (g)", "Dietary Fiber (g)"],
  ["Sugar (g)", "Sugar (g)"],
  ["Protein (g)", "Protein (g)"],
];

function getNutritionScore(csvRow, uiNutrition) {
  let checked = 0;
  let matched = 0;

  for (const [csvKey, uiKey] of nutritionKeys) {
    const csvValue = normalizeNutritionValue(csvRow[csvKey]);
    const uiValue = normalizeNutritionValue(uiNutrition[uiKey]);

    if (!csvValue || !uiValue || csvValue === "n/a" || uiValue === "n/a") {
      continue;
    }

    checked++;

    if (nutritionValuesMatch(uiValue, csvValue)) {
      matched++;
    }
  }

  return checked > 0 ? matched / checked : 0;
}

function hasCsvNutrition(row) {
  return nutritionKeys.some(([csvKey]) => {
    const value = normalizeNutritionValue(row[csvKey]);

    return value && value !== "n/a";
  });
}
// ======================================
// READ CSV
// ======================================

function readCSV(filePath) {
  return new Promise((resolve) => {
    const results = [];

    fs.createReadStream(filePath)
      .pipe(csv())
      .on("data", (data) => results.push(data))
      .on("end", () => resolve(results));
  });
}

// ======================================
// MAIN
// ======================================

(async () => {
  console.log("\n============================");
  console.log("STARTING MENU VALIDATION");
  console.log("============================");

  const input = await readCSV(INPUT_FILE);
  const nutritionDataCsv = await readCSV(NUTRITION_FILE);

  const preparedNutritionDataCsv = nutritionDataCsv.map((row) => ({
    row,

    csvCategory: normalizeCategory(row["Category"]),

    csvItem: normalizeMenuItem(row["Item Name"]),

    csvCompactItem: compactMenuItem(row["Item Name"]),

    csvExactKey: exactItemKey(row["Item Name"]),

    csvRange: normalize(row["Range"]),

    hasNutrition: hasCsvNutrition(row),
  }));

  const validationInput = IS_NUTRITION_INFO_PAGE
    ? nutritionDataCsv.map((row) => ({
        ...row,
        Header: row["Item Name"],
        Category: row["Category"],
        "Copy Content": "",
      }))
    : input;

  const browser = await chromium.launch({
    headless: true,
  });

  const page = await browser.newPage({
    viewport: {
      width: 1440,
      height: 4000,
    },
  });

  await page.goto(MENU_PAGE, {
    waitUntil: "networkidle",
  });

  const results = [];

  let currentlyOpenAccordion = null;
  let currentlyOpenAccordionElement = null;
  let currentAccordionContent = null;

  // ======================================
  // LOOP CSV
  // ======================================

  for (const item of validationInput) {
    const expectedCategory = item["Category"];

    const expectedTitle = item["Header"];
    let nutritionItem = null;
    let expectedNutrition = {};

    const copyContent = item["Copy Content"];

    console.log("\n-----------------------------------");

    console.log(`MENU ITEM: ${expectedTitle}`);

    console.log("-----------------------------------");

    let status = "UNKNOWN";

    let nutritionMatch = true;

    let nutritionInfoStatus = "NO_NUTRITIONAL_INFO";

    let nutritionMismatchFields = [];

    let nutritionScreenshot = "";

    let detectedCategory = "";

    let detectedSubCategory = "";

    let detectedCardTitle = "";

    let uatDescription = "";

    let screenshotPath = "";

    try {
      // ======================================
      // STRUCTURE-AWARE FLOW
      // SUPPORTS:
      // - MAIN MENU
      // - KIDS MENU
      // - FUTURE MENU STRUCTURES
      // ======================================

      let cards;

      // CHECK IF PAGE HAS ACCORDIONS

      const accordionTriggerCount = await page
        .locator(".menu-accordion-trigger")
        .count();

      // ======================================
      // ACCORDION FLOW
      // ======================================
      // ========================================
      // NUTRITION INFO PAGE FLOW
      // ========================================

      if (IS_NUTRITION_INFO_PAGE) {
        status = "MATCH";
        detectedCategory = expectedCategory;

        console.log("🥗 NUTRITION INFO PAGE FLOW");

        let matchedNutritionItem = null;

        const accordionTriggers = page.locator(
          '[fs-accordion-element="trigger"]',
        );
        const accordionCount = await accordionTriggers.count();

        let matchedAccordion = null;
        let matchedAccordionTitle = "";

        const expectedCategoryNormalized = normalizeMenuItem(expectedCategory);

        for (let i = 0; i < accordionCount; i++) {
          const accordion = accordionTriggers.nth(i);
          const accordionTitle = normalizeMenuItem(await accordion.innerText());

          if (
            accordionTitle.includes(expectedCategoryNormalized) ||
            expectedCategoryNormalized.includes(accordionTitle)
          ) {
            matchedAccordion = accordion;
            matchedAccordionTitle = accordionTitle;
            break;
          }
        }

        if (!matchedAccordion) {
          nutritionInfoStatus = "NOT_FOUND";
          throw new Error("__NUTRITION_INFO_DONE__");
        }

        if (currentlyOpenAccordion !== matchedAccordionTitle) {
          if (currentlyOpenAccordionElement) {
            console.log(`📂 CLOSING ACCORDION: ${currentlyOpenAccordion}`);
            await currentlyOpenAccordionElement.click();
            await page.waitForTimeout(200);
          }

          console.log(`📂 OPENING ACCORDION: ${matchedAccordionTitle}`);
          await matchedAccordion.click();
          await page.waitForTimeout(300);

          currentlyOpenAccordion = matchedAccordionTitle;
          currentlyOpenAccordionElement = matchedAccordion;

          currentAccordionContent = matchedAccordion.locator(
            'xpath=following-sibling::*[@fs-accordion-element="content"]',
          );
        }

        const nutritionCards = currentAccordionContent.locator(
          ".main-menu-swiper-slide",
        );
        const nutritionCardCount = await nutritionCards.count();

        for (let j = 0; j < nutritionCardCount; j++) {
          const card = nutritionCards.nth(j);

          let cardTitle = "";

          try {
            cardTitle = await card
              .locator(".nutritional-card-heading")
              .innerText();
          } catch {
            continue;
          }

          const normalizedCardTitle = normalizeMenuItem(cardTitle);
          const normalizedExpectedTitle = normalizeMenuItem(expectedTitle);

          const isExactMatch = normalizedCardTitle === normalizedExpectedTitle;

          const isVariantMatch = tokenContainmentMatch(
            normalizedCardTitle,
            normalizedExpectedTitle,
          );

          const isReorderedVariant = reorderedTokenVariantMatch(
            normalizedCardTitle,
            normalizedExpectedTitle,
          );

          if (!isExactMatch && !isVariantMatch && !isReorderedVariant) {
            continue;
          }

          matchedNutritionItem = cardTitle;
          detectedCardTitle = cardTitle;

          console.log(`✅ NUTRITION CARD MATCHED: ${cardTitle}`);

          const nutritionRows = card.locator(
            ".by-grid.flip-card-back-side-grid",
          );
          const nutritionRowCount = await nutritionRows.count();

          const nutritionData = {};

          for (let k = 0; k < nutritionRowCount; k++) {
            const row = nutritionRows.nth(k);

            try {
              const label = await row
                .locator(".flip-card-back-side-grid-cell-wrapper-text")
                .innerText();

              const value = await row
                .locator(".by-text-md.flip-card-back-side-grid-cell-wrapper-1")
                .last()
                .innerText();

              nutritionData[label.trim()] = value.trim();
            } catch {}
          }

          nutritionItem = item;

          expectedNutrition = {
            Calories: nutritionItem?.["Calories"],
            "Calories from Fat": nutritionItem?.["Calories from Fat"],
            "Total Fat (g)": nutritionItem?.["Total Fat (g)"],
            "Sat Fat (g)": nutritionItem?.["Sat Fat (g)"],
            "Trans Fat (g)": nutritionItem?.["Trans Fat (g)"],
            "Cholest. (mg)": nutritionItem?.["Cholesterol (mg)"],
            "Sodium (mg)": nutritionItem?.["Sodium (mg)"],
            "Carbs (g)": nutritionItem?.["Carbs (g)"],
            "Dietary Fiber (g)": nutritionItem?.["Dietary Fiber (g)"],
            "Sugar (g)": nutritionItem?.["Sugar (g)"],
            "Protein (g)": nutritionItem?.["Protein (g)"],
          };

          for (const key in expectedNutrition) {
            const expectedValue = String(expectedNutrition[key] || "").trim();
            const actualValue = String(nutritionData[key] || "").trim();

            if (
              expectedValue &&
              !nutritionValuesMatch(actualValue, expectedValue)
            ) {
              nutritionMatch = false;

              nutritionMismatchFields.push(
                `${key}: INPUT=${expectedValue} | UAT=${actualValue}`,
              );
            }
          }

          nutritionInfoStatus = isExactMatch ? "MATCH" : "VARIANT_MATCH";

          const safeName = expectedTitle
            .normalize("NFKD")
            .replace(/[’']/g, "")
            .replace(/&/g, "and")
            .replace(/[^a-zA-Z0-9]/g, "_")
            .replace(/_+/g, "_")
            .replace(/^_+|_+$/g, "");

          nutritionScreenshot = `${NUTRITION_OUTPUT_DIR}/${safeName}_nutrition.png`;

          try {
            const clip = await card.evaluate((el) => {
              const sourceCard =
                el.querySelector(".nutritional-info-card") || el;

              const oldClone = document.querySelector(
                '[data-temp-nutrition-screenshot="true"]',
              );

              if (oldClone) {
                oldClone.remove();
              }

              const sourceBounds = sourceCard.getBoundingClientRect();

              const cardWidth = Math.ceil(
                sourceBounds.width || sourceCard.offsetWidth || 264,
              );

              const cardHeight = Math.ceil(
                sourceBounds.height || sourceCard.offsetHeight || 371,
              );

              const clone = sourceCard.cloneNode(true);

              clone.setAttribute("data-temp-nutrition-screenshot", "true");

              Object.assign(clone.style, {
                position: "fixed",
                top: "120px",
                left: "120px",
                width: `${cardWidth}px`,
                height: `${cardHeight}px`,
                minHeight: `${cardHeight}px`,
                maxHeight: `${cardHeight}px`,
                display: "block",
                visibility: "visible",
                opacity: "1",
                zIndex: "999999",
                background: "#ffffff",
                transform: "none",
                pointerEvents: "none",
                overflow: "hidden",
              });

              document.body.appendChild(clone);

              const bounds = clone.getBoundingClientRect();

              return {
                x: Math.floor(bounds.x),
                y: Math.floor(bounds.y),
                width: Math.floor(bounds.width),
                height: Math.floor(bounds.height),
              };
            });

            await page.waitForTimeout(300);

            await page.screenshot({
              path: nutritionScreenshot,
              clip,
              animations: "disabled",
              timeout: 5000,
            });

            await page
              .locator('[data-temp-nutrition-screenshot="true"]')
              .evaluate((el) => el.remove())
              .catch(() => {});

            console.log(`📸 ${nutritionScreenshot}`);
          } catch (screenshotError) {
            console.log(`⚠️ Screenshot skipped: ${screenshotError.message}`);
          }

          break;
        }

        if (!matchedNutritionItem) {
          nutritionInfoStatus = "NOT_FOUND";
        }

        throw new Error("__NUTRITION_INFO_DONE__");
      }

      if (accordionTriggerCount > 0) {
        const categoryAccordion = page
          .locator(".menu-accordion, .catering-accordion")
          .filter({
            hasText: expectedCategory,
          })
          .first();

        const trigger = categoryAccordion.locator(".menu-accordion-trigger");

        const className = await trigger.getAttribute("class");

        // OPEN ACCORDION IF CLOSED

        if (!className.includes("is-active-accordion")) {
          await trigger.click();

          await page.waitForTimeout(300);
        }

        detectedCategory = await trigger.innerText();

        cards = categoryAccordion.locator(".flip-card-wrapper");

        console.log("ℹ️ ACCORDION FLOW DETECTED");
      } else {
        // ======================================
        // DIRECT PAGE FLOW
        // ======================================

        detectedCategory = expectedCategory;

        cards = page.locator(".flip-card-wrapper");

        console.log("ℹ️ DIRECT PAGE FLOW DETECTED");
      }

      const cardCount = await cards.count();

      let matchedCard = null;

      for (let i = 0; i < cardCount; i++) {
        const card = cards.nth(i);

        const titleLocator = card.locator(".flip-card-front-side-heading");

        if ((await titleLocator.count()) === 0) {
          continue;
        }

        const cardTitle = await titleLocator.innerText();

        const normalizedCard = normalize(cardTitle);

        const normalizedExpected = normalize(expectedTitle);

        // ======================================
        // HANDLE ELLIPSIS + STRICT MATCHING
        // ======================================

        const hasEllipsis = normalizedCard.includes("...");

        // REMOVE ELLIPSIS

        const cleanedCard = normalizedCard.replace(/\.\.\./g, "").trim();

        const cleanedExpected = normalizedExpected.trim();

        // STRICT MATCHING

        let titleMatch = false;

        // EXACT MATCH

        if (cleanedCard === cleanedExpected) {
          titleMatch = true;
        }

        // UI TRUNCATION MATCH
        else if (hasEllipsis && cleanedExpected.startsWith(cleanedCard)) {
          titleMatch = true;
        }

        if (!titleMatch) continue;

        matchedCard = card;

        detectedCardTitle = cardTitle;

        detectedSubCategory = await card.evaluate((el) => {
          const wrapper = el.closest("[data-wf-menu-content-category-wrapper]");

          if (!wrapper) return "";

          const heading =
            wrapper.querySelector(".menu-accordion-content-heading") ||
            wrapper.previousElementSibling?.querySelector?.(
              ".menu-accordion-content-heading",
            ) ||
            wrapper.previousElementSibling;

          if (
            heading &&
            heading.classList?.contains("menu-accordion-content-heading")
          ) {
            return heading.innerText;
          }

          let previous = wrapper.previousElementSibling;

          while (previous) {
            const previousHeading =
              previous.querySelector?.(".menu-accordion-content-heading") ||
              (previous.matches?.(".menu-accordion-content-heading")
                ? previous
                : null);

            if (previousHeading) {
              return previousHeading.innerText;
            }

            previous = previous.previousElementSibling;
          }

          return "";
        });
        console.log(`ℹ️ SUBCATEGORY: ${detectedSubCategory || "NONE"}`);
        console.log(`✅ CARD MATCHED: ${cardTitle}`);

        break;
      }

      if (!matchedCard) {
        status = "MENU_MISMATCH";

        throw new Error(`Card not found: ${expectedTitle}`);
      }

      // ======================================
      // WAIT CARD
      // ======================================

      await matchedCard.waitFor({
        state: "attached",

        timeout: 10000,
      });

      // ======================================
      // FORCE SWIPER ACTIVE
      // ======================================

      await matchedCard.evaluate((el) => {
        const slide = el.closest(".swiper-slide");

        if (slide) {
          slide.style.display = "block";

          slide.style.visibility = "visible";

          slide.style.opacity = "1";

          slide.style.width = "400px";

          slide.classList.add("swiper-slide-active");
        }

        const rect = el.getBoundingClientRect();

        window.scrollTo({
          top:
            window.scrollY +
            rect.top -
            window.innerHeight / 2 +
            rect.height / 2,

          behavior: "instant",
        });
      });

      await page.waitForTimeout(500);

      // ======================================
      // DESCRIPTION
      // ======================================

      const descLocator = matchedCard.locator(
        ".flip-card-front-side-description",
      );

      if ((await descLocator.count()) > 0) {
        uatDescription = await descLocator.innerText();
      }

      // ======================================
      // VALIDATION
      // ======================================

      const categoryMatch = normalize(detectedCategory).includes(
        normalize(expectedCategory),
      );

      const descriptionMatch =
        normalizeDescription(uatDescription).includes(
          normalizeDescription(copyContent),
        ) ||
        normalizeDescription(copyContent).includes(
          normalizeDescription(uatDescription),
        );

      if (categoryMatch && descriptionMatch) {
        status = "MATCH";

        console.log("✅ DESCRIPTION MATCH");
      } else {
        status = "MISMATCH";
        console.log("EXPECTED DESC:", normalizeDescription(copyContent));
        console.log("ACTUAL DESC:", normalizeDescription(uatDescription));
        console.log("❌ DESCRIPTION MISMATCH");
      }

      // ======================================
      // TARGET REAL CARD
      // ======================================

      const frontCard = matchedCard.locator(".flip-card-front-side");

      await frontCard.evaluate((el) => {
        el.style.display = "block";

        el.style.visibility = "visible";

        el.style.opacity = "1";

        el.scrollIntoView({
          block: "center",

          inline: "center",
        });
      });

      await page.waitForTimeout(400);

      // ======================================
      // HIGHLIGHT
      // ======================================

      await frontCard.evaluate((el) => {
        el.style.border = "5px solid red";

        el.style.borderRadius = "12px";
      });

      // ======================================
      // SAFE FILE NAME
      // ======================================

      const safeName = expectedTitle

        .normalize("NFKD")

        .replace(/[’']/g, "")

        .replace(/&/g, "and")

        .replace(/[^a-zA-Z0-9]/g, "_")

        .replace(/_+/g, "_")

        .replace(/^_+|_+$/g, "");

      screenshotPath = `${FRONT_OUTPUT_DIR}/${safeName}.png`;

      // ======================================
      // SCREENSHOT
      // ======================================

      await frontCard.screenshot({
        path: screenshotPath,

        animations: "disabled",
      });

      console.log(`📸 ${screenshotPath}`);

      // ======================================
      // NUTRITION FLOW
      // ======================================

      const nutritionButton = matchedCard.locator(".flip-card-front-side-cta");

      if ((await nutritionButton.count()) > 0) {
        // CLICK NUTRITION INFO

        const nutritionBack = matchedCard.locator(".flip-card-back-side");

        await nutritionButton.click();

        await nutritionBack.waitFor({
          state: "visible",
          timeout: 5000,
        });

        // ======================================
        // BACK SIDE
        // ======================================

        // ======================================
        // EXTRACT UI NUTRITION
        // ======================================

        const nutritionRows = nutritionBack.locator(
          ".by-grid.flip-card-back-side-grid",
        );

        const nutritionCount = await nutritionRows.count();

        const nutritionData = {};

        for (let n = 0; n < nutritionCount; n++) {
          const row = nutritionRows.nth(n);

          const labelLocator = row.locator(
            ".flip-card-back-side-grid-cell-wrapper-text",
          );

          const valueLocator = row
            .locator(".by-text-md.flip-card-back-side-grid-cell-wrapper-1")
            .last();

          if (
            (await labelLocator.count()) === 0 ||
            (await valueLocator.count()) === 0
          ) {
            continue;
          }

          const label = await labelLocator.innerText();

          const value = await valueLocator.innerText();

          nutritionData[label.trim()] = value.trim();
        }

        console.log("🥗 NUTRITION DATA:", nutritionData);

        const expectedCategoryNormalized = normalizeCategory(expectedCategory);
        const expectedTitleNormalized = normalizeMenuItem(expectedTitle);
        const expectedRange = normalize(item["Range"]);

        const possibleNutritionMatches = preparedNutritionDataCsv
          .map((preparedRow) => {
            const {
              row: csvRow,
              csvCategory,
              csvItem,
              csvCompactItem,
              csvRange,
              hasNutrition,
            } = preparedRow;
            const tokenContainment = tokenContainmentMatch(
              csvRow["Item Name"],
              expectedTitle,
            );

            const reorderedVariant = reorderedTokenVariantMatch(
              csvRow["Item Name"],
              expectedTitle,
            );

            const detectedCategoryNormalized =
              normalizeCategory(detectedCategory);
            const detectedSubCategoryNormalized =
              normalizeCategory(detectedSubCategory);

            const categoryCandidates = [
              expectedCategoryNormalized,
              detectedCategoryNormalized,
              detectedSubCategoryNormalized,
            ].filter(Boolean);

            const categoryMatch = categoryCandidates.some(
              (category) =>
                category === csvCategory ||
                category.includes(csvCategory) ||
                csvCategory.includes(category),
            );

            const rangeMatch = !expectedRange || csvRange === expectedRange;

            const exact = csvItem === expectedTitleNormalized;

            const compactExact =
              csvCompactItem === compactMenuItem(expectedTitle);

            const variant =
              csvItem.startsWith(`${expectedTitleNormalized} `) ||
              expectedTitleNormalized.startsWith(`${csvItem} `);

            const fuzzyNameMatch = fuzzyMenuNameMatch(
              csvRow["Item Name"],
              expectedTitle,
            );

            const baseNameMatch =
              variant ||
              compactExact ||
              fuzzyNameMatch ||
              tokenContainment ||
              reorderedVariant;

            const score = getNutritionScore(csvRow, nutritionData);

            return {
              row: csvRow,
              categoryMatch,
              rangeMatch,
              exact,
              compactExact,
              variant,
              fuzzyNameMatch,
              tokenContainment,
              reorderedVariant,
              baseNameMatch,
              score,
              hasNutrition,
            };
          })
          .filter((match) => {
            if (!match.hasNutrition) return false;

            // Exact / compact exact should always be allowed.
            // This prevents valid CSV rows from becoming NOT_FOUND.
            if (match.exact || match.compactExact) {
              return true;
            }

            // Safe variant match:
            // Old Reliable Burger -> Old Reliable
            // Good Morning Burger -> Good Morning
            if (match.variant || match.fuzzyNameMatch) {
              return true;
            }

            if (match.reorderedVariant) {
              return true;
            }

            // Wider name containment needs nutrition proof.
            // This handles B.L.T. variants but protects Smoked Salmon Avocado Toast.
            if (match.tokenContainment && match.score >= 0.8) {
              return true;
            }

            return false;
          })

          .sort((a, b) => {
            if (a.categoryMatch !== b.categoryMatch) {
              return b.categoryMatch - a.categoryMatch;
            }

            if (a.exact !== b.exact) return b.exact - a.exact;
            if (a.variant !== b.variant) return b.variant - a.variant;

            return b.score - a.score;
          });

        let bestNutritionMatch = possibleNutritionMatches[0];

        if (!bestNutritionMatch) {
          bestNutritionMatch = nutritionDataCsv
            .map((row) => {
              const csvCategory = normalizeCategory(row["Category"]);

              const categoryMatch =
                csvCategory === expectedCategoryNormalized ||
                csvCategory === normalizeCategory(detectedCategory) ||
                csvCategory === normalizeCategory(detectedSubCategory);

              const exact =
                exactItemKey(row["Item Name"]) ===
                  exactItemKey(expectedTitle) ||
                exactItemKey(row["Item Name"]) ===
                  exactItemKey(detectedCardTitle);

              const score = getNutritionScore(row, nutritionData);

              return {
                row,
                categoryMatch,
                rangeMatch: true,
                exact,
                compactExact: exact,
                variant: false,
                fuzzyNameMatch: false,
                tokenContainment: false,
                baseNameMatch: exact,
                score,
                scoreFallback: categoryMatch && score >= 0.95,
                hasNutrition: hasCsvNutrition(row),
              };
            })
            .filter((match) => {
              return match.hasNutrition && (match.exact || match.scoreFallback);
            })
            .sort((a, b) => {
              if (a.exact !== b.exact) return b.exact - a.exact;
              return b.score - a.score;
            })[0];
        }

        if (
          bestNutritionMatch &&
          (bestNutritionMatch.exact ||
            bestNutritionMatch.compactExact ||
            bestNutritionMatch.variant ||
            bestNutritionMatch.fuzzyNameMatch ||
            bestNutritionMatch.scoreFallback ||
            (bestNutritionMatch.tokenContainment &&
              bestNutritionMatch.score >= 0.95) ||
            bestNutritionMatch.baseNameMatch)
        ) {
          nutritionItem = bestNutritionMatch.row;

          const matchedCsvItem = bestNutritionMatch.row["Item Name"];

          if (bestNutritionMatch.exact) {
            nutritionInfoStatus = "MATCH";
          } else if (bestNutritionMatch.variant) {
            nutritionInfoStatus = `VARIANT_MATCH -> ${matchedCsvItem}`;
          } else if (bestNutritionMatch.baseNameMatch) {
            nutritionInfoStatus = `VARIANT_MATCH -> ${matchedCsvItem}`;
          } else {
            nutritionInfoStatus = `POSSIBLE_MATCH -> ${matchedCsvItem}`;
          }
        } else if (!bestNutritionMatch) {
          nutritionInfoStatus = "NOT_FOUND";

          console.log("⚠️ ITEM NOT FOUND IN CSV");
        } else {
          nutritionInfoStatus = "MISMATCH";

          console.log("⚠️ NO CSV NUTRITION MATCH FOUND");
        }

        expectedNutrition = {
          Calories: nutritionItem?.["Calories"],
          "Calories from Fat": nutritionItem?.["Calories from Fat"],
          "Total Fat (g)": nutritionItem?.["Total Fat (g)"],
          "Sat Fat (g)": nutritionItem?.["Sat Fat (g)"],
          "Trans Fat (g)": nutritionItem?.["Trans Fat (g)"],
          "Cholest. (mg)": nutritionItem?.["Cholesterol (mg)"],
          "Sodium (mg)": nutritionItem?.["Sodium (mg)"],
          "Carbs (g)": nutritionItem?.["Carbs (g)"],
          "Dietary Fiber (g)": nutritionItem?.["Dietary Fiber (g)"],
          "Sugar (g)": nutritionItem?.["Sugar (g)"],
          "Protein (g)": nutritionItem?.["Protein (g)"],
        };

        // ======================================
        // VALIDATE NUTRITION
        // ======================================

        for (const key in expectedNutrition) {
          const expectedValue = String(expectedNutrition[key] || "").trim();

          const actualValue = String(nutritionData[key] || "").trim();

          if (
            expectedValue &&
            !nutritionValuesMatch(actualValue, expectedValue)
          ) {
            nutritionMatch = false;

            nutritionMismatchFields.push(
              `${key}: INPUT=${expectedValue} | UAT=${actualValue}`,
            );

            console.log(`❌ NUTRITION MISMATCH: ${key}`);

            console.log(`EXPECTED: ${expectedValue}`);

            console.log(`ACTUAL: ${actualValue}`);
          }
        }

        // ======================================
        // NUTRITION SCREENSHOT
        // ======================================

        // ======================================
        // NUTRITION SCREENSHOT
        // ======================================

        nutritionScreenshot = `${NUTRITION_OUTPUT_DIR}/${safeName}_nutrition.png`;

        await nutritionBack.screenshot({
          path: nutritionScreenshot,
          animations: "disabled",
        });

        console.log(`📸 ${nutritionScreenshot}`);

        // ======================================
        // CLOSE CARD
        // ======================================

        const closeButton = nutritionBack.locator(".flip-card-close-icon");

        if ((await closeButton.count()) > 0) {
          await closeButton.click();

          await page.waitForTimeout(1000);
        }
      }

      // REMOVE BORDER

      await frontCard.evaluate((el) => {
        el.style.border = "";
      });
    } catch (error) {
      if (error.message !== "__NUTRITION_INFO_DONE__") {
        console.log(`❌ ERROR (${expectedTitle}):`, error.message);
      }
    }

    // ======================================
    // FINAL NUTRITION INFO STATUS
    // ======================================

    const finalNutritionInfoStatus =
      nutritionInfoStatus === "MATCH" && nutritionMismatchFields.length > 0
        ? "MISMATCH"
        : nutritionInfoStatus.startsWith("VARIANT_MATCH") &&
            nutritionMismatchFields.length > 0
          ? nutritionInfoStatus.replace("VARIANT_MATCH", "VARIANT_MISMATCH")
          : nutritionInfoStatus;

    console.log("\n🥗 FINAL NUTRITION RESULT");

    if (finalNutritionInfoStatus === "MATCH") {
      console.log("MATCH = exact name + nutrition same");
    } else if (finalNutritionInfoStatus === "MISMATCH") {
      console.log("MISMATCH = exact name + nutrition differs");
    } else if (finalNutritionInfoStatus.startsWith("VARIANT_MATCH")) {
      console.log("VARIANT_MATCH = variant name + nutrition same");
    } else if (finalNutritionInfoStatus.startsWith("VARIANT_MISMATCH")) {
      console.log("VARIANT_MISMATCH = variant name + nutrition differs");
    } else if (finalNutritionInfoStatus === "NOT_FOUND") {
      console.log("NOT_FOUND = no CSV match");
    } else if (finalNutritionInfoStatus === "NO_NUTRITIONAL_INFO") {
      console.log("NO_NUTRITIONAL_INFO = no nutrition button/info");
    }

    console.log(`RESULT: ${finalNutritionInfoStatus}`);
    // ======================================
    // RESULTS
    // ======================================

    if (IS_NUTRITION_INFO_PAGE) {
      results.push({
        ExpectedCategory: expectedCategory,
        MenuItem: expectedTitle,
        DetectedCardTitle: detectedCardTitle,
        NutritionInfoStatus: finalNutritionInfoStatus,
        NutritionMismatch: nutritionMismatchFields.join(" || "),
        NutritionScreenshot: nutritionScreenshot || "",
      });
    } else {
      results.push({
        ExpectedCategory: expectedCategory,
        DetectedCategory: detectedCategory,
        MenuItem: expectedTitle,
        DetectedCardTitle: detectedCardTitle,
        CopyContent: copyContent,
        UATDescription: uatDescription,
        ContentStatus: status,
        NutritionInfoStatus: finalNutritionInfoStatus,
        NutritionMismatch: nutritionMismatchFields.join(" || "),
        Screenshot: screenshotPath,
        NutritionScreenshot: nutritionScreenshot || "",
      });
    }
  }

  // ========================================
  // FINAL ACCORDION CLEANUP
  // ========================================

  if (currentlyOpenAccordionElement) {
    console.log(`📂 FINAL CLOSE: ${currentlyOpenAccordion}`);

    await currentlyOpenAccordionElement.click();

    await page.waitForTimeout(200);
  }

  // ======================================
  // WRITE MAIN CSV
  // ======================================

  const csvWriter = createCsvWriter({
    path: OUTPUT_REPORT,

    header: IS_NUTRITION_INFO_PAGE
      ? [
          {
            id: "ExpectedCategory",
            title: "EXPECTED_CATEGORY",
          },
          {
            id: "MenuItem",
            title: "MENU_ITEM",
          },
          {
            id: "DetectedCardTitle",
            title: "DETECTED_CARD_TITLE",
          },
          {
            id: "NutritionInfoStatus",
            title: "NUTRITION_INFO_STATUS",
          },
          {
            id: "NutritionMismatch",
            title: "NUTRITION_MISMATCH",
          },
          {
            id: "NutritionScreenshot",
            title: "NUTRITION_SCREENSHOT",
          },
        ]
      : [
          {
            id: "ExpectedCategory",
            title: "EXPECTED_CATEGORY",
          },
          {
            id: "DetectedCategory",
            title: "DETECTED_CATEGORY",
          },
          {
            id: "MenuItem",
            title: "MENU_ITEM",
          },
          {
            id: "DetectedCardTitle",
            title: "DETECTED_CARD_TITLE",
          },
          {
            id: "CopyContent",
            title: "COPY_CONTENT",
          },
          {
            id: "UATDescription",
            title: "UAT_DESCRIPTION",
          },
          {
            id: "ContentStatus",
            title: "CONTENT_STATUS",
          },
          {
            id: "NutritionMismatch",
            title: "NUTRITION_MISMATCH",
          },
          {
            id: "NutritionInfoStatus",
            title: "NUTRITION_INFO_STATUS",
          },
          {
            id: "NutritionScreenshot",
            title: "NUTRITION_SCREENSHOT",
          },
          {
            id: "Screenshot",
            title: "SCREENSHOT",
          },
        ],
  });

  await csvWriter.writeRecords(results);

  // ======================================
  // CATEGORY COMPARISON
  // ======================================

  console.log("\n============================");
  console.log("CATEGORY COMPARISON");
  console.log("============================");

  const categoryComparisonRows = [];

  const legacyMap = {};

  for (const row of validationInput) {
    const category = normalize(row["Category"]);

    const title = normalize(row["Header"]);

    if (!legacyMap[category]) {
      legacyMap[category] = [];
    }

    legacyMap[category].push(title);
  }

  const uatMap = {};

  for (const row of results) {
    const category = normalize(row["DetectedCategory"]);

    const title = normalize(row["DetectedCardTitle"]);

    if (!category || !title) continue;

    if (!uatMap[category]) {
      uatMap[category] = [];
    }

    uatMap[category].push(title);
  }

  const allCategories = new Set([
    ...Object.keys(legacyMap),
    ...Object.keys(uatMap),
  ]);

  for (const category of allCategories) {
    const legacyItems = legacyMap[category] || [];

    const uatItems = uatMap[category] || [];

    const missingInUAT = legacyItems.filter((x) => !uatItems.includes(x));

    const extraInUAT = uatItems.filter((x) => !legacyItems.includes(x));

    console.log("\n-----------------------------------");

    console.log(`CATEGORY: ${category.toUpperCase()}`);

    console.log("-----------------------------------");

    console.log(`Legacy Count: ${legacyItems.length}`);

    console.log(`UAT Count: ${uatItems.length}`);

    if (
      legacyItems.length === uatItems.length &&
      missingInUAT.length === 0 &&
      extraInUAT.length === 0
    ) {
      console.log("✅ CATEGORY MATCH");

      categoryComparisonRows.push({
        CATEGORY: category.toUpperCase(),

        LEGACY_COUNT: legacyItems.length,

        UAT_COUNT: uatItems.length,

        STATUS: "MATCH",

        TYPE: "",

        ITEM: "",
      });
    } else {
      console.log("❌ CATEGORY MISMATCH");

      if (missingInUAT.length === 0 && extraInUAT.length === 0) {
        categoryComparisonRows.push({
          CATEGORY: category.toUpperCase(),

          LEGACY_COUNT: legacyItems.length,

          UAT_COUNT: uatItems.length,

          STATUS: "MISMATCH",

          TYPE: "COUNT_MISMATCH",

          ITEM: "",
        });
      }

      // MISSING IN UAT

      if (missingInUAT.length > 0) {
        console.log("\nMissing in UAT:");

        missingInUAT.forEach((item) => {
          console.log(`- ${item}`);

          categoryComparisonRows.push({
            CATEGORY: category.toUpperCase(),

            LEGACY_COUNT: legacyItems.length,

            UAT_COUNT: uatItems.length,

            STATUS: "MISMATCH",

            TYPE: "Missing in UAT",

            ITEM: item,
          });
        });
      }

      // EXTRA IN UAT

      if (extraInUAT.length > 0) {
        console.log("\nExtra in UAT:");

        extraInUAT.forEach((item) => {
          console.log(`- ${item}`);

          categoryComparisonRows.push({
            CATEGORY: category.toUpperCase(),

            LEGACY_COUNT: legacyItems.length,

            UAT_COUNT: uatItems.length,

            STATUS: "MISMATCH",

            TYPE: "Extra in UAT",

            ITEM: item,
          });
        });
      }
    }
  }

  // ======================================
  // WRITE CATEGORY CSV
  // ======================================

  const comparisonWriter = createCsvWriter({
    path: CATEGORY_REPORT,

    header: [
      {
        id: "CATEGORY",
        title: "CATEGORY",
      },
      {
        id: "INPUT_COUNT",
        title: "INPUT_COUNT",
      },
      {
        id: "UAT_COUNT",
        title: "UAT_COUNT",
      },
      {
        id: "NUTRITION_INPUT_COUNT",
        title: "NUTRITION_INPUT_COUNT",
      },
      {
        id: "NUTRITION_UAT_COUNT",
        title: "NUTRITION_UAT_COUNT",
      },
      {
        id: "STATUS",
        title: "STATUS",
      },
    ],
  });

  await comparisonWriter.writeRecords(categoryComparisonRows);

  console.log("\n📄 CATEGORY CSV GENERATED");

  console.log("\n============================");
  console.log("✅ VALIDATION COMPLETE");
  console.log("📄 CSV REPORT GENERATED");
  console.log("============================");

  await browser.close();
})();
