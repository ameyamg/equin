import { db } from "@plugins/database/server";
import { createLocalMail } from "./provider";

/** The local mailbox in this host's database: the one instance every caller shares (one push). */
export const localMail = createLocalMail({ db });
