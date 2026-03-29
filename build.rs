fn main() {
    #[cfg(target_os = "windows")]
    {
        if std::path::Path::new("icon.ico").exists() {
            let mut res = winresource::WindowsResource::new();
            res.set_icon("icon.ico");
            res.compile().expect("Failed to compile Windows resources");
        }
    }
}
