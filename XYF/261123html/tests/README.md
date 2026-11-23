# 浏览器回归

页面为独立 HTML，无依赖安装或构建步骤。测试需要本机已安装并可用的 ego-browser。

在仓库根目录启动专用测试服务器：

```bash
python3 -m http.server 4179 --bind 127.0.0.1 --directory XYF/261123html
```

在另一个终端通过 `ego-browser nodejs` 调用 `browser.mjs` 导出的 `run(page)`，传入本次 TaskSpace 的 Page。模块路径使用当前仓库的绝对路径。

测试会通过界面清空 `http://127.0.0.1:4179` 的学习记录，然后填写全部 14 天的真实题目，验证输入标签、键盘切题、特殊字符搜索、四种宽度、刷新持久化、错题移除、JSON 导出、重置、弹窗键盘操作和系统无障碍设置。请为 4179 端口保留独立测试数据。导出的记录存入已忽略的 `.work/checkins.json`。

测试最后只读打开相邻的 `index.html` 的 file URL，确认八项填空和十道选择题正常呈现。测试不生成截图，不覆盖个人日常使用地址的学习进度。

已执行静态检查：

```bash
node --check XYF/261123html/tests/browser.mjs
node /Users/oyamahappa/.codex/skills/taste-skill/scripts/lint.mjs XYF/261123html/index.html
git diff --check
```

taste 静态检查结果为 0 FAIL、1 WARN；警告来自日期的月份与日期补零，保留以维持 `YYYY-MM-DD` 存储格式。内嵌 JavaScript 另经 Node.js `vm.Script` 语法检查通过。
