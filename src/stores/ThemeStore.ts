import { create } from "zustand";

type ThemeMode = "light" | "dark";

type ThemeState = {
    mode: ThemeMode;
    setMode: (mode: ThemeMode) => void;
    toggleMode: () => void;
    initTheme: () => void;
};

const STORAGE_KEY = "gt_theme_mode";

function applyTheme(mode: ThemeMode): void {
    const root = document.documentElement;
    root.classList.toggle("dark", mode === "dark");
}

function readStoredMode(): ThemeMode {
    if (typeof window === "undefined") return "light";
    const stored = localStorage.getItem(STORAGE_KEY);
    return stored === "dark" ? "dark" : "light";
}

export const useThemeStore = create<ThemeState>((set, get) => ({
    mode: "light",
    setMode: (mode) => {
        applyTheme(mode);
        localStorage.setItem(STORAGE_KEY, mode);
        set({ mode });
    },
    toggleMode: () => {
        const next = get().mode === "dark" ? "light" : "dark";
        applyTheme(next);
        localStorage.setItem(STORAGE_KEY, next);
        set({ mode: next });
    },
    initTheme: () => {
        if (typeof window === "undefined") return;
        const stored = readStoredMode();
        applyTheme(stored);
        set({ mode: stored });
    },
}));
