import React, { useRef, type FC } from "react";
import { SunIcon, MoonIcon } from "@heroicons/react/24/outline";
import { useTranslation } from "react-i18next";
import { useThemeStore } from "../stores/ThemeStore";
import { useToastStore } from "../stores/ToastStore";
import { displayLanguageOptions } from "../constants/displayLanguages";
import { translationLanguageOptions } from "../constants/translationLanguages";
import {
    ensureNotificationSoundEnabled,
    playNotificationSound,
    type NotificationSoundMode,
} from "../utils/notificationSound";
import type { HubProfileSummary, HubMatrixCredentials } from "../api/types";
import type { PluginHostTools, PluginPlatformState, PluginRuntimeContext, PluginResolvedSlotItem } from "../plugins/types";

interface SidebarProps {
    activeTab: string;
    displayLanguage: string;
    handleDisplayLanguageChange: (value: string) => Promise<void>;
    setSettingsDetail: (detail: any) => void;
    setMobileView: (view: "list" | "detail") => void;
    notificationSoundMode: NotificationSoundMode;
    setNotificationSoundMode: (mode: NotificationSoundMode) => void;
    pluginSettingsSections: PluginResolvedSlotItem<"settingsSections">[];
    platformState: PluginPlatformState;
    desktopUpdaterAvailable: boolean;
    desktopUpdaterVersion: string | null;
    checkingDesktopUpdate: boolean;
    setCheckingDesktopUpdate: (checking: boolean) => void;
    checkDesktopUpdaterOnce: (pushToast: any) => Promise<"disabled" | "idle" | "installed">;
    onLogout: () => void;
    accountAvatarUrl: string | null;
    accountId: string;
    accountInitial: string;
    accountSubtitle: string;
    meProfile: HubProfileSummary | null;
    avatarUploading: boolean;
    avatarUploadFeedback: string | null;
    onUploadAvatar: (event: React.ChangeEvent<HTMLInputElement>) => Promise<void>;
    accountEditorMode: "none" | "name" | "password";
    setAccountEditorMode: (mode: "none" | "name" | "password") => void;
    displayNameDraft: string;
    setDisplayNameDraft: (name: string) => void;
    currentPasswordDraft: string;
    setCurrentPasswordDraft: (password: string) => void;
    newPasswordDraft: string;
    setNewPasswordDraft: (password: string) => void;
    confirmPasswordDraft: string;
    setConfirmPasswordDraft: (password: string) => void;
    accountEditorBusy: boolean;
    accountEditorError: string | null;
    setAccountEditorError: (error: string | null) => void;
    accountEditorSuccess: string | null;
    setAccountEditorSuccess: (success: string | null) => void;
    handleSubmitPassword: () => Promise<void>;
    handleSubmitDisplayName: () => Promise<void>;
    matrixCredentials: HubMatrixCredentials | null;
    getDisplayLanguageLabel: (locale: string | null | undefined) => string;
    getTranslationLanguageLabel: (locale: string | null | undefined) => string;
}

export const SettingsAccountSidebar: FC<SidebarProps> = ({
    activeTab,
    displayLanguage,
    handleDisplayLanguageChange,
    setSettingsDetail,
    setMobileView,
    notificationSoundMode,
    setNotificationSoundMode,
    pluginSettingsSections,
    platformState,
    desktopUpdaterAvailable,
    desktopUpdaterVersion,
    checkingDesktopUpdate,
    setCheckingDesktopUpdate,
    checkDesktopUpdaterOnce,
    onLogout,
    accountAvatarUrl,
    accountId,
    accountInitial,
    accountSubtitle,
    meProfile,
    avatarUploading,
    avatarUploadFeedback,
    onUploadAvatar,
    accountEditorMode,
    setAccountEditorMode,
    displayNameDraft,
    setDisplayNameDraft,
    currentPasswordDraft,
    setCurrentPasswordDraft,
    newPasswordDraft,
    setNewPasswordDraft,
    confirmPasswordDraft,
    setConfirmPasswordDraft,
    accountEditorBusy,
    accountEditorError,
    setAccountEditorError,
    accountEditorSuccess,
    setAccountEditorSuccess,
    handleSubmitPassword,
    handleSubmitDisplayName,
    matrixCredentials,
    getDisplayLanguageLabel,
    getTranslationLanguageLabel,
}) => {
    const { t } = useTranslation();
    const themeMode = useThemeStore((state) => state.mode);
    const setThemeMode = useThemeStore((state) => state.setMode);
    const pushToast = useToastStore((state) => state.pushToast);
    const avatarUploadInputRef = useRef<HTMLInputElement | null>(null);

    if (activeTab === "settings") {
        return (
            <>
                <div className="h-16 px-4 flex items-center justify-between border-b border-gray-100 dark:border-slate-800">
                    <div className="text-sm font-semibold text-slate-800 dark:text-slate-100">
                        {t("layout.settings")}
                    </div>
                </div>
                <div className="flex-1 min-h-0 overflow-y-scroll gt-visible-scrollbar p-4 space-y-3">
                    <button
                        type="button"
                        onClick={() => {
                            setSettingsDetail("none");
                        }}
                        className="w-full text-left rounded-lg border border-gray-200 px-3 py-2 text-sm text-slate-700 hover:bg-gray-50 dark:border-slate-800 dark:text-slate-100 dark:hover:bg-slate-800"
                    >
                        {t("layout.tickets")}
                    </button>
                    <div className="rounded-lg border border-gray-200 px-3 py-2 dark:border-slate-800">
                        <div className="flex items-center justify-between">
                            <div className="text-sm text-slate-700 dark:text-slate-100">
                                {t("layout.appearance")}
                                <span className="ml-2 text-xs text-slate-500 dark:text-slate-400">
                                    {themeMode === "dark" ? t("layout.dark") : t("layout.light")}
                                </span>
                            </div>
                            <div className="flex items-center rounded-full border border-gray-200 bg-white p-1 shadow-sm dark:border-slate-700 dark:bg-slate-900">
                                <button
                                    type="button"
                                    onClick={() => setThemeMode("light")}
                                    className={`flex items-center gap-1 rounded-full px-3 py-1 text-xs font-semibold ${themeMode === "light"
                                        ? "bg-emerald-500 text-white"
                                        : "text-slate-500 hover:text-slate-700 dark:text-slate-300 dark:hover:text-slate-100"
                                        }`}
                                    aria-label={t("layout.light")}
                                >
                                    <SunIcon className="h-4 w-4" />
                                </button>
                                <button
                                    type="button"
                                    onClick={() => setThemeMode("dark")}
                                    className={`flex items-center gap-1 rounded-full px-3 py-1 text-xs font-semibold ${themeMode === "dark"
                                        ? "bg-emerald-500 text-white"
                                        : "text-slate-500 hover:text-slate-700 dark:text-slate-300 dark:hover:text-slate-100"
                                        }`}
                                    aria-label={t("layout.dark")}
                                >
                                    <MoonIcon className="h-4 w-4" />
                                </button>
                            </div>
                        </div>
                    </div>
                    <div className="rounded-lg border border-gray-200 px-3 py-2 dark:border-slate-800">
                        <div className="text-sm text-slate-700 dark:text-slate-100 mb-2">
                            {t("layout.displayLanguage")}
                        </div>
                        <select
                            value={displayLanguage}
                            onChange={(event) => void handleDisplayLanguageChange(event.target.value)}
                            className="w-full rounded-md border border-gray-200 bg-white px-2 py-1 text-sm text-slate-700 outline-none focus:border-emerald-400 focus:ring-1 focus:ring-emerald-400 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-100"
                        >
                            {displayLanguageOptions.map((option) => (
                                <option key={option.value} value={option.value}>
                                    {option.label}
                                </option>
                            ))}
                        </select>
                    </div>
                    <button
                        type="button"
                        onClick={() => {
                            setSettingsDetail("chat-language");
                            setMobileView("detail");
                        }}
                        className="w-full text-left rounded-lg border border-gray-200 px-3 py-2 text-sm text-slate-700 hover:bg-gray-50 dark:border-slate-800 dark:text-slate-100 dark:hover:bg-slate-800"
                    >
                        {t("layout.chatReceiveLanguage")}
                    </button>
                    <button
                        type="button"
                        onClick={() => {
                            setSettingsDetail("translation-default");
                            setMobileView("detail");
                        }}
                        className="w-full text-left rounded-lg border border-gray-200 px-3 py-2 text-sm text-slate-700 hover:bg-gray-50 dark:border-slate-800 dark:text-slate-100 dark:hover:bg-slate-800"
                    >
                        {t("layout.translationDefaultContent")}
                    </button>
                    {false && pluginSettingsSections.length > 0 && (
                        <div className="space-y-2 rounded-lg border border-dashed border-emerald-200 px-3 py-3 dark:border-emerald-900/60">
                            <div className="text-xs font-semibold uppercase tracking-wide text-emerald-700 dark:text-emerald-300">
                                Plugins
                            </div>
                            <div className="text-xs text-slate-500 dark:text-slate-400">
                                Source: {platformState.source} · State: {platformState.syncState}
                            </div>
                            {pluginSettingsSections.map((section) => (
                                <button
                                    key={`${section.pluginId}:${section.id}`}
                                    type="button"
                                    onClick={() => {
                                        setSettingsDetail(`plugin:${section.pluginId}:${section.id}`);
                                        setMobileView("detail");
                                    }}
                                    className="w-full rounded-lg border border-gray-200 px-3 py-2 text-left text-sm text-slate-700 hover:bg-gray-50 dark:border-slate-800 dark:text-slate-100 dark:hover:bg-slate-800"
                                >
                                    <div className="font-medium">{section.label}</div>
                                    {section.description && (
                                        <div className="mt-1 text-xs text-slate-500 dark:text-slate-400">
                                            {section.description}
                                        </div>
                                    )}
                                </button>
                            ))}
                        </div>
                    )}
                    <div className="rounded-lg border border-gray-200 px-3 py-2 dark:border-slate-800">
                        <div className="mb-2 text-sm text-slate-700 dark:text-slate-100">
                            {t("layout.notificationSound")}
                        </div>
                        <div className="flex items-center gap-2">
                            <select
                                value={notificationSoundMode}
                                onChange={(event) => {
                                    const next = event.target.value as NotificationSoundMode;
                                    setNotificationSoundMode(next);
                                    if (next !== "off") {
                                        ensureNotificationSoundEnabled({ userInitiated: true });
                                        playNotificationSound(next);
                                    }
                                }}
                                className="flex-1 rounded-md border border-gray-200 bg-white px-2 py-1 text-sm text-slate-700 outline-none focus:border-emerald-400 focus:ring-1 focus:ring-emerald-400 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-100"
                            >
                                <option value="off">{t("layout.notificationSoundOff")}</option>
                                <option value="classic">{t("layout.notificationSoundClassic")}</option>
                                <option value="soft">{t("layout.notificationSoundSoft")}</option>
                                <option value="chime">{t("layout.notificationSoundChime")}</option>
                            </select>
                            <button
                                type="button"
                                onClick={() => {
                                    if (notificationSoundMode === "off") return;
                                    ensureNotificationSoundEnabled({ userInitiated: true });
                                    playNotificationSound(notificationSoundMode);
                                }}
                                disabled={notificationSoundMode === "off"}
                                className="rounded-md border border-gray-200 px-3 py-1 text-xs text-slate-700 hover:bg-gray-50 disabled:cursor-not-allowed disabled:opacity-60 dark:border-slate-700 dark:text-slate-100 dark:hover:bg-slate-800"
                            >
                                {t("layout.notificationSoundPreview")}
                            </button>
                        </div>
                    </div>
                    {desktopUpdaterAvailable && (
                        <div className="rounded-lg border border-gray-200 px-3 py-2 dark:border-slate-800">
                            <div className="mb-2 text-sm text-slate-700 dark:text-slate-100">
                                Desktop Updates
                            </div>
                            {desktopUpdaterVersion && (
                                <div className="mb-2 text-xs text-slate-500 dark:text-slate-400">
                                    Current version: {desktopUpdaterVersion}
                                </div>
                            )}
                            <button
                                type="button"
                                disabled={checkingDesktopUpdate}
                                onClick={() => {
                                    if (checkingDesktopUpdate) return;
                                    setCheckingDesktopUpdate(true);
                                    void checkDesktopUpdaterOnce(pushToast)
                                        .catch((error) => {
                                            console.warn("Manual desktop updater check failed:", error);
                                            pushToast("error", "Failed to check for desktop updates.", 4000);
                                        })
                                        .finally(() => {
                                            setCheckingDesktopUpdate(false);
                                        });
                                }}
                                className="rounded-md border border-gray-200 px-3 py-1 text-xs text-slate-700 hover:bg-gray-50 disabled:cursor-not-allowed disabled:opacity-60 dark:border-slate-700 dark:text-slate-100 dark:hover:bg-slate-800"
                            >
                                {checkingDesktopUpdate ? "Checking..." : "Check for updates"}
                            </button>
                        </div>
                    )}
                    <button
                        type="button"
                        onClick={onLogout}
                        className="w-full text-left rounded-lg border border-rose-200 px-3 py-2 text-sm text-rose-600 hover:bg-rose-50 dark:border-rose-900/50 dark:text-rose-300 dark:hover:bg-slate-800"
                    >
                        {t("layout.logoutAccount")}
                    </button>
                </div>
            </>
        );
    }

    if (activeTab === "account") {
        return (
            <>
                <div className="h-16 px-4 flex items-center justify-between border-b border-gray-100 dark:border-slate-800">
                    <div className="text-sm font-semibold text-slate-800 dark:text-slate-100">
                        {t("layout.accountSettings")}
                    </div>
                </div>
                <div className="flex-1 min-h-0 overflow-y-auto gt-visible-scrollbar p-4 pb-[calc(env(safe-area-inset-bottom,0px)+1rem)] space-y-3">
                    <div className="rounded-2xl border border-slate-200 bg-slate-50 p-4 dark:border-slate-800 dark:bg-slate-950/60">
                        <div className="flex items-center gap-3">
                            {accountAvatarUrl ? (
                                <img src={accountAvatarUrl} alt={accountId} className="h-14 w-14 rounded-2xl object-cover" />
                            ) : (
                                <div className="flex h-14 w-14 items-center justify-center rounded-2xl bg-slate-200 text-lg font-semibold text-slate-600 dark:bg-slate-700 dark:text-slate-100">
                                    {accountInitial}
                                </div>
                            )}
                            <div className="min-w-0">
                                <div className="truncate text-base font-semibold text-slate-900 dark:text-slate-50">
                                    {meProfile?.display_name || accountId}
                                </div>
                                <div className="truncate text-sm text-slate-500 dark:text-slate-400">
                                    {accountId}
                                </div>
                                <div className="truncate text-xs text-slate-400 dark:text-slate-500">
                                    {accountSubtitle}
                                </div>
                            </div>
                        </div>
                        <div className="mt-4 grid grid-cols-1 gap-2 text-sm sm:grid-cols-2">
                            <div className="rounded-xl bg-white px-3 py-2 dark:bg-slate-900">
                                <div className="text-[11px] font-semibold uppercase tracking-wide text-slate-400">Company</div>
                                <div className="mt-1 text-slate-700 dark:text-slate-100">{meProfile?.company_name || t("common.placeholder")}</div>
                            </div>
                            <div className="rounded-xl bg-white px-3 py-2 dark:bg-slate-900">
                                <div className="text-[11px] font-semibold uppercase tracking-wide text-slate-400">Title</div>
                                <div className="mt-1 text-slate-700 dark:text-slate-100">{meProfile?.job_title || t("common.placeholder")}</div>
                            </div>
                            <div className="rounded-xl bg-white px-3 py-2 dark:bg-slate-900">
                                <div className="text-[11px] font-semibold uppercase tracking-wide text-slate-400">Country</div>
                                <div className="mt-1 text-slate-700 dark:text-slate-100">{meProfile?.country || t("common.placeholder")}</div>
                            </div>
                            <div className="rounded-xl bg-white px-3 py-2 dark:bg-slate-900">
                                <div className="text-[11px] font-semibold uppercase tracking-wide text-slate-400">Matrix ID</div>
                                <div className="mt-1 break-all text-slate-700 dark:text-slate-100">{meProfile?.matrix_user_id || matrixCredentials?.user_id || t("common.placeholder")}</div>
                            </div>
                            <div className="rounded-xl bg-white px-3 py-2 dark:bg-slate-900">
                                <div className="text-[11px] font-semibold uppercase tracking-wide text-slate-400">Display Language</div>
                                <div className="mt-1 text-slate-700 dark:text-slate-100">{getDisplayLanguageLabel(meProfile?.locale || displayLanguage)}</div>
                            </div>
                            <div className="rounded-xl bg-white px-3 py-2 dark:bg-slate-900">
                                <div className="text-[11px] font-semibold uppercase tracking-wide text-slate-400">Chat Language</div>
                                <div className="mt-1 text-slate-700 dark:text-slate-100">{getTranslationLanguageLabel(meProfile?.translation_locale || (meProfile as any)?.chatReceiveLanguage || "")}</div>
                            </div>
                        </div>
                    </div>
                    <button
                        type="button"
                        onClick={() => avatarUploadInputRef.current?.click()}
                        disabled={avatarUploading}
                        className="block w-full rounded-lg border border-gray-200 px-3 py-2 text-left text-sm text-slate-700 hover:bg-gray-50 disabled:opacity-60 dark:border-slate-800 dark:text-slate-100 dark:hover:bg-slate-800"
                    >
                        {avatarUploading ? t("common.loading") : t("layout.uploadAvatar")}
                    </button>
                    {avatarUploadFeedback && (
                        <div
                            className={`text-xs ${avatarUploadFeedback.includes("failed")
                                ? "text-rose-500"
                                : "text-emerald-600 dark:text-emerald-300"
                                }`}
                        >
                            {avatarUploadFeedback}
                        </div>
                    )}
                    <input
                        ref={avatarUploadInputRef}
                        type="file"
                        accept="image/*"
                        className="hidden"
                        onChange={(event) => {
                            void onUploadAvatar(event);
                        }}
                    />
                    <button
                        type="button"
                        onClick={() => {
                            setAccountEditorMode(accountEditorMode === "password" ? "none" : "password");
                            setAccountEditorError(null);
                            setAccountEditorSuccess(null);
                        }}
                        className="w-full text-left rounded-lg border border-gray-200 px-3 py-2 text-sm text-slate-700 hover:bg-gray-50 dark:border-slate-800 dark:text-slate-100 dark:hover:bg-slate-800"
                    >
                        {t("layout.changePassword")}
                    </button>
                    {accountEditorMode === "password" && (
                        <div className="rounded-xl border border-gray-200 bg-gray-50 p-3 dark:border-slate-800 dark:bg-slate-950/60">
                            <div className="grid gap-3">
                                <input
                                    type="password"
                                    value={currentPasswordDraft}
                                    onChange={(event) => setCurrentPasswordDraft(event.target.value)}
                                    placeholder={t("auth.fields.currentPasswordLabel")}
                                    className="w-full rounded-lg border border-gray-200 bg-white px-3 py-2 text-sm outline-none focus:border-emerald-400 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-100"
                                    autoComplete="current-password"
                                />
                                <input
                                    type="password"
                                    value={newPasswordDraft}
                                    onChange={(event) => setNewPasswordDraft(event.target.value)}
                                    placeholder={t("auth.fields.newPasswordLabel")}
                                    className="w-full rounded-lg border border-gray-200 bg-white px-3 py-2 text-sm outline-none focus:border-emerald-400 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-100"
                                    autoComplete="new-password"
                                />
                                <input
                                    type="password"
                                    value={confirmPasswordDraft}
                                    onChange={(event) => setConfirmPasswordDraft(event.target.value)}
                                    placeholder={t("auth.fields.confirmPasswordLabel")}
                                    className="w-full rounded-lg border border-gray-200 bg-white px-3 py-2 text-sm outline-none focus:border-emerald-400 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-100"
                                    autoComplete="new-password"
                                />
                                <button
                                    type="button"
                                    onClick={() => void handleSubmitPassword()}
                                    disabled={accountEditorBusy}
                                    className="rounded-lg bg-[#2F5C56] px-3 py-2 text-sm font-semibold text-white hover:bg-[#244a45] disabled:opacity-60"
                                >
                                    {accountEditorBusy ? t("common.loading") : t("common.confirm")}
                                </button>
                            </div>
                        </div>
                    )}
                    <button
                        type="button"
                        onClick={() => {
                            setAccountEditorMode(accountEditorMode === "name" ? "none" : "name");
                            setAccountEditorError(null);
                            setAccountEditorSuccess(null);
                        }}
                        className="w-full text-left rounded-lg border border-gray-200 px-3 py-2 text-sm text-slate-700 hover:bg-gray-50 dark:border-slate-800 dark:text-slate-100 dark:hover:bg-slate-800"
                    >
                        {t("layout.changeName")}
                    </button>
                    {accountEditorMode === "name" && (
                        <div className="rounded-xl border border-gray-200 bg-gray-50 p-3 dark:border-slate-800 dark:bg-slate-950/60">
                            <div className="grid gap-3">
                                <input
                                    type="text"
                                    value={displayNameDraft}
                                    onChange={(event) => setDisplayNameDraft(event.target.value)}
                                    placeholder={t("layout.changeName")}
                                    className="w-full rounded-lg border border-gray-200 bg-white px-3 py-2 text-sm outline-none focus:border-emerald-400 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-100"
                                />
                                <button
                                    type="button"
                                    onClick={() => void handleSubmitDisplayName()}
                                    disabled={accountEditorBusy}
                                    className="rounded-lg bg-[#2F5C56] px-3 py-2 text-sm font-semibold text-white hover:bg-[#244a45] disabled:opacity-60"
                                >
                                    {accountEditorBusy ? t("common.loading") : t("common.confirm")}
                                </button>
                            </div>
                        </div>
                    )}
                    {accountEditorError && (
                        <div className="text-xs text-rose-600 dark:text-rose-300">{accountEditorError}</div>
                    )}
                    {accountEditorSuccess && (
                        <div className="text-xs text-emerald-600 dark:text-emerald-300">{accountEditorSuccess}</div>
                    )}
                </div>
            </>
        );
    }

    return null;
};

interface DetailProps {
    activeTab: string;
    settingsDetail: string;
    setSettingsDetail: (detail: any) => void;
    setMobileView: (view: "list" | "detail") => void;
    chatReceiveLanguage: string;
    chatReceiveLanguageSaving: boolean;
    translationDefaultView: "translated" | "original" | "bilingual";
    setTranslationDefaultView: (view: "translated" | "original" | "bilingual") => void;
    handleChatReceiveLanguageChange: (value: string) => Promise<void>;
    activePluginSettingsSection: PluginResolvedSlotItem<"settingsSections"> | null;
    runtimeContext: PluginRuntimeContext;
    platformState: PluginPlatformState;
    tools: PluginHostTools;
    returnToMobileList: () => void;
}

export const SettingsAccountDetail: FC<DetailProps> = ({
    activeTab,
    settingsDetail,
    setSettingsDetail,
    setMobileView,
    chatReceiveLanguage,
    chatReceiveLanguageSaving,
    translationDefaultView,
    setTranslationDefaultView,
    handleChatReceiveLanguageChange,
    activePluginSettingsSection,
    runtimeContext,
    platformState,
    tools,
    returnToMobileList,
}) => {
    const { t } = useTranslation();

    if (activeTab !== "settings" && activeTab !== "account") return null;

    return (
        <div className="flex-1 min-h-0 overflow-y-scroll gt-visible-scrollbar flex flex-col bg-white dark:bg-slate-900">
            {activeTab === "settings" && settingsDetail === "chat-language" ? (
                <>
                    <div className="px-6 py-4 text-sm text-slate-400 dark:text-slate-500">
                        {t("layout.selectItem")}
                    </div>
                    <div className="px-6">
                        <div className="flex items-center gap-3 mb-4">
                            <button
                                type="button"
                                onClick={returnToMobileList}
                                className="inline-flex h-9 w-9 items-center justify-center rounded-full border border-gray-200 text-slate-500 hover:text-slate-800 hover:border-emerald-400 dark:border-slate-700 dark:text-slate-300 dark:hover:text-slate-100 lg:hidden"
                                aria-label={t("layout.backToList")}
                            >
                                &lt;
                            </button>
                            <div className="text-sm font-semibold text-slate-800 dark:text-slate-100">
                                {t("layout.chatReceiveLanguage")}
                            </div>
                        </div>
                        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
                            {translationLanguageOptions.map((option) => (
                                <button
                                    key={option.value}
                                    type="button"
                                    disabled={chatReceiveLanguageSaving}
                                    onClick={() => {
                                        if (chatReceiveLanguageSaving || chatReceiveLanguage === option.value) {
                                            return;
                                        }
                                        void handleChatReceiveLanguageChange(option.value);
                                    }}
                                    className={`rounded-lg border px-3 py-2 text-sm text-slate-700 hover:bg-gray-50 disabled:cursor-not-allowed disabled:opacity-60 dark:border-slate-800 dark:text-slate-100 dark:hover:bg-slate-800 ${chatReceiveLanguage === option.value
                                        ? "border-yellow-400 text-yellow-600 dark:text-yellow-300"
                                        : "border-gray-200"
                                        }`}
                                >
                                    {option.label}
                                </button>
                            ))}
                        </div>
                    </div>
                </>
            ) : activeTab === "settings" && settingsDetail === "translation-default" ? (
                <>
                    <div className="px-6 py-4 text-sm text-slate-400 dark:text-slate-500">
                        {t("layout.selectItem")}
                    </div>
                    <div className="px-6">
                        <div className="flex items-center gap-3 mb-4">
                            <button
                                type="button"
                                onClick={() => setMobileView("list")}
                                className="inline-flex h-9 w-9 items-center justify-center rounded-full border border-gray-200 text-slate-500 hover:text-slate-800 hover:border-emerald-400 dark:border-slate-700 dark:text-slate-300 dark:hover:text-slate-100 lg:hidden"
                                aria-label={t("layout.backToList")}
                            >
                                &lt;
                            </button>
                            <div className="text-sm font-semibold text-slate-800 dark:text-slate-100">
                                {t("layout.translationDefaultContent")}
                            </div>
                        </div>
                        <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
                            <button
                                type="button"
                                onClick={() => {
                                    setTranslationDefaultView("translated");
                                    setSettingsDetail("none");
                                    setMobileView("list");
                                }}
                                className={`rounded-lg border px-3 py-2 text-sm ${translationDefaultView === "translated"
                                    ? "border-emerald-400 text-emerald-600"
                                    : "border-gray-200 text-slate-700 hover:bg-gray-50 dark:border-slate-800 dark:text-slate-100 dark:hover:bg-slate-800"
                                    }`}
                            >
                                {t("layout.translationDefaultTranslated")}
                            </button>
                            <button
                                type="button"
                                onClick={() => {
                                    setTranslationDefaultView("bilingual");
                                    setSettingsDetail("none");
                                    setMobileView("list");
                                }}
                                className={`rounded-lg border px-3 py-2 text-sm ${translationDefaultView === "bilingual"
                                    ? "border-emerald-400 text-emerald-600"
                                    : "border-gray-200 text-slate-700 hover:bg-gray-50 dark:border-slate-800 dark:text-slate-100 dark:hover:bg-slate-800"
                                    }`}
                            >
                                {t("layout.translationDefaultBilingual")}
                            </button>
                            <button
                                type="button"
                                onClick={() => {
                                    setTranslationDefaultView("original");
                                    setSettingsDetail("none");
                                    setMobileView("list");
                                }}
                                className={`rounded-lg border px-3 py-2 text-sm ${translationDefaultView === "original"
                                    ? "border-emerald-400 text-emerald-600"
                                    : "border-gray-200 text-slate-700 hover:bg-gray-50 dark:border-slate-800 dark:text-slate-100 dark:hover:bg-slate-800"
                                    }`}
                            >
                                {t("layout.translationDefaultOriginal")}
                            </button>
                        </div>
                    </div>
                </>
            ) : activeTab === "settings" && activePluginSettingsSection ? (
                <>
                    <div className="px-6 py-4 text-sm text-slate-400 dark:text-slate-500">
                        {activePluginSettingsSection.pluginName}
                    </div>
                    <div className="px-6 pb-6">
                        <div className="flex items-center gap-3 mb-4">
                            <button
                                type="button"
                                onClick={() => setMobileView("list")}
                                className="inline-flex h-9 w-9 items-center justify-center rounded-full border border-gray-200 text-slate-500 hover:text-slate-800 hover:border-emerald-400 dark:border-slate-700 dark:text-slate-300 dark:hover:text-slate-100 lg:hidden"
                                aria-label={t("layout.backToList")}
                            >
                                &lt;
                            </button>
                            <div>
                                <div className="text-sm font-semibold text-slate-800 dark:text-slate-100">
                                    {activePluginSettingsSection.label}
                                </div>
                                {activePluginSettingsSection.description && (
                                    <div className="text-xs text-slate-500 dark:text-slate-400">
                                        {activePluginSettingsSection.description}
                                    </div>
                                )}
                            </div>
                        </div>
                        {activePluginSettingsSection.render?.(runtimeContext, platformState, tools) ?? (
                            <div className="rounded-xl border border-dashed border-slate-300 px-4 py-5 text-sm text-slate-500 dark:border-slate-700 dark:text-slate-400">
                                This plugin section has no UI yet.
                            </div>
                        )}
                    </div>
                </>
            ) : (
                <div className="flex-1 flex items-center justify-center text-slate-400 dark:text-slate-500">
                    {t("layout.selectItem")}
                </div>
            )}
        </div>
    );
};
