export function createDefaultAgentDraft() {
  return {
    name: "",
    role: "engineering",
    engine: "hermes-agent",
  } as const;
}
