import "server-only";

// 实例图引擎：类型与图的构建 / 查询 / 投影 / 物化 / 下游追踪。
// 本文件为 barrel，具体实现见同目录子模块：
//   types       —— 图类型与 emptyGraph
//   load        —— 文件 / 包 / run 加载与查询
//   projection  —— 临时投影、合并、摘要
//   materialize —— 阶段草稿物化为 instance_graph 载荷
//   trace       —— 下游可达性追踪与失效标记
export * from "./instance_graph/types";
export * from "./instance_graph/load";
export * from "./instance_graph/projection";
export * from "./instance_graph/materialize";
export * from "./instance_graph/trace";
