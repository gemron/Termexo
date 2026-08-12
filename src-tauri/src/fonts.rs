//! System font enumeration for the terminal font picker.
//!
//! The picker offers every installed family rather than a hard-coded preset list, so the names it
//! shows have to come from the platform. DirectWrite is the source Windows itself uses to resolve
//! a CSS `font-family`, which makes its family names exactly the strings the terminal can apply —
//! the font registry, by contrast, stores per-face full names like `Consolas Bold (TrueType)`.

use serde::Serialize;

/// A family the terminal can be pointed at, plus the hint the picker sorts by.
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SystemFont {
    pub name: String,
    /// Monospaced families are the ones a terminal can render without column drift.
    pub monospaced: bool,
}

/// Vertical-writing CJK aliases are duplicates of their upright family and unusable in a terminal.
const VERTICAL_FAMILY_PREFIX: char = '@';

/// Rejects names that could not survive being quoted into the terminal's CSS font stack.
///
/// Mirrors `normalizeTerminalFontName` in the frontend: listing a family the picker would refuse
/// to apply is worse than omitting it.
fn is_usable_family_name(name: &str) -> bool {
    !name.is_empty()
        && !name.starts_with(VERTICAL_FAMILY_PREFIX)
        && !name.contains(['"', ',', ';'])
        && !name.chars().any(char::is_control)
}

/// Lists the installed families once, sorted case-insensitively with duplicates collapsed.
pub fn list_system_fonts() -> Result<Vec<SystemFont>, String> {
    let mut fonts: Vec<SystemFont> = platform::enumerate()?
        .into_iter()
        .filter(|font| is_usable_family_name(&font.name))
        .collect();
    fonts.sort_by(|left, right| {
        left.name
            .to_lowercase()
            .cmp(&right.name.to_lowercase())
            .then_with(|| left.name.cmp(&right.name))
    });
    fonts.dedup_by(|left, right| left.name.eq_ignore_ascii_case(&right.name));
    Ok(fonts)
}

#[cfg(windows)]
mod platform {
    use super::SystemFont;

    use windows::core::{w, Interface, BOOL, PCWSTR};
    use windows::Win32::Graphics::DirectWrite::{
        DWriteCreateFactory, IDWriteFactory, IDWriteFont1, IDWriteFontCollection,
        IDWriteFontFamily, DWRITE_FACTORY_TYPE_SHARED, DWRITE_FONT_STRETCH_NORMAL,
        DWRITE_FONT_STYLE_NORMAL, DWRITE_FONT_WEIGHT_NORMAL,
    };

    /// DirectWrite keeps a translation of every family name per locale; the en-us variant is the
    /// one that also works as a CSS family name, which is what the terminal ultimately applies.
    const PREFERRED_LOCALE: PCWSTR = w!("en-us");

    pub fn enumerate() -> Result<Vec<SystemFont>, String> {
        // SAFETY: every call below is a plain COM call on an interface DirectWrite just handed
        // back, and each pointer passed in is a live local.
        unsafe {
            let factory: IDWriteFactory = DWriteCreateFactory(DWRITE_FACTORY_TYPE_SHARED)
                .map_err(|error| format!("无法初始化系统字体服务：{error}"))?;

            let mut collection: Option<IDWriteFontCollection> = None;
            factory
                .GetSystemFontCollection(&mut collection, false)
                .map_err(|error| format!("无法读取系统字体列表：{error}"))?;
            let collection = collection.ok_or_else(|| "系统未返回任何字体。".to_string())?;

            let count = collection.GetFontFamilyCount();
            let mut fonts = Vec::with_capacity(count as usize);
            for index in 0..count {
                // One unreadable family must not cost the user the whole list.
                let Ok(family) = collection.GetFontFamily(index) else {
                    continue;
                };
                let Some(name) = family_name(&family) else {
                    continue;
                };
                fonts.push(SystemFont {
                    name,
                    monospaced: is_monospaced(&family),
                });
            }
            Ok(fonts)
        }
    }

    unsafe fn family_name(family: &IDWriteFontFamily) -> Option<String> {
        let names = family.GetFamilyNames().ok()?;
        let mut index = 0u32;
        let mut exists = BOOL::default();
        // A missing en-us translation is normal for CJK-only families; index 0 is the font's own
        // preferred name, which Windows resolves just as well.
        if names
            .FindLocaleName(PREFERRED_LOCALE, &mut index, &mut exists)
            .is_err()
            || !exists.as_bool()
        {
            index = 0;
        }

        let length = names.GetStringLength(index).ok()? as usize;
        // GetString writes a trailing NUL that the returned length does not count.
        let mut buffer = vec![0u16; length + 1];
        names.GetString(index, &mut buffer).ok()?;
        let name = String::from_utf16_lossy(&buffer[..length]);
        let trimmed = name.trim();
        (!trimmed.is_empty()).then(|| trimmed.to_string())
    }

    /// Reports whether the family's regular face is monospaced.
    ///
    /// `IsMonospacedFont` is a per-face flag, and the regular face is the one the terminal renders
    /// most of the time, so it stands in for the family.
    unsafe fn is_monospaced(family: &IDWriteFontFamily) -> bool {
        family
            .GetFirstMatchingFont(
                DWRITE_FONT_WEIGHT_NORMAL,
                DWRITE_FONT_STRETCH_NORMAL,
                DWRITE_FONT_STYLE_NORMAL,
            )
            .ok()
            .and_then(|font| font.cast::<IDWriteFont1>().ok())
            .is_some_and(|font| font.IsMonospacedFont().as_bool())
    }
}

#[cfg(not(windows))]
mod platform {
    use super::SystemFont;

    pub fn enumerate() -> Result<Vec<SystemFont>, String> {
        Ok(Vec::new())
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    /// The picker reads these exact keys off the IPC reply, so the field names are part of the API.
    #[test]
    fn serializes_the_shape_the_picker_reads() {
        let font = SystemFont {
            name: "Cascadia Mono".into(),
            monospaced: true,
        };

        assert_eq!(
            serde_json::to_string(&font).expect("SystemFont should serialize"),
            r#"{"name":"Cascadia Mono","monospaced":true}"#
        );
    }

    #[test]
    fn rejects_names_that_would_break_the_css_font_stack() {
        assert!(is_usable_family_name("Cascadia Mono"));
        assert!(is_usable_family_name("微软雅黑"));
        assert!(!is_usable_family_name(""));
        assert!(!is_usable_family_name("@SimSun"));
        assert!(!is_usable_family_name("Bad\"Font"));
        assert!(!is_usable_family_name("Consolas, monospace"));
        assert!(!is_usable_family_name("Bad\nFont"));
    }

    #[cfg(windows)]
    #[test]
    fn lists_installed_families_sorted_without_duplicates() {
        let fonts = list_system_fonts().expect("system font enumeration should succeed");

        let names: Vec<String> = fonts.iter().map(|font| font.name.to_lowercase()).collect();
        let mut sorted = names.clone();
        sorted.sort();
        sorted.dedup();
        assert_eq!(names, sorted);

        // Consolas ships with every supported Windows build and is the terminal's own default,
        // so its absence means enumeration failed rather than that the machine lacks fonts.
        assert!(names.contains(&"consolas".to_string()));
        assert!(fonts
            .iter()
            .any(|font| font.name == "Consolas" && font.monospaced));
        assert!(fonts.iter().any(|font| !font.monospaced));
    }
}
