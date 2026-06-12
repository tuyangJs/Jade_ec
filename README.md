# Jade EC查看器

易语言 `.ec` 模块文件现代化查看器，支持浏览子程序、DLL 命令、类、自定义数据类型、全局变量和常量。

## 项目结构

```
Jade_ec/
├── web/                      # 前端界面
├── rust/                     # Rust 启动器
│   ├── src/main.rs           
│   ├── Cargo.toml
│   ├── build.rs
│   └── build.ps1
├── src/                      # 源码目录
├── ec.e                      # 易语言主程序源码
├── FileInput.e               # 易语言模块分析依赖
├── dist/                     # 分发目录
│   ├── Jade_ec.exe           # 编译后的主程序
│   ├── app.japk              # JadePack 打包安装包时自动生成
│   └── bin/
│       ├── JadeView_x86.dll  # JadeView 运行库
│       └── jade-ec-launcher.exe  # Rust 启动器编译后产物
├── jadepack.config.json      # JadePack 打包配置
└── ico.ico                   # 应用图标
```

## 界面

- 现代化三栏布局：侧边栏导航 + 列表面板 + 详情面板
- 支持 Windows 亚克力（Acrylic）等背景材质
- 支持深色/浅色主题，跟随系统或手动切换
- 可调节侧边栏宽度，支持极窄模式

### 截图

<!-- 在下方添加截图，格式：![描述](相对路径) -->

#### 主界面：

<img width="1097" height="713" alt="QQ20260612-212518" src="https://github.com/user-attachments/assets/364c856f-18ff-4d4c-8d8a-8ae4af2d1448" />


#### 搜索功能：
> 支持 / 选择多种搜索模式
<img width="1068" height="703" alt="QQ20260612-212604" src="https://github.com/user-attachments/assets/f0b8c5b2-2c24-4b3b-8d81-7a928de6d7d3" />

> 支持 空格搜索多个关键词
<img width="1107" height="721" alt="QQ20260612-212645" src="https://github.com/user-attachments/assets/05bec973-f814-42a8-8ddd-1647f45d7f43" />


#### 设置页面：
> 支持 多种背景材料 与 内容页背景无极透明度设置
<img width="1102" height="775" alt="QQ20260612-212733" src="https://github.com/user-attachments/assets/f95f2a97-8c63-4fe7-b4a1-69e521e73ed9" />

#### 深色与浅色：
> 支持 深色、浅色 或跟随系统主题
<img width="1083" height="709" alt="QQ20260612-213337" src="https://github.com/user-attachments/assets/4647f635-d403-489c-8d1d-11600879b97d" />

#### 窄侧边栏：
<img width="1086" height="705" alt="QQ20260612-213631" src="https://github.com/user-attachments/assets/362f3ed5-98e1-4f19-88ff-dd28aa6db825" />


## 功能

- 打开 `.ec` 模块文件，解析并展示模块内容
- 分类浏览：子程序、DLL 命令、类、自定义数据类型、全局变量、常量
- 多维度搜索（名称、类型、备注、方法、参数）
- 拖拽打开文件
- 代码复制
- 文件关联：双击 `.ec` 文件直接打开

## 构建

### 前端

前端为纯静态页面，位于 `web/` 目录，无需构建步骤。

### Rust 启动器

```bash
cd rust
cargo build --release
```

产物位于 `rust/target/release/jade-ec-launcher.exe`。

### 打包

使用 [JadePack]('https://jade.run/v2api/jadepack') 进行打包，配置见 `jadepack.config.json`。&#x20;

