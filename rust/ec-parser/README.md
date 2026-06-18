# EC Parser - 易语言模块解析器

Rust 实现的易语言 .ec 模块文件解析器，编译为 DLL 提供 C FFI 接口，支持加密模块解密。

## 编译

```bash
# 进入项目目录
cd rust/ec-parser

# 编译 x86 (i686) release - 默认目标架构
.\build.ps1

# 或手动编译
$env:CARGO_TARGET_DIR = "D:\ec_target"
cargo build --release --target i686-pc-windows-msvc
```

编译后 DLL 位于 `dist\bin\ec_parser.dll`。

## C API 接口

所有函数接收文件路径，DLL 内部读取文件。

### is_ec_encrypted

判断 EC 模块是否加密。

```c
int is_ec_encrypted(const char* path);
```

- **参数**：`path` - 文件路径（UTF-8 编码）
- **返回**：`1` 加密，`0` 未加密，`-1` 读取文件失败
- **判断依据**：偏移 8 处 4 字节 == `"WTLE"` (0x454C5457)

### get_ec_prompt_info

获取加密模块的提示信息。

```c
char* get_ec_prompt_info(const char* path);
```

- **参数**：`path` - 文件路径
- **返回**：JSON 字符串指针，格式 `{"prompt":"提示内容"}`，需调用 `free_ec_string` 释放

### parse_ec_to_json

解析 EC 模块，返回完整 JSON。

```c
char* parse_ec_to_json(const char* path, const char* password);
```

- **参数**：`path` - 文件路径，`password` - 密码（NULL 表示无密码）
- **返回**：JSON 字符串指针，需调用 `free_ec_string` 释放
- **加密模块**：若模块加密且未提供密码，返回 `{"error":"模块已加密，需要提供密码"}`

### free_ec_string

释放由上述函数返回的字符串内存。

```c
void free_ec_string(char* s);
```

## Python 调用示例

```python
import ctypes
import json

# 加载 DLL
dll = ctypes.CDLL("ec_parser.dll")

# 设置函数签名
dll.is_ec_encrypted.argtypes = [ctypes.c_char_p]
dll.is_ec_encrypted.restype = ctypes.c_int

dll.parse_ec_to_json.argtypes = [ctypes.c_char_p, ctypes.c_char_p]
dll.parse_ec_to_json.restype = ctypes.c_void_p

dll.free_ec_string.argtypes = [ctypes.c_void_p]
dll.free_ec_string.restype = None

# 判断是否加密
ec_path = r"C:\模块.ec"
encrypted = dll.is_ec_encrypted(ec_path.encode("utf-8"))
print(f"加密: {'是' if encrypted else '否'}")

# 解析模块
ptr = dll.parse_ec_to_json(ec_path.encode("utf-8"), None)
if ptr:
    result = ctypes.cast(ptr, ctypes.c_char_p).value
    module = json.loads(result.decode("utf-8"))

    print(f"模块名: {module['module_info']['name']}")
    print(f"子程序: {len(module['sub_routines'])}")
    print(f"类: {len(module['classes'])}")

    dll.free_ec_string(ptr)
```

### 解析加密模块

```python
ptr = dll.parse_ec_to_json(ec_path.encode("utf-8"), "密码".encode("utf-8"))
```

## JSON 输出结构

```json
{
  "module_info": {
    "name": "模块名称",
    "description": "模块备注",
    "author": "作者",
    "major_version": 11,
    "minor_version": 1,
    "libraries": [
      { "name": "支持库名", "guid": "GUID" }
    ]
  },
  "sub_routines": [
    {
      "name": "子程序名",
      "description": "备注",
      "return_type": "整数型",
      "is_public": true,
      "parameters": [
        { "name": "参数名", "data_type": "整数型", "is_by_ref": false }
      ]
    }
  ],
  "classes": [
    {
      "name": "类名",
      "description": "备注",
      "is_public": true,
      "sub_routines": [ /* 同 sub_routines 格式 */ ]
    }
  ],
  "dll_commands": [
    {
      "name": "命令名",
      "dll_name": "user32.dll",
      "function_name": "SendMessageA",
      "return_type": "整数型",
      "parameters": [ /* 同上 */ ]
    }
  ],
  "constants": [
    {
      "name": "常量名",
      "description": "备注",
      "data_type": "常量",
      "value": "值",
      "page_type": 1
    }
  ],
  "global_vars": [
    {
      "name": "变量名",
      "data_type": "整数型",
      "is_public": true,
      "is_array": false
    }
  ],
  "custom_types": [
    {
      "name": "类型名",
      "description": "备注",
      "is_public": true,
      "members": [
        { "name": "成员名", "data_type": "整数型" }
      ]
    }
  ]
}
```

## 数据类型对照

| 内部值 | 易语言类型 |
|--------|-----------|
| 0 | 空 |
| 1 | 字节型 |
| 2 | 短整数 |
| 3 | 整数型 |
| 4 | 长整数型 |
| 5 | 小数型 |
| 6 | 双精度小数 |
| 7 | 逻辑型 |
| 8 | 日期时间型 |
| 9 | 文本型 |
| 10 | 字节集 |
| 11 | 子程序指针 |
| 14 | 通用型 |

## 常量页面类型

| page_type | 含义 |
|-----------|------|
| 1 | 常量 |
| 2 | 图片 |
| 3 | 声音 |

## 注意事项

1. **编码**：易语言所有文本均为 ANSI (GBK) 编码，DLL 内部已处理 GBK→UTF-8 转换，JSON 输出为 UTF-8
2. **路径编码**：文件路径使用 UTF-8 编码传入
3. **指针管理**：返回值类型必须用 `c_void_p`，不能用 `c_char_p`，否则 Python 会自动转换导致 `free_ec_string` 崩溃
4. **架构匹配**：32 位程序加载 i686 DLL，64 位程序加载 x64 DLL
