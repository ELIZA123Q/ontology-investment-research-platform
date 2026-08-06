import path from "node:path";

export const repositoryRoot = path.resolve(/* turbopackIgnore: true */ process.cwd(), "..");
export const instancesRoot = path.resolve(process.cwd(), "..", "90_compat", "instances");

export function repositoryPath(...parts: string[]) {
  return path.join(/* turbopackIgnore: true */ repositoryRoot, ...parts);
}

export function instancesPath(...parts: string[]) {
  return path.join(instancesRoot, ...parts);
}
