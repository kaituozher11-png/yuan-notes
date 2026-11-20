# 源笔记

本机运行的学习资料与笔记工作台。支持 PDF、PPT/PPTX、Word/DOCX 导入，按页预览、个人笔记和自备模型 API 生成。

项目介绍与界面截图：[PDF 预览](docs/项目介绍/源笔记项目介绍.pdf) · [Word 文档](docs/项目介绍/源笔记项目介绍.docx)。

![源笔记原文与智能笔记界面](docs/项目介绍/images/02-原文与智能笔记.png)

## 启动

准备 Node.js 24+、LibreOffice，以及系统命令行可找到的 `pdfinfo`、`pdftotext`、`pdftoppm`。当前 Windows 环境已安装这些程序。

```powershell
git clone https://github.com/kaituozher11-png/yuan-notes.git
cd yuan-notes
npm ci
npm run dev
```

浏览器打开 [http://127.0.0.1:5173/](http://127.0.0.1:5173/)。生产构建可运行 `npm run build`，再以 `npm start` 启动本机服务，地址为 `http://127.0.0.1:4174/`。

若系统无法直接找到转换程序，可设置 `LIBREOFFICE_PATH`、`YINGXING_PDFINFO_PATH`、`YINGXING_PDFTOTEXT_PATH`、`YINGXING_PDFTOPPM_PATH` 为程序的完整路径。

资料、图片和笔记保存在项目的 `data/` 目录。资料库顶部的“备份资料库”会下载包含原件、预览、图片和笔记的 ZIP；备份不包含浏览器保存的模型密钥。请定期备份 `data/`。

应用已更名为“源笔记”。旧版的应用标识、数据目录和浏览器存储键继续兼容，避免改名后丢失已有资料及模型配置。

## 模型连接

应用不提供模型额度。在“模型连接”中填写兼容 **OpenAI Chat Completions** 的接口地址、模型名称和自己的 API 密钥。接口使用 HTTPS；本机测试接口可使用 `http://127.0.0.1`。密钥在当前浏览器加密保存，关闭后需用保护口令解锁。调用服务商可能产生费用。若模型支持图片输入，勾选对应选项后生成任务会发送页面图片。

本项目不需要把密钥写入源码或配置文件。未配置模型时，资料阅读、个人笔记、链接和模板仍可使用。

## 测试

```powershell
npm test
npm run build
npm audit --omit=dev
```

测试记录见 [开发依据/开发验收记录_v1.md](开发依据/开发验收记录_v1.md)。测试截图和样例位于 `test-output/`，不属于正式资料库。

## 安装与公开发布

生产构建包含网页应用清单和图标。在运行服务的电脑上使用支持安装的浏览器访问本机地址后，可通过浏览器菜单安装网页外壳；该网页外壳仍需让本机服务保持运行。Android 离线测试版则把界面和资料存储打进手机应用，使用说明见 [开发依据/Android手机测试版使用说明.md](开发依据/Android手机测试版使用说明.md)。iOS 网页安装仍需要公开 HTTPS 网站，离线原生应用尚未制作。这与 App Store、Google Play 或 Microsoft Store 上架不同。

默认本机模式只允许本机访问，并把资料放在单一 `data/` 目录。**不要把默认本机服务直接暴露到公网。** 面向多名学生的网页版、各平台安装包及商店上架路径见 [开发依据/多平台发布准备_v1.md](开发依据/多平台发布准备_v1.md)。

公开网页版的账号与独立资料区已在隔离环境中实现和测试。正式域名、云服务器和线上部署尚未完成；当前 `127.0.0.1` 地址仍只供本机访问。部署说明与验证范围见 [开发依据/网页版发布与部署_v1.md](开发依据/网页版发布与部署_v1.md)。

### 测试安装包

[GitHub Releases](https://github.com/kaituozher11-png/yuan-notes/releases) 提供 Windows x64 本机预览安装包和 Android 离线测试 APK。Windows 安装包未签名，双击安装后可从开始菜单打开“源笔记”；应用会自动启动本机服务，退出应用时关闭。资料保存在该应用的用户数据目录，和项目的 `data/` 分开。旧版安装数据目录会继续沿用，避免改名后已有资料失联。当前不提供自动更新或多设备同步。

此预览包没有内置 LibreOffice 和 Poppler。导入 PDF 需要系统能找到 `pdfinfo`；页面文字和模型图片还需要 `pdftotext`、`pdftoppm`。导入 PPT/Word 还需要 LibreOffice；Windows 上的 Word 会优先尝试本机 Microsoft Word。缺少工具时会给出提示。商店版需解决依赖分发、签名及干净电脑验收，不能直接把此预览包提交商店。
