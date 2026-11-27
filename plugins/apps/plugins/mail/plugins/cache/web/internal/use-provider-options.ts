import { MailProviderUi } from "@plugins/apps/plugins/mail/plugins/provider/web";

/** Settings → Config → Mail account's options: automatic, then each registered provider. */
export function useMailProviderOptions(): readonly {
  readonly value: string;
  readonly label: string;
}[] {
  const providers = MailProviderUi.Connect.useContributions();
  return [
    { value: "", label: "Automatic (the connected one)" },
    ...providers.map((p) => ({ value: p.id, label: p.label })),
  ];
}
