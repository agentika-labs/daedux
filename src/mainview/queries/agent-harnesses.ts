import type {
  AgentConfigUpdateResult,
  AgentHarnessConfigId,
  AgentHarnessesSnapshot,
  AgentSkillCopyResult,
} from "@shared/rpc-types";
import {
  queryOptions,
  useMutation,
  useQuery,
  useQueryClient,
} from "@tanstack/react-query";

import { rpcRequest } from "@/hooks/useRPC";
import { isElectrobun } from "@/services/api-live";

const EMPTY_HARNESSES: AgentHarnessesSnapshot = {
  homePath: "",
  harnesses: [],
};

export const agentHarnessesQueryOptions = queryOptions({
  queryKey: ["agentHarnesses"],
  queryFn: async (): Promise<AgentHarnessesSnapshot> => {
    if (!isElectrobun()) {
      return EMPTY_HARNESSES;
    }
    return rpcRequest("getAgentHarnesses", {});
  },
  staleTime: 5000,
});

export const useAgentHarnessesQuery = () =>
  useQuery(agentHarnessesQueryOptions);

export const useUpdateAgentConfigMutation = () => {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (params: {
      harnessId: AgentHarnessConfigId;
      path: string;
      content: string;
    }): Promise<AgentConfigUpdateResult> =>
      rpcRequest("updateAgentConfigFile", params),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["agentHarnesses"] });
    },
  });
};

export const useCopyAgentSkillMutation = () => {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (params: {
      sourcePath: string;
      targetHarnessId: AgentHarnessConfigId;
      overwrite?: boolean;
    }): Promise<AgentSkillCopyResult> => rpcRequest("copyAgentSkill", params),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["agentHarnesses"] });
    },
  });
};
