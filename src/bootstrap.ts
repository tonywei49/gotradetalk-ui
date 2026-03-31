import { invoke } from "@tauri-apps/api/core";
import { isTauriDesktop } from "./runtime/appRuntime";

const root = document.getElementById("root");

if (!root) {
    throw new Error("Root element not found");
}
const rootElement: HTMLElement = root;

rootElement.innerHTML = `
  <div style="min-height:100vh;display:grid;place-items:center;background:linear-gradient(180deg,#f7f9fc 0%,#edf2f7 100%);color:#0f172a;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;">
    <div style="display:grid;justify-items:center;gap:12px;padding:24px;">
      <div style="width:56px;height:56px;border-radius:18px;background:#0f172a;color:#fff;display:grid;place-items:center;font-size:22px;font-weight:700;letter-spacing:.08em;box-shadow:0 16px 32px rgba(15,23,42,.14);">GT</div>
      <div style="width:28px;height:28px;border-radius:999px;border:3px solid rgba(15,23,42,.14);border-top-color:#0f172a;animation:gt-bootstrap-spin .9s linear infinite;"></div>
      <div style="font-size:14px;font-weight:600;">Loading workspace...</div>
    </div>
  </div>
`;

const style = document.createElement("style");
style.textContent = `
@keyframes gt-bootstrap-spin {
  from { transform: rotate(0deg); }
  to { transform: rotate(360deg); }
}
`;
document.head.appendChild(style);

type DesktopBootReadyResult = {
    revealed: boolean;
    mainVisible: boolean;
    splashClosed: boolean;
    errors: string[];
    warnings: string[];
};

function renderBootstrapFailure(title: string, detail: string, items?: string[]): void {
    rootElement.innerHTML = `
      <div style="min-height:100vh;display:grid;place-items:center;background:#fff;color:#111827;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;padding:32px;">
        <div style="max-width:520px;display:grid;gap:12px;">
          <div style="font-size:24px;font-weight:700;">${title}</div>
          <div style="font-size:14px;line-height:1.6;">${detail}</div>
          ${items && items.length > 0 ? `
            <ul style="margin:0;padding-left:20px;font-size:13px;line-height:1.6;color:#4b5563;">
              ${items.map((item) => `<li>${item}</li>`).join("")}
            </ul>
          ` : ""}
        </div>
      </div>
    `;
}

function renderMainImportFailure(error: unknown): void {
    console.error("Failed to mount desktop app:", error);
    renderBootstrapFailure(
        "Application bootstrap failed",
        "The desktop workspace could not finish startup. Open DevTools with F12 / Ctrl+Shift+I and inspect the console.",
    );
}

function renderRevealFailure(result: DesktopBootReadyResult): void {
    console.error("Desktop bootstrap reveal failed:", result);
    const items = [
        `mainVisible: ${String(result.mainVisible)}`,
        `splashClosed: ${String(result.splashClosed)}`,
        ...result.errors,
    ];
    renderBootstrapFailure(
        "Desktop window reveal failed",
        "Startup was stopped before loading the full workspace because the desktop window did not complete reveal cleanly.",
        items,
    );
}

function installBootstrapDevtoolsShortcut(): void {
    window.addEventListener(
        "keydown",
        (event) => {
            const isF12 = event.key === "F12";
            const isCtrlShiftI = event.ctrlKey && event.shiftKey && event.key.toLowerCase() === "i";
            if (!isF12 && !isCtrlShiftI) return;
            event.preventDefault();
            void invoke("desktop_open_devtools").catch((error) => {
                console.warn("Desktop open devtools failed during bootstrap:", error);
            });
        },
        true,
    );
}

async function boot(): Promise<void> {
    if (isTauriDesktop()) {
        installBootstrapDevtoolsShortcut();
        try {
            const result = await invoke<DesktopBootReadyResult>("desktop_boot_ready");
            if (!result.revealed) {
                renderRevealFailure(result);
                return;
            }
            if (result.warnings.length > 0) {
                console.warn("Desktop bootstrap reveal warnings:", result.warnings);
            }
        } catch (error) {
            console.error("Desktop bootstrap reveal request failed:", error);
            renderBootstrapFailure(
                "Desktop bootstrap failed",
                "The desktop window did not complete its startup handshake, so loading the full workspace was stopped.",
                [error instanceof Error ? error.message : String(error)],
            );
            return;
        }
    }

    requestAnimationFrame(() => {
        window.setTimeout(() => {
            void import("./main").catch(renderMainImportFailure);
        }, 32);
    });
}

void boot();
