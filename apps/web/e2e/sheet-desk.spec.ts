/** The online sheet at a desk (AND-181): the A4 page with the tools in a bar. Cases in `sheet-tests.ts`. */
import { devices } from "@playwright/test";
import { test } from "./helpers.ts";
import { sheetTests } from "./sheet-tests.ts";

test.use({ ...devices["Desktop Chrome"], viewport: { width: 1366, height: 900 } });

sheetTests("desk");
