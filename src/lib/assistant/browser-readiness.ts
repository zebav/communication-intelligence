export type BrowserReadiness = {
  enabled: false;
  mode: "preparation";
  blockers: string[];
};
/** No live driver has been shipped. Environment flags alone cannot enable execution. */
export function browserReadiness(): BrowserReadiness {
  return {
    enabled: false,
    mode: "preparation",
    blockers: [
      "Nätverksskyddet hos Browserbase är inte verifierat.",
      "Den verkliga webbkörmotorn är inte installerad.",
      "Databasinstallation och skarpt helhetstest återstår.",
    ],
  };
}
