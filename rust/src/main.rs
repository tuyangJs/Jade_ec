#![windows_subsystem = "windows"]

use std::mem::MaybeUninit;
use std::os::windows::ffi::OsStringExt;
use std::ptr;
use windows_sys::Win32::Foundation::*;
use windows_sys::Win32::System::Registry::*;
use windows_sys::Win32::System::Threading::*;

const CREATE_NO_WINDOW: u32 = 0x08000000;

fn main() {
    let install_path = match read_registry_install_path() {
        Ok(p) => p,
        Err(_) => return,
    };

    let exe_path = format!("{}\\Jade_ec.exe", &install_path);

    let args: Vec<String> = std::env::args()
        .skip(1)
        .filter(|a| a.to_lowercase().ends_with(".ec"))
        .collect();
    if args.is_empty() {
        return;
    }

    let mut cmd_line = format!("\"{}\"", exe_path);
    for arg in &args {
        cmd_line.push(' ');
        cmd_line.push('"');
        cmd_line.push_str(arg);
        cmd_line.push('"');
    }

    let mut cmd_line_wide: Vec<u16> = cmd_line
        .encode_utf16()
        .chain(std::iter::once(0))
        .collect();

    unsafe {
        let mut si: MaybeUninit<STARTUPINFOW> = MaybeUninit::zeroed();
        (*si.as_mut_ptr()).cb = std::mem::size_of::<STARTUPINFOW>() as u32;
        let mut pi: MaybeUninit<PROCESS_INFORMATION> = MaybeUninit::zeroed();

        CreateProcessW(
            ptr::null(),
            cmd_line_wide.as_mut_ptr(),
            ptr::null(),
            ptr::null(),
            0,
            CREATE_NO_WINDOW,
            ptr::null(),
            ptr::null(),
            si.as_ptr(),
            pi.as_mut_ptr(),
        );

        CloseHandle((*pi.as_ptr()).hProcess);
        CloseHandle((*pi.as_ptr()).hThread);
    }
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
