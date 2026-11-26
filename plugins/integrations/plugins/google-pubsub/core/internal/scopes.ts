// Cloud Pub/Sub on the user's own Google Cloud project: create a topic and a
// pull subscription, grant a publisher on the topic, pull and ack. The
// narrowest scope Pub/Sub accepts; `include_granted_scopes` (the Google
// provider) keeps the scopes granted before it (Gmail, Drive).
export const PUBSUB_SCOPES = [
  "https://www.googleapis.com/auth/pubsub",
] as const;
