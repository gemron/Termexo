//! First-start administrator creation and the `admin reset-password` subcommand.

use crate::audit::{self, action, target, AuditEntry};
use crate::auth::password::{generate_password, hash_password};
use crate::config::{ResetPasswordArgs, DEFAULT_ADMIN_USERNAME};
use crate::db::{Database, UserRole, UserUpdate};

/// Creates the first administrator when the database has no accounts at all.
pub fn ensure_admin_exists(database: &Database) -> Result<(), String> {
    let count = database
        .count_users()
        .map_err(|error| format!("无法读取用户表：{error}"))?;
    if count > 0 {
        return Ok(());
    }

    let password = generate_password()?;
    let hash = hash_password(&password)?;
    let user = database
        .create_user(DEFAULT_ADMIN_USERNAME, &hash, UserRole::Admin)
        .map_err(|error| format!("无法创建管理员账号：{error}"))?;
    audit::record(
        database,
        AuditEntry::by_system(action::BOOTSTRAP_ADMIN)
            .target(target::USER, &user.id)
            .detail("username", DEFAULT_ADMIN_USERNAME),
    );
    announce_password(DEFAULT_ADMIN_USERNAME, &password);
    Ok(())
}

/// Replaces one account's password with a fresh random one and prints it.
pub fn reset_password(args: &ResetPasswordArgs) -> Result<(), String> {
    let database =
        Database::open(&args.data_dir).map_err(|error| format!("无法打开中继数据库：{error}"))?;
    let user = database
        .find_user_by_username(&args.username)
        .map_err(|error| format!("无法查询用户：{error}"))?
        .ok_or_else(|| format!("用户 {} 不存在。", args.username))?;

    let password = generate_password()?;
    let hash = hash_password(&password)?;
    database
        .update_user(
            &user.id,
            &UserUpdate {
                password_hash: Some(hash),
                ..Default::default()
            },
        )
        .map_err(|error| format!("无法更新密码：{error}"))?;
    // Whoever knew the old password may still hold a session; resetting has to end those too.
    if let Err(error) = database.delete_sessions_of_user(&user.id) {
        tracing::warn!(%error, "无法清除该账号的控制台会话");
    }
    audit::record(
        &database,
        AuditEntry::by_system(action::USER_UPDATED)
            .target(target::USER, &user.id)
            .detail("change", "password-reset"),
    );
    announce_password(&user.username, &password);
    Ok(())
}

/// Writes a generated password to the terminal.
///
/// This is the one place the relay prints a secret, and it has to: there is no other channel to the
/// operator on a first start. It goes to stdout rather than through `tracing` so that a relay run
/// with structured logging into a collector does not ship the password along with them.
fn announce_password(username: &str, password: &str) {
    println!("────────────────────────────────────────────");
    println!("控制台账号：{username}");
    println!("一次性密码：{password}");
    println!("请立即登录 /console/ 并修改密码，这条信息只显示一次。");
    println!("────────────────────────────────────────────");
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::auth::password::verify_password;
    use crate::db::AuditQuery;

    #[test]
    fn the_first_start_creates_exactly_one_administrator() {
        let database = Database::open_in_memory().expect("the database should open");

        ensure_admin_exists(&database).expect("the bootstrap should run");
        ensure_admin_exists(&database).expect("a second start should change nothing");

        let users = database.list_users().expect("a list");
        assert_eq!(users.len(), 1);
        assert_eq!(users[0].username, DEFAULT_ADMIN_USERNAME);
        assert_eq!(users[0].role, UserRole::Admin);
        assert!(!verify_password("", &users[0].password_hash));
    }

    #[test]
    fn the_bootstrap_is_audited_without_the_password() {
        let database = Database::open_in_memory().expect("the database should open");

        ensure_admin_exists(&database).expect("the bootstrap should run");

        let events = database
            .list_audit(&AuditQuery {
                limit: 10,
                ..AuditQuery::default()
            })
            .expect("a list");
        assert_eq!(events.len(), 1);
        assert_eq!(events[0].action, action::BOOTSTRAP_ADMIN);
        assert_eq!(events[0].actor_kind, "system");
        assert_eq!(events[0].detail.as_deref(), Some(r#"{"username":"admin"}"#));
    }

    #[test]
    fn an_existing_account_suppresses_the_bootstrap() {
        let database = Database::open_in_memory().expect("the database should open");
        database
            .create_user("alice", "hash", UserRole::User)
            .expect("a user");

        ensure_admin_exists(&database).expect("the bootstrap should run");

        assert_eq!(database.count_users().expect("a count"), 1);
        assert!(database
            .find_user_by_username(DEFAULT_ADMIN_USERNAME)
            .expect("the lookup should work")
            .is_none());
    }
}
