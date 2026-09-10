import { z } from "zod";

const guidanceSchema = z.object({
  tone: z.string().trim().max(2000),
  guidance: z.string().trim().max(20000),
});

export const communicationProfileSchema = z.object({
  identitySummary: z.string().trim().max(20000),
  values: z.string().trim().max(20000),
  defaultTone: z.string().trim().max(2000),
  preferredLength: z.string().trim().max(1000),
  principles: z.string().trim().max(20000),
  signOff: z.string().trim().max(1000),
  channels: z.record(z.string(), guidanceSchema),
  situations: z.record(z.string(), guidanceSchema),
  people: z.record(z.string().uuid(), guidanceSchema.extend({ name: z.string().trim().max(500) })),
});
