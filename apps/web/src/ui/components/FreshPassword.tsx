"use client";
/**
 * A password just made, shown this once: after "Get started", after the
 * login of an account from before, and after "New password" in the
 * settings. The server keeps only a check value, so it cannot show it
 * again. Nothing forces copying and nothing runs out; the button is the
 * player's own "I have it".
 *
 * `noMail`: the account has no mail address, so this password is the only
 * way back in; the screen says so plainly, before it is too late.
 */
import { useApp } from "../app-state.tsx";
import { Button } from "./Button.tsx";
import { CopyText } from "./CopyText.tsx";
import { Callout } from "./Feedback.tsx";

export function FreshPassword({
  secret,
  noMail,
  onDone,
}: {
  secret: string;
  noMail?: boolean;
  onDone: () => void;
}) {
  const { t } = useApp();
  return (
    <div className="fresh-password">
      <CopyText label={t("password.label")} value={secret} large />
      <p>{t("password.text")}</p>
      <p>{t("password.keep")}</p>
      {noMail && <Callout tone="warning">{t("password.noMail")}</Callout>}
      <Button block icon="check" onClick={onDone}>
        {t("password.done")}
      </Button>
    </div>
  );
}
