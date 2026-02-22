import type { HubMatrixCredentials, HubSupabaseSession } from "../../../api/types";
import { resolveNotebookAccessToken } from "../../../services/notebookTokenProvider";
import type { NotebookAuthContext } from "../types";

type BuildNotebookAuthParams = {
    hubSession: HubSupabaseSession | null;
    matrixCredentials: HubMatrixCredentials | null;
    userType: "client" | "staff" | null;
    capabilities?: string[];
    apiBaseUrl?: string | null;
};

export function buildNotebookAuth(params: BuildNotebookAuthParams): {
    notebookAuth: NotebookAuthContext | null;
    notebookToken: ReturnType<typeof resolveNotebookAccessToken>;
} {
    const notebookToken = resolveNotebookAccessToken(params.hubSession);
    const accessToken = notebookToken.accessToken;
    if (!accessToken) {
        return { notebookAuth: null, notebookToken };
    }
    return {
        notebookToken,
        notebookAuth: {
            accessToken,
            matrixAccessToken: params.matrixCredentials?.access_token ?? null,
            apiBaseUrl: params.apiBaseUrl ?? null,
            hsUrl: params.matrixCredentials?.hs_url ?? null,
            matrixUserId: params.matrixCredentials?.user_id ?? null,
            userType: params.userType,
            capabilities: params.capabilities,
        },
    };
}
