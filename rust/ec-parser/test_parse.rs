use std::ffi::CString;

#[link(name = "ec_parser")]
extern "system" {
    fn parse_ec_to_json(path: *const std::os::raw::c_char, password: *const std::os::raw::c_char) -> *mut std::os::raw::c_char;
    fn free_ec_string(s: *mut std::os::raw::c_char);
}

fn main() {
    let args: Vec<String> = std::env::args().collect();
    if args.len() < 2 {
        eprintln!("用法: {} <ec文件路径>", args[0]);
        return;
    }

    let path = CString::new(args[1].as_str()).expect("路径转换失败");
    
    unsafe {
        let result = parse_ec_to_json(path.as_ptr(), std::ptr::null());
        if !result.is_null() {
            let c_str = std::ffi::CStr::from_ptr(result);
            let json = c_str.to_string_lossy();
            println!("{}", json);
            free_ec_string(result);
        }
    }
}
