use md5::{Digest, Md5};
use crate::constants::{ENCRYPTION_MARKER, RC4_INITIAL_SBOX};

/// Check if EC file data is an encrypted module.
/// Two possible encrypted formats:
///   1. File starts with WTLE at offset 0 (fully encrypted, no magic header)
///   2. File starts with CNWT/EPRG magic, then WTLE at offset 8
/// Matches E language: 取字节集左边(TempData, 4) ＝ { 87, 84, 76, 69 }
pub fn is_ec_encrypted(data: &[u8]) -> bool {
    if data.len() < 4 {
        return false;
    }
    let val0 = u32::from_le_bytes([data[0], data[1], data[2], data[3]]);
    if val0 == ENCRYPTION_MARKER {
        return true;
    }
    if data.len() >= 12 {
        let val8 = u32::from_le_bytes([data[8], data[9], data[10], data[11]]);
        if val8 == ENCRYPTION_MARKER {
            return true;
        }
    }
    false
}

/// Get the WTLE marker offset in the data (0 or 8), returns None if not encrypted
fn get_wtle_offset(data: &[u8]) -> Option<usize> {
    if data.len() < 4 {
        return None;
    }
    let val0 = u32::from_le_bytes([data[0], data[1], data[2], data[3]]);
    if val0 == ENCRYPTION_MARKER {
        return Some(0);
    }
    if data.len() >= 12 {
        let val8 = u32::from_le_bytes([data[8], data[9], data[10], data[11]]);
        if val8 == ENCRYPTION_MARKER {
            return Some(8);
        }
    }
    None
}

/// Get the prompt info from an encrypted EC module.
/// Encrypted module structure (1-indexed per E language):
///   [1..4]  = WTLE marker  → 0-indexed [0..4]
///   [9..12] = prompt length → 0-indexed [8..12]
///   [13..]  = prompt text   → 0-indexed [12..]
pub fn get_ec_prompt_info(data: &[u8]) -> Result<String, String> {
    let wtle_offset = get_wtle_offset(data).ok_or("模块未加密")?;
    // 提示文本长度在 WTLE + 8, 提示文本在 WTLE + 12
    let len_offset = wtle_offset + 8;
    let text_offset = wtle_offset + 12;
    if data.len() < len_offset + 4 {
        return Err("数据太短".to_string());
    }
    let prompt_len = u32::from_le_bytes([data[len_offset], data[len_offset + 1], data[len_offset + 2], data[len_offset + 3]]) as usize;
    if prompt_len == 0 {
        return Ok(String::new());
    }
    if data.len() < text_offset + prompt_len {
        return Err("提示文本数据不完整".to_string());
    }
    let prompt_bytes = &data[text_offset..text_offset + prompt_len];
    let (cow, _, _) = encoding_rs::GBK.decode(prompt_bytes);
    Ok(cow.into_owned())
}

/// Compute the password hash (MD5 + byte swap transformations).
/// 1. Compute MD5 of password bytes → 32-char uppercase hex string
/// 2. The hex string's ASCII bytes ARE the 32-byte array
/// 3. Swap: for i in 0..15: swap arr[i] ↔ arr[31-i]
/// 4. Swap: for i in (0..32).step_by(2): swap arr[i] ↔ arr[i+1]
pub fn compute_password(password: &[u8]) -> Vec<u8> {
    // Step 1: MD5 → lowercase hex string (32 chars)
    // E language: 校验_取md5(password,) defaults to 返回值转成大写=假, so result is lowercase
    let mut hasher = Md5::new();
    hasher.update(password);
    let hash = hasher.finalize();
    let hex_lower: String = hash.iter().map(|b| format!("{:02x}", b)).collect();

    // Step 2: The 32-char hex string as ASCII bytes is the 32-byte array
    let mut result = hex_lower.as_bytes().to_vec();

    // Step 3: Swap arr[i] ↔ arr[31-i] for i in 0..15
    for i in 0..15 {
        let j = 31 - i;
        result.swap(i, j);
    }

    // Step 4: Swap arr[i] ↔ arr[i+1] for i in (0,2,4,...,30) i.e. step_by(2)
    for i in (0..32).step_by(2) {
        result.swap(i, i + 1);
    }

    result
}

/// RC4 Key Scheduling Algorithm (计算密匙1).
/// Starts with the 258-byte initial S-box, performs KSA with the input data.
/// Returns 258-byte key state (256 S-box + 2 state bytes k1=0, k2=0).
pub fn compute_key1(data: &[u8]) -> Vec<u8> {
    let mut result = RC4_INITIAL_SBOX.to_vec();
    if data.is_empty() {
        return result;
    }
    let mut k: u8 = 0;
    let mut l: usize = 0;
    let len = data.len();
    for i in 0..256 {
        let b = result[i];
        k = b.wrapping_add(data[l]).wrapping_add(k);
        result[i] = result[k as usize];
        result[k as usize] = b;
        l = (l + 1) % len;
    }
    // k1=0, k2=0 are already at result[256] and result[257] from initial S-box
    result
}

/// RC4 PRGA decryption (解密数据2).
/// Decrypts data in-place using the RC4 stream cipher.
/// data: mutable data buffer
/// len: number of bytes to decrypt
/// offset: starting offset within data
/// key: 258-byte key state (modified in place, state persists)
pub fn decrypt_rc4(data: &mut [u8], len: usize, offset: usize, key: &mut [u8]) {
    let mut k1 = key[256];
    let mut k2 = key[257];
    for i in 0..len {
        k1 = k1.wrapping_add(1);
        let b = key[k1 as usize];
        k2 = k2.wrapping_add(b);
        key[k1 as usize] = key[k2 as usize];
        key[k2 as usize] = b;
        let xor_byte = key[(key[k1 as usize].wrapping_add(b)) as usize & 0xFF];
        data[offset + i] ^= xor_byte;
    }
    key[256] = k1;
    key[257] = k2;
}

/// Advance RC4 state without producing output (计算密匙2).
/// key: 258-byte key state (modified in place)
/// len: number of steps to advance
pub fn advance_key2(key: &mut [u8], len: usize) {
    let mut k1 = key[256];
    let mut k2 = key[257];
    for _ in 0..len {
        k1 = k1.wrapping_add(1);
        let b1 = key[k1 as usize];
        k2 = k2.wrapping_add(b1);
        key[k1 as usize] = key[k2 as usize];
        key[k2 as usize] = b1;
    }
    key[256] = k1;
    key[257] = k2;
}

/// Block decryption (解密数据).
/// Decrypts data in-place using block-based RC4 with 4096-byte blocks.
/// password: raw password bytes
/// data: mutable data buffer to decrypt
/// position: starting position offset for key scheduling
pub fn decrypt_data(password: &[u8], data: &mut [u8], position: usize) {
    let pw = compute_password(password);

    // Step 1: Generate tkey
    let surplus = data.len();
    let tkey_len = (surplus / 4096) * 8 + 16;
    let mut tkey = vec![0u8; tkey_len];
    let mut key = compute_key1(password);
    decrypt_rc4(&mut tkey, tkey_len, 0, &mut key);

    // Step 2: First block key
    let mut first_key_data: Vec<u8> = Vec::with_capacity(40);
    first_key_data.extend_from_slice(&tkey[0..8]);
    first_key_data.extend_from_slice(&pw);
    let mut key = compute_key1(&first_key_data);

    // Step 3: Advance state by position % 4096
    advance_key2(&mut key, position % 4096);

    // Step 4: First block
    let mut block_len = 4096 - position % 4096;
    let mut remaining = surplus - block_len;
    if block_len > surplus {
        block_len = surplus;
        remaining = 0;
    }
    decrypt_rc4(data, block_len, 0, &mut key);

    // Step 5: Subsequent blocks
    if remaining > 0 {
        let mut data_offset = block_len;
        let mut tkey_index: usize = 8; // Start from tkey[8..]
        loop {
            let mut block_key_data: Vec<u8> = Vec::with_capacity(40);
            if tkey_index + 8 <= tkey_len {
                block_key_data.extend_from_slice(&tkey[tkey_index..tkey_index + 8]);
            } else {
                block_key_data.extend_from_slice(&tkey[tkey_index..]);
            }
            block_key_data.extend_from_slice(&pw);
            key = compute_key1(&block_key_data);

            if remaining < 4096 {
                break;
            }
            decrypt_rc4(data, 4096, data_offset, &mut key);
            data_offset += 4096;
            remaining -= 4096;
            tkey_index += 8;
        }
        if remaining > 0 {
            decrypt_rc4(data, remaining, data_offset, &mut key);
        }
    }
}

/// Full module decryption (解密模块).
/// E language reference (1-indexed):
///   offset = 9
///   len = 取字节集数据(ec字节集, #整数型, offset)  → reads 4 bytes at position 9
///   offset = offset + 4 + len  → skip length field + text
///   verify: 计算密码(pw) == 解密数据(pw, 取字节集中间(ec字节集, offset, 32), offset - 1)
///   offset = offset + 32  → skip 32 bytes of verify data
///   result = 解密数据(pw, 取字节集右边(ec字节集, ...), offset)
///
/// Converted to 0-indexed:
///   offset = 8 + wtle_offset
///   len = readU32(data, offset)
///   offset += 4 + len  (skip 4-byte length field + text)
///   verify position = offset  (0-indexed, matches 1-indexed offset-1)
///   offset += 32  (skip 32 bytes of verify data)
///   data position = offset  (0-indexed)
pub fn decrypt_module(data: &[u8], password: &[u8]) -> Result<Vec<u8>, String> {
    let wtle_offset = get_wtle_offset(data).ok_or("模块未加密")?;
    let pw = compute_password(password);

    // 1-indexed offset = 9 → 0-indexed = 8 + wtle_offset
    let mut offset = wtle_offset + 8;

    // Read length value (text length only, not including the 4-byte length field)
    if offset + 4 > data.len() {
        return Err("数据太短".to_string());
    }
    let len = u32::from_le_bytes([data[offset], data[offset + 1], data[offset + 2], data[offset + 3]]) as usize;

    // Skip 4-byte length field + text content
    offset += 4 + len;

    // Verify password: decrypt 32 bytes first, then compare with computed password
    if offset + 32 > data.len() {
        return Err("验证数据不完整".to_string());
    }
    let mut verify_buf = data[offset..offset + 32].to_vec();
    // E language: position = offset - 1 (1-indexed) = offset (0-indexed)
    decrypt_data(password, &mut verify_buf, offset);

    if pw != verify_buf {
        return Err("密码错误".to_string());
    }

    // Skip 32 bytes of verify data
    offset += 32;

    // Decrypt remaining data
    if offset >= data.len() {
        return Err("无数据可解密".to_string());
    }
    let mut result = data[offset..].to_vec();
    // E language: position = offset (1-indexed) = offset (0-indexed)
    decrypt_data(password, &mut result, offset);

    Ok(result)
}
