// The Tauri app is a thin native shell around the existing client-side web app
// (the Vite build in ../dist). No custom commands yet — it just hosts the
// frontend in a desktop window.
#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
