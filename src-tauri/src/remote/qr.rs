use qrcode::types::Color;
use qrcode::QrCode;
use serde::Serialize;

/// A QR code as a single SVG path plus the module grid it is drawn on.
///
/// The frontend renders it as `<svg viewBox="0 0 size size"><path [attr.d]>`, so nothing has to go
/// through `innerHTML` and the backend never has to agree with the UI on colors or quiet zone.
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct QrCodeImage {
    pub path: String,
    pub size: u32,
}

pub fn render(data: &str) -> Result<QrCodeImage, String> {
    if data.is_empty() {
        return Err("二维码内容不能为空。".into());
    }
    let code = QrCode::new(data).map_err(|error| format!("无法生成二维码：{error}"))?;
    let width = code.width();
    let modules: Vec<bool> = code
        .to_colors()
        .into_iter()
        .map(|color| color == Color::Dark)
        .collect();

    Ok(QrCodeImage {
        path: build_path(&modules, width),
        size: width as u32,
    })
}

/// Draws each horizontal run of dark modules as one sub-path.
///
/// Emitting a rectangle per module would roughly quadruple the attribute a phone has to parse for
/// a URL-sized code, and runs are trivial to produce while scanning rows anyway.
fn build_path(modules: &[bool], width: usize) -> String {
    let mut path = String::new();
    for row in 0..width {
        let mut column = 0;
        while column < width {
            let index = row * width + column;
            if !modules.get(index).copied().unwrap_or(false) {
                column += 1;
                continue;
            }
            let start = column;
            while column < width && modules.get(row * width + column).copied().unwrap_or(false) {
                column += 1;
            }
            let run = column - start;
            path.push_str(&format!("M{start} {row}h{run}v1h-{run}z"));
        }
    }
    path
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn merges_adjacent_dark_modules_into_one_run() {
        let modules = [
            true, true, false, //
            false, true, false, //
            false, false, false,
        ];

        assert_eq!(build_path(&modules, 3), "M0 0h2v1h-2zM1 1h1v1h-1z");
    }

    #[test]
    fn an_empty_grid_produces_an_empty_path() {
        assert_eq!(build_path(&[false, false, false, false], 2), "");
    }

    #[test]
    fn renders_a_square_grid_whose_path_stays_inside_the_view_box() {
        let image =
            render("https://192.168.1.20:7420/#token=abc").expect("a QR code should render");

        assert!(image.size >= 21 && image.size % 4 == 1);
        assert!(image.path.starts_with('M'));
        assert!(image.path.ends_with('z'));
        assert_eq!(
            image.path.matches('M').count(),
            image.path.matches('z').count()
        );
    }

    #[test]
    fn empty_content_is_rejected_instead_of_producing_an_unscannable_code() {
        assert!(render("").is_err());
    }
}
