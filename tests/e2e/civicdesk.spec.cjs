const { test, expect } = require("@playwright/test");

test.beforeEach(async ({ page }) => {
  await page.goto("/");
  await page.evaluate(() => localStorage.clear());
  await page.reload();
});

test("files, processes, updates and undoes a complaint while refreshing dashboard metrics", async ({ page }) => {
  await expect(page.locator("#statTotal")).toHaveText("12");
  await expect(page.locator("#statWaiting")).toHaveText("9");

  await page.locator("#nm").fill("Playwright Citizen");
  await page.locator("#ar").fill("Test Area");
  await page.locator("#dp").selectOption({ label: "Water Supply" });
  await page.locator("#pr").selectOption("0");
  await page.locator("#bFile").click();

  await expect(page.locator("#statTotal")).toHaveText("13");
  await expect(page.locator("#rows")).toContainText("Playwright Citizen");
  const newId = await page.locator("#cid").inputValue();
  expect(newId).toMatch(/^\d{4}$/);

  // The sample urgent complaint is first in the urgent FIFO queue.
  await page.locator('tr[data-id="4821"]').click();
  await page.locator("#bNext").click();
  await expect(page.locator("#cid")).toHaveValue("4821");

  await page.locator("#to").selectOption("2");
  await page.locator("#rm").fill("E2E status update");
  await page.locator("#bUpd").click();
  await expect(page.locator('tr[data-id="4821"]')).toContainText("In Progress");

  await page.locator("#bUndo").click();
  await expect(page.locator('tr[data-id="4821"]')).toContainText("Assigned");
  await expect(page.locator("#statTotal")).toHaveText("13");
  await expect(page.locator("#statActive")).toHaveText("3");

  await page.reload();
  await expect(page.locator("#statTotal")).toHaveText("13");
  await expect(page.locator("#rows")).toContainText("Playwright Citizen");
});

test("imports a valid CivicDesk file and exports the imported records", async ({ page }) => {
  page.once("dialog", dialog => dialog.accept());
  const fixture = [
    "CIVICDESK 1",
    "C|99001|Imported Citizen|Imported Area|Water Supply|0|0",
    "S|1|0|Assigned by test"
  ].join("\n") + "\n";

  await page.locator("#fileIn").setInputFiles({
    name: "civicdesk-import.txt",
    mimeType: "text/plain",
    buffer: Buffer.from(fixture)
  });

  await expect(page.locator("#statTotal")).toHaveText("1");
  await expect(page.locator("#rows")).toContainText("Imported Citizen");
  await expect(page.locator("#rows")).toContainText("Assigned");

  const downloadPromise = page.waitForEvent("download");
  await page.locator("#bExport").click();
  const download = await downloadPromise;
  expect(download.suggestedFilename()).toBe("civicdesk_data.txt");
  const downloadPath = await download.path();
  const fs = require("node:fs");
  const exported = fs.readFileSync(downloadPath, "utf8");
  expect(exported).toContain("CIVICDESK 1");
  expect(exported).toContain("C|99001|Imported Citizen|Imported Area|Water Supply|0|0");
});


test("connects the dashboard to the REST API and persists browser-submitted complaints", async ({ page }) => {
  await page.locator("#bConnect").click();
  await expect(page.locator("#apiState")).toHaveText("Connected to CivicDesk API");
  await expect(page.locator("#bUndo")).toBeDisabled();
  await expect(page.locator("#bImport")).toBeDisabled();
  await expect(page.locator("#bExport")).toBeDisabled();
  await expect(page.locator("#bReset")).toBeDisabled();

  await page.locator("#nm").fill("API E2E Citizen");
  await page.locator("#ar").fill("Integration Test Area");
  await page.locator("#dp").selectOption({ label: "Roads" });
  await page.locator("#pr").selectOption("1");
  await page.locator("#bFile").click();

  await expect(page.locator("#rows")).toContainText("API E2E Citizen");
  await expect(page.locator("#statTotal")).toHaveText("1");
  const complaintId = await page.locator("#cid").inputValue();
  expect(complaintId).toBe("1000");

  await page.reload();
  await page.locator("#bConnect").click();
  await expect(page.locator("#apiState")).toHaveText("Connected to CivicDesk API");
  await expect(page.locator("#rows")).toContainText("API E2E Citizen");
  await expect(page.locator("#statTotal")).toHaveText("1");

  const response = await page.request.get("/api/complaints/" + complaintId);
  expect(response.ok()).toBeTruthy();
  const saved = await response.json();
  expect(saved.name).toBe("API E2E Citizen");
  expect(saved.status).toBe("Filed");
});
