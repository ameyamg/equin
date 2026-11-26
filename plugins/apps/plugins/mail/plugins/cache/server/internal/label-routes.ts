import { HttpError } from "@plugins/infra/plugins/endpoints/server";
import { MailRefusedError } from "@plugins/apps/plugins/mail/plugins/provider/core";

/** A label write the provider refuses as asked (a name taken, a move under itself) is the caller's 400. */
export async function refusedAs400<T>(run: () => Promise<T>): Promise<T> {
  try {
    return await run();
  } catch (err) {
    if (err instanceof MailRefusedError) throw new HttpError(400, err.message);
    throw err;
  }
}
