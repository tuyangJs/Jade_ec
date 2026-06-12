#![windows_subsystem = "windows"]

use std::mem::MaybeUninit;
use std::os::windows::ffi::OsStringExt;
use std::os::windows::process::CommandExt;
use std::process::Command;
use std::ptr;
use windows_sys::Win32::Foundation::*;
use windows_sys::Win32::System::Registry::*;

const CREATE_NO_WINDOW: u32 = 0x08000000;

fn main() {
    let install_path = match read_registry_install_path() {
        Ok(p) => p,
        Err(_) => return,
    };

    let exe_path = std::path::Path::new(&install_path).join("Jade_ec.exe");
    if !exe_path.exists() {
        return;
    }

    let args: Vec<String> = std::env::args()
        .skip(1)
        .filter(|a| a.to_lowercase().ends_with(".ec"))
        .collect();
    if args.is_empty() {
        return;
    }

    let _ = Command::new(&exe_path)
        .args(&args)
        .creation_flags(CREATE_NO_WINDOW)
        .spawn();
}

fn read_registry_install_path() -> Result<String, ()> {
    let subkey: Vec<u16> = "Software\\Jade EC\u{67e5}\u{770b}\u{5668}\0"
        .encode_utf16()
        .collect();

    let mut hkey = MaybeUninit::uninit();
    let err = unsafe {
        RegOpenKeyExW(
            HKEY_CURRENT_USER,
            subkey.as_ptr(),
            0,
            KEY_READ,
            hkey.as_mut_ptr(),
        )
    };
    if err != ERROR_SUCCESS {
        return Err(());
    }
    let hkey = unsafe { hkey.assume_init() };

    let mut buf_len: u32 = 512;
    let mut buf = vec![0u16; buf_len as usize / 2];

    let err = unsafe {
        RegQueryValueExW(
            hkey,
            ptr::null(),
            ptr::null_mut(),
            ptr::null_mut(),
            buf.as_mut_ptr() as *mut u8,
            &mut buf_len,
        )
    };

    unsafe { RegCloseKey(hkey) };

    if err != ERROR_SUCCESS {
        return Err(());
    }

    let len = (buf_len / 2) as usize;
    let s = std::ffi::OsString::from_wide(unsafe { std::slice::from_raw_parts(buf.as_ptr(), len) });
    let path = s.into_string().map_err(|_| ())?;
    Ok(path.trim_end_matches('\0').to_string())
}
