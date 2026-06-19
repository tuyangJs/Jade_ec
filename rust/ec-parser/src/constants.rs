// EC file magic numbers
pub const MAGIC1: u32 = 0x54574E43; // "CNWT" little-endian
pub const MAGIC2: u32 = 0x47525045; // "EPRG" little-endian

// Section magic (353465113 = 0x15117319, bytes: 19 73 11 15)
pub const SECTION_MAGIC: u32 = 0x15117319;

// Encryption marker "WTLE" = {87, 84, 76, 69} = 0x454C5457
pub const ENCRYPTION_MARKER: u32 = 0x454C5457;

// Section info size
pub const SIZE_OF_SECTION_INFO: usize = 92;

// Section name length
pub const SECTION_NAME_LEN: usize = 30;

// Default section key (no encryption)
pub const DEFAULT_SECTION_KEY: [u8; 4] = [25, 115, 0, 7];

// Data type constants (built-in types, stored as i32 in EC files)
// Values from original E language code constants
pub const DT_EMPTY: i32 = 0;                          // 空白型
pub const DT_BYTE: i32 = 0x80000101u32 as i32;        // 字节型
pub const DT_SHORT: i32 = 0x80000201u32 as i32;       // 短整数
pub const DT_INT: i32 = 0x80000301u32 as i32;         // 整数型
pub const DT_INT_ALT: i32 = 1090644251;               // 整数型(文件中常见另一种编码)
pub const DT_INT_ALT_2: i32 = 1090683027;             // 整数型(另一个DLL参数编码)
pub const DT_LONG: i32 = 0x80000401u32 as i32;        // 长整数型
pub const DT_FLOAT: i32 = 0x80000501u32 as i32;       // 小数型
pub const DT_DOUBLE: i32 = 0x80000601u32 as i32;      // 双精度小数型
pub const DT_BOOL: i32 = 0x80000002u32 as i32;        // 逻辑型
pub const DT_DATE: i32 = 0x80000003u32 as i32;        // 日期时间型
pub const DT_STRING: i32 = 0x80000004u32 as i32;      // 文本型
pub const DT_BIN: i32 = 0x80000005u32 as i32;         // 字节集
pub const DT_SUB_PTR: i32 = 0x80000006u32 as i32;     // 子程序指针
pub const DT_GENERIC: i32 = 0x80000000u32 as i32;     // 通用型

// Constant page types
pub const CONST_PAGE_CONSTANT: i32 = 1;    // 常量
pub const CONST_PAGE_IMAGE: i32 = 2;       // 图片
pub const CONST_PAGE_SOUND: i32 = 3;       // 声音

// Constant data types
pub const CONST_DATA_EMPTY: i32 = 22;      // 空白
pub const CONST_DATA_NUMBER: i32 = 23;     // 数值
pub const CONST_DATA_BOOL: i32 = 24;       // 逻辑
pub const CONST_DATA_DATE: i32 = 25;       // 日期
pub const CONST_DATA_TEXT: i32 = 26;       // 文本

// Variable attribute flags
pub const VAR_ATTR_STATIC: i32 = 1;      // 静态
pub const VAR_ATTR_BY_REF: i32 = 2;      // 传址/参考
pub const VAR_ATTR_OPTIONAL: i32 = 4;    // 可空
pub const VAR_ATTR_ARRAY: i32 = 8;       // 数组
pub const VAR_ATTR_PUBLIC: i32 = 256;    // 公开

// Function attribute flags
pub const FUNC_ATTR_PUBLIC: i32 = 8;     // 公开

// Constant attribute flags
pub const CONST_ATTR_PUBLIC: i32 = 2;         // 公开
pub const CONST_ATTR_LONG_TEXT: i32 = 16;     // 长文本常量

// RC4 block size for decryption
pub const RC4_BLOCK_SIZE: usize = 4096;

// krnln.fne (系统核心支持库, lib_index=1) built-in data types
// 1-based index: type_index 1 = 窗口, 2 = 报表, ...
pub const KRNLN_DATA_TYPES: &[&str] = &[
    "",               // 0: placeholder (1-based indexing)
    "窗口",           // 1
    "报表",           // 2
    "菜单",           // 3
    "字体",           // 4
    "编辑框",         // 5
    "图片框",         // 6
    "外形框",         // 7
    "画板",           // 8
    "分组框",         // 9
    "标签",           // 10
    "按钮",           // 11
    "选择框",         // 12
    "单选框",         // 13
    "组合框",         // 14
    "列表框",         // 15
    "选择列表框",     // 16
    "横向滚动条",     // 17
    "纵向滚动条",     // 18
    "进度条",         // 19
    "滑块条",         // 20
    "选择夹",         // 21
    "影像框",         // 22
    "日期框",         // 23
    "月历",           // 24
    "驱动器框",       // 25
    "目录框",         // 26
    "文件框",         // 27
    "颜色选择器",     // 28
    "超级链接框",     // 29
    "调节器",         // 30
    "通用对话框",     // 31
    "时钟",           // 32
    "打印机",         // 33
    "字段信息",       // 34
    "数据报",         // 35
    "数据报",         // 36
    "客户",           // 37
    "服务器",         // 38
    "端口",           // 39
    "打印设置信息",   // 40
    "表格",           // 41
    "数据源",         // 42
    "通用提供者",     // 43
    "数据库提供者",   // 44
    "图形按钮",       // 45
    "外部数据库",     // 46
    "外部数据提供者", // 47
    "对象",           // 48
    "变体型",         // 49
    "变体类型",       // 50
    "无法载入的窗口组件", // 51
];

// RC4 initial S-box constant (258 bytes: 256 S-box + 2 state bytes)
// This is the exact S-box from the original E language code
pub const RC4_INITIAL_SBOX: [u8; 258] = [
    240, 94, 153, 161, 136, 227, 30, 238, 17, 158, 201, 151, 27, 144, 79, 124,
    82, 203, 130, 250, 39, 222, 246, 168, 218, 211, 176, 207, 86, 214, 133, 66,
    26, 156, 181, 14, 184, 237, 16, 28, 36, 106, 105, 206, 135, 85, 31, 150,
    108, 123, 186, 101, 20, 170, 44, 221, 163, 182, 125, 99, 245, 233, 142, 32,
    65, 35, 120, 140, 252, 34, 159, 166, 180, 111, 167, 119, 89, 192, 191, 58,
    48, 162, 21, 42, 83, 93, 116, 77, 147, 251, 247, 64, 115, 40, 110, 118,
    213, 177, 45, 149, 112, 244, 60, 52, 229, 76, 91, 187, 95, 80, 88, 141,
    107, 183, 97, 9, 242, 72, 202, 129, 55, 69, 239, 208, 190, 217, 212, 231,
    157, 51, 145, 113, 47, 59, 230, 13, 254, 121, 73, 103, 25, 165, 8, 175,
    128, 178, 235, 62, 210, 185, 209, 68, 87, 143, 138, 75, 57, 241, 102, 234,
    226, 223, 243, 122, 152, 205, 171, 139, 4, 98, 84, 22, 18, 67, 2, 216,
    54, 114, 6, 127, 37, 224, 46, 5, 15, 255, 173, 3, 7, 225, 148, 23,
    193, 50, 195, 81, 215, 219, 232, 228, 117, 63, 1, 38, 74, 41, 100, 71,
    134, 61, 189, 220, 131, 43, 104, 29, 70, 236, 196, 154, 200, 49, 78, 169,
    164, 53, 155, 172, 92, 11, 146, 204, 10, 132, 19, 12, 0, 160, 179, 96,
    24, 90, 197, 198, 137, 126, 33, 249, 194, 109, 188, 199, 174, 56, 253, 248,
    0, 0, // k1=0, k2=0
];
