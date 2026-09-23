# TextPrint

输入文字、设定排版与内容纸张尺寸，使用浏览器的系统打印对话框打印。界面设计沿用 [EazyChemistry](https://github.com/RavelloH/EazyChemistry) 的语言。

可选用 [gpu-lexer](https://github.com/vercel-labs/gpu-lexer) 对代码文字着色，预览和打印保留原文与换行。该功能需要支持 WebGPU 的浏览器，不可用时会回退到普通文字。

先填写文字与排版设置，再打开预览对话框，确认后调用系统打印。内容纸张尺寸独立于打印机的实际纸张；推荐在系统打印设置中使用 100% 缩放并关闭页眉页脚。长文本会按内容纸张尺寸分页。

支持单列、两列和三列排版，列间距可调整；页尾可选择关闭（默认）、仅页数、全部（站点、日期、页数）。iPhone/iPad 上先生成独立 PDF，再通过共享菜单选择打印，以避免 Safari 为网页自动增加网址、日期和额外页数。PDF 以 220 DPI 位图保存文字，适合打印，但其中的文字不可选取。

## 开发

```sh
pnpm install
pnpm dev
pnpm build
```

MIT License
