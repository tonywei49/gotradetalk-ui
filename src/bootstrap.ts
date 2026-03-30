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

function renderBootstrapFailure(error: unknown): void {
    console.error("Failed to mount desktop app:", error);
    rootElement.innerHTML = `
      <div style="min-height:100vh;display:grid;place-items:center;background:#fff;color:#111827;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;padding:32px;">
        <div style="max-width:520px;display:grid;gap:12px;">
          <div style="font-size:24px;font-weight:700;">Application bootstrap failed</div>
          <div style="font-size:14px;line-height:1.6;">The desktop workspace could not finish startup. Open DevTools with F12 / Ctrl+Shift+I and inspect the console.</div>
        </div>
      </div>
    `;
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
            await invoke("desktop_boot_ready");
        } catch (error) {
            console.warn("Desktop boot ready notification failed:", error);
        }
    }

    requestAnimationFrame(() => {
        window.setTimeout(() => {
            void import("./main").catch(renderBootstrapFailure);
        }, 32);
    });
}

void boot();
