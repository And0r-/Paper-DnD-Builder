/**
 * The loaded packages as cards to pick one: name and short text from the
 * package's own texts (`GET /api/packages`), nothing built in. On "New
 * character" and on the step "Rules" (AND-336).
 */
import type { PackageListEntry } from "../api.ts";

export function PackageCards({
  list,
  picked,
  onPick,
  labelledBy,
  disabled,
}: {
  list: readonly PackageListEntry[];
  picked: string | undefined;
  onPick: (id: string) => void;
  labelledBy: string;
  disabled?: boolean;
}) {
  return (
    <fieldset className="options" aria-labelledby={labelledBy} disabled={disabled}>
      <div className="options__list">
        {list.map((p) => (
          <label key={p.id} className={`option option--simple${picked === p.id ? " option--checked" : ""}`}>
            <span className="option__head">
              <input
                className="option__input"
                type="radio"
                name="package"
                value={p.id}
                checked={picked === p.id}
                onChange={() => onPick(p.id)}
              />
              <span className="option__mark" aria-hidden="true" />
              <span className="option__name" lang={p.language}>
                {p.name}
              </span>
            </span>
            {p.short && (
              <span className="option__short" lang={p.language}>
                {p.short}
              </span>
            )}
          </label>
        ))}
      </div>
    </fieldset>
  );
}
