use std::collections::HashMap;

use tauri::State;

use crate::cli::{
    self, CliOperationManager, CliOperationPlan, CliOperationRequest, CliOperationResult,
};
use crate::config::CredentialStore;
use crate::database::WorkspaceDatabase;
use crate::network;

#[tauri::command]
pub async fn preview_cli_operation(
    request: CliOperationRequest,
    database: State<'_, WorkspaceDatabase>,
) -> Result<CliOperationPlan, String> {
    let network_profile = database
        .find_effective_network_profile(request.workspace_id.as_deref())
        .map_err(|error| error.to_string())?;
    tauri::async_runtime::spawn_blocking(move || {
        cli::build_operation_plan(&request, network_profile.as_ref())
    })
    .await
    .map_err(|error| error.to_string())?
}

#[tauri::command]
pub async fn execute_cli_operation(
    request: CliOperationRequest,
    database: State<'_, WorkspaceDatabase>,
    credentials: State<'_, CredentialStore>,
    manager: State<'_, CliOperationManager>,
) -> Result<CliOperationResult, String> {
    if !request.confirmed {
        return Err("执行安装或升级前必须明确确认。".into());
    }
    if !manager.try_begin() {
        return Err("已有 CLI 安装或升级任务正在运行，请等待完成。".into());
    }

    let result = match prepare_operation(&request, &database, &credentials) {
        Ok((plan, environment)) => {
            tauri::async_runtime::spawn_blocking(move || cli::execute_operation(plan, environment))
                .await
                .map_err(|error| error.to_string())?
        }
        Err(error) => Err(error),
    };
    manager.finish();
    result
}

fn prepare_operation(
    request: &CliOperationRequest,
    database: &WorkspaceDatabase,
    credentials: &CredentialStore,
) -> Result<(CliOperationPlan, HashMap<String, String>), String> {
    let network_profile = database
        .find_effective_network_profile(request.workspace_id.as_deref())
        .map_err(|error| error.to_string())?;
    let password = network_profile
        .as_ref()
        .and_then(|profile| profile.credential_target.as_deref())
        .map(|target| credentials.get(target))
        .transpose()
        .map_err(|error| error.to_string())?;
    let environment = match network_profile.as_ref() {
        Some(profile) => network::profile_environment(profile, password.as_deref())?,
        None => HashMap::new(),
    };
    let plan = cli::build_operation_plan(request, network_profile.as_ref())?;
    Ok((plan, environment))
}
