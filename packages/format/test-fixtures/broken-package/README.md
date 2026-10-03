# Broken package (test fixture)

Deliberately invalid. `validate.test.ts` checks that every mistake below is
reported with a readable message:

- the source "lab" names a license that is not declared
- `speed` depends on itself
- `power` has an unreadable formula
- the whistle states 30 ft, which the ft→m table cannot convert
- the whistle grants a choice that does not exist
- English texts are incomplete
