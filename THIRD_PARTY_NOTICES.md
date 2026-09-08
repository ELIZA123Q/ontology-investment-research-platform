# 第三方组件声明

本项目通过 Python 依赖使用 [Semantica 0.6.8](https://github.com/semantica-agi/semantica)，不复制、不 fork、也不修改其源代码。完整解析结果见 `uv.lock`；直接依赖与启用的 extra 见 `pyproject.toml`。

## Semantica 0.6.8

MIT License

Copyright (c) 2026 Semantica

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.

## 直接依赖与启用组件

| 组件 | 锁定范围或版本 | 用途 | 许可证来源 |
|---|---|---|---|
| Semantica | `0.6.8` | ContextGraph、Oxigraph 适配、provenance | 发行包 `LICENSE` |
| PyOxigraph | 由 `semantica[tripletstore-oxigraph]` 锁定 | 嵌入式 RDF 权威图 | 发行包元数据 |
| pySHACL | 由 `semantica[shacl]` 锁定 | SHACL 结构校验 | 发行包元数据 |
| Pydantic | `>=2.11,<3` | 研究运行合同 | 发行包元数据 |
| PyYAML | `>=6.0.2,<7` | 本体、规则、能力与 Logic 配置 | 发行包元数据 |
| RDFLib | `>=7.1,<8` | RDF 编译产物与测试 | 发行包元数据 |

所有传递依赖保留各自许可证；版本、来源和哈希以 `uv.lock` 与安装发行包中的许可证文件为准。
