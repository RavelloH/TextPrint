# TextPrint

轻松纯打印纯文本内容，自带语法高亮、纸张大小设置、方向设置、分列、列间距、字体、字号、页边距、颜色等。

https://print.ravelloh.com

<img width="887" height="1326" alt="image" src="https://github.com/user-attachments/assets/e7f93d69-2949-454e-aed1-87ae277ba722" />

输入文字，设定页面与排版，预览后即可打印。

设置字体、字号、文字颜色和对齐方式，并选择 A3、A4、A5、A6、Letter 或自定义纸张尺寸。内容尺寸独立于打印机纸张，长文本会自动分页。

支持单列、两列和三列排版，可调整列间距；页尾可选择关闭、仅显示页数，或显示站点、日期与页数。打印时建议使用 100% 缩放，并在系统打印设置中关闭页眉页脚。

可选用 [gpu-lexer](https://github.com/vercel-labs/gpu-lexer) 对文字进行语法高亮。此功能需要支持 WebGPU 的浏览器；不可用时会回退到普通文字显示，保留原文和换行。

## 开发

需要 Node.js `^20.19.0 || >=22.12.0` 和 pnpm `11.1.3`。

```bash
pnpm install --frozen-lockfile
pnpm dev
```

代码检查与生产构建：

```bash
pnpm lint
pnpm build
```

生产构建输出到 `dist/`。

## 许可证

MIT
