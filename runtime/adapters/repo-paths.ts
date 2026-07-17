import path from "node:path";

export const repositoryRoot=path.resolve(/* turbopackIgnore: true */ process.cwd(),"..");

export function repositoryPath(...parts:string[]){
  return path.join(repositoryRoot,...parts);
}
