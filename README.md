Command bash

**UAT**
Main - Menu
MENU_TYPE=main-menu INPUT_FILE=./input/main-menu.csv node menu-checker.js

Kids - Menu
MENU_TYPE=kids-menu INPUT_FILE=./input/kids-menu.csv NUTRITION_FILE=./input/main-menu-nutrition.csv node menu-checker.js

Catering
MENU_TYPE=catering INPUT_FILE=./input/catering-menu.csv NUTRITION_FILE=./input/main-menu-nutrition.csv node menu-checker.js

Nutritional_Info
MENU_TYPE=nutrition-info NUTRITION_FILE=./input/main-menu-nutrition.csv node menu-checker.js

---

**PRE-PROD**
Main - Menu
ENVIRONMENT=preprod MENU_TYPE=main-menu INPUT_FILE=./input/main-menu.csv NUTRITION_FILE=./input/main-menu-nutrition.csv node
menu-checker.js

Kids - Menu
ENVIRONMENT=preprod MENU_TYPE=kids-menu INPUT_FILE=./input/kids-menu.csv NUTRITION_FILE=./input/main-menu-nutrition.csv node menu-checker.js

Catering
ENVIRONMENT=preprod MENU_TYPE=catering INPUT_FILE=./input/catering-menu.csv NUTRITION_FILE=./input/main-menu-nutrition.csv node menu-checker.js

Nutritional_Info
ENVIRONMENT=preprod MENU_TYPE=nutrition-info NUTRITION_FILE=./input/main-menu-nutrition.csv node menu-validator.js

---

**Production**
Main - Menu
ENVIRONMENT=prod MENU_TYPE=main-menu INPUT_FILE=./input/main-menu.csv NUTRITION_FILE=./input/main-menu-nutrition.csv node menu-checker.js

Kids - Menu
ENVIRONMENT=prod MENU_TYPE=kids-menu INPUT_FILE=./input/kids-menu.csv NUTRITION_FILE=./input/main-menu-nutrition.csv node menu-checker.js

Catering
ENVIRONMENT=prod MENU_TYPE=catering INPUT_FILE=./input/catering.csv NUTRITION_FILE=./input/catering-nutrition.csv node menu-checker.js

Nutritional_Info
ENVIRONMENT=prod MENU_TYPE=nutrition-info NUTRITION_FILE=./input/main-menu-nutrition.csv node menu-checker.js

---

Main Code Blocks

1. Environment and routing
   Controls which page to test.
   main-menu and kids-menu go to /menu/..., while catering goes to /catering.

---

2. Input and output setup
   Reads the correct input CSV and nutrition CSV, then creates output folders for reports and screenshots.

---

3. Normalization helpers
   Cleans item names, descriptions, categories, and nutrition values so small formatting differences do not cause false failures.

---

4. Nutrition CSV cache
   Pre-processes the nutrition CSV once to make matching much faster. This avoids recalculating normalized values for every item.

---

5. Browser launch and page load
   Starts Playwright, opens the UAT menu page, and prepares the page for validation.

---

6. Accordion/card detection
   Detects menu sections, opens accordions if needed, and finds the correct food card based on the input CSV title.

---

7. Description validation
   Compares the expected description from CSV against the UAT card description.

---

8. Screenshot capture
   Captures front-card screenshots and nutrition screenshots for evidence.

---

9.Nutrition extraction
Clicks the nutrition button, reads nutrition values from the card, and stores them for comparison.

---

10. Nutrition matching logic
    Finds the best CSV nutrition row using exact name, variant name, fuzzy match, token containment, and nutrition score.

---

11. Final status logic
    Assigns clear results:

MATCH = exact name + nutrition same
MISMATCH = exact name + nutrition differs
VARIANT_MATCH -> item = variant name + nutrition same
VARIANT_MISMATCH -> item = variant name + nutrition differs
NOT_FOUND = no CSV match
NO_NUTRITIONAL_INFO = no nutrition button/info

---

12. Report generation
    Creates the final report CSV with category, detected item, description result, nutrition status, mismatch details, and screenshot paths.

---

13. Category comparison
    Compares CSV item counts vs UAT-detected item counts per category to identify missing or extra items.

---
