/* eslint jest/expect-expect: ["error", { "assertFunctionNames": ["expect", "expectSectionToHaveLabel", "expectSectionsToHaveLabelsInOrder"] }] */

import { screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import fetchMock from "fetch-mock";

import { setupForTokenCheckEndpoint } from "__support__/server-mocks";

import type { SetupOpts } from "./setup";
import {
  clickNextStep,
  expectSectionsToHaveLabelsInOrder,
  expectSectionToHaveLabel,
  findSection,
  getSection,
  selectUsageReason,
  setup,
  skipLanguageStep,
  skipWelcomeScreen,
  submitUserInfoStep,
} from "./setup";

const setupEnterprise = (opts?: SetupOpts) => {
  return setup({
    ...opts,
    hasEnterprisePlugins: true,
  });
};

const sampleToken = "a".repeat(64);

describe("setup (EE, no token)", () => {
  it("default step order should be correct, with the commercial step in place", async () => {
    await setupEnterprise();
    skipWelcomeScreen();
    expectSectionToHaveLabel("What's your preferred language?", "1");
    expectSectionToHaveLabel("What should we call you?", "2");
    expectSectionToHaveLabel("What will you use Metabase for?", "3");
    expectSectionToHaveLabel("Add your data", "4");
    expectSectionToHaveLabel("Activate your commercial license", "5");
    expectSectionToHaveLabel("Usage data preferences", "6");

    expectSectionsToHaveLabelsInOrder();
  });

  describe("License activation step", () => {
    async function setupForLicenseStep() {
      await setup();
      skipWelcomeScreen();
      skipLanguageStep();
      await submitUserInfoStep();
      selectUsageReason("embedding"); // to skip the db connection step
      clickNextStep();

      await screen.findByText(
        "Unlock access to your paid features before starting",
      );
    }

    it("should display an error in case of invalid token", async () => {
      await setupForLicenseStep();

      setupForTokenCheckEndpoint({ valid: false });

      userEvent.paste(
        screen.getByRole("textbox", { name: "Token" }),
        sampleToken,
      );

      screen.getByRole("button", { name: "Activate" }).click();

      await waitFor(() => {
        expect(
          screen.getByRole("button", { name: "Activate" }),
        ).not.toHaveProperty("data-loading", true);
      });

      expect(
        screen.getByText(
          "This token doesn’t seem to be valid. Double-check it, then contact support if you think it should be working",
        ),
      ).toBeInTheDocument();
    });

    it("should go to the next step when activating a valid token", async () => {
      await setupForLicenseStep();

      setupForTokenCheckEndpoint({ valid: true });

      userEvent.paste(
        screen.getByRole("textbox", { name: "Token" }),
        sampleToken,
      );

      screen.getByRole("button", { name: "Activate" }).click();

      await waitFor(() => {
        expect(
          screen.getByRole("button", { name: "Activate" }),
        ).not.toHaveProperty("data-loading", true);
      });

      await waitFor(async () =>
        expect(await findSection("Usage data preferences")).toHaveAttribute(
          "aria-current",
          "step",
        ),
      );
    });

    it("should be possible to skip the step without a token", async () => {
      await setupForLicenseStep();

      clickNextStep();

      await findSection("Usage data preferences");

      expect(getSection("Usage data preferences")).toHaveAttribute(
        "aria-current",
        "step",
      );
    });

    it("should pass the token to the setup endpoint", async () => {
      await setupForLicenseStep();

      setupForTokenCheckEndpoint({ valid: true });

      userEvent.paste(
        screen.getByRole("textbox", { name: "Token" }),
        sampleToken,
      );

      screen.getByRole("button", { name: "Activate" }).click();

      await waitFor(() => {
        expect(
          screen.getByRole("button", { name: "Activate" }),
        ).not.toHaveProperty("data-loading", true);
      });

      (await screen.findByRole("button", { name: "Finish" })).click();

      const setupCall = fetchMock.lastCall(`path:/api/setup`);
      expect(await setupCall?.request?.json()).toMatchObject({
        license_token: sampleToken,
      });
    });
  });
});
