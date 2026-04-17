import { create } from "zustand";

type OfficeBetaState = {
  selectedAgentId: string | null;
  hoveredAgentId: string | null;
  setSelectedAgentId: (agentId: string | null) => void;
  setHoveredAgentId: (agentId: string | null) => void;
};

export const useOfficeBetaStore = create<OfficeBetaState>((set) => ({
  selectedAgentId: null,
  hoveredAgentId: null,
  setSelectedAgentId: (selectedAgentId) => set({ selectedAgentId }),
  setHoveredAgentId: (hoveredAgentId) => set({ hoveredAgentId }),
}));
