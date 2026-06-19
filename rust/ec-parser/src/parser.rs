use crate::reader::BinaryReader;
use crate::types::*;
use crate::constants::*;
use std::collections::HashMap;

/// Helper: read an int then skip that many bytes
fn skip_int(file: &mut BinaryReader) -> Result<(), String> {
    let len = file.read_int().map_err(|e| e.message)? as usize;
    file.skip(len).map_err(|e| e.message)
}

/// Helper: read an int then read that many bytes
fn read_int_bytes<'a>(file: &mut BinaryReader<'a>) -> Result<&'a [u8], String> {
    let len = file.read_int().map_err(|e| e.message)? as usize;
    file.read_bytes(len).map_err(|e| e.message)
}

/// Parse an EC module file
/// data: raw file bytes
/// decrypt_mode: if true, use the encrypted module layout (GetLibraries2)
pub fn parse_ec(data: &[u8], decrypt_mode: bool) -> Result<EcModule, String> {
    let mut file = BinaryReader::new(data);

    // Check magic
    check_magic(&mut file)?;

    // Collect sections
    let mut module_info_data: Option<(usize, usize)> = None; // (offset, length)
    let mut resource_section_data: Option<(usize, usize)> = None;
    let mut program_section_data: Option<(usize, usize)> = None;

    while file.available() > 0 {
        if !check_section(&mut file)? {
            break;
        }
        let info = read_section_info(&mut file)?;
        let section_start = file.get_offset();

        // Handle decrypt mode DataLength adjustment
        let data_length = if decrypt_mode {
            let mut temp_file = file.clone_at();
            if temp_file.move_to(section_start + (info.data_length as usize) - 1).is_ok() {
                if let Ok(val) = temp_file.read_uint() {
                    if val == SECTION_MAGIC {
                        (info.data_length - 1) as usize
                    } else {
                        (info.data_length + 1) as usize
                    }
                } else {
                    info.data_length as usize
                }
            } else {
                info.data_length as usize
            }
        } else {
            info.data_length as usize
        };

        // Decode section name
        let mut name_bytes = info.name;
        if info.key != DEFAULT_SECTION_KEY {
            decode_str(&mut name_bytes, &info.key);
        }
        let name_slice = &name_bytes[..name_bytes.iter().position(|&b| b == 0).unwrap_or(name_bytes.len())];
        let (cow, _, _) = encoding_rs::GBK.decode(name_slice);
        let section_name = cow.into_owned();

        match section_name.as_str() {
            "用户信息段" => {
                module_info_data = Some((section_start, data_length));
            }
            "程序资源段" => {
                resource_section_data = Some((section_start, data_length));
            }
            "程序段" => {
                program_section_data = Some((section_start, data_length));
            }
            _ => {}
        }

        // Skip section data
        let next_offset = section_start + data_length;
        if next_offset > file.data().len() {
            // Last section may have inaccurate DataLength in decrypt mode
            break;
        }
        file.move_to(next_offset).map_err(|e| e.message)?;
    }

    // Parse module info section
    let mut ec_module = EcModule::default();
    if let Some((offset, _length)) = module_info_data {
        file.move_to(offset).map_err(|e| e.message)?;
        ec_module.module_info = parse_module_info(&mut file)?;
    }

    // Parse resource section (constants)
    if let Some((offset, _length)) = resource_section_data {
        file.move_to(offset).map_err(|e| e.message)?;
        ec_module.constants = parse_resource_section(&mut file)?;
    }

    // Parse program section
    if let Some((offset, _length)) = program_section_data {
        file.move_to(offset).map_err(|e| e.message)?;
        parse_program_section(&mut file, decrypt_mode, &mut ec_module)?;
    }

    // Sort all lists by name
    sort_module(&mut ec_module);

    Ok(ec_module)
}

fn check_magic(file: &mut BinaryReader) -> Result<(), String> {
    let m1 = file.read_uint().map_err(|e| e.message)?;
    if m1 != MAGIC1 {
        return Err("Magic1校验失败".to_string());
    }
    let m2 = file.read_uint().map_err(|e| e.message)?;
    if m2 != MAGIC2 {
        return Err("Magic2校验失败".to_string());
    }
    Ok(())
}

fn check_section(file: &mut BinaryReader) -> Result<bool, String> {
    if file.available() < 8 {
        return Ok(false);
    }
    let m = file.read_uint().map_err(|e| e.message)?;
    if m != SECTION_MAGIC {
        return Err("SectionMagic校验失败".to_string());
    }
    file.skip(4).map_err(|e| e.message)?; // Info_CheckSum
    Ok(true)
}

fn read_section_info(file: &mut BinaryReader) -> Result<SectionInfo, String> {
    let bytes = file.read_bytes(SIZE_OF_SECTION_INFO).map_err(|e| e.message)?;
    let mut info = SectionInfo {
        key: [0u8; 4],
        name: [0u8; 30],
        reserve_fill_1: [0u8; 2],
        index: 0,
        flag1: 0,
        data_checksum: 0,
        data_length: 0,
        reserve_item: [0u8; 40],
    };
    info.key.copy_from_slice(&bytes[0..4]);
    info.name.copy_from_slice(&bytes[4..34]);
    info.reserve_fill_1.copy_from_slice(&bytes[34..36]);
    info.index = i32::from_le_bytes([bytes[36], bytes[37], bytes[38], bytes[39]]);
    info.flag1 = i32::from_le_bytes([bytes[40], bytes[41], bytes[42], bytes[43]]);
    info.data_checksum = i32::from_le_bytes([bytes[44], bytes[45], bytes[46], bytes[47]]);
    info.data_length = i32::from_le_bytes([bytes[48], bytes[49], bytes[50], bytes[51]]);
    info.reserve_item.copy_from_slice(&bytes[52..92]);
    Ok(info)
}

fn decode_str(data: &mut [u8; 30], key: &[u8; 4]) {
    let key_len = key.len();
    let mut key_i: usize = 0;
    for i in 0..data.len() {
        // E language: key_i starts at 1, key[key_i % key_len + 1] (1-indexed)
        // In 0-indexed: key[(key_i + 1) % key_len]
        data[i] ^= key[(key_i + 1) % key_len];
        key_i += 1;
    }
}

fn parse_module_info(file: &mut BinaryReader) -> Result<ModuleInfo, String> {
    Ok(ModuleInfo {
        name: file.read_string().map_err(|e| e.message)?,
        description: file.read_string().map_err(|e| e.message)?,
        author: file.read_string().map_err(|e| e.message)?,
        zip_code: file.read_string().map_err(|e| e.message)?,
        address: file.read_string().map_err(|e| e.message)?,
        phone: file.read_string().map_err(|e| e.message)?,
        fax: file.read_string().map_err(|e| e.message)?,
        email: file.read_string().map_err(|e| e.message)?,
        homepage: file.read_string().map_err(|e| e.message)?,
        other: file.read_string().map_err(|e| e.message)?,
        major_version: file.read_int().map_err(|e| e.message)?,
        minor_version: file.read_int().map_err(|e| e.message)?,
        libraries: Vec::new(),
    })
}

fn skip_window_section(file: &mut BinaryReader) -> Result<(), String> {
    let count = file.read_int().map_err(|e| e.message)?;
    if count == 0 {
        return Ok(());
    }
    file.skip(count as usize).map_err(|e| e.message)?;
    let loop_count = count / 8;
    for _ in 0..loop_count {
        file.skip(8).map_err(|e| e.message)?;
        skip_int(file)?;
        skip_int(file)?;
        file.skip(4).map_err(|e| e.message)?;
        skip_int(file)?;
    }
    Ok(())
}

fn get_high_type(dword: i32) -> i32 {
    ((dword as u32 & 0xF0000000) >> 28) as i32
}

fn parse_resource_section(file: &mut BinaryReader) -> Result<Vec<Constant>, String> {
    skip_window_section(file)?;

    let count = file.read_int().map_err(|e| e.message)?;
    file.skip(4).map_err(|e| e.message)?; // length

    if count <= 0 {
        return Ok(Vec::new());
    }

    let count = count as usize;

    // Read flags
    let mut flags = vec![0i32; count];
    for i in 0..count {
        flags[i] = file.read_int().map_err(|e| e.message)?;
    }

    // Read offsets
    let mut offsets = vec![0i32; count];
    for i in 0..count {
        offsets[i] = file.read_int().map_err(|e| e.message)?;
    }

    let base_offset = file.get_offset();
    let mut constants = Vec::new();

    for i in 0..count {
        file.move_to(base_offset + offsets[i] as usize).map_err(|e| e.message)?;
        file.skip(4).map_err(|e| e.message)?; // dwLength
        let _attr = file.read_short().map_err(|e| e.message)?;
        let name = file.read_normal_string().map_err(|e| e.message)?;
        if name.is_empty() {
            continue;
        }
        let description = file.read_normal_string().map_err(|e| e.message)?;
        let page_type = get_high_type(flags[i]);

        let const_data_type_byte = if page_type == CONST_PAGE_CONSTANT {
            file.read_byte().map_err(|e| e.message)? as i32
        } else {
            0
        };

        let value = match page_type {
            p if p == CONST_PAGE_CONSTANT => {
                match const_data_type_byte {
                    d if d == CONST_DATA_EMPTY => String::new(),
                    d if d == CONST_DATA_NUMBER => {
                        let v = file.read_double().map_err(|e| e.message)?;
                        format!("{}", v)
                    }
                    d if d == CONST_DATA_BOOL => {
                        let v = file.read_boolean().map_err(|e| e.message)?;
                        if v { "真".to_string() } else { "假".to_string() }
                    }
                    d if d == CONST_DATA_DATE => {
                        let v = file.read_date().map_err(|e| e.message)?;
                        format!("{}", v)
                    }
                    d if d == CONST_DATA_TEXT => {
                        file.read_string().map_err(|e| e.message)?
                    }
                    _ => format!("未知类型({})", const_data_type_byte),
                }
            }
            p if p == CONST_PAGE_IMAGE => {
                let len = file.read_int().map_err(|e| e.message)?;
                file.skip(len as usize).map_err(|e| e.message)?;
                format!("[图片, {}字节]", len)
            }
            p if p == CONST_PAGE_SOUND => {
                let len = file.read_int().map_err(|e| e.message)?;
                file.skip(len as usize).map_err(|e| e.message)?;
                format!("[声音, {}字节]", len)
            }
            _ => format!("未知页面类型({})", page_type),
        };

        constants.push(Constant {
            name,
            description,
            data_type: match page_type {
                1 => match const_data_type_byte {
                    d if d == CONST_DATA_EMPTY => "空白型",
                    d if d == CONST_DATA_NUMBER => {
                        // 数值型常量存储为 double，根据值判断具体类型
                        if let Ok(v) = value.parse::<f64>() {
                            if v.fract() == 0.0 && v >= i32::MIN as f64 && v <= i32::MAX as f64 {
                                "整数型"
                            } else {
                                "小数型"
                            }
                        } else {
                            "小数型"
                        }
                    }
                    d if d == CONST_DATA_BOOL => "逻辑型",
                    d if d == CONST_DATA_DATE => "日期时间型",
                    d if d == CONST_DATA_TEXT => "文本型",
                    _ => "未知",
                },
                2 => "图片",
                3 => "声音",
                _ => "未知",
            }.to_string(),
            value,
            page_type,
        });
    }

    Ok(constants)
}

fn parse_program_section(
    file: &mut BinaryReader,
    decrypt_mode: bool,
    ec_module: &mut EcModule,
) -> Result<(), String> {
    if decrypt_mode {
        parse_decrypted_program_section(file, ec_module)
    } else {
        parse_normal_program_section(file, ec_module)
    }
}

fn parse_normal_program_section(
    file: &mut BinaryReader,
    ec_module: &mut EcModule,
) -> Result<(), String> {
    // Basic info
    file.skip(8).map_err(|e| e.message)?;
    skip_int(file)?;
    skip_int(file)?;
    skip_int(file)?;

    // Libraries
    let lib_count = file.read_short().map_err(|e| e.message)? as usize;
    for _ in 0..lib_count {
        let lib_bytes = read_int_bytes(file)?;
        let parts: Vec<&[u8]> = lib_bytes.split(|&b| b == 13).collect(); // split by \r (0x0D)
        if parts.len() >= 5 {
            let (fn_cow, _, _) = encoding_rs::GBK.decode(parts[0]);
            let (guid_cow, _, _) = encoding_rs::GBK.decode(parts[1]);
            let major: i32 = String::from_utf8_lossy(parts[2]).parse().unwrap_or(0);
            let minor: i32 = String::from_utf8_lossy(parts[3]).parse().unwrap_or(0);
            let (name_cow, _, _) = encoding_rs::GBK.decode(parts[4]);
            ec_module.module_info.libraries.push(LibInfo {
                file_name: fn_cow.into_owned(),
                guid: guid_cow.into_owned(),
                major_version: major,
                minor_version: minor,
                version: format!("{}.{}", major, minor),
                name: name_cow.into_owned(),
            });
        }
    }

    // Flag-dependent skip
    let flag = file.read_int().map_err(|e| e.message)?;
    if flag & 1 != 0 {
        file.skip(20).map_err(|e| e.message)?;
    } else {
        file.skip(4).map_err(|e| e.message)?;
    }
    skip_int(file)?;
    skip_int(file)?;

    // Assemblies
    let mut assemblies = Vec::new();
    let (asm_count, asm_ids) = parse_assembly_header(file)?;
    for i in 0..asm_count {
        file.skip(4).map_err(|e| e.message)?;
        let base_class = file.read_int().map_err(|e| e.message)?;
        let name = file.read_string().map_err(|e| e.message)?;
        let description = file.read_string().map_err(|e| e.message)?;
        let group_len = file.read_int().map_err(|e| e.message)? as usize / 4;
        let mut group_flags = Vec::with_capacity(group_len);
        for _ in 0..group_len {
            group_flags.push(file.read_int().map_err(|e| e.message)?);
        }
        // Skip variable data
        file.skip(4).map_err(|e| e.message)?;
        skip_int(file)?;

        assemblies.push(ProgramAssembly {
            dw_id: asm_ids.get(i).copied().unwrap_or(0),
            name,
            description,
            is_public: false,
            is_class: base_class != 0,
            function_group_count: group_len as i32,
            function_group_flags: group_flags,
            function_group_ids: Vec::new(),
            members: Vec::new(),
            base_class,
            class_index: 0,
        });
    }

    // Functions
    let mut functions = Vec::new();
    let (func_count, func_ids) = parse_function_header(file)?;
    for i in 0..func_count {
        let _func_type = file.read_int().map_err(|e| e.message)?;
        let attr = file.read_int().map_err(|e| e.message)?;
        let return_type = file.read_int().map_err(|e| e.message)?;
        let name = file.read_string().map_err(|e| e.message)?;
        let description = file.read_string().map_err(|e| e.message)?;
        let locals = read_variable_data(file)?;
        let parameters = read_variable_data(file)?;
        skip_int(file)?;
        skip_int(file)?;
        skip_int(file)?;
        skip_int(file)?;
        skip_int(file)?;
        skip_int(file)?;

        functions.push(ProgramFunction {
            dw_id: func_ids.get(i).copied().unwrap_or(0),
            name,
            description,
            return_type,
            is_public: attr & FUNC_ATTR_PUBLIC != 0,
            parameters,
            locals,
        });
    }

    // Global variables
    let global_vars = read_variable_data(file)?;

    // Data types
    let mut data_types = Vec::new();
    let (dt_count, dt_ids) = parse_datatype_header(file)?;
    for i in 0..dt_count {
        let attr = file.read_int().map_err(|e| e.message)?;
        let name = file.read_string().map_err(|e| e.message)?;
        let description = file.read_string().map_err(|e| e.message)?;
        let members = read_variable_data(file)?;

        data_types.push(DataType {
            dw_id: dt_ids.get(i).copied().unwrap_or(0),
            name,
            description,
            is_public: attr & VAR_ATTR_PUBLIC != 0,
            base_type: 0,
            members,
        });
    }

    // DLL commands
    let dll_commands = parse_dll_commands(file)?;

    // Post-processing
    post_process(assemblies, functions, global_vars, data_types, dll_commands, ec_module)
}

fn parse_decrypted_program_section(
    file: &mut BinaryReader,
    ec_module: &mut EcModule,
) -> Result<(), String> {
    // GetLibraries2 layout
    file.skip(8).map_err(|e| e.message)?;
    skip_int(file)?;
    file.skip(8).map_err(|e| e.message)?;
    skip_int(file)?;
    file.skip(8).map_err(|e| e.message)?;

    // Libraries
    let lib_count = file.read_short().map_err(|e| e.message)? as usize;
    for _ in 0..lib_count {
        let lib_bytes = read_int_bytes(file)?;
        let parts: Vec<&[u8]> = lib_bytes.split(|&b| b == 13).collect();
        if parts.len() >= 5 {
            let (fn_cow, _, _) = encoding_rs::GBK.decode(parts[0]);
            let (guid_cow, _, _) = encoding_rs::GBK.decode(parts[1]);
            let major: i32 = String::from_utf8_lossy(parts[2]).parse().unwrap_or(0);
            let minor: i32 = String::from_utf8_lossy(parts[3]).parse().unwrap_or(0);
            let (name_cow, _, _) = encoding_rs::GBK.decode(parts[4]);
            ec_module.module_info.libraries.push(LibInfo {
                file_name: fn_cow.into_owned(),
                guid: guid_cow.into_owned(),
                major_version: major,
                minor_version: minor,
                version: format!("{}.{}", major, minor),
                name: name_cow.into_owned(),
            });
        }
    }

    // Two byte sets + 16 bytes reserved
    skip_int(file)?;
    skip_int(file)?;
    file.skip(16).map_err(|e| e.message)?;

    // Functions
    let mut functions = Vec::new();
    let (func_count, func_ids) = parse_function_header(file)?;
    for i in 0..func_count {
        let _func_type = file.read_int().map_err(|e| e.message)?;
        let attr = file.read_int().map_err(|e| e.message)?;
        let return_type = file.read_int().map_err(|e| e.message)?;
        let name = file.read_string().map_err(|e| e.message)?;
        let description = file.read_string().map_err(|e| e.message)?;
        let locals = read_variable_data(file)?;
        let parameters = read_variable_data(file)?;
        skip_int(file)?;
        skip_int(file)?;
        skip_int(file)?;
        skip_int(file)?;
        skip_int(file)?;
        skip_int(file)?;

        functions.push(ProgramFunction {
            dw_id: func_ids.get(i).copied().unwrap_or(0),
            name,
            description,
            return_type,
            is_public: attr & FUNC_ATTR_PUBLIC != 0,
            parameters,
            locals,
        });
    }

    // DLL commands
    let dll_commands = parse_dll_commands(file)?;

    // Global variables
    let global_vars = read_variable_data(file)?;

    // Assemblies
    let mut assemblies = Vec::new();
    let (asm_count, asm_ids) = parse_assembly_header(file)?;
    for i in 0..asm_count {
        file.skip(4).map_err(|e| e.message)?;
        let base_class = file.read_int().map_err(|e| e.message)?;
        let name = file.read_string().map_err(|e| e.message)?;
        let description = file.read_string().map_err(|e| e.message)?;
        let group_len = file.read_int().map_err(|e| e.message)? as usize / 4;
        let mut group_flags = Vec::with_capacity(group_len);
        for _ in 0..group_len {
            group_flags.push(file.read_int().map_err(|e| e.message)?);
        }
        file.skip(4).map_err(|e| e.message)?;
        skip_int(file)?;

        assemblies.push(ProgramAssembly {
            dw_id: asm_ids.get(i).copied().unwrap_or(0),
            name,
            description,
            is_public: false,
            is_class: base_class != 0,
            function_group_count: group_len as i32,
            function_group_flags: group_flags,
            function_group_ids: Vec::new(),
            members: Vec::new(),
            base_class,
            class_index: 0,
        });
    }

    // Data types
    let mut data_types = Vec::new();
    let (dt_count, dt_ids) = parse_datatype_header(file)?;
    for i in 0..dt_count {
        let attr = file.read_int().map_err(|e| e.message)?;
        let name = file.read_string().map_err(|e| e.message)?;
        let description = file.read_string().map_err(|e| e.message)?;
        let members = read_variable_data(file)?;

        data_types.push(DataType {
            dw_id: dt_ids.get(i).copied().unwrap_or(0),
            name,
            description,
            is_public: attr & VAR_ATTR_PUBLIC != 0,
            base_type: 0,
            members,
        });
    }

    post_process(assemblies, functions, global_vars, data_types, dll_commands, ec_module)
}

fn parse_assembly_header(file: &mut BinaryReader) -> Result<(usize, Vec<i32>), String> {
    let length = file.read_int().map_err(|e| e.message)? as usize;
    let count = length / 8;
    let mut ids = Vec::with_capacity(count);
    for _ in 0..count {
        ids.push(file.read_int().map_err(|e| e.message)?); // dwID
    }
    file.skip(length / 2).map_err(|e| e.message)?;
    Ok((count, ids))
}

fn parse_function_header(file: &mut BinaryReader) -> Result<(usize, Vec<i32>), String> {
    let length = file.read_int().map_err(|e| e.message)? as usize;
    let count = length / 8;
    let mut ids = Vec::with_capacity(count);
    for _ in 0..count {
        ids.push(file.read_int().map_err(|e| e.message)?); // dwID
    }
    file.skip(length / 2).map_err(|e| e.message)?;
    Ok((count, ids))
}

fn parse_datatype_header(file: &mut BinaryReader) -> Result<(usize, Vec<i32>), String> {
    let length = file.read_int().map_err(|e| e.message)? as usize;
    let count = length / 8;
    let mut ids = Vec::with_capacity(count);
    for _ in 0..count {
        ids.push(file.read_int().map_err(|e| e.message)?); // dwID
    }
    file.skip(length / 2).map_err(|e| e.message)?;
    Ok((count, ids))
}

fn read_variable_data(file: &mut BinaryReader) -> Result<Vec<ProgramVariable>, String> {
    let count = file.read_int().map_err(|e| e.message)? as usize;
    let end_offset = file.read_int().map_err(|e| e.message)? as usize;
    let mark_pos = file.get_offset() + end_offset;

    if count == 0 {
        file.move_to(mark_pos).map_err(|e| e.message)?;
        return Ok(Vec::new());
    }

    // Read flags
    let mut flags = vec![0i32; count];
    for i in 0..count {
        flags[i] = file.read_int().map_err(|e| e.message)?;
    }

    // Read offsets
    let mut offsets = vec![0i32; count];
    for i in 0..count {
        offsets[i] = file.read_int().map_err(|e| e.message)?;
    }

    let base_offset = file.get_offset();
    let mut vars = Vec::with_capacity(count);

    for i in 0..count {
        file.move_to(base_offset + offsets[i] as usize).map_err(|e| e.message)?;
        file.skip(4).map_err(|e| e.message)?; // dwLength
        let data_type = file.read_int().map_err(|e| e.message)?;
        let attr = file.read_short().map_err(|e| e.message)?;
        let array_dims = file.read_byte().map_err(|e| e.message)?;
        let mut array_bounds = Vec::with_capacity(array_dims as usize);
        for _ in 0..array_dims {
            array_bounds.push(file.read_int().map_err(|e| e.message)?);
        }
        let name = file.read_normal_string().map_err(|e| e.message)?;
        let description = file.read_normal_string().map_err(|e| e.message)?;

        vars.push(ProgramVariable {
            name,
            description,
            data_type,
            is_public: attr as i32 & VAR_ATTR_PUBLIC != 0,
            is_by_ref: attr as i32 & VAR_ATTR_BY_REF != 0,
            is_optional: attr as i32 & VAR_ATTR_OPTIONAL != 0,
            is_array: attr as i32 & VAR_ATTR_ARRAY != 0,
            array_dims: vec![array_dims as i32],
            array_lower_bounds: array_bounds,
            default_value: String::new(),
        });
    }

    file.move_to(mark_pos).map_err(|e| e.message)?;
    Ok(vars)
}

fn parse_dll_commands(file: &mut BinaryReader) -> Result<Vec<DllCommand>, String> {
    let count_raw = file.read_int().map_err(|e| e.message)?;
    file.skip(count_raw as usize).map_err(|e| e.message)?;
    let count = count_raw as usize / 8;

    let mut commands = Vec::with_capacity(count);

    for _ in 0..count {
        file.skip(4).map_err(|e| e.message)?;
        let return_type_raw = file.read_int().map_err(|e| e.message)?;
        let name = file.read_string().map_err(|e| e.message)?;
        if name.is_empty() {
            skip_int(file)?; // description
            skip_int(file)?; // dll_name
            skip_int(file)?; // func_name
            file.read_int().map_err(|e| e.message)?; // param count
            skip_int(file)?; // params
            continue;
        }
        let description = file.read_string().map_err(|e| e.message)?;
        let dll_name = file.read_string().map_err(|e| e.message)?;
        let func_name = file.read_string().map_err(|e| e.message)?;
        let parameters = read_dll_variable_data(file)?;

        commands.push(DllCommand {
            name,
            description,
            dll_name,
            function_name: func_name,
            return_type: String::new(), // Will be resolved in post_process
            parameters,
            return_type_raw,
        });
    }

    Ok(commands)
}

fn read_dll_variable_data(file: &mut BinaryReader) -> Result<Vec<Parameter>, String> {
    let count = file.read_int().map_err(|e| e.message)? as usize;
    let end_offset = file.read_int().map_err(|e| e.message)? as usize;
    let mark_pos = file.get_offset() + end_offset;

    if count == 0 {
        file.move_to(mark_pos).map_err(|e| e.message)?;
        return Ok(Vec::new());
    }

    file.skip(count * 4).map_err(|e| e.message)?; // skip flags

    let mut offsets = vec![0i32; count];
    for i in 0..count {
        offsets[i] = file.read_int().map_err(|e| e.message)?;
    }

    let base_offset = file.get_offset();
    let mut params = Vec::with_capacity(count);

    for i in 0..count {
        file.move_to(base_offset + offsets[i] as usize).map_err(|e| e.message)?;
        file.skip(4).map_err(|e| e.message)?; // dwLength
        let data_type_raw = file.read_int().map_err(|e| e.message)?;
        let attr = file.read_short().map_err(|e| e.message)?;
        file.skip(1).map_err(|e| e.message)?; // array dims (DLL params don't have array bounds)
        let name = file.read_normal_string().map_err(|e| e.message)?;
        let description = file.read_normal_string().map_err(|e| e.message)?;

        params.push(Parameter {
            name,
            description,
            data_type: String::new(), // resolved in post_process
            is_by_ref: attr as i32 & VAR_ATTR_BY_REF != 0,
            is_array: attr as i32 & VAR_ATTR_ARRAY != 0,
            array_dims: Vec::new(),
            default_value: String::new(),
            data_type_raw,
            is_optional: attr as i32 & VAR_ATTR_OPTIONAL != 0,
        });
    }

    file.move_to(mark_pos).map_err(|e| e.message)?;
    Ok(params)
}

/// Post-processing: resolve type names, classify subroutines vs classes
fn post_process(
    assemblies: Vec<ProgramAssembly>,
    functions: Vec<ProgramFunction>,
    global_vars: Vec<ProgramVariable>,
    data_types: Vec<DataType>,
    dll_commands: Vec<DllCommand>,
    ec_module: &mut EcModule,
) -> Result<(), String> {
    // Build lookup maps for O(1) type resolution
    let dt_map: HashMap<i32, &str> = data_types.iter()
        .map(|dt| (dt.dw_id, dt.name.as_str()))
        .collect();
    let asm_map: HashMap<i32, &str> = assemblies.iter()
        .map(|asm| (asm.dw_id, asm.name.as_str()))
        .collect();

    // Build function→assembly lookup: func_dw_id → assembly index
    let mut func_to_asm: HashMap<i32, usize> = HashMap::new();
    for (j, asm) in assemblies.iter().enumerate() {
        for flag in &asm.function_group_flags {
            func_to_asm.insert(*flag, j);
        }
    }

    // Resolve DLL command return types
    ec_module.dll_commands.reserve(dll_commands.len());
    for mut cmd in dll_commands {
        cmd.return_type = get_data_type_name(cmd.return_type_raw, &dt_map, &asm_map);
        for param in &mut cmd.parameters {
            param.data_type = get_data_type_name(param.data_type_raw, &dt_map, &asm_map);
        }
        ec_module.dll_commands.push(cmd);
    }

    // Classify subroutines and classes
    let mut classes: Vec<Class> = Vec::new();
    let mut class_map: HashMap<String, usize> = HashMap::new(); // class_name → index in classes vec

    for func in &functions {
        if func.name.is_empty() {
            continue;
        }

        if let Some(&j) = func_to_asm.get(&func.dw_id) {
            let asm = &assemblies[j];
            if asm.base_class == 0 {
                // Subroutine
                ec_module.sub_routines.push(SubRoutine {
                    name: func.name.clone(),
                    description: func.description.clone(),
                    return_type: get_data_type_name(func.return_type, &dt_map, &asm_map),
                    is_public: func.is_public,
                    parameters: convert_parameters(&func.parameters, &dt_map, &asm_map),
                });
            } else if func.is_public {
                // Class method
                let class_name = &asm.name;
                if let Some(&idx) = class_map.get(class_name) {
                    classes[idx].sub_routines.push(SubRoutine {
                        name: func.name.clone(),
                        description: func.description.clone(),
                        return_type: get_data_type_name(func.return_type, &dt_map, &asm_map),
                        is_public: func.is_public,
                        parameters: convert_parameters(&func.parameters, &dt_map, &asm_map),
                    });
                } else {
                    let idx = classes.len();
                    class_map.insert(class_name.clone(), idx);
                    classes.push(Class {
                        name: class_name.clone(),
                        description: asm.description.clone(),
                        is_public: true,
                        sub_routines: vec![SubRoutine {
                            name: func.name.clone(),
                            description: func.description.clone(),
                            return_type: get_data_type_name(func.return_type, &dt_map, &asm_map),
                            is_public: func.is_public,
                            parameters: convert_parameters(&func.parameters, &dt_map, &asm_map),
                        }],
                        members: Vec::new(),
                    });
                }
            }
        } else {
            // No assembly found - treat as subroutine
            ec_module.sub_routines.push(SubRoutine {
                name: func.name.clone(),
                description: func.description.clone(),
                return_type: get_data_type_name(func.return_type, &dt_map, &asm_map),
                is_public: func.is_public,
                parameters: convert_parameters(&func.parameters, &dt_map, &asm_map),
            });
        }
    }

    ec_module.classes = classes;

    // Global variables
    for var in global_vars {
        if var.name.is_empty() {
            continue;
        }
        ec_module.global_vars.push(GlobalVar {
            name: var.name,
            description: var.description,
            data_type: get_data_type_name(var.data_type, &dt_map, &asm_map),
            is_public: var.is_public,
            is_array: var.is_array,
            array_dims: var.array_lower_bounds,
        });
    }

    // Custom data types
    for dt in &data_types {
        if dt.name.is_empty() {
            continue;
        }
        ec_module.custom_types.push(CustomType {
            name: dt.name.clone(),
            description: dt.description.clone(),
            is_public: dt.is_public,
            members: convert_members(&dt.members, &dt_map, &asm_map),
        });
    }

    Ok(())
}

fn get_data_type_name(type_value: i32, dt_map: &HashMap<i32, &str>, asm_map: &HashMap<i32, &str>) -> String {
    // First try exact match against built-in types
    match type_value {
        DT_EMPTY => return String::new(),
        DT_BYTE => return "字节型".to_string(),
        DT_SHORT => return "短整数".to_string(),
        DT_INT | DT_INT_ALT | DT_INT_ALT_2 => return "整数型".to_string(),
        DT_LONG => return "长整数型".to_string(),
        DT_FLOAT => return "小数型".to_string(),
        DT_DOUBLE => return "双精度小数".to_string(),
        DT_BOOL => return "逻辑型".to_string(),
        DT_DATE => return "日期时间型".to_string(),
        DT_STRING => return "文本型".to_string(),
        DT_BIN => return "字节集".to_string(),
        DT_SUB_PTR => return "子程序指针".to_string(),
        DT_GENERIC => return "通用型".to_string(),
        -1 => return String::new(),
        _ => {}
    }

    // Try custom data types
    if let Some(name) = dt_map.get(&type_value) {
        return name.to_string();
    }

    // Try assemblies
    if let Some(name) = asm_map.get(&type_value) {
        return name.to_string();
    }

    // Support library type reference
    let lib_index = (type_value as u32 >> 16) as i32;
    if lib_index > 0 {
        let type_index = (type_value as u32 & 0xFFFF) as usize;
        // krnln.fne (lib_index=1) has a hardcoded type table
        if lib_index == 1 && type_index < KRNLN_DATA_TYPES.len() {
            let type_name = KRNLN_DATA_TYPES[type_index];
            if !type_name.is_empty() {
                return type_name.to_string();
            }
        }
        return format!("支持库类型[{}:{}]", lib_index, type_index);
    }

    String::new()
}

fn convert_parameters(vars: &[ProgramVariable], dt_map: &HashMap<i32, &str>, asm_map: &HashMap<i32, &str>) -> Vec<Parameter> {
    vars.iter().map(|v| Parameter {
        name: v.name.clone(),
        description: v.description.clone(),
        data_type: get_data_type_name(v.data_type, dt_map, asm_map),
        is_by_ref: v.is_by_ref,
        is_array: v.is_array || !v.array_lower_bounds.is_empty(),
        array_dims: v.array_lower_bounds.clone(),
        default_value: v.default_value.clone(),
        data_type_raw: v.data_type,
        is_optional: v.is_optional,
    }).collect()
}

fn convert_members(vars: &[ProgramVariable], dt_map: &HashMap<i32, &str>, asm_map: &HashMap<i32, &str>) -> Vec<Member> {
    vars.iter().map(|v| Member {
        name: v.name.clone(),
        description: v.description.clone(),
        data_type: get_data_type_name(v.data_type, dt_map, asm_map),
        is_public: v.is_public,
        is_array: v.is_array || !v.array_lower_bounds.is_empty(),
        array_dims: v.array_lower_bounds.clone(),
    }).collect()
}

fn sort_module(ec_module: &mut EcModule) {
    // Case-insensitive sort without allocating lowercase strings
    let ci_cmp = |a: &str, b: &str| -> std::cmp::Ordering {
        let mut ai = a.chars();
        let mut bi = b.chars();
        loop {
            match (ai.next(), bi.next()) {
                (None, None) => return std::cmp::Ordering::Equal,
                (None, _) => return std::cmp::Ordering::Less,
                (_, None) => return std::cmp::Ordering::Greater,
                (Some(ac), Some(bc)) => {
                    match ac.to_lowercase().cmp(bc.to_lowercase()) {
                        std::cmp::Ordering::Equal => continue,
                        ord => return ord,
                    }
                }
            }
        }
    };

    ec_module.sub_routines.sort_by(|a, b| ci_cmp(&a.name, &b.name));
    ec_module.classes.sort_by(|a, b| ci_cmp(&a.name, &b.name));
    for class in &mut ec_module.classes {
        class.sub_routines.sort_by(|a, b| ci_cmp(&a.name, &b.name));
    }
    ec_module.dll_commands.sort_by(|a, b| ci_cmp(&a.name, &b.name));
    ec_module.global_vars.sort_by(|a, b| ci_cmp(&a.name, &b.name));
    ec_module.custom_types.sort_by(|a, b| ci_cmp(&a.name, &b.name));
    ec_module.constants.sort_by(|a, b| {
        match a.page_type.cmp(&b.page_type) {
            std::cmp::Ordering::Equal => ci_cmp(&a.name, &b.name),
            ord => ord,
        }
    });
}
