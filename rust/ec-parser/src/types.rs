pub struct SectionInfo {
    pub key: [u8; 4],
    pub name: [u8; 30],
    pub reserve_fill_1: [u8; 2],
    pub index: i32,
    pub flag1: i32,
    pub data_checksum: i32,
    pub data_length: i32,
    pub reserve_item: [u8; 40],
}

use serde::Serialize;

#[derive(Serialize, Clone, Debug, Default)]
pub struct EcModule {
    pub module_info: ModuleInfo,
    pub sub_routines: Vec<SubRoutine>,
    pub classes: Vec<Class>,
    pub dll_commands: Vec<DllCommand>,
    pub global_vars: Vec<GlobalVar>,
    pub custom_types: Vec<CustomType>,
    pub constants: Vec<Constant>,
}

#[derive(Serialize, Clone, Debug, Default)]
pub struct ModuleInfo {
    pub name: String,
    pub description: String,
    pub author: String,
    pub zip_code: String,
    pub address: String,
    pub phone: String,
    pub fax: String,
    pub email: String,
    pub homepage: String,
    pub other: String,
    pub major_version: i32,
    pub minor_version: i32,
    pub libraries: Vec<LibInfo>,
}

#[derive(Serialize, Clone, Debug)]
pub struct SubRoutine {
    pub name: String,
    pub description: String,
    pub return_type: String,
    pub is_public: bool,
    pub parameters: Vec<Parameter>,
}

#[derive(Serialize, Clone, Debug)]
pub struct Class {
    pub name: String,
    pub description: String,
    pub is_public: bool,
    pub sub_routines: Vec<SubRoutine>,
    pub members: Vec<Member>,
}

#[derive(Serialize, Clone, Debug)]
pub struct DllCommand {
    pub name: String,
    pub description: String,
    pub dll_name: String,
    pub function_name: String,
    pub return_type: String,
    pub parameters: Vec<Parameter>,
    pub return_type_raw: i32,
}

#[derive(Serialize, Clone, Debug)]
pub struct GlobalVar {
    pub name: String,
    pub description: String,
    pub data_type: String,
    pub is_public: bool,
    pub is_array: bool,
    pub array_dims: Vec<i32>,
}

#[derive(Serialize, Clone, Debug)]
pub struct CustomType {
    pub name: String,
    pub description: String,
    pub is_public: bool,
    pub members: Vec<Member>,
}

#[derive(Serialize, Clone, Debug)]
pub struct Constant {
    pub name: String,
    pub description: String,
    pub data_type: String,
    pub value: String,
    pub page_type: i32,
}

#[derive(Serialize, Clone, Debug)]
pub struct Parameter {
    pub name: String,
    pub description: String,
    pub data_type: String,
    pub is_by_ref: bool,
    pub is_array: bool,
    pub array_dims: Vec<i32>,
    pub default_value: String,
    pub data_type_raw: i32,
    pub is_optional: bool,
}

#[derive(Serialize, Clone, Debug)]
pub struct Member {
    pub name: String,
    pub description: String,
    pub data_type: String,
    pub is_public: bool,
    pub is_array: bool,
    pub array_dims: Vec<i32>,
}

#[derive(Serialize, Clone, Debug)]
pub struct LibInfo {
    pub name: String,
    pub file_name: String,
    pub guid: String,
    pub major_version: i32,
    pub minor_version: i32,
    pub version: String,
}

#[derive(Debug, Clone)]
pub struct ProgramAssembly {
    pub dw_id: i32,
    pub name: String,
    pub description: String,
    pub is_public: bool,
    pub is_class: bool,
    pub function_group_count: i32,
    pub function_group_flags: Vec<i32>,
    pub function_group_ids: Vec<Vec<i32>>,
    pub members: Vec<ProgramVariable>,
    pub base_class: i32,
    pub class_index: i32,
}

#[derive(Debug, Clone)]
pub struct ProgramFunction {
    pub dw_id: i32,
    pub name: String,
    pub description: String,
    pub return_type: i32,
    pub is_public: bool,
    pub parameters: Vec<ProgramVariable>,
    pub locals: Vec<ProgramVariable>,
}

#[derive(Debug, Clone)]
pub struct ProgramVariable {
    pub name: String,
    pub description: String,
    pub data_type: i32,
    pub is_public: bool,
    pub is_by_ref: bool,
    pub is_optional: bool,
    pub is_array: bool,
    pub array_dims: Vec<i32>,
    pub array_lower_bounds: Vec<i32>,
    pub default_value: String,
}

#[derive(Debug, Clone)]
pub struct DataType {
    pub dw_id: i32,
    pub name: String,
    pub description: String,
    pub is_public: bool,
    pub base_type: i32,
    pub members: Vec<ProgramVariable>,
}

#[derive(Debug, Clone)]
pub struct ConstInfo {
    pub name: String,
    pub description: String,
    pub data_type: i32,
    pub page_type: i32,
    pub value: String,
}
