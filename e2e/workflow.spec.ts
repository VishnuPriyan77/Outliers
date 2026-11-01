import { test, expect } from "@playwright/test";
test("citizen intake → officer resolution proof → single appeal → close", async ({
  page,
}) => {
  await page.goto("/");
  await expect(
    page.getByRole("heading", { name: "A better city starts with you." }),
  ).toBeVisible();
  await page.getByRole("button", { name: "Report an issue" }).first().click();
  for (const answer of [
    "A large pothole is blocking our road.",
    "Velachery Main Road near the bus stop, Chennai",
    "Two weeks",
    "Vehicles are swerving and pedestrians cannot pass",
  ]) {
    await page.getByRole("textbox").fill(answer);
    await page.getByRole("button", { name: "Continue", exact: true }).click();
  }
  await page.getByLabel("Road ownership").selectOption("municipal");
  await page
    .getByLabel("I confirm this report is accurate", { exact: false })
    .check();
  await page.getByRole("button", { name: "Confirm & submit report" }).click();
  await expect(
    page.getByRole("heading", { name: "Road damage", exact: true }),
  ).toBeVisible();
  await page.getByRole("button", { name: "Official dashboard" }).click();
  await page
    .getByRole("button")
    .filter({ hasText: "A large pothole is blocking our road." })
    .click();
  await page
    .getByRole("textbox", { name: "Add a clear update or reason (required)" })
    .fill("Accepted by demo roads officer");
  await page.getByRole("button", { name: "Acknowledge report" }).click();
  await page
    .getByRole("textbox", { name: "Add a clear update or reason (required)" })
    .fill("Road repair team has been assigned");
  await page.getByRole("button", { name: "Start / assign work" }).click();
  await page.getByLabel("Upload resolution evidence").setInputFiles({
    name: "repair.png",
    mimeType: "image/png",
    buffer: Buffer.from(
      "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+a8WQAAAAASUVORK5CYII=",
      "base64",
    ),
  });
  await expect(page.getByText("repair.png", { exact: true })).toBeVisible();
  await page
    .getByRole("textbox", { name: "Add a clear update or reason (required)" })
    .fill("Repair finished and completion evidence uploaded");
  await page.getByRole("button", { name: "Submit resolution" }).click();
  await page.getByRole("button", { name: "My reports" }).click();
  await page
    .getByRole("button")
    .filter({ hasText: "A large pothole is blocking our road." })
    .click();
  await page
    .getByRole("textbox", { name: "Add a clear update or reason (required)" })
    .fill("The issue remains and needs another inspection");
  await page.getByRole("button", { name: "Appeal once" }).click();
  await page.reload();
  await page.getByRole("button", { name: "Official dashboard" }).click();
  await page
    .getByRole("button")
    .filter({ hasText: "A large pothole is blocking our road." })
    .click();
  await page
    .getByRole("textbox", { name: "Add a clear update or reason (required)" })
    .fill("Appeal accepted and follow-up inspection assigned");
  await page.getByRole("button", { name: "Start / assign work" }).click();
  await page.getByLabel("Upload resolution evidence").setInputFiles({
    name: "followup.png",
    mimeType: "image/png",
    buffer: Buffer.from(
      "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+a8WQAAAAASUVORK5CYII=",
      "base64",
    ),
  });
  await expect(page.getByText("followup.png", { exact: true })).toBeVisible();
  await page
    .getByRole("textbox", { name: "Add a clear update or reason (required)" })
    .fill("Follow-up repairs have been completed");
  await page.getByRole("button", { name: "Submit resolution" }).click();
  await page.getByRole("button", { name: "My reports" }).click();
  await page
    .getByRole("button")
    .filter({ hasText: "A large pothole is blocking our road." })
    .click();
  await expect(page.getByRole("button", { name: "Appeal once" })).toHaveCount(
    0,
  );
  await page
    .getByRole("textbox", { name: "Add a clear update or reason (required)" })
    .fill("I confirm the road has now been repaired");
  await page.getByRole("button", { name: "Confirm & close" }).click();
  await expect(page.locator(".case-detail .badge")).toHaveText("Closed");
  await page.reload();
  await page.getByRole("button", { name: "My reports" }).click();
  await page
    .getByRole("button")
    .filter({ hasText: "A large pothole is blocking our road." })
    .click();
  await expect(page.getByText("repair.png", { exact: true })).toBeVisible();
  await expect(page.locator(".timeline li")).toHaveCount(10);
});
test("Tamil interface and narrow layouts remain usable", async ({ page }) => {
  await page.goto("/");
  await page.getByRole("button", { name: "தமிழ்", exact: true }).click();
  await expect(page.locator("html")).toHaveAttribute("lang", "ta");
  await page
    .getByRole("button", { name: "புகாரளிக்கவும்", exact: true })
    .first()
    .click();
  await page
    .getByRole("textbox")
    .fill("குடிநீர் குழாய் உடைந்து தண்ணீர் வீணாகிறது");
  await page.getByRole("button", { name: "தொடரவும்", exact: true }).click();
  await expect(
    page.getByText("குடிநீர் குழாய் உடைந்து தண்ணீர் வீணாகிறது", {
      exact: true,
    }),
  ).toBeVisible();
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBe(true);
});

for (const language of ["en", "ta"] as const) {
  test(`cut power line is confirmed for TNPDCL with persistent hazard guidance (${language})`, async ({
    page,
  }, testInfo) => {
    await page.goto("/");
    if (language === "ta")
      await page.getByRole("button", { name: "தமிழ்", exact: true }).click();
    await page
      .getByRole("button", {
        name: language === "en" ? "Report an issue" : "புகாரளிக்கவும்",
        exact: true,
      })
      .first()
      .click();
    const description =
      language === "en"
        ? "A street power line is cut and lying on the road"
        : "சாலையில் மின்கம்பி அறுந்து கிடக்கிறது";
    for (const answer of [
      description,
      "Anna Nagar near Tower Park, Chennai",
      "Today",
      "People nearby are at risk",
    ]) {
      await page.getByRole("textbox").fill(answer);
      await page
        .getByRole("button", {
          name: language === "en" ? "Continue" : "தொடரவும்",
          exact: true,
        })
        .click();
    }
    await expect(page.locator(".routing-preview")).toContainText("TNPDCL");
    await expect(
      page.getByLabel(
        language === "en"
          ? "Confirm issue category"
          : "பிரச்சினை வகையை உறுதிசெய்யவும்",
      ),
    ).toHaveValue("electricity");
    await expect(page.locator(".alert.warning[role=alert]")).toContainText(
      "94987 94987",
    );
    const urgency = page.getByLabel(
      language === "en"
        ? "There is an immediate safety risk"
        : "உடனடி பாதுகாப்பு ஆபத்து உள்ளது",
      { exact: false },
    );
    await expect(urgency).toBeChecked();
    await expect(urgency).toBeDisabled();
    // An erroneous citizen choice cannot turn an electrical hazard into a roads assignment.
    await page
      .getByLabel(
        language === "en"
          ? "Confirm issue category"
          : "பிரச்சினை வகையை உறுதிசெய்யவும்",
      )
      .selectOption("road");
    await page
      .getByLabel(language === "en" ? "Road ownership" : "சாலையின் பொறுப்பு")
      .selectOption("municipal");
    await expect(page.locator(".routing-preview")).toContainText("Triage");
    await page
      .getByLabel(
        language === "en"
          ? "Confirm issue category"
          : "பிரச்சினை வகையை உறுதிசெய்யவும்",
      )
      .selectOption("electricity");
    await page.screenshot({
      path: testInfo.outputPath(`electricity-review-${language}.png`),
      fullPage: true,
    });
    await page
      .getByLabel(
        language === "en"
          ? "I confirm this report is accurate"
          : "எனக்குத் தெரிந்தவரை இந்தப் புகார் சரியானது",
        { exact: false },
      )
      .check();
    await page
      .getByRole("button", {
        name:
          language === "en"
            ? "Confirm & submit report"
            : "உறுதிசெய்து புகாரைச் சமர்ப்பிக்கவும்",
      })
      .click();
    await expect(page.locator(".case-detail")).toContainText("TNPDCL");
    await expect(page.locator(".case-detail")).toContainText("94987 94987");
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth,
      ),
    ).toBe(true);
  });
}
