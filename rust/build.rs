fn main() {
    let mut res = winres::WindowsResource::new();
    res.set("ProductName", "Jade EC查看器");
    res.set("FileDescription", "Jade EC Launcher");
    res.set("CompanyName", "Jade");
    res.set("LegalCopyright", "Copyright (C) Jade");
    res.compile().expect("Failed to compile resource");
}
