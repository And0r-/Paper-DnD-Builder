"use client";
/**
 * The builder's step "Campaign" (AND-333): which campaign the character is
 * for, the first step for whoever plays in or leads one. Like any step it
 * can be changed at any time; the choice is saved at once. "No campaign"
 * is an answer too, so the step is never open and never holds up the sheet.
 *
 * A game master building for a player sees the step to look at only: the
 * character is the player's, and only its owner moves it (`PUT …/campaign`).
 */
import { useState } from "react";
import { useApp } from "../../../../src/ui/app-state.tsx";
import { ButtonLink } from "../../../../src/ui/components/Button.tsx";
import { Callout, EmptyState } from "../../../../src/ui/components/Feedback.tsx";
import { SelectField } from "../../../../src/ui/components/Fields.tsx";
import { NO_CAMPAIGN } from "../../../../src/ui/campaigns.ts";
import { useDraft } from "../../../../src/ui/flow/draft-state.tsx";
import { StepFooter, StepFrame } from "../../../../src/ui/flow/frame.tsx";
import { CAMPAIGN_KEY, firstOpen } from "../../../../src/ui/flow/model.ts";

export default function CampaignPage() {
  const { t } = useApp();
  const { draft, campaigns, entries, allEntries, setCampaign } = useDraft();
  const [busy, setBusy] = useState(false);
  const [failed, setFailed] = useState(false);
  const entry = [...entries, ...allEntries].find((e) => e.key === CAMPAIGN_KEY);
  if (!entry) {
    return (
      <div className="page">
        <EmptyState title={t("flow.stepNotFound")}>
          <ButtonLink href={firstOpen(entries).href}>{t("flow.toFirstOpen")}</ButtonLink>
        </EmptyState>
      </div>
    );
  }
  const owner = draft.access === "owner";
  const current = campaigns.find((c) => c.id === draft.campaignId);
  return (
    <StepFrame
      entry={entry}
      question={t("new.campaignQuestion")}
      intro={owner ? t("new.campaignIntro") : undefined}
      footer={<StepFooter entry={entry} problem={undefined} />}
    >
      {owner ? (
        <div className="campaign-step">
          <SelectField
            label={t("new.campaignLabel")}
            value={current?.id ?? NO_CAMPAIGN}
            busy={busy}
            onChange={async (v) => {
              setBusy(true);
              setFailed(false);
              setFailed(!(await setCampaign(v || null)));
              setBusy(false);
            }}
            options={[
              ...campaigns.map((c) => ({ value: c.id, label: c.name })),
              { value: NO_CAMPAIGN, label: t("new.noCampaign") },
            ]}
          />
          <div aria-live="polite">{failed && <Callout tone="warning">{t("save.error")}</Callout>}</div>
        </div>
      ) : (
        // To look at: the answer as text, not a field that cannot be used.
        <div className="campaign-step">
          <Callout tone="info">{t("new.forPlayer", { name: draft.owner.name })}</Callout>
          <dl className="campaign-step__answer">
            <dt>{t("new.campaignLabel")}</dt>
            <dd>{current?.name ?? t("new.noCampaign")}</dd>
          </dl>
          <p className="note">{t("new.campaignOwnerOnly", { name: draft.owner.name })}</p>
        </div>
      )}
    </StepFrame>
  );
}
