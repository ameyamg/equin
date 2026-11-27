import { z } from "zod";

/**
 * Who an agent's turn is for, once the user has talked to it in this run
 * (`turn_for`) — chosen by what is pending, not by whom the message answers:
 * `user` — it waits on the user's reply or decision, so nobody else is told;
 * `supervisor` — nothing is pending on the user (done, or blocked on someone
 * else): the run is handed back to whoever started it (a supervisor, an
 * automation), its last message what they hear.
 */
export const TURN_ADDRESSEES = ["user", "supervisor"] as const;
export const TurnAddresseeSchema = z.enum(TURN_ADDRESSEES);
export type TurnAddressee = z.infer<typeof TurnAddresseeSchema>;
