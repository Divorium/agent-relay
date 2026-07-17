declare module "node:http" { export function createServer(handler: (req: any, res: any) => void | Promise<void>): any; }
declare module "node:fs/promises" { export function appendFile(path: string, data: string, options?: any): Promise<void>; export function mkdir(path: string, options?: any): Promise<void>; export function readFile(path: string, encoding: string): Promise<string>; export function writeFile(path: string, data: string, options?: any): Promise<void>; export function rename(oldPath: string, newPath: string): Promise<void>; export function rm(path: string, options?: any): Promise<void>; export function realpath(path: string): Promise<string>; export function stat(path: string): Promise<any>; export function readdir(path: string): Promise<string[]>; export function chmod(path: string, mode: number): Promise<void>; export function symlink(target: string, path: string): Promise<void>; export function lstat(path: string): Promise<any>; }
declare module "node:path" { export function resolve(...paths: string[]): string; export function relative(from: string, to: string): string; export function dirname(path: string): string; export function join(...paths: string[]): string; export const sep: string; }
declare module "node:child_process" { export function spawn(command: string, args?: string[], options?: any): any; export function spawnSync(command: string, args?: string[], options?: any): any; }
declare module "node:test" { const test: any; export default test; }
declare module "node:assert/strict" { const assert: any; export default assert; }
declare module "node:os" { export function tmpdir(): string; }
declare const process: any;
declare const Buffer: any;

declare module "node:url" { export function fileURLToPath(url: string): string; }
