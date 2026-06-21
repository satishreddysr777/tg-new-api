import { FormatRegistry } from "@sinclair/typebox";

/**
 * TypeBox's validator rejects unknown string `format`s, so any format used in
 * a schema must be registered here. Imported for its side effect by app.ts
 * before routes (and therefore validators) are compiled.
 */
const EMAIL =
  /^[a-zA-Z0-9.!#$%&'*+/=?^_`{|}~-]+@[a-zA-Z0-9](?:[a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?(?:\.[a-zA-Z0-9](?:[a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?)+$/;

if (!FormatRegistry.Has("email")) {
  FormatRegistry.Set("email", (value) => EMAIL.test(value));
}

// Calendar date (YYYY-MM-DD) — used for placement start/end dates.
const DATE = /^\d{4}-\d{2}-\d{2}$/;

if (!FormatRegistry.Has("date")) {
  FormatRegistry.Set(
    "date",
    (value) => DATE.test(value) && !Number.isNaN(Date.parse(value)),
  );
}
