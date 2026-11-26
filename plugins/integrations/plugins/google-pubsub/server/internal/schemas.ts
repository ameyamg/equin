import { z } from "zod";

/** The most messages one pull asks for (the client's own cap). */
export const PUBSUB_PULL_MAX = 100;

export const TopicSchema = z.object({ name: z.string() });

export const SubscriptionSchema = z.object({
  name: z.string(),
  topic: z.string(),
});

export const IamBindingSchema = z
  .object({
    role: z.string(),
    members: z.array(z.string()).optional(),
  })
  .passthrough();

export const IamPolicySchema = z
  .object({
    version: z.number().int().optional(),
    etag: z.string().optional(),
    bindings: z.array(IamBindingSchema).optional(),
  })
  .passthrough();
export type IamPolicy = z.infer<typeof IamPolicySchema>;

export const ReceivedMessageSchema = z.object({
  ackId: z.string(),
  message: z.object({
    /** Base64 (standard alphabet); absent for an empty message. */
    data: z.string().optional(),
    messageId: z.string(),
    publishTime: z.string(),
    attributes: z.record(z.string(), z.string()).optional(),
  }),
  deliveryAttempt: z.number().int().optional(),
});
export type ReceivedMessage = z.infer<typeof ReceivedMessageSchema>;

/** A pull answers `{}` when nothing arrived before Pub/Sub let the held request go. */
export const PullResponseSchema = z.object({
  receivedMessages: z
    .array(ReceivedMessageSchema)
    .max(PUBSUB_PULL_MAX)
    .optional(),
});

export const EmptySchema = z.object({}).passthrough();

/** Google's error envelope, with the `details` Pub/Sub fills (ErrorInfo, Help links). */
export const ErrorEnvelopeSchema = z.object({
  error: z.object({
    code: z.number().int(),
    message: z.string(),
    status: z.string().optional(),
    details: z
      .array(
        z
          .object({
            reason: z.string().optional(),
            metadata: z.record(z.string(), z.string()).optional(),
            links: z
              .array(
                z.object({
                  url: z.string(),
                  description: z.string().optional(),
                }),
              )
              .optional(),
          })
          .passthrough(),
      )
      .optional(),
  }),
});
