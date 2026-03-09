import { promises as fs } from "node:fs";
import path from "node:path";

const cwd = process.cwd();
const bundleDir = process.env.UPDATER_BUNDLE_DIR
    ? path.resolve(cwd, process.env.UPDATER_BUNDLE_DIR)
    : path.resolve(cwd, "src-tauri/target/release/bundle");
const version = process.env.UPDATER_VERSION;
const baseUrl = process.env.UPDATER_BASE_URL;
const notes = process.env.UPDATER_NOTES ?? "";
const pubDate = process.env.UPDATER_PUB_DATE ?? new Date().toISOString();
const outputPath = process.env.UPDATER_OUTPUT
    ? path.resolve(cwd, process.env.UPDATER_OUTPUT)
    : path.join(bundleDir, "latest.json");

if (!version) {
    throw new Error("Missing UPDATER_VERSION");
}

if (!baseUrl) {
    throw new Error("Missing UPDATER_BASE_URL");
}

function toReleaseUrl(fileName) {
    return `${baseUrl.replace(/\/+$/, "")}/${encodeURIComponent(fileName)}`;
}

function inferTarget(fileName) {
    const lower = fileName.toLowerCase();
    const runtimeArch = process.arch === "arm64" ? "aarch64" : process.arch === "x64" ? "x86_64" : process.arch;

    if (lower.endsWith(".app.tar.gz")) {
        if (lower.includes("aarch64") || lower.includes("arm64")) return "darwin-aarch64-app";
        if (lower.includes("x86_64") || lower.includes("x64")) return "darwin-x86_64-app";
        if (runtimeArch === "aarch64") return "darwin-aarch64-app";
        return "darwin-x86_64-app";
    }

    if (lower.endsWith(".appimage.tar.gz")) {
        if (lower.includes("aarch64") || lower.includes("arm64")) return "linux-aarch64-appimage";
        if (lower.includes("i686")) return "linux-i686-appimage";
        return "linux-x86_64-appimage";
    }

    if (lower.endsWith(".msi.zip")) {
        if (lower.includes("aarch64") || lower.includes("arm64")) return "windows-aarch64-msi";
        if (lower.includes("i686")) return "windows-i686-msi";
        return "windows-x86_64-msi";
    }

    if (lower.endsWith(".exe.zip")) {
        if (lower.includes("aarch64") || lower.includes("arm64")) return "windows-aarch64-nsis";
        if (lower.includes("i686")) return "windows-i686-nsis";
        return "windows-x86_64-nsis";
    }

    return null;
}

async function walk(dir) {
    const entries = await fs.readdir(dir, { withFileTypes: true });
    const files = await Promise.all(entries.map(async (entry) => {
        const fullPath = path.join(dir, entry.name);
        if (entry.isDirectory()) return walk(fullPath);
        return [fullPath];
    }));
    return files.flat();
}

const allFiles = await walk(bundleDir);
const updaterFiles = allFiles.filter((file) => {
    const normalized = file.toLowerCase();
    return normalized.endsWith(".app.tar.gz")
        || normalized.endsWith(".appimage.tar.gz")
        || normalized.endsWith(".msi.zip")
        || normalized.endsWith(".exe.zip");
});

if (updaterFiles.length === 0) {
    throw new Error(`No updater artifacts found in ${bundleDir}`);
}

const platforms = {};

for (const artifactPath of updaterFiles) {
    const fileName = path.basename(artifactPath);
    const target = inferTarget(fileName);
    if (!target) continue;

    const sigPath = `${artifactPath}.sig`;
    let signature;
    try {
        signature = (await fs.readFile(sigPath, "utf8")).trim();
    } catch (error) {
        throw new Error(`Missing signature file for ${fileName}: ${sigPath}`);
    }

    platforms[target] = {
        url: toReleaseUrl(fileName),
        signature,
    };
}

if (Object.keys(platforms).length === 0) {
    throw new Error("No supported updater targets detected from artifact names");
}

const manifest = {
    version,
    notes: notes || undefined,
    pub_date: pubDate,
    platforms,
};

await fs.writeFile(outputPath, `${JSON.stringify(manifest, null, 2)}\n`, "utf8");
console.log(`Wrote updater manifest to ${outputPath}`);
