import { useTranslation } from "react-i18next";

import "./MainLayout.css";

export function MainLayout() {
    const { t } = useTranslation();

    return (
        <div className="gt_main">
            <aside className="gt_sidebar">
                <div className="gt_sidebarHeader">
                    <div className="gt_sidebarTitle">{t("main.sidebar.title")}</div>
                    <button type="button" className="gt_sidebarAction">
                        {t("main.sidebar.newChat")}
                    </button>
                </div>
                <div className="gt_sidebarSection">
                    <div className="gt_sidebarSectionTitle">{t("main.sidebar.rooms")}</div>
                    <div className="gt_sidebarEmpty">{t("main.sidebar.empty")}</div>
                </div>
                <div className="gt_sidebarFooter">
                    <button type="button" className="gt_sidebarFooterButton">
                        {t("main.sidebar.settings")}
                    </button>
                </div>
            </aside>
            <section className="gt_chat">
                <div className="gt_chatHeader">
                    <div className="gt_chatTitle">{t("main.chat.title")}</div>
                    <div className="gt_chatSubtitle">{t("main.chat.subtitle")}</div>
                </div>
                <div className="gt_chatBody">
                    <div className="gt_chatEmpty">{t("main.chat.empty")}</div>
                </div>
                <div className="gt_chatComposer">
                    <input
                        type="text"
                        className="gt_chatInput"
                        placeholder={t("main.chat.placeholder")}
                        disabled
                    />
                    <button type="button" className="gt_chatSend" disabled>
                        {t("main.chat.send")}
                    </button>
                </div>
            </section>
        </div>
    );
}
