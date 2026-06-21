import { Type } from "@sinclair/typebox";

const Nullable = (t: ReturnType<typeof Type.String>) =>
  Type.Union([t, Type.Null()]);

/** What the public contact form submits. */
export const ContactBody = Type.Object(
  {
    // Mirrors the "I want to…" toggle on the marketing contact page.
    intent: Type.Optional(Type.String({ maxLength: 80 })),
    name: Type.String({ minLength: 1, maxLength: 120 }),
    email: Type.String({ format: "email", maxLength: 254 }),
    company: Type.Optional(Type.String({ maxLength: 160 })),
    phone: Type.Optional(Type.String({ maxLength: 40 })),
    message: Type.Optional(Type.String({ maxLength: 4000 })),
  },
  { additionalProperties: false },
);

export const ContactResponse = Type.Object({
  ok: Type.Boolean(),
});

export const ContactStatus = Type.Union([
  Type.Literal("NEW"),
  Type.Literal("READ"),
  Type.Literal("ARCHIVED"),
]);

/** A stored contact message, as shown to staff in the console. */
export const ContactMessageObject = Type.Object({
  id: Type.String(),
  intent: Nullable(Type.String()),
  name: Type.String(),
  email: Type.String(),
  company: Nullable(Type.String()),
  phone: Nullable(Type.String()),
  message: Nullable(Type.String()),
  status: ContactStatus,
  createdAt: Type.String(),
});

export const ContactMessageListResponse = Type.Object({
  messages: Type.Array(ContactMessageObject),
});

export const UpdateContactStatusBody = Type.Object(
  { status: ContactStatus },
  { additionalProperties: false },
);
