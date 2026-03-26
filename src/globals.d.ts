declare const require: any;
declare const process: any;
declare const __dirname: string;
declare const console: any;
declare function setTimeout(handler: (...args: any[]) => void, timeout?: number, ...args: any[]): any;
declare function clearTimeout(timeoutId: any): void;

declare module "node:fs/promises";
declare module "node:path";
declare module "node:os";
declare module "node:child_process";
declare module "node:util";
declare module "node:readline/promises";
declare module "node:process";
