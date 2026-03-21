#[cfg(not(any(target_os = "ios", target_os = "android")))]
use std::{thread, time::Duration};

use base64::{engine::general_purpose::STANDARD as BASE64_STANDARD, Engine as _};
use serde::{Deserialize, Serialize};
use tauri::AppHandle;
#[cfg(not(any(target_os = "ios", target_os = "android")))]
use tauri::{
  menu::{MenuBuilder, MenuItemBuilder},
  tray::{MouseButton, MouseButtonState, TrayIconBuilder, TrayIconEvent},
  Manager, WebviewWindow, WindowEvent,
};
#[cfg(target_os = "macos")]
use tauri::RunEvent;
use tauri_plugin_log::{RotationStrategy, TimezoneStrategy};
use tauri_plugin_sql::{Migration, MigrationKind};
#[cfg(not(any(target_os = "ios", target_os = "android")))]
use tauri_plugin_updater::UpdaterExt;
#[cfg(not(any(target_os = "ios", target_os = "android")))]
use url::Url;

#[cfg(not(any(target_os = "ios", target_os = "android")))]
#[derive(Clone)]
struct UpdaterRuntimeConfig {
  endpoints: Vec<Url>,
  pubkey: String,
}

#[cfg(not(any(target_os = "ios", target_os = "android")))]
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct DesktopUpdaterStatus {
  enabled: bool,
  current_version: String,
  reason: Option<String>,
}

#[cfg(not(any(target_os = "ios", target_os = "android")))]
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct DesktopUpdateCheck {
  available: bool,
  current_version: String,
  version: Option<String>,
  notes: Option<String>,
}

#[cfg(not(any(target_os = "ios", target_os = "android")))]
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct DesktopInstallResult {
  installed: bool,
  version: Option<String>,
  restart_scheduled: bool,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct DesktopHttpRequest {
  url: String,
  method: Option<String>,
  headers: Option<Vec<(String, String)>>,
  body: Option<String>,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct DesktopHttpResponse {
  status: u16,
  headers: Vec<(String, String)>,
  body_base64: String,
}

#[cfg(not(any(target_os = "ios", target_os = "android")))]
fn current_version(app: &AppHandle) -> String {
  app.package_info().version.to_string()
}

#[cfg(not(any(target_os = "ios", target_os = "android")))]
fn show_main_window(window: &WebviewWindow) {
  let _ = window.unminimize();
  let _ = window.show();
  let _ = window.set_focus();
}

#[cfg(not(any(target_os = "ios", target_os = "android")))]
fn hide_main_window(window: &WebviewWindow) {
  let _ = window.hide();
}

#[cfg(not(any(target_os = "ios", target_os = "android")))]
fn reveal_primary_instance(app: &AppHandle) {
  if let Some(splash_window) = app.get_webview_window("splashscreen") {
    let _ = splash_window.close();
  }

  if let Some(main_window) = app.get_webview_window("main") {
    show_main_window(&main_window);
  }
}

#[tauri::command]
fn desktop_boot_ready(app: AppHandle) -> Result<(), String> {
  #[cfg(any(target_os = "ios", target_os = "android"))]
  {
    let _ = app;
    return Ok(());
  }

  #[cfg(not(any(target_os = "ios", target_os = "android")))]
  {
  let main_window = app
    .get_webview_window("main")
    .ok_or_else(|| "main window is unavailable".to_string())?;

  if let Some(splash_window) = app.get_webview_window("splashscreen") {
    let _ = splash_window.close();
  }

  show_main_window(&main_window);
  Ok(())
  }
}

#[cfg(not(any(target_os = "ios", target_os = "android")))]
fn updater_runtime_config() -> Result<Option<UpdaterRuntimeConfig>, String> {
  let pubkey = option_env!("TAURI_UPDATER_PUBKEY")
    .map(str::trim)
    .filter(|value| !value.is_empty());
  let endpoints = option_env!("TAURI_UPDATER_ENDPOINTS")
    .map(str::trim)
    .filter(|value| !value.is_empty());

  match (pubkey, endpoints) {
    (None, None) => Ok(None),
    (Some(_), None) | (None, Some(_)) => Err(
      "TAURI_UPDATER_PUBKEY and TAURI_UPDATER_ENDPOINTS must be provided together".into(),
    ),
    (Some(pubkey), Some(endpoints)) => {
      let parsed_endpoints = endpoints
        .split(',')
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .map(|value| value.parse::<Url>().map_err(|error| format!("invalid updater endpoint '{value}': {error}")))
        .collect::<Result<Vec<_>, _>>()?;

      if parsed_endpoints.is_empty() {
        return Err("TAURI_UPDATER_ENDPOINTS must contain at least one HTTPS URL".into());
      }

      Ok(Some(UpdaterRuntimeConfig {
        endpoints: parsed_endpoints,
        pubkey: pubkey.to_string(),
      }))
    }
  }
}

#[cfg(not(any(target_os = "ios", target_os = "android")))]
fn build_updater(app: &AppHandle) -> Result<Option<tauri_plugin_updater::Updater>, String> {
  let Some(config) = updater_runtime_config()? else {
    return Ok(None);
  };

  let builder = app.updater_builder().pubkey(config.pubkey);
  let builder = builder
    .endpoints(config.endpoints)
    .map_err(|error| format!("failed to configure updater endpoints: {error}"))?;

  builder
    .build()
    .map(Some)
    .map_err(|error| format!("failed to initialize updater: {error}"))
}

#[cfg(not(any(target_os = "ios", target_os = "android")))]
#[tauri::command]
fn desktop_updater_status(app: AppHandle) -> DesktopUpdaterStatus {
  match updater_runtime_config() {
    Ok(Some(_)) => DesktopUpdaterStatus {
      enabled: true,
      current_version: current_version(&app),
      reason: None,
    },
    Ok(None) => DesktopUpdaterStatus {
      enabled: false,
      current_version: current_version(&app),
      reason: Some("Updater is not configured for this build".into()),
    },
    Err(reason) => DesktopUpdaterStatus {
      enabled: false,
      current_version: current_version(&app),
      reason: Some(reason),
    },
  }
}

#[cfg(not(any(target_os = "ios", target_os = "android")))]
#[tauri::command]
async fn desktop_check_for_updates(app: AppHandle) -> Result<DesktopUpdateCheck, String> {
  let current_version = current_version(&app);
  let Some(updater) = build_updater(&app)? else {
    return Ok(DesktopUpdateCheck {
      available: false,
      current_version,
      version: None,
      notes: None,
    });
  };

  let update = updater
    .check()
    .await
    .map_err(|error| format!("failed to check for updates: {error}"))?;

  Ok(match update {
    Some(update) => DesktopUpdateCheck {
      available: true,
      current_version,
      version: Some(update.version),
      notes: update.body,
    },
    None => DesktopUpdateCheck {
      available: false,
      current_version,
      version: None,
      notes: None,
    },
  })
}

#[cfg(not(any(target_os = "ios", target_os = "android")))]
#[tauri::command]
async fn desktop_install_update(app: AppHandle) -> Result<DesktopInstallResult, String> {
  let Some(updater) = build_updater(&app)? else {
    return Ok(DesktopInstallResult {
      installed: false,
      version: None,
      restart_scheduled: false,
    });
  };

  let update = updater
    .check()
    .await
    .map_err(|error| format!("failed to check for updates before install: {error}"))?;

  let Some(update) = update else {
    return Ok(DesktopInstallResult {
      installed: false,
      version: None,
      restart_scheduled: false,
    });
  };

  let version = update.version.clone();
  update
    .download_and_install(|_, _| {}, || {})
    .await
    .map_err(|error| format!("failed to download and install update: {error}"))?;

  let app_handle = app.clone();
  thread::spawn(move || {
    thread::sleep(Duration::from_millis(800));
    app_handle.request_restart();
    app_handle.exit(0);
  });

  Ok(DesktopInstallResult {
    installed: true,
    version: Some(version),
    restart_scheduled: true,
  })
}

#[tauri::command]
async fn desktop_http_request(input: DesktopHttpRequest) -> Result<DesktopHttpResponse, String> {
  let client = reqwest::Client::builder()
    .use_rustls_tls()
    .build()
    .map_err(|error| format!("failed to build desktop http client: {error}"))?;

  let method = input
    .method
    .as_deref()
    .unwrap_or("GET")
    .parse::<reqwest::Method>()
    .map_err(|error| format!("invalid http method: {error}"))?;

  let mut request = client.request(method, &input.url);

  if let Some(headers) = input.headers {
    for (key, value) in headers {
      request = request.header(&key, value);
    }
  }

  if let Some(body) = input.body {
    request = request.body(body);
  }

  let response = request
    .send()
    .await
    .map_err(|error| format!("desktop http request failed: {error}"))?;

  let status = response.status().as_u16();
  let headers = response
    .headers()
    .iter()
    .map(|(key, value)| {
      (
        key.as_str().to_string(),
        value.to_str().unwrap_or_default().to_string(),
      )
    })
    .collect::<Vec<_>>();
  let body = response
    .bytes()
    .await
    .map_err(|error| format!("failed to read desktop http response body: {error}"))?;
  let body_base64 = BASE64_STANDARD.encode(body);

  Ok(DesktopHttpResponse { status, headers, body_base64 })
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
  let _ = rustls::crypto::ring::default_provider().install_default();

  let log_level = if cfg!(debug_assertions) {
    log::LevelFilter::Debug
  } else {
    log::LevelFilter::Info
  };

  let builder = tauri::Builder::default()
    .plugin(
      tauri_plugin_log::Builder::new()
        .level(log_level)
        .rotation_strategy(RotationStrategy::KeepAll)
        .timezone_strategy(TimezoneStrategy::UseLocal)
        .build(),
    )
    .plugin(
      tauri_plugin_sql::Builder::default()
        .add_migrations(
          "sqlite:notebook-cache.db",
          vec![
            Migration {
              version: 1,
              description: "create_notebook_cache_tables",
              sql: r#"
                CREATE TABLE IF NOT EXISTS notebook_list_cache (
                  cache_namespace TEXT NOT NULL,
                  cache_key TEXT NOT NULL,
                  payload_json TEXT NOT NULL,
                  updated_at INTEGER NOT NULL,
                  PRIMARY KEY (cache_namespace, cache_key)
                );

                CREATE TABLE IF NOT EXISTS notebook_parsed_cache (
                  cache_namespace TEXT NOT NULL,
                  item_id TEXT NOT NULL,
                  preview_json TEXT,
                  chunks_json TEXT NOT NULL,
                  chunks_total INTEGER NOT NULL,
                  error TEXT,
                  updated_at INTEGER NOT NULL,
                  PRIMARY KEY (cache_namespace, item_id)
                );

                CREATE TABLE IF NOT EXISTS notebook_parsed_cache_index (
                  cache_namespace TEXT NOT NULL,
                  item_id TEXT NOT NULL,
                  updated_at INTEGER NOT NULL,
                  PRIMARY KEY (cache_namespace, item_id)
                );
              "#,
              kind: MigrationKind::Up,
            }
          ],
        )
        .add_migrations(
          "sqlite:desktop-cache.db",
          vec![
            Migration {
              version: 1,
              description: "create_desktop_cache_tables",
              sql: r#"
                CREATE TABLE IF NOT EXISTS workspace_state_cache (
                  user_id TEXT PRIMARY KEY NOT NULL,
                  payload_json TEXT NOT NULL,
                  updated_at INTEGER NOT NULL
                );

                CREATE TABLE IF NOT EXISTS room_list_cache (
                  user_id TEXT PRIMARY KEY NOT NULL,
                  payload_json TEXT NOT NULL,
                  updated_at INTEGER NOT NULL
                );

                CREATE TABLE IF NOT EXISTS contacts_cache (
                  user_id TEXT PRIMARY KEY NOT NULL,
                  payload_json TEXT NOT NULL,
                  updated_at INTEGER NOT NULL
                );

                CREATE TABLE IF NOT EXISTS room_timeline_cache (
                  user_id TEXT NOT NULL,
                  room_id TEXT NOT NULL,
                  payload_json TEXT NOT NULL,
                  updated_at INTEGER NOT NULL,
                  PRIMARY KEY (user_id, room_id)
                );
              "#,
              kind: MigrationKind::Up,
            },
            Migration {
              version: 2,
              description: "create_ui_state_cache_table",
              sql: r#"
                CREATE TABLE IF NOT EXISTS ui_state_cache (
                  scope TEXT NOT NULL,
                  item_key TEXT NOT NULL,
                  payload_json TEXT NOT NULL,
                  updated_at INTEGER NOT NULL,
                  PRIMARY KEY (scope, item_key)
                );
              "#,
              kind: MigrationKind::Up,
            },
          ],
        )
        .build(),
    )
    .plugin(tauri_plugin_http::init());

  #[cfg(not(any(target_os = "ios", target_os = "android")))]
  let builder = builder
    .plugin(tauri_plugin_single_instance::init(|app, _argv, _cwd| {
      reveal_primary_instance(app);
    }))
    .setup(|app| {
      let app_handle = app.handle().clone();
      let show_item = MenuItemBuilder::with_id("show", "Open GoTradeTalk").build(app)?;
      let quit_item = MenuItemBuilder::with_id("quit", "Quit").build(app)?;
      let tray_menu = MenuBuilder::new(app)
        .items(&[&show_item, &quit_item])
        .build()?;

      TrayIconBuilder::new()
        .icon(app.default_window_icon().cloned().ok_or_else(|| tauri::Error::AssetNotFound("default window icon not found".into()))?)
        .tooltip("GoTradeTalk")
        .menu(&tray_menu)
        .show_menu_on_left_click(false)
        .on_menu_event(|app, event| match event.id().as_ref() {
          "show" => {
            if let Some(window) = app.get_webview_window("main") {
              show_main_window(&window);
            }
          }
          "quit" => {
            app.exit(0);
          }
          _ => {}
        })
        .on_tray_icon_event(|tray, event| {
          if let TrayIconEvent::Click {
            button: MouseButton::Left,
            button_state: MouseButtonState::Up,
            ..
          } = event
          {
            let app = tray.app_handle();
            if let Some(window) = app.get_webview_window("main") {
              show_main_window(&window);
            }
          }
        })
        .build(app)?;

      if let Some(window) = app.get_webview_window("main") {
        hide_main_window(&window);
      }

      thread::spawn(move || {
        thread::sleep(Duration::from_secs(20));
        reveal_primary_instance(&app_handle);
      });

      Ok(())
    })
    .plugin(tauri_plugin_updater::Builder::new().build())
    .on_window_event(|window, event| {
      if let WindowEvent::CloseRequested { api, .. } = event {
        api.prevent_close();
        let _ = window.hide();
      }
    })
    .invoke_handler(tauri::generate_handler![
      desktop_boot_ready,
      desktop_http_request,
      desktop_updater_status,
      desktop_check_for_updates,
      desktop_install_update
    ]);

  #[cfg(any(target_os = "ios", target_os = "android"))]
  let builder = builder.invoke_handler(tauri::generate_handler![
    desktop_boot_ready,
    desktop_http_request
  ]);

  let app = builder
    .build(tauri::generate_context!())
    .expect("error while building tauri application");

  app.run(|app, event| {
    #[cfg(target_os = "macos")]
    if let RunEvent::Reopen { .. } = event {
      reveal_primary_instance(app);
    }

    #[cfg(not(target_os = "macos"))]
    let _ = (app, event);
  });
}
