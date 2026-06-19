use std::ffi::{CStr, CString};
use std::os::raw::{c_char, c_int};
use std::panic::catch_unwind;
use std::fs;
use md5::{Md5, Digest};
use crate::parser;
use crate::crypto;

/// Read file from path, return data or error
/// Path encoding: try UTF-8 first (standard), fallback to GBK (Easy Language ANSI)
fn read_file(path: *const c_char) -> Result<Vec<u8>, String> {
    if path.is_null() {
        return Err("文件路径为空".to_string());
    }
    let c_str = unsafe { CStr::from_ptr(path) };
    let bytes = c_str.to_bytes();
    // Try UTF-8 first (most callers use UTF-8), then GBK (Easy Language ANSI)
    let file_path = match std::str::from_utf8(bytes) {
        Ok(s) => s.to_string(),
        Err(_) => {
            let (cow, _, _) = encoding_rs::GBK.decode(bytes);
            cow.into_owned()
        }
    };
    fs::read(&file_path).map_err(|e| format!("读取文件失败: {}", e))
}

/// Check if EC module is encrypted
/// path: null-terminated file path string
/// Returns 1 if encrypted, 0 if not, -1 on error
#[unsafe(no_mangle)]
pub extern "system" fn is_ec_encrypted(path: *const c_char) -> c_int {
    match read_file(path) {
        Ok(data) => {
            if crypto::is_ec_encrypted(&data) { 1 } else { 0 }
        }
        Err(_) => -1,
    }
}

/// Get the prompt info from an encrypted EC module
/// path: null-terminated file path string
/// Returns the prompt text as a plain string, or empty string on error
#[unsafe(no_mangle)]
pub extern "system" fn get_ec_prompt_info(path: *const c_char) -> *mut c_char {
    match read_file(path) {
        Ok(data) => {
            let prompt = crypto::get_ec_prompt_info(&data).unwrap_or_default();
            CString::new(prompt).unwrap_or_else(|_| CString::new("").unwrap()).into_raw()
        }
        Err(_) => CString::new("").unwrap().into_raw(),
    }
}

/// Parse an EC module file and return the result as JSON
/// path: null-terminated file path string
/// password: null-terminated C string, or null pointer for no password
/// Returns a JSON string. Caller must free with free_ec_string.
#[unsafe(no_mangle)]
pub extern "system" fn parse_ec_to_json(path: *const c_char, password: *const c_char) -> *mut c_char {
    let data = match read_file(path) {
        Ok(d) => d,
        Err(e) => {
            let json = format!(r#"{{"error":"{}"}}"#, e);
            return CString::new(json).unwrap_or_default().into_raw();
        }
    };

    // Parse password as raw bytes (E language uses ANSI/GBK encoding, not UTF-8)
    let password_bytes: Option<Vec<u8>> = if password.is_null() {
        None
    } else {
        let c_str = unsafe { CStr::from_ptr(password) };
        let bytes = c_str.to_bytes();
        if bytes.is_empty() {
            None
        } else {
            Some(bytes.to_vec())
        }
    };

    // Use catch_unwind to prevent crashes from propagating
    let result = catch_unwind(std::panic::AssertUnwindSafe(|| {
        let parse_data: Vec<u8>;
        let decrypt_mode;
        let parse_result = if crypto::is_ec_encrypted(&data) {
            // Encrypted module - try to decrypt with provided password
            match &password_bytes {
                Some(pw) => {
                    match crypto::decrypt_module(&data, pw) {
                        Ok(decrypted) => {
                            parse_data = decrypted;
                            decrypt_mode = true;
                            parser::parse_ec(&parse_data, decrypt_mode)
                        }
                        Err(e) => Err(e),
                    }
                }
                None => Err("模块已加密，需要提供密码".to_string()),
            }
        } else {
            decrypt_mode = false;
            parser::parse_ec(&data, decrypt_mode)
        };

        match parse_result {
            Ok(ec_module) => {
                match serde_json::to_string(&ec_module) {
                    Ok(json) => json,
                    Err(_) => "{}".to_string(),
                }
            }
            Err(_) => "{}".to_string(),
        }
    }));

    let json = match result {
        Ok(s) => s,
        Err(_) => "{}".to_string(),
    };

    // Ensure no null bytes in JSON string (CString requires no interior nulls)
    let json_clean: String = json.chars().filter(|c| *c != '\0').collect();
    CString::new(json_clean).unwrap_or_else(|_| CString::new("{}").unwrap()).into_raw()
}

/// Free a string previously returned by get_ec_prompt_info or parse_ec_to_json
#[unsafe(no_mangle)]
pub extern "system" fn free_ec_string(s: *mut c_char) {
    if !s.is_null() {
        unsafe { drop(CString::from_raw(s)); }
    }
}

/// Compute MD5 hash of a file
/// path: null-terminated file path string
/// Returns hex MD5 string. Caller must free with free_ec_string.
#[unsafe(no_mangle)]
pub extern "system" fn get_file_md5(path: *const c_char) -> *mut c_char {
    match read_file(path) {
        Ok(data) => {
            let mut hasher = Md5::new();
            hasher.update(&data);
            let result = hasher.finalize();
            let hex = format!("{:x}", result);
            CString::new(hex).unwrap_or_else(|_| CString::new("").unwrap()).into_raw()
        }
        Err(_) => CString::new("").unwrap().into_raw(),
    }
}
