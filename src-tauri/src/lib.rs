use std::{thread, time::Duration};

use serde::{Deserialize, Serialize};
use tauri::AppHandle;
use tauri_plugin_log::{RotationStrategy, TimezoneStrategy};
use tauri_plugin_sql::{Migration, MigrationKind};
use tauri_plugin_updater::UpdaterExt;
use url::Url;

#[derive(Clone)]
struct UpdaterRuntimeConfig {
  endpoints: Vec<Url>,
  pubkey: String,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct DesktopUpdaterStatus {
  enabled: bool,
  current_version: String,
  reason: Option<String>,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct DesktopUpdateCheck {
  available: bool,
  current_version: String,
  version: Option<String>,
  notes: Option<String>,
}

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
  body: String,
}

fn current_version(app: &AppHandle) -> String {
  app.package_info().version.to_string()
}

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
    .text()
    .await
    .map_err(|error| format!("failed to read desktop http response body: {error}"))?;

  Ok(DesktopHttpResponse { status, headers, body })
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
  let log_level = if cfg!(debug_assertions) {
    log::LevelFilter::Debug
  } else {
    log::LevelFilter::Info
  };

  tauri::Builder::default()
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
        .build(),
    )
    .plugin(tauri_plugin_http::init())
    .plugin(tauri_plugin_updater::Builder::new().build())
    .invoke_handler(tauri::generate_handler![
      desktop_http_request,
      desktop_updater_status,
      desktop_check_for_updates,
      desktop_install_update
    ])
    .run(tauri::generate_context!())
    .expect("error while running tauri application");
}
