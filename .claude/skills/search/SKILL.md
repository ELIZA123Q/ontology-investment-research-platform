---
name: search
description: >-
  文件搜索与项目索引。在项目目录中按名称、内容模式、路径模式查找文件。
  支持 YAML/JSON/TypeScript 源码的结构化搜索。
  Use when user asks to "搜索文件" "查找" "grep"
  "文件在哪" or mentions file search, find in project.
allowed-tools: Read, Bash
---

# 文件搜索

## 触发条件

- 需要查找项目中特定文件的位置
- 需要按内容模式搜索代码
- 需要理解项目结构

## 使用流程

1. 确定搜索模式（文件名、内容、路径）
2. 执行搜索（使用 Glob/Grep 工具）
3. 必要时进一步读取匹配文件

## 知识库引用（不复制，直接读取）

| 需要什么 | 读取位置 |
|---------|---------|
| 项目结构 | `CLAUDE.md` |
| 关键文件索引 | `CLAUDE.md` 关键文件索引表 |

> **状态：planned** — 搜索功能由 Claude Code 内置的 Glob/Grep 工具提供。
> 本 skill 作为占位符保留，后续可能基于 `07_07_runtime/skills/search/` 扩展项目自定义索引。
