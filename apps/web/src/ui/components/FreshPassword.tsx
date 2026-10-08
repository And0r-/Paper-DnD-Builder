"use client";
/**
 * A password just made, shown this once: after "Register", after the
 * login of an account from before, after a link back in, and after "New
 * password" in the settings. The server keeps only a check value, so it
 * cannot show it again. Nothing forces copying and nothing runs out; the
 * button is the player's own "I have it".
 *
 * The button sends a form the player does not see: the account's name as
 * the user name and the password as a new one (AND-241). Browsers and
 * phones take a sent form with a new password as the moment to offer
 * saving it. Firefox only does so when the form is really sent, not when a
 * script stops it, so the form goes to /form-sent: an empty answer that
 * leaves the page as it is. The fields have no `name`, so nothing of them
 * travels; the screen closes a moment later, once the form is on its way.
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
  username,
  noMail,
  onDone,
}: {
  secret: string;
  /** What the account logs in with besides the password: its name. */
  username: string;
  noMail?: boolean;
  onDone: () => void;
}) {
  const { t } = useApp();
  return (
    <form
      className="fresh-password"
      method="get"
      action="/form-sent"
      onSubmit={() => {
        // Not now: removing the form before it is sent would cancel the sending.
        setTimeout(onDone, 0);
      }}
    >
      <div className="visually-hidden" aria-hidden="true">
        <input type="text" autoComplete="username" value={username} readOnly tabIndex={-1} />
        <input type="password" autoComplete="new-password" value={secret} readOnly tabIndex={-1} />
      </div>
      <CopyText label={t("password.label")} value={secret} large />
      <p>{t("password.text")}</p>
      <p>{t("password.keep")}</p>
      {noMail && <Callout tone="warning">{t("password.noMail")}</Callout>}
      <Button type="submit" block icon="check">
        {t("password.done")}
      </Button>
    </form>
  );
}
