import { Type } from "@sinclair/typebox";

const Email = Type.String({ format: "email", maxLength: 254 });
const Password = Type.String({ minLength: 8, maxLength: 128 });

export const LoginBody = Type.Object(
  {
    email: Email,
    password: Password,
  },
  { additionalProperties: false },
);

export const VerifyBody = Type.Object(
  {
    challengeId: Type.String({ minLength: 1 }),
    code: Type.String({ pattern: "^[0-9]{6}$" }),
  },
  { additionalProperties: false },
);

export const AcceptInviteBody = Type.Object(
  {
    token: Type.String({ minLength: 1, maxLength: 512 }),
    firstName: Type.String({ minLength: 1, maxLength: 80 }),
    lastName: Type.String({ minLength: 1, maxLength: 80 }),
    password: Password,
  },
  { additionalProperties: false },
);

export const ForgotBody = Type.Object(
  {
    email: Email,
  },
  { additionalProperties: false },
);

export const ResetPasswordBody = Type.Object(
  {
    token: Type.String({ minLength: 1, maxLength: 512 }),
    password: Password,
  },
  { additionalProperties: false },
);

/** Public user shape returned alongside a session. */
export const PublicEmployee = Type.Object({
  id: Type.String(),
  email: Type.String(),
  name: Type.String(),
  role: Type.String(),
  clientId: Type.Union([Type.String(), Type.Null()]),
});

/** A session was established — the token lives in an httpOnly cookie. */
export const SessionResponse = Type.Object({
  user: PublicEmployee,
});

export const ForgotResponse = Type.Object({
  sent: Type.Boolean(),
});

/**
 * login / verify return EITHER a 2FA challenge OR (when MFA is disabled, or
 * after a verified code) an established session. The token is set as a cookie,
 * never in the body. Clients discriminate on the presence of `user`.
 */
export const AuthOutcomeResponse = Type.Object({
  challengeId: Type.Optional(Type.String()),
  method: Type.Optional(
    Type.Union([Type.Literal("sms"), Type.Literal("email")]),
  ),
  hint: Type.Optional(Type.String()),
  user: Type.Optional(PublicEmployee),
});

/** Prefill data for the onboarding form, fetched by magic-link token. */
export const InvitePrefillResponse = Type.Object({
  email: Type.String(),
  role: Type.String(),
  name: Type.Union([Type.String(), Type.Null()]),
  firstName: Type.Union([Type.String(), Type.Null()]),
  lastName: Type.Union([Type.String(), Type.Null()]),
  clientName: Type.Union([Type.String(), Type.Null()]),
});
