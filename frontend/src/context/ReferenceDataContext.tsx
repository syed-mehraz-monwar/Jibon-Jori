import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";
import { referenceApi } from "../api/reference.api";
import type { ReferenceData } from "../lib/types";
import { useAuth } from "./AuthContext";

type LoadStatus = "idle" | "loading" | "ready" | "error";

type ReferenceDataState = {
  data: ReferenceData | null;
  status: LoadStatus;
  error: string | null;
  reload: () => void;
};

const EMPTY: ReferenceData = {
  educationLevels: [],
  professions: [],
  interests: [],
  genderOptions: [],
  maritalStatusOptions: [],
  notificationTypeOptions: [],
};

const ReferenceDataContext = createContext<ReferenceDataState | null>(null);

/**
 * Loads the dropdown option sets once per signed-in session and shares them.
 *
 * The sets come from the `referenceData` GraphQL field (bounded at
 * `MAX_REFERENCE_ROWS = 500` per list). Loading them once avoids one request per
 * dropdown field on a form that has many selects. The field requires
 * authentication, so nothing is requested until there is a session.
 */
export function ReferenceDataProvider({ children }: { children: ReactNode }) {
  const { status: authStatus } = useAuth();
  const [data, setData] = useState<ReferenceData | null>(null);
  const [status, setStatus] = useState<LoadStatus>("idle");
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setStatus("loading");
    setError(null);
    try {
      const result = await referenceApi.get();
      setData(result.referenceData);
      setStatus("ready");
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Could not load reference data.");
      setData(EMPTY);
      setStatus("error");
    }
  }, []);

  useEffect(() => {
    if (authStatus !== "authenticated") {
      setData(EMPTY);
      setStatus("idle");
      setError(null);
      return;
    }
    void load();
  }, [authStatus, load]);

  const value = useMemo<ReferenceDataState>(
    () => ({ data, status, error, reload: () => void load() }),
    [data, status, error, load]
  );

  return <ReferenceDataContext.Provider value={value}>{children}</ReferenceDataContext.Provider>;
}

export function useReferenceData(): ReferenceDataState {
  const context = useContext(ReferenceDataContext);
  if (!context) throw new Error("useReferenceData must be used inside ReferenceDataProvider");
  return context;
}
