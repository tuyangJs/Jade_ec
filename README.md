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

主界面：

![主界面](screenshots/main.png)

搜索功能：

![搜索](screenshots/search.png)

设置页面：

![设置](screenshots/settings.png)

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

