import { t } from "ttag";

import { color } from "metabase/lib/colors";
import { useDispatch, useSelector } from "metabase/lib/redux";
import { addUndo } from "metabase/redux/undo";
import { useStep } from "metabase/setup/useStep";
import { Button, Divider, Text } from "metabase/ui";

import { submitLicenseToken } from "../../actions";
import { getIsSetupCompleted } from "../../selectors";
import { ActiveStep } from "../ActiveStep";
import { InactiveStep } from "../InactiveStep";
import type { NumberedStepProps } from "../types";

import { LicenseTokenForm } from "./LicenseTokenForm";

export const LicenseTokenStep = ({ stepLabel }: NumberedStepProps) => {
  const {
    isStepActive,
    isStepCompleted,
    selectThisStep,
    dispatchAndGoNextStep,
  } = useStep("license_token");

  const storeToken = useSelector(state => state.setup.licenseToken);

  const isSetupCompleted = useSelector(getIsSetupCompleted);
  const dispatch = useDispatch();

  const handleStepSelect = () => {
    selectThisStep();
  };

  const handleValidSubmit = (token: string | null) => {
    dispatch(
      addUndo({
        message: t`Your license is activated`,
      }),
    );
    dispatchAndGoNextStep(submitLicenseToken(token));
  };

  const handleNext = () => {
    dispatchAndGoNextStep(submitLicenseToken(null));
  };

  if (!isStepActive) {
    const title = isStepCompleted
      ? storeToken
        ? t`Commercial license active`
        : t`I'll activate my commercial license later`
      : t`Activate your commercial license`;
    return (
      <InactiveStep
        title={title}
        label={stepLabel}
        isStepCompleted={isStepCompleted}
        isSetupCompleted={isSetupCompleted}
        onStepSelect={handleStepSelect}
      />
    );
  }

  return (
    <ActiveStep title={t`Activate your commercial license`} label={stepLabel}>
      <Text
        mb="lg"
        color={color("text-light")}
      >{t`Unlock access to your paid features before starting`}</Text>

      <LicenseTokenForm onValidSubmit={handleValidSubmit} />

      <Divider my="xl" />

      <Button variant="filled" onClick={handleNext}>
        {t`Next`}
      </Button>
    </ActiveStep>
  );
};
