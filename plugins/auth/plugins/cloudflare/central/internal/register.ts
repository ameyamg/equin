import { registerAuthProvider } from "@plugins/auth/central";
import { cloudflareDescriptor } from "./descriptor";

export const cloudflareAuthRegistration =
  registerAuthProvider(cloudflareDescriptor);
