declare module "node:fs/promises" {
  export function symlink(target: string, path: string, type?: string | null): Promise<void>;
}
