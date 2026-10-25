mod stamp;

use std::{fs, io::Write, path::Path};

use tauri::ipc::Response;

/// Read a file from disk and return its raw bytes to the webview.
#[tauri::command]
fn read_file(path: String) -> Result<Response, String> {
    fs::read(&path)
        .map(Response::new)
        .map_err(|e| format!("Could not read {path}: {e}"))
}

/// Write `bytes` to `dest` via a temp file in the same directory and an atomic
/// rename, so a failure part-way never corrupts an existing file.
fn write_atomically(dest: &Path, bytes: &[u8]) -> Result<(), String> {
    let dir = dest.parent().filter(|d| !d.as_os_str().is_empty()).unwrap_or(Path::new("."));
    let name = dest.file_name().ok_or("Invalid destination path.")?.to_string_lossy();
    let tmp = dir.join(format!(".{name}.pdf-signer.tmp"));

    let result = (|| -> std::io::Result<()> {
        let mut file = fs::File::create(&tmp)?;
        file.write_all(bytes)?;
        file.sync_all()?;
        // Overwriting keeps the original file's permissions.
        if let Ok(meta) = fs::metadata(dest) {
            fs::set_permissions(&tmp, meta.permissions())?;
        }
        fs::rename(&tmp, dest)
    })();
    result.map_err(|e| {
        let _ = fs::remove_file(&tmp);
        format!("Could not save {}: {e}", dest.display())
    })
}

/// Stamp signatures into `source_path` and write the result to `dest_path`
/// (which may equal `source_path` to overwrite).
#[tauri::command]
fn save_stamped_pdf(
    source_path: String,
    dest_path: String,
    stamps: Vec<stamp::Stamp>,
) -> Result<(), String> {
    let pdf = fs::read(&source_path).map_err(|e| format!("Could not read {source_path}: {e}"))?;
    let stamped = stamp::stamp_pdf(&pdf, &stamps)?;
    write_atomically(Path::new(&dest_path), &stamped)
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_dialog::init())
        .invoke_handler(tauri::generate_handler![read_file, save_stamped_pdf])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}

#[cfg(test)]
mod tests {
    use super::*;

    fn temp_dir(tag: &str) -> std::path::PathBuf {
        let dir = std::env::temp_dir().join(format!("pdf-signer-{tag}-{}", std::process::id()));
        fs::create_dir_all(&dir).unwrap();
        dir
    }

    #[test]
    fn atomic_write_replaces_file_and_leaves_no_temp() {
        let dir = temp_dir("replace");
        let dest = dir.join("doc.pdf");
        fs::write(&dest, b"old").unwrap();
        write_atomically(&dest, b"new").unwrap();
        assert_eq!(fs::read(&dest).unwrap(), b"new");
        assert_eq!(fs::read_dir(&dir).unwrap().count(), 1, "temp file must be gone");
        fs::remove_dir_all(&dir).unwrap();
    }

    #[test]
    fn failed_write_keeps_the_original() {
        let dir = temp_dir("fail");
        let dest = dir.join("doc.pdf");
        fs::write(&dest, b"original").unwrap();
        // A directory squatting on the temp name makes File::create fail.
        fs::create_dir(dir.join(".doc.pdf.pdf-signer.tmp")).unwrap();
        assert!(write_atomically(&dest, b"new").is_err());
        assert_eq!(fs::read(&dest).unwrap(), b"original");
        fs::remove_dir_all(&dir).unwrap();
    }
}
