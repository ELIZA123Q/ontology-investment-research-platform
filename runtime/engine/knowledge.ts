import "server-only";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import YAML from "yaml";
import { repositoryPath } from "../adapters/repo-paths";
import type { StageKind } from "./types";

const contextRegistryPath="governance/01_架构/runtime_contexts.yaml";

function registeredFiles(stage:StageKind):string[]{
  const registry=YAML.parse(readFileSync(repositoryPath(contextRegistryPath),"utf8")) as {stages?:Record<string,{assets?:string[]}>};
  const assets=registry.stages?.[stage]?.assets;
  if(!Array.isArray(assets)||!assets.length) throw new Error(`运行上下文注册表缺少 ${stage}`);
  return assets;
}

export function loadKnowledge(stage:StageKind){
  const files=registeredFiles(stage);
  const loaded=files.map(file=>({file,content:readFileSync(repositoryPath(file),"utf8")}));
  const version=createHash("sha256").update(loaded.map(x=>`${x.file}\0${x.content}`).join("\0")).digest("hex");
  // Bound API cost while retaining headings, rules and field contracts.
  const context=loaded.map(x=>`\n## ${x.file}\n${x.content.slice(0,24000)}`).join("\n");
  return {version:`sha256:${version}`,context,files};
}
